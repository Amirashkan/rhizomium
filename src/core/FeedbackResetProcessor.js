// src/core/FeedbackResetProcessor.js
import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';
import { controlInputPinIndices } from '../data/NodeDefs.js';
import { audioAnalysisPinValue } from './audioAnalysisPins.js';
import { isTriggerChangeMode, triggerChangePulse } from './triggerMode.js';
import { evaluateWave, isWaveUnipolar } from './waveform.js';

/**
 * Drives the Feedback nodes' Reset input pin.
 *
 * The Feedback / Feedback Field compute nodes expose a "Reset" control pin (a CPU-only scalar pin,
 * see ComputeNodes.js). Wire a Trigger — or any scalar signal — into it and a rising edge clears
 * the node's accumulated feedback, exactly as clicking the panel's "Reset Feedback" button does.
 *
 * A fragment/compute shader has no cross-frame memory and the reset is an imperative GPU action
 * (clearing the ping-pong textures), so this can't live in the shader. Mirroring HoldNodeProcessor /
 * CountNodeProcessor, it runs on the CPU every frame: it evaluates the reset pin's source, detects
 * the rising edge (the signal crossing THRESHOLD), and on each rising edge calls
 * computeExecutor.resetNodeFeedback(node.id).
 */
const THRESHOLD = 0.5;
const FEEDBACK_KINDS = new Set(['ComputeFeedback', 'ComputeFeedbackField']);

export class FeedbackResetProcessor {
  constructor() {
    // nodeId -> { prevHigh } edge-detection state
    this._state = new Map();
  }

  /**
   * @param {Object} graph - the live editor graph (nodes + getNode)
   * @param {Object} opts
   * @param {number} opts.time - current animation time in seconds (matches g.time on the GPU)
   * @param {Object} [opts.computeExecutor] - the active ComputeExecutor (defaults to window.computeExecutor)
   */
  update(graph, { time = 0, computeExecutor } = {}) {
    if (!graph?.nodes?.length) return;

    const feedbackNodes = graph.nodes.filter((n) => FEEDBACK_KINDS.has(n?.kind));
    if (feedbackNodes.length === 0) {
      if (this._state.size) this._state.clear();
      return;
    }

    const executor = computeExecutor || (typeof window !== 'undefined' ? window.computeExecutor : null);
    const ctx = this._buildContext(time);
    const live = new Set();

    for (const node of feedbackNodes) {
      live.add(node.id);

      // Highest signal across all control pins (these nodes have one, but stay general).
      let signal = 0;
      const controlPins = controlInputPinIndices(node.kind);
      for (const pin of controlPins) {
        const srcId = node.inputs?.[pin];
        const src = srcId != null ? graph.getNode?.(srcId) : null;
        if (src) {
          const outPin = this._sourcePin(graph, node.id, pin);
          signal = Math.max(signal, this._evalSignal(src, graph, ctx, 0, outPin));
        }
      }

      const high = signal >= THRESHOLD;
      let st = this._state.get(node.id);
      if (!st) {
        st = { prevHigh: high }; // seed with current level so an already-high pin on load doesn't fire
        this._state.set(node.id, st);
        continue;
      }

      if (high && !st.prevHigh) {
        executor?.resetNodeFeedback?.(node.id);
      }
      st.prevHigh = high;
    }

    // Drop state for Feedback nodes that were deleted so it doesn't leak across edits.
    if (this._state.size > live.size) {
      for (const id of this._state.keys()) {
        if (!live.has(id)) this._state.delete(id);
      }
    }
  }

  _buildContext(time) {
    return {
      time,
      frame: Math.floor(time * 60),
      // Read the same audio globals the GPU `g` uniform is fed from, so a =audioEnvelope-driven
      // threshold matches what the shader would have sampled.
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
   * Evaluate a scalar driver node on the CPU. Covers the kinds that realistically feed a reset pin
   * (constants, time, random, triggers, holds, counts, audio analysis); anything else falls back to
   * the node's last preview value so the edge detection still does something sensible. Mirrors
   * CountNodeProcessor. `outPin` selects which output of a multi-output source is read (see _sourcePin).
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

      case 'Wave':
        // Free-running LFO, evaluated from the clock alone - same curve the shader gets
        // (see core/waveform.js), so a Wave driving this node reads the same here as on screen.
        return evaluateWave({
          shape: node.params?.shape,
          time: ctx.time,
          frequency: this._numericParam(node, 'frequency', 1.0, ctx),
          phase: this._numericParam(node, 'phase', 0.0, ctx),
          amplitude: this._numericParam(node, 'amplitude', 1.0, ctx),
          offset: this._numericParam(node, 'offset', 0.0, ctx),
          pulseWidth: this._numericParam(node, 'pulseWidth', 0.5, ctx),
          unipolar: isWaveUnipolar(node),
        });

      case 'Pi':
        return Math.PI;

      case 'Trigger': {
        // "On value change" mode has no shader/stateless form: its pulse is advanced every frame
        // by TriggerNodeProcessor (which runs before this one), so read the value it computed.
        // A change-mode Trigger wired into a Reset pin therefore clears the feedback whenever its
        // input moves, not when the input crosses a level.
        if (isTriggerChangeMode(node)) return triggerChangePulse(node);
        const src = node.inputs?.[0] ? graph.getNode?.(node.inputs[0]) : null;
        const inPin = this._sourcePin(graph, node.id, 0);
        const input = src ? this._evalSignal(src, graph, ctx, depth + 1, inPin) : 0;
        const threshold = this._numericParam(node, 'threshold', 0.5, ctx);
        return input >= threshold ? 1.0 : 0.0;
      }

      case 'Hold':
        return typeof node.__holdValue === 'number' ? node.__holdValue : 0;

      case 'Count':
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
