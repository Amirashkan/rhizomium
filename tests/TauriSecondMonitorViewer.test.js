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
import {
  SecondMonitorMessage as MSG,
  SecondMonitorTier as TIER,
} from '../src/ui/secondMonitorFrameChannel.js';

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

// Minimal renderer stand-in exposing the state + frame taps the viewer uses.
// `eligible` controls whether the current shader is reported as native-mirror
// eligible (uniforms-only) or not (textures/compute → pixel fallback).
function makeFakeRenderer({ eligible = true, tier = null } = {}) {
  let frameTap = null;
  let stateTap = null;
  const resolvedTier = tier || (eligible ? 'native' : 'fallback');
  return {
    setFrameTap: vi.fn((cb) => { frameTap = cb || null; }),
    setStateTap: vi.fn((cb) => { stateTap = cb || null; }),
    isNativeMirrorEligible: vi.fn(() => eligible),
    classifyMirrorTier: vi.fn(() => resolvedTier),
    setStateTapComputeMode: vi.fn(),
    emitFrame: (bitmap) => { if (frameTap) frameTap(bitmap); },
    emitState: (snapshot) => { if (stateTap) stateTap(snapshot); },
    get frameTap() { return frameTap; },
    get stateTap() { return stateTap; },
  };
}

// A uniform-snapshot for the given WGSL, like GPURenderer._emitStateSnapshot emits.
const snap = (wgsl) => ({
  wgsl,
  aspect: new Float32Array([1, 0, 0, 0]),
  globals: new Float32Array([1920, 1080, 0, 0, 0, 0, 0, 0]),
  params: new Float32Array([0.5]),
});

// Snapshot for a native-compute graph: also carries per-node compute uniform bytes.
const computeSnap = (wgsl) => ({
  ...snap(wgsl),
  compute: [{ id: '1', packed: new Float32Array([1, 2, 3]), colorStops: null }],
});

// Editor-side globals the viewer reads to build COMPUTE_GRAPH / TEXTURE broadcasts.
function stubComputeGlobals({ nodes = [], textures = [] } = {}) {
  const managers = new Map(
    nodes.map((n) => [n.id, { textureWidth: n.actualW || n.width, textureHeight: n.actualH || n.height }]),
  );
  global.window.computeExecutor = { executionOrder: nodes.map((n) => n.id), computeManagers: managers };
  global.window.computeNodeRegistry = new Map(
    nodes.map((n) => [n.id, {
      node: { id: n.id, kind: n.kind, inputs: n.inputs || [], computeResolution: [n.width, n.height] },
      wgslCode: n.wgsl,
      supportsFeedback: !!n.supportsFeedback,
      resolution: [n.width, n.height],
    }]),
  );
  const map = new Map(textures.map((t) => [t.nodeId, { bitmap: { width: t.w, height: t.h } }]));
  global.window.textureManager = { textures: map, getTexture(id) { return map.get(id); } };
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
    delete global.window.computeExecutor;
    delete global.window.computeNodeRegistry;
    delete global.window.textureManager;
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

  it('registers a state tap and broadcasts WGSL + uniforms for a native graph', async () => {
    const renderer = makeFakeRenderer({ eligible: true });
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();

    // Native path taps state, NOT pixels.
    expect(renderer.setStateTap).toHaveBeenCalledWith(expect.any(Function));

    const channel = FakeBroadcastChannel.instances[0];
    renderer.emitState(snap('WGSL_A'));

    expect(channel.posted.find((m) => m.type === MSG.SHADER)?.wgsl).toBe('WGSL_A');
    expect(channel.posted.find((m) => m.type === MSG.CAPS)?.tier).toBe(TIER.NATIVE);
    const uniforms = channel.posted.find((m) => m.type === MSG.UNIFORMS);
    expect(uniforms).toBeTruthy();
    expect(uniforms.globals).toBeInstanceOf(Float32Array);
    // No pixel frame tap is registered in native mode (the editor pays nothing).
    expect(renderer.setFrameTap).not.toHaveBeenCalledWith(expect.any(Function));

    await viewer.close();
    expect(renderer.setStateTap).toHaveBeenLastCalledWith(null);
  });

  it('broadcasts SHADER only when the WGSL changes, uniforms every frame', async () => {
    const renderer = makeFakeRenderer({ eligible: true });
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];

    renderer.emitState(snap('A'));
    renderer.emitState(snap('A'));
    renderer.emitState(snap('B'));

    expect(channel.posted.filter((m) => m.type === MSG.SHADER).map((m) => m.wgsl)).toEqual(['A', 'B']);
    expect(channel.posted.filter((m) => m.type === MSG.UNIFORMS)).toHaveLength(3);

    await viewer.close();
  });

  it('broadcasts compute graph, textures, and per-frame compute uniforms for a native-compute graph', async () => {
    stubComputeGlobals({
      // registry resolution is small/stale (320x240) but the manager actually
      // renders at FHD — the broadcast must carry the manager's real size.
      nodes: [{ id: '1', kind: 'ComputeNoise', wgsl: 'CWGSL', width: 320, height: 240, actualW: 1920, actualH: 1080 }],
      textures: [{ nodeId: '7', w: 4, h: 4 }],
    });
    vi.stubGlobal('createImageBitmap', vi.fn(async (src) => ({ width: src.width, height: src.height, close: vi.fn() })));

    const renderer = makeFakeRenderer({ tier: 'native-compute' });
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];

    renderer.emitState(computeSnap('WGSL_C'));
    await flush();

    expect(channel.posted.find((m) => m.type === MSG.CAPS)?.tier).toBe(TIER.NATIVE_COMPUTE);
    expect(channel.posted.find((m) => m.type === MSG.SHADER)?.wgsl).toBe('WGSL_C');
    const cg = channel.posted.find((m) => m.type === MSG.COMPUTE_GRAPH);
    expect(cg?.nodes).toHaveLength(1);
    // Broadcast carries the manager's ACTUAL (FHD) resolution, not the stale registry size.
    expect(cg.nodes[0]).toMatchObject({ id: '1', kind: 'ComputeNoise', wgsl: 'CWGSL', width: 1920, height: 1080 });
    expect(channel.posted.some((m) => m.type === MSG.TEXTURE && m.nodeId === '7')).toBe(true);
    expect(renderer.setStateTapComputeMode).toHaveBeenCalledWith(true);
    const cu = channel.posted.find((m) => m.type === MSG.COMPUTE_UNIFORMS);
    expect(cu?.nodes).toHaveLength(1);
    expect(Array.from(cu.nodes[0].packed)).toEqual([1, 2, 3]);

    await viewer.close();
  });

  it('re-sends compute graph + textures + shader on READY in native-compute', async () => {
    stubComputeGlobals({
      nodes: [{ id: '1', kind: 'ComputeNoise', wgsl: 'C', width: 8, height: 8, supportsFeedback: false }],
    });
    const renderer = makeFakeRenderer({ tier: 'native-compute' });
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];
    renderer.emitState(computeSnap('WGSL_R'));
    channel.posted.length = 0; // a late receiver missed the first broadcast

    channel.emit({ type: MSG.READY, webgpu: true });
    await flush();

    expect(channel.posted.find((m) => m.type === MSG.SHADER)?.wgsl).toBe('WGSL_R');
    expect(channel.posted.some((m) => m.type === MSG.COMPUTE_GRAPH)).toBe(true);
    expect(channel.posted.find((m) => m.type === MSG.CAPS)?.tier).toBe(TIER.NATIVE_COMPUTE);

    await viewer.close();
  });

  it('onTextureChanged broadcasts the texture when active and in native-compute', async () => {
    stubComputeGlobals({ textures: [{ nodeId: '3', w: 2, h: 2 }] });
    vi.stubGlobal('createImageBitmap', vi.fn(async (src) => ({ width: src.width, height: src.height, close: vi.fn() })));
    const renderer = makeFakeRenderer({ tier: 'native-compute' });
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];
    renderer.emitState(computeSnap('W')); // enter native-compute
    await flush();
    channel.posted.length = 0;

    viewer.onTextureChanged('3');
    await flush();

    expect(channel.posted.some((m) => m.type === MSG.TEXTURE && m.nodeId === '3')).toBe(true);
    await viewer.close();
  });

  it('falls back to the pixel frame tap for a non-native graph', async () => {
    const renderer = makeFakeRenderer({ eligible: false });
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];

    renderer.emitState(snap('WGSL_WITH_TEXTURE'));

    expect(channel.posted.find((m) => m.type === MSG.CAPS)?.tier).toBe(TIER.FALLBACK);
    expect(renderer.setFrameTap).toHaveBeenCalledWith(expect.any(Function));
    // No native state is broadcast in fallback mode.
    expect(channel.posted.some((m) => m.type === MSG.SHADER)).toBe(false);
    expect(channel.posted.some((m) => m.type === MSG.UNIFORMS)).toBe(false);

    // Pixels flow over the frame tap, and the viewer owns/frees each bitmap.
    const bitmap = { width: 1920, height: 1080, close: vi.fn() };
    renderer.emitFrame(bitmap);
    const frame = channel.posted.find((m) => m.type === MSG.FRAME);
    expect(frame?.bitmap).toBe(bitmap);
    expect(frame.sw).toBe(1920);
    expect(bitmap.close).toHaveBeenCalled();

    await viewer.close();
  });

  it('re-sends the current SHADER + CAPS when the receiver reports READY', async () => {
    const renderer = makeFakeRenderer({ eligible: true });
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];
    renderer.emitState(snap('WGSL_R'));
    channel.posted.length = 0; // a late-joining receiver missed the first broadcast

    channel.emit({ type: MSG.READY, webgpu: true });
    await flush();

    expect(channel.posted.find((m) => m.type === MSG.SHADER)?.wgsl).toBe('WGSL_R');
    expect(channel.posted.find((m) => m.type === MSG.CAPS)?.tier).toBe(TIER.NATIVE);

    await viewer.close();
  });

  it('pins the pixel path when the receiver requests NEED_FALLBACK', async () => {
    const renderer = makeFakeRenderer({ eligible: true });
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];

    channel.emit({ type: MSG.NEED_FALLBACK });
    await flush();
    renderer.emitState(snap('WGSL_X')); // even an eligible graph must stay on pixels

    expect(renderer.setFrameTap).toHaveBeenCalledWith(expect.any(Function));
    expect(channel.posted.some((m) => m.type === MSG.SHADER)).toBe(false);
    expect(channel.posted.some((m) => m.type === MSG.UNIFORMS)).toBe(false);

    await viewer.close();
  });

  it('drops tapped frames once closed instead of posting them', async () => {
    const renderer = makeFakeRenderer({ eligible: false });
    const viewer = new TauriSecondMonitorViewer(source, { renderer });
    await viewer.open();
    const channel = FakeBroadcastChannel.instances[0];
    renderer.emitState(snap('TEX')); // enter fallback so the frame tap is registered
    const frameTap = renderer.frameTap;
    await viewer.close();

    // A frame captured in-flight after close must be freed, not broadcast.
    const bitmap = { width: 1920, height: 1080, close: vi.fn() };
    frameTap(bitmap);
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
