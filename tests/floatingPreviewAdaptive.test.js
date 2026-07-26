import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FloatingGPUPreview } from '../src/ui/FloatingGPUPreview.js';

describe('FloatingGPUPreview adaptive quality', () => {
  let canvas;
  let resizeSpy;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    resizeSpy = vi.fn().mockResolvedValue();
    window.gpuRenderer = {
      resizeCanvasSync: resizeSpy,
      device: { queue: { onSubmittedWorkDone: vi.fn().mockResolvedValue() } },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('engages and restores adaptive scaling around interactions', async () => {
    const preview = new FloatingGPUPreview(canvas);
    preview.container = document.createElement('div');
    preview.isVisible = true;
    preview.settings.settings.resolution = { width: 512, height: 512 };

    const updateSpy = vi.spyOn(preview, 'updateSize').mockResolvedValue();
    preview.onAdaptiveSettingsChanged({
      enabled: true,
      resolutionScale: 0.5,
      cooldownMs: 15,
    });

    preview._applyAdaptiveInteractionState(true, 'test');
    expect(preview._isAdaptiveActive).toBe(true);
    expect(updateSpy).toHaveBeenCalledTimes(1);

    preview._applyAdaptiveInteractionState(false, 'test');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(preview._isAdaptiveActive).toBe(false);
    expect(updateSpy).toHaveBeenCalledTimes(2);

    updateSpy.mockRestore();
  });
});

