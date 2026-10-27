// Warnings before fast motion plays: the WCAG flash measurement, the patch scan, the verdict, and
// the gate that holds playback around a project load.

import { describe, it, expect, vi } from 'vitest';
import {
  frameToCells,
  findTransitions,
  maxInWindow,
  analyzeCellFrames,
} from '../src/accessibility/flashAnalysis.js';
import { expressionClockRate, scanPatchForMotion } from '../src/accessibility/patchMotionScan.js';
import {
  assessMotion,
  suggestedSlowdown,
  measurePreviewMotion,
  checkPatchMotion,
  MotionGate,
} from '../src/accessibility/motionSafety.js';
import { makeNode } from '../src/data/NodeDefs.js';

const W = 64;
const H = 36;
const FPS = 60;

/** An RGBA8 frame filled by `paint(x, y) → [r, g, b]`. */
function frame(paint) {
  const pixels = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = paint(x, y);
      const p = (y * W + x) * 4;
      pixels[p] = r;
      pixels[p + 1] = g;
      pixels[p + 2] = b;
      pixels[p + 3] = 255;
    }
  }
  return pixels;
}

/** `seconds` of frames at 60 fps, each painted from its time. */
function run(seconds, paintAt) {
  const frames = [];
  for (let i = 0; i < seconds * FPS; i++) {
    const t = i / FPS;
    frames.push(frameToCells(frame((x, y) => paintAt(t, x, y)), W, H));
  }
  return frames;
}

/** A square-wave strobe: on for half of each cycle. */
const strobe = (hz) => (t) => Math.floor(t * hz * 2) % 2 === 0;

describe('flash analysis', () => {
  it('counts opposing luminance transitions only', () => {
    expect(findTransitions([0, 1, 0, 1, 0], 0.1)).toEqual([1, 2, 3, 4]);
    // Two rises in a row are one transition, not two.
    expect(findTransitions([0, 0.5, 1, 0], 0.1)).toEqual([1, 3]);
    // Changes smaller than the threshold are not transitions.
    expect(findTransitions([0.5, 0.55, 0.5, 0.55], 0.1)).toEqual([]);
    // Both states bright: no flash under WCAG's darker-state rule.
    expect(findTransitions([0.85, 1, 0.85, 1], 0.1, 0.8)).toEqual([]);
  });

  it('finds the busiest one-second window', () => {
    expect(maxInWindow([0, 10, 20, 30, 70, 75], 60)).toBe(4);
    expect(maxInWindow([], 60)).toBe(0);
  });

  it('fails a full-frame strobe at 10 Hz and reports its rate', () => {
    const on = strobe(10);
    const result = analyzeCellFrames(
      run(2, (t) => (on(t) ? [255, 255, 255] : [0, 0, 0])),
      { fps: FPS },
    );
    expect(result.generalFlashFail).toBe(true);
    expect(result.flashesPerSecond).toBeGreaterThanOrEqual(9.5);
    expect(result.flashArea).toBe(1);
  });

  it('passes a slow fade and a strobe under the limit', () => {
    const fade = analyzeCellFrames(
      run(2, (t) => {
        const v = Math.round(127 + 127 * Math.sin(t * Math.PI));
        return [v, v, v];
      }),
      { fps: FPS },
    );
    expect(fade.generalFlashFail).toBe(false);

    const on = strobe(2);
    const slow = analyzeCellFrames(run(2, (t) => (on(t) ? [255, 255, 255] : [0, 0, 0])), { fps: FPS });
    expect(slow.generalFlashFail).toBe(false);
    expect(slow.flashesPerSecond).toBeLessThanOrEqual(3);
  });

  it('ignores flashing confined to a sliver of the frame', () => {
    const on = strobe(12);
    // One 4×4 corner: well under 2.5% of the frame.
    const result = analyzeCellFrames(
      run(2, (t, x, y) => (x < 4 && y < 4 && on(t) ? [255, 255, 255] : [0, 0, 0])),
      { fps: FPS },
    );
    expect(result.generalFlashFail).toBe(false);
  });

  it('catches saturated red flashing', () => {
    const on = strobe(6);
    const result = analyzeCellFrames(run(2, (t) => (on(t) ? [255, 0, 0] : [0, 0, 0])), { fps: FPS });
    expect(result.redFlashFail).toBe(true);
    expect(result.redFlashesPerSecond).toBeGreaterThan(3);
  });

  it('reports rapid change across the frame', () => {
    // Every cell jumps between two very different levels every frame, out of step with its
    // neighbours.
    const result = analyzeCellFrames(
      run(1, (t, x, y) => {
        const flip = (Math.round(t * FPS) + Math.floor(x / 4) + Math.floor(y / 4)) % 2;
        return flip ? [230, 230, 230] : [20, 20, 20];
      }),
      { fps: FPS },
    );
    expect(result.rapidMotion).toBe(true);
  });

  it('reads BGRA readbacks with the channels swapped back', () => {
    const pixels = frame(() => [0, 0, 255]); // stored as B,G,R,A: this is pure red
    const cells = frameToCells(pixels, W, H, { cols: 1, rows: 1, bgra: true });
    expect(cells[0]).toBeCloseTo(1);
    expect(cells[2]).toBeCloseTo(0);
  });
});

describe('patch scan', () => {
  it('reads the rate an expression asks of the clock', () => {
    expect(expressionClockRate('=sin(time * 20)')).toBeCloseTo(20 / (2 * Math.PI));
    expect(expressionClockRate('=fract(time*8)')).toBe(8);
    expect(expressionClockRate('=step(0.5, fract(time * 5.0))')).toBe(5);
    expect(expressionClockRate('let v = sin(g.time * 30.0);')).toBeCloseTo(30 / (2 * Math.PI));
    expect(expressionClockRate('=fract(time)')).toBe(1);
    expect(expressionClockRate('=sin(time) * 0.5')).toBeNull();
    expect(expressionClockRate('=0.5')).toBeNull();
  });

  it('flags fast oscillators, per-frame randomness and fast simulations', () => {
    const wave = makeNode('Wave', 0, 0);
    wave.params.frequency = 8;
    wave.params.shape = 'Square';
    const calm = makeNode('Wave', 0, 200);
    calm.params.frequency = 0.5;
    const random = makeNode('RandomValue', 0, 400);
    const life = makeNode('ComputeCellular', 0, 600);
    const findings = scanPatchForMotion({ nodes: [wave, calm, random, life] });

    const byNode = (node) => findings.filter((f) => f.nodeId === node.id);
    expect(byNode(wave)).toHaveLength(1);
    expect(byNode(wave)[0]).toMatchObject({ severity: 'medium', rateHz: 8 });
    expect(byNode(wave)[0].message).toContain('on/off');
    expect(byNode(calm)).toHaveLength(0);
    expect(byNode(random)[0].severity).toBe('medium');
    expect(byNode(life)[0].rateHz).toBe(10);
  });

  it('counts the preview speed, and notes audio and video it cannot measure', () => {
    const wave = makeNode('Wave', 0, 0);
    wave.params.frequency = 2;
    const add = makeNode('Add', 0, 200);
    add.params.a = '=audioEnvelopeBass * 2';
    const findings = scanPatchForMotion({ nodes: [wave, add] }, { timeScale: 2 });
    expect(findings.find((f) => f.nodeId === wave.id)).toMatchObject({ severity: 'medium', rateHz: 4 });
    expect(findings.some((f) => f.severity === 'info' && /audio/.test(f.message))).toBe(true);
    expect(findings.some((f) => /2× speed/.test(f.message))).toBe(true);
  });

  it('skips bypassed nodes', () => {
    const wave = makeNode('Wave', 0, 0);
    wave.params.frequency = 9;
    wave.bypassed = true;
    expect(scanPatchForMotion({ nodes: [wave] })).toEqual([]);
  });
});

describe('verdict', () => {
  it('rates measured flashing high and names the rate', () => {
    const report = assessMotion({
      measurement: {
        generalFlashFail: true,
        flashesPerSecond: 10,
        flashArea: 0.8,
        redFlashFail: false,
        rapidMotion: true,
      },
    });
    expect(report.risk).toBe('high');
    expect(report.reasons[0]).toContain('10 times a second');
    expect(report.fastestRate).toBe(10);
  });

  it('rates scan findings medium and keeps informational notes apart', () => {
    const report = assessMotion({
      findings: [
        { severity: 'medium', message: 'fast', rateHz: 8 },
        { severity: 'info', message: 'audio' },
      ],
    });
    expect(report.risk).toBe('medium');
    expect(report.reasons).toEqual(['fast']);
    expect(report.notes).toEqual(['audio']);
  });

  it('suggests a speed that brings the fastest rate under the limit', () => {
    expect(suggestedSlowdown(4)).toBe(0.5);
    expect(suggestedSlowdown(10)).toBe(0.25);
    expect(suggestedSlowdown(20)).toBe(0.1);
    expect(suggestedSlowdown(null)).toBe(0.25);
  });
});

/** A renderer stand-in that "renders" a 10 Hz strobe in BGRA, like a bgra8unorm canvas. */
function strobeRenderer(hz) {
  const on = strobe(hz);
  return {
    pipeline: {},
    captureFrameSequence: vi.fn(async ({ width, height, times }) => {
      const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
      const frameBytes = bytesPerRow * height;
      const pixels = new Uint8Array(frameBytes * times.length);
      times.forEach((t, i) => {
        const v = on(t) ? 255 : 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const p = i * frameBytes + y * bytesPerRow + x * 4;
            pixels[p] = v;
            pixels[p + 1] = v;
            pixels[p + 2] = v;
            pixels[p + 3] = 255;
          }
        }
      });
      return { pixels, width, height, bytesPerRow, frameBytes, count: times.length, format: 'bgra8unorm' };
    }),
  };
}

describe('measuring the preview', () => {
  it('samples two seconds of the shader clock at the playback rate', async () => {
    const renderer = strobeRenderer(10);
    const result = await measurePreviewMotion(renderer, { startTime: 5, timeScale: 1 });
    const { times } = renderer.captureFrameSequence.mock.calls[0][0];
    expect(times).toHaveLength(120);
    expect(times[0]).toBe(5);
    expect(times[1]).toBeCloseTo(5 + 1 / 60);
    expect(result.generalFlashFail).toBe(true);
  });

  it('samples a slowed preview more slowly, and the strobe falls under the limit', async () => {
    const report = await checkPatchMotion({
      graph: { nodes: [] },
      renderer: strobeRenderer(10),
      timeScale: 0.25,
    });
    expect(report.risk).toBe('none');
  });

  it('falls back to the patch scan when nothing can be rendered', async () => {
    const report = await checkPatchMotion({ graph: { nodes: [] }, renderer: null });
    expect(report.measurement).toBeNull();
    expect(report.risk).toBe('none');
  });
});

describe('MotionGate', () => {
  function fakeTiming({ paused = false, timeScale = 1 } = {}) {
    return {
      paused,
      timeScale,
      isPaused() {
        return this.paused;
      },
      setPaused(value) {
        this.paused = value;
      },
      getTimeScale() {
        return this.timeScale;
      },
      setTimeScale(value) {
        this.timeScale = value;
      },
    };
  }
  const settingsWith = (enabled) => ({ motionWarningsEnabled: () => enabled });
  const risky = { risk: 'high', reasons: ['flashes'], notes: [], fastestRate: 10, findings: [], measurement: null };
  const safe = { risk: 'none', reasons: [], notes: [], fastestRate: null, findings: [], measurement: null };

  it('stays out of the way while the warning is off', async () => {
    const timing = fakeTiming();
    const check = vi.fn();
    const gate = new MotionGate({ settings: settingsWith(false), timing, check, say: () => {} });
    gate.onProjectLoading({});
    await gate.onProjectLoaded({});
    expect(timing.paused).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('holds playback through the load and releases a safe patch', async () => {
    const timing = fakeTiming();
    const gate = new MotionGate({ settings: settingsWith(true), timing, check: async () => safe, say: () => {} });
    gate.onProjectLoading({});
    expect(timing.paused).toBe(true);
    expect(gate.isHolding()).toBe(true);
    const outcome = await gate.onProjectLoaded({});
    expect(outcome.choice).toBe('play');
    expect(timing.paused).toBe(false);
  });

  it('leaves a patch paused that was paused before it loaded', async () => {
    const timing = fakeTiming({ paused: true });
    const gate = new MotionGate({ settings: settingsWith(true), timing, check: async () => safe, say: () => {} });
    gate.onProjectLoading({});
    await gate.onProjectLoaded({});
    expect(timing.paused).toBe(true);
  });

  it('warns about a risky patch and applies the choice', async () => {
    const timing = fakeTiming();
    const warn = vi.fn(async () => ({ choice: 'slow', slowdown: 0.25 }));
    const gate = new MotionGate({ settings: settingsWith(true), timing, check: async () => risky, warn, say: () => {} });

    gate.onProjectLoading({});
    await gate.onProjectLoaded({});
    expect(warn).toHaveBeenCalledWith(risky, { manual: false });
    expect(timing.paused).toBe(false);
    expect(timing.timeScale).toBe(0.25);

    // The slow-down belongs to that patch: the next load starts from the old speed.
    warn.mockResolvedValueOnce({ choice: 'stay', slowdown: 0.25 });
    gate.onProjectLoading({});
    expect(timing.timeScale).toBe(1);
    await gate.onProjectLoaded({});
    expect(timing.paused).toBe(true);
  });

  it('never interrupts a VJ scene cut', async () => {
    const timing = fakeTiming();
    const check = vi.fn(async () => risky);
    const gate = new MotionGate({ settings: settingsWith(true), timing, check, say: () => {} });
    gate.onProjectLoading({ source: 'vj-scene' });
    await gate.onProjectLoaded({ source: 'vj-scene' });
    expect(timing.paused).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('lets go when the load itself failed', async () => {
    const timing = fakeTiming();
    const check = vi.fn(async () => risky);
    const gate = new MotionGate({ settings: settingsWith(true), timing, check, say: () => {} });
    gate.onProjectLoading({});
    await gate.onProjectLoaded({ failed: true });
    expect(timing.paused).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it('responds to the load events SaveLoadManager announces', async () => {
    const timing = fakeTiming();
    const gate = new MotionGate({ settings: settingsWith(true), timing, check: async () => safe, say: () => {} });
    const target = new EventTarget();
    const stop = gate.install(target);
    target.dispatchEvent(new CustomEvent('rz:project-loading', { detail: { source: null } }));
    expect(timing.paused).toBe(true);
    target.dispatchEvent(new CustomEvent('rz:project-loaded', { detail: { failed: false } }));
    await vi.waitFor(() => expect(timing.paused).toBe(false));
    stop();
  });
});
