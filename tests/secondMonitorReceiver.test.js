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
    externalUniformMode: false,
    _cachedCanvasSize: { width: 0, height: 0, clientWidth: 0, clientHeight: 0 },
    setShaderSource: vi.fn(),
    writeRawUniforms: vi.fn(),
    render: vi.fn(),
  };
}

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
});
