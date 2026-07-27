// src/core/AudioAnalysisProcessor.js
import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';
import { getBrowserAudioCapture } from '../audio/BrowserAudioCapture.js';

/**
 * Drives the Audio Analysis node.
 *
 * The analysis itself is in RealtimeAudioAnalysis: it turns each frame of audio into bounded 0..1
 * meters — low/mid/high for modulation, kick/snare/hat aimed at one drum each. This file does the
 * other half, deciding when a meter counts as a hit:
 *
 *     meter (0..1) -> above threshold? -> rising edge -> trigger
 *
 * That is three lines of arithmetic on this frame's number, and deliberately so. It replaces a
 * detector that judged each candidate against a rolling window of the preceding seconds, which
 * made a hit's fate depend on its surroundings and left its control aimed at a statistic nobody
 * could see. Here the threshold sits on a meter that can be put on screen: watch where the meter
 * peaks when the kick lands, put the threshold under it, done.
 *
 * The edge is what keeps a held-open meter from machine-gunning: a trigger fires on the frame the
 * meter crosses UP through the threshold, and not again until it has fallen back below (minus a
 * little hysteresis, so a meter hovering on the line does not chatter).
 *
 * A fragment shader has no memory between frames, so all of this runs on the CPU and is streamed
 * to the GPU as per-frame uniforms — the same reason Hold and Count need CPU helpers.
 */

// How far a meter must fall back below the threshold before it can fire again, as a FRACTION of
// the threshold. Proportional rather than fixed: a fixed margin is a rounding error next to a high
// threshold and an unclearable chasm below a low one, which made a low threshold fire LESS than a
// high one — it would latch open on the first hit and never re-arm.
const HYSTERESIS_FRACTION = 0.25;
// Second way back to armed: the meter has fallen to this fraction of its peak since the trigger.
//
// The threshold-relative rule above cannot re-arm a meter that never falls that far, and when that
// happens the instrument does not just mistime — it goes permanently silent, which is far worse
// than a stray trigger. That used to be reachable two ways: a low threshold sits so close to the
// floor that ordinary material never clears it, and a meter held at its clamp could not fall at
// all. This rule keys off the hit's own peak instead, so "the hit is over" is answered without
// reference to where the threshold happens to sit.
//
// It is an OR with the rule above, so it can only ever re-arm sooner, never later. Re-arming early
// cannot invent a trigger on its own: firing again still needs the meter to climb back over the
// threshold from below 40% of the last peak, which is a new hit by any reading, and
// MIN_RETRIGGER_MS still bounds how close together two of them can land.
const PEAK_FALLBACK_FRACTION = 0.4;
// Shortest time between two triggers on one instrument. Short: the edge does the real work, this
// only suppresses chatter faster than any drummer plays.
const MIN_RETRIGGER_MS = 45;
// How long a trigger envelope takes to fall back to 0. Cosmetic: shapes the output, decides nothing.
const ENVELOPE_RELEASE_MS = 140;

// Instruments that get a threshold, an envelope and a trigger.
const INSTRUMENTS = ['kick', 'snare', 'hat'];
// Continuous meters passed straight through.
const METERS = ['level', 'low', 'mid', 'high', 'centroid', 'density'];

const ZERO_BANDS = {
  level: 0, low: 0, mid: 0, high: 0, kick: 0, snare: 0, hat: 0,
  centroid: 0, density: 0,
  presence: { low: false, mid: false, high: false, kick: false, snare: false, hat: false },
};

export class AudioAnalysisProcessor {
  constructor() {
    // nodeId -> { lastTime, inst: { kick|snare|hat: { armed, env, lastTrigTime } } }
    this._state = new Map();
    this._lastConfigJson = null;
    this._audioClient = undefined;
  }

  /** The shared audio engine, resolved lazily (may be null in non-browser/test contexts). */
  _client() {
    if (this._audioClient === undefined) {
      try {
        this._audioClient = getBrowserAudioCapture();
      } catch {
        this._audioClient = null;
      }
    }
    return this._audioClient;
  }

  /**
   * Push the node's envelope shaping to the shared engine, only when it changed.
   *
   * Attack and Release belong to the analysis, not the decision: they set how sharply a meter
   * rises on a transient and how long it stays readable, which is what makes a hit visible at all.
   */
  _applyEngineConfig(node, ctx) {
    const config = {
      analysis: {
        attack_ms: Math.max(1, this._numericParam(node, 'attack', 8, ctx)),
        release_ms: Math.max(1, this._numericParam(node, 'release', 120, ctx)),
        gain: Math.max(0, this._numericParam(node, 'gain', 1, ctx)),
      },
    };
    const json = JSON.stringify(config);
    if (json === this._lastConfigJson) return;
    this._lastConfigJson = json;
    try {
      this._client()?.updateConfig?.(config);
    } catch {
      // Never let a config push break the render loop.
    }
  }

  /**
   * @param {Object} graph - the live editor graph (nodes + getNode)
   * @param {Object} opts
   * @param {number} opts.time - animation time in seconds, for expression evaluation only.
   * @param {number} [opts.now] - wall-clock seconds, for trigger timing. Audio runs in real time
   *   and does not slow with timeScale or stop when the sim clock pauses.
   * @param {Object} opts.uniformManager - the active ParameterUniformManager
   */
  update(graph, { time = 0, now, uniformManager } = {}) {
    if (!graph?.nodes?.length) return;

    const nodes = graph.nodes.filter((n) => n?.kind === 'AudioAnalysis');
    if (nodes.length === 0) {
      if (this._state.size) this._state.clear();
      return;
    }

    // Advance the engine before reading it. De-duped against its own RAF handler, so the meters
    // stay live even if that handler never registered.
    try { this._client()?.tick?.(); } catch { /* never break the render loop */ }

    const ctx = this._buildContext(time);
    const clock = Number.isFinite(now)
      ? now
      : (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const bands = (typeof window !== 'undefined' && window._audioBands) || ZERO_BANDS;
    const live = new Set();

    for (const node of nodes) {
      live.add(node.id);
      this._applyEngineConfig(node, ctx);

      let st = this._state.get(node.id);
      if (!st) {
        st = { lastTime: clock, inst: {} };
        for (const name of INSTRUMENTS) {
          st.inst[name] = { armed: true, env: 0, peak: 0, lastTrigTime: -Infinity };
        }
        this._state.set(node.id, st);
      }
      const dt = Math.min(0.1, Math.max(0, clock - st.lastTime));
      st.lastTime = clock;
      const decay = Math.exp(-dt / (ENVELOPE_RELEASE_MS / 1000));

      // Continuous meters straight through — no decision involved.
      for (const name of METERS) {
        const v = bands[name] || 0;
        node[`__audio_${name}`] = v;
        this._writeUniform(uniformManager, `${node.id}.${name}`, v);
      }

      // One threshold per instrument, decided on this frame's meter.
      for (const name of INSTRUMENTS) {
        const meter = bands[name] || 0;
        const sounding = bands.presence ? bands.presence[name] !== false : true;
        const threshold = Math.min(1, Math.max(0, this._numericParam(node, `${name}Thresh`, 0.5, ctx)));
        const inst = st.inst[name];

        inst.env *= decay;
        if (inst.env < 1e-4) inst.env = 0;

        // Re-arm once the meter has dropped clear of the threshold, so one hit gives one trigger
        // however long the meter stays up — or, failing that, once it has fallen well off the peak
        // of the hit that fired, so the instrument can never latch shut. See the constants above.
        if (!inst.armed) {
          if (meter > inst.peak) inst.peak = meter;
          if (meter < threshold * (1 - HYSTERESIS_FRACTION) ||
              meter < inst.peak * PEAK_FALLBACK_FRACTION) {
            inst.armed = true;
          }
        }

        let trig = 0;
        const pastRetrigger = (clock - inst.lastTrigTime) * 1000 >= MIN_RETRIGGER_MS;
        if (inst.armed && sounding && threshold > 0 && meter >= threshold && pastRetrigger) {
          inst.armed = false;
          inst.lastTrigTime = clock;
          inst.peak = meter;
          inst.env = 1;
          trig = 1;
        }

        node[`__audio_${name}`] = inst.env;
        node[`__audio_${name}Trig`] = trig;
        node[`__audio_${name}Meter`] = meter;
        this._writeUniform(uniformManager, `${node.id}.${name}`, inst.env);
        this._writeUniform(uniformManager, `${node.id}.${name}Trig`, trig);
        this._writeUniform(uniformManager, `${node.id}.${name}Meter`, meter);
      }
    }

    if (this._state.size > live.size) {
      for (const id of this._state.keys()) {
        if (!live.has(id)) this._state.delete(id);
      }
    }
  }

  _writeUniform(uniformManager, key, value) {
    if (uniformManager?.uniformValues?.has(key)) {
      uniformManager.uniformValues.set(key, value);
    }
  }

  _buildContext(time) {
    const b = (typeof window !== 'undefined' && window._audioBands) || ZERO_BANDS;
    return {
      time,
      frame: Math.floor(time * 60),
      // Legacy audio globals, still read by `=audioEnvelope`-style expressions.
      audioEnvelope: (typeof window !== 'undefined' && window._audioEnvelopeValue) || 0,
      audioEnvelopeBass: (typeof window !== 'undefined' && window._audioEnvelopeBass) || 0,
      audioEnvelopeMids: (typeof window !== 'undefined' && window._audioEnvelopeMids) || 0,
      audioEnvelopeHighs: (typeof window !== 'undefined' && window._audioEnvelopeHighs) || 0,
      audioEnvelopeFull: (typeof window !== 'undefined' && window._audioEnvelopeFull) || 0,
      // The live meters, so an expression can use the same numbers the node outputs.
      audioLow: b.low || 0,
      audioMid: b.mid || 0,
      audioHigh: b.high || 0,
      audioKick: b.kick || 0,
      audioSnare: b.snare || 0,
      audioHat: b.hat || 0,
      audioCentroid: b.centroid || 0,
      audioDensity: b.density || 0,
      PI: Math.PI,
      E: Math.E,
    };
  }

  /**
   * Resolve a numeric param, evaluating `=expr` via the shared expression system so it stays
   * consistent with the shader. Mirrors CountNodeProcessor.
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
}
