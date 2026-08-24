/**
 * Regression tests: a floating window must not end up under the top menu bar.
 *
 * #top-menu-bar is fixed chrome at z-index 2000; the floating windows sit at
 * 1000-1001. Every drag handler clamped its top to 0, so a window dragged
 * upward slid its title bar entirely into the bar's band — and the title bar
 * is the only grab handle and carries the close button, so the window was
 * stranded there with the clicks going to File / Edit / View instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clampPanelPosition, topChromeBottom } from '../src/ui/utils/windowBounds.js';
import { makeDraggable } from '../src/ui/utils/draggable.js';
import { FloatingGPUPreview } from '../src/ui/FloatingGPUPreview.js';

const BAR_HEIGHT = 41;

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

function mountPanel({ width = 400, height = 300, left = 20, top = 200 } = {}) {
  const panel = document.createElement('div');
  panel.style.position = 'fixed';
  panel.getBoundingClientRect = () => ({
    left, top, right: left + width, bottom: top + height, width, height,
  });
  document.body.appendChild(panel);
  return panel;
}

function drag(handle, from, to) {
  handle.dispatchEvent(new window.MouseEvent('mousedown', {
    button: 0, clientX: from.x, clientY: from.y, bubbles: true,
  }));
  document.dispatchEvent(new window.MouseEvent('mousemove', {
    clientX: to.x, clientY: to.y, bubbles: true,
  }));
  document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }));
}

describe('floating windows stay clear of the top menu bar', () => {
  beforeEach(() => {
    window.innerWidth = 1440;
    window.innerHeight = 900;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('topChromeBottom', () => {
    it('measures the bar when one is on the page', () => {
      mountTopMenuBar();
      expect(topChromeBottom()).toBe(BAR_HEIGHT);
    });

    it('is 0 with no bar to avoid (second-monitor page)', () => {
      expect(topChromeBottom()).toBe(0);
    });

    it('is 0 while the chrome is hidden for fullscreen preview', () => {
      const bar = mountTopMenuBar();
      bar.style.display = 'none';
      expect(topChromeBottom()).toBe(0);
    });
  });

  describe('clampPanelPosition', () => {
    it('pins a window dragged upward to just under the bar', () => {
      mountTopMenuBar();
      expect(clampPanelPosition(20, -80, { width: 400, height: 300 }).top).toBe(BAR_HEIGHT);
    });

    it('leaves a position that already clears the bar alone', () => {
      mountTopMenuBar();
      expect(clampPanelPosition(20, 300, { width: 400, height: 300 }))
        .toEqual({ left: 20, top: 300 });
    });

    it('keeps the requested slice on screen at the right and bottom', () => {
      mountTopMenuBar();
      const { left, top } = clampPanelPosition(5000, 5000, { keepVisibleX: 200, keepVisibleY: 150 });
      expect(left).toBe(window.innerWidth - 200);
      expect(top).toBe(window.innerHeight - 150);
    });

    it('still clears the bar when the window is taller than the space below it', () => {
      mountTopMenuBar();
      window.innerHeight = 200;
      expect(clampPanelPosition(0, 0, { width: 400, height: 600 }).top).toBe(BAR_HEIGHT);
    });
  });

  it('makeDraggable will not park a panel under the bar', () => {
    mountTopMenuBar();
    const panel = mountPanel({ top: 200 });
    const header = document.createElement('div');
    panel.appendChild(header);

    makeDraggable(panel, header);
    drag(header, { x: 100, y: 210 }, { x: 100, y: 0 });

    expect(parseFloat(panel.style.top)).toBe(BAR_HEIGHT);
  });

  it('the floating preview keeps its header below the bar while dragging', () => {
    mountTopMenuBar();
    const canvas = document.createElement('canvas');
    const preview = new FloatingGPUPreview(canvas);

    const container = mountPanel({ width: 644, height: 401, left: 20, top: 60 });
    const header = document.createElement('div');
    header.className = 'preview-header';
    container.appendChild(header);
    preview.container = container;

    preview._setupDragging();
    // Drag 200px up from a start 60px down: without the clamp this lands at 0.
    drag(header, { x: 220, y: 78 }, { x: 220, y: -122 });
    preview._flushDragPosition();

    expect(preview.position.y).toBe(BAR_HEIGHT);
    expect(parseFloat(container.style.top)).toBe(BAR_HEIGHT);
  });
});
