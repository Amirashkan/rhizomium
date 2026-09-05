/**
 * The floating windows are sizable from every edge and corner.
 *
 * They could always be moved, never sized: each one opened at the width its
 * stylesheet gave it, so a long shader listing or a screens rig was read
 * through a fixed slot. makeResizable adds the eight grab zones; what the
 * tests below pin down is the part that is easy to get wrong — the edge that
 * is NOT being dragged has to stay exactly where it is, through the minimum
 * size, through the viewport edges, and through the top menu bar.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeResizable, resolveResize, HANDLE_CLASS } from '../src/ui/utils/resizable.js';

const BAR_HEIGHT = 41;
const START = { left: 100, top: 100, width: 400, height: 300 };
const LIMITS = { minWidth: 200, minHeight: 150 };

/** Stand in for the real #top-menu-bar: happy-dom lays nothing out. */
function mountTopMenuBar(height = BAR_HEIGHT) {
  const bar = document.createElement('div');
  bar.id = 'top-menu-bar';
  bar.getBoundingClientRect = () => ({
    top: 0, bottom: height, left: 0, right: window.innerWidth,
    width: window.innerWidth, height,
  });
  document.body.appendChild(bar);
  return bar;
}

/** The 1px border every tool window draws, counted twice per axis. */
const BORDER = 2;

/**
 * A panel whose measured rect follows the geometry actually written to it.
 *
 * It measures the way a bordered panel really does: `content-box` until
 * something says otherwise, so the rect is 2px larger than the width written
 * to it — the case that made every drag grow the window by its border.
 */
function mountPanel({ left = 100, top = 100, width = 400, height = 300 } = {}) {
  const panel = document.createElement('div');
  panel.style.position = 'fixed';
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.width = `${width - BORDER}px`;
  panel.style.height = `${height - BORDER}px`;
  panel.getBoundingClientRect = () => {
    const box = panel.style.boxSizing === 'border-box' ? 0 : BORDER;
    const w = (parseFloat(panel.style.width) || 0) + box;
    const h = (parseFloat(panel.style.height) || 0) + box;
    const l = panel.style.left === 'auto'
      ? window.innerWidth - (parseFloat(panel.style.right) || 0) - w
      : parseFloat(panel.style.left) || 0;
    const t = panel.style.top === 'auto'
      ? window.innerHeight - (parseFloat(panel.style.bottom) || 0) - h
      : parseFloat(panel.style.top) || 0;
    return { left: l, top: t, right: l + w, bottom: t + h, width: w, height: h };
  };
  document.body.appendChild(panel);
  return panel;
}

function handleFor(panel, dir) {
  return panel.querySelector(`.${HANDLE_CLASS}[data-dir="${dir}"]`);
}

function dragHandle(panel, dir, from, to) {
  const handle = handleFor(panel, dir);
  handle.dispatchEvent(new window.MouseEvent('mousedown', {
    button: 0, clientX: from.x, clientY: from.y, bubbles: true,
  }));
  document.dispatchEvent(new window.MouseEvent('mousemove', {
    clientX: to.x, clientY: to.y, bubbles: true,
  }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
}

/** The geometry as the panel now reports it, rounded like the writes are. */
function geometryOf(panel) {
  const rect = panel.getBoundingClientRect();
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

describe('resolveResize', () => {
  beforeEach(() => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = '';
  });

  it('moves only the dragged edge', () => {
    expect(resolveResize('e', START, 120, 40, LIMITS))
      .toEqual({ left: 100, top: 100, width: 520, height: 300 });
    expect(resolveResize('s', START, 40, 120, LIMITS))
      .toEqual({ left: 100, top: 100, width: 400, height: 420 });
  });

  it('grows leftward from the west edge, holding the right edge still', () => {
    const { left, width } = resolveResize('w', START, -60, 0, LIMITS);
    expect({ left, width }).toEqual({ left: 40, width: 460 });
    expect(left + width).toBe(START.left + START.width);
  });

  it('grows upward from the north edge, holding the bottom edge still', () => {
    const { top, height } = resolveResize('n', START, 0, -50, LIMITS);
    expect({ top, height }).toEqual({ top: 50, height: 350 });
    expect(top + height).toBe(START.top + START.height);
  });

  it('moves both edges of a corner at once', () => {
    expect(resolveResize('nw', START, -20, -30, LIMITS))
      .toEqual({ left: 80, top: 70, width: 420, height: 330 });
  });

  it('stops at the minimum without dragging the held edge past it', () => {
    const shrunk = resolveResize('w', START, 900, 0, LIMITS);
    expect(shrunk.width).toBe(LIMITS.minWidth);
    // The right edge is where it started: the window shrank, it did not move.
    expect(shrunk.left + shrunk.width).toBe(START.left + START.width);

    const squashed = resolveResize('n', START, 0, 900, LIMITS);
    expect(squashed.height).toBe(LIMITS.minHeight);
    expect(squashed.top + squashed.height).toBe(START.top + START.height);
  });

  it('will not push the west edge off screen', () => {
    const { left, width } = resolveResize('w', START, -400, 0, LIMITS);
    expect(left).toBe(0);
    expect(left + width).toBe(START.left + START.width);
  });

  it('will not pull the north edge under the top menu bar', () => {
    mountTopMenuBar();
    const { top, height } = resolveResize('n', START, 0, -300, LIMITS);
    expect(top).toBe(BAR_HEIGHT);
    expect(top + height).toBe(START.top + START.height);
  });

  it('will not grow past the right or bottom of the viewport', () => {
    window.innerWidth = 800;
    window.innerHeight = 600;
    expect(resolveResize('e', START, 5000, 0, LIMITS).width).toBe(800 - START.left);
    expect(resolveResize('s', START, 0, 5000, LIMITS).height).toBe(600 - START.top);
  });
});

describe('makeResizable', () => {
  let cleanup = null;

  beforeEach(() => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = '';
    document.getElementById('rz-resizable-styles')?.remove();
  });

  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('installs a handle for every edge and corner', () => {
    const panel = mountPanel();
    cleanup = makeResizable(panel);

    const dirs = [...panel.querySelectorAll(`.${HANDLE_CLASS}`)].map((el) => el.dataset.dir);
    expect(dirs.sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });

  it('writes the new size to the panel as it is dragged', () => {
    const panel = mountPanel();
    cleanup = makeResizable(panel, LIMITS);

    dragHandle(panel, 'se', { x: 500, y: 400 }, { x: 620, y: 460 });
    expect(geometryOf(panel)).toEqual({ left: 100, top: 100, width: 520, height: 360 });
  });

  it('lets the window off its stylesheet size cap once the user sizes it', () => {
    const panel = mountPanel();
    panel.style.maxWidth = '90vw';
    panel.style.maxHeight = '85vh';
    cleanup = makeResizable(panel, LIMITS);

    dragHandle(panel, 's', { x: 300, y: 400 }, { x: 300, y: 700 });
    expect(panel.style.maxWidth).toBe('none');
    expect(panel.style.maxHeight).toBe('none');
  });

  it('keeps a right-anchored window in its corner', () => {
    const panel = mountPanel();
    panel.style.left = 'auto';
    panel.style.right = '16px';
    cleanup = makeResizable(panel, { ...LIMITS, anchor: { x: 'right', y: 'top' } });

    // Widening from the west edge grows into the canvas, not off the screen.
    dragHandle(panel, 'w', { x: 1024, y: 300 }, { x: 924, y: 300 });
    expect(panel.style.right).toBe('16px');
    expect(panel.style.left).toBe('auto');
    expect(geometryOf(panel).width).toBe(500);
  });

  it('keeps a bottom-anchored window on its edge', () => {
    const panel = mountPanel();
    panel.style.top = 'auto';
    panel.style.bottom = '16px';
    cleanup = makeResizable(panel, { ...LIMITS, anchor: { x: 'left', y: 'bottom' } });

    dragHandle(panel, 'n', { x: 300, y: 584 }, { x: 300, y: 484 });
    expect(panel.style.bottom).toBe('16px');
    expect(panel.style.top).toBe('auto');
    expect(geometryOf(panel).height).toBe(400);
  });

  it('drops a centring translate rather than writing pixels over it', () => {
    const panel = mountPanel();
    panel.style.transform = 'translateX(-50%)';
    cleanup = makeResizable(panel, LIMITS);

    dragHandle(panel, 'e', { x: 500, y: 300 }, { x: 560, y: 300 });
    expect(panel.style.transform).toBe('none');
    expect(geometryOf(panel).width).toBe(460);
  });

  it('reports each step to the caller, so a canvas can follow', () => {
    const panel = mountPanel();
    const sizes = [];
    cleanup = makeResizable(panel, { ...LIMITS, onResize: (size) => sizes.push(size) });

    dragHandle(panel, 'se', { x: 500, y: 400 }, { x: 560, y: 440 });
    expect(sizes).toEqual([{ width: 460, height: 340 }]);
  });

  it('stands aside while the window is not the user\'s to size', () => {
    const panel = mountPanel();
    let locked = true;
    cleanup = makeResizable(panel, { ...LIMITS, enabled: () => !locked });

    dragHandle(panel, 'se', { x: 500, y: 400 }, { x: 600, y: 500 });
    expect(geometryOf(panel)).toEqual({ left: 100, top: 100, width: 400, height: 300 });

    locked = false;
    dragHandle(panel, 'se', { x: 500, y: 400 }, { x: 600, y: 500 });
    expect(geometryOf(panel)).toEqual({ left: 100, top: 100, width: 500, height: 400 });
  });

  it('pulls a user-sized window back into a viewport that has shrunk', () => {
    mountTopMenuBar();
    const panel = mountPanel();
    cleanup = makeResizable(panel, LIMITS);

    dragHandle(panel, 'se', { x: 500, y: 400 }, { x: 900, y: 700 });
    expect(geometryOf(panel)).toMatchObject({ width: 800, height: 600 });

    window.innerWidth = 600;
    window.innerHeight = 400;
    window.dispatchEvent(new window.Event('resize'));

    const after = geometryOf(panel);
    expect(after.width).toBeLessThanOrEqual(600);
    expect(after.height).toBeLessThanOrEqual(400 - BAR_HEIGHT);
    expect(after.top).toBeGreaterThanOrEqual(BAR_HEIGHT);
  });

  it('leaves a window nobody has sized to its stylesheet', () => {
    const panel = mountPanel();
    cleanup = makeResizable(panel, LIMITS);

    window.innerWidth = 300;
    window.innerHeight = 200;
    window.dispatchEvent(new window.Event('resize'));

    expect(geometryOf(panel)).toEqual({ left: 100, top: 100, width: 400, height: 300 });
  });

  it('does not grow by the window border on every drag', () => {
    const panel = mountPanel();
    cleanup = makeResizable(panel, LIMITS);

    // Three drags of 50px each: a bordered window used to pick up its 2px
    // border every time, because the width written back was the measured one.
    dragHandle(panel, 'e', { x: 500, y: 300 }, { x: 550, y: 300 });
    dragHandle(panel, 'e', { x: 550, y: 300 }, { x: 600, y: 300 });
    dragHandle(panel, 'e', { x: 600, y: 300 }, { x: 650, y: 300 });

    expect(geometryOf(panel).width).toBe(550);
  });

  it('takes its handles and listeners away on cleanup', () => {
    const panel = mountPanel();
    makeResizable(panel, LIMITS)();

    expect(panel.querySelectorAll(`.${HANDLE_CLASS}`)).toHaveLength(0);
  });
});
