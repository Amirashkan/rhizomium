import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initSecondMonitorReceiver } from '../src/ui/secondMonitorReceiver.js';
import {
  SecondMonitorMessage as MSG,
  SecondMonitorTier as TIER,
  screenIdFromUrl,
  isForScreen,
  screenReceiverUrl,
} from '../src/ui/secondMonitorFrameChannel.js';

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

function makeFakeCanvas() {
  return { width: 0, height: 0, style: {}, getContext: vi.fn(() => null) };
}

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

describe('screen addressing helpers', () => {
  it('reads a screen id off the receiver URL, defaulting to the single output', () => {
    expect(screenIdFromUrl({ search: '?screen=screen-2' })).toBe('screen-2');
    expect(screenIdFromUrl({ search: '' })).toBe('main');
    expect(screenIdFromUrl({ search: '?other=1' })).toBe('main');
  });

  it('treats unaddressed messages as everyone’s and addressed ones as one screen’s', () => {
    // The composition-wide state stream is broadcast once for the whole rig.
    expect(isForScreen({ type: 'uniforms' }, 'screen-2')).toBe(true);
    expect(isForScreen({ screenId: 'screen-2' }, 'screen-2')).toBe(true);
    expect(isForScreen({ screenId: 'main' }, 'screen-2')).toBe(false);
  });

  it('builds a receiver URL that carries the screen’s identity', () => {
    expect(screenReceiverUrl('/editor/second-monitor.html', 'screen-2'))
      .toBe('/editor/second-monitor.html?screen=screen-2');
    expect(screenReceiverUrl('/x.html?a=1', 'main')).toBe('/x.html?a=1&screen=main');
  });
});

describe('secondMonitorReceiver — screen framing', () => {
  let doc, win, gpuCanvas, fbCanvas, mapCanvas, fbCtx, rafCbs, clock;

  beforeEach(() => {
    FakeBroadcastChannel.instances = [];
    clock = 1000;
    rafCbs = [];
    gpuCanvas = makeFakeCanvas();
    fbCanvas = makeFakeCanvas();
    fbCtx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    fbCanvas.getContext = vi.fn(() => fbCtx);
    mapCanvas = makeFakeCanvas();
    doc = {
      title: '',
      getElementById: vi.fn((id) => {
        if (id === 'second-monitor-gpu') return gpuCanvas;
        if (id === 'second-monitor-output') return fbCanvas;
        if (id === 'second-monitor-map') return mapCanvas;
        return null;
      }),
    };
    win = {
      innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
      location: { search: '?screen=screen-2' },
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

  const start = () => initSecondMonitorReceiver(doc, win, { createRenderer: () => makeFakeRenderer() });

  it('takes its identity from the URL and stamps it on what it sends', () => {
    const r = start();
    expect(r.screenId).toBe('screen-2');
    const ch = FakeBroadcastChannel.instances[0];
    expect(ch.posted.find((m) => m.type === MSG.READY).screenId).toBe('screen-2');
    expect(ch.posted.find((m) => m.type === MSG.RESIZE).screenId).toBe('screen-2');
  });

  it('is the single-output screen when opened without one', () => {
    win.location = { search: '' };
    expect(start().screenId).toBe('main');
  });

  it('starts showing the whole composition', () => {
    // A screen with no framing yet is a mirror, never a black rectangle.
    expect(start().region).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('adopts a region addressed to it', () => {
    const r = start();
    FakeBroadcastChannel.instances[0].emit({
      type: MSG.SCREEN_CONFIG, screenId: 'screen-2',
      region: { x: 1 / 3, y: 0, w: 1 / 3, h: 1 }, name: 'Centre',
    });
    expect(r.region.x).toBeCloseTo(1 / 3, 6);
    expect(r.region.w).toBeCloseTo(1 / 3, 6);
    // Naming the window is how an operator tells five projectors apart.
    expect(doc.title).toBe('Rhizomium — Centre');
  });

  it('ignores framing meant for another screen', () => {
    const r = start();
    FakeBroadcastChannel.instances[0].emit({
      type: MSG.SCREEN_CONFIG, screenId: 'screen-9',
      region: { x: 0.5, y: 0, w: 0.5, h: 1 },
    });
    expect(r.region).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('still consumes the unaddressed state stream', async () => {
    const renderer = makeFakeRenderer();
    initSecondMonitorReceiver(doc, win, { createRenderer: () => renderer });
    FakeBroadcastChannel.instances[0].emit({ type: MSG.SHADER, wgsl: 'W' });
    await new Promise((r) => setTimeout(r, 0));
    expect(renderer.setShaderSource).toHaveBeenCalledWith('W');
  });

  it('takes its presentation resolution from its own SCREEN_CONFIG', () => {
    const r = start();
    FakeBroadcastChannel.instances[0].emit({
      type: MSG.SCREEN_CONFIG, screenId: 'screen-2', displayMaxDim: 1280,
    });
    expect(r.displayMaxDim).toBe(1280);
  });

  it('ignores a resolution contract addressed to another screen', () => {
    const r = start();
    FakeBroadcastChannel.instances[0].emit({
      type: MSG.RENDER_RES, screenId: 'other', maxDim: -1, displayMaxDim: 1280,
    });
    expect(r.displayMaxDim).toBe(0);
  });

  describe('canvas sizing', () => {
    const emitUniforms = (ch, w = 3840, h = 1080) => {
      ch.emit({ type: MSG.RENDER_RES, screenId: 'screen-2', maxDim: -1, displayMaxDim: 0 });
      ch.emit({
        type: MSG.UNIFORMS,
        globals: new Float32Array([w, h, 0, 0, 0, 0, 0, 0]),
        aspect: new Float32Array([w / h, 0, 0, 0]),
      });
    };

    it('letterboxes an uncropped screen to the composition', () => {
      start();
      const ch = FakeBroadcastChannel.instances[0];
      emitUniforms(ch);
      // A 32:9 composition on a 16:9 display: full width, half height.
      expect(gpuCanvas.width).toBe(1920);
      expect(gpuCanvas.height).toBe(540);
    });

    it('renders the whole composition behind a crop, at the crop’s density', () => {
      start();
      const ch = FakeBroadcastChannel.instances[0];
      emitUniforms(ch);
      ch.emit({
        type: MSG.SCREEN_CONFIG, screenId: 'screen-2',
        region: { x: 0, y: 0, w: 1 / 3, h: 1 },
      });

      // A third of a 32:9 composition is 32:27 — taller than the display, so the
      // presented slice is 1080 high and 1280 wide. Behind it the canvas holds
      // the WHOLE composition, three times as wide, or the crop would be a 3x
      // upscale of a display-sized render.
      expect(gpuCanvas.width).toBe(3840);
      expect(gpuCanvas.height).toBe(1080);
      // The element box stays the slice: that is this screen's output space.
      expect(gpuCanvas.style.width).toBe('1280px');
      expect(gpuCanvas.style.height).toBe('1080px');
    });

    it('keeps the composition’s shape when a steep crop exceeds the GPU limit', () => {
      start();
      const ch = FakeBroadcastChannel.instances[0];
      emitUniforms(ch, 1920, 1080);
      ch.emit({
        type: MSG.SCREEN_CONFIG, screenId: 'screen-2',
        region: { x: 0, y: 0, w: 0.02, h: 1 },
      });

      expect(Math.max(gpuCanvas.width, gpuCanvas.height)).toBeLessThanOrEqual(8192);
      // Squashing one axis would change the picture, not just its sharpness.
      expect(gpuCanvas.width / gpuCanvas.height).toBeCloseTo(1920 / 1080, 1);
    });
  });

  describe('the pixel fallback path', () => {
    it('blits only this screen’s part of the mirrored frame', () => {
      const r = start();
      const ch = FakeBroadcastChannel.instances[0];
      ch.emit({ type: MSG.CAPS, tier: TIER.FALLBACK });
      ch.emit({
        type: MSG.SCREEN_CONFIG, screenId: 'screen-2',
        region: { x: 0.5, y: 0, w: 0.5, h: 1 },
      });
      ch.emit({ type: MSG.FRAME, bitmap: { width: 1920, height: 1080, close: vi.fn() }, sw: 1920, sh: 1080 });

      clock += 100;
      rafCbs.pop()?.(clock);

      expect(r.tier).toBe(TIER.FALLBACK);
      const call = fbCtx.drawImage.mock.calls.pop();
      // Source rect: the right half of the composition.
      expect(call.slice(1, 5)).toEqual([960, 0, 960, 1080]);
    });
  });
});
