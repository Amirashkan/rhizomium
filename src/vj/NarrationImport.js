/**
 * NarrationImport.js — the narrator's words from a show folder, onto the Text
 * nodes of the scenes a playlist plays.
 *
 * A playlist built by hand is a running order of the artist's own scenes, and
 * a scene that carries the narration on screen carries it in a Text node whose
 * string was typed in when the scene was made. When the copy changes — a new
 * episode, a rewritten read — every one of those strings was retyped by hand.
 *
 * This reads the copy out of a folder written by `transmissions`
 * (https://github.com/Amirashkan/transmissions) and writes it into the scenes
 * instead. A folder can be:
 *
 *   - one transmission:   narration.md + manifest.json
 *   - a pool of them:     one sub-folder per transmission, in name order
 *   - an episode:         the same, plus episode.json, which gives the running
 *                         order and the host's opening and sign-off
 *
 * `narration.md` is read first, because it is the file a person edits; the
 * manifest's `copy.narration` is the fallback when it is missing or does not
 * parse.
 *
 * ## Which scene gets which transmission
 *
 * Position: the first playlist row gets the first transmission. When the folder
 * is an episode and the playlist has exactly two rows more than it has
 * transmissions, the first and last rows are the two ends and get the opening
 * and the sign-off.
 *
 * ## Which Text node gets which read
 *
 * A Text node named after a read takes that read — "brief", "vignette",
 * "narration" (both reads), "title", or "opening"/"signoff"/"host" on an end.
 * When a scene names any of its Text nodes that way, only the named ones are
 * touched, so a logo or a credit beside them is left alone. When it names none,
 * one Text node takes the whole narration, and two or more take the brief and
 * the vignette in order.
 *
 * Pure, like ShowImport.js: entries in, a plan out, and applying the plan is a
 * write to `node.params.text` on a scene's saved project data.
 */

/** Line length the narration is wrapped to when the old text gives no hint. */
export const DEFAULT_LINE_LENGTH = 42;

/** Old text with lines shorter than this is a placeholder, not a layout. */
const MIN_LINE_LENGTH = 20;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const obj = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

const loose = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const basename = (path) => String(path || '').split('/').pop() || '';

const directoryOf = (path) => String(path || '').split('/').slice(0, -1).join('/');

const depthOf = (path) => (path ? path.split('/').length : 0);

function parseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readText(file) {
  try {
    return await file.text();
  } catch {
    return null;
  }
}

/**
 * The two reads out of a transmission's `narration.md`.
 *
 * The file is `# Narration — <title>`, an italic note, then one `##` section
 * per read. Sections are told apart by the words in their heading, so a
 * heading reworded by hand ("## Brief") still lands.
 *
 * @returns {{title: string, brief: string, vignette: string}}
 */
export function parseNarrationMarkdown(markdown) {
  const out = { title: '', brief: '', vignette: '' };
  const source = String(markdown || '').replace(/\r\n?/g, '\n');

  const heading = source.match(/^#\s+(.+)$/m);
  if (heading) out.title = heading[1].replace(/^narration\s*[—–:-]\s*/i, '').trim();

  const sections = source.split(/^##\s+/m).slice(1);
  for (const section of sections) {
    const [head, ...body] = section.split('\n');
    const words = head.toLowerCase();
    const read = body.join('\n').trim();
    if (!read) continue;
    if (words.includes('vignette')) out.vignette ||= read;
    else if (words.includes('brief')) out.brief ||= read;
  }
  return out;
}

/**
 * Every transmission's reads, and the episode's two ends, out of a folder.
 *
 * Never throws: a folder with nothing in it is a folder with no cues, and a
 * transmission that cannot be read is named in `problems` and skipped.
 *
 * @param {Array<{path: string, file: {text: () => Promise<string>}}>} entries
 * @returns {Promise<{
 *   cues: Array<{folder: string, title: string, brief: string, vignette: string}>,
 *   opening: string, signoff: string, episode: boolean, problems: string[]
 * }>}
 */
export async function readNarrationFolder(entries) {
  const problems = [];
  const folders = new Map(); // directory -> { narration, manifest }
  let episodeEntry = null;

  for (const entry of Array.isArray(entries) ? entries : []) {
    const name = basename(entry?.path).toLowerCase();
    if (name === 'episode.json') {
      if (!episodeEntry || depthOf(entry.path) < depthOf(episodeEntry.path)) episodeEntry = entry;
      continue;
    }
    if (name !== 'narration.md' && name !== 'manifest.json') continue;
    const dir = directoryOf(entry.path);
    const slot = folders.get(dir) || {};
    slot[name === 'narration.md' ? 'narration' : 'manifest'] = entry;
    folders.set(dir, slot);
  }

  const cues = [];
  for (const [dir, slot] of folders) {
    let title = '';
    let brief = '';
    let vignette = '';

    if (slot.narration) {
      const parsed = parseNarrationMarkdown(await readText(slot.narration.file));
      ({ title, brief, vignette } = parsed);
    }

    if ((!brief || !vignette) && slot.manifest) {
      const data = obj(parseJSON(await readText(slot.manifest.file)));
      const copy = obj(obj(data?.copy)?.narration);
      if (copy) {
        brief ||= text(copy.brief);
        vignette ||= text(copy.vignette);
      }
      title ||= text(data?.title);
    }

    if (!brief && !vignette) {
      // A manifest.json that is not a transmission (a show manifest, a web
      // app's) is not a problem worth naming — only a narration that was there
      // and could not be read is.
      if (slot.narration) problems.push(`${dir || 'the folder'}: narration.md has no readable narration`);
      continue;
    }
    cues.push({ folder: dir, title, brief, vignette });
  }

  let opening = '';
  let signoff = '';
  let order = null;
  if (episodeEntry) {
    const data = obj(parseJSON(await readText(episodeEntry.file)));
    if (data) {
      opening = text(obj(data.opening)?.text);
      signoff = text(obj(data.signoff)?.text);
      if (Array.isArray(data.order)) order = data.order.map(String);
    } else {
      problems.push(`${episodeEntry.path}: could not be read, so the folders are in name order`);
    }
  }

  // Folder names are dated slugs, so name order is the order they were made.
  // An episode's order is editorial and wins where it names a folder.
  cues.sort((a, b) => a.folder.localeCompare(b.folder));
  if (order) {
    const rank = (cue) => {
      const at = order.indexOf(basename(cue.folder));
      return at < 0 ? order.length : at;
    };
    cues.sort((a, b) => rank(a) - rank(b));
  }

  return { cues, opening, signoff, episode: !!episodeEntry, problems };
}

/**
 * Wrap a read to the line length the old text was laid out at.
 *
 * A Text node breaks lines only where the string does, so a fifty-word read
 * dropped in as one line is shrunk to fit the width and comes out unreadable.
 * The paragraphs the read already has are kept.
 */
export function wrapText(value, width = DEFAULT_LINE_LENGTH) {
  const limit = Math.max(MIN_LINE_LENGTH, Math.round(width) || DEFAULT_LINE_LENGTH);
  return String(value || '')
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const lines = [];
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && line.length + 1 + word.length > limit) {
          lines.push(line);
          line = word;
        } else {
          line = line ? `${line} ${word}` : word;
        }
      }
      if (line) lines.push(line);
      return lines.join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Narration is speech, not a formula: braces would be read as a live value and
 * a leading "=" as an expression, so neither survives into the node.
 */
function literal(value) {
  return String(value).replace(/\{/g, '(').replace(/\}/g, ')').replace(/^(\s*)=/, '$1');
}

/** What a Text node's name asks for, or null when it names no read. */
function roleOf(node) {
  const name = loose(node?.name);
  if (!name) return null;
  if (name.includes('vignette')) return 'vignette';
  if (name.includes('brief')) return 'brief';
  if (name.includes('opening') || name.includes('signoff') || name.includes('host')) return 'host';
  if (name.includes('narrat')) return 'narration';
  if (name === 'title') return 'title';
  return null;
}

/**
 * The new string for each Text node in one scene.
 *
 * @param {object} sceneData a scene's saved project (`{nodes: [...]}`)
 * @param {{title?: string, brief?: string, vignette?: string, host?: string}} reads
 * @returns {Array<{nodeId: *, text: string}>}
 */
export function textsForScene(sceneData, reads) {
  const nodes = (Array.isArray(sceneData?.nodes) ? sceneData.nodes : []).filter(
    (node) => node?.kind === 'Text'
  );
  if (!nodes.length) return [];

  const whole = reads.host || [reads.brief, reads.vignette].filter(Boolean).join('\n\n');
  const valueFor = (role) => {
    // An end has one read, and every node named for narration speaks it.
    if (reads.host) return role === 'title' ? '' : reads.host;
    switch (role) {
      case 'brief': return reads.brief || '';
      case 'vignette': return reads.vignette || '';
      case 'title': return reads.title || '';
      default: return whole;
    }
  };

  const named = nodes.filter((node) => roleOf(node));
  let picks;
  if (named.length) {
    picks = named.map((node) => [node, roleOf(node)]);
  } else if (nodes.length === 1 || reads.host) {
    picks = [[nodes[0], 'narration']];
  } else {
    picks = [[nodes[0], 'brief'], [nodes[1], 'vignette']];
  }

  const out = [];
  for (const [node, role] of picks) {
    const value = valueFor(role);
    if (!value) continue;
    const old = String(node.params?.text ?? '');
    const width = Math.max(0, ...old.split('\n').map((line) => line.length));
    const wrapped = role === 'title'
      ? value
      : wrapText(value, width >= MIN_LINE_LENGTH ? width : DEFAULT_LINE_LENGTH);
    out.push({ nodeId: node.id, text: literal(wrapped) });
  }
  return out;
}

/**
 * Pair each playlist row with what it should say.
 *
 * @param {Array<{sceneId: string, sceneName?: string}>} rows the playlist, in order
 * @param {(sceneId: string) => {data: object}|undefined} getScene
 * @param {Awaited<ReturnType<typeof readNarrationFolder>>} folder
 * @returns {{
 *   rows: Array<{index: number, sceneId: string, sceneName: string, source: string,
 *                changes: Array<{nodeId: *, text: string}>, note: string}>,
 *   problems: string[]
 * }}
 */
export function planNarration(rows, getScene, folder) {
  const problems = [...(folder?.problems || [])];
  const cues = folder?.cues || [];
  const playlist = Array.isArray(rows) ? rows : [];

  const reads = cues.map((cue) => ({ source: cue.title || cue.folder || 'transmission', ...cue }));
  if (folder?.episode && playlist.length === cues.length + 2 && (folder.opening || folder.signoff)) {
    reads.unshift({ source: 'opening', host: folder.opening });
    reads.push({ source: 'sign-off', host: folder.signoff });
  }

  if (!cues.length) {
    problems.push('No narration found — pick a transmissions project, episode or projects folder.');
  } else if (reads.length !== playlist.length) {
    problems.push(
      `The playlist has ${playlist.length} scene${playlist.length === 1 ? '' : 's'} and the folder `
      + `${reads.length} narration${reads.length === 1 ? '' : 's'}; they are paired in order and `
      + 'the rest are left as they are.'
    );
  }

  const claimed = new Map(); // sceneId -> first row index that wrote it
  const planned = [];
  playlist.forEach((row, index) => {
    const read = reads[index];
    if (!read) return;
    const scene = getScene(row.sceneId);
    const sceneName = row.sceneName || scene?.name || row.sceneId;
    const entry = { index, sceneId: row.sceneId, sceneName, source: read.source, changes: [], note: '' };

    if (!scene) {
      entry.note = 'scene is missing';
    } else if (claimed.has(row.sceneId)) {
      // One scene queued twice is one project: writing it again would take the
      // first row's words away from it.
      entry.note = `same scene as row ${claimed.get(row.sceneId) + 1}, left with that row's text`;
    } else {
      entry.changes = textsForScene(scene.data, read);
      if (!entry.changes.length) entry.note = 'no Text node to write into';
      claimed.set(row.sceneId, index);
    }
    planned.push(entry);
  });

  return { rows: planned, problems };
}

/**
 * Write one row's plan into a project's nodes — a scene's saved copy, or the
 * editor's live graph. Returns how many Text nodes changed. `onWrite` is
 * called with each node written, for whoever has to re-rasterise it.
 */
export function applySceneTexts(sceneData, changes, onWrite = null) {
  const nodes = Array.isArray(sceneData?.nodes) ? sceneData.nodes : [];
  let written = 0;
  for (const { nodeId, text: value } of changes || []) {
    const node = nodes.find((candidate) => candidate?.id === nodeId && candidate.kind === 'Text');
    if (!node) continue;
    if (!node.params) node.params = {};
    node.params.text = value;
    // Some nodes mirror their parameters in `props`; a stale mirror would
    // bring the old words back on load.
    if (node.props && typeof node.props === 'object') node.props.text = value;
    onWrite?.(node);
    written++;
  }
  return written;
}
