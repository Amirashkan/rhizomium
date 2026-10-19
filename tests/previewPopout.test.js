import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openPreviewPopout } from '../src/ui/previewPopout.js';
import { RenderLoop } from '../src/core/RenderLoop.js';
import { FloatingGPUPreview } from '../src/ui/FloatingGPUPreview.js';

// A stand-in for a same-agent window: its own document, its own events.
function fakeWindow({ width = 800, height = 450 } = {}) {
  const win = new EventTarget();
  win.document = document.implementation.createHTMLDocument('popout');
  win.innerWidth = width;
  win.innerHeight = height;
  win.closed = false;
  win.close = vi.fn(() => {
    win.dispatchEvent(new Event('pagehide'));
    win.closed = true;
  });
  win.requestAnimationFrame = vi.fn(() => 1);
  win.cancelAnimationFrame = vi.fn();
  return win;
}

function fakeOpener({ pip, open } = {}) {
  const opener = new EventTarget();
  opener.document = document;
  if (pip) opener.documentPictureInPicture = { requestWindow: vi.fn(async () => pip) };
  opener.open = vi.fn(() => open ?? null);
  return opener;
}

describe('openPreviewPopout', () => {
  let home;
  let canvas;

  beforeEach(() => {
    document.body.replaceChildren();
    home = document.createElement('div');
    canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 900;
    canvas.style.width = '320px';
    home.append(canvas);
    document.body.append(home);
  });

  it('moves the same canvas element into a Picture-in-Picture window and back', async () => {
    const pip = fakeWindow({ width: 800, height: 800 });
    const opener = fakeOpener({ pip });
    const onClose = vi.fn();

    const popout = await openPreviewPopout({ canvas, width: 400, height: 225, onClose, opener });

    expect(popout.kind).toBe('pip');
    expect(opener.documentPictureInPicture.requestWindow).toHaveBeenCalledWith({ width: 400, height: 225 });
    expect(opener.open).not.toHaveBeenCalled();
    expect(canvas.parentNode).toBe(pip.document.body);
    // Letterboxed to the window, aspect kept (16:9 into 800x800).
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('450px');

    popout.close();

    expect(canvas.parentNode).toBe(home);
    expect(canvas.style.width).toBe('320px');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pip.close).toHaveBeenCalled();
  });

  it('falls back to a popup and restores the canvas when the user closes it', async () => {
    const popup = fakeWindow();
    const opener = fakeOpener({ open: popup });
    const onClose = vi.fn();

    const popout = await openPreviewPopout({ canvas, width: 400, height: 225, onClose, opener });

    expect(popout.kind).toBe('popup');
    expect(canvas.parentNode).toBe(popup.document.body);

    popup.dispatchEvent(new Event('pagehide')); // window closed by the user
    expect(canvas.parentNode).toBe(home);
    expect(onClose).toHaveBeenCalledTimes(1);

    popout.close(); // idempotent
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the pop-out when the editor page goes away', async () => {
    const popup = fakeWindow();
    const opener = fakeOpener({ open: popup });
    await openPreviewPopout({ canvas, width: 400, height: 225, opener });

    opener.dispatchEvent(new Event('pagehide'));
    expect(popup.close).toHaveBeenCalled();
    expect(canvas.parentNode).toBe(home);
  });

  it('returns null and leaves the canvas alone when the popup is blocked', async () => {
    const opener = fakeOpener({ open: null });
    const popout = await openPreviewPopout({ canvas, width: 400, height: 225, opener });
    expect(popout).toBeNull();
    expect(canvas.parentNode).toBe(home);
  });
});

describe('RenderLoop.setFrameSource', () => {
  it('books frames on the given window and goes back to this one', () => {
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(7);
    const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    const loop = new RenderLoop({ onFrame: () => {} });
    loop.start();
    expect(rafSpy).toHaveBeenCalledTimes(1);

    const popup = fakeWindow();
    loop.setFrameSource(popup);
    expect(cancelSpy).toHaveBeenCalledWith(7);
    expect(popup.requestAnimationFrame).toHaveBeenCalledTimes(1);

    // A frame from the window that was swapped out is ignored.
    const onFrame = vi.spyOn(loop, '_runFrame');
    loop._handleFrame(16, globalThis);
    expect(onFrame).not.toHaveBeenCalled();

    // The popup's own frame runs and books the next one there.
    popup.requestAnimationFrame.mock.calls[0][0](16);
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(popup.requestAnimationFrame).toHaveBeenCalledTimes(2);

    loop.setFrameSource(null);
    expect(popup.cancelAnimationFrame).toHaveBeenCalled();
    expect(rafSpy).toHaveBeenCalledTimes(2);
    loop.stop();
    vi.restoreAllMocks();
  });

  it('falls back to this window if the source window has closed', () => {
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(3);
    const loop = new RenderLoop({ onFrame: () => {} });
    const popup = fakeWindow();
    popup.closed = true;
    loop.setFrameSource(popup);
    loop.start();
    expect(popup.requestAnimationFrame).not.toHaveBeenCalled();
    expect(rafSpy).toHaveBeenCalled();
    loop.stop();
    vi.restoreAllMocks();
  });
});

describe('FloatingGPUPreview pop-out', () => {
  it('hides the panel, drives the loop from the pop-out, and restores both on close', async () => {
    document.body.replaceChildren();
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const preview = new FloatingGPUPreview(canvas);
    preview.container = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.className = 'preview-canvas-wrapper';
    wrapper.append(canvas);
    preview.container.append(wrapper);
    document.body.append(preview.container);
    preview.isVisible = true;

    const pip = fakeWindow();
    window.documentPictureInPicture = { requestWindow: vi.fn(async () => pip) };
    const setFrameSource = vi.fn();
    window.renderLoop = { setFrameSource };

    try {
      await preview.popOut();
      expect(preview.isPoppedOut).toBe(true);
      expect(canvas.parentNode).toBe(pip.document.body);
      expect(preview.container.style.display).toBe('none');
      expect(setFrameSource).toHaveBeenLastCalledWith(pip);

      preview.popIn();
      expect(preview.isPoppedOut).toBe(false);
      expect(canvas.parentNode).toBe(wrapper);
      expect(preview.container.style.display).toBe('');
      expect(setFrameSource).toHaveBeenLastCalledWith(null);
    } finally {
      delete window.documentPictureInPicture;
      window.renderLoop = null;
    }
  });
});
