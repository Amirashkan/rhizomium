// src/utils/paramPayloads.js
//
// Large parameter payloads: media bytes that live inside node.params.
//
// Some nodes carry their media *in* their parameters rather than as a file path: an Audio Sampler
// keeps the whole track in `audioData` as a base64 data URL, and every Text node keeps its font
// subset in `fontData`. A single project can therefore hold several megabytes of string inside
// `node.params` — one real patch measured 7.4 MB across 101 nodes, 6.4 MB of it a single MP3.
//
// The preview pipeline walks every parameter of every node on every refresh, and used to treat
// those blobs like any other value:
//   - the dirty check hashed params with `JSON.stringify(node.params)`, copying all 7.4 MB;
//   - the dependency scan ran the `node_<id>` regex (after a `.trim()`, another full copy) over
//     every parameter value, blobs included.
// With an audio-reactive patch the refresh runs for each `node_<id>` expression being evaluated,
// so the cost multiplied into hundreds of megabytes of string work per frame and pinned one CPU
// core (measured: 6.3 fps, with ~70% of all CPU time in those two functions).
//
// Neither piece of work is meaningful for a blob:
//   - for change detection, a cheap signature (length plus a head and tail slice) distinguishes
//     one loaded media payload from another, and a media payload is swapped wholesale rather than
//     edited in place;
//   - a data URL never contains a parameter expression, so scanning it for node references can
//     only ever find nothing.
//
// So both treat a value over LARGE_PARAM_VALUE_LENGTH as an opaque payload. A value that *is* an
// expression (leading `=`) is never treated as a payload however long it is, which keeps every
// real expression hashed and scanned in full.

/**
 * Length above which a string parameter is treated as an opaque media payload.
 *
 * Expressions are a line or two; the shortest embedded payloads (a font subset) are tens of
 * kilobytes. 4 KB sits far above the former and far below the latter.
 */
export const LARGE_PARAM_VALUE_LENGTH = 4096;

/** Characters of the head and of the tail kept in a payload signature. */
const SIGNATURE_EDGE = 48;

/**
 * Does this value start an expression? Mirrors the `=` prefix the editor writes for every
 * parameter expression.
 *
 * Equivalent to `value.trim().startsWith('=')` but without the copy: `.trim()` on a parameter
 * holding a 6 MB data URL allocates 6 MB to look at one character, and the preview and render
 * paths ask this of every parameter of every node on every frame.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function hasExpressionPrefix(value) {
  if (typeof value !== 'string') return false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    return ch === '=';
  }
  return false;
}

/**
 * Is this parameter value a large opaque payload (embedded audio, font, image, ...) rather than
 * something worth hashing or scanning in full?
 *
 * @param {*} value - a raw `node.params` value
 * @returns {boolean}
 */
export function isLargeParamPayload(value) {
  return typeof value === 'string'
    && value.length > LARGE_PARAM_VALUE_LENGTH
    && !hasExpressionPrefix(value);
}

/**
 * Cheap stand-in for a large payload in a change-detection hash: its length plus its first and
 * last few characters. Loading a different media file changes the length (and, for a data URL,
 * the `data:<mime>` head), so the signature changes with it.
 *
 * @param {string} value
 * @returns {string}
 */
export function paramPayloadSignature(value) {
  return `#${value.length}:${value.slice(0, SIGNATURE_EDGE)}:${value.slice(-SIGNATURE_EDGE)}`;
}

/**
 * JSON.stringify replacer that substitutes a signature for every large payload, so a params hash
 * costs a few hundred bytes of string work instead of megabytes.
 */
function payloadReplacer(_key, value) {
  return isLargeParamPayload(value) ? paramPayloadSignature(value) : value;
}

/**
 * Change-detection hash of a node's parameters.
 *
 * Returns the same sentinels the preview computers have always returned, so callers that compare
 * against a stored hash keep working unchanged.
 *
 * @param {object} node - graph node (may be null/undefined)
 * @returns {string} 'no-params' when the node has none, 'param-hash-error' when it cannot be
 *                   serialised, otherwise a JSON string with large payloads reduced to signatures.
 */
export function computeParameterHash(node) {
  if (!node || typeof node.params === 'undefined') {
    return 'no-params';
  }
  try {
    return JSON.stringify(node.params, payloadReplacer);
  } catch {
    return 'param-hash-error';
  }
}
