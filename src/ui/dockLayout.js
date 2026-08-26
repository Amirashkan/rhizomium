/**
 * dockLayout.js - how much of the window a docked panel is holding, and who
 * has to be told when that changes.
 *
 * Both editor canvases (#gpu-canvas for the render, #ui-canvas for the graph)
 * are `position: fixed` and were sized to the whole window. A panel docked to
 * the right edge therefore covered them rather than sitting beside them: nodes
 * under the panel were unreachable and the render was cropped by a panel the
 * renderer knew nothing about.
 *
 * The inset is one number, published two ways so both halves of the app can
 * read it from wherever they already look:
 *
 *   - as the CSS variable `--rz-canvas-inset-right`, which the canvas rules in
 *     editor/style.css subtract from `100vw` (this is what the GPU canvas
 *     follows, since gpuRenderer.resizeCanvas() measures `clientWidth`);
 *   - as `canvasViewportWidth()`, for the JS that sizes the 2D canvas itself
 *     and reasons about the visible area (Editor.resize, ViewportManager).
 *
 * Changing it fires a window `resize`, because everything that has to happen
 * afterwards — re-measuring both canvases, redrawing the graph, rebuilding the
 * MSAA texture — is already wired to that event and already debounced. A dock
 * opening is, as far as the canvases are concerned, exactly a window resize.
 */

const INSET_VARIABLE = '--rz-canvas-inset-right';

/** Live width of the right-hand dock, in CSS pixels. Zero when nothing is docked. */
let rightDockWidth = 0;

/**
 * The width the canvases actually get: the window minus whatever is docked.
 *
 * Floors at 1 rather than 0 — a zero-width canvas is a WebGPU error, and a
 * dock wider than the window is a bug worth surviving rather than crashing on.
 */
export function canvasViewportWidth() {
  const total = (typeof window !== 'undefined' && window.innerWidth) || 0;
  return Math.max(1, total - rightDockWidth);
}

/** Full height available below the menu bar is unchanged; kept for symmetry. */
export function canvasViewportHeight() {
  return Math.max(1, (typeof window !== 'undefined' && window.innerHeight) || 1);
}

export function getRightDockWidth() {
  return rightDockWidth;
}

/**
 * Set the right dock's width and let the canvases catch up.
 *
 * @param {number} width - CSS pixels, clamped to the window.
 * @param {{silent?: boolean}} [options] - `silent` skips the resize
 *   notification, for the many small steps of a drag where the caller wants to
 *   notify once at the end instead of on every mousemove.
 */
export function setRightDockWidth(width, { silent = false } = {}) {
  const total = (typeof window !== 'undefined' && window.innerWidth) || 0;
  const next = Math.max(0, Math.min(Math.round(width) || 0, total));
  if (next === rightDockWidth) return rightDockWidth;

  rightDockWidth = next;

  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(INSET_VARIABLE, `${next}px`);
  }

  if (!silent) notifyCanvasResize();
  return rightDockWidth;
}

/**
 * Tell the app the drawable area changed.
 *
 * A synthetic `resize` rather than direct calls into the editor and the
 * renderer: those listeners already exist, already debounce, and already know
 * the order the two canvases have to be touched in. Duplicating that here is
 * how the two paths drift apart.
 */
export function notifyCanvasResize() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('resize'));
}
