import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Same Tauri stand-ins the single-output tests use — see
// TauriSecondMonitorViewer.test.js. What is exercised here is the RIG: several
// windows driven from one editor over one shared broadcast.
const h = vi.hoisted(() => ({
  instances: [],
  getByLabel: vi.fn(() => Promise.resolve(null)),
  availableMonitors: vi.fn(),
  currentMonitor: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

vi.mock('@tauri-apps/api/webviewWindow', () => {
  class WebviewWindow {
    constructor(label, options) {
      this.label = label;
      this.options = options;
      this._handlers = {};
      this.setFullscreen = vi.fn(() => Promise.resolve());
      this.setFocus = vi.fn(() => Promise.resolve());
      this.close = vi.fn(() => Promise.resolve());
      h.instances.push(this);
      queueMicrotask(() => this._handlers['tauri://created']?.({ event: 'tauri://created' }));
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
import { ScreenModel, MAIN_SCREEN_ID } from '../src/screens/ScreenModel.js';
import { resolveScreenDisplay, screenWindowLabel, windowPlacementOptions } from '../src/ui/ScreenWindow.js';

const editorDisplay = { name: 'Internal', position: { x: 0, y: 0 }, size: { width: 2560, height: 1440 }, scaleFactor: 1 };
const projectorA = { name: 'Projector A', position: { x: 2560, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };
const projectorB = { name: 'Projector B', position: { x: 4480, y: 0 }, size: { width: 1920, height: 1080 }, scaleFactor: 1 };

class FakeBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.listeners = [];
    this.posted = [];
    FakeBroadcastChannel.instances.push(this);
  }
  addEventListener(type, cb) { if (type === 'message') this.listeners.push(cb); }
  removeEventListener(type, cb) { this.listeners = this.listeners.filter((l) => l !== cb); }
  postMessage(data) { this.posted.push(data); }
  close() { this.closed = true; }
  emit(data) { this.listeners.slice().forEach((l) => l({ data })); }
}
FakeBroadcastChannel.instances = [];

describe('ScreenWindow placement', () => {
  const monitors = [editorDisplay, projectorA, projectorB];

  it('honours an explicit display, the editor’s own included', () => {
    // Checking an output without a projector plugged in is a real request.
    expect(resolveScreenDisplay(monitors, 0, 0).index).toBe(0);
    expect(resolveScreenDisplay(monitors, 0, 2).monitor).toBe(projectorB);
  });

  it('takes the next display the rig has not claimed', () => {
    // Automatic placement must land three screens on three projectors, not
    // stack three windows on one.
    expect(resolveScreenDisplay(monitors, 0, -1, new Set()).index).toBe(1);
    expect(resolveScreenDisplay(monitors, 0, -1, new Set([1])).index).toBe(2);
  });

  it('opens as a movable window when there is no display left to take', () => {
    expect(resolveScreenDisplay(monitors, 0, -1, new Set([1, 2]))).toBeNull();
    expect(resolveScreenDisplay([], -1, -1)).toBeNull();
    expect(resolveScreenDisplay(monitors, 0, 9)).toBeNull(); // saved rig, display unplugged
  });

  it('divides the scale factor out of monitor bounds', () => {
    // Monitor bounds are physical pixels; window options are logical ones.
    expect(windowPlacementOptions({ position: { x: 3840, y: 0 }, size: { width: 3840, height: 2160 }, scaleFactor: 2 }))
      .toEqual({ x: 1920, y: 0, width: 1920, height: 1080 });
    expect(windowPlacementOptions(null)).toMatchObject({ center: true });
  });

  it('keeps the single-output window’s historic label', () => {
    expect(screenWindowLabel(MAIN_SCREEN_ID)).toBe('second-monitor');
    expect(screenWindowLabel('screen-2')).toBe('output-screen-2');
  });
});

describe('multi-screen output', () => {
  let source;

  const screens = (...ids) => ids.map((id) => ({
    id, name: id, enabled: true, displayIndex: -1, displayMaxDim: 0,
    region: { x: 0, y: 0, w: 1, h: 1 },
  }));

  beforeEach(() => {
    source = { width: 1920, height: 1080 };
    FakeBroadcastChannel.instances = [];
    h.instances.length = 0;
    h.getByLabel.mockReset();
    h.getByLabel.mockResolvedValue(null);
    h.availableMonitors.mockReset();
    h.availableMonitors.mockResolvedValue([editorDisplay, projectorA, projectorB]);
    h.currentMonitor.mockReset();
    h.currentMonitor.mockResolvedValue(editorDisplay);
    h.getCurrentWindow.mockReset();
    window.__TAURI_INTERNALS__ = {};
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.__TAURI_INTERNALS__;
    delete global.window.renderLoop;
  });

  it('opens one window per screen, on a display each', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    await viewer.syncScreens(screens('main', 'screen-2'));

    expect(viewer.screenCount).toBe(2);
    expect(h.instances.map((w) => w.label)).toEqual(['second-monitor', 'output-screen-2']);
    expect(h.instances[0].options).toMatchObject({ x: 2560, decorations: false });
    expect(h.instances[1].options).toMatchObject({ x: 4480, decorations: false });
    await viewer.close();
  });

  it('gives each window its own screen id in the URL', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    await viewer.syncScreens(screens('main', 'screen-2'));

    // A receiver has to know which screen it is before the first message.
    expect(h.instances[0].options.url).toContain('screen=main');
    expect(h.instances[1].options.url).toContain('screen=screen-2');
    await viewer.close();
  });

  it('opens one shared channel for the whole rig, not one per screen', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    await viewer.syncScreens(screens('main', 'screen-2', 'screen-3'));

    // The state stream is broadcast once however many screens are open — that is
    // what makes the second and third screen nearly free.
    expect(FakeBroadcastChannel.instances).toHaveLength(1);
    await viewer.close();
  });

  it('addresses each screen’s framing to that screen alone', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    const rig = screens('main', 'screen-2');
    rig[1].region = { x: 0.5, y: 0, w: 0.5, h: 1 };
    rig[1].displayMaxDim = 1920;
    await viewer.syncScreens(rig);

    const ch = FakeBroadcastChannel.instances[0];
    const configs = ch.posted.filter((m) => m.type === MSG.SCREEN_CONFIG);
    expect(configs.map((m) => m.screenId)).toEqual(['main', 'screen-2']);
    expect(configs[1]).toMatchObject({
      region: { x: 0.5, y: 0, w: 0.5, h: 1 },
      displayMaxDim: 1920,
    });
    // The render contract is per screen too.
    expect(ch.posted.filter((m) => m.type === MSG.RENDER_RES).every((m) => m.screenId)).toBe(true);
    await viewer.close();
  });

  it('reframes an open screen in place, without reopening its window', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    await viewer.syncScreens(screens('main'));
    const opened = h.instances.length;

    const moved = screens('main');
    moved[0].region = { x: 0, y: 0, w: 0.5, h: 1 };
    await viewer.syncScreens(moved);

    // A corner dragged during setup must move on the projector, not blink it.
    expect(h.instances).toHaveLength(opened);
    const ch = FakeBroadcastChannel.instances[0];
    const last = ch.posted.filter((m) => m.type === MSG.SCREEN_CONFIG).pop();
    expect(last.region).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
    await viewer.close();
  });

  it('reopens a screen that was moved to another display', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    await viewer.syncScreens(screens('main'));
    const first = h.instances[0];

    const moved = screens('main');
    moved[0].displayIndex = 2;
    await viewer.syncScreens(moved);

    // Tauri cannot move a fullscreen window between displays in place.
    expect(first.close).toHaveBeenCalled();
    expect(h.instances).toHaveLength(2);
    expect(h.instances[1].options).toMatchObject({ x: 4480 });
    await viewer.close();
  });

  it('closes only the screens dropped from the rig', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    await viewer.syncScreens(screens('main', 'screen-2'));
    const [winMain, win2] = h.instances;

    await viewer.syncScreens(screens('main'));

    expect(win2.close).toHaveBeenCalled();
    expect(winMain.close).not.toHaveBeenCalled();
    expect(viewer.isActive).toBe(true); // the rig is still live
    await viewer.close();
  });

  it('tells only the closing screen to shut down', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    await viewer.syncScreens(screens('main', 'screen-2'));
    const ch = FakeBroadcastChannel.instances[0];

    await viewer.closeScreen('screen-2');
    expect(ch.posted.filter((m) => m.type === MSG.CLOSE)).toEqual([
      { type: MSG.CLOSE, screenId: 'screen-2' },
    ]);
    await viewer.close();
  });

  it('stays active until the last screen closes, then stops the engine', async () => {
    const onActiveChange = vi.fn();
    const viewer = new TauriSecondMonitorViewer(source, { onActiveChange });
    await viewer.syncScreens(screens('main', 'screen-2'));
    expect(onActiveChange).toHaveBeenCalledTimes(1); // once, on the first screen

    await viewer.closeScreen('main');
    expect(viewer.isActive).toBe(true);
    expect(onActiveChange).toHaveBeenCalledTimes(1);

    await viewer.closeScreen('screen-2');
    expect(viewer.isActive).toBe(false);
    expect(onActiveChange).toHaveBeenLastCalledWith(false);
  });

  it('answers a READY with that screen’s own framing', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    const rig = screens('main', 'screen-2');
    rig[1].region = { x: 0.5, y: 0, w: 0.5, h: 1 };
    await viewer.syncScreens(rig);

    const ch = FakeBroadcastChannel.instances[0];
    ch.posted.length = 0;
    ch.emit({ type: MSG.READY, screenId: 'screen-2', webgpu: true });

    const config = ch.posted.find((m) => m.type === MSG.SCREEN_CONFIG);
    expect(config).toMatchObject({ screenId: 'screen-2', region: { x: 0.5, w: 0.5 } });
    await viewer.close();
  });

  it('reports a screen that shut itself down, and closes only that one', async () => {
    const onScreenSelfClosed = vi.fn();
    const viewer = new TauriSecondMonitorViewer(source, { onScreenSelfClosed });
    await viewer.syncScreens(screens('main', 'screen-2'));

    // Esc on a projector is the artist saying "not this one".
    FakeBroadcastChannel.instances[0].emit({ type: MSG.CLOSED, screenId: 'screen-2' });
    await new Promise((r) => setTimeout(r, 0));

    expect(onScreenSelfClosed).toHaveBeenCalledWith('screen-2');
    expect(viewer.isScreenOpen('screen-2')).toBe(false);
    expect(viewer.isScreenOpen('main')).toBe(true);
    await viewer.close();
  });

  it('treats an unaddressed CLOSED as the single-output screen', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    await viewer.open();

    FakeBroadcastChannel.instances[0].emit({ type: MSG.CLOSED });
    await new Promise((r) => setTimeout(r, 0));

    expect(viewer.isActive).toBe(false);
  });

  it('drives the rig from a ScreenModel', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    const model = new ScreenModel();
    model.onChange((m) => viewer.syncScreens(m.enabledScreens()));

    model.applyTiling({ cols: 3 });
    await new Promise((r) => setTimeout(r, 0));
    expect(viewer.screenCount).toBe(3);

    // Switching one off closes exactly one projector.
    model.update(model.list()[1].id, { enabled: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(viewer.screenCount).toBe(2);

    await viewer.close();
  });

  it('never opens a screen twice when rig changes arrive back to back', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    // A layout button rewrites the whole rig at once; the panel notifies per edit.
    viewer.syncScreens(screens('main', 'screen-2'));
    viewer.syncScreens(screens('main', 'screen-2'));
    await viewer.syncScreens(screens('main', 'screen-2'));

    expect(viewer.screenCount).toBe(2);
    expect(h.instances.map((w) => w.label)).toEqual(['second-monitor', 'output-screen-2']);
    await viewer.close();
  });

  it('sets a screen’s presentation resolution without touching its neighbours', async () => {
    const viewer = new TauriSecondMonitorViewer(source);
    await viewer.syncScreens(screens('main', 'screen-2'));
    const ch = FakeBroadcastChannel.instances[0];
    ch.posted.length = 0;

    viewer.setDisplayResolution(2560, 'screen-2');

    expect(viewer.displayResolutionFor('screen-2')).toBe(2560);
    expect(viewer.displayResolutionFor('main')).toBe(0);
    expect(ch.posted.filter((m) => m.type === MSG.RENDER_RES).map((m) => m.screenId))
      .toEqual(['screen-2']);
    await viewer.close();
  });
});
