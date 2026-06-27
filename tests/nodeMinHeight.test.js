// Regression test: nodes with many pins (e.g. the 4-output Resolution node) must grow tall
// enough that no pin spills past the bottom edge. Pins are laid out from y+32 at 18px spacing,
// so a fixed 80px box couldn't contain 4 output pins (the 4th sits at y+86).

import { describe, it, expect, afterEach } from 'vitest';
import { Renderer } from '../src/core/Renderer.js';

describe('_minNodeHeight grows the node box to fit its pins', () => {
  const renderer = new Renderer(null, null, {});

  it('keeps the default height for nodes with few pins', () => {
    // 2 pins -> 32 + 18 + 16 = 66, below the 80px default, so the default still wins.
    expect(renderer._minNodeHeight({ kind: 'Add' })).toBeLessThanOrEqual(80);
  });

  it('is tall enough to contain all four Resolution output pins', () => {
    // 4 pins -> 32 + 3*18 + 16 = 102, and the lowest pin sits at 32 + 3*18 = 86.
    const h = renderer._minNodeHeight({ kind: 'Resolution' });
    expect(h).toBe(102);
    expect(h).toBeGreaterThan(86);
  });
});

describe('_thumbnailExtent sizes the box to contain the S/M/L preview', () => {
  const renderer = new Renderer(null, null, {});

  afterEach(() => {
    delete globalThis.window;
  });

  const withPreviewSize = (size) => {
    globalThis.window = { editor: { getPreviewSize: () => size } };
  };

  it('returns nothing when the node has no thumbnail', () => {
    withPreviewSize(128);
    expect(renderer._thumbnailExtent({ id: '1', kind: 'Add' })).toEqual({ width: 0, height: 0 });
  });

  it('contains a medium (96) top-right thumbnail with padding on every side', () => {
    withPreviewSize(96);
    // 96 + 6*2 padding = 108 each way. The old fixed 80px box would clip the bottom.
    expect(renderer._thumbnailExtent({ id: '1', kind: 'Add', __thumb: {} }))
      .toEqual({ width: 108, height: 108 });
  });

  it('contains a large (128) thumbnail below the title, no inset for an input-less node', () => {
    withPreviewSize(128);
    // Resolution has no inputs -> no inset. width = 6 + 0 + 128 + 6 = 140; height = 25 + 128 + 6 = 159.
    expect(renderer._thumbnailExtent({ id: '1', kind: 'Resolution', __thumb: {} }))
      .toEqual({ width: 140, height: 159 });
  });

  it('indents a large thumbnail past the input-pin column on nodes with inputs', () => {
    withPreviewSize(128);
    // Add has inputs -> 16px inset so the thumbnail clears the pins. width = 6 + 16 + 128 + 6 = 156.
    expect(renderer._thumbInset({ kind: 'Add' })).toBe(16);
    expect(renderer._thumbInset({ kind: 'Resolution' })).toBe(0);
    expect(renderer._thumbnailExtent({ id: '1', kind: 'Add', __thumb: {} }))
      .toEqual({ width: 156, height: 159 });
  });
});
