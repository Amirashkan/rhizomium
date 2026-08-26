// tests/gridVisibility.test.js
//
// View -> Grid -> "Show Grid" only hides the background dots; snapping is a separate
// toggle and must keep working while the grid is hidden.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Renderer } from '../src/core/Renderer.js';

function makeCtx(width = 800, height = 600) {
  const calls = { drawImage: [] };
  return {
    calls,
    canvas: { width, height },
    clearRect() {},
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath() {},
    rect() {},
    clip() {},
    drawImage: (...args) => calls.drawImage.push(args),
  };
}

describe('background grid visibility', () => {
  let ctx;
  let renderer;
  let previousEditor;

  beforeEach(() => {
    ctx = makeCtx();
    renderer = new Renderer(ctx, { scale: 1, offsetX: 0, offsetY: 0 }, {});

    // Pretend the offscreen tile is already built, so the test does not need a
    // real 2d context for it.
    renderer._regenerateGrid = () => {};
    renderer._gridCanvas = { width: 200, height: 200 };
    renderer._gridTileSizeWorld = 200;

    previousEditor = window.editor;
  });

  afterEach(() => {
    window.editor = previousEditor;
  });

  it('paints grid tiles while the grid is visible', () => {
    window.editor = { getSnapGridSize: () => 20, isGridVisible: () => true };

    renderer._renderBackgroundGrid();

    expect(ctx.calls.drawImage.length).toBeGreaterThan(0);
  });

  it('paints nothing once the grid is hidden', () => {
    window.editor = { getSnapGridSize: () => 20, isGridVisible: () => false };

    renderer._renderBackgroundGrid();

    expect(ctx.calls.drawImage).toHaveLength(0);
  });

  it('still paints for an editor that predates the visibility flag', () => {
    window.editor = { getSnapGridSize: () => 20 };

    renderer._renderBackgroundGrid();

    expect(ctx.calls.drawImage.length).toBeGreaterThan(0);
  });
});
