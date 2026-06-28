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

  it('grows width to fit a preview band and tracks back down when it is removed', () => {
    const node = { id: 1, kind: 'Add', x: 0, y: 0, __thumb: {} };

    withPreview(128);
    renderer._ensureNodeSize(node);
    const wide = node.w;
    expect(wide).toBeGreaterThanOrEqual(180); // landscape preview minimum

    // Toggling the preview off shrinks the node back to its compact width — width tracks its
    // minimum both ways now, so nothing stays latched wide.
    delete globalThis.window;
    node.__thumb = null;
    renderer._ensureNodeSize(node);
    expect(node.w).toBeLessThan(wide);
    expect(node.w).toBeGreaterThanOrEqual(160); // floor
  });
});

// Regression for "some nodes go wide while you work": a node's width must not latch onto a transient
// value-tag width. The reservation is taken from the value's SHAPE, not its live digits, so animated
// or dragged values don't drift the node wider, and _ensureNodeSize tracks the width back down.
describe('value-tag width reservation is stable across magnitudes', () => {
  const renderer = new Renderer(null, null, {});
  renderer.ctx = { measureText: (s) => ({ width: String(s).length * 6 }) };

  it('maps different-magnitude scalars to the same reservation template', () => {
    const a = renderer._valueTagReserveText('0.50');
    expect(renderer._valueTagReserveText('-0.50')).toBe(a);
    expect(renderer._valueTagReserveText('12.34')).toBe(a);
    expect(renderer._valueTagReserveText('123.45')).toBe(a);
  });

  it('keeps a vector tag stable per-component regardless of sign/magnitude', () => {
    const a = renderer._valueTagReserveText('(0.5, 0.5, 0.5)');
    expect(renderer._valueTagReserveText('(-0.5, -0.5, -0.5)')).toBe(a);
    expect(renderer._valueTagReserveText('(12.3, -4.5, 6.7)')).toBe(a);
  });

  it('_ensureNodeSize tracks width back down when the reserved tag width shrinks', () => {
    delete globalThis.window; // no preview band
    const node = { id: 7, kind: 'Add', x: 0, y: 0 };

    node.__valueTagW = 400; // a momentarily huge value tag
    renderer._ensureNodeSize(node);
    const grown = node.w;
    expect(grown).toBeGreaterThan(160);

    node.__valueTagW = 0; // value settles back to something short
    renderer._ensureNodeSize(node);
    expect(node.w).toBeLessThan(grown);
  });
});
