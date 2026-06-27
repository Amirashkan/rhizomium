// Regression test for node sizing under the socket-row grid: a node's box must contain its header,
// its optional preview band, and every socket row — with the grid laid out top-down at a fixed row
// height, so multi-pin nodes (e.g. the 4-output Resolution node) can't spill past the bottom edge,
// and changing the preview size only resizes the band (never the grid step or the port alignment).

import { describe, it, expect, afterEach } from 'vitest';
import { Renderer } from '../src/core/Renderer.js';
import {
  nodeMinHeight,
  HEADER_H,
  ROW_H,
  ROW_GRID_TOP_GAP,
  PREVIEW_TOP_GAP,
  BOTTOM_PAD,
} from '../src/core/pinLayout.js';

const headerOnly = HEADER_H + ROW_GRID_TOP_GAP + BOTTOM_PAD;

describe('nodeMinHeight grows the node box to fit its rows', () => {
  it('fits a small node (Add: 2 in / 1 out -> 2 rows)', () => {
    // max(2,1) = 2 rows.
    expect(nodeMinHeight({ y: 0 }, 2, 1, 0)).toBe(headerOnly + 2 * ROW_H);
  });

  it('is tall enough to contain all four Resolution output rows', () => {
    // max(0,4) = 4 rows; nothing spills past the bottom.
    const h = nodeMinHeight({ y: 0 }, 0, 4, 0);
    expect(h).toBe(headerOnly + 4 * ROW_H);
  });

  it('adds the preview band height above the rows', () => {
    // Add with a medium (96) preview: header + gap + 96 + gap + 2 rows + bottom pad.
    expect(nodeMinHeight({ y: 0 }, 2, 1, 96)).toBe(
      HEADER_H + PREVIEW_TOP_GAP + 96 + ROW_GRID_TOP_GAP + 2 * ROW_H + BOTTOM_PAD,
    );
  });
});

describe('_ensureNodeSize applies the shared anatomy to a node', () => {
  const renderer = new Renderer(null, null, {});
  // _minNodeWidth measures text; give the renderer a tiny stub ctx (≈6px per char).
  renderer.ctx = { measureText: (s) => ({ width: String(s).length * 6 }) };

  afterEach(() => {
    delete globalThis.window;
  });

  const withPreview = (size) => {
    globalThis.window = { editor: { getPreviewSize: () => size, shouldShowPreview: () => true } };
  };

  it('sets height to fit the rows when there is no preview', () => {
    delete globalThis.window; // no editor -> no preview band
    const node = { id: 1, kind: 'Resolution', x: 0, y: 0 };
    renderer._ensureNodeSize(node);
    expect(node.h).toBe(headerOnly + 4 * ROW_H); // 4 output rows
  });

  it('only the band changes height when the preview size changes — the grid step is constant', () => {
    const node = { id: 1, kind: 'Add', x: 0, y: 0, __thumb: {} };

    withPreview(48);
    renderer._ensureNodeSize(node);
    const small = node.h;

    withPreview(128);
    renderer._ensureNodeSize(node);
    const large = node.h;

    // The whole height delta is exactly the preview-band delta; the 2 rows + header are unchanged.
    expect(large - small).toBe(128 - 48);
  });

  it('grows width to fit a preview band but never shrinks it back', () => {
    const node = { id: 1, kind: 'Add', x: 0, y: 0, __thumb: {} };

    withPreview(128);
    renderer._ensureNodeSize(node);
    const wide = node.w;
    expect(wide).toBeGreaterThanOrEqual(180); // landscape preview minimum

    // Toggling the preview off must not shrink the node back below its grown width.
    delete globalThis.window;
    node.__thumb = null;
    renderer._ensureNodeSize(node);
    expect(node.w).toBe(wide);
  });
});
