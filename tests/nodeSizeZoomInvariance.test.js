// Regression test: a node's box is a function of its CONTENT, not of the zoom.
//
// The node card's text used to be specified in counter-scaled units (`12 / viewport.scale`) so it
// would hold a constant on-screen size. But _minNodeWidth measures the title, the pin labels and the
// value tag with those same fonts to decide how wide the node has to be — so zooming out grew every
// node box in world space and zooming back in shrank it again, and the boxes jumped mid-gesture as
// the value-tag reservation re-measured. The fonts are fixed world-unit sizes now.

import { describe, it, expect, afterEach } from 'vitest';
import { Renderer } from '../src/core/Renderer.js';

// A stub 2D context that behaves like a real one in the way that matters here: measureText scales
// with the pixel size of the font currently set. If any sizing path reads the zoom through a font,
// the measurement — and the node width — moves with it.
function stubCtx() {
  const ctx = {
    font: '10px sans-serif',
    measureText(s) {
      const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      return { width: String(s).length * px * 0.6 };
    },
  };
  return ctx;
}

// Size a fresh copy of `node` with the viewport sitting at `scale`.
function sizeAt(scale, node) {
  const renderer = new Renderer(null, null, {});
  renderer.ctx = stubCtx();
  renderer.viewport = { scale, offsetX: 0, offsetY: 0 };
  renderer._ensureFonts();
  const copy = { ...node };
  renderer._ensureNodeSize(copy);
  return copy;
}

describe('node size is zoom-invariant', () => {
  afterEach(() => {
    delete globalThis.window;
  });

  // The two ends of the zoom range ViewportManager clamps to.
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 2.5;

  it('a plain node measures the same at both ends of the zoom range', () => {
    const node = { id: 1, kind: 'Add', x: 0, y: 0 };
    const out = sizeAt(MIN_ZOOM, node);
    const inn = sizeAt(MAX_ZOOM, node);
    expect(out.w).toBe(inn.w);
    expect(out.h).toBe(inn.h);
  });

  it('a renamed node — whose title drives its width — measures the same at both zooms', () => {
    // A long custom name pushes the node past the 160px floor, so the title measurement is what
    // actually decides the width here.
    const node = { id: 7, kind: 'Add', x: 0, y: 0, name: 'a deliberately long node name' };
    expect(sizeAt(MIN_ZOOM, node).w).toBe(sizeAt(MAX_ZOOM, node).w);
  });

  it('a node with a value tag reserved measures the same at both zooms', () => {
    // __valueTagW is itself measured with the pin-label font while drawing, so it was the path that
    // made widths jump as you zoomed. Feed the same reservation at both zooms.
    const node = { id: 3, kind: 'ConstFloat', x: 0, y: 0, __valueTagW: 48 };
    expect(sizeAt(MIN_ZOOM, node).w).toBe(sizeAt(MAX_ZOOM, node).w);
  });

  it('the card fonts carry no zoom term', () => {
    const zoomedOut = new Renderer(null, null, {});
    zoomedOut.viewport = { scale: MIN_ZOOM, offsetX: 0, offsetY: 0 };
    zoomedOut._ensureFonts();

    const zoomedIn = new Renderer(null, null, {});
    zoomedIn.viewport = { scale: MAX_ZOOM, offsetX: 0, offsetY: 0 };
    zoomedIn._ensureFonts();

    expect(zoomedOut._cachedFonts).toEqual(zoomedIn._cachedFonts);
  });
});
