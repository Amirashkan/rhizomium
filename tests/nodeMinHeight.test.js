// Node sizing: the node splits into a top thumbnail band and a content area below it (title, pins,
// value tags, id). _thumbBandHeight gives the band; _minContentHeight gives the content area.

import { describe, it, expect, afterEach } from 'vitest';
import { Renderer } from '../src/core/Renderer.js';

describe('_minContentHeight fits the title row, pins and the id strip', () => {
  const renderer = new Renderer(null, null, {});

  it('reserves room for a single pin plus the title and id rows', () => {
    // 1 pin -> PIN_TOP(32) + 0 + PIN_ID_RESERVE(22) = 54.
    expect(renderer._minContentHeight({ kind: 'Add' })).toBeGreaterThanOrEqual(54);
  });

  it('grows with the busier side for a multi-output node', () => {
    // Resolution has 4 outputs -> 32 + 3*18 + 22 = 108.
    expect(renderer._minContentHeight({ kind: 'Resolution' })).toBe(108);
  });
});

describe('_thumbBandHeight reserves the top band for the thumbnail', () => {
  const renderer = new Renderer(null, null, {});

  afterEach(() => {
    delete globalThis.window;
  });

  it('is zero when the node has no thumbnail', () => {
    globalThis.window = { editor: { getPreviewSize: () => 128 } };
    expect(renderer._thumbBandHeight({ id: '1', kind: 'Add' })).toBe(0);
  });

  it('is the thumbnail size plus padding above and below', () => {
    globalThis.window = { editor: { getPreviewSize: () => 128 } };
    // 6 + 128 + 6 = 140.
    expect(renderer._thumbBandHeight({ id: '1', kind: 'Add', __thumb: {} })).toBe(140);
  });

  it('shrinks with a smaller (medium) thumbnail', () => {
    globalThis.window = { editor: { getPreviewSize: () => 96 } };
    expect(renderer._thumbBandHeight({ id: '1', kind: 'Add', __thumb: {} })).toBe(108);
  });
});
