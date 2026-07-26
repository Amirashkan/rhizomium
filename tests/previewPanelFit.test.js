// The floating preview panel is sized freely by the user; the render is fitted inside it.
//
// Before: the panel's width/height were computed from the render resolution (resolution x 0.5),
// so the window jumped to a new size whenever the render resolution changed and could never be
// resized to a shape the user wanted.
//
// Contract:
//  - the panel keeps the size it was given, whatever the render resolution is;
//  - the canvas CSS size is the render fitted into the panel's canvas box, aspect preserved
//    (letterboxed), while the canvas backing store stays at the render resolution.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FloatingGPUPreview } from '../src/ui/FloatingGPUPreview.js';
import { DEFAULT_OUTPUT, setOutputFormat, resetOutputFormat } from '../src/ui/OutputFormat.js';

const HEADER_AND_BORDERS = 39; // 37px header + 1px border top/bottom

describe('FloatingGPUPreview fits the render into a freely sized panel', () => {
  let canvas;
  let preview;

  beforeEach(() => {
    resetOutputFormat('test');
    window.localStorage?.removeItem('rhizo.previewPanelSize');
    window.localStorage?.removeItem('rhizo.renderQuality');
    canvas = document.createElement('canvas');
    window.gpuRenderer = {
      resizeCanvasSync: vi.fn().mockResolvedValue(),
      device: { queue: { onSubmittedWorkDone: vi.fn().mockResolvedValue() } },
    };
    preview = new FloatingGPUPreview(canvas);
    preview.container = document.createElement('div');
    preview.isVisible = true;
  });

  afterEach(() => {
    resetOutputFormat('test');
    vi.restoreAllMocks();
  });

  it('letterboxes a square render inside a wide panel', () => {
    preview._setPanelSize(802, 402 + HEADER_AND_BORDERS); // 800x402 canvas box
    setOutputFormat(512, 512, 'test');

    preview._fitCanvasToPanel();

    // Square render in a wide box: height-limited, so pillarboxed at 402x402.
    expect(canvas.style.width).toBe('402px');
    expect(canvas.style.height).toBe('402px');
  });

  it('letterboxes a 16:9 render inside a square panel', () => {
    preview._setPanelSize(402, 400 + HEADER_AND_BORDERS); // 400x400 canvas box
    setOutputFormat(1920, 1080, 'test');

    preview._fitCanvasToPanel();

    expect(canvas.style.width).toBe('400px');
    expect(canvas.style.height).toBe('225px');
  });

  it('keeps the panel size when the render resolution changes', () => {
    const panel = preview._setPanelSize(640, 480);
    setOutputFormat(1920, 1080, 'test');

    expect(preview._getPanelSize()).toEqual(panel);

    setOutputFormat(512, 512, 'test');
    expect(preview._getPanelSize()).toEqual(panel);
  });

  it('resizing the panel does not touch the render resolution', () => {
    setOutputFormat(1280, 720, 'test');
    preview._applyResizeDimensions(900, 300);

    expect(preview.settings.settings.resolution).toEqual({ width: 1280, height: 720 });
    expect(preview.container.style.width).toBe('900px');
    expect(preview.container.style.height).toBe('300px');
  });

  it('clamps the panel to its minimum size', () => {
    expect(preview._setPanelSize(10, 10)).toEqual({ width: 200, height: 150 });
  });

  it('pins its seeded size on first use so later resolution changes cannot move it', () => {
    // A panel the user has never resized is seeded from the render resolution
    // once. Re-deriving it on every read would make the panel track the render
    // again - the exact behaviour this replaces.
    const seeded = preview._getPanelSize();
    expect(seeded).toEqual({
      width: DEFAULT_OUTPUT.width * 0.5 + 2,
      height: DEFAULT_OUTPUT.height * 0.5 + HEADER_AND_BORDERS,
    });

    setOutputFormat(1920, 1080, 'test');
    expect(preview._getPanelSize()).toEqual(seeded);

    preview._fitCanvasToPanel();
    const box = preview._getCanvasBox(seeded);
    expect(parseFloat(canvas.style.width)).toBeLessThanOrEqual(box.width);
    expect(parseFloat(canvas.style.height)).toBeLessThanOrEqual(box.height);
  });
});
