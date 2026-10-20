// mediaPaths.js — where on disk each piece of a project's media came from.
//
// On the desktop a project file names its images, videos, audio and fonts by
// path instead of carrying their bytes (see mediaRefs.js). The editor itself
// still holds the bytes, exactly as it always has — data: URLs on the node, a
// File in the texture manager — because publishing, the web viewer, VJ scenes
// and collaboration all need them inline. What it needs on top is the answer to
// "which file was this?", and that is this registry.
//
// Keyed by the media itself rather than by node: a File by identity, a data:
// URL by a fingerprint of its contents. So the answer survives everything that
// rebuilds a node — undo, paste, a VJ scene switch — without any of those paths
// having to carry a path along, and a string key never pins megabytes of
// base64 in memory after the node that held it has moved on.
//
// The other half is the desktop I/O: picking files in a native dialog (the
// webview's own pickers never reveal a path) and reading a path's bytes back.
// Both go through the Rust side, which only reads files the artist picked or
// dropped (MediaGrants in src-tauri/src/lib.rs).

import { isTauri } from '../utils/isTauri.js';

const MIME_BY_EXTENSION = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', weba: 'audio/webm',
  aif: 'audio/aiff', aiff: 'audio/aiff',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', ttc: 'font/collection',
};

/**
 * `name` with an extension matching `mime` when it has none of its own - a
 * file written out of a project needs one for the pickers and for reading its
 * type back.
 */
export function nameWithExtension(name, mime) {
  const base = String(name || '').trim() || 'media';
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
  const type = String(mime || '').toLowerCase();
  const ext = Object.keys(MIME_BY_EXTENSION).find((key) => MIME_BY_EXTENSION[key] === type);
  return ext ? `${base}.${ext}` : base;
}

/** The last segment of a Windows or POSIX path. */
export function basename(path) {
  return String(path || '').split(/[\\/]/).pop() || '';
}

/** A MIME type for a file name, from its extension; '' when unknown. */
export function mimeForName(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  return MIME_BY_EXTENSION[ext] || '';
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const pathByBlob = new WeakMap();
const pathByFingerprint = new Map();

/**
 * A short stand-in for a data: URL. Length plus a hash of samples spread over
 * the whole string: two different files of the same encoded length would have
 * to agree at every sample to collide, and hashing a 30MB string end to end on
 * every save is the cost this avoids.
 */
export function fingerprint(text) {
  const str = String(text);
  const SAMPLES = 64;
  const WIDTH = 32;
  let hash = 5381;
  const mix = (from, to) => {
    for (let i = from; i < to; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  };
  if (str.length <= SAMPLES * WIDTH) {
    mix(0, str.length);
  } else {
    const step = Math.floor((str.length - WIDTH) / (SAMPLES - 1));
    for (let s = 0; s < SAMPLES; s++) mix(s * step, s * step + WIDTH);
    mix(str.length - WIDTH, str.length);
  }
  return `${str.length}:${hash}`;
}

/** Record that `source` (a File/Blob or a data: URL) is the file at `path`. */
export function rememberPath(source, path) {
  if (!source || !path) return;
  if (typeof source === 'string') {
    pathByFingerprint.set(fingerprint(source), path);
  } else if (typeof source === 'object') {
    pathByBlob.set(source, path);
  }
}

/** The path `source` was read from, or null when it never came from one. */
export function pathFor(source) {
  if (!source) return null;
  if (typeof source === 'string') return pathByFingerprint.get(fingerprint(source)) ?? null;
  if (typeof source === 'object') return pathByBlob.get(source) ?? null;
  return null;
}

/**
 * Carry a file's path over to what it was turned into — the data: URL an
 * audio clip or a font is stored on the node as.
 */
export function linkSource(from, to) {
  const path = pathFor(from);
  if (path) rememberPath(to, path);
  return path;
}

/** Forget everything. Tests only. */
export function _resetMediaPaths() {
  pathByFingerprint.clear();
}

// ---------------------------------------------------------------------------
// Desktop I/O
// ---------------------------------------------------------------------------

/** Why a path could not be read: 'not-found', 'not-granted', 'too-large' or 'unavailable'. */
export class MediaReadError extends Error {
  constructor(path, code, detail = '') {
    super(`Could not read ${path}: ${detail || code}`);
    this.name = 'MediaReadError';
    this.path = path;
    this.code = code;
  }
}

async function invoke(command, args, options) {
  const core = await import('@tauri-apps/api/core');
  return options ? core.invoke(command, args, options) : core.invoke(command, args);
}

/** Whether media can be picked and read by path here: the desktop app only. */
export function canUseMediaPaths() {
  return isTauri();
}

/** Turn bytes read from `path` into a named, typed File that remembers its path. */
function toFile(path, bytes) {
  const name = basename(path) || 'media';
  const type = mimeForName(name);
  const file = typeof File === 'function'
    ? new File([bytes], name, { type })
    : Object.assign(new Blob([bytes], { type }), { name });
  rememberPath(file, path);
  return file;
}

/**
 * Read a media file by path through the Rust side.
 *
 * @returns {Promise<File>}
 * @throws {MediaReadError}
 */
export async function readMediaAsFile(path) {
  if (!canUseMediaPaths()) throw new MediaReadError(path, 'unavailable');
  let bytes;
  try {
    bytes = await invoke('read_media_file', { path });
  } catch (error) {
    const text = String(error?.message ?? error ?? '');
    const code = ['not-found', 'not-granted', 'too-large'].includes(text) ? text : 'unavailable';
    throw new MediaReadError(path, code, text);
  }
  return toFile(path, bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes) ? bytes : new Uint8Array(bytes || []));
}

/**
 * Pick media in a native dialog and read it in. Resolves to [] when the
 * artist cancels.
 *
 * @param {'image'|'texture'|'audio'|'font'} kind which extensions to offer
 * @param {{multiple?: boolean}} [options]
 * @returns {Promise<File[]>}
 */
export async function pickMediaFiles(kind, { multiple = false } = {}) {
  const paths = await invoke('pick_media_files', { kind, multiple });
  const files = [];
  for (const path of Array.isArray(paths) ? paths : []) {
    files.push(await readMediaAsFile(path));
  }
  return files;
}

/**
 * The "choose a file" click of a media input: the native dialog on the
 * desktop, so the file's path is known; `openWebPicker` (the input's own
 * file dialog) anywhere else, or if the desktop side does not answer — an
 * older binary under a newer frontend has no pick_media_files.
 *
 * @param {'image'|'texture'|'audio'|'font'} kind
 * @param {{multiple?: boolean}} options
 * @param {() => void} openWebPicker
 * @param {(files: File[]) => void} onFiles called with what the dialog returned
 */
export function chooseMediaFiles(kind, options, openWebPicker, onFiles) {
  if (!canUseMediaPaths()) {
    openWebPicker();
    return;
  }
  pickMediaFiles(kind, options).then(
    (files) => { if (files.length) onFiles(files); },
    (error) => {
      console.warn('Native media picker unavailable, using the web one:', error);
      openWebPicker();
    },
  );
}

/**
 * Write media out as a file in a folder from pickMediaFolder(). Never
 * overwrites a different file of the same name (the Rust side numbers it
 * instead), and reuses one with the same bytes.
 *
 * @returns {Promise<string>} the path written
 */
export async function writeMediaFile(folder, name, blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke('write_media_file', bytes, {
    headers: { 'x-folder': encodeURIComponent(folder), 'x-name': encodeURIComponent(name) },
  });
}

/** Pick a folder to search for missing media. Resolves to null on cancel. */
export async function pickMediaFolder() {
  return (await invoke('pick_media_folder')) || null;
}

/**
 * Find files by name under a folder from pickMediaFolder().
 *
 * @returns {Promise<Record<string, string>>} name -> path, for the names found
 */
export async function findMediaInFolder(folder, names) {
  return (await invoke('find_media_in_folder', { folder, names: [...new Set(names)] })) || {};
}

/**
 * A File as a data: URL. A file with no type of its own (some file managers
 * report none) is labelled from its extension, since the audio and font
 * loaders go by the data: URL's type.
 */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'));
    reader.onload = () => {
      let dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      const mime = mimeForName(file?.name);
      if (mime && comma >= 0 && /^data:(application\/octet-stream)?;/i.test(dataUrl)) {
        dataUrl = `data:${mime};base64${dataUrl.slice(comma)}`;
      }
      resolve(dataUrl);
    };
    reader.readAsDataURL(file);
  });
}
