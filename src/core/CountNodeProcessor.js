// src/core/CountNodeProcessor.js
import { isTriggerChangeMode, triggerChangePulse } from './triggerMode.js';
import { evaluateWave, isWaveUnipolar, waveSyncTime } from './waveform.js';
import { numericParamValue } from './numericParam.js';

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
   * multi-output source (e.g. Resolution: res/width/height) needs the pin from graph.connections.
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

      case 'Wave':
        // LFO evaluated from the clock - same curve the shader gets (see core/waveform.js), so a
        // Wave driving this node reads the same here as on screen. waveSyncTime is the cycle
        // origin WaveSyncProcessor advanced this frame (0 when nothing is wired to sync).
        return evaluateWave({
          shape: node.params?.shape,
          time: ctx.time,
          syncTime: waveSyncTime(node),
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
        // Another Count upstream: reuse its already-advanced value from this frame.
        return typeof node.__countValue === 'number' ? node.__countValue : 0;


      case 'Audio':
        // One channel of the live analysis, chosen by the node's Channel parameter and written
        // every frame by AudioAnalysisProcessor.
        return typeof node.__audio_value === 'number' ? node.__audio_value : 0;

      default:
        // Whatever the preview pass last computed. `outPin` matters here and only here: a
        // multi-output source (a Split's y, a Resolution's height) previews as a list of
        // independent pins, and the wire says which of them is being read.
        return this._toScalar(node.__preview, outPin);
    }
  }

  /**
   * Resolve a numeric param, evaluating `=expr` (time, audio, `midi`/`osc`, sibling parameters)
   * the same way the shader does. See core/numericParam.js.
   */
  _numericParam(node, name, def, ctx, fallback) {
    return numericParamValue(node, name, def, ctx, fallback);
  }

  _toScalar(v, outPin = 0) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    // A multi-output preview: independent scalars, one per output pin, so the wired pin picks one.
    if (v && typeof v === 'object' && Array.isArray(v.values)) {
      const n = v.values[outPin] ?? v.values[0];
      return typeof n === 'number' && Number.isFinite(n) ? n : 0;
    }
    // A plain array is one value's components (a vec3), not a pin list — a wire from it carries the
    // whole vector, and a scalar consumer takes the first component as it always has.
    if (Array.isArray(v) && v.length) {
      const n = v[0];
      return typeof n === 'number' && Number.isFinite(n) ? n : 0;
    }
    return 0;
  }
}
