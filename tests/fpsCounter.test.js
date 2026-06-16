import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FloatingGPUPreview } from '../src/ui/FloatingGPUPreview.js';

// The preview FPS overlay must reflect real GPU throughput. Its FPSCounter is
// ticked once per GPU-presented frame (gpuRenderer.onFramePresented), not once
// per dispatched render() — see main.js / gpuRenderer.js. These tests pin that
// counting + frame-time behaviour via the counter on a preview instance.
describe('FloatingGPUPreview FPS counter (GPU-completion driven)', () => {
  let canvas;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    window.gpuRenderer = {
      device: { queue: { onSubmittedWorkDone: vi.fn().mockResolvedValue() } },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores ticks while stopped', () => {
    const fc = new FloatingGPUPreview(canvas).fpsCounter;
    fc.frame();
    fc.frame();
    expect(fc.frameCount).toBe(0);
  });

  it('counts presented frames and derives a steady frame-time EMA', () => {
    const fc = new FloatingGPUPreview(canvas).fpsCounter;

    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    fc.start();

    // Five completions ~16ms apart (≈60 fps).
    for (let i = 0; i < 5; i++) { fc.frame(); t += 16; }

    expect(fc.frameCount).toBe(5);
    expect(fc._frameMsEma).toBeCloseTo(16, 0);

    fc.stop();
  });

  it('renders honest fps + frame time into the overlay', () => {
    const overlay = document.createElement('div');
    overlay.className = 'fps-overlay';
    document.body.appendChild(overlay);

    const fc = new FloatingGPUPreview(canvas).fpsCounter;

    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    fc.start();

    // 30 completions over exactly 1000ms → 30 fps, ~33ms apart.
    for (let i = 0; i < 30; i++) { t += 1000 / 30; fc.frame(); }
    fc._updateFPS();

    expect(fc.fps).toBe(30);
    expect(overlay.textContent).toMatch(/^FPS: 30 · \d+\.\d ms$/);

    fc.stop();
    overlay.remove();
  });
});
