/**
 * CompositionFormatSync.js - Make a change of output format reach the graph.
 *
 * OutputFormat owns the composition's size and shape, and every renderer derives
 * its pixels from it. But the surfaces that hold those pixels are built once and
 * then cached:
 *
 *   - a compute node's output texture is sized inside
 *     ComputeExecutor.initialize(), from the sim resolution buildWGSL recorded in
 *     the compute registry;
 *   - a node's thumbnail takes its shape from whichever texture it was last read
 *     back from.
 *
 * Neither was re-derived when the format changed, and nothing about a node
 * changes when the composition is resized, so no parameter, connection or graph
 * event would ever invalidate them. A resolution change therefore reached the
 * node band only on the next unrelated edit, and then only for the nodes that
 * edit happened to touch: a compute node picked up the new ratio when some later
 * rebuild resized its output texture, a fragment node when something re-rendered
 * it, and a node that neither touched simply kept the old ratio. That is the
 * mixed, arbitrary-looking behaviour this closes.
 *
 * The pass is ordered: rebuild first (which resizes the compute textures), then
 * refresh the thumbnails that read from them.
 */

import { subscribeOutputFormat } from '../ui/OutputFormat.js';

/**
 * Changes that move the composition's pixels. "output" changes both the size and
 * the shape; "simQuality" changes how many pixels the internal compute textures
 * spend on it, which resizes the very textures the compute thumbnails read back.
 * "previewQuality" and "exportTarget" are machine-local knobs that leave the
 * graph's own textures alone, so they need no pass here.
 */
const APPLIED_KINDS = new Set(['output', 'simQuality']);

/**
 * Start applying output-format changes to the graph and the node band.
 *
 * @param {object} options
 * @param {Function} options.rebuild - Rebuilds the shader graph (updateShaderFromGraph).
 *        May be async; its rejection is contained so the thumbnail pass still runs.
 * @param {Function} options.refreshThumbnails - Re-renders every node thumbnail.
 * @param {Function} [options.subscribe] - Format subscription (injectable for tests).
 * @param {number} [options.delay] - Coalescing window in ms. Typing a width and a
 *        height are two separate changes, and so are the several roles a single
 *        preset moves; one pass should serve them all.
 * @returns {Function} stop - Unsubscribes and cancels any pending pass.
 */
export function startCompositionFormatSync({
  rebuild,
  refreshThumbnails,
  subscribe = subscribeOutputFormat,
  delay = 120,
} = {}) {
  let timer = null;
  let applying = false;
  let queued = false;

  const schedule = () => {
    if (timer) return;
    timer = setTimeout(apply, delay);
  };

  async function apply() {
    timer = null;
    // A change that lands mid-pass must not interleave with it (the rebuild is
    // async, and a second one racing it would fight over the compute textures).
    // Remember it and run one more pass afterwards instead.
    if (applying) {
      queued = true;
      return;
    }
    applying = true;
    try {
      try {
        await rebuild?.();
      } catch {
        // A failed rebuild still leaves thumbnails to redraw at the new format.
      }
      try {
        refreshThumbnails?.();
      } catch {
        // Best effort: the thumbnails are a display concern, not the render.
      }
    } finally {
      applying = false;
    }
    if (queued) {
      queued = false;
      schedule();
    }
  }

  const unsubscribe = subscribe((change) => {
    if (!change || !APPLIED_KINDS.has(change.kind)) return;
    schedule();
  });

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    queued = false;
    unsubscribe?.();
  };
}
