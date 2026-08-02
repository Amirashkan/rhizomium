// tests/rendererPartialRedraw.test.js
//
// A partial redraw only repaints the dirty regions and relies on the rest of the canvas still
// holding the previous frame's pixels. These tests pin down when that assumption is allowed to
// hold, because breaking it makes nodes and wires blink out for a single frame.
import { describe, it, expect, beforeEach } from 'vitest';
import { Renderer } from '../src/core/Renderer.js';

function makeCtx(width = 800, height = 600) {
  const calls = { clearRect: [] };
  return {
    calls,
    canvas: { width, height },
    clearRect: (x, y, w, h) => calls.clearRect.push({ x, y, w, h }),
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath() {},
    rect() {},
    clip() {},
  };
}

function makeViewport({ dirty = false, scale = 1 } = {}) {
  return {
    scale,
    offsetX: 0,
    offsetY: 0,
    _dirty: dirty,
    isViewportDirty() {
      return this._dirty;
    },
    markViewportClean() {
      this._dirty = false;
    },
  };
}

describe('Renderer partial redraw gating', () => {
  let ctx;
  let viewport;
  let renderer;
  let drawn;
  let graph;

  beforeEach(() => {
    ctx = makeCtx();
    viewport = makeViewport();
    renderer = new Renderer(ctx, viewport, {});

    drawn = { nodes: null, connections: null };
    renderer._renderBackgroundGrid = () => {};
    renderer._renderConnections = (connections) => { drawn.connections = connections; };
    renderer._renderNodes = (nodes) => { drawn.nodes = nodes; };
    renderer._renderParameterReferences = () => {};

    graph = {
      nodes: [
        { id: 1, x: 0, y: 0, w: 100, h: 80 },
        { id: 2, x: 2000, y: 2000, w: 100, h: 80 },
      ],
      connections: [],
    };
  });

  const renderState = (overrides = {}) => ({
    selection: new Set(),
    dragWire: null,
    boxSelect: null,
    needsFullRedraw: false,
    preciseDirtyRegions: [{ x: 0, y: 0, w: 100, h: 80 }],
    ...overrides,
  });

  const fullClears = () =>
    ctx.calls.clearRect.filter((c) => c.x === 0 && c.y === 0 && c.w === ctx.canvas.width && c.h === ctx.canvas.height);

  it('redraws only the dirty regions when nothing else changed', () => {
    // Commit one frame so the canvas size is known and the viewport is clean.
    renderer.render(graph, renderState({ needsFullRedraw: true, preciseDirtyRegions: null }));
    ctx.calls.clearRect.length = 0;

    renderer.render(graph, renderState());

    expect(fullClears()).toHaveLength(0);
    expect(drawn.nodes.map((n) => n.id)).toEqual([1]);
  });

  it('repaints everything when the viewport moved, so leftover pixels are not left at the old transform', () => {
    renderer.render(graph, renderState({ needsFullRedraw: true, preciseDirtyRegions: null }));
    ctx.calls.clearRect.length = 0;

    // A zoom or pan between frames relocates every pixel drawn earlier.
    viewport._dirty = true;
    viewport.scale = 2.5;

    renderer.render(graph, renderState());

    expect(fullClears()).toHaveLength(1);
    expect(drawn.nodes.map((n) => n.id)).toEqual([1, 2]);
  });

  it('repaints everything after a canvas resize wiped the backing store', () => {
    renderer.render(graph, renderState({ needsFullRedraw: true, preciseDirtyRegions: null }));
    ctx.calls.clearRect.length = 0;

    ctx.canvas.width = 1600;
    ctx.canvas.height = 1200;

    renderer.render(graph, renderState());

    expect(fullClears()).toHaveLength(1);
    expect(drawn.nodes.map((n) => n.id)).toEqual([1, 2]);
  });

  it('never pairs a full clear with a region-filtered repaint', () => {
    // The first frame has no committed canvas size, so it must clear and repaint in full.
    renderer.render(graph, renderState());

    expect(fullClears()).toHaveLength(1);
    expect(drawn.nodes.map((n) => n.id)).toEqual([1, 2]);
  });
});
