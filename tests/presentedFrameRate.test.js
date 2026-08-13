import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getPresentedFps,
  getPresentedFrameMs,
  getPresentedFpsCeiling,
  subscribePresentedFps,
  __resetPresentedFrameRate,
} from '../src/core/presentedFrameRate.js';

// The one number in the app that means "frames you can see". Everything else
// countable here — dispatches, submissions, simulation steps — is a rate the
// app picked, and on a fixed timestep those read back the target rate no matter
// what the display is doing.
describe('presentedFrameRate', () => {
  let clock;
  let queue;
  let nextId;
  let realRaf;
  let realCancel;

  /** Presents one frame `dt` ms after the last, running whatever is queued. */
  const present = (dt) => {
    clock += dt;
    const due = queue;
    queue = [];
    for (const { cb } of due) cb(clock);
  };

  /** Presents one second's worth of frames at the given rate. */
  const presentFor1s = (fps) => {
    for (let i = 0; i < fps; i++) present(1000 / fps);
  };

  beforeEach(() => {
    clock = 0;
    queue = [];
    nextId = 0;
    realRaf = globalThis.requestAnimationFrame;
    realCancel = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (cb) => { const id = ++nextId; queue.push({ id, cb }); return id; };
    globalThis.cancelAnimationFrame = (id) => { queue = queue.filter((e) => e.id !== id); };
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    __resetPresentedFrameRate();
  });

  afterEach(() => {
    __resetPresentedFrameRate();
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
    vi.restoreAllMocks();
  });

  it('reports the rate frames are actually presented at', () => {
    getPresentedFps();
    presentFor1s(48);
    expect(getPresentedFps()).toBeCloseTo(48, 0);
    expect(getPresentedFrameMs()).toBeCloseTo(1000 / 48, 0);
  });

  it('reports 60 when the window presents 60', () => {
    getPresentedFps();
    presentFor1s(60);
    expect(getPresentedFps()).toBeCloseTo(60, 0);
  });

  it('notifies subscribers as each averaging window closes', () => {
    const seen = [];
    subscribePresentedFps((fps) => seen.push(fps));

    presentFor1s(48);
    presentFor1s(48);

    // A 500ms averaging window closes about once a second at this rate.
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.at(-1)).toBeCloseTo(48, 0);
  });

  it('shares one loop across every consumer', () => {
    // Two subscribers plus a poller must not mean three rAF loops racing each
    // other — duplicated counting is what let two readouts disagree.
    const a = subscribePresentedFps(() => {});
    const b = subscribePresentedFps(() => {});
    getPresentedFps();

    presentFor1s(60);

    expect(queue.length).toBe(1);
    expect(getPresentedFps()).toBeCloseTo(60, 0);
    a(); b();
  });

  it('survives a listener that throws', () => {
    subscribePresentedFps(() => { throw new Error('bad listener'); });
    const seen = [];
    subscribePresentedFps((fps) => seen.push(fps));

    presentFor1s(60);

    expect(seen.at(-1)).toBeCloseTo(60, 0);
  });

  it('grades against the rate the window has managed, not a hardcoded 60', () => {
    getPresentedFps();
    presentFor1s(48);

    // A window that has only ever managed 48 is at its ceiling, not 80% of one.
    expect(getPresentedFpsCeiling()).toBeCloseTo(48, 0);

    // A real collapse still reads as one, and does not drag the ceiling down
    // with it. Smoothed, so it takes a few windows to walk down there.
    presentFor1s(20);
    presentFor1s(20);
    presentFor1s(20);
    expect(getPresentedFps()).toBeLessThan(30);
    expect(getPresentedFpsCeiling()).toBeCloseTo(48, 0);
  });

  it('never grades against a ceiling below 30', () => {
    getPresentedFps();
    presentFor1s(10);
    expect(getPresentedFpsCeiling()).toBe(30);
  });
});
