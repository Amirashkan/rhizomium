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
  // Stand-in for the executor's FragmentTextureRenderer (fragment-fed compute).
  const fragmentRenderer = {
    externalUniformMode: false,
    externalUniforms: new Map(),
    parameterHashes: new Map(),
    clearCache: vi.fn(),
  };
  const computeExecutor = {
    computeManagers: managers,
    fragmentRenderer,
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
    if (!w.graph) {
      w.graph = { nodes: [], getNode(id) { return this.nodes.find((n) => String(n.id) === String(id)) || null; } };
    }
    computeExecutor._registry = w.computeNodeRegistry;
    return { computeExecutor, textureManager };
  });
  return { computeExecutor, textureManager, fragmentRenderer, factory };
}

// Run pending micro/macrotasks a few times so chained async (renderer → runtime →
// initialize) settles.
async function settle(n = 4) { for (let i = 0; i < n; i++) await flush(); }

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('secondMonitorReceiver', () => {
  let doc, win, rafCbs, gpuCanvas, fbCanvas, fbCtx, clock;

  beforeEach(() => {
    FakeBroadcastChannel.instances = [];
    clock = 1000; // mutable wall clock shared by performance.now() and rAF timestamps
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
      performance: { now: () => clock },
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

  // Advance the clock by dtMs (default one 60fps frame) and run the most recently
  // scheduled rAF callback with the new timestamp. The receiver paces rendering on
  // this clock, so tests must advance it to drive frames.
  const step = (dtMs = 1000 / 60) => {
    clock += dtMs;
    const cb = rafCbs.pop();
    rafCbs.length = 0;
    if (cb) cb(clock);
  };

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
    expect(renderer.sampleCount).toBe(1); // no MSAA on the output blit (saves GPU)
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

  // Render pacing: the receiver renders the latest state on its OWN steady ~60fps
  // clock — NOT once per inbound message (which beat against vsync) — but throttled
  // so a high-refresh display can't over-drive compute, and held when idle.
  const primeNative = async (renderer) => {
    initSecondMonitorReceiver(doc, win, { createRenderer: () => renderer });
    const ch = FakeBroadcastChannel.instances[0];
    ch.emit({ type: MSG.SHADER, wgsl: 'W' });
    await flush();
    ch.emit({
      type: MSG.UNIFORMS,
      aspect: new Float32Array([1, 0, 0, 0]),
      globals: new Float32Array([0, 0, 1, 0, 0, 0, 0, 0]),
      params: new Float32Array([0]),
    });
    return ch;
  };

  it('renders at a steady cap on its own clock, not once per message', async () => {
    const renderer = makeFakeRenderer();
    await primeNative(renderer);

    step(); // one 60fps step → renders
    expect(renderer.render).toHaveBeenCalledTimes(1);

    // A sub-frame rAF (too soon) is throttled — caps compute on a high-refresh display.
    step(4);
    expect(renderer.render).toHaveBeenCalledTimes(1);

    // The next full step renders again WITHOUT any new message: we pace on our own
    // clock, so there is no message-arrival/vsync beat.
    step();
    expect(renderer.render).toHaveBeenCalledTimes(2);
  });

  it('renders every frame on a panel just above 60Hz (no accumulator drift skip)', async () => {
    const renderer = makeFakeRenderer();
    const ch = await primeNative(renderer);
    const emitFrame = (t) => ch.emit({
      type: MSG.UNIFORMS,
      aspect: new Float32Array([1, 0, 0, 0]),
      globals: new Float32Array([0, 0, t, 0, 0, 0, 0, 0]),
      params: new Float32Array([0]),
    });

    // dt just under a 60fps step (panel a hair above 60Hz, editor broadcasting each
    // frame): a carry accumulator would drift and drop a frame every few seconds —
    // the irregular hitch. Elapsed-since-last-render + tolerance renders every frame.
    for (let i = 0; i < 40; i++) { emitFrame(i + 2); step(16.5); }
    expect(renderer.render).toHaveBeenCalledTimes(40);
  });

  it('profiler accumulates frame/render/message stats when toggled on', async () => {
    const renderer = makeFakeRenderer();
    const r = initSecondMonitorReceiver(doc, win, { createRenderer: () => renderer });
    const ch = FakeBroadcastChannel.instances[0];
    ch.emit({ type: MSG.SHADER, wgsl: 'W' });
    await flush();

    expect(r.profiler.snapshot()).toBeNull(); // nothing until enabled
    r.profiler.toggle();
    expect(r.profiler.on).toBe(true);

    // ~40 frames at 60fps with the editor broadcasting each frame → past one window.
    for (let i = 0; i < 40; i++) {
      ch.emit({
        type: MSG.UNIFORMS,
        aspect: new Float32Array([1, 0, 0, 0]),
        globals: new Float32Array([0, 0, i, 0, 0, 0, 0, 0]),
        params: new Float32Array([0]),
      });
      step(16.6);
    }

    const s = r.profiler.snapshot();
    expect(s).toBeTruthy();
    expect(s.renderFps).toBeGreaterThan(0);
    expect(s.msgsPerSec).toBeGreaterThan(0);
    expect(s.tier).toBe(TIER.NATIVE);
  });

  it('fills the display backing until the editor aspect is known', async () => {
    initSecondMonitorReceiver(doc, win, { createRenderer: () => makeFakeRenderer() });
    // Backing = innerWidth*dpr (1280x720); detail is governed by compute res, not this.
    expect(gpuCanvas.width).toBe(1280);
    expect(gpuCanvas.height).toBe(720);
    expect(gpuCanvas.style.width).toBe('1280px');
  });

  it('letterboxes the gpu canvas to the editor aspect ratio (matches editor framing)', () => {
    initSecondMonitorReceiver(doc, win, { createRenderer: () => makeFakeRenderer() });
    const ch = FakeBroadcastChannel.instances[0];
    // Editor is 2:1 (1000x500); display is 1280x720 → letterbox to 1280x640, centred.
    ch.emit({
      type: MSG.UNIFORMS,
      aspect: new Float32Array([2, 0, 0, 0]),
      globals: new Float32Array([1000, 500, 0, 0, 0, 0, 0, 0]),
      params: new Float32Array([0]),
    });
    expect(gpuCanvas.width).toBe(1280);
    expect(gpuCanvas.height).toBe(640);
    expect(gpuCanvas.style.height).toBe('640px');
    expect(gpuCanvas.style.top).toBe('40px');   // (720-640)/2, black bars top & bottom
  });

  it('holds the last frame after sustained silence, then resumes on new state', async () => {
    const renderer = makeFakeRenderer();
    const ch = await primeNative(renderer);

    step();
    expect(renderer.render).toHaveBeenCalledTimes(1);

    // No messages for longer than the idle window → hold (editor minimised/closed).
    step(500);
    step();
    expect(renderer.render).toHaveBeenCalledTimes(1);

    // Fresh state resumes the steady cadence.
    ch.emit({
      type: MSG.UNIFORMS,
      aspect: new Float32Array([1, 0, 0, 0]),
      globals: new Float32Array([0, 0, 2, 0, 0, 0, 0, 0]),
      params: new Float32Array([0]),
    });
    step();
    expect(renderer.render).toHaveBeenCalledTimes(2);
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

    it('letterboxes to the compute texture aspect, not the editor display box (square edge-detect output)', async () => {
      const rt = installFakeRuntime();
      initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];

      // The editor's on-screen preview box is 16:9, but the compute output texture
      // is square (sized from the render-resolution setting). The viewer must frame
      // to the SQUARE texture — otherwise the sampled output is stretched to the
      // display aspect, which is the edge-detect "stretched rectangle" bug.
      ch.emit({
        type: MSG.UNIFORMS,
        aspect: new Float32Array([1280 / 720, 0, 0, 0]),
        globals: new Float32Array([1280, 720, 0, 0, 0, 0, 0, 0]),
        params: new Float32Array([0]),
      });
      ch.emit({
        type: MSG.COMPUTE_GRAPH,
        nodes: [{ id: '1', kind: 'ComputeEdgeDetect', wgsl: 'W', width: 1000, height: 1000, inputs: [] }],
        executionOrder: ['1'],
      });
      await settle();

      // Square (1:1) letterboxed into the 1280x720 display → 720x720, pillarboxed.
      // (Without the fix it would fill 1280x720 at the editor's 16:9 and stretch.)
      expect(gpuCanvas.width).toBe(720);
      expect(gpuCanvas.height).toBe(720);
      expect(gpuCanvas.style.left).toBe('280px'); // (1280-720)/2 — black bars left & right
    });

    it('builds multiple feedback sims and applies uniforms to each (multi-sim graph)', async () => {
      const rt = installFakeRuntime();
      initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];

      ch.emit({
        type: MSG.COMPUTE_GRAPH,
        nodes: [
          { id: '1', kind: 'ComputeReactionDiffusion', wgsl: 'A', width: 64, height: 64, supportsFeedback: true, inputs: [] },
          { id: '2', kind: 'ComputeFeedback', wgsl: 'B', width: 64, height: 64, supportsFeedback: true, inputs: ['1'] },
        ],
        executionOrder: ['1', '2'],
      });
      await settle();

      // Both stateful sims are reconstructed with their feedback flag and run order.
      expect(win.computeNodeRegistry.get('1')).toMatchObject({ supportsFeedback: true });
      expect(win.computeNodeRegistry.get('2')).toMatchObject({ supportsFeedback: true });
      expect(rt.computeExecutor.computeManagers.size).toBe(2);
      expect(rt.computeExecutor.executionOrder).toEqual(['1', '2']);

      // Per-frame uniforms reach every sim.
      ch.emit({ type: MSG.COMPUTE_UNIFORMS, nodes: [
        { id: '1', packed: new Float32Array([64, 64, 0, 1]) },
        { id: '2', packed: new Float32Array([64, 64, 0, 2]) },
      ] });
      await settle();
      expect(rt.computeExecutor.computeManagers.get('1').writeRawComputeUniforms).toHaveBeenCalled();
      expect(rt.computeExecutor.computeManagers.get('2').writeRawComputeUniforms).toHaveBeenCalled();
    });

    it('rebuilds when a compute input is rewired (dedup key includes inputs)', async () => {
      const rt = installFakeRuntime();
      initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];
      const graph = (input) => ({
        type: MSG.COMPUTE_GRAPH,
        nodes: [
          { id: '1', kind: 'ComputeNoise', wgsl: 'A', width: 8, height: 8, inputs: [] },
          { id: '2', kind: 'ComputeEdgeDetect', wgsl: 'B', width: 8, height: 8, inputs: [input] },
        ],
        executionOrder: ['1', '2'],
      });

      ch.emit(graph('1'));
      await settle();
      expect(win.graph.nodes.find((n) => n.id === '2').inputs).toEqual(['1']);

      // Same ids/kinds/wgsl/size, only the input rewired → must rebuild, not dedup away.
      ch.emit(graph('3'));
      await settle();
      expect(win.graph.nodes.find((n) => n.id === '2').inputs).toEqual(['3']);
    });

    it('overrides compute resolution (RENDER_RES), decoupled from the editor preview', async () => {
      const rt = installFakeRuntime();
      const r = initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];

      ch.emit({ type: MSG.COMPUTE_GRAPH, nodes: [
        { id: '1', kind: 'ComputeNoise', wgsl: 'A', width: 512, height: 512, inputs: [] },
      ], executionOrder: ['1'] });
      await settle();
      expect(win.graph.nodes[0].computeResolution).toEqual([512, 512]); // match editor

      ch.emit({ type: MSG.RENDER_RES, maxDim: 1024 });
      await settle();
      expect(r.computeMaxDim).toBe(1024);
      // Long edge scaled to 1024 (preserving aspect), independent of the broadcast size.
      expect(win.graph.nodes[0].computeResolution).toEqual([1024, 1024]);

      // The per-frame packed resolution (floats 0,1) is overridden to the new size,
      // so the shader's UV/texel math matches the larger texture.
      const packed = new Float32Array([512, 512, 0, 1]);
      ch.emit({ type: MSG.COMPUTE_UNIFORMS, nodes: [{ id: '1', packed }] });
      await settle();
      expect(packed[0]).toBe(1024);
      expect(packed[1]).toBe(1024);
    });

    it('stops following the editor preview aspect once a fixed Viewer res is set', async () => {
      const renderer = makeFakeRenderer();
      initSecondMonitorReceiver(doc, win, { createRenderer: () => renderer });
      const ch = FakeBroadcastChannel.instances[0];

      ch.emit({ type: MSG.SHADER, wgsl: 'W' });
      await flush();

      // "Match editor": a square editor aspect letterboxes the 1280x720 display to
      // 720x720, so the viewer reshapes with the preview.
      const globals = new Float32Array([600, 600, 0, 0, 0, 0, 0, 0]);
      ch.emit({ type: MSG.UNIFORMS, aspect: new Float32Array([1, 0, 0, 0]), globals, params: null });
      expect(gpuCanvas.width).toBe(720);
      expect(gpuCanvas.height).toBe(720);

      // A fixed Viewer res decouples: the canvas fills the display and no longer
      // tracks the editor's preview aspect.
      ch.emit({ type: MSG.RENDER_RES, maxDim: 1080 });
      await settle();
      expect(gpuCanvas.width).toBe(1280);
      expect(gpuCanvas.height).toBe(720);

      // Back to "match editor" → it letterboxes to the preview aspect again.
      ch.emit({ type: MSG.RENDER_RES, maxDim: 0 });
      await settle();
      expect(gpuCanvas.width).toBe(720);
      expect(gpuCanvas.height).toBe(720);
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

    it('does not re-dispatch a static node when only time (index 2) changes', async () => {
      const rt = installFakeRuntime();
      initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];
      ch.emit({ type: MSG.COMPUTE_GRAPH, nodes: [{ id: '1', kind: 'ComputeBlur', wgsl: 'W', width: 8, height: 8, inputs: [] }], executionOrder: ['1'] });
      await settle();

      // First uniforms establish a baseline (always invalidates once).
      ch.emit({ type: MSG.COMPUTE_UNIFORMS, nodes: [{ id: '1', packed: new Float32Array([8, 8, 0.1, 5]) }] });
      await settle();
      rt.computeExecutor.inputHashes.set('1', 'cached');

      // Only time (index 2) ticked → must NOT invalidate (no redundant re-dispatch).
      ch.emit({ type: MSG.COMPUTE_UNIFORMS, nodes: [{ id: '1', packed: new Float32Array([8, 8, 0.2, 5]) }] });
      await settle();
      expect(rt.computeExecutor.inputHashes.get('1')).toBe('cached');

      // A real param change (index 3, e.g. blur radius) → must invalidate.
      ch.emit({ type: MSG.COMPUTE_UNIFORMS, nodes: [{ id: '1', packed: new Float32Array([8, 8, 0.3, 9]) }] });
      await settle();
      expect(rt.computeExecutor.inputHashes.has('1')).toBe(false);
    });

    it('re-dispatches a gradient when only its color stops change', async () => {
      const rt = installFakeRuntime();
      initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];
      ch.emit({ type: MSG.COMPUTE_GRAPH, nodes: [{ id: '1', kind: 'ComputeGradient', wgsl: 'W', width: 8, height: 8, inputs: [] }], executionOrder: ['1'] });
      await settle();
      ch.emit({ type: MSG.COMPUTE_UNIFORMS, nodes: [{ id: '1', packed: new Float32Array([8, 8, 0.1, 2]), colorStops: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0]) }] });
      await settle();
      rt.computeExecutor.inputHashes.set('1', 'cached');

      // packed differs only by time (index 2), but the color stops changed → invalidate.
      ch.emit({ type: MSG.COMPUTE_UNIFORMS, nodes: [{ id: '1', packed: new Float32Array([8, 8, 0.2, 2]), colorStops: new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]) }] });
      await settle();
      expect(rt.computeExecutor.inputHashes.has('1')).toBe(false);
    });

    it('cascades re-dispatch to downstream nodes when an upstream node changes', async () => {
      const rt = installFakeRuntime();
      initSecondMonitorReceiver(doc, win, opts(rt));
      const ch = FakeBroadcastChannel.instances[0];
      ch.emit({
        type: MSG.COMPUTE_GRAPH,
        nodes: [
          { id: '1', kind: 'ComputeNoise', wgsl: 'W', width: 8, height: 8, inputs: [] },
          { id: '2', kind: 'ComputeBlur', wgsl: 'W', width: 8, height: 8, inputs: ['1'] },
          { id: '3', kind: 'ComputeThreshold', wgsl: 'W', width: 8, height: 8, inputs: ['2'] },
        ],
        executionOrder: ['1', '2', '3'],
      });
      await settle();
      ch.emit({ type: MSG.COMPUTE_UNIFORMS, nodes: [
        { id: '1', packed: new Float32Array([8, 8, 0.1, 5]) },
        { id: '2', packed: new Float32Array([8, 8, 0.1, 3]) },
        { id: '3', packed: new Float32Array([8, 8, 0.1, 1]) },
      ] });
      await settle();
      rt.computeExecutor.inputHashes.set('1', 'a');
      rt.computeExecutor.inputHashes.set('2', 'b');
      rt.computeExecutor.inputHashes.set('3', 'c');

      // Only node 1's param (index 3) changes; 2 and 3 differ only by time.
      ch.emit({ type: MSG.COMPUTE_UNIFORMS, nodes: [
        { id: '1', packed: new Float32Array([8, 8, 0.2, 9]) },
        { id: '2', packed: new Float32Array([8, 8, 0.2, 3]) },
        { id: '3', packed: new Float32Array([8, 8, 0.2, 1]) },
      ] });
      await settle();

      // The change at node 1 cascades through the whole chain.
      expect(rt.computeExecutor.inputHashes.has('1')).toBe(false);
      expect(rt.computeExecutor.inputHashes.has('2')).toBe(false);
      expect(rt.computeExecutor.inputHashes.has('3')).toBe(false);
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

    describe('fragment-fed compute', () => {
      const blurFedByFragment = {
        type: MSG.COMPUTE_GRAPH,
        nodes: [{ id: '2', kind: 'ComputeBlur', wgsl: 'W', width: 8, height: 8, inputs: ['9'] }],
        executionOrder: ['2'],
      };
      const fragGraph = (params = { scale: 5 }) => ({
        type: MSG.FRAGMENT_GRAPH,
        nodes: [{ id: '9', kind: 'SimplexNoise', params, inputs: [] }],
      });

      it('reconstructs the fragment subgraph into the synthetic graph with its params', async () => {
        const rt = installFakeRuntime();
        initSecondMonitorReceiver(doc, win, opts(rt));
        const ch = FakeBroadcastChannel.instances[0];
        ch.emit(blurFedByFragment);
        ch.emit(fragGraph());
        await settle();

        // Fragment node lives in the graph WITH params (so buildWGSL matches the editor);
        // the compute node it feeds is still present.
        expect(win.graph.nodes.find((n) => n.id === '9')).toMatchObject({
          id: '9', kind: 'SimplexNoise', params: { scale: 5 }, inputs: [],
        });
        expect(win.graph.nodes.find((n) => n.id === '2')).toBeTruthy();
        // The fragment renderer cache was cleared so it recompiles the new subgraph.
        expect(rt.fragmentRenderer.clearCache).toHaveBeenCalled();
      });

      it('keeps the fragment subgraph when the compute graph rebuilds (rewire/resize)', async () => {
        const rt = installFakeRuntime();
        initSecondMonitorReceiver(doc, win, opts(rt));
        const ch = FakeBroadcastChannel.instances[0];
        ch.emit(fragGraph());
        ch.emit(blurFedByFragment);
        await settle();
        expect(win.graph.nodes.find((n) => n.id === '9')).toBeTruthy();

        // A compute rebuild clears win.graph.nodes then must re-append the fragment node.
        ch.emit({
          type: MSG.COMPUTE_GRAPH,
          nodes: [{ id: '2', kind: 'ComputeBlur', wgsl: 'W2', width: 16, height: 16, inputs: ['9'] }],
          executionOrder: ['2'],
        });
        await settle();
        expect(win.graph.nodes.find((n) => n.id === '9')).toMatchObject({ params: { scale: 5 } });
        expect(win.graph.nodes.find((n) => n.id === '2').computeResolution).toEqual([16, 16]);
      });

      it('does not let a fragment node shadow a compute node of the same id', async () => {
        const rt = installFakeRuntime();
        initSecondMonitorReceiver(doc, win, opts(rt));
        const ch = FakeBroadcastChannel.instances[0];
        ch.emit(blurFedByFragment);
        // A stray fragment node reusing the compute id '2' must be ignored.
        ch.emit({ type: MSG.FRAGMENT_GRAPH, nodes: [{ id: '2', kind: 'SimplexNoise', params: {}, inputs: [] }] });
        await settle();
        const twos = win.graph.nodes.filter((n) => n.id === '2');
        expect(twos).toHaveLength(1);
        expect(twos[0].kind).toBe('ComputeBlur');
      });

      it('injects evaluated fragment u_params and re-renders only when the bytes change', async () => {
        const rt = installFakeRuntime();
        initSecondMonitorReceiver(doc, win, opts(rt));
        const ch = FakeBroadcastChannel.instances[0];
        ch.emit(blurFedByFragment);
        ch.emit(fragGraph());
        await settle();
        const fr = rt.fragmentRenderer;

        ch.emit({ type: MSG.FRAGMENT_UNIFORMS, nodes: [{ id: '9', params: new Float32Array([5]) }] });
        await settle();
        expect(fr.externalUniformMode).toBe(true);
        expect(Array.from(fr.externalUniforms.get('9'))).toEqual([5]);

        // Unchanged bytes → the static fragment node keeps its cached render.
        fr.parameterHashes.set('9', 'cached');
        ch.emit({ type: MSG.FRAGMENT_UNIFORMS, nodes: [{ id: '9', params: new Float32Array([5]) }] });
        await settle();
        expect(fr.parameterHashes.get('9')).toBe('cached');

        // A real value change → drop the hash so it re-renders with the new param.
        ch.emit({ type: MSG.FRAGMENT_UNIFORMS, nodes: [{ id: '9', params: new Float32Array([7]) }] });
        await settle();
        expect(fr.parameterHashes.has('9')).toBe(false);
      });

      it('resets fragment state when leaving the compute tier', async () => {
        const rt = installFakeRuntime();
        const r = initSecondMonitorReceiver(doc, win, opts(rt));
        const ch = FakeBroadcastChannel.instances[0];
        ch.emit(blurFedByFragment);
        ch.emit(fragGraph());
        await settle();
        expect(win.graph.nodes.find((n) => n.id === '9')).toBeTruthy();

        // Switching to the plain fragment tier tears down compute + fragment state.
        ch.emit({ type: MSG.CAPS, tier: TIER.NATIVE });
        await settle();
        expect(rt.computeExecutor.clear).toHaveBeenCalled();
      });
    });
  });

  it('feeds the editor broadcast audio envelopes to the window (for fragment expression params)', async () => {
    const renderer = makeFakeRenderer();
    initSecondMonitorReceiver(doc, win, { createRenderer: () => renderer });
    const ch = FakeBroadcastChannel.instances[0];
    ch.emit({ type: MSG.SHADER, wgsl: 'W' });
    await flush();

    // globals = [resX, resY, time, audioEnvelope, bass, mids, highs, full].
    ch.emit({
      type: MSG.UNIFORMS,
      aspect: new Float32Array([1, 0, 0, 0]),
      globals: new Float32Array([100, 50, 3, 0.1, 0.2, 0.3, 0.4, 0.5]),
      params: null,
    });
    step();

    // The fragment renderer builds its globals from these window values, so mirroring
    // the editor's audio keeps =audioEnvelope expressions matching across windows.
    expect(win._audioEnvelopeValue).toBeCloseTo(0.1, 5);
    expect(win._audioEnvelopeBass).toBeCloseTo(0.2, 5);
    expect(win._audioEnvelopeMids).toBeCloseTo(0.3, 5);
    expect(win._audioEnvelopeHighs).toBeCloseTo(0.4, 5);
    expect(win._audioEnvelopeFull).toBeCloseTo(0.5, 5);
  });
});
