// mediaRefs.js — a project's media by path in the files it is saved to.
//
// The editor keeps a project's media inline: textures as data: URLs (or a File,
// for a video too big to inline), the Audio Sampler's clip and the Text node's
// font as data: URLs on node params, the VJ audio tab's tracks as Blobs. That
// stays as it is, because publishing, the web viewer, VJ scenes, collaboration
// and the AI all need the bytes.
//
// What changes is the file. On the desktop the project file, the autosave
// snapshot and the backups name each piece of media by the path it came from
// (mediaPaths.js knows it) instead of carrying it, and reading the file back
// reads those paths again. A piece of media with no known path — an installed
// system font, a performer show folder, anything from before this — stays
// inline, so nothing is ever dropped for want of a path.
//
// The reference is `{ path, name, mime }` and goes where the bytes went:
//
//   textures[nodeId]   { filename, width, height, isVideo, dataUrl: null, ref }
//   node params        `audioData` / `fontData` emptied, with the reference in
//                      a top-level `mediaParams: [{ nodeId, param, ref }]`
//   vjSet.audio[i]     { name, type, ref }
//   vjSet scenes       each scene's data, the same way
//
// Both directions are pure functions of their input plus the path registry, so
// the save and load code in SaveLoadManager stays a call each.

import { basename, fileToDataUrl, mimeForName, pathFor, rememberPath } from './mediaPaths.js';

/** Node params that hold media as a data: URL. */
export const MEDIA_PARAMS = ['audioData', 'fontData'];

function refFor(path, fallbackName = '') {
  const name = basename(path) || fallbackName;
  return { path, name, mime: mimeForName(name) };
}

function isBlob(value) {
  return typeof Blob === 'function' && value instanceof Blob;
}

function isRef(ref) {
  return !!ref && typeof ref === 'object' && typeof ref.path === 'string' && ref.path.length > 0;
}

/** The scene list inside a VJ set, whichever shape it was saved in. */
function sceneList(vjSet) {
  const scenes = vjSet?.scenes;
  if (Array.isArray(scenes)) return scenes;
  if (Array.isArray(scenes?.scenes)) return scenes.scenes;
  return null;
}

function withSceneList(vjSet, list) {
  if (Array.isArray(vjSet.scenes)) return { ...vjSet, scenes: list };
  return { ...vjSet, scenes: { ...vjSet.scenes, scenes: list } };
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/**
 * A copy of `projectData` with every piece of media that has a known path
 * replaced by a reference to it. `projectData` itself is not touched — the VJ
 * set in it is the live scene list.
 *
 * @param {object} projectData an export from SaveLoadManager.exportProject()
 * @param {object} [context]
 * @param {Map<string, object>} [context.textures] the live texture manager's
 *        entries, for the File behind a video too large to have a data: URL
 * @param {Array<object>} [context.missing] media the open project names but
 *        could not find (see internalizeMedia). Written back as it was, so
 *        saving before relinking never costs the reference.
 * @returns {object}
 */
export function externalizeMedia(projectData, context = {}) {
  if (!projectData || typeof projectData !== 'object') return projectData;
  const missing = Array.isArray(context.missing) ? context.missing : [];
  const out = externalizeGraph(projectData, { textures: context.textures, missing });

  if (out.vjSet && typeof out.vjSet === 'object') {
    let vjSet = out.vjSet;
    const scenes = sceneList(vjSet);
    if (scenes) {
      vjSet = withSceneList(vjSet, scenes.map((scene) =>
        scene?.data && typeof scene.data === 'object'
          ? { ...scene, data: externalizeGraph(scene.data, {}) }
          : scene));
    }
    const lostTracks = missing.filter((item) => item.kind === 'audio').map((item) => item.entry);
    if (lostTracks.length) {
      vjSet = { ...vjSet, audio: [...(Array.isArray(vjSet.audio) ? vjSet.audio : []), ...lostTracks] };
    }
    out.vjSet = vjSet;
  }

  return out;
}

function externalizeGraph(data, { textures = null, missing = [] }) {
  const out = { ...data };
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const nodeIds = new Set(nodes.map((node) => String(node?.id)));

  // Textures
  if (data.textures && typeof data.textures === 'object') {
    const saved = {};
    for (const [nodeId, entry] of Object.entries(data.textures)) {
      if (!entry || typeof entry !== 'object') {
        saved[nodeId] = entry;
        continue;
      }
      // A File rides along on a scene's video (see internalizeGraph) and has
      // no business in a file: JSON would write it as {}.
      const { file, ...rest } = entry;
      const live = textures?.get?.(nodeId) ?? textures?.get?.(Number(nodeId));
      const path = pathFor(live?.file) || pathFor(file) || pathFor(entry.dataUrl);
      saved[nodeId] = path
        ? { ...rest, dataUrl: null, ref: refFor(path, entry.filename) }
        : rest;
    }
    out.textures = saved;
  }
  for (const item of missing) {
    if (item.kind !== 'texture' || !nodeIds.has(String(item.nodeId))) continue;
    if (out.textures?.[item.nodeId]) continue; // replaced since: the new media wins
    out.textures = { ...(out.textures || {}), [item.nodeId]: item.entry };
  }

  // Media held on node params
  const mediaParams = [];
  const lostParams = new Map(missing
    .filter((item) => item.kind === 'param')
    .map((item) => [`${item.nodeId}:${item.param}`, item]));

  out.nodes = nodes.map((node) => {
    const params = node?.params;
    if (!params || typeof params !== 'object') return node;
    let nextParams = null;
    for (const param of MEDIA_PARAMS) {
      const value = params[param];
      if (typeof value === 'string' && value.startsWith('data:')) {
        const path = pathFor(value);
        if (!path) continue;
        nextParams = nextParams || { ...params };
        nextParams[param] = '';
        mediaParams.push({ nodeId: node.id, param, ref: refFor(path) });
      } else if (!value) {
        const lost = lostParams.get(`${node.id}:${param}`);
        if (lost) mediaParams.push({ nodeId: node.id, param, ref: lost.ref });
      }
    }
    return nextParams ? { ...node, params: nextParams } : node;
  });

  // References this data already carried and could not resolve on the way in
  // (a scene whose files are missing) are kept as they came.
  for (const entry of Array.isArray(data.mediaParams) ? data.mediaParams : []) {
    if (!mediaParams.some((other) => other.nodeId === entry?.nodeId && other.param === entry?.param)) {
      mediaParams.push(entry);
    }
  }

  if (mediaParams.length) out.mediaParams = mediaParams;
  else delete out.mediaParams;
  return out;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Read every referenced file back in, putting the project in the inline shape
 * the rest of the load path has always taken. Paths are read in parallel; one
 * that cannot be read costs only itself.
 *
 * Whatever is resolved is registered with its path, so the next save writes
 * the same reference rather than the bytes.
 *
 * @param {object} projectData a migrated project
 * @param {object} options
 * @param {(path: string) => Promise<File>} options.read reads a path
 * @param {boolean} [options.includeVJSet] resolve the VJ set's scenes and tracks too
 * @returns {Promise<{data: object, missing: object[]}>} `missing` lists the
 *          references in the open graph and the audio tab that did not resolve
 */
export async function internalizeMedia(projectData, { read, includeVJSet = false } = {}) {
  if (!projectData || typeof projectData !== 'object' || !hasRefs(projectData, includeVJSet)) {
    return { data: projectData, missing: [] };
  }

  const missing = [];
  const data = await internalizeGraph(projectData, read, missing);

  if (includeVJSet && data.vjSet && typeof data.vjSet === 'object') {
    let vjSet = data.vjSet;
    const scenes = sceneList(vjSet);
    if (scenes) {
      // A scene's missing media is not the open graph's: the scene keeps its
      // references and gets another chance when it is switched to.
      const resolved = await Promise.all(scenes.map(async (scene) =>
        scene?.data && typeof scene.data === 'object' && hasRefs(scene.data, false)
          ? { ...scene, data: await internalizeGraph(scene.data, read, []) }
          : scene));
      vjSet = withSceneList(vjSet, resolved);
    }
    if (Array.isArray(vjSet.audio)) {
      const tracks = await Promise.all(vjSet.audio.map(async (entry) => {
        if (!isRef(entry?.ref) || typeof entry.data === 'string') return entry;
        try {
          const file = await read(entry.ref.path);
          return { name: entry.name, type: entry.type || file.type, file };
        } catch (error) {
          missing.push({ kind: 'audio', ref: entry.ref, entry, error });
          return null;
        }
      }));
      vjSet = { ...vjSet, audio: tracks.filter(Boolean) };
    }
    data.vjSet = vjSet;
  }

  return { data, missing };
}

/** Does this project name any media by path? Most never will, and skip the walk. */
function hasRefs(data, includeVJSet) {
  if (Array.isArray(data.mediaParams) && data.mediaParams.length) return true;
  if (data.textures && Object.values(data.textures).some((entry) =>
    isRef(entry?.ref) && !entry.dataUrl && !isBlob(entry.file))) return true;
  if (!includeVJSet || !data.vjSet) return false;
  if (Array.isArray(data.vjSet.audio) && data.vjSet.audio.some((entry) => isRef(entry?.ref))) return true;
  return (sceneList(data.vjSet) || []).some((scene) => scene?.data && hasRefs(scene.data, false));
}

async function internalizeGraph(source, read, missing) {
  const data = { ...source };
  const jobs = [];

  if (source.textures && typeof source.textures === 'object') {
    const textures = { ...source.textures };
    data.textures = textures;
    for (const [nodeId, entry] of Object.entries(source.textures)) {
      if (!isRef(entry?.ref) || entry.dataUrl || isBlob(entry.file)) continue;
      jobs.push((async () => {
        try {
          const file = await read(entry.ref.path);
          if (entry.isVideo || /^video\//.test(file.type)) {
            // A video goes to the texture manager as the File itself:
            // restorePatchTextures plays it without a data: URL round trip.
            textures[nodeId] = { ...entry, isVideo: true, file };
          } else {
            const dataUrl = await fileToDataUrl(file);
            rememberPath(dataUrl, entry.ref.path);
            textures[nodeId] = { ...entry, dataUrl };
          }
        } catch (error) {
          missing.push({ kind: 'texture', nodeId, ref: entry.ref, entry, error });
        }
      })());
    }
  }

  const unresolved = [];
  if (Array.isArray(source.mediaParams) && source.mediaParams.length) {
    const nodes = Array.isArray(source.nodes) ? [...source.nodes] : [];
    data.nodes = nodes;
    for (const entry of source.mediaParams) {
      if (!isRef(entry?.ref) || !MEDIA_PARAMS.includes(entry.param)) continue;
      const index = nodes.findIndex((node) => String(node?.id) === String(entry.nodeId));
      if (index < 0) continue;
      jobs.push((async () => {
        try {
          const file = await read(entry.ref.path);
          const dataUrl = await fileToDataUrl(file);
          rememberPath(dataUrl, entry.ref.path);
          const node = nodes[index];
          nodes[index] = { ...node, params: { ...(node.params || {}), [entry.param]: dataUrl } };
        } catch (error) {
          unresolved.push(entry);
          missing.push({ kind: 'param', nodeId: entry.nodeId, param: entry.param, ref: entry.ref, error });
        }
      })());
    }
  }

  await Promise.all(jobs);

  if (unresolved.length) data.mediaParams = unresolved;
  else delete data.mediaParams;
  return data;
}

/** Every distinct file a list of missing media names, for the relink prompt. */
export function missingNames(missing) {
  return [...new Set((missing || []).map((item) => item?.ref?.name || basename(item?.ref?.path)).filter(Boolean))];
}
