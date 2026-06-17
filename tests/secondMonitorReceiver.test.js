import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initSecondMonitorReceiver } from '../src/ui/secondMonitorReceiver.js';
import {
  SecondMonitorMessage as MSG,
  SecondMonitorTier as TIER,
} from '../src/ui/secondMonitorFrameChannel.js';

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

function makeFakeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: vi.fn(() => null) };
}

// Stands in for a window-local GPURenderer (native path).
function makeFakeRenderer() {
  return {
    pipeline: {},
    device: {},
    externalUniformMode: false,
    _cachedCanvasSize: { width: 0, height: 0, clientWidth: 0, clientHeight: 0 },
    setShaderSource: vi.fn(),
    writeRawUniforms: vi.fn(),
    render: vi.fn(),
  };
}

// A fake compute runtime + factory: the factory wires globals onto the receiver's
// `win` like the real one, and initialize() builds a manager per registry entry.
function installFakeRuntime() {
  const managers = new Map();
  const computeExecutor = {
    computeManagers: managers,
    inputHashes: new Map(),
    executionOrder: [],
    _registry: null,
    initialize: vi.fn(async () => {
      computeExecutor._registry?.forEach((data, id) => {
        if (!managers.has(id)) {
          managers.set(id, { externalUniformMode: false, writeRawComputeUniforms: vi.fn() });
        }
      });
    }),
    clear: vi.fn(() => managers.clear()),
  };
  const textureManager = { injectExternalTexture: vi.fn(), destroy: vi.fn() };
  const factory = vi.fn((device, w) => {
    w.computeExecutor = computeExecutor;
    w.textureManager = textureManager;
    if (!w.computeNodeRegistry) w.computeNodeRegistry = new Map();
    computeExecutor._registry = w.computeNodeRegistry;
    return { computeExecutor, textureManager };
  });
  return { computeExecutor, textureManager, factory };
}

// Run pending micro/macrotasks a few times so chained async (renderer → runtime →
// initialize) settles.
async function settle(n = 4) { for (let i = 0; i < n; i++) await flush(); }

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('secondMonitorReceiver', () => {
  let doc, win, rafCbs, gpuCanvas, fbCanvas, fbCtx;

  beforeEach(() => {
    FakeBroadcastChannel.instances = [];
    rafCbs = [];
    gpuCanvas = makeFakeCanvas();
    fbCanvas = makeFakeCanvas();
    fbCtx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    fbCanvas.getContext = vi.fn(() => fbCtx);
    doc = {
      getElementById: vi.fn((id) => {
        if (id === 'second-monitor-gpu') return gpuCanvas;
        if (id === 'second-monitor-output') return fbCanvas;
        return null;
      }),
    };
    win = {
      innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
      performance: { now: () => 1000 },
      requestAnimationFrame: vi.fn((cb) => { rafCbs.push(cb); return rafCbs.length; }),
      cancelAnimationFrame: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setTimeout: vi.fn(),
      close: vi.fn(),
    };
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    vi.stubGlobal('navigator', { gpu: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Run the most recently scheduled rAF callback.
  const step = () => { const cb = rafCbs.pop(); rafCbs.length = 0; if (cb) cb(); };

  it('announces READY (webgpu) and reports its backing size, starting on the safe pixel tier', () => {
    const r = initSecondMonitorReceiver(doc, win, { createRenderer: () => makeFakeRenderer() });
    const ch = FakeBroadcastChannel.instances[0];
    expect(ch.posted.find((m) => m.type === MSG.READY)).toMatchObject({ webgpu: true });
    expect(ch.posted.find((m) => m.type === MSG.RESIZE)).toMatchObject({ width: 1280, height: 720 });
    expect(r.tier).toBe(TIER.FALLBACK);
  });

  it('creates its renderer in externalUniformMode and applies the broadcast shader', async () => {
    const renderer = makeFakeRenderer();
    initSecondMonitorReceiver(doc, win, { createRenderer: () => renderer });
    const ch = FakeBroadcastChannel.instances[0];

    ch.emit({ type: MSG.SHADER, wgsl: 'WGSL_MAIN' });
    await flush();

    expect(renderer.setShaderSource).toHaveBeenCalledWith('WGSL_MAIN');
    expect(renderer.externalUniformMode).toBe(true);
  });

  it('re-renders natively, overriding resolution to its own canvas and using the editor clock', async () => {
    const renderer = makeFakeRenderer();
    const r = initSecondMonitorReceiver(doc, win, { createRenderer: () => renderer });
    const ch = FakeBroadcastChannel.instances[0];

    ch.emit({ type: MSG.SHADER, wgsl: 'W' });
    await flush();

    const globals = new Float32Array([1920, 1080, 5, 0, 0, 0, 0, 0]); // editor res + time=5
    const aspect = new Float32Array([1920 / 1080, 0, 0, 0]);
    ch.emit({ type: MSG.UNIFORMS, aspect, globals, params: new Float32Array([0.5]) });

    step();

    expect(r.tier).toBe(TIER.NATIVE);
    expect(renderer.writeRawUniforms).toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalledWith({ timeSec: 5 });
    // Resolution/aspect overridden to THIS display (1280x720), not the editor's.
    expect(globals[0]).toBe(1280);
    expect(globals[1]).toBe(720);
    expect(aspect[0]).toBeCloseTo(1280 / 720, 5);
  });

  it('paints mirrored pixels in fallback mode and does not render natively', async () => {
    const renderer = makeFakeRenderer();
    initSecondMonitorReceiver(doc, win, { createRenderer: () => renderer });
    const ch = FakeBroadcastChannel.instances[0];

    ch.emit({ type: MSG.CAPS, tier: TIER.FALLBACK });
    ch.emit({ type: MSG.FRAME, bitmap: { width: 1920, height: 1080 }, sw: 1920, sh: 1080 });

    step();

    expect(fbCtx.drawImage).toHaveBeenCalled();
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('asks the editor for pixels (NEED_FALLBACK) when no native renderer can be created', async () => {
    const r = initSecondMonitorReceiver(doc, win, { createRenderer: () => null });
    const ch = FakeBroadcastChannel.instances[0];

    ch.emit({ type: MSG.CAPS, tier: TIER.NATIVE }); // editor wants native
    await flush();

    expect(ch.posted.some((m) => m.type === MSG.NEED_FALLBACK)).toBe(true);
    expect(r.tier).toBe(TIER.FALLBACK);
  });

  describe('native compute (Tier 2)', () => {
    const opts = (rt, renderer = makeFakeRenderer()) => ({
      createRenderer: () => renderer,
      createComputeRuntime: rt.factory,
    });

    it('builds the compute graph and initializes the executor on COMPUTE_GRAPH', async () => {
      const rt = installFakeRuntime();
      initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];

      ch.emit({
        type: MSG.COMPUTE_GRAPH,
        nodes: [{ id: '1', kind: 'ComputeNoise', wgsl: 'W1', width: 64, height: 64, supportsFeedback: false, inputs: [] }],
        executionOrder: ['1'],
      });
      await settle();

      expect(win.computeNodeRegistry.get('1')).toMatchObject({ wgslCode: 'W1', supportsFeedback: false });
      expect(win.graph.nodes[0]).toMatchObject({ id: '1', kind: 'ComputeNoise', computeResolution: [64, 64] });
      expect(rt.computeExecutor.initialize).toHaveBeenCalled();
      expect(rt.computeExecutor.computeManagers.get('1').externalUniformMode).toBe(true);
      expect(rt.computeExecutor.executionOrder).toEqual(['1']);
    });

    it('injects compute uniforms and invalidates input hashes when bytes change', async () => {
      const rt = installFakeRuntime();
      initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];
      ch.emit({ type: MSG.COMPUTE_GRAPH, nodes: [{ id: '1', kind: 'ComputeNoise', wgsl: 'W', width: 8, height: 8, inputs: [] }], executionOrder: ['1'] });
      await settle();
      rt.computeExecutor.inputHashes.set('1', 'stale');

      ch.emit({ type: MSG.COMPUTE_UNIFORMS, nodes: [{ id: '1', packed: new Float32Array([1, 2, 3]), colorStops: null }] });
      await settle();

      expect(rt.computeExecutor.computeManagers.get('1').writeRawComputeUniforms).toHaveBeenCalled();
      expect(rt.computeExecutor.inputHashes.has('1')).toBe(false); // changed → re-dispatch forced
    });

    it('injects a broadcast texture into the texture manager', async () => {
      const rt = installFakeRuntime();
      initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];
      ch.emit({ type: MSG.CAPS, tier: TIER.NATIVE_COMPUTE });
      await settle();

      ch.emit({ type: MSG.TEXTURE, nodeId: '7', varKind: '2d', bitmap: { width: 4, height: 4 } });
      await settle();

      expect(rt.textureManager.injectExternalTexture).toHaveBeenCalledWith('7', expect.objectContaining({ width: 4 }));
    });

    it('renders natively in the native-compute tier', async () => {
      const renderer = makeFakeRenderer();
      const rt = installFakeRuntime();
      const r = initSecondMonitorReceiver(doc, win, opts(rt, renderer));
      const ch = FakeBroadcastChannel.instances[0];
      ch.emit({ type: MSG.COMPUTE_GRAPH, nodes: [{ id: '1', kind: 'ComputeNoise', wgsl: 'W', width: 8, height: 8, inputs: [] }], executionOrder: ['1'] });
      ch.emit({ type: MSG.SHADER, wgsl: 'FRAG' });
      ch.emit({ type: MSG.UNIFORMS, aspect: new Float32Array([1, 0, 0, 0]), globals: new Float32Array([0, 0, 2, 0, 0, 0, 0, 0]), params: new Float32Array([0.5]) });
      await settle();

      expect(r.tier).toBe(TIER.NATIVE_COMPUTE);
      step();
      expect(renderer.render).toHaveBeenCalled();
    });

    it('does not create a compute runtime for a fragment-only graph', async () => {
      const rt = installFakeRuntime();
      initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];
      ch.emit({ type: MSG.SHADER, wgsl: 'FRAG' });
      ch.emit({ type: MSG.CAPS, tier: TIER.NATIVE });
      await settle();
      expect(rt.factory).not.toHaveBeenCalled();
    });

    it('tears down the compute runtime on close', async () => {
      const rt = installFakeRuntime();
      const r = initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];
      ch.emit({ type: MSG.CAPS, tier: TIER.NATIVE_COMPUTE });
      await settle();

      await r.closeSelf();

      expect(rt.computeExecutor.clear).toHaveBeenCalled();
      expect(rt.textureManager.destroy).toHaveBeenCalled();
    });
  });
});
