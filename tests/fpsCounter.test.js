import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FloatingGPUPreview } from '../src/ui/FloatingGPUPreview.js';
import { __resetPresentedFrameRate } from '../src/core/presentedFrameRate.js';

// The preview overlay shows two numbers that answer two different questions:
// how many frames the window presented, and how long the GPU took over one.
//
// They used to be the same number, both derived from counting GPU submissions,
// printed as "FPS". That count is capped by the GPU but otherwise follows the
// render loop's dispatch cadence — which on the default fixed timestep is the
// target rate, 60, whatever the display is doing. On a compositor clocked at
// 48Hz the overlay confidently read 60. The fps figure now comes from
// presentedFrameRate (requestAnimationFrame); the completion interval stays,
// labelled as GPU time.
describe('FloatingGPUPreview overlay: presented fps vs GPU time', () => {
  let canvas;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    window.gpuRenderer = {
      device: { queue: { onSubmittedWorkDone: vi.fn().mockResolvedValue() } },
    };
    __resetPresentedFrameRate();
  });

  afterEach(() => {
    __resetPresentedFrameRate();
    vi.restoreAllMocks();
  });

  it('ignores ticks while stopped', () => {
    const fc = new FloatingGPUPreview(canvas).fpsCounter;
    fc.frame();
    fc.frame();
    expect(fc.frameCount).toBe(0);
  });

  it('derives a steady GPU frame-time EMA from completions', () => {
    const fc = new FloatingGPUPreview(canvas).fpsCounter;

    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    fc.start();

    // Five completions ~16ms apart.
    for (let i = 0; i < 5; i++) { fc.frame(); t += 16; }

    expect(fc.frameCount).toBe(5);
    expect(fc._frameMsEma).toBeCloseTo(16, 0);

    fc.stop();
  });

  it('reports presented frames, not completions, as fps', () => {
    const overlay = document.createElement('div');
    overlay.className = 'fps-overlay';
    document.body.appendChild(overlay);

    const fc = new FloatingGPUPreview(canvas).fpsCounter;

    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    fc.start();

    // 60 completions in a second — a fixed-timestep loop dispatching at its
    // target rate while the window is presenting far fewer.
    for (let i = 0; i < 60; i++) { t += 1000 / 60; fc.frame(); }
    fc._updateFPS();

    // No frames have been presented (nothing has driven rAF), so the honest
    // answer is 0 — emphatically not the 60 the completions would have given.
    expect(fc.fps).toBe(0);
    expect(overlay.textContent).toMatch(/^0 fps · 16\.\d ms GPU$/);

    fc.stop();
    overlay.remove();
  });
});
