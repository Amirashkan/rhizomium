/**
 * ShowImport.js — a show read out of a folder some other tool wrote.
 *
 * ShowFolder.js says which files in a directory are the manifest and which are
 * media. It says it from the names alone, which is all a directory listing can
 * tell you, and that leaves one thing undecided: whether the `manifest.json` it
 * found is a show at all. Plenty of them are not. A project folder written by a
 * generator, a web app's manifest, somebody's build output — they are all
 * called manifest.json and none of them describes a set.
 *
 * Loading one of those as a show is not a small mistake. `normalizeManifest()`
 * coerces anything into a manifest shape, so a foreign document does not fail
 * to load: it loads as a show with no looks in it, and the artist is handed a
 * wall of validation errors about a document they never wrote. That is the
 * case this file exists to stop.
 *
 * It does two things:
 *
 *   1. Reads the manifests a folder holds and says what each one IS —
 *      a show, a transmission, or something else that is left alone.
 *   2. Turns the ones it recognises into a show manifest, so a folder of
 *      generated material arrives in the Show tab as a set to edit rather
 *      than as an error.
 *
 * ## Transmissions
 *
 * The one foreign format it reads is a project folder from `transmissions`
 * (https://github.com/Amirashkan/transmissions), which writes one directory per
 * piece — a title, a factual brief, prompts for the image, the video, the bed
 * and the atmosphere under it, how hard the piece hits in a set, its palette,
 * its key, and the files that were actually generated:
 *
 *     2026-09-14-lattice-that-remembers/
 *       manifest.json        <- everything below is read out of this
 *       media/
 *         image.png          <- a look's footage
 *         video.mp4
 *         music.mp3          <- the bed: played under the look it belongs to
 *         narration.mp3         named in the notes, for the artist to fire
 *
 * One project is one look. What crosses over is what a patch can be built
 * from — the video and image prompts become the look's brief, the palette and
 * texture become the show's own look, the energy becomes an intensity, and the
 * clips become the look's `media`, which is what puts the artist's own footage
 * on a texture node instead of leaving the model to draw everything from
 * nothing.
 *
 * The bed crosses over too, as the look's `sound`. It is the piece the hold was
 * measured from, so a section and the track under it are the same length by
 * construction, and the level and low the look answers are that track's rather
 * than an empty room's. The narration is left named in the notes: there is one
 * element behind the analysis, and a voice over the bed is a mix the artist
 * makes in their own software, not something to be chosen for them here.
 *
 * What does not cross over is the copy. The brief is the news and the vignette
 * is fiction about a person in a room; neither describes an image, and a patch
 * prompt fed either of them builds an illustration of a story. The prompts in
 * the manifest were written for exactly this and say so: abstract material,
 * no objects, no figures, no text.
 *
 * Pure, like ShowManifest.js: documents in, one document out. The reading of
 * files is the last twenty lines and nothing else in here knows what a File is.
 */

import {
  MANIFEST_LIMITS,
  MANIFEST_VERSION,
  normalizeManifest,
  slugId,
} from './ShowManifest.js';

/** How many manifests are read out of one folder before it stops looking. */
export const MAX_MANIFESTS_READ = 24;

/**
 * Lengths, from the exporter on the other side of this handoff
 * (transmissions/rhizomium.py). Kept the same on purpose: an artist who
 * exported a scenario from that tool and an artist who opened the folder here
 * should get sections of the same length out of the same material.
 */
const MIN_HOLD_SECONDS = 30;
const NARRATION_AIR_SECONDS = 8;
const WORDS_PER_SECOND = 2.5;

/** The tempo a set falls back to when no bed in it stated one. */
const FALLBACK_BPM = 120;

/** Asset kinds that are a look's footage. The rest are sound, or a preview. */
const CLIP_KINDS = Object.freeze(['video', 'image']);

/** Asset kinds worth naming in a look's notes: what plays, and is not played here. */
const SOUND_KINDS = Object.freeze(['music', 'sfx', 'voiceover']);

const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

const list = (value) => (Array.isArray(value) ? value : []);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const int = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

/** The directory a file sits in, as a path from the top of the show folder. */
const directoryOf = (path) => String(path || '').split('/').slice(0, -1).join('/');

/**
 * What kind of document this is.
 *
 * `show` is deliberately the loosest of the three: anything carrying a list of
 * looks, scenes or sections is a show manifest — including an empty one, which
 * is a show the artist has started rather than a document to refuse. Everything
 * that is neither that nor a transmission is `unknown`, and unknown means left
 * alone rather than coerced.
 *
 * @returns {'show'|'transmission'|'unknown'}
 */
export function manifestKind(data) {
  const source = obj(data);
  if (!source) return 'unknown';

  if (Array.isArray(source.looks) || Array.isArray(source.scenes) || Array.isArray(source.sections)) {
    return 'show';
  }
  // A transmission names its own format version and carries at least one of the
  // two blocks a look is built out of. Both tests, because `manifest_version`
  // on its own is a field any tool might write.
  if (source.manifest_version !== undefined && (obj(source.media_briefs) || obj(source.performance))) {
    return 'transmission';
  }
  return 'unknown';
}

/**
 * The clips and sound files one transmission actually produced.
 *
 * `path` in a transmission's manifest is a bare filename inside that project's
 * own `media/`, so it is rebuilt here as a path from the top of the folder the
 * artist opened — which is what a look's `media` list is resolved against, and
 * what makes the same manifest work whether they picked the project folder or
 * the directory of projects above it.
 */
function assetsOf(data, base) {
  const under = base ? `${base}/media` : 'media';
  const out = {};

  for (const raw of list(data?.assets)) {
    const asset = obj(raw);
    if (!asset || asset.status !== 'ok') continue;

    const kind = text(asset.kind);
    const name = text(asset.path);
    // One file per kind: a manifest re-run in place lists the newest last, and
    // the newest is the one on disk.
    if (kind && name) out[kind] = `${under}/${name}`;
  }

  return out;
}

/**
 * How long a transmission holds.
 *
 * The bed's own length, never under half a minute, and always long enough for
 * the narration to finish speaking with air after it. Every bed and clip in a
 * transmission loops, so a hold that is too long costs nothing but attention —
 * which is a decision to revise in the panel, against the room.
 */
function holdOf(data) {
  const music = obj(data?.media_briefs)?.music || {};
  const narration = text(obj(data?.copy)?.narration);

  const words = narration ? narration.split(/\s+/).filter(Boolean).length : 0;
  const spoken = words ? Math.round(words / WORDS_PER_SECOND) + NARRATION_AIR_SECONDS : 0;

  return { seconds: clamp(Math.max(MIN_HOLD_SECONDS, int(music.duration_seconds, 0), spoken), 1, 3600) };
}

/**
 * The prose a patch is generated from.
 *
 * The video prompt first and the image prompt behind it, because a look is a
 * moving picture and the video brief is the one written as one. The texture
 * line goes on the end: it is the one field that says what the abstraction is
 * physically made of, which is the difference between a patch that looks like
 * the piece and a patch that merely shares its colours.
 */
function briefOf(data) {
  const briefs = obj(data?.media_briefs) || {};
  const show = obj(data?.performance) || {};

  const prompt = text(obj(briefs.video)?.prompt) || text(obj(briefs.image)?.prompt);
  const texture = text(show.texture);

  const parts = [];
  // A prompt is written as a fragment and rarely ends in a full stop, so the
  // two would otherwise run into each other as one unreadable sentence.
  if (prompt) parts.push(/[.!?]$/.test(prompt) ? prompt : `${prompt}.`);
  // Unless the prompt already said it. The two fields are written by the same
  // model in the same pass and they often agree word for word, and a brief that
  // says the same thing twice reads as emphasis to whoever builds the patch.
  const said = prompt.toLowerCase().includes(texture.toLowerCase().replace(/\.$/, ''));
  if (texture && !said) parts.push(`Made of ${texture.replace(/\.$/, '')}.`);

  // Nothing but a title is still a look worth building — it just costs the
  // artist a sentence of their own before they press Build.
  return parts.join(' ') || text(data?.title);
}

/** The panel's line on a look: its key, how it arrives, and where its sound is. */
function notesOf(data, assets) {
  const show = obj(data?.performance) || {};
  const lines = [];

  if (text(show.key)) lines.push(`Key: ${text(show.key)}`);
  if (text(show.transition_in)) lines.push(`In: ${text(show.transition_in)}`);

  // Every sound file the piece produced, named. The bed is also the look's
  // `sound` and is played under it; the rest are named here because they are
  // the artist's to place — a narration is a mix decision, not a second bed.
  const sound = SOUND_KINDS.filter((kind) => assets[kind]).map((kind) => `${kind}: ${assets[kind]}`);
  if (sound.length) lines.push(...sound);

  return lines.join('; ');
}

/**
 * One transmission, as a look in a show.
 *
 * @param {object} data the transmission's manifest, parsed.
 * @param {object} [options]
 * @param {string} [options.path] where its manifest sits in the show folder,
 *   which is what the clip paths are built from.
 * @param {number} [options.index] its place in the folder, for the fallback id.
 * @returns {object} a look, unnormalised — normalizeManifest() has the last word.
 */
export function lookFromTransmission(data, options = {}) {
  const source = obj(data) || {};
  const base = directoryOf(options.path);
  const briefs = obj(source.media_briefs) || {};
  const show = obj(source.performance) || {};
  const music = obj(briefs.music) || {};

  const assets = assetsOf(source, base);
  const name = text(source.title) || base.split('/').pop() || `Transmission ${(options.index || 0) + 1}`;

  // 1-5 in the manifest, 0-1 in a show. The ends are the ends: a transmission
  // written to open a set at energy 1 is a look with room above it.
  const energy = clamp(int(show.energy, 3), 1, 5);

  return {
    id: slugId(source.slug || base.split('/').pop() || name, `transmission-${(options.index || 0) + 1}`),
    name,
    brief: briefOf(source),
    mood: [text(music.mood), text(show.texture)].filter(Boolean).join(', '),
    intensity: Math.round(((energy - 1) / 4) * 100) / 100,
    media: CLIP_KINDS.filter((kind) => assets[kind]).map((kind) => assets[kind]),
    // The bed, which is also what holdOf() measured this look's length from.
    sound: assets.music || '',
    // These beds are ambient and the level is the one channel all of them move.
    // A look that answers nothing is a still image with a fader wired to it.
    reactsTo: ['level', 'low'],
    hold: holdOf(source),
    notes: notesOf(source, assets),
  };
}

/**
 * What a set of transmissions listens to.
 *
 * The same four the exporter on the other side declares, and for the same
 * reason: the three audio taps cost the musician no wiring at all, and the one
 * thing they have to send is named `push` rather than `energy` because `energy`
 * is a clock built-in that a declared signal would shadow.
 */
function transmissionSignals() {
  return [
    { name: 'level', source: 'audio', channel: 'level', smooth: 0.2 },
    { name: 'low', source: 'audio', channel: 'low', smooth: 0.05 },
    { name: 'high', source: 'audio', channel: 'high', smooth: 0.08 },
    { name: 'push', source: 'osc', address: '/rhizo/perf/energy', smooth: 0.4 },
  ];
}

/** The colours the whole set is in, taken from every piece and said once. */
function paletteOf(projects) {
  const seen = new Set();
  const colours = [];

  for (const { data } of projects) {
    for (const raw of list(obj(data)?.performance?.palette)) {
      const colour = text(raw).slice(0, 40);
      const key = colour.toLowerCase();
      if (!colour || seen.has(key)) continue;
      seen.add(key);
      colours.push(colour);
    }
  }

  return colours.slice(0, 8).join(', ');
}

/**
 * One tempo for the whole set: the median of the beds that stated one.
 *
 * A median rather than an average, because an average is pulled around by a
 * single fast bed in a set of drones. It matters less than it looks — the set
 * is written in seconds — but the clock has to start somewhere.
 */
function bpmOf(projects) {
  const stated = projects
    .map(({ data }) => int(obj(data)?.media_briefs?.music?.bpm, 0))
    .filter((bpm) => bpm > 0)
    .sort((a, b) => a - b);

  return stated.length ? stated[Math.floor(stated.length / 2)] : FALLBACK_BPM;
}

/**
 * A show manifest for a folder of transmissions.
 *
 * @param {Array<{path: string, data: object}>} entries the manifests, as read.
 * @param {object} [options]
 * @param {string} [options.name] what the folder is called.
 * @returns {{manifest: object, problems: Array, projects: Array}} `problems`
 *   is what to say at the desk — currently only that a folder held more
 *   transmissions than one build can hold.
 */
export function manifestFromTransmissions(entries, options = {}) {
  const projects = list(entries)
    .map((entry) => ({ path: String(entry?.path || ''), data: obj(entry?.data) }))
    .filter((entry) => entry.data)
    .sort((a, b) => a.path.localeCompare(b.path));

  const problems = [];
  const kept = projects.slice(0, MANIFEST_LIMITS.looks);
  const dropped = projects.length - kept.length;

  if (dropped > 0) {
    problems.push({
      where: 'the folder',
      level: 'warn',
      message: `${projects.length} transmissions here and a show holds ${MANIFEST_LIMITS.looks}. `
        + `The first ${MANIFEST_LIMITS.looks} are in the manifest — every look is a patch call, so the rest `
        + 'are better as a second show than as a build that runs out halfway.',
    });
  }

  const looks = kept.map((entry, index) =>
    lookFromTransmission(entry.data, { path: entry.path, index }));

  // Two pieces that slug to the same id are still two pieces, and the second
  // one silently inheriting the first's scene is a mystery at showtime. Done
  // here rather than left to normalizeManifest(), which would suffix the id
  // after `next` and the cues had already been written against it.
  const seen = new Set();
  for (const look of looks) {
    let id = look.id;
    for (let n = 2; seen.has(id); n++) id = `${look.id}-${n}`;
    look.id = id;
    seen.add(id);
  }

  // Round-robin, the way the exporter writes it: the last look hands back to
  // the first, so a set that outlasts its material loops instead of sitting on
  // the last piece. A show of one look is left alone — a section pointing at
  // itself is a section that re-enters itself every time its hold is up.
  if (looks.length > 1) {
    looks.forEach((look, index) => {
      look.next = looks[(index + 1) % looks.length].id;
    });
  }

  const titles = looks.map((look) => look.name).join(' → ');
  const one = looks.length === 1;

  const manifest = normalizeManifest({
    version: MANIFEST_VERSION,
    show: text(options.name) || (one ? looks[0].name : 'Transmissions'),
    brief:
      `${looks.length} transmission${one ? '' : 's'}, played in order: ${titles}. `
      + 'Every look is abstract material — grain, fibre, fluid, frost, interference, caustics, '
      + 'dust in a beam — carrying the atmosphere of its piece and nothing of its subject: no '
      + 'figures, no objects, no architecture, no text. Dark ground, clear contrast, built to '
      + 'hold when it is projected large.',
    palette: paletteOf(kept),
    bpm: bpmOf(kept),
    // These beds are ambient and most have no usable pulse, so the set is
    // written in seconds and nothing in it is counted in bars. A tempo detector
    // asked for a BPM on a drone will always find one and always be wrong.
    pulse: 'free',
    looks,
    signals: transmissionSignals(),
    // One per piece, so every transmission can be reached by hand mid-set
    // rather than waited for.
    cues: looks.map((look) => look.id).slice(0, MANIFEST_LIMITS.cues),
    notes: `Read from ${projects.length} transmission project folder${projects.length === 1 ? '' : 's'}. `
      + 'The briefs are the prompts each piece was generated from — edit them before building, '
      + 'they are what each patch is made of.',
  });

  return { manifest, problems, projects: kept };
}

/* -------------------------------------------------------------------------
 * Reading the folder.
 *
 * The only part that touches a File. Everything above is documents.
 * ---------------------------------------------------------------------- */

const parse = (raw) => {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
};

/**
 * Read a folder's manifests and say what show, if any, is in it.
 *
 * Never throws. A file that cannot be read, a manifest that is not JSON and a
 * folder full of somebody else's documents are all things to say at the desk,
 * not things to fail on.
 *
 * @param {object} folder from ShowFolder.indexShowFolder().
 * @returns {Promise<{
 *   kind: 'show'|'transmissions'|'none',
 *   text: string, manifest: object|null, path: string,
 *   projects: Array, problems: Array<{where: string, level: string, message: string}>
 * }>} `text` is what belongs in the editor: a show manifest's own bytes,
 *   unchanged, or the manifest written for a folder of transmissions.
 */
export async function readFolderShow(folder) {
  const candidates = list(folder?.manifests).slice(0, MAX_MANIFESTS_READ);
  const problems = [];
  const none = { kind: 'none', text: '', manifest: null, path: '', projects: [], problems };

  if (!candidates.length) return none;

  const shows = [];
  const transmissions = [];
  const foreign = [];

  for (const candidate of candidates) {
    let raw;
    try {
      raw = await candidate.file.text();
    } catch (error) {
      problems.push({
        where: candidate.path,
        level: 'warn',
        message: `could not be read: ${error?.message || error}`,
      });
      continue;
    }

    const data = parse(raw);
    if (!data) {
      problems.push({
        where: candidate.path,
        level: 'warn',
        message: 'is not valid JSON, so it was left alone.',
      });
      continue;
    }

    const kind = manifestKind(data);
    if (kind === 'show') shows.push({ path: candidate.path, raw });
    else if (kind === 'transmission') transmissions.push({ path: candidate.path, data });
    else foreign.push(candidate.path);
  }

  // A show manifest wins over everything else in the folder. It is the document
  // the artist wrote for this set, and its own bytes go into the editor —
  // unchanged, so that Save… puts back what was opened.
  if (shows.length) {
    const ignored = [
      ...shows.slice(1).map((entry) => entry.path),
      ...transmissions.map((entry) => entry.path),
      ...foreign,
    ];
    if (ignored.length) {
      problems.push({
        where: 'the folder',
        level: 'note',
        message: `More than one manifest here. Using "${shows[0].path}"; ignoring ${ignored.join(', ')}.`,
      });
    }
    return {
      kind: 'show',
      text: shows[0].raw,
      manifest: null,
      path: shows[0].path,
      projects: [],
      problems,
    };
  }

  if (transmissions.length) {
    const built = manifestFromTransmissions(transmissions, { name: folder?.name });
    problems.push(...built.problems);
    return {
      kind: 'transmissions',
      text: `${JSON.stringify(built.manifest, null, 2)}\n`,
      manifest: built.manifest,
      path: transmissions[0].path,
      projects: built.projects,
      problems,
    };
  }

  if (foreign.length) {
    // The case this file was written for. Left in the folder rather than loaded
    // as a show with no looks in it, which is a page of errors about a document
    // the artist never wrote.
    problems.push({
      where: 'the folder',
      level: 'warn',
      message: `"${foreign[0]}" is not a show: it has no looks in it, so nothing was opened from it. `
        + 'Press Example for the shape of one, or open the folder your .rzshow.json is in.',
    });
  }

  return none;
}

export default readFolderShow;
