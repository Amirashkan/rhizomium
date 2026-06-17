import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SecondMonitorViewer } from '../src/ui/SecondMonitorViewer.js';
import { isViteBuild } from '../src/utils/isViteBuild.js';

function makeFakeWindow() {
  const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = { width: 0, height: 0, style: {}, getContext: vi.fn(() => ctx) };
  const listeners = {};
  const doc = {
    open: vi.fn(),
    write: vi.fn(),
    close: vi.fn(),
    getElementById: vi.fn((id) => (id === 'second-monitor-output' ? canvas : null)),
    documentElement: { requestFullscreen: vi.fn(() => Promise.resolve()) },
  };
  const win = {
    closed: false,
    document: doc,
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
    addEventListener: vi.fn((type, cb) => {
      (listeners[type] = listeners[type] || []).push(cb);
    }),
    removeEventListener: vi.fn(),
    focus: vi.fn(),
    moveTo: vi.fn(),
    resizeTo: vi.fn(),
    close: vi.fn(function close() { this.closed = true; }),
    requestFullscreen: vi.fn(() => Promise.resolve()),
    __ctx: ctx,
    __canvas: canvas,
    __listeners: listeners,
  };
  return win;
}

// Minimal renderer stand-in exposing the frame tap the viewer registers on.
function makeFakeRenderer() {
  let tap = null;
  return {
    setFrameTap: vi.fn((cb) => { tap = cb || null; }),
    emitFrame: (bitmap) => { if (tap) tap(bitmap); },
    get tap() { return tap; },
  };
}

describe('SecondMonitorViewer', () => {
  let source;
  let fakeWin;
  let rafCallbacks;

  beforeEach(() => {
    source = { width: 1920, height: 1080 };
    fakeWin = makeFakeWindow();
    rafCallbacks = [];

    // Controllable rAF so the mirror loop can be stepped deterministically.
    vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    vi.spyOn(window, 'open').mockReturnValue(fakeWin);
    // Default: no Window Management API (forces the fallback popup path).
    delete window.getScreenDetails;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts inactive', () => {
    const viewer = new SecondMonitorViewer(source);
    expect(viewer.isActive).toBe(false);
  });

  it('opens a popup, writes the viewer document, and reports active', async () => {
    const onActiveChange = vi.fn();
    const viewer = new SecondMonitorViewer(source, { onActiveChange });

    await viewer.open();

    expect(window.open).toHaveBeenCalledTimes(1);
    const [, name, features] = window.open.mock.calls[0];
    expect(name).toBe('RhizomiumSecondMonitor');
    expect(features).toContain('popup=yes');
    // Fallback path (no Window Management API) uses a default size, not screen coords.
    expect(features).toContain('width=1280');
    expect(fakeWin.document.write).toHaveBeenCalledTimes(1);
    expect(viewer.isActive).toBe(true);
    expect(onActiveChange).toHaveBeenCalledWith(true);

    viewer.close();
  });

  it('paints the latest tapped frame into the popup each frame', async () => {
    const renderer = makeFakeRenderer();
    const viewer = new SecondMonitorViewer(source, { renderer });
    await viewer.open();

    // The viewer registers on the renderer's frame tap (not its own canvas read).
    expect(renderer.setFrameTap).toHaveBeenCalledWith(expect.any(Function));

    // Deliver a captured frame, then step one mirror frame.
    const bitmap = { width: 1920, height: 1080, close: vi.fn() };
    renderer.emitFrame(bitmap);

    expect(rafCallbacks.length).toBe(1);
    rafCallbacks[rafCallbacks.length - 1]();

    expect(fakeWin.__ctx.fillRect).toHaveBeenCalled();
    // It draws the tapped bitmap, never the live source canvas.
    expect(fakeWin.__ctx.drawImage).toHaveBeenCalledWith(
      bitmap,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );

    viewer.close();
    // Closing removes the tap and frees the held frame.
    expect(renderer.setFrameTap).toHaveBeenLastCalledWith(null);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('keeps showing the last good frame and never draws the live canvas', async () => {
    const renderer = makeFakeRenderer();
    const viewer = new SecondMonitorViewer(source, { renderer });
    await viewer.open();

    // No frame delivered yet: a mirror tick paints black only, no drawImage.
    rafCallbacks[rafCallbacks.length - 1]();
    expect(fakeWin.__ctx.fillRect).toHaveBeenCalled();
    expect(fakeWin.__ctx.drawImage).not.toHaveBeenCalled();

    // A newer frame replaces and frees the previous one.
    const first = { width: 1920, height: 1080, close: vi.fn() };
    const second = { width: 1920, height: 1080, close: vi.fn() };
    renderer.emitFrame(first);
    renderer.emitFrame(second);
    expect(first.close).toHaveBeenCalled();

    rafCallbacks[rafCallbacks.length - 1]();
    expect(fakeWin.__ctx.drawImage).toHaveBeenLastCalledWith(
      second,
      expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number),
    );

    viewer.close();
  });

  it('reports an error and stays inactive when the popup is blocked', async () => {
    window.open.mockReturnValue(null);
    const onStatus = vi.fn();
    const onActiveChange = vi.fn();
    const viewer = new SecondMonitorViewer(source, { onStatus, onActiveChange });

    await viewer.open();

    expect(viewer.isActive).toBe(false);
    expect(onActiveChange).not.toHaveBeenCalledWith(true);
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('Popup blocked'), 'error');
  });

  it('toggle opens then closes', async () => {
    const onActiveChange = vi.fn();
    const viewer = new SecondMonitorViewer(source, { onActiveChange });

    const first = await viewer.toggle();
    expect(first).toBe(true);
    expect(viewer.isActive).toBe(true);

    const second = await viewer.toggle();
    expect(second).toBe(false);
    expect(fakeWin.close).toHaveBeenCalled();
    expect(viewer.isActive).toBe(false);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('closes when Escape is pressed in the popup', async () => {
    const viewer = new SecondMonitorViewer(source);
    await viewer.open();

    const keyHandlers = fakeWin.__listeners.keydown || [];
    expect(keyHandlers.length).toBe(1);
    keyHandlers[0]({ key: 'Escape' });

    expect(fakeWin.close).toHaveBeenCalled();
    expect(viewer.isActive).toBe(false);
  });

  it('opens synchronously (within the user gesture), before screen detection', async () => {
    // Regression: awaiting getScreenDetails() before window.open() spends the
    // click's user activation and the browser blocks the popup. window.open must
    // be called before any await resolves.
    let resolveDetails;
    window.getScreenDetails = vi.fn(() => new Promise((r) => { resolveDetails = r; }));

    const viewer = new SecondMonitorViewer(source);
    const opening = viewer.open();

    // Popup is already open even though screen detection hasn't resolved yet.
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(viewer.isActive).toBe(true);

    resolveDetails({ screens: [], currentScreen: null });
    await opening;

    viewer.close();
  });

  it('moves the popup onto an external display via the Window Management API', async () => {
    const external = {
      isInternal: false,
      availLeft: 2560, availTop: 0, availWidth: 1920, availHeight: 1080,
    };
    const current = { isInternal: true, availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1440 };
    window.getScreenDetails = vi.fn().mockResolvedValue({
      screens: [current, external],
      currentScreen: current,
    });

    const onStatus = vi.fn();
    const viewer = new SecondMonitorViewer(source, { onStatus });
    await viewer.open();

    expect(fakeWin.moveTo).toHaveBeenCalledWith(2560, 0);
    expect(fakeWin.resizeTo).toHaveBeenCalledWith(1920, 1080);
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('external display'));

    viewer.close();
  });
});

describe('isViteBuild', () => {
  it('is true under the Vite-powered test runner', () => {
    // Vitest runs through Vite, so import.meta.env is defined here. The raw
    // Python-server / Vercel deployments serve untransformed source where it is
    // undefined and this returns false.
    expect(isViteBuild()).toBe(true);
  });
});
