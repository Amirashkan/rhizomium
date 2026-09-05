/**
 * resizable.js — give a floating window a grabbable border.
 *
 * The floating windows could be moved but not sized: each one opened at the
 * width its stylesheet gave it and stayed there, so a long shader listing, a
 * screens rig or a mapping stage was read through a fixed slot with everything
 * else scrolled out of view. This adds the missing half of a window: eight grab
 * zones — four edges and four corners — around the panel, so width and height
 * move independently from whichever side is closest to hand.
 *
 * Usage:
 *   const stop = makeResizable(panel, { minWidth: 320, minHeight: 240 });
 *
 * What the drag guarantees:
 *   - the window never shrinks past `minWidth` / `minHeight`;
 *   - it never grows off screen, and its top edge stays clear of the top menu
 *     bar (see windowBounds.js — the bar paints above the panels);
 *   - the edge NOT being dragged stays where it is, which is what makes a
 *     resize feel like moving one border rather than moving the window.
 *
 * Anchoring: a panel parked by its right or bottom edge (the 3D viewport sits
 * at `right: 16px`, the docked preview in the top-right corner) keeps that
 * anchor, so it still tracks its corner after being resized. Pass
 * `anchor: { x: 'right' }` for those; everything else is written as left/top
 * pixels, the same coordinates dragging leaves behind.
 */
import { clampPanelPosition, hasTranslation, topChromeBottom } from './windowBounds.js';
import { rememberDefaultGeometry } from './panelGeometry.js';

/** Every direction, in the order the handles are stacked (corners last). */
const ALL_HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const CURSORS = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

export const HANDLE_CLASS = 'rz-resize-handle';
const STYLE_ID = 'rz-resizable-styles';

/** Hit area of an edge strip / a corner box, in px. */
const EDGE = 6;
const CORNER = 14;

/**
 * The handle geometry, injected once.
 *
 * The strips are invisible — a window with eight lines drawn around it reads as
 * a diagram — except the bottom-right corner, which carries the usual diagonal
 * grip so the feature is discoverable without hunting for the border.
 */
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HANDLE_CLASS} {
      position: absolute;
      z-index: 30;
      touch-action: none;
      background: transparent;
    }
    .${HANDLE_CLASS}[data-dir="n"] { top: 0; left: 0; right: 0; height: ${EDGE}px; cursor: ns-resize; }
    .${HANDLE_CLASS}[data-dir="s"] { bottom: 0; left: 0; right: 0; height: ${EDGE}px; cursor: ns-resize; }
    .${HANDLE_CLASS}[data-dir="w"] { top: 0; bottom: 0; left: 0; width: ${EDGE}px; cursor: ew-resize; }
    .${HANDLE_CLASS}[data-dir="e"] { top: 0; bottom: 0; right: 0; width: ${EDGE}px; cursor: ew-resize; }
    .${HANDLE_CLASS}[data-corner="1"] { width: ${CORNER}px; height: ${CORNER}px; z-index: 31; }
    .${HANDLE_CLASS}[data-dir="nw"] { top: 0; left: 0; cursor: nwse-resize; }
    .${HANDLE_CLASS}[data-dir="ne"] { top: 0; right: 0; cursor: nesw-resize; }
    .${HANDLE_CLASS}[data-dir="sw"] { bottom: 0; left: 0; cursor: nesw-resize; }
    .${HANDLE_CLASS}[data-dir="se"] {
      bottom: 0;
      right: 0;
      cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 55%, rgba(255, 244, 230, 0.26) 65%);
    }
    .${HANDLE_CLASS}[data-dir="se"]:hover {
      background: linear-gradient(135deg, transparent 55%, rgba(255, 244, 230, 0.5) 65%);
    }
  `;
  document.head?.appendChild(style);
}

const round = (value) => Math.round(value);

/**
 * Write a geometry back to the panel, keeping the edges it is anchored by.
 *
 * `left`/`top` are viewport coordinates whichever anchor is in use; a
 * right-anchored panel gets them converted into the offset from that edge, so
 * the window keeps tracking the corner it was parked in.
 */
function applyGeometry(panel, { left, top, width, height }, anchor) {
  const viewportWidth = (typeof window !== 'undefined' && window.innerWidth) || 0;
  const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 0;

  panel.style.width = `${round(width)}px`;
  panel.style.height = `${round(height)}px`;

  if (anchor.x === 'right') {
    panel.style.right = `${round(viewportWidth - (left + width))}px`;
    panel.style.left = 'auto';
  } else {
    panel.style.left = `${round(left)}px`;
    panel.style.right = 'auto';
  }

  if (anchor.y === 'bottom') {
    panel.style.bottom = `${round(viewportHeight - (top + height))}px`;
    panel.style.top = 'auto';
  } else {
    panel.style.top = `${round(top)}px`;
    panel.style.bottom = 'auto';
  }
}

/**
 * The size and position one drag step asks for, before it is written.
 *
 * Only the edges named by `dir` move; the opposite ones are held, which is why
 * every clamp here corrects the moving edge rather than sliding the window.
 *
 * @param {string} dir - one of n/s/e/w/ne/nw/se/sw
 * @param {{left: number, top: number, width: number, height: number}} start
 * @param {number} dx - pointer travel since mousedown
 * @param {number} dy
 * @param {{minWidth: number, minHeight: number}} limits
 * @returns {{left: number, top: number, width: number, height: number}}
 */
export function resolveResize(dir, start, dx, dy, { minWidth, minHeight }) {
  let { left, top, width, height } = start;

  if (dir.includes('e')) width = start.width + dx;
  if (dir.includes('w')) {
    width = start.width - dx;
    left = start.left + dx;
  }
  if (dir.includes('s')) height = start.height + dy;
  if (dir.includes('n')) {
    height = start.height - dy;
    top = start.top + dy;
  }

  // Past the minimum the dragged edge stops; the held one must not follow it.
  if (width < minWidth) {
    if (dir.includes('w')) left = start.left + start.width - minWidth;
    width = minWidth;
  }
  if (height < minHeight) {
    if (dir.includes('n')) top = start.top + start.height - minHeight;
    height = minHeight;
  }

  const viewportWidth = (typeof window !== 'undefined' && window.innerWidth) || 0;
  const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 0;
  const minTop = topChromeBottom();

  // Off the left edge, or up under the menu bar: pin the moving edge to the
  // boundary and give the window back the width/height it just lost, so the
  // opposite edge still hasn't moved.
  if (dir.includes('w') && left < 0) {
    width = Math.max(minWidth, width + left);
    left = 0;
  }
  if (dir.includes('n') && top < minTop) {
    height = Math.max(minHeight, height - (minTop - top));
    top = minTop;
  }
  if (dir.includes('e') && viewportWidth > 0) {
    width = Math.max(minWidth, Math.min(width, viewportWidth - left));
  }
  if (dir.includes('s') && viewportHeight > 0) {
    height = Math.max(minHeight, Math.min(height, viewportHeight - top));
  }

  return { left, top, width, height };
}

/**
 * Make a floating window resizable from its edges and corners.
 *
 * @param {HTMLElement} panel - the window itself (the element that is sized)
 * @param {object} [options]
 * @param {number} [options.minWidth=220] - smallest width the drag allows
 * @param {number} [options.minHeight=140] - smallest height the drag allows
 * @param {string[]} [options.handles] - directions to install, default all eight
 * @param {object|Function} [options.anchor] - `{x: 'left'|'right', y: 'top'|'bottom'}`,
 *   or a function returning one, for a panel that must keep tracking an edge
 * @param {Function} [options.enabled] - asked before each drag; a window whose
 *   geometry is not its own for the moment (fullscreen, locked) answers false
 * @param {Function} [options.onResize] - called with `{width, height}` on every
 *   step, for content that has to be re-laid out (a canvas, a GPU surface)
 * @param {Function} [options.onResizeEnd] - called once with the final size
 * @returns {Function} cleanup: removes the handles and every listener
 */
export function makeResizable(panel, options = {}) {
  if (!panel || typeof document === 'undefined') return () => {};

  const {
    minWidth = 220,
    minHeight = 140,
    handles = ALL_HANDLES,
    anchor = null,
    enabled = null,
    onResize = null,
    onResizeEnd = null,
  } = options;

  ensureStyles();

  // Before the first resize, so Window → Reset Layout can undo every resize
  // that follows (see panelGeometry.js).
  rememberDefaultGeometry(panel);

  const resolveAnchor = () => {
    const value = typeof anchor === 'function' ? anchor() : anchor;
    return {
      x: value?.x === 'right' ? 'right' : 'left',
      y: value?.y === 'bottom' ? 'bottom' : 'top',
    };
  };

  let active = null;
  let userSized = false;

  const onMouseMove = (e) => {
    if (!active) return;
    e.preventDefault();

    const geometry = resolveResize(
      active.dir,
      active.start,
      e.clientX - active.pointerX,
      e.clientY - active.pointerY,
      { minWidth, minHeight },
    );

    applyGeometry(panel, geometry, active.anchor);
    onResize?.({ width: geometry.width, height: geometry.height });
  };

  const onMouseUp = () => {
    if (!active) return;

    const { transition } = active;
    active = null;

    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    panel.classList.remove('rz-resizing');
    // Restored a tick late, as the drag code does: putting the transition back
    // while the last size is still settling animates the final step.
    setTimeout(() => {
      panel.style.transition = transition;
    }, 10);

    const rect = panel.getBoundingClientRect();
    onResizeEnd?.({ width: rect.width, height: rect.height });
  };

  const startDrag = (dir, e) => {
    if (e.button !== 0) return;
    if (enabled && !enabled()) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = panel.getBoundingClientRect();
    const resolved = resolveAnchor();

    // A window centred by a translate (`left: 50%` plus `translateX(-50%)`)
    // can't be sized against viewport pixels while the translate is still
    // shifting it — drop it, and take the left/top the rect already measured.
    if (typeof getComputedStyle === 'function' && hasTranslation(getComputedStyle(panel).transform)) {
      panel.style.transform = 'none';
      resolved.x = 'left';
      resolved.y = 'top';
    }

    if (panel.style.position !== 'fixed' && panel.style.position !== 'absolute') {
      panel.style.position = 'fixed';
    }
    // Everything here is measured and written as the border box the pointer is
    // actually dragging. A content-box panel (the tool windows draw a 1px
    // border) would otherwise grow by its border on every drag, since the width
    // written back is the one just measured. Pinning the size at the same time
    // keeps the switch invisible: same pixels, different box.
    panel.style.boxSizing = 'border-box';
    panel.style.width = `${round(rect.width)}px`;
    panel.style.height = `${round(rect.height)}px`;
    // The stylesheet caps (`max-height: 85vh` and friends) opened the window at
    // a sensible size; from here the size is the user's.
    panel.style.maxWidth = 'none';
    panel.style.maxHeight = 'none';

    active = {
      dir,
      anchor: resolved,
      pointerX: e.clientX,
      pointerY: e.clientY,
      start: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      transition: panel.style.transition,
    };
    userSized = true;

    panel.style.transition = 'none';
    panel.classList.add('rz-resizing');
    document.body.style.cursor = CURSORS[dir] || 'default';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const created = [];
  for (const dir of handles) {
    if (!CURSORS[dir]) continue;

    const handle = document.createElement('div');
    handle.className = HANDLE_CLASS;
    handle.dataset.dir = dir;
    if (dir.length === 2) handle.dataset.corner = '1';
    handle.addEventListener('mousedown', (e) => startDrag(dir, e));
    panel.appendChild(handle);
    created.push(handle);
  }

  // A window sized to the old viewport is too big for a smaller one: pull it
  // back to what fits, then let the shared bounds code park it back on screen.
  // Only a window the user has actually sized is touched — the rest are still
  // living under their stylesheet's `max-height: 85vh` and follow on their own.
  const onWindowResize = () => {
    if (!userSized || active) return;

    const rect = panel.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const width = Math.max(minWidth, Math.min(rect.width, viewportWidth));
    const height = Math.max(
      minHeight,
      Math.min(rect.height, viewportHeight - topChromeBottom()),
    );
    if (round(width) === round(rect.width) && round(height) === round(rect.height)) return;

    const bounded = clampPanelPosition(rect.left, rect.top, { width, height });
    applyGeometry(panel, { ...bounded, width, height }, resolveAnchor());
    onResize?.({ width, height });
    onResizeEnd?.({ width, height });
  };

  window.addEventListener('resize', onWindowResize);

  return () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('resize', onWindowResize);
    for (const handle of created) handle.remove();
    if (active) {
      active = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      panel.classList.remove('rz-resizing');
    }
  };
}
