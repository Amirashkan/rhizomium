// src/core/TriggerNodeProcessor.js
import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';
import { audioAnalysisPinValue } from './audioAnalysisPins.js';
import { isTriggerChangeMode, triggerChangePulse, TRIGGER_DEFAULT_MIN_CHANGE } from './triggerMode.js';
import { evaluateWave, isWaveUnipolar } from './waveform.js';

/**
 * Drives the Trigger node's "On value change" mode.
 *
 * The node's default "Threshold" mode is stateless — `input >= threshold` compiles straight to
 * WGSL — but "On value change" has to compare this frame's input against the PREVIOUS frame's, and
 * a fragment shader has no memory between frames (the same reason Hold and Count need CPU helpers).
 * So the comparison lives here: every frame this evaluates the node's `value` input, compares it to
 * the value it last fired on, and writes a 0/1 pulse into the `<nodeId>.pulse` uniform that a
 * change-mode Trigger compiles down to (see compilers/InputNodes.js). The GPU renderer's
 * `_updateParameterUniforms` then streams it to the shader each frame.
 *
 * Behaviour:
 *   - The pulse is 1 on any frame the input moved by more than `minChange`, whatever its level —
 *     a stepped source (a Count, a held value, a MIDI/OSC-bound param) fires one pulse per step.
 *   - `minChange` is a DEADBAND, not a per-frame comparison: the reference value only advances when
 *     the pulse fires, so a signal creeping by less than `minChange` each frame still fires once it
 *     has drifted that far in total, rather than never firing at all.
 *   - The first frame a node is seen only seeds the reference value, so adding a node or loading a
 *     patch never fires a spurious pulse.
 */
export class TriggerNodeProcessor {
  constructor() {
    // nodeId -> { prevValue, pulse }
    this._state = new Map();
  }

  /**
   * @param {Object} graph - the live editor graph (nodes + getNode)
   * @param {Object} opts
   * @param {number} opts.time - current animation time in seconds (matches g.time on the GPU)
   * @param {Object} opts.uniformManager - the active ParameterUniformManager (uniformValues map)
   */
  update(graph, { time = 0, uniformManager } = {}) {
    if (!graph?.nodes?.length) return;

    const changeNodes = graph.nodes.filter((n) => isTriggerChangeMode(n));
    if (changeNodes.length === 0) {
      if (this._state.size) this._state.clear();
      return;
    }

    const ctx = this._buildContext(time);
    const live = new Set();

    for (const node of changeNodes) {
      live.add(node.id);

      const src = node.inputs?.[0] ? graph.getNode?.(node.inputs[0]) : null;
      const inPin = this._sourcePin(graph, node.id, 0);
      const value = src ? this._evalSignal(src, graph, ctx, 0, inPin) : 0;
      // Negative/NaN deadbands would make every frame (or no frame) fire; clamp to a sane magnitude.
      const rawMinChange = this._numericParam(node, 'minChange', TRIGGER_DEFAULT_MIN_CHANGE, ctx);
      const minChange = Number.isFinite(rawMinChange) ? Math.abs(rawMinChange) : TRIGGER_DEFAULT_MIN_CHANGE;

      let st = this._state.get(node.id);
      if (!st) {
        // Seed only: a node that just appeared (added, or a patch just loaded) has no previous
        // frame to differ from, so it must not fire on its first update.
        st = { prevValue: value, pulse: 0 };
        this._state.set(node.id, st);
      } else if (Math.abs(value - st.prevValue) > minChange) {
        st.prevValue = value; // only advance on a fire, so `minChange` acts as a deadband
        st.pulse = 1;
      } else {
        st.pulse = 0;
      }

      // Expose to the CPU preview (PreviewComputer reads this for the thumbnail) and to the GPU.
      node.__triggerPulse = st.pulse;
      const key = `${node.id}.pulse`;
      if (uniformManager?.uniformValues?.has(key)) {
        uniformManager.uniformValues.set(key, st.pulse);
      }
    }

    // Drop state for Trigger nodes that were deleted (or switched back to Threshold mode) so it
    // doesn't leak across edits — and so switching modes twice starts from a clean reference.
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
      // minChange matches what the shader would have sampled.
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
   * Evaluate a scalar driver node on the CPU. Covers the kinds that realistically feed a Trigger's
   * value input (constants, time, random, other triggers, holds, counts, audio analysis); anything
   * else falls back to the node's last preview value so the change detection still does something
   * sensible. Mirrors CountNodeProcessor. `outPin` selects which output of a multi-output source is
   * being read (see _sourcePin).
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
        // A change-mode Trigger upstream: reuse the pulse computed for it this frame (graph order
        // permitting) rather than re-deriving it, so a chain of them stays consistent.
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
        // core/audioAnalysisPins.js.
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
