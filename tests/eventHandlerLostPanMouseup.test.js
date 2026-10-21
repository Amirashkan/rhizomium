/**
 * A canvas pan must end when its button is released, even if the `mouseup` never arrives.
 *
 * In the desktop (WebView2) build, dragging the window onto a display with a different
 * scale factor can swallow the left-button `mouseup`. The pan used to end only on that
 * mouseup, so the canvas stayed glued to the cursor until the next click. Every
 * mousemove carries the real button state in `buttons`, which is what these tests pin.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventHandler } from '../src/core/EventHandler.js';
import { ViewportManager } from '../src/core/ViewportManager.js';

function createEventHandler() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, x: 0, y: 0,
  });

  const viewport = new ViewportManager();

  const handler = new EventHandler({
    canvas,
    viewport,
    selection: {
      getDragging: () => false,
      getBoxSelect: () => null,
      endDrag: vi.fn(),
      cancelDrag: vi.fn(),
      graph: { nodes: [], connections: [], selection: new Set() },
    },
    connections: {
      getDragWire: () => null,
      endWireDrag: vi.fn(),
      hitOutputPin: () => null,
      hitInputPin: () => null,
    },
    menu: { hide: vi.fn(), contains: () => false },
    paramPanel: { hide: vi.fn(), panel: null },
    onChange: vi.fn(),
    onDraw: vi.fn(),
    editor: { markDirty: vi.fn(), graph: { nodes: [] } },
  });
  // Empty canvas everywhere, so every left press below starts a pan.
  handler._hitNode = () => null;
  handler.checkPreviewControlClick = () => false;
  handler.checkAnnotationPinClick = () => false;
  handler.checkDynamicInputClick = () => false;

  return { handler, canvas, viewport };
}

const mouse = (type, { x = 800, y = 500, buttons = 0 } = {}) =>
  new MouseEvent(type, { button: 0, buttons, clientX: x, clientY: y, bubbles: true, cancelable: true });

describe('canvas pan with a lost mouseup', () => {
  let ctx;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] });
    ctx = createEventHandler();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps panning while the left button is held', () => {
    const { canvas, viewport } = ctx;
    const updatePan = vi.spyOn(viewport, 'updatePan');
    canvas.dispatchEvent(mouse('mousedown', { buttons: 1 }));
    window.dispatchEvent(mouse('mousemove', { x: 850, buttons: 1 }));
    vi.runAllTimers();

    expect(viewport.isPanning()).toBe(true);
    expect(updatePan).toHaveBeenCalledWith(850, 500);
  });

  it('ends the pan on the first move after the button is released without a mouseup', () => {
    const { handler, canvas, viewport } = ctx;
    canvas.dispatchEvent(mouse('mousedown', { buttons: 1 }));
    window.dispatchEvent(mouse('mousemove', { x: 850, buttons: 1 }));
    // Released, but the mouseup was swallowed: the next move reports no button held.
    window.dispatchEvent(mouse('mousemove', { x: 900, buttons: 0 }));

    expect(viewport.isPanning()).toBe(false);
    expect(handler._isPanning).toBe(false);
    expect(handler._pendingPanUpdate).toBe(null);
  });

  it('pans normally again after a lost mouseup', () => {
    const { canvas, viewport } = ctx;
    canvas.dispatchEvent(mouse('mousedown', { buttons: 1 }));
    window.dispatchEvent(mouse('mousemove', { x: 900, buttons: 0 }));
    expect(viewport.isPanning()).toBe(false);

    canvas.dispatchEvent(mouse('mousedown', { x: 900, buttons: 1 }));
    window.dispatchEvent(mouse('mousemove', { x: 950, buttons: 1 }));
    expect(viewport.isPanning()).toBe(true);
    window.dispatchEvent(mouse('mouseup', { x: 950, buttons: 0 }));
    expect(viewport.isPanning()).toBe(false);
  });

  it('ends the pan when the window loses focus', () => {
    const { canvas, viewport } = ctx;
    canvas.dispatchEvent(mouse('mousedown', { buttons: 1 }));
    window.dispatchEvent(new Event('blur'));

    expect(viewport.isPanning()).toBe(false);
  });
});
