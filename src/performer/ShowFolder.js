/**
 * ShowFolder.js — the show as a folder on disk, rather than as a file.
 *
 * A manifest describes looks that do not exist yet, and ShowBuilder makes them.
 * That works, and it has one hole in it: everything it can build is something a
 * shader can draw from nothing. An artist who shot the footage, or who was sent
 * the festival's logo and a plate of the room, has media the show is *about* —
 * and there was no way to hand it over. The patch generator is told outright it
 * may not use a Texture 2D node, for the good reason that a model cannot supply
 * a file and a texture node pointing at nothing renders black.
 *
 * A show folder closes that. It is an ordinary directory:
 *
 *     Night set/
 *       night-set.rzshow.json     the manifest
 *       media/
 *         fog-loop.mp4            the footage the show is made of
 *         grain.png
 *         set.wav                 the track — listed, not loaded; see below
 *
 * Pick the folder and both halves arrive together: the manifest fills the Show
 * tab, and every clip beside it becomes something a look can name. A look that
 * names one is built with the clip already on a texture node, so the model is
 * composing *with* the footage instead of being told it cannot have any.
 *
 * ## What this file is, and is not
 *
 * It is the index and nothing else: given the entries of a directory it says
 * which file is the manifest, which files are media, and what it refused to
 * look at. It touches no directory handle of its own (the two readers that do
 * are at the bottom and are twenty lines each), no editor, no GPU and no model,
 * which is what lets the tests index a whole show out of plain objects.
 *
 * ## Why a folder rather than more file pickers
 *
 * Because the manifest and the media are one document. A `.rzshow.json` whose
 * looks name `fog-loop.mp4` is not portable on its own — it is half of a thing,
 * and the other half is whatever directory it was sitting in. Picking the
 * directory keeps them together, survives being copied to the rig's laptop, and
 * makes "rebuild the show an hour before doors" one click rather than one click
 * plus remembering which seven files.
 */

import { TextureManager, isVideoSource } from '../core/TextureManager.js';

/** The kinds of file a show folder is read for. */
export const MEDIA_KINDS = Object.freeze(['image', 'video', 'audio']);

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|avif|ktx2?|hdr)$/i;
const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|ogv|mov)$/i;
const AUDIO_EXTENSIONS = /\.(wav|mp3|flac|aiff?|m4a|opus)$/i;

/** Files that are a manifest, most specific first — see pickManifest(). */
const MANIFEST_PATTERNS = [/\.rzshow\.json$/i, /^show\.json$/i, /^manifest\.json$/i];

/** Directories never walked into: build output and version control, not media. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '__pycache__', '.cache',
]);

/**
 * Ceilings.
 *
 * `image` and `video` are the editor's own, imported rather than restated,
 * because they are not arbitrary: a patch carries its media inline so it can be
 * opened anywhere, and a clip too big to inline is a clip a built scene cannot
 * carry. Catching that here — at the desk, before a single call is spent — is
 * the whole point of reading the folder before building from it.
 *
 * `perLook` is not about memory. Every texture node in a look is a clip decoded
 * on every frame the look is up, and four moving images at once is already more
 * than most rigs will hold sixty times a second.
 */
export const MEDIA_LIMITS = Object.freeze({
  video: TextureManager.MAX_INLINE_VIDEO_BYTES,
  image: 50 * 1024 * 1024,
  perLook: 4,
  files: 200,
  depth: 6,
});

/** Every reference meaning "whatever is in the folder". */
const ALL_MEDIA = new Set(['*', 'all', 'any', 'everything']);

const basename = (path) => String(path).split('/').pop() || '';

const stem = (name) => String(name).replace(/\.[^.]+$/, '');

/** Case, spacing and punctuation all differ between a manifest and a filename. */
const loose = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * What kind of media a filename is, or null for anything else.
 *
 * Extension rather than MIME type, and deliberately: a file read out of a
 * directory handle has whatever type the platform guessed, which for a .mov on
 * some machines is the empty string. The name is the one thing that is always
 * there. `isVideoSource` — the editor's own test, which reads the type first —
 * gets the last word on the video/other split so that a clip this agrees to
 * index is a clip the texture manager agrees to play.
 */
export function classifyMedia(fileOrName) {
  const file = typeof fileOrName === 'string' ? { name: fileOrName, type: '' } : fileOrName || {};
  const name = String(file.name || '');
  if (!name || name.startsWith('.')) return null;

  if (VIDEO_EXTENSIONS.test(name) || isVideoSource(file)) return 'video';
  if (IMAGE_EXTENSIONS.test(name)) return 'image';
  if (AUDIO_EXTENSIONS.test(name)) return 'audio';
  return null;
}

/**
 * The name of the texture node a clip is going to arrive on.
 *
 * It is a convention with two ends and they have to agree: the look prompt asks
 * the model for a node under this exact name, and ShowBuilder.attachMedia() goes
 * looking for it afterwards. `loose()` is what actually compares them, so a model that writes
 * "Media - Fog Loop" for "Media: fog-loop" still lands on its feet.
 */
export function mediaSlotName(item) {
  return `Media: ${item?.label || stem(basename(item?.path || 'clip'))}`;
}

/**
 * Read a directory's entries into a show.
 *
 * Never throws. A folder someone picked by mistake is a folder with no manifest
 * and no media in it, which is a thing to say rather than a thing to fail on.
 *
 * @param {Array<{path: string, file: object}>} entries relative paths and their
 *   files, in any order — from a directory handle or an `<input webkitdirectory>`.
 * @param {object} [options]
 * @param {string} [options.name] what to call the folder in the readout.
 * @returns {{
 *   name: string, manifest: object|null, manifests: Array<{path: string, file: object}>,
 *   media: Array, skipped: Array,
 *   problems: Array<{where: string, level: string, message: string}>,
 *   extraManifests: Array<string>
 * }}
 */
export function indexShowFolder(entries, options = {}) {
  const found = [];
  const media = [];
  const skipped = [];
  const problems = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const path = String(entry?.path || '').replace(/^\.?\//, '');
    const file = entry?.file;
    if (!path || !file) continue;

    const segments = path.split('/');
    const name = segments[segments.length - 1];

    // Hidden files, build directories and anything buried too deep. A show
    // folder copied off a Mac is full of ._ files nobody wants listed.
    if (segments.some((segment) => segment.startsWith('.') || SKIPPED_DIRECTORIES.has(segment))) continue;
    if (segments.length > MEDIA_LIMITS.depth) continue;

    if (MANIFEST_PATTERNS.some((pattern) => pattern.test(name))) {
      found.push({ path, file, name, depth: segments.length });
      continue;
    }

    const kind = classifyMedia(file.name ? file : { name, type: file.type });
    if (!kind) continue;

    const size = Number(file.size) || 0;
    const limit = kind === 'video' ? MEDIA_LIMITS.video : kind === 'image' ? MEDIA_LIMITS.image : Infinity;

    // A clip past the limit is indexed as skipped rather than dropped. The
    // artist put it there on purpose and "I cannot see it" is a worse answer
    // than "it is 90 MB and a patch carries its media inline".
    if (size > limit) {
      skipped.push({
        path,
        kind,
        size,
        reason: `${(size / 1024 / 1024).toFixed(0)} MB — over the ${(limit / 1024 / 1024).toFixed(0)} MB a patch can carry inline. Shorten it or re-encode it smaller.`,
      });
      continue;
    }

    if (media.length >= MEDIA_LIMITS.files) {
      skipped.push({ path, kind, size, reason: `past the first ${MEDIA_LIMITS.files} files in the folder` });
      continue;
    }

    media.push({
      path,
      name,
      label: stem(name).slice(0, 40),
      kind,
      size,
      type: String(file.type || ''),
      folder: segments.slice(0, -1).join('/'),
      file,
      // Filled in by readMediaDataUrl() the first time a build needs the bytes,
      // so a clip three looks share is encoded once.
      dataUrl: null,
    });
  }

  media.sort((a, b) => a.path.localeCompare(b.path));

  const chosen = pickManifest(found);
  const extraManifests = found.filter((entry) => entry !== chosen).map((entry) => entry.path);

  if (!found.length) {
    problems.push({
      where: 'the folder',
      level: 'warn',
      message: 'No manifest in it. A show folder holds a .rzshow.json next to its media — press Example, then Save… into this folder to start one.',
    });
  }

  // Which of several manifests to complain about is not decided here any more.
  // A directory of project folders written by another tool holds one manifest
  // per folder and all of them are wanted, so the choice is made once they have
  // been read — see ShowImport.readFolderShow().

  const audio = media.filter((item) => item.kind === 'audio').length;
  if (audio) {
    // Worth one line rather than silence. The track being in the folder is
    // correct — it is the show — but nothing in the editor plays a file: the
    // performer listens to what is coming out of the room, which is the
    // musician. See src/audio/README.md.
    //
    // A note rather than a warning: nothing is wrong, and a line that reads
    // like a fault in a list of faults is a line that costs the artist a
    // minute working out which of them to fix.
    problems.push({
      where: 'the folder',
      level: 'note',
      message: `${audio} audio file${audio === 1 ? '' : 's'} listed but not used: the performer listens to your live input, not to a file. Play the track into the editor and it will hear it.`,
    });
  }

  return {
    name: String(options.name || '').trim() || (chosen ? chosen.path.split('/')[0] : '') || 'Show folder',
    manifest: chosen ? { path: chosen.path, file: chosen.file } : null,
    // Every manifest in the folder, best first, because a folder can hold one
    // per project rather than one per show. The reader takes them in this
    // order; `manifest` is still the single best candidate for the one-file case.
    manifests: ranked(found).map((entry) => ({ path: entry.path, file: entry.file })),
    media,
    skipped,
    problems,
    extraManifests,
  };
}

/**
 * Which of several manifests is the show's.
 *
 * Shallowest wins, then the most specific extension: a folder holding
 * `night-set.rzshow.json` and a `media/manifest.json` that belongs to something
 * else should open the first one. Alphabetical last, so the choice is at least
 * the same choice every time the folder is opened.
 */
function pickManifest(found) {
  return ranked(found)[0] || null;
}

/** Every manifest found, in the order pickManifest() prefers them. */
function ranked(found) {
  const rank = (entry) => MANIFEST_PATTERNS.findIndex((pattern) => pattern.test(entry.name));
  return found.slice().sort((a, b) =>
    a.depth - b.depth || rank(a) - rank(b) || a.path.localeCompare(b.path));
}

/**
 * The clips one look asked for.
 *
 * A reference is whatever the artist would have typed: the path, the filename,
 * the name without its extension, a folder to take everything out of, or `*`
 * for the lot. All of them are compared loosely, because a manifest is written
 * by hand next to a filename nobody retypes exactly.
 *
 * Order is the manifest's, not the folder's — a look that names three clips is
 * describing them in the order it wants them used, and the first one is the one
 * the prompt leans on.
 *
 * @returns {{items: Array, missing: Array<string>, dropped: number}} `missing`
 *   is what named nothing, which is a warning at the desk rather than a failure
 *   at showtime.
 */
export function resolveLookMedia(folder, look) {
  const all = Array.isArray(folder?.media) ? folder.media.filter((item) => item.kind !== 'audio') : [];
  const wanted = Array.isArray(look?.media) ? look.media : [];

  const items = [];
  const missing = [];
  const seen = new Set();

  const take = (item) => {
    if (seen.has(item.path)) return;
    seen.add(item.path);
    items.push(item);
  };

  for (const raw of wanted) {
    const reference = String(raw || '').trim();
    if (!reference) continue;

    const matched = matchMedia(all, reference);
    if (!matched.length) {
      missing.push(reference);
      continue;
    }
    matched.forEach(take);
  }

  // The cap is applied here rather than at validation because it depends on
  // what a reference expanded to: `"media": ["*"]` against a folder of nine
  // clips is not a mistake, it is a shorthand, and the honest answer is the
  // first few rather than a refusal.
  const dropped = Math.max(0, items.length - MEDIA_LIMITS.perLook);

  return { items: items.slice(0, MEDIA_LIMITS.perLook), missing, dropped };
}

/** Everything in `media` that one reference names. */
function matchMedia(media, reference) {
  if (ALL_MEDIA.has(reference.toLowerCase())) return media.slice();

  const key = loose(reference);
  if (!key) return [];

  // A folder name takes everything under it, which is how "plates" means the
  // plates — whether the artist wrote the path from the top ("media/plates")
  // or just the directory they can see. Checked first: a directory and a file
  // can share a name.
  const inFolder = media.filter((item) => inDirectory(item, reference));
  if (inFolder.length) return inFolder;

  // A trailing glob — "plates/*" or "fog*" — is the other way people write it.
  if (reference.endsWith('*')) {
    const prefix = loose(reference.slice(0, -1));
    if (prefix) {
      const under = media.filter((item) => loose(item.path).startsWith(prefix));
      if (under.length) return under;
    }
  }

  const exact = media.find((item) =>
    loose(item.path) === key || loose(item.name) === key || loose(item.label) === key);
  if (exact) return [exact];

  // Last: a name that is merely contained, and only when exactly one clip
  // answers to it. Two candidates means the manifest was ambiguous, and
  // guessing between them is how the wrong plate ends up in the drop.
  const near = media.filter((item) => loose(item.name).includes(key));
  return near.length === 1 ? near : [];
}

/**
 * Is this clip inside the directory the reference names?
 *
 * Compared segment by segment, so "plates", "media/plates" and "plates/" all
 * reach `media/plates/room.jpg`, and "media" reaches everything under it.
 */
function inDirectory(item, reference) {
  const path = (value) => String(value).split('/').filter(Boolean).map(loose).filter(Boolean).join('/');

  const wanted = path(reference);
  const directory = path(item.folder);
  if (!wanted || !directory) return false;

  return directory === wanted
    || directory.startsWith(`${wanted}/`)
    || directory.endsWith(`/${wanted}`)
    || directory.includes(`/${wanted}/`);
}

/**
 * The clips, as the patch call is told about them.
 *
 * This is the half of the contract the model sees. The other half is
 * attachMedia() in ShowBuilder.js, which goes looking for these exact node names
 * afterwards — so the wording here is load-bearing and the slot name is quoted
 * rather than described.
 */
export function mediaSlots(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    node: mediaSlotName(item),
    kind: item.kind,
    file: item.name,
  }));
}

/**
 * Read a clip's bytes as the inline data: URL a patch carries.
 *
 * Cached on the item, because a build asks for the same clip once per look that
 * uses it and base64 of a 24 MB video is not something to do three times. The
 * cache is the item object itself rather than a map keyed by path, so it dies
 * with the folder index — a folder re-picked after the artist re-encoded a clip
 * reads the new bytes.
 */
export async function readMediaDataUrl(item) {
  if (!item) throw new Error('No clip to read.');
  if (item.dataUrl) return item.dataUrl;

  const file = item.file;
  if (!file) throw new Error(`"${item.path}" has no file behind it any more.`);

  const type = file.type || guessType(item);
  const dataUrl = await encodeDataUrl(file, type);
  item.dataUrl = dataUrl;
  return dataUrl;
}

/**
 * A MIME type for a file that arrived without one.
 *
 * It matters: restoring a patch's media dispatches on `data:image/` versus
 * `data:video/`, so a clip inlined as application/octet-stream is a clip the
 * loader refuses. The extension is what we have, and it is what named the kind
 * in the first place.
 */
function guessType(item) {
  const extension = (item.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  if (item.kind === 'video') return extension === 'mov' ? 'video/quicktime' : `video/${extension || 'mp4'}`;
  if (item.kind === 'audio') return `audio/${extension || 'wav'}`;
  const image = extension === 'jpg' ? 'jpeg' : extension || 'png';
  return `image/${image}`;
}

/**
 * Bytes to a base64 data: URL.
 *
 * FileReader when the platform has one, because it is native and this runs on
 * files up to 24 MB. The hand-rolled path is not only for tests: a File from a
 * directory handle is read the same way, and chunking the base64 is what stops
 * `String.fromCharCode(...bytes)` from blowing the argument limit on anything
 * over a few hundred kilobytes.
 *
 * A file with no type is re-wrapped before it is read, and that is not a
 * nicety. FileReader writes the blob's own type into the URL's header, so an
 * untyped file — a .mov out of some file managers, which is the case
 * classifyMedia() exists to catch — would be inlined as
 * `data:application/octet-stream`, and the patch loader takes inline media
 * only when the header says image or video. The clip would go into the scene,
 * be refused on the way back out, and the look would be black at showtime with
 * nothing anywhere saying why.
 */
async function encodeDataUrl(file, type) {
  if (typeof FileReader === 'function' && typeof Blob === 'function' && file instanceof Blob) {
    const source = file.type ? file : new Blob([file], { type });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Could not read ${file.name || 'the file'}.`));
      reader.readAsDataURL(source);
    });
  }

  if (typeof file.arrayBuffer !== 'function') {
    throw new Error('That file cannot be read in this build.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/* -------------------------------------------------------------------------
 * Getting the entries in the first place.
 *
 * Two readers, because there are two ways a browser hands over a directory and
 * the editor should not care which one it got. Everything above works on the
 * `{path, file}` list they both produce.
 * ---------------------------------------------------------------------- */

/**
 * Which of the two this browser has.
 *
 * `directory` is the real picker and the one to prefer: it names the folder,
 * and it is the one that can later be asked to write back into it. `input` is
 * every other browser, where a directory arrives as a flat list of files and
 * the folder is only a prefix on their paths.
 */
export function folderPickerKind() {
  if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
    return 'directory';
  }
  return typeof document === 'undefined' ? 'none' : 'input';
}

/**
 * Walk a File System Access directory handle.
 *
 * Breadth-first with a hard cap on how many entries are visited: the folder
 * being picked is chosen by a person, but a person who picks their home
 * directory by mistake should get an answer rather than a hung tab.
 */
export async function readDirectoryHandle(handle, { limit = 2000 } = {}) {
  const entries = [];
  const queue = [{ handle, prefix: '' }];
  let visited = 0;

  while (queue.length && visited < limit) {
    const { handle: directory, prefix } = queue.shift();

    for await (const [name, child] of directory.entries()) {
      if (++visited >= limit) break;
      if (name.startsWith('.') || SKIPPED_DIRECTORIES.has(name)) continue;

      const path = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'directory') {
        if (path.split('/').length < MEDIA_LIMITS.depth) queue.push({ handle: child, prefix: path });
        continue;
      }

      try {
        entries.push({ path, file: await child.getFile() });
      } catch {
        // A file that vanished or cannot be read is one file, not the folder.
      }
    }
  }

  return entries;
}

/**
 * The same list out of an `<input type="file" webkitdirectory>`.
 *
 * The fallback for anything without a directory picker. `webkitRelativePath`
 * includes the picked folder's own name as its first segment, which would make
 * every path one level deeper than the directory-handle path — so it is
 * stripped, and the two readers agree on what a path is.
 */
export function readFileList(files) {
  const list = Array.from(files || []);
  return list.map((file) => {
    const relative = String(file.webkitRelativePath || file.name || '');
    const segments = relative.split('/');
    return { path: (segments.length > 1 ? segments.slice(1) : segments).join('/'), file };
  });
}

export default indexShowFolder;
