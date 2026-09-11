/**
 * Right-click must open the add-node palette on every platform the editor ships to.
 *
 * The desktop (WebView2) build had no right-click at all: Chromium runs the native
 * context menu in a nested message loop that consumes the right-button `mouseup`
 * before the page sees it, so the palette — which opens on that mouseup — never
 * opened, and a right-drag box-select never ended. A browser on Linux dispatches
 * `contextmenu` on mousedown, with the button still held, and delivers the mouseup
 * normally, which is why it only ever broke in the packaged app.
 *
 * These tests pin both event orders. The `buttons` field is what tells them apart
 * and is therefore the load-bearing detail in every case below.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventHandler } from '../src/core/EventHandler.js';

function createEventHandler() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  // happy-dom lays nothing out, and the handler only reacts to right-presses that
  // land on the editor surface.
  canvas.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, x: 0, y: 0,
  });

  const menu = {
    hide: vi.fn(),
    contains: () => false,
    showRadialMenu: vi.fn(),
    showNodeMenu: vi.fn(),
  };

  const boxSelect = { active: false };
  const selection = {
    getDragging: () => false,
    getBoxSelect: () => (boxSelect.active ? { x: 0, y: 0 } : null),
    startBoxSelect: vi.fn(() => { boxSelect.active = true; }),
    updateBoxSelect: vi.fn(),
    endBoxSelect: vi.fn(() => { boxSelect.active = false; }),
    endDrag: vi.fn(),
    cancelDrag: vi.fn(),
    deleteSelected: vi.fn(),
    graph: { selection: new Set() },
  };

  const handler = new EventHandler({
    canvas,
    viewport: {
      isPanning: () => false,
      stopPan: vi.fn(),
      updatePan: vi.fn(() => false),
      zoom: vi.fn(() => false),
      screenToCanvas: (x, y) => ({ x, y }),
      canvasToScreen: (x, y) => ({ x, y }),
    },
    selection,
    connections: { getDragWire: () => null, endWireDrag: vi.fn() },
    menu,
    paramPanel: { hide: vi.fn(), panel: null },
    onChange: vi.fn(),
    onDraw: vi.fn(),
    editor: { markDirty: vi.fn(), graph: { nodes: [] } },
  });
  // No nodes, so every right-click below lands on empty canvas.
  handler._hitNode = () => null;

  return { handler, canvas, menu, selection, boxSelect };
}

const at = (type, { x = 800, y = 500, buttons = 0 } = {}) =>
  new MouseEvent(type, { button: 2, buttons, clientX: x, clientY: y, bubbles: true, cancelable: true });

describe('right-click opens the add-node palette', () => {
  let ctx;
  beforeEach(() => { ctx = createEventHandler(); });
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('opens once on the Linux order: contextmenu while the button is still held, then mouseup', () => {
    const { canvas, menu } = ctx;
    canvas.dispatchEvent(at('mousedown', { buttons: 2 }));
    // Button still down: the real mouseup is still coming, so nothing is replayed.
    canvas.dispatchEvent(at('contextmenu', { buttons: 2 }));
    expect(menu.showRadialMenu).not.toHaveBeenCalled();

    canvas.dispatchEvent(at('mouseup', { buttons: 0 }));
    expect(menu.showRadialMenu).toHaveBeenCalledTimes(1);
  });

  it('opens once on the Windows order, where the mouseup is eaten and never arrives', () => {
    const { canvas, menu } = ctx;
    canvas.dispatchEvent(at('mousedown', { buttons: 2 }));
    // The button is already up by the time contextmenu lands, and no mouseup ever comes.
    canvas.dispatchEvent(at('contextmenu', { buttons: 0 }));
    expect(menu.showRadialMenu).toHaveBeenCalledTimes(1);
  });

  it('does not open twice where a platform delivers both the mouseup and contextmenu', () => {
    const { canvas, menu } = ctx;
    canvas.dispatchEvent(at('mousedown', { buttons: 2 }));
    canvas.dispatchEvent(at('mouseup', { buttons: 0 }));
    canvas.dispatchEvent(at('contextmenu', { buttons: 0 }));
    expect(menu.showRadialMenu).toHaveBeenCalledTimes(1);
  });

  it('stays shut for a right-drag, which is a box-select, on the Windows order', () => {
    const { canvas, menu, selection } = ctx;
    canvas.dispatchEvent(at('mousedown', { buttons: 2 }));
    document.dispatchEvent(at('mousemove', { x: 900, y: 560, buttons: 2 }));
    canvas.dispatchEvent(at('contextmenu', { x: 900, y: 560, buttons: 0 }));

    expect(menu.showRadialMenu).not.toHaveBeenCalled();
    // And the drag must still be released: the replayed mouseup is what ends it,
    // otherwise the selection box stays stuck on screen for the rest of the session.
    expect(selection.endBoxSelect).toHaveBeenCalled();
  });

  it('ignores a contextmenu with no right-press behind it, such as the keyboard menu key', () => {
    const { canvas, menu } = ctx;
    canvas.dispatchEvent(at('contextmenu', { buttons: 0 }));
    expect(menu.showRadialMenu).not.toHaveBeenCalled();
  });
});

describe('3D viewport right-drag zoom releases on Windows', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  async function createCamera() {
    const { CameraController } = await import('../src/scene/CameraController.js');
    const domElement = document.createElement('canvas');
    document.body.appendChild(domElement);
    const camera = {
      transform: { setPosition: vi.fn(), lookAt: vi.fn() },
      lookAt: vi.fn(),
      updateProjectionMatrix: vi.fn(),
    };
    return new CameraController(camera, domElement);
  }

  it('ends the zoom when the mouseup has been eaten by the context menu', async () => {
    const controller = await createCamera();
    controller.domElement.dispatchEvent(at('mousedown', { buttons: 2 }));
    expect(controller.isZooming).toBe(true);

    // No mouseup ever arrives; contextmenu with the button already up is all we get.
    controller.domElement.dispatchEvent(at('contextmenu', { buttons: 0 }));
    expect(controller.isZooming).toBe(false);
  });

  it('leaves an in-progress zoom alone while the button is still held', async () => {
    const controller = await createCamera();
    controller.domElement.dispatchEvent(at('mousedown', { buttons: 2 }));
    controller.domElement.dispatchEvent(at('contextmenu', { buttons: 2 }));
    expect(controller.isZooming).toBe(true);

    document.dispatchEvent(at('mouseup', { buttons: 0 }));
    expect(controller.isZooming).toBe(false);
  });
});
