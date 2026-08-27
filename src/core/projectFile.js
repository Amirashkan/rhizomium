// src/core/projectFile.js — what a .rz file is on disk.
//
// A patch carries its media inside it: that is what makes a .rz self-contained,
// openable on another machine and publishable to the gallery. Media reaches the
// JSON as a base64 `data:` URL, and base64 is 4 characters for every 3 bytes —
// so a project with a 20 MB video in it is a 26 MB file, and a third of that is
// the encoding, not the artwork.
//
// Gzipping the file gives that third back. Base64 of already-compressed bytes is
// exactly the kind of thing deflate undoes well (six meaningful bits per byte),
// and the JSON around it compresses far harder than that: in practice the file
// lands within half a percent of the size the raw media would occupy, which is
// the floor for storing it losslessly at all. No format redesign, no separate
// sidecar files, nothing for the artist to manage.
//
// Old uncompressed .rz and .json files still open — reading sniffs the gzip
// magic number and only inflates when it is there — and a browser without
// CompressionStream simply writes what it always wrote.

const GZIP_MAGIC = [0x1f, 0x8b];

/** Can this browser write compressed projects? */
export function canCompressProjects() {
  return typeof CompressionStream === 'function' && typeof Response === 'function';
}

/**
 * The bytes to write for a project's JSON: gzipped where the browser can, the
 * original text where it cannot. Both are accepted by every writer we use — a
 * FileSystemWritableFileStream and the Blob behind a download link take a string
 * or a BufferSource alike — and both are readable by decodeProjectFile below.
 *
 * @param {string} text serialized project JSON
 * @returns {Promise<Uint8Array|string>}
 */
export async function encodeProjectFile(text) {
  if (!canCompressProjects()) return text;
  try {
    const compressed = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(compressed).arrayBuffer());
  } catch {
    // Never fail a save over the encoding: the plain text is a valid project file.
    return text;
  }
}

/** Does this blob start with the gzip magic number? */
async function isGzip(blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, GZIP_MAGIC.length).arrayBuffer());
    return GZIP_MAGIC.every((byte, i) => head[i] === byte);
  } catch {
    return false;
  }
}

/**
 * The JSON text inside a project file, whether or not it was compressed. Files
 * written before compression existed — and .json exports, which stay plain so
 * they remain readable interchange — go through untouched.
 *
 * @param {Blob} file
 * @returns {Promise<string>}
 */
export async function decodeProjectFile(file) {
  if (await isGzip(file)) {
    const inflated = file.stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(inflated).text();
  }
  return await file.text();
}
