// src/ui/letterbox.js
//
// Aspect-preserving "letterbox" placement shared by both second-monitor
// backends (the browser popup mirror and the Tauri receiver window). Given a
// source size and a destination size, returns the centred destination rect that
// preserves the source aspect ratio on a black field.

/**
 * @param {number} srcW source width in pixels
 * @param {number} srcH source height in pixels
 * @param {number} dstW destination width in pixels
 * @param {number} dstH destination height in pixels
 * @returns {{dx:number, dy:number, dw:number, dh:number}} centred, scaled rect.
 *   All zero when any input is non-positive.
 */
export function letterboxRect(srcW, srcH, dstW, dstH) {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { dx: 0, dy: 0, dw: 0, dh: 0 };
  }
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  return { dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh };
}
