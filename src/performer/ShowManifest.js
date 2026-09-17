/**
 * ShowManifest.js - the document a show is planned in, before anything exists.
 *
 * A scenario says what the set DOES. It can only say it in terms of things
 * that are already on the rig: a section whose look names a scene nobody has
 * loaded is an inert section and a warning. That is the right rule at showtime
 * and it leaves one case with nowhere to start — the artist who has the set in
 * their head and an empty editor. Asked for a scenario against a rig with no
 * scenes in it, the model is told outright not to invent any, so it writes a
 * set whose every look is unset. Correct, and useless.
 *
 * A manifest is the other end of that. It is written BEFORE the looks exist
 * and it describes them in prose: the show, its shape, and what each look in it
 * should be. ShowBuilder.js turns one into the looks themselves — a patch per
 * look, each installed as a scene — and then into a scenario that names them.
 * So the same document that says "four sections, the third is the drop"
 * produces the patches the third section cuts to.
 *
 *   manifest (prose, written by the artist)
 *       │
 *       ├── one ai.patch_generator call per look ──> patches ──> scenes
 *       │
 *       └── one ai.performer_scenario call, told about those scenes
 *                                          │
 *                                          ▼
 *                                      a scenario that plays them
 *
 * This file is only the document: read it, coerce it, say what is wrong with
 * it, and write the three prompts it implies. It knows nothing about the model,
 * the editor or the engine, which is what makes the whole pipeline testable
 * without any of them.
 *
 * It follows Scenario.js's discipline exactly, and for the same reason: a
 * manifest is hand-written, model-written, opened from someone else's machine
 * and round-tripped through a file, so normalizeManifest() coerces everything
 * and throws nothing, while validateManifest() is the separate strict pass
 * that reports ALL the problems at once — a manifest is fixed at a desk, and a
 * one-error-at-a-time loop wastes the one thing that desk has.
 */

import { MEDIA_LIMITS, mediaSlotName, resolveLookMedia } from './ShowFolder.js';
import { handlesText } from './PatchHandles.js';

/** The format version this build writes. Readers accept anything <= this. */
export const MANIFEST_VERSION = 1;

/** Whether the music has a beat to count against. Mirrors MusicalListener. */
export const PULSE_KINDS = Object.freeze(['metered', 'free']);

/**
 * Ceilings.
 *
 * `looks` is the one that is not about memory. Every generated look is a model
 * call the artist pays for, so a manifest with sixty looks in it is not an
 * ambitious show — it is a typo that would spend an allowance. Twelve is more
 * looks than any set in the README's own advice ("four to eight sections"), so
 * the cap only ever catches the mistake.
 */
export const MANIFEST_LIMITS = Object.freeze({
  looks: 12,
  cues: 32,
  signals: 64,
  briefChars: 1000,
  lookBriefChars: 600,
  requires: 16,
});

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const str = (value, fallback = '') => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
};

const trimmed = (value, max) => str(value).trim().slice(0, max);

const list = (value) => (Array.isArray(value) ? value : []);

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * An id safe to use as a section id and as a scene name in one document.
 *
 * Both ends of the pipeline look things up by this string — the scenario names
 * a scene, the executor resolves it — so it has to survive being written by
 * hand, by a model, and by whatever the artist typed as a look's name.
 */
export function slugId(value, fallback = 'look') {
  const slug = str(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

/**
 * How long a look is up for, as a scenario `hold` — or null when the manifest
 * did not say, which leaves the decision to whoever writes the scenario.
 */
function normalizeLength(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? { seconds: clamp(raw, 0, 3600) } : null;
  }
  if (typeof raw !== 'object') return null;
  if (raw.bars !== undefined) {
    const bars = clamp(num(raw.bars, 0), 0, 1024);
    return bars > 0 ? { bars } : null;
  }
  if (raw.seconds !== undefined) {
    const seconds = clamp(num(raw.seconds, 0), 0, 3600);
    return seconds > 0 ? { seconds } : null;
  }
  return null;
}

/**
 * Node/parameter pairs this look has to contain, by name.
 *
 * Nothing hand-written fills this in. It is what a look derived from a
 * scenario that already exists carries: a section whose drives reach for
 * "Warp.amount" needs a patch with a node called Warp that has a parameter
 * called amount, or the drive is inert and the section is a still image with
 * a fader wired to nothing. The names are not a hint — ActionExecutor resolves
 * a node by them, and a name that is nearly right resolves to nothing.
 *
 * Accepts the "Node.param" shorthand a scenario prints a parameter in, and
 * deduplicates: a section that drives one parameter and also moves it names it
 * twice, and the prompt should ask for it once.
 */
function normalizeRequires(raw) {
  const out = [];
  const seen = new Set();

  for (const entry of list(raw)) {
    let node = '';
    let param = '';

    if (typeof entry === 'string') {
      // The last dot, not the first: a node called "Warp.2" is a node an
      // artist can name and "Warp.2.amount" still means its amount.
      const dot = entry.lastIndexOf('.');
      if (dot > 0) {
        node = entry.slice(0, dot);
        param = entry.slice(dot + 1);
      }
    } else if (entry && typeof entry === 'object') {
      node = str(entry.node ?? entry.nodeId);
      param = str(entry.param ?? entry.parameter);
    }

    node = node.trim().slice(0, 60);
    param = param.trim().slice(0, 60);
    if (!node || !param) continue;

    const key = `${node.toLowerCase()}.${param.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ node, param });
    if (out.length >= MANIFEST_LIMITS.requires) break;
  }

  return out;
}

/**
 * One look in the show.
 *
 * Two kinds, and which one this is decides whether it costs a model call:
 *
 *   `brief`  prose. A patch is generated for it and installed as a scene.
 *   `scene`  the name of a scene the artist already has. Used as it is.
 *
 * A look carrying both uses the scene and keeps the brief as a note: an artist
 * who built the look by hand after writing the manifest should not have to
 * delete their own description of it to stop paying to have it rebuilt.
 */
function normalizeLook(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : { brief: str(raw) };

  const name = trimmed(source.name ?? source.title ?? source.id, 80)
    || `Look ${index + 1}`;

  return {
    id: slugId(source.id ?? name, `look-${index + 1}`),
    name,
    brief: trimmed(source.brief ?? source.description ?? source.look, MANIFEST_LIMITS.lookBriefChars),
    scene: trimmed(source.scene, 80),
    mood: trimmed(source.mood, 200),
    intensity: source.intensity === undefined ? null : clamp(num(source.intensity, 0), 0, 1),
    // Audio channels this look should visibly answer. Carried into the patch
    // prompt so the generated graph actually listens, and into the scenario
    // brief so the drives have something to bind to.
    reactsTo: list(source.reactsTo ?? source.reacts).map((c) => trimmed(c, 40)).filter(Boolean).slice(0, 8),
    // Parameters the artist wants to be able to reach while the set runs,
    // in prose. The patch prompt turns these into named nodes.
    drivable: list(source.drivable ?? source.controls).map((c) => trimmed(c, 60)).filter(Boolean).slice(0, 8),
    // Clips from the show folder this look is built around, named the way the
    // artist would say them: a filename, a name without its extension, a
    // folder to take everything out of, or "*" for the lot. Resolved against
    // the folder by ShowFolder.resolveLookMedia() — meaningless, and inert,
    // without one, which is why nothing here tries to validate the strings.
    media: list(source.media ?? source.footage ?? source.clips)
      .map((c) => trimmed(c, 200)).filter(Boolean).slice(0, 16),
    // Parameters the set already addresses by name, when this look was derived
    // from a scenario rather than written for one. See normalizeRequires().
    requires: normalizeRequires(source.requires ?? source.reaches),
    hold: normalizeLength(source.hold ?? source.length ?? source.duration),
    // Passed through to the scenario untouched: a manifest that already knows
    // this look is entered by a cue should not have that guessed at again.
    enter: source.enter === undefined ? null : source.enter,
    next: source.next === undefined ? '' : slugId(source.next, ''),
    notes: trimmed(source.notes, 300),
  };
}

function normalizeSignal(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const signal = {
    name: trimmed(source.name, 40),
    source: pick(str(source.source), ['osc', 'audio', 'clock', 'manual'], 'osc'),
  };
  if (source.address !== undefined) signal.address = trimmed(source.address, 200);
  if (source.channel !== undefined) signal.channel = trimmed(source.channel, 40);
  if (source.inputMin !== undefined) signal.inputMin = num(source.inputMin, 0);
  if (source.inputMax !== undefined) signal.inputMax = num(source.inputMax, 1);
  if (source.smooth !== undefined) signal.smooth = clamp(num(source.smooth, 0), 0, 60);
  if (source.notes !== undefined) signal.notes = trimmed(source.notes, 200);
  return signal;
}

/**
 * Read a manifest into its canonical shape. Never throws, whatever it is given.
 *
 * @param {object|string} raw
 * @returns {object} a manifest
 */
export function normalizeManifest(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  const looks = list(source.looks ?? source.scenes ?? source.sections)
    .slice(0, MANIFEST_LIMITS.looks)
    .map(normalizeLook);

  // Ids are what the scenario's sections and the installed scenes are both
  // named after, so two looks sharing one would have the second section load
  // the first one's patch — silently, and only at showtime.
  const seen = new Set();
  for (const look of looks) {
    let id = look.id;
    for (let n = 2; seen.has(id); n++) id = `${look.id}-${n}`;
    look.id = id;
    seen.add(id);
  }

  const bpm = clamp(num(source.bpm, 120), 20, 400);

  return {
    version: MANIFEST_VERSION,
    name: trimmed(source.show ?? source.name ?? source.title, 120) || 'Untitled show',
    notes: trimmed(source.notes, 500),
    brief: trimmed(source.brief ?? source.description, MANIFEST_LIMITS.briefChars),
    // The look every patch in the show shares. One line, and it is the main
    // thing stopping five separately generated patches from looking like five
    // separate shows.
    palette: trimmed(source.palette ?? source.style, 300),
    bpm,
    beatsPerBar: clamp(Math.round(num(source.beatsPerBar, 4)), 1, 16),
    barsPerPhrase: clamp(Math.round(num(source.barsPerPhrase, 8)), 1, 64),
    pulse: pick(str(source.pulse), PULSE_KINDS, 'metered'),
    looks,
    signals: list(source.signals).slice(0, MANIFEST_LIMITS.signals).map(normalizeSignal),
    cues: list(source.cues)
      .slice(0, MANIFEST_LIMITS.cues)
      .map((cue) => trimmed(typeof cue === 'object' && cue ? cue.name : cue, 40))
      .filter(Boolean),
    // Straight through to the scenario. The manifest is where a house limit
    // belongs — it is the document the artist writes at the desk.
    rules: source.rules && typeof source.rules === 'object' ? source.rules : null,
  };
}

/** Parse manifest text, with an error a person can act on. */
export function parseManifest(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text));
  } catch (error) {
    throw new Error(`That is not valid JSON: ${error.message}`);
  }
  return normalizeManifest(parsed);
}

const at = (where, message) => ({ where, message });

/**
 * What a person should fix before spending a call on this.
 *
 * Errors block the build. Warnings do not: a manifest with warnings still
 * produces a show, and the one thing this pass must not do is refuse to build
 * something the artist could have played.
 *
 * @param {object} [manifest]
 * @param {object} [folder] the show folder, from ShowFolder.indexShowFolder().
 *   With one, a look's `media` is resolved here rather than at build time: a
 *   clip named slightly wrong is a typo to fix at the desk, and finding it out
 *   after six patch calls have been spent is finding it out too late.
 * @returns {{errors: Array<{where: string, message: string}>, warnings: Array, generated: number}}
 */
export function validateManifest(manifest, folder = null) {
  const errors = [];
  const warnings = [];
  const show = normalizeManifest(manifest);

  if (!show.looks.length) {
    errors.push(at('looks', 'A show needs at least one look. Each one is a section of the set.'));
  }

  const ids = new Set(show.looks.map((look) => look.id));
  let generated = 0;

  show.looks.forEach((look, index) => {
    const where = `looks[${index}] "${look.name}"`;

    if (!look.brief && !look.scene) {
      errors.push(at(where, 'Needs either a "brief" describing what it should look like, or a "scene" naming one you already have.'));
    }
    if (look.brief && !look.scene) generated++;

    if (look.brief && look.brief.length < 12 && !look.scene) {
      warnings.push(at(where, 'A brief this short gives the model almost nothing to build from. A sentence beats three words.'));
    }
    if (look.next && !ids.has(look.next)) {
      warnings.push(at(where, `"next" points at "${look.next}", which is not a look in this show. The set will not move on from here by itself.`));
    }
    if (show.pulse === 'free' && look.hold?.bars) {
      warnings.push(at(where, 'This show has no pulse, so a hold in bars is counted against a tempo nobody is playing to. Use seconds.'));
    }

    if (look.media.length && !folder) {
      warnings.push(at(where, `Names ${look.media.length} clip${look.media.length === 1 ? '' : 's'}, but no show folder is open. Open the folder they are in — press "Open folder…" — or this look is built without them.`));
    } else if (look.media.length && folder) {
      const { missing, dropped } = resolveLookMedia(folder, look);
      if (missing.length) {
        warnings.push(at(where, `Nothing in the folder is called ${missing.map((m) => `"${m}"`).join(', ')}. The look is still built, without ${missing.length === 1 ? 'it' : 'them'}.`));
      }
      if (dropped) {
        warnings.push(at(where, `More clips than one look can hold. The first ${MEDIA_LIMITS.perLook} are used and ${dropped} more ${dropped === 1 ? 'is' : 'are'} left out — every clip in a look is decoded on every frame it is up.`));
      }
    }
  });

  const clips = (folder?.media || []).filter((item) => item.kind !== 'audio');
  if (clips.length && !show.looks.some((look) => look.media.length)) {
    // The folder is the only place the artist could have meant this footage to
    // be used, and nothing is using it. Said once, at the show level, rather
    // than once per look.
    warnings.push(at('media', `${clips.length} clip${clips.length === 1 ? '' : 's'} in this folder and no look asks for ${clips.length === 1 ? 'it' : 'any'}. Add "media": ["${clips[0].name}"] to a look to build it on that footage, or "media": ["*"] for all of them.`));
  }

  if (generated > 6) {
    warnings.push(at('looks', `${generated} looks means ${generated} patch-generator calls, one after another. Check your allowance before you start — a build that runs out halfway keeps the patches it already made, but it will not finish the set.`));
  }
  if (!show.cues.length) {
    warnings.push(at('cues', 'No cues, so every change is on the clock or on a condition. Name at least the moments you want to fire yourself — the drop is the usual one.'));
  }
  if (!show.signals.length) {
    warnings.push(at('signals', 'No signals declared. The scenario will be written against audio channels alone; say what your DAW sends and the set can answer it.'));
  }
  if (!show.brief && !show.notes) {
    warnings.push(at('brief', 'No show-level brief. Every look is then generated on its own description alone, which is how a set ends up looking like five unrelated pieces.'));
  }

  return { errors, warnings, generated };
}

/**
 * How the show is described to every call in the build, look-level detail
 * aside. The same text goes to each patch call and to the scenario call, which
 * is most of what makes the looks read as one show.
 */
export function showContext(manifest) {
  const show = normalizeManifest(manifest);
  const lines = [`Show: ${show.name}`];

  if (show.brief) lines.push(`What it is: ${show.brief}`);
  if (show.notes) lines.push(`Notes: ${show.notes}`);
  if (show.palette) lines.push(`The look across the whole show: ${show.palette}`);
  lines.push(
    show.pulse === 'free'
      ? 'This music has no steady pulse — ambient, drone or free playing. Nothing in it is counted in bars.'
      : `Tempo: ${show.bpm} BPM, ${show.beatsPerBar} beats to the bar.`
  );

  if (show.looks.length > 1) {
    lines.push(
      `The set, in order: ${show.looks
        .map((look, index) => `${index + 1}. ${look.name}${look.mood ? ` (${look.mood})` : ''}`)
        .join(' → ')}`
    );
  }

  return lines.join('\n');
}

/**
 * The prompt that builds one look's patch.
 *
 * Everything in here is the difference between a patch that is a nice image
 * and a patch that can be PERFORMED: named nodes a scenario can address by
 * name, parameters with somewhere to travel, and a first frame that is already
 * the look rather than the look at full tilt.
 */
export function lookPrompt(manifest, look, media = []) {
  const show = normalizeManifest(manifest);
  const one = show.looks.find((entry) => entry.id === look?.id) || normalizeLook(look || {}, 0);
  const clips = Array.isArray(media) ? media : [];

  const lines = [
    `${one.brief || one.name}`,
    '',
    showContext(show),
    '',
    `This patch is one look in that show: "${one.name}".`,
  ];

  if (one.mood) lines.push(`Its mood: ${one.mood}.`);
  if (one.intensity !== null) {
    lines.push(
      `It plays at intensity ${one.intensity.toFixed(2)} of 1 — ` +
        `${one.intensity < 0.35 ? 'restrained, with room above it'
          : one.intensity > 0.75 ? 'the loud end of the show'
          : 'the middle of the show, with room in both directions'}.`
    );
  }
  if (one.reactsTo.length) {
    lines.push(`It should visibly answer the music on: ${one.reactsTo.join(', ')}.`);
  }

  // The artist's own footage. Everywhere else in the editor a Texture 2D node
  // is refused in a generated patch, because a model cannot supply the file and
  // a texture node pointing at nothing renders black. Here the file exists and
  // is about to be put on the node, so the refusal does not apply — and the
  // look is not "a patch that could use footage", it is a patch built around
  // this footage, which is why the clips go near the top of the instructions
  // rather than at the end as an option.
  if (clips.length) {
    lines.push(
      '',
      `This look is built on the artist's own media. ${clips.length === 1 ? 'One clip is' : `${clips.length} clips are`} already loaded and waiting on ${clips.length === 1 ? 'a node' : 'nodes'}:`,
      ...clips.map((clip) => `- a Texture2D node named exactly "${mediaSlotName(clip)}" — ${clip.kind === 'video' ? 'moving footage' : 'a still image'}, from ${clip.name}`),
      'Put those nodes in the patch under those exact names, wire each one through, and compose the look around what they carry. Do not add any other Texture2D or TextureCube node: there is no file for it and it would render black.',
      'The footage is the material, not a backdrop — treat it the way the brief describes and let the rest of the graph work on it.'
    );
  }

  lines.push(
    '',
    'It will be performed, not just rendered, so build it to be driven from outside:',
    '- Name every node a performer will reach for, with a name that says what turning it does — the scenario addresses nodes by name, and a name is the only handle it has.',
    one.drivable.length
      ? `- These have to be reachable as single parameters: ${one.drivable.join('; ')}. Give each one its own named node.`
      : one.requires.length
        ? '- Beyond the named parameters below, leave a couple more worth performing.'
        : '- Leave three or four parameters worth performing: something that moves, something that changes the colour, something that changes the density.',
    '- Set each of those to a value with somewhere to travel. A parameter already at its maximum on the first frame is a fader with no throw.',
    '- The first frame must already be this look. It is cut to live, in front of an audience, with no time to warm up.'
  );

  // The set this look is being built INTO, when there already is one. These
  // names are the whole difference between a patch that fits the section and a
  // patch that merely suits it: the drives are already written against them.
  if (one.requires.length) {
    lines.push(
      '',
      'This look goes into a set that already exists, and the set reaches for these by name:',
      ...one.requires.map((entry) => `- a node named exactly "${entry.node}", with a parameter named exactly "${entry.param}"`),
      'Those names are not suggestions. A drive finds its node by name, so a node called something else is a parameter nothing in the set can move.'
    );
  }

  return lines.join('\n');
}

/**
 * The brief the scenario is written from.
 *
 * This is the second half of the pipeline and the part that makes the patches
 * matter: by the time it runs, every generated look is a scene on the rig, so
 * the scenario call is no longer being told "no scenes are loaded, do not
 * invent any". It is told the set, in order, by the names it can actually use.
 *
 * That went one level deeper than it needed to. A scene name is enough to make
 * a section play the right picture, and it is not enough to make the section
 * DO anything: a drive and a param move name a node and a parameter inside
 * that scene, and until the build carried those across, the only thing the
 * model had to write them from was the editor's general vocabulary. It wrote
 * plausible ones — "ComputeGradient.brightness", "ComputeNoise.scale" — and a
 * patch that happened not to contain them turned every drive in the set into a
 * line that warns once on load and then does nothing for the rest of the show.
 * A set whose handles all miss is a still picture, and it fails silently: the
 * scenes load, the sections advance, the log fills, and nothing moves.
 *
 * So each built look now arrives with what its patch actually called the
 * things it left to be turned, and the brief lists them under the scene. The
 * instruction that follows them is the one that matters — these names, or no
 * drive at all.
 *
 * @param {object} manifest
 * @param {Array<{lookId: string, sceneName: string, handles?: object}>} built
 *   what the patch half of the build actually produced — which is not always
 *   every look.
 */
export function scenarioBrief(manifest, built = []) {
  const show = normalizeManifest(manifest);
  const scenes = new Map(built.map((entry) => [entry.lookId, entry.sceneName]));
  const handles = new Map(built.map((entry) => [entry.lookId, entry.handles]));

  const lines = [showContext(show), '', 'Write the set as these sections, in this order:'];
  let anyHandles = false;

  show.looks.forEach((look, index) => {
    const bits = [`${index + 1}. id "${look.id}", name "${look.name}"`];

    const scene = scenes.get(look.id) || look.scene;
    bits.push(scene ? `look: the scene "${scene}"` : 'look: nothing was built for this one — leave its look unset');

    if (look.mood) bits.push(`mood: ${look.mood}`);
    if (look.intensity !== null) bits.push(`intensity ${look.intensity.toFixed(2)}`);
    if (look.hold?.bars) bits.push(`holds at least ${look.hold.bars} bars`);
    if (look.hold?.seconds) bits.push(`holds at least ${look.hold.seconds} seconds`);
    if (look.enter) bits.push(`entered by: ${JSON.stringify(look.enter)}`);
    if (look.next) bits.push(`then "${look.next}"`);
    if (look.reactsTo.length) bits.push(`answers: ${look.reactsTo.join(', ')}`);
    if (look.notes) bits.push(look.notes);

    lines.push(`  ${bits.join('; ')}`);

    // The handles inside that scene. Indented under the section rather than
    // gathered at the end: a drive belongs to one section, and the model has
    // to be able to see which names are in reach from where it is writing.
    const text = handlesText(handles.get(look.id));
    if (text) {
      anyHandles = true;
      lines.push(`    what is in "${scene}", and what each parameter's range is:`);
      lines.push(text.replace(/^ {2}/gm, '      '));
    }
  });

  lines.push(
    '',
    'Use those ids and those scene names exactly. They are the sections of this show and the scenes are already loaded under those names.'
  );

  if (anyHandles) {
    lines.push(
      '',
      'Drive and move ONLY the nodes and parameters listed under each section, spelled exactly as they are listed, and only in the section they are listed under. A drive finds its node by name; a name that is not in that list finds nothing, and a set written out of names that find nothing loads clean, warns once, and then holds one still frame for the length of the show.',
      'Give every section at least one drive on a parameter that changes what is SEEN — brightness, density, scale, amount — mapped across a real part of its range rather than the top of it, and something that moves over the section on its own besides. A section that only holds is a section the audience watches nothing happen in.'
    );
  }

  if (show.cues.length) {
    lines.push(`The musician fires these by hand: ${show.cues.join(', ')}. Write a cue for each.`);
  }
  if (show.signals.length) {
    lines.push(
      `They send: ${show.signals
        .map((signal) => `${signal.name} (${signal.source}${signal.address ? ` ${signal.address}` : ''}${signal.channel ? ` ${signal.channel}` : ''})`)
        .join(', ')}. Declare these as the signals.`
    );
  }
  if (show.pulse === 'free') {
    lines.push('Write the whole thing in seconds: no bars, no phrases, quantize on onset or off.');
  }

  return lines.join('\n');
}

/**
 * A worked example, shown in the panel — a real show, small enough to actually
 * build: three looks, a drop the musician fires, one pulse.
 */
export const EXAMPLE_MANIFEST = Object.freeze({
  version: MANIFEST_VERSION,
  show: 'Example: three-look club set',
  brief: 'A 40-minute support slot. Dark and patient for a long time, one drop I fire by hand, then a long cool-down.',
  palette: 'near-black, cold blue-grey, one white accent that only appears in the drop',
  bpm: 128,
  beatsPerBar: 4,
  barsPerPhrase: 8,
  pulse: 'metered',
  looks: [
    {
      id: 'opening',
      name: 'Opening',
      brief: 'Slow fog drifting across the frame, one cold light source low in the picture, almost black. Nothing sharp.',
      mood: 'patient, cold, barely moving',
      intensity: 0.2,
      reactsTo: ['low'],
      drivable: ['how fast the fog drifts', 'how far the light reaches'],
      hold: { bars: 32 },
      next: 'build',
    },
    {
      id: 'build',
      name: 'Build',
      brief: 'The same fog tightening into vertical structure, contrast climbing, one repeating element that gets closer.',
      mood: 'tightening, still dark',
      intensity: 0.6,
      reactsTo: ['low', 'mid'],
      drivable: ['how tight the structure is', 'contrast', 'how close the repeating element is'],
      hold: { bars: 16 },
      next: 'drop',
    },
    {
      id: 'drop',
      name: 'Drop',
      brief: 'Hard, full frame, white on black, kicking on every hit. The first thing in the set that is actually bright.',
      mood: 'hard, strobing, full frame',
      intensity: 1,
      reactsTo: ['low', 'kickTrig'],
      drivable: ['how hard it kicks', 'how much of the frame it fills'],
      hold: { bars: 32 },
    },
  ],
  signals: [
    { name: 'energy', source: 'osc', address: '/rhizo/perf/energy', smooth: 0.4 },
    { name: 'bass', source: 'audio', channel: 'low', smooth: 0.05 },
  ],
  cues: ['drop', 'blackout'],
  rules: { minSectionBars: 4, allowGraphEdits: false, director: { enabled: true, everyBars: 16, freedom: 0.4 } },
});

export default normalizeManifest;
