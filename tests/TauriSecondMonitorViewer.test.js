import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Shared mock state. vi.hoisted runs before the vi.mock factories (and before
// the module imports) with `vi` already initialised, so the persistent mock
// fns can be created here and referenced from the factories safely.
const h = vi.hoisted(() => ({
  instances: [],
  getByLabel: vi.fn(() => Promise.resolve(null)),
  availableMonitors: vi.fn(),
  currentMonitor: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

// --- Mock the Tauri JS API modules (resolved via dynamic import in the SUT) ---
vi.mock('@tauri-apps/api/webviewWindow', () => {
  class WebviewWindow {
    constructor(label, options) {
      this.label = label;
      this.options = options;
      this._handlers = {};
      this.setFullscreen = vi.fn(() => Promise.resolve());
      this.setFocus = vi.fn(() => Promise.resolve());
      this.setDecorations = vi.fn(() => Promise.resolve());
      this.close = vi.fn(() => Promise.resolve());
      h.instances.push(this);
      // Fire created once the caller has registered its once() handlers.
      queueMicrotask(() => {
        const cb = this._handlers['tauri://created'];
        if (cb) cb({ event: 'tauri://created' });
      });
    }
    once(event, cb) { this._handlers[event] = cb; return Promise.resolve(() => {}); }
    static getByLabel(...args) { return h.getByLabel(...args); }
  }
  return { WebviewWindow };
});

vi.mock('@tauri-apps/api/window', () => ({
  availableMonitors: (...a) => h.availableMonitors(...a),
  currentMonitor: (...a) => h.currentMonitor(...a),
  getCurrentWindow: (...a) => h.getCurrentWindow(...a),
}));

import { TauriSecondMonitorViewer } from '../src/ui/TauriSecondMonitorViewer.js';
import { SecondMonitorMessage as MSG } from '../src/ui/secondMonitorFrameChannel.js';

const monitorInternal = { name: 'Internal', position: { x: 0, y: 0 }, size: { width: 2560, height: 1440 }, scaleFactor: 1 };
const monitorExternal = { name: 'External', position: { x: 2560, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };

class FakeBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.listeners = [];
    this.posted = [];
    this.closed = false;
    FakeBroadcastChannel.instances.push(this);
  }
  addEventListener(type, cb) { if (type === 'message') this.listeners.push(cb); }
  removeEventListener(type, cb) { this.listeners = this.listeners.filter((l) => l !== cb); }
  postMessage(data) { this.posted.push(data); }
  close() { this.closed = true; }
  emit(data) { this.listeners.slice().forEach((l) => l({ data })); }
}
FakeBroadcastChannel.instances = [];

// Minimal renderer stand-in exposing the frame tap the viewer registers on.
function makeFakeRenderer() {
  let tap = null;
  return {
    setFrameTap: vi.fn((cb) => { tap = cb || null; }),
    emitFrame: (bitmap) => { if (tap) tap(bitmap); },
    get tap() { return tap; },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('TauriSecondMonitorViewer', () => {
  let source;
  let rafCallbacks;

  beforeEach(() => {
    source = { width: 1920, height: 1080 };
    rafCallbacks = [];
    FakeBroadcastChannel.instances = [];
    h.instances.length = 0;
    h.getByLabel.mockReset();
    h.getByLabel.mockResolvedValue(null);
    h.availableMonitors.mockReset();
    h.availableMonitors.mockResolvedValue([monitorInternal, monitorExternal]);
    h.currentMonitor.mockReset();
    h.currentMonitor.mockResolvedValue(monitorInternal);

    window.__TAURI_INTERNALS__ = {};

    vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => { rafCallbacks.push(cb); return rafCallbacks.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve({ close: vi.fn(), width: 1920, height: 1080 })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.__TAURI_INTERNALS__;
  });

  it('starts inactive', () => {
    expect(new TauriSecondMonitorViewer(source).isActive).toBe(false);
  });

  it('opens a borderless fullscreen native window on the external display', async () => {
    const onActiveChange = vi.fn();
    const viewer = new TauriSecondMonitorViewer(source, { onActiveChange });

    await viewer.open();

    expect(viewer.isActive).toBe(true);
    expect(h.instances).toHaveLength(1);
    const win = h.instances[0];
    expect(win.label).toBe('second-monitor');
    expect(win.options).toMatchObject({
      decorations: false,
      alwaysOnTop: true,
      x: 2560, y: 0, width: 1920, height: 1080,
    });
    expect(win.options.url).toContain('second-monitor.html');
    expect(win.setFullscreen).toHaveBeenCalledWith(true);
    expect(onActiveChange).toHaveBeenCalledWith(true);

    await viewer.close();
  });

  it('registers a renderer frame tap and broadcasts each tapped frame', async () => {
    const renderer = makeFakeRenderer();
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();

    expect(renderer.setFrameTap).toHaveBeenCalledWith(expect.any(Function));

    const channel = FakeBroadcastChannel.instances[0];
    const bitmap = { width: 1920, height: 1080, close: vi.fn() };
    renderer.emitFrame(bitmap);

    const frame = channel.posted.find((m) => m.type === MSG.FRAME);
    expect(frame).toBeTruthy();
    expect(frame.sw).toBe(1920);
    expect(frame.sh).toBe(1080);
    expect(frame.bitmap).toBe(bitmap);
    // The viewer owns the tapped bitmap and frees it after the synchronous clone.
    expect(bitmap.close).toHaveBeenCalled();

    await viewer.close();
    // Tap is removed on close so the renderer stops capturing for us.
    expect(renderer.setFrameTap).toHaveBeenLastCalledWith(null);
  });

  it('drops tapped frames once closed instead of posting them', async () => {
    const renderer = makeFakeRenderer();
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];
    const tap = renderer.tap;
    await viewer.close();

    // A frame captured in-flight after close must be freed, not broadcast.
    const bitmap = { width: 1920, height: 1080, close: vi.fn() };
    tap(bitmap);
    expect(channel.posted.some((m) => m.type === MSG.FRAME)).toBe(false);
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('close() tells the receiver, closes the window and channel, and reports inactive', async () => {
    const onActiveChange = vi.fn();
    const viewer = new TauriSecondMonitorViewer(source, { onActiveChange });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];
    const win = h.instances[0];

    await viewer.close();

    expect(channel.posted.some((m) => m.type === MSG.CLOSE)).toBe(true);
    expect(win.close).toHaveBeenCalled();
    expect(channel.closed).toBe(true);
    expect(viewer.isActive).toBe(false);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('closes when the receiver broadcasts CLOSED (Esc / native close)', async () => {
    const onActiveChange = vi.fn();
    const viewer = new TauriSecondMonitorViewer(source, { onActiveChange });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];
    const win = h.instances[0];

    channel.emit({ type: MSG.CLOSED });
    await flush();

    expect(viewer.isActive).toBe(false);
    expect(win.close).toHaveBeenCalled();
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('falls back to a centred, decorated window when only one display is present', async () => {
    h.availableMonitors.mockResolvedValue([monitorInternal]);
    h.currentMonitor.mockResolvedValue(monitorInternal);

    const viewer = new TauriSecondMonitorViewer(source);
    await viewer.open();

    const win = h.instances[0];
    expect(win.options).toMatchObject({ decorations: true, center: true, width: 1280, height: 720 });
    expect(win.setFullscreen).not.toHaveBeenCalled();

    await viewer.close();
  });

  it('reports an error and stays inactive when BroadcastChannel is unavailable', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const onStatus = vi.fn();
    const onActiveChange = vi.fn();
    const viewer = new TauriSecondMonitorViewer(source, { onStatus, onActiveChange });

    await viewer.open();

    expect(viewer.isActive).toBe(false);
    expect(h.instances).toHaveLength(0);
    expect(onActiveChange).not.toHaveBeenCalledWith(true);
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('Could not open'), 'error');
  });

  it('refuses to open outside the desktop app', async () => {
    delete window.__TAURI_INTERNALS__;
    const onStatus = vi.fn();
    const viewer = new TauriSecondMonitorViewer(source, { onStatus });

    await viewer.open();

    expect(viewer.isActive).toBe(false);
    expect(onStatus).toHaveBeenCalledWith(expect.stringContaining('desktop app'), 'error');
  });

  it('toggle opens then closes', async () => {
    const viewer = new TauriSecondMonitorViewer(source);

    expect(await viewer.toggle()).toBe(true);
    expect(viewer.isActive).toBe(true);

    expect(await viewer.toggle()).toBe(false);
    expect(viewer.isActive).toBe(false);
  });
});
