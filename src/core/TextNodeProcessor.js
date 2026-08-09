// src/core/TextNodeProcessor.js
import { ensureTextTexture, textNodeHasLiveExpression } from './TextRasterizer.js';

/**
 * Keeps a Text node that reads a live value on screen up to date.
 *
 * Most of a Text node's parameters settle the moment you stop editing them, and the parameter-write
 * paths re-rasterise on the spot. An expression is the exception: `{node_4}` or `=time * 2` has no
 * write to hang off — its value moves because something else in the graph moved — so the only way
 * to keep the drawn string honest is to re-check it on a clock. That is what this does, mirroring
 * HoldNodeProcessor / CountNodeProcessor, which carry CPU-side node state for the same reason.
 *
 * Two things keep the cost proportionate:
 *   - only nodes that actually contain an expression are considered at all, so an ordinary Text
 *     node never enters this path;
 *   - ensureTextTexture compares the RESOLVED layout, so a frame where the value has not visibly
 *     moved costs a string comparison and uploads nothing.
 *
 * The refresh runs on its own interval rather than every frame: rasterising and uploading a
 * megapixel canvas is far heavier than the uniform writes the other processors do, and a numeric
 * readout does not need to be re-drawn at 60 Hz to read as live.
 */
export class TextNodeProcessor {
  /**
   * @param {object} [options]
   * @param {number} [options.intervalMs=50] - minimum gap between refresh passes (~20 Hz)
   */
  constructor({ intervalMs = 50 } = {}) {
    this.intervalMs = intervalMs;
    this._lastRun = 0;
  }

  /**
   * @param {object} graph - the live editor graph
   * @param {object} [opts]
   * @param {number} [opts.now] - current wall-clock ms (injectable for tests)
   */
  update(graph, { now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
    if (!graph?.nodes?.length) return;
    if (now - this._lastRun < this.intervalMs) return;
    this._lastRun = now;

    for (const node of graph.nodes) {
      if (node?.kind !== 'Text') continue;
      if (!textNodeHasLiveExpression(node)) continue;
      ensureTextTexture(node);
    }
  }
}
