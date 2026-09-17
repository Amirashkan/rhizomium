/**
 * ShowBuilder.js - a manifest in, a performance out.
 *
 * This is the pipeline the manifest exists for. It runs in three passes and
 * the order is the whole design:
 *
 *   1. **Build the looks.** One ai.patch_generator call per look that needs
 *      one, each installed as a scene under the look's name. This is the slow,
 *      expensive half: a call an artist waits on, times however many looks.
 *   2. **Write the set.** One ai.performer_scenario call, told about the
 *      scenes pass 1 just made. This is the call that could not previously be
 *      made usefully on an empty rig — the prompt tells the model not to invent
 *      scene names, so with nothing loaded it writes a set that looks at
 *      nothing.
 *   3. **Bind it.** Reconcile what came back against what was actually built,
 *      by id, then by name, then by position, and set each section's look to
 *      the scene that exists. A section left pointing at a name the model
 *      typed slightly differently is an inert section, and it would be inert
 *      at showtime rather than here.
 *
 * Pass 3 is not a safety net for a bad model. It is the step that makes the
 * difference between generating a document about a show and generating the
 * show: after it, every patch that was built is played by a section, and the
 * scenario's names and the rig's names are the same names.
 *
 * ## Spending someone's allowance
 *
 * Every pass costs. So:
 *
 * - **Nothing already paid for is thrown away.** A look that fails does not
 *   take the looks before it with it; a scenario call that fails does not
 *   discard the patches, it falls back to a scenario written from the manifest
 *   with no model at all. The artist ends up with a playable set either way.
 * - **Out of quota stops the build.** Any other failure is per-look and the
 *   build moves on; a refusal from the gallery means the next call will be
 *   refused too, and spending the rest of a show finding that out twice over
 *   is not diligence.
 * - **The whole thing can be cancelled**, and cancelling between calls is the
 *   only cancellation worth having: a call in flight has already been paid for.
 *
 * ## The artist's own footage
 *
 * A show folder (ShowFolder.js) carries media beside the manifest, and a look
 * that names clips is built on them: the prompt asks for a texture node per
 * clip, attachMedia() below puts the files on the nodes that came back, and the
 * scene is installed carrying them. Everywhere else in the editor a generated
 * patch may not contain a texture node at all, for the good reason that a model
 * cannot supply a file — here the file exists before the call is made, which is
 * the whole difference.
 *
 * ## The set that already exists
 *
 * The same three passes answer the opposite case, and it is the more common
 * one after the first show: the artist has a scenario — written by hand,
 * drafted by the model, opened from someone else's machine — whose every
 * section names a scene that is not on this rig. It loads, it runs, it shows
 * nothing.
 *
 * manifestFromScenario() reads that set and writes the manifest it implies,
 * one look per section that has no look, each carrying the node and parameter
 * names the section's own drives and moves already address. Building it with
 * `{ scenario }` then skips pass 2 — there is nothing to write — and binds the
 * patches into the artist's own set, drives, cues and rules untouched.
 *
 * ## What it does not do
 *
 * It does not touch the editor. `installScene` is injected by whoever has one
 * — the panel hands it ActionExecutor's, which is the one file allowed to —
 * and so is the model. Both of those out, this is a pure function of the
 * manifest, which is why the tests can build a whole show with no GPU, no
 * network and no account.
 */

import {
  normalizeManifest,
  validateManifest,
  showContext,
  lookPrompt,
  scenarioBrief,
  MANIFEST_LIMITS,
  MANIFEST_VERSION,
} from './ShowManifest.js';
import { normalizeScenario, SCENARIO_VERSION } from './Scenario.js';
import { mediaSlotName, mediaSlots, readMediaDataUrl, resolveLookMedia } from './ShowFolder.js';

/** The node kinds a clip can arrive on. */
const TEXTURE_KINDS = new Set(['Texture2D', 'TextureCube']);

/** Compared the way ShowFolder compares a reference: case and punctuation out. */
const loose = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * A refusal from the gallery — the wrong tier, or an allowance that is spent.
 *
 * Checked by name as well as by class so that a GrantError from another copy
 * of the module (a test double, a bundle that split) is still read as one.
 * Getting this wrong in the safe direction costs a call; getting it wrong in
 * the other direction spends a whole show's worth of them on refusals.
 */
export function isQuotaRefusal(error) {
  return Boolean(error) && (error.name === 'GrantError' || error.code === 'quota_exhausted');
}

const message = (error) => String(error?.message || error || 'unknown error');

export class ShowBuilder {
  /**
   * @param {object} deps
   * @param {Function} deps.generatePatch (prompt, {show, look}) => Promise<{patch, title, notes}>
   * @param {Function} deps.installScene (name, patch, meta) => Promise<{id, name}>|{id, name}
   * @param {Function} [deps.authorScenario] (brief, context) => Promise<{scenario, note, warnings}>
   *   Absent, or refused, and the set is written from the manifest instead.
   * @param {Function} [deps.log] (level, message, meta) => void
   */
  constructor(deps = {}) {
    this.generatePatch = deps.generatePatch || null;
    this.installScene = deps.installScene || null;
    this.authorScenario = deps.authorScenario || null;
    this.log = deps.log || (() => {});
    this.building = false;
  }

  /**
   * Build a show.
   *
   * @param {object} manifest
   * @param {object} [options]
   * @param {object} [options.context] the rig, as PerformerPanel.rigContext()
   *   gives it — merged with the scenes this build installs.
   * @param {Function} [options.onProgress] called with every step, so a panel
   *   can say which look is being built rather than spinning for four minutes.
   * @param {Function} [options.shouldStop] () => boolean, checked between calls.
   * @param {boolean} [options.writeScenario] false to build the looks and
   *   write the set from the manifest without a second model call.
   * @param {object} [options.folder] the show folder, from
   *   ShowFolder.indexShowFolder(). With one, a look that names clips is built
   *   with them already on its texture nodes.
   * @param {object} [options.scenario] a set that already exists. Given one,
   *   pass 2 does not run at all — there is nothing to write — and pass 3
   *   binds the looks into it, leaving its drives, moves, cues and rules
   *   exactly as the artist wrote them.
   * @returns {Promise<object>} the report: the scenario, the scenes, and what
   *   went wrong on the way.
   */
  async build(manifest, options = {}) {
    if (this.building) throw new Error('A show is already being built.');

    const show = normalizeManifest(manifest);
    const folder = options.folder || null;
    const report = validateManifest(show, folder);
    if (report.errors.length) {
      throw new Error(
        `This manifest cannot be built yet: ${report.errors[0].where} — ${report.errors[0].message}`
      );
    }
    if (!this.generatePatch) throw new Error('The AI is not available in this build.');

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const shouldStop = typeof options.shouldStop === 'function' ? options.shouldStop : () => false;

    this.building = true;
    try {
      const built = [];
      const problems = [];
      let stopped = '';

      // --- pass 1: the looks ---------------------------------------------
      const needed = show.looks.filter((look) => look.brief && !look.scene);

      // A look that names a scene the artist already has is part of the show
      // without costing anything. It goes into the same list so pass 3 binds
      // it exactly like a generated one.
      for (const look of show.looks) {
        if (look.scene) built.push({ lookId: look.id, sceneName: look.scene, generated: false });
      }

      for (const [index, look] of needed.entries()) {
        if (shouldStop()) { stopped = 'cancelled'; break; }

        onProgress({
          phase: 'look', status: 'start', index, total: needed.length,
          lookId: look.id, name: look.name,
          message: `Building "${look.name}" (${index + 1} of ${needed.length})…`,
        });

        // The artist's own footage for this look, resolved before the call so
        // the prompt can ask for the nodes it is about to arrive on. A clip
        // named in the manifest and missing from the folder is a warning
        // already reported by the check above; the look is still built.
        const { items: clips, missing } = folder
          ? resolveLookMedia(folder, look)
          : { items: [], missing: [] };
        if (missing.length) {
          problems.push({
            where: `look "${look.name}"`,
            message: `no clip in the folder called ${missing.map((one) => `"${one}"`).join(', ')} — built without ${missing.length === 1 ? 'it' : 'them'}`,
          });
        }

        try {
          const generated = await this.generatePatch(lookPrompt(show, look, clips), {
            show: showContext(show),
            look,
            media: mediaSlots(clips),
          });

          const patch = generated?.patch;
          if (!patch || !Array.isArray(patch.nodes) || !patch.nodes.length) {
            throw new Error('the model answered with an empty patch');
          }

          // Put the footage on the nodes the model left for it. This is the
          // step that makes a clip part of the look rather than a file in a
          // folder, and it happens before the scene is installed so that the
          // scene carries its media the way a saved project does.
          const media = await attachMedia(patch, clips);
          for (const note of media.problems) {
            problems.push({ where: `look "${look.name}"`, message: note });
          }

          // The scene is named after the look, not after the title the model
          // chose for its patch: the scenario is about to name it, and it can
          // only name what the manifest said.
          const scene = await this.installScene(look.name, media.patch, {
            notes: generated?.notes || look.mood || look.brief,
            title: generated?.title || look.name,
            lookId: look.id,
            // What the manifest says this look is up for, in seconds. It
            // becomes the scene's own duration and the timeline it carries,
            // so cutting to it sets the transport to the length the set was
            // written to rather than leaving the last look's.
            holdSeconds: holdSecondsOf(look, show),
            // Keyed by node id, exactly as a saved project's textures are:
            // installScene hands it straight to the scene's project data and
            // the ordinary loader puts it back on the GPU.
            textures: media.textures,
          });

          built.push({
            lookId: look.id,
            sceneName: scene?.name || look.name,
            sceneId: scene?.id || null,
            title: generated?.title || look.name,
            notes: generated?.notes || '',
            nodes: patch.nodes.length,
            // What a drive in this look's section can actually reach. The
            // scenario call is about to be told to name only what it was
            // given, and until this was passed the only parameters it had been
            // given were the ones in whatever patch happened to be open — so
            // it named those, and the sections drove a node that is not in the
            // scene they load.
            parameters: patchParameters(media.patch),
            media: media.bound.map((one) => one.path),
            generated: true,
          });

          onProgress({
            phase: 'look', status: 'ok', index, total: needed.length,
            lookId: look.id, name: look.name,
            message: media.bound.length
              ? `"${look.name}" — ${patch.nodes.length} nodes, ${media.bound.length} clip${media.bound.length === 1 ? '' : 's'}.`
              : `"${look.name}" — ${patch.nodes.length} nodes.`,
          });
        } catch (error) {
          problems.push({ where: `look "${look.name}"`, message: message(error) });
          onProgress({
            phase: 'look', status: 'failed', index, total: needed.length,
            lookId: look.id, name: look.name, message: message(error),
          });

          if (isQuotaRefusal(error)) {
            // Nothing after this would get past the gallery either. Stop here
            // and keep everything already built.
            stopped = message(error);
            break;
          }
        }
      }

      // --- pass 2: the set ------------------------------------------------
      //
      // Skipped entirely when the caller already has one. A set built from a
      // scenario that exists is the same three passes with the middle one
      // already done years ago by the artist, and rewriting it would throw
      // away the drives and cues that are the reason they wrote it.
      const into = options.scenario ? normalizeScenario(options.scenario) : null;

      let scenario = null;
      let note = '';
      let wrote = into ? 'given' : 'manifest';

      const wantScenario = options.writeScenario !== false && this.authorScenario
        && !stopped && !into;

      if (wantScenario) {
        onProgress({ phase: 'scenario', status: 'start', message: 'Writing the set…' });
        try {
          const answer = await this.authorScenario(
            scenarioBrief(show, built),
            mergeContext(options.context, show, built)
          );
          scenario = answer?.scenario || null;
          note = String(answer?.note || '');
          if (scenario) wrote = 'model';
          onProgress({ phase: 'scenario', status: 'ok', message: note || 'Set written.' });
        } catch (error) {
          problems.push({ where: 'the set', message: message(error) });
          onProgress({ phase: 'scenario', status: 'failed', message: message(error) });
          // Deliberately not fatal. The patches are built and paid for; an
          // artist who has them should get a set that plays them, even if the
          // set is the plain one the manifest already describes.
        }
      }

      if (into) {
        onProgress({ phase: 'scenario', status: 'skipped', message: 'Keeping the set you already have.' });
      }

      if (!scenario) scenario = into || scenarioFromManifest(show, built);

      // --- pass 3: bind ---------------------------------------------------
      const binding = bindLooks(scenario, show, built);
      scenario = binding.scenario;

      onProgress({
        phase: 'done', status: stopped ? 'failed' : 'ok',
        message: stopped
          ? `Stopped: ${stopped}`
          : `${built.filter((entry) => entry.generated).length} looks built, ${scenario.sections.length} sections.`,
      });

      return {
        scenario,
        manifest: show,
        built,
        note,
        wrote,
        problems,
        stopped,
        warnings: report.warnings,
        bound: binding.bound,
        unbound: binding.unbound,
      };
    } finally {
      this.building = false;
    }
  }
}

/**
 * Put the artist's footage on the nodes the model left for it.
 *
 * The prompt asked for a Texture2D node per clip, named after the clip
 * (`ShowFolder.mediaSlotName`). This is the other end of that contract, and it
 * is written to survive the model getting the names slightly wrong, because a
 * clip that does not land is a black rectangle in the middle of a look that has
 * already been paid for:
 *
 *   1. By name, loosely — "Media - Fog Loop" finds "Media: fog-loop".
 *   2. Whatever is left over, in order, onto whatever texture nodes are left.
 *   3. If there are still nodes with nothing on them, the clips are used again
 *      from the start. A node showing the first clip twice is a look; a node
 *      showing nothing is a hole.
 *
 * The result is the `textures` map a saved project carries — keyed by node id,
 * with the bytes inline — so the scene this becomes is restored by the ordinary
 * loader, on this machine and on the rig's laptop it gets copied to.
 *
 * Pure apart from reading the files, and exported, because the three rules
 * above are the part worth testing on its own.
 *
 * @param {object} patch as the model returned it
 * @param {Array} clips from ShowFolder.resolveLookMedia()
 * @returns {Promise<{patch: object, textures: object, bound: Array, problems: Array<string>}>}
 */
export async function attachMedia(patch, clips = []) {
  const wanted = Array.isArray(clips) ? clips.filter(Boolean) : [];
  if (!wanted.length) return { patch, textures: {}, bound: [], problems: [] };

  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  const slots = nodes
    .map((node, index) => ({ node, index }))
    .filter((entry) => TEXTURE_KINDS.has(entry.node?.kind));

  if (!slots.length) {
    return {
      patch,
      textures: {},
      bound: [],
      problems: [
        `built without a texture node, so ${wanted.length === 1 ? 'the clip was' : `${wanted.length} clips were`} not used. The look is still installed — the footage is not in it.`,
      ],
    };
  }

  const taken = new Set();
  const assigned = new Map(); // slot index in `slots` -> clip

  // 1. by name.
  slots.forEach((entry, position) => {
    const name = loose(entry.node.name);
    if (!name) return;
    const found = wanted.findIndex((clip, i) => {
      if (taken.has(i) || !fits(entry.node, clip)) return false;
      const slot = loose(mediaSlotName(clip));
      const label = loose(clip.label);
      return name === slot || (label && (name === label || name.includes(label)));
    });
    if (found >= 0) {
      taken.add(found);
      assigned.set(position, wanted[found]);
    }
  });

  // 2. and 3. — everything still empty, in order, cycling if it has to.
  let next = 0;
  slots.forEach((entry, position) => {
    if (assigned.has(position)) return;
    const spare = wanted.findIndex((clip, i) => !taken.has(i) && fits(entry.node, clip));
    if (spare >= 0) {
      taken.add(spare);
      assigned.set(position, wanted[spare]);
      return;
    }
    // Nothing spare. Reuse, starting from the first clip that fits this node.
    for (let n = 0; n < wanted.length; n++) {
      const clip = wanted[(next + n) % wanted.length];
      if (fits(entry.node, clip)) {
        next = (next + n + 1) % wanted.length;
        assigned.set(position, clip);
        return;
      }
    }
  });

  const textures = {};
  const bound = [];
  const problems = [];
  const patched = nodes.slice();

  for (const [position, clip] of assigned) {
    const { node, index } = slots[position];
    try {
      const dataUrl = await readMediaDataUrl(clip);
      textures[String(node.id)] = {
        filename: clip.name,
        dataUrl,
        isVideo: clip.kind === 'video',
      };
      // The node's own record of which of the two kinds of file it is holding.
      // Set by the upload everywhere else; without it a clip loads and plays
      // while the panel shows it the controls for a still image.
      patched[index] = {
        ...node,
        name: node.name || mediaSlotName(clip),
        params: { ...(node.params || {}), sourceType: clip.kind === 'video' ? 'video' : 'image' },
      };
      bound.push({ nodeId: String(node.id), path: clip.path, kind: clip.kind });
    } catch (error) {
      // One unreadable clip costs that clip, not the look.
      problems.push(`could not read ${clip.path}: ${message(error)}`);
    }
  }

  const unused = wanted.filter((clip) => !bound.some((one) => one.path === clip.path));
  if (unused.length) {
    problems.push(
      `${unused.map((clip) => clip.name).join(', ')} went unused: the look came back with ${slots.length} texture node${slots.length === 1 ? '' : 's'} for ${wanted.length} clips.`
    );
  }

  return { patch: { ...patch, nodes: patched }, textures, bound, problems };
}

/**
 * The parameters a drive can reach in one built look, as "node.param".
 *
 * Numeric only: a drive writes a float into a uniform, so a select, a colour
 * or a file is not something a signal can move. Capped, because this is
 * prompt text and a forty-node patch has a few hundred of them — the ones
 * worth driving are the ones an artist would reach for first, and a list long
 * enough to bury them is not more useful for being complete.
 */
function patchParameters(patch, limit = 24) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  const out = [];
  for (const node of nodes) {
    const label = String(node?.name || node?.kind || '').trim();
    if (!label) continue;
    for (const [key, value] of Object.entries(node?.params || {})) {
      if (typeof value !== 'number') continue;
      out.push(`${label}.${key}`);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Whether this clip can go on this node.
 *
 * A cube map is six faces of a still image in one file; a video on one is a
 * node that renders nothing and a question nobody can answer from the canvas.
 */
function fits(node, clip) {
  return node?.kind !== 'TextureCube' || clip.kind !== 'video';
}

/**
 * The scenes this build made, added to whatever the rig already had.
 *
 * The scenario call is given the rig so it can name real things. Pass 1's
 * scenes are real — they are installed by the time this runs — but they were
 * not there when the panel read the rig, so without this the model would be
 * told "no scenes are loaded" about the scenes it is being asked to sequence.
 */
function mergeContext(context, show, built) {
  const base = context && typeof context === 'object' ? context : {};
  const existing = Array.isArray(base.scenes) ? base.scenes : [];
  const known = new Set(existing.map((scene) => String(scene?.name)));

  const added = built
    .filter((entry) => entry.generated && !known.has(entry.sceneName))
    .map((entry) => {
      const look = show.looks.find((one) => one.id === entry.lookId);
      return {
        id: entry.sceneId || entry.lookId,
        name: entry.sceneName,
        notes: look?.mood || entry.notes || '',
        // The parameters of THIS scene, so a drive in its section names
        // something the section will actually have loaded. The flat list
        // beside it is the patch that is open in the editor, which during a
        // show build is nobody's section.
        parameters: entry.parameters || [],
      };
    });

  return {
    ...base,
    scenes: [...existing, ...added],
    bpm: base.bpm || show.bpm,
  };
}

/**
 * Make every section play the look that was actually built for it.
 *
 * Matching runs id, then name, then position, and stops at the first that
 * works — three passes because a model given ids and told to use them mostly
 * does, and the failures are not random: it renames "opening" to "intro", or
 * it keeps the names and writes them in the right order. Position is last
 * because it is only trustworthy when the counts line up.
 *
 * A look nothing matched gets a section of its own rather than being dropped.
 * The patch for it exists and has been paid for; a set that does not play it
 * is the one outcome this pipeline is for avoiding.
 *
 * Pure, and exported, because it is the step worth testing on its own.
 *
 * @returns {{scenario: object, bound: Array, unbound: Array<string>}}
 */
export function bindLooks(rawScenario, manifest, built = []) {
  const show = normalizeManifest(manifest);
  const scenario = normalizeScenario(rawScenario);
  const sections = scenario.sections.slice();

  const byId = new Map();
  const byName = new Map();
  sections.forEach((section, index) => {
    if (!byId.has(section.id)) byId.set(section.id, index);
    const name = String(section.name || '').toLowerCase();
    if (name && !byName.has(name)) byName.set(name, index);
  });

  const sameLength = sections.length === show.looks.length;
  const taken = new Set();
  const bound = [];
  const unbound = [];

  for (const entry of built) {
    const look = show.looks.find((one) => one.id === entry.lookId);
    if (!look) continue;

    const lookIndex = show.looks.indexOf(look);
    const candidates = [
      byId.get(look.id),
      byName.get(look.name.toLowerCase()),
      sameLength ? lookIndex : undefined,
    ];

    let index = candidates.find((value) => value !== undefined && !taken.has(value));

    if (index === undefined) {
      // Nothing in the set answers to this look. Insert one, at the place the
      // manifest put it, so the order the artist wrote survives.
      index = Math.min(lookIndex, sections.length);
      sections.splice(index, 0, sectionFromLook(look, show, lookIndex === 0));
      // Every index recorded after this one has moved.
      for (const map of [byId, byName]) {
        for (const [key, value] of map) if (value >= index) map.set(key, value + 1);
      }
      for (const value of [...taken]) {
        if (value >= index) { taken.delete(value); taken.add(value + 1); }
      }
      unbound.push(look.id);
    }

    taken.add(index);
    const section = sections[index];

    // The scene name is the rig's, not the scenario's. A section whose look is
    // a name that is nearly right renders nothing and says nothing.
    sections[index] = {
      ...section,
      id: section.id || look.id,
      look: { kind: 'scene', scene: entry.sceneName },
      // The bed, the same way and for the same reason: the file is a fact
      // about the folder, not a decision for the model. Any audio action
      // already on the section is replaced rather than added to — two beds on
      // one entry is one bed and a decode nobody hears.
      onEnter: look.sound
        ? [soundAction(look), ...section.onEnter.filter((action) => !isSoundAction(action))]
        : section.onEnter,
    };

    bound.push({
      lookId: look.id,
      sectionId: sections[index].id,
      sceneName: entry.sceneName,
      inserted: unbound.includes(look.id),
    });
  }

  return { scenario: { ...scenario, sections }, bound, unbound };
}

/**
 * A look's hold in seconds, whatever unit the manifest wrote it in.
 *
 * Bars are converted against the show's own tempo, which is the only tempo
 * this side of the build knows — the clock at showtime may have been pulled
 * somewhere else by then, and the engine converts again from that when it arms
 * the timeline (PerformerEngine.sectionLengthSeconds). What is written into
 * the scene here is the length the set was designed to, which is the right
 * answer for a scene loaded on its own, outside any performance.
 */
export function holdSecondsOf(look, show) {
  if (look?.hold?.seconds > 0) return look.hold.seconds;
  if (look?.hold?.bars > 0) {
    const bpm = show?.bpm > 0 ? show.bpm : 120;
    const beats = show?.beatsPerBar > 0 ? show.beatsPerBar : 4;
    return Math.round(look.hold.bars * (60 / bpm) * beats * 100) / 100;
  }
  return 0;
}

/** One section, straight off a look, for when nothing wrote one. */
function sectionFromLook(look, show, first) {
  const section = {
    id: look.id,
    name: look.name,
    enter: first ? 'manual' : look.enter || enterFromPrevious(look, show),
    look: look.scene ? { scene: look.scene } : undefined,
    intensity: look.intensity === null ? undefined : look.intensity,
    mood: look.mood || undefined,
    notes: look.notes || undefined,
    next: look.next || undefined,
  };
  if (look.hold) section.hold = look.hold;
  if (look.sound) section.onEnter = [soundAction(look)];
  return section;
}

/**
 * The action that starts a look's own bed.
 *
 * Written here rather than left to whoever writes the scenario, because it is
 * not a decision: the manifest said this look has this sound, the hold was
 * measured from that file, and a set that describes a bed it never plays is
 * the mismatch this whole path exists to close.
 *
 * `quantize: 'off'` on purpose. Everything else a section does on entry can
 * wait for a boundary; the sound cannot, because the boundary it would wait
 * for is measured against the track that has not started.
 */
function soundAction(look) {
  return {
    type: 'audio',
    clip: look.sound,
    transport: 'play',
    quantize: 'off',
    why: `the bed "${look.sound}" belongs to ${look.name}`,
  };
}

/** Is this an `audio` action the builder wrote, rather than the artist? */
const isSoundAction = (action) => action?.type === 'audio';

/**
 * What ends the section before this one.
 *
 * A manifest gives each look a length, and a length is exactly the answer:
 * `enter` in a scenario is the condition that ends the PREVIOUS section, so
 * the previous look's hold is what it should be. Without a length anywhere the
 * honest answer is "manual" — a set that advances on a number nobody chose is
 * worse than one the artist moves along themselves.
 */
function enterFromPrevious(look, show) {
  const index = show.looks.findIndex((one) => one.id === look.id);
  const previous = index > 0 ? show.looks[index - 1] : null;
  if (previous?.hold?.bars) return { bars: previous.hold.bars };
  if (previous?.hold?.seconds) return { seconds: previous.hold.seconds };
  return 'manual';
}

/**
 * A scenario written from the manifest alone, with no model in it.
 *
 * Two jobs. It is what pass 2 falls back to when the scenario call fails after
 * the patches are already built and paid for, and it is the whole of a build
 * run with `writeScenario: false` — which is how an artist with one generator
 * call left in their allowance spends it on a look rather than on prose.
 *
 * It is a plain set: the looks in order, each holding for the length the
 * manifest gave it, each entered by the one before it running out. No drives,
 * because the manifest describes parameters in prose and nothing here knows
 * what the generated patches called their nodes. It plays, and the artist can
 * write the drives in the editor — which is where the panel puts it anyway.
 */
export function scenarioFromManifest(manifest, built = []) {
  const show = normalizeManifest(manifest);
  const scenes = new Map(built.map((entry) => [entry.lookId, entry.sceneName]));

  const free = show.pulse === 'free';

  const sections = show.looks.map((look, index) => {
    const section = sectionFromLook(look, show, index === 0);
    const scene = scenes.get(look.id) || look.scene;
    if (scene) section.look = { scene };
    if (!section.next && index < show.looks.length - 1) section.next = show.looks[index + 1].id;
    if (free) {
      // Nothing lands on a bar line in music that has none, so a change waits
      // for the next thing the musician actually plays.
      section.transition = { type: 'crossfade', duration: 2, quantize: 'onset' };
      // A length written in bars still meant something to whoever wrote it —
      // it is just counted against a tempo nobody is playing to. Converting it
      // with the manifest's own tempo keeps the shape of the set the artist
      // described, in the unit this show can actually be played in.
      if (section.hold?.bars) {
        const barSeconds = (60 / show.bpm) * show.beatsPerBar;
        section.hold = { seconds: Math.round(section.hold.bars * barSeconds) };
      }
    }
    return section;
  });

  // A cue named after a look moves the set to it, which is what an artist
  // means by writing "drop" in the cue list of a show whose third look is the
  // drop. Anything else gets a cue that does nothing until they write it —
  // named, so it is one line to fill in rather than one line to discover.
  const cues = show.cues.map((name) => {
    const target = show.looks.find((look) => look.id === name || look.name.toLowerCase() === name.toLowerCase());
    return target
      ? { name, do: [{ type: 'section', to: target.id }] }
      : { name, do: [{ type: 'log', message: `Cue "${name}" — nothing bound to it yet.` }] };
  });

  return normalizeScenario({
    version: SCENARIO_VERSION,
    name: show.name,
    notes: show.brief || show.notes,
    bpm: show.bpm,
    beatsPerBar: show.beatsPerBar,
    barsPerPhrase: show.barsPerPhrase,
    signals: show.signals,
    sections,
    cues,
    rules: show.rules || {
      minSectionBars: free ? 0 : 4,
      allowGraphEdits: false,
      director: free
        ? { enabled: false, everySeconds: 45, freedom: 0.4 }
        : { enabled: false, everyBars: 16, freedom: 0.4 },
    },
  });
}

// --------------------------------------------------------------------------
// The other direction: a set that exists, and the looks it is missing
// --------------------------------------------------------------------------

/** Every node/parameter pair and signal binding one section addresses. */
function reachesOf(section) {
  const out = [];

  for (const drive of section.drives) {
    out.push({ node: drive.node, param: drive.param, signal: drive.signal });
  }
  for (const action of [...section.onEnter, ...section.onExit]) {
    out.push({ node: action.node, param: action.param, signal: action.signal });
  }
  for (const move of section.moves) {
    for (const action of move.do) {
      out.push({ node: action.node, param: action.param, signal: action.signal });
    }
  }

  return out.filter((entry) => entry.node && entry.param);
}

/**
 * The audio channels a section visibly answers.
 *
 * Taken from the signals its drives are actually bound to rather than from the
 * signal list, because a scenario declares every signal the artist sends and
 * only some of them reach this section. A look told it answers everything
 * answers nothing in particular.
 */
function reactsToOf(reaches, signals) {
  const channels = new Set();
  for (const entry of reaches) {
    const signal = entry.signal ? signals.get(entry.signal) : null;
    if (signal?.source === 'audio' && signal.channel) channels.add(signal.channel);
  }
  return [...channels];
}

/**
 * What to build, in prose, from a section that was written to be played rather
 * than to be described.
 *
 * `mood` and `notes` are the two fields a scenario carries that are already
 * addressed to a reader — the director is shown them and never executes them —
 * so they are the brief when they are there. When they are not, saying so
 * outright beats padding: the show-level brief and the section's own name are
 * then genuinely all there is, and a prompt that pretends otherwise invents
 * the rest.
 */
function briefFromSection(section, sceneName) {
  const said = [section.mood, section.notes].filter(Boolean);

  const called = sceneName && sceneName.toLowerCase() !== section.name.toLowerCase()
    ? `the section "${section.name}", which plays a scene called "${sceneName}"`
    : `the section "${section.name}"`;

  return said.length
    ? `A look for ${called}: ${said.join('. ')}`
    : `A look for ${called}. The set says nothing about it beyond its name, so build what `
      + 'that name and this show ask for.';
}

/**
 * Whether this set is counted in bars.
 *
 * Conservative on purpose. Anything counted in bars anywhere means metered;
 * only a set that counts in seconds and never in bars is called free. A set
 * with nothing timed either way stays metered, because being told a show has
 * no pulse when it has one is the worse of the two errors — it is the line in
 * every patch prompt that says not to build anything that answers a beat.
 */
function pulseOfScenario(scenario) {
  let bars = false;
  let seconds = false;

  for (const section of scenario.sections) {
    if (section.hold.bars || section.enter.kind === 'bars') bars = true;
    if (section.hold.seconds || section.enter.kind === 'seconds') seconds = true;
    for (const move of section.moves) {
      if (move.atBars !== null) bars = true;
      if (move.atSeconds !== null) seconds = true;
    }
  }

  return !bars && seconds ? 'free' : 'metered';
}

/**
 * A manifest for the set that already exists.
 *
 * The inverse of scenarioFromManifest(), and the answer to the case the
 * manifest was written for turned inside out. A manifest is for the artist who
 * has the show in their head and an empty rig. This is for the artist who has
 * the *set* — written by hand, drafted by the model, or opened from someone
 * else's machine — and an empty rig underneath it: every section names a scene
 * that is not there, so the set validates, loads, runs, and shows nothing.
 *
 * Deriving a manifest from it means the whole build pipeline applies unchanged,
 * and the derivation is where the word "suitable" is earned:
 *
 * - The look is named after the scene the section already asks for, so it is
 *   installed under the name the set already uses. Nothing has to be renamed.
 * - The section's drives, moves and enter/exit actions become the look's
 *   `requires`, so the patch is built with the nodes the set already reaches
 *   for, under those names. A beautiful patch whose nodes are called something
 *   else is a section with every fader wired to nothing.
 * - A look already on the rig goes in too, as a `scene`. It costs no call, and
 *   without it every generated look would be told about a show with holes in
 *   it — which is a different show.
 *
 * Pure. It reads a document and writes a document; the panel supplies the rig.
 *
 * @param {object} rawScenario
 * @param {object} [options]
 * @param {Array<string>} [options.sceneNames] scene ids and names on the rig.
 *   Nothing here means nothing is on it — every look is missing.
 * @param {string} [options.brief] what the whole set is, in one line.
 * @param {string} [options.palette] the look across the whole show.
 * @param {'metered'|'free'} [options.pulse] overrides what the set implies.
 * @returns {{manifest: object, missing: Array, satisfied: Array, skipped: Array, deferred: Array}}
 *   `missing` is what a build would spend a call on, in order.
 */
export function manifestFromScenario(rawScenario, options = {}) {
  const scenario = normalizeScenario(rawScenario);

  const have = new Set(
    (Array.isArray(options.sceneNames) ? options.sceneNames : [])
      .map((name) => String(name ?? '').trim().toLowerCase())
      .filter(Boolean)
  );
  const signals = new Map(scenario.signals.map((signal) => [signal.name, signal]));

  const entries = [];
  const skipped = [];
  /** Scene name (lowercased) -> the section already having it built. */
  const claimed = new Map();

  for (const section of scenario.sections) {
    const look = section.look;

    // A section that plays a preset or carries its own patch has a look. It is
    // not missing anything, and there is no scene name to build under.
    if (look.kind === 'preset' || look.kind === 'patch') {
      skipped.push({
        sectionId: section.id,
        name: section.name,
        why: look.kind === 'preset'
          ? `plays the preset "${look.preset}"`
          : 'carries a patch of its own',
      });
      continue;
    }

    const common = {
      id: section.id,
      name: section.name,
      mood: section.mood,
      notes: section.notes,
      intensity: section.intensity === null ? undefined : section.intensity,
      enter: section.enter,
      hold: section.hold.bars ? { bars: section.hold.bars }
        : section.hold.seconds ? { seconds: section.hold.seconds }
        : undefined,
      next: section.next || undefined,
    };

    if (look.kind === 'scene' && have.has(look.scene.toLowerCase())) {
      entries.push({ sectionId: section.id, needs: false, look: { ...common, scene: look.scene } });
      continue;
    }

    // The name the set already uses, so the scene lands under it and the
    // section needs no rewriting at all.
    const sceneName = look.kind === 'scene' ? look.scene : section.name;
    const key = sceneName.toLowerCase();

    // Two sections playing the same absent scene want one look, not two. The
    // second is not skipped so much as already answered: the scene it names is
    // about to exist.
    if (claimed.has(key)) {
      skipped.push({
        sectionId: section.id,
        name: section.name,
        why: `plays "${sceneName}", which is already being built for "${claimed.get(key)}"`,
      });
      continue;
    }
    claimed.set(key, section.name);

    const reaches = reachesOf(section);

    entries.push({
      sectionId: section.id,
      needs: true,
      why: look.kind === 'scene'
        ? `names the scene "${look.scene}", which is not on the rig`
        : 'has no look at all',
      look: {
        ...common,
        name: sceneName,
        brief: briefFromSection(section, sceneName),
        requires: reaches.map((entry) => ({ node: entry.node, param: entry.param })),
        reactsTo: reactsToOf(reaches, signals),
      },
    });
  }

  // A manifest holds MANIFEST_LIMITS.looks looks, and that cap is about not
  // spending an allowance by accident. A look already on the rig spends
  // nothing — it is context — so it is what gets dropped first when a set is
  // longer than a manifest can hold.
  const cap = MANIFEST_LIMITS.looks;
  for (let i = entries.length - 1; i >= 0 && entries.length > cap; i--) {
    if (!entries[i].needs) entries.splice(i, 1);
  }

  // Still over, so there are more looks to build than one build can hold. The
  // rest wait for a second press rather than being dropped quietly: they are
  // still missing when this one finishes, so pressing again picks them up.
  const deferred = [];
  while (entries.length > cap) deferred.unshift(entries.pop());

  const manifest = normalizeManifest({
    version: MANIFEST_VERSION,
    show: scenario.name,
    brief: options.brief || scenario.notes,
    palette: options.palette,
    notes: scenario.notes,
    bpm: scenario.bpm,
    beatsPerBar: scenario.beatsPerBar,
    barsPerPhrase: scenario.barsPerPhrase,
    pulse: options.pulse || pulseOfScenario(scenario),
    looks: entries.map((entry) => entry.look),
    signals: scenario.signals,
    cues: scenario.cues.map((cue) => cue.name),
    rules: scenario.rules,
  });

  // Read the ids back off the normalised manifest rather than assuming they
  // survived: it is the one place that decides what a look is called, and
  // pass 3 matches on exactly that.
  const described = (entry, index) => ({
    lookId: manifest.looks[index]?.id || entry.sectionId,
    sectionId: entry.sectionId,
    name: manifest.looks[index]?.name || entry.look.name,
    why: entry.why || '',
  });

  return {
    manifest,
    missing: entries.map(described).filter((_, i) => entries[i].needs),
    satisfied: entries.map(described).filter((_, i) => !entries[i].needs),
    skipped,
    deferred: deferred.map((entry) => ({
      sectionId: entry.sectionId,
      name: entry.look.name,
      why: entry.why || '',
    })),
  };
}

export default ShowBuilder;
