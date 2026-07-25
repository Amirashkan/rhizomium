// src/core/CountNodeProcessor.js
import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';
import { audioAnalysisPinValue } from './audioAnalysisPins.js';

/**
 * Drives the Count node.
 *
 * A fragment shader has no memory between frames, so an accumulating counter can't be expressed in
 * GLSL/WGSL alone (the same reason Hold needs a CPU helper). The running count lives on the CPU:
 * every frame this evaluates the node's `pulse` input, detects rising edges (the pulse crossing
 * `threshold`), and adds `step` to the count. The result is written into the `<nodeId>.count`
 * uniform that the Count node compiles down to (see compilers/InputNodes.js); the GPU renderer's
 * `_updateParameterUniforms` then streams it to the shader each frame.
 *
 * Behaviour:
 *   - The count increments by `step` once per rising edge of the pulse (not every frame it's high).
 *   - "Loop" off: the count grows (or shrinks, for a negative step) without bound.
 *   - "Loop" on:  the count wraps within the [min, max] range, so it cycles instead of running away.
 */
export class CountNodeProcessor {
  constructor() {
    // nodeId -> { count, prevHigh }
    this._state = new Map();
    // nodeIds asked to reset (via the node's "Reset Count" button). Applied on the next update()
    // so the reset reuses the same loop/min resolution as the normal path (see update()).
    this._resetRequests = new Set();
  }

  /**
   * Queue a reset for a Count node. The running counter is set back to its initial value on the
   * next update() (loop -> min, otherwise 0). Deferred rather than applied here so it goes through
   * the same param resolution and uniform write as a normal frame, and so it's safe to call from UI
   * code with no access to the graph/uniform manager.
   */
  requestReset(nodeId) {
    if (nodeId != null) this._resetRequests.add(nodeId);
  }

  /**
   * @param {Object} graph - the live editor graph (nodes + getNode)
   * @param {Object} opts
   * @param {number} opts.time - current animation time in seconds (matches g.time on the GPU)
   * @param {Object} opts.uniformManager - the active ParameterUniformManager (uniformValues map)
   */
  update(graph, { time = 0, uniformManager } = {}) {
    if (!graph?.nodes?.length) return;

    const countNodes = graph.nodes.filter((n) => n?.kind === 'Count');
    if (countNodes.length === 0) {
      if (this._state.size) this._state.clear();
      if (this._resetRequests.size) this._resetRequests.clear();
      return;
    }

    const ctx = this._buildContext(time);
    const live = new Set();

    for (const node of countNodes) {
      live.add(node.id);

      const pulseSrc = node.inputs?.[0] ? graph.getNode?.(node.inputs[0]) : null;
      const pulsePin = this._sourcePin(graph, node.id, 0);
      const pulse = pulseSrc ? this._evalSignal(pulseSrc, graph, ctx, 0, pulsePin) : 0;
      const threshold = this._numericParam(node, 'threshold', 0.5, ctx);
      const step = this._numericParam(node, 'step', 1.0, ctx);
      const loop = node.params?.loop === true || node.params?.loop === 'true';
      const min = this._numericParam(node, 'min', 0.0, ctx);
      const max = this._numericParam(node, 'max', 10.0, ctx);

      const high = pulse >= threshold;
      let st = this._state.get(node.id);
      if (!st) {
        st = { count: loop ? min : 0, prevHigh: false };
        this._state.set(node.id, st);
      }

      // Apply a queued reset (from the node's "Reset Count" button) before edge detection. Adopt
      // the current pulse level as prevHigh so a pulse that's already high doesn't instantly
      // re-increment the freshly-reset count on this same frame.
      if (this._resetRequests.has(node.id)) {
        st.count = loop ? min : 0;
        st.prevHigh = high;
        this._resetRequests.delete(node.id);
      }

      if (high && !st.prevHigh) {
        st.count += step; // advance once per rising edge
      }
      st.prevHigh = high;

      if (loop) {
        st.count = this._wrap(st.count, min, max);
      }

      // Expose to the CPU preview (PreviewComputer reads this for the thumbnail) and to the GPU.
      node.__countValue = st.count;
      const key = `${node.id}.count`;
      if (uniformManager?.uniformValues?.has(key)) {
        uniformManager.uniformValues.set(key, st.count);
      }
    }

    // Drop state for Count nodes that were deleted so it doesn't leak across edits.
    if (this._state.size > live.size) {
      for (const id of this._state.keys()) {
        if (!live.has(id)) this._state.delete(id);
      }
    }
    // Discard reset requests targeting nodes that no longer exist (e.g. deleted before update ran).
    for (const id of this._resetRequests) {
      if (!live.has(id)) this._resetRequests.delete(id);
    }
  }

  /**
   * Wrap `value` into the half-open range [lo, hi) so the counter cycles. Falls back to clamping
   * at `lo` when the range is empty/inverted, so a misconfigured node can't divide by zero.
   */
  _wrap(value, lo, hi) {
    const span = hi - lo;
    if (!(span > 0)) return lo;
    let v = (value - lo) % span;
    if (v < 0) v += span; // keep it positive for negative steps
    return lo + v;
  }

  _buildContext(time) {
    return {
      time,
      frame: Math.floor(time * 60),
      // Read the same audio globals the GPU `g` uniform is fed from, so a =audioEnvelope-driven
      // threshold/step matches what the shader would have sampled.
      audioEnvelope: window._audioEnvelopeValue || 0,
      audioEnvelopeBass: window._audioEnvelopeBass || 0,
      audioEnvelopeMids: window._audioEnvelopeMids || 0,
      audioEnvelopeHighs: window._audioEnvelopeHighs || 0,
      audioEnvelopeFull: window._audioEnvelopeFull || 0,
      PI: Math.PI,
      E: Math.E,
    };
  }

  /**
   * Find which OUTPUT pin of the upstream node feeds `toNodeId`'s input pin `toPin`.
   * `node.inputs[pin]` only records the source node id, not which of its outputs was wired, so a
   * multi-output source (e.g. Audio Analysis: level/kick/trig) needs the pin from graph.connections.
   * Defaults to 0 when there's no explicit connection record (matches single-output behaviour).
   */
  _sourcePin(graph, toNodeId, toPin) {
    const conns = graph?.connections;
    if (!Array.isArray(conns)) return 0;
    const conn = conns.find((c) => c?.to?.nodeId === toNodeId && c?.to?.pin === toPin);
    return typeof conn?.from?.pin === 'number' ? conn.from.pin : 0;
  }

  /**
   * Evaluate a scalar driver node on the CPU. Covers the kinds that realistically feed a Count's
   * pulse (constants, time, random, triggers, holds, other counts, audio analysis); anything else
   * falls back to the node's last preview value so the edge detection still does something sensible.
   * `outPin` selects which output of a multi-output source is being read (see _sourcePin).
   */
  _evalSignal(node, graph, ctx, depth, outPin = 0) {
    if (!node || depth > 32) return 0;

    switch (node.kind) {
      case 'ConstFloat':
        return this._numericParam(node, 'value', 0, ctx, node.value);

      case 'Time':
        return ctx.time;

      case 'RandomValue':
      case 'RandomTime': {
        const speed = this._numericParam(node, 'speed', 1.0, ctx);
        const s = Math.sin(ctx.time * speed * 12.9898) * 43758.5453;
        return s - Math.floor(s); // fract()
      }

      case 'Pi':
        return Math.PI;

      case 'Trigger': {
        const src = node.inputs?.[0] ? graph.getNode?.(node.inputs[0]) : null;
        const inPin = this._sourcePin(graph, node.id, 0);
        const input = src ? this._evalSignal(src, graph, ctx, depth + 1, inPin) : 0;
        const threshold = this._numericParam(node, 'threshold', 0.5, ctx);
        return input >= threshold ? 1.0 : 0.0;
      }

      case 'Hold':
        return typeof node.__holdValue === 'number' ? node.__holdValue : 0;

      case 'Count':
        // Another Count upstream: reuse its already-advanced value from this frame.
        return typeof node.__countValue === 'number' ? node.__countValue : 0;

      case 'AudioAnalysis':
        // Live CPU-computed outputs streamed each frame by AudioAnalysisProcessor. The pin
        // order is shared with the node definition and the compiler; see
        // core/audioAnalysisPins.js. `kickTrig`/`snareTrig`/`hatTrig` feed a pulse input cleanly.
        return audioAnalysisPinValue(node, outPin);

      default:
        return this._toScalar(node.__preview);
    }
  }

  /**
   * Resolve a numeric param, evaluating `=expr` / time / audio expressions via the shared
   * expression system so it stays consistent with the shader.
   */
  _numericParam(node, name, def, ctx, fallback) {
    let raw = node.params?.[name];
    if (raw === undefined || raw === null) raw = fallback;
    if (raw === undefined || raw === null) return def;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : def;

    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      const isExpression =
        trimmed.startsWith('=') || /[a-zA-Z_]/.test(trimmed) || trimmed.includes('(');
      if (isExpression) {
        try {
          const expr = trimmed.startsWith('=') ? trimmed.slice(1) : trimmed;
          const result = unifiedExpressionSystem.evaluateCPU(expr, ctx);
          const num = typeof result === 'number' ? result : parseFloat(result);
          return Number.isFinite(num) ? num : def;
        } catch {
          return def;
        }
      }
      const parsed = parseFloat(trimmed);
      return Number.isFinite(parsed) ? parsed : def;
    }
    return def;
  }

  _toScalar(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (Array.isArray(v) && v.length) {
      const n = v[0];
      return typeof n === 'number' && Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
}
