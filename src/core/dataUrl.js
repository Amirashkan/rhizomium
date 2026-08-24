// dataUrl.js — decoding the inline payloads that make a patch self-contained.
//
// Its own module (rather than a corner of SaveLoadManager) because the web
// viewer restores patch media without loading the editor's save/load stack.

/**
 * Decode a base64 data: URL into a Blob.
 *
 * Done by hand rather than with fetch() because the only caller is restoring a
 * patch's inlined media, and a decode should not look like a network request to
 * anything watching — CSP, service workers, or a reader of this code.
 */
export function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Malformed data: URL');
  const header = dataUrl.slice(5, comma); // between "data:" and the comma
  if (!header.includes(';base64')) throw new Error('Only base64 data: URLs are supported');
  const mime = header.split(';')[0] || 'application/octet-stream';

  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
