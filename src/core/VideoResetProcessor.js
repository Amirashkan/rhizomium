// src/core/VideoResetProcessor.js
import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';

/**
 * Drives the expression side of Texture 2D's Reset button.
 *
 * The Reset control (see data/nodes/TextureNodes.js) is a momentary button that rewinds a video to
 * the start of its clip, or of its trim span. Clicking it calls TextureManager.resetVideo directly;
 * the expression typed into the field under the button is this processor's job: it is evaluated
 * every frame and each rising edge past 0.5 rewinds the clip, so a video can be re-cued by the beat
 * ("=audioEnvelopeBass > 0.6"), by a Trigger elsewhere in the patch ("=node_12"), or by the clock.
 *
 * Seeking a <video> is an imperative CPU action with no shader form, so — like HoldNodeProcessor,
 * CountNodeProcessor and FeedbackResetProcessor — it runs unthrottled once per frame, before the
 * frame is dispatched, and detects the edge itself rather than reading a level.
 */
const THRESHOLD = 0.5;
const VIDEO_KINDS = new Set(['Texture2D']);

export class VideoResetProcessor {
  constructor() {
    // nodeId -> { prevHigh } edge-detection state
    this._state = new Map();
  }

  /**
   * @param {Object} graph - the live editor graph (nodes + getNode)
   * @param {Object} opts
   * @param {number} opts.time - current animation time in seconds (matches g.time on the GPU)
   * @param {Object} [opts.textureManager] - the active TextureManager (defaults to window.textureManager)
   */
  update(graph, { time = 0, textureManager } = {}) {
    if (!graph?.nodes?.length) {
      if (this._state.size) this._state.clear();
      return;
    }

    const nodes = graph.nodes.filter((n) => this._isVideoNode(n) && this._expressionOf(n));
    if (nodes.length === 0) {
      if (this._state.size) this._state.clear();
      return;
    }

    const manager = textureManager || (typeof window !== 'undefined' ? window.textureManager : null);
    const ctx = this._buildContext(time, graph);
    const live = new Set();

    for (const node of nodes) {
      live.add(node.id);

      const signal = this._evaluate(this._expressionOf(node), ctx);
      const high = signal >= THRESHOLD;

      let st = this._state.get(node.id);
      if (!st) {
        // Seed with the current level so an expression that is already high when the patch loads
        // (or when the expression is first typed) doesn't fire on its very first frame.
        this._state.set(node.id, { prevHigh: high });
        continue;
      }

      if (high && !st.prevHigh) {
        manager?.resetVideo?.(node.id);
      }
      st.prevHigh = high;
    }

    // Drop state for nodes that were deleted, or whose expression was cleared, so a later edit
    // starts from a fresh edge rather than one recorded frames ago.
    if (this._state.size > live.size) {
      for (const id of this._state.keys()) {
        if (!live.has(id)) this._state.delete(id);
      }
    }
  }

  /**
   * A texture node currently holding a video. `sourceType` is written by the upload, so a node
   * holding a still image is skipped: it has nothing to rewind, and its Reset control is dimmed.
   */
  _isVideoNode(node) {
    return VIDEO_KINDS.has(node?.kind) && node.params?.sourceType === 'video';
  }

  /** The Reset expression on a node, or '' when it is click-only. */
  _expressionOf(node) {
    const raw = node?.params?.reset;
    return typeof raw === 'string' ? raw.trim() : '';
  }

  _evaluate(expression, ctx) {
    const expr = expression.startsWith('=') ? expression.slice(1).trim() : expression;
    if (!expr) return 0;
    try {
      const result = unifiedExpressionSystem.evaluateCPU(expr, ctx);
      if (typeof result === 'boolean') return result ? 1 : 0;
      const num = typeof result === 'number' ? result : parseFloat(result);
      return Number.isFinite(num) ? num : 0;
    } catch {
      // A half-typed expression reads as "not firing" rather than as an edge.
      return 0;
    }
  }

  _buildContext(time, graph) {
    const ctx = {
      time,
      frame: Math.floor(time * 60),
      // Read the same audio globals the GPU `g` uniform is fed from, so a =audioEnvelope-driven
      // reset fires on the beat the shader is drawing.
      audioEnvelope: window._audioEnvelopeValue || 0,
      audioEnvelopeBass: window._audioEnvelopeBass || 0,
      audioEnvelopeMids: window._audioEnvelopeMids || 0,
      audioEnvelopeHighs: window._audioEnvelopeHighs || 0,
      audioEnvelopeFull: window._audioEnvelopeFull || 0,
      PI: Math.PI,
      E: Math.E,
    };
    this._addNodeReferences(ctx, graph);
    return ctx;
  }

  /**
   * Expose the other nodes' current values as `node_<id>` (and `node_<id>_0`, plus the components
   * of a vector), the same names the parameter fields accept — a Reset expression is written the
   * way every other expression in the panel is. Values come from the preview pass, which is what a
   * `=node_<id>` reference reads everywhere else in the editor.
   */
  _addNodeReferences(ctx, graph) {
    const computed = (typeof window !== 'undefined')
      ? window.editor?.previewComputer?.lastComputedValues
      : null;

    for (const node of graph.nodes) {
      const value = computed?.get?.(node.id) ?? node.__preview;
      if (value === undefined || value === null) continue;

      const name = `node_${node.id}`;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) continue;
        ctx[name] = value;
        ctx[`${name}_0`] = value;
      } else if (Array.isArray(value)) {
        ctx[name] = value;
        const comps = ['x', 'y', 'z', 'w'];
        value.forEach((v, i) => {
          if (typeof v !== 'number' || !Number.isFinite(v)) return;
          if (comps[i]) ctx[`${name}_${comps[i]}`] = v;
          ctx[`${name}_${i}`] = v;
        });
      }
    }
  }
}
