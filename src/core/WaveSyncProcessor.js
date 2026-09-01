// src/core/WaveSyncProcessor.js
import { audioAnalysisPinValue } from './audioAnalysisPins.js';
import { isTriggerChangeMode, triggerChangePulse } from './triggerMode.js';
import { evaluateWave, isWaveUnipolar, isWaveSynced, waveSyncTime, WAVE_SYNC_PIN } from './waveform.js';
import { numericParamValue } from './numericParam.js';

/**
 * Drives the Wave node's sync input.
 *
 * The wave itself is pure maths on the clock and compiles straight to WGSL. Restarting its cycle on
 * a pulse does not: "the pulse just went high" is a comparison against the PREVIOUS frame, and a
 * fragment shader has no memory between frames (the same reason Hold, Count and change-mode Trigger
 * need CPU helpers). So the edge detection lives here: every frame this evaluates each synced Wave's
 * `sync` input, and on a rising edge records the current time as the node's new cycle origin. That
 * time is written into the `<nodeId>.syncTime` uniform the compiler emits for a synced Wave (see
 * compilers/InputNodes.js), which the shader subtracts from g.time — so the cycle restarts from
 * Phase at the moment of the pulse. The GPU renderer's `_updateParameterUniforms` streams it each
 * frame.
 *
 * Behaviour:
 *   - The cycle restarts once per RISING edge (the pulse crossing `syncThreshold`), not every frame
 *     the pulse is high — so a gate held open doesn't freeze the wave at its start.
 *   - Between pulses the wave free-runs from wherever it was restarted, so a wave synced to a beat
 *     stays in step with it and drifts back only if the pulses stop.
 *   - A Wave with nothing wired to sync is skipped entirely and stays free-running (its compiled
 *     shader has no syncTime uniform at all), so the common case costs nothing.
 */
export class WaveSyncProcessor {
  constructor() {
    // nodeId -> { syncTime, prevHigh }
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

    const syncedWaves = graph.nodes.filter((n) => n?.kind === 'Wave' && isWaveSynced(n));
    if (syncedWaves.length === 0) {
      if (this._state.size) this._state.clear();
      return;
    }

    const ctx = this._buildContext(time);
    const live = new Set();

    for (const node of syncedWaves) {
      live.add(node.id);

      const src = graph.getNode?.(node.inputs[WAVE_SYNC_PIN]);
      const inPin = this._sourcePin(graph, node.id, WAVE_SYNC_PIN);
      const pulse = src ? this._evalSignal(src, graph, ctx, 0, inPin) : 0;
      const threshold = this._numericParam(node, 'syncThreshold', 0.5, ctx);

      const high = pulse >= threshold;
      let st = this._state.get(node.id);
      if (!st) {
        // Seed only: a wave that just appeared (added, or a patch just loaded) has no previous
        // frame to have risen from, so it must not restart on its first update. Adopting the
        // current pulse level means a sync source sitting high doesn't fire a spurious restart.
        st = { syncTime: 0, prevHigh: high };
        this._state.set(node.id, st);
      } else if (high && !st.prevHigh) {
        st.syncTime = time; // rising edge: this instant becomes the cycle origin
        st.prevHigh = true;
      } else {
        st.prevHigh = high;
      }

      // Expose to the CPU preview (PreviewComputer and the signal evaluators read this for the
      // node's readout) and to the GPU.
      node.__waveSyncTime = st.syncTime;
      const key = `${node.id}.syncTime`;
      if (uniformManager?.uniformValues?.has(key)) {
        uniformManager.uniformValues.set(key, st.syncTime);
      }
    }

    // Drop state for Wave nodes that were deleted (or had their sync pin unwired) so it doesn't
    // leak across edits — and so re-wiring sync starts from a clean reference.
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
      // sync threshold matches what the shader would have sampled.
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
   * Evaluate a scalar driver node on the CPU. Covers the kinds that realistically feed a sync pin
   * (audio triggers, Triggers, counts, holds, other waves); anything else falls back to the node's
   * last preview value so the edge detection still does something sensible. Mirrors
   * CountNodeProcessor. `outPin` selects which output of a multi-output source is being read.
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
        // Another Wave feeding this one's sync (e.g. a slow square gating a fast wave). Its own
        // sync time was advanced earlier this frame if it appears earlier in the graph; either way
        // waveSyncTime() reads whatever it currently holds rather than re-deriving it.
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
        return typeof node.__countValue === 'number' ? node.__countValue : 0;

      case 'AudioAnalysis':
        // Live CPU-computed outputs streamed each frame by AudioAnalysisProcessor. The pin order is
        // shared with the node definition and the compiler; see core/audioAnalysisPins.js.
        // `kickTrig`/`snareTrig`/`hatTrig` are the natural sync sources — one pulse per drum hit.
        return audioAnalysisPinValue(node, outPin);

      case 'AudioValue':
        // One channel of that same live analysis, chosen by the node's Channel parameter and
        // written every frame by the same processor.
        return typeof node.__audio_value === 'number' ? node.__audio_value : 0;

      default:
        return this._toScalar(node.__preview);
    }
  }

  /**
   * Resolve a numeric param, evaluating `=expr` (time, audio, `midi`/`osc`, sibling parameters)
   * the same way the shader does. See core/numericParam.js.
   */
  _numericParam(node, name, def, ctx, fallback) {
    return numericParamValue(node, name, def, ctx, fallback);
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
