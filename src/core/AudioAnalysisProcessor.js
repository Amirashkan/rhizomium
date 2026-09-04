// src/core/AudioAnalysisProcessor.js
import { getBrowserAudioCapture } from '../audio/BrowserAudioCapture.js';
import {
  AUDIO_ANALYSIS_DEFAULTS,
  clampAudioSetting,
} from '../audio/audioAnalysisDefaults.js';
import {
  AUDIO_INSTRUMENTS,
  AUDIO_TAP_CHANNELS,
  audioTapsWanted,
  clearAudioTapValues,
  getAudioTapValues,
  setAudioTapValues,
} from '../audio/audioAnalysisTaps.js';
import { numericParamValue } from './numericParam.js';

/**
 * Drives the Audio node.
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
 *
 * Two sets of values come out of it. The shared TAPS are what the Audio panel displays and what a
 * node reading a channel with no decision behind it (`low`, `kickMeter`) gets: one number per
 * channel for the whole patch. A node on an envelope or a trigger channel instead gets its own
 * detector, run against its own Threshold parameter — which is what lets one `kickTrig` at 0.3 and
 * another at 0.8 be two instruments off one drum.
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
const INSTRUMENTS = AUDIO_INSTRUMENTS;
// Continuous meters passed straight through.
const METERS = ['level', 'low', 'mid', 'high', 'centroid', 'density'];

const ZERO_BANDS = {
  level: 0, low: 0, mid: 0, high: 0, kick: 0, snare: 0, hat: 0,
  centroid: 0, density: 0,
  presence: { low: false, mid: false, high: false, kick: false, snare: false, hat: false },
};

export class AudioAnalysisProcessor {
  constructor() {
    // { lastTime, inst: { kick|snare|hat: { armed, env, lastTrigTime } } } — one set for the whole
    // patch, since one threshold per drum decides for every node reading it. Null while nothing is
    // asking, so a patch with no audio nodes and a closed panel costs nothing.
    this._tapState = null;
    this._lastConfigJson = null;
    this._audioClient = undefined;
    // The settings the analysis steps run against, resolved once a frame off the setup node. A
    // threshold moving at 60 Hz is plenty — it is a knob or an expression, not an edge — while the
    // DECISION it feeds has to run far finer than that. See _stepAnalysis.
    this._settings = null;
    // A clock supplied by the host, if it supplies one; otherwise real time. See update().
    this._clock = null;
    // The trigger counts already turned into a frame's pulse, per instrument.
    this._trigSeen = {};
    this._stepBound = null;
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
   * Push the panel's envelope shaping to the shared engine, only when it changed.
   *
   * Attack and Release belong to the analysis, not the decision: they set how sharply a meter
   * rises on a transient and how long it stays readable, which is what makes a hit visible at all.
   * They live in the panel because there is one engine behind every audio node in the patch —
   * copies of them on each node meant the last one written won and the rest did nothing.
   */
  _applySettingsConfig(settings) {
    // No guards here: _resolveSettings clamps every value to its declared range on the way out of
    // the node, so there is one place a bad number is caught rather than two that can disagree.
    this._pushConfig({
      analysis: {
        attack_ms: settings.attack,
        release_ms: settings.release,
        gain: settings.gain,
      },
    });
  }

  /** Send an engine config, skipping the call when nothing about it changed. */
  _pushConfig(config) {
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
   * @param {number} [opts.now] - wall-clock seconds for trigger timing. Omit it — the app does —
   *   and audio runs on `performance.now()`, in real time, unaffected by timeScale or a paused sim
   *   clock. A host that passes it owns the clock outright: every step until the next frame reads
   *   the value given, which is what lets a test drive the detector deterministically instead of
   *   racing the engine's own timer.
   * @param {Object} opts.uniformManager - the active ParameterUniformManager
   */
  update(graph, { time = 0, now, uniformManager } = {}) {
    const all = graph?.nodes || [];
    const nodes = all.filter((n) => n?.kind === 'AudioValue');
    // The setup node, if the patch has one: its parameters are the analysis's settings, which is
    // what makes them MIDI-mappable. The first one wins — there is one engine, so a second copy
    // could only disagree with the first, and "whichever the loop reached last" is not an answer.
    const setup = all.find((n) => n?.kind === 'Audio') || null;
    // The panel keeps the analysis running while it is on screen so its meters move before anything
    // has been added — otherwise a threshold would have to be set against a dead readout.
    if (nodes.length === 0 && !setup && !audioTapsWanted()) {
      this._tapState = null;
      // Without this the engine's own steps would keep deciding triggers for a patch that has
      // stopped asking for them.
      this._settings = null;
      this._trigSeen = {};
      clearAudioTapValues();
      return;
    }

    // Advance the engine before reading it. De-duped against its own timer and RAF handler, so the
    // meters stay live even if neither of those is driving.
    try { this._client()?.tick?.(); } catch { /* never break the render loop */ }

    this._clock = Number.isFinite(now) ? now : null;

    // The settings the analysis steps read. Resolved here because it needs the graph and the
    // expression context, both of which are frame-scoped.
    const ctx = this._buildContext(time);
    this._settings = this._resolveSettings(setup, ctx);
    this._applySettingsConfig(this._settings);

    // Once the engine is running, every analysis step decides the triggers — not just the frames.
    this._listenForAnalysisSteps();

    // Step here too. The timer covers the common case, but nothing guarantees one is running: a
    // test, a headless run, an engine that never started. A step is idempotent in the way that
    // matters — it advances by elapsed time and an already-fired instrument stays fired.
    this._stepAnalysis();

    this._writeNodeValues(nodes, uniformManager);
  }

  /**
   * Take the trigger decisions off the render frame.
   *
   * The analysis engine runs on its own ~8 ms clock (see BrowserAudioCapture), but until this hook
   * existed the meter -> threshold -> edge decision below still ran once per rendered frame. That
   * put trigger detection back on the frame rate it was supposed to be free of: at 20 fps a kick
   * whose meter rose and fell inside 50 ms was never sampled above the threshold at all, so the hit
   * was not late — it was gone. Deciding on every analysis step catches it; the count in the taps
   * is what then carries it safely down to a consumer reading at the frame rate.
   */
  _listenForAnalysisSteps() {
    if (this._stepBound) return;
    const client = this._client();
    if (!client?.on) return;
    this._stepBound = () => this._stepAnalysis();
    client.on('analysis', this._stepBound);
  }

  /**
   * One analysis step: every channel's value, and one trigger decision per drum.
   *
   * Driven by the engine's clock, and by the render loop as a fallback. `performance.now()` is the
   * clock either way — the two drivers must not disagree about what "now" is, or the envelope decay
   * and the retrigger guard are computed across two different epochs.
   */
  _stepAnalysis() {
    const settings = this._settings;
    if (!settings) return;

    const clock = this._clock ?? (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const bands = (typeof window !== 'undefined' && window._audioBands) || ZERO_BANDS;

    if (!this._tapState) this._tapState = this._newState(clock);
    const st = this._tapState;
    const decay = this._advance(st, clock);

    const taps = {};
    for (const name of METERS) taps[name] = bands[name] || 0;
    const trigCount = {};
    for (const name of INSTRUMENTS) {
      const inst = st.inst[name];
      const out = this._stepInstrument(inst, name, bands, settings[`${name}Thresh`], decay, clock);
      taps[name] = out.env;
      taps[`${name}Trig`] = out.trig;
      taps[`${name}Meter`] = out.meter;
      if (out.trig) inst.trigCount += 1;
      trigCount[name] = inst.trigCount;
    }
    taps.trigCount = trigCount;
    setAudioTapValues(taps);
  }

  /**
   * Hand each Audio Value node this frame's number.
   *
   * A trigger channel is the one that cannot simply be sampled: it is one analysis step wide, and
   * the steps are finer than the frames. Reading the count instead means a hit that landed between
   * two frames still produces exactly one frame of 1 — never missed, and never held on for two.
   */
  _writeNodeValues(nodes, uniformManager) {
    const taps = getAudioTapValues();
    const pulses = {};
    for (const name of INSTRUMENTS) {
      const count = taps.trigCount?.[name] || 0;
      pulses[`${name}Trig`] = count > (this._trigSeen[name] || 0) ? 1 : 0;
      this._trigSeen[name] = count;
    }

    // Each node carries one number, under a fixed uniform name — so switching a node's channel is a
    // different value written into the same uniform, with no shader rebuild behind it.
    for (const node of nodes) {
      const channel = node.params?.channel;
      const value = channel in pulses
        ? pulses[channel]
        : (typeof taps[channel] === 'number' ? taps[channel] : taps[AUDIO_TAP_CHANNELS[0]]);
      node.__audio_value = value;
      this._writeUniform(uniformManager, `${node.id}.value`, value);
    }
  }

  /**
   * The analysis's settings this frame: the Audio node's parameters, or the built-in defaults when
   * the patch has no Audio node.
   *
   * The node is the only writable home for these. There used to be a localStorage store beside it
   * that the panel wrote to, which meant a patch could carry two disagreeing copies of the same
   * number with nothing on screen saying which one the engine had picked.
   *
   * The node's are read through the shared parameter evaluator, so a threshold written as `=midi`
   * (or `=midi * 0.6 + 0.2`, or anything reading the clock) is a live number every frame rather
   * than a string that falls back to a default — which is the point of the setting living on a node
   * at all. See core/numericParam.js.
   */
  _resolveSettings(setup, ctx) {
    if (!setup) return { ...AUDIO_ANALYSIS_DEFAULTS };

    const resolved = {};
    for (const [name, fallback] of Object.entries(AUDIO_ANALYSIS_DEFAULTS)) {
      // Clamped here, once, on the way out of the node. A parameter can hold an expression and an
      // expression can produce anything: a release of -5 ms or a threshold of 40 does not just
      // misbehave, it wedges the detector.
      resolved[name] = clampAudioSetting(name, this._numericParam(setup, name, fallback, ctx));
    }
    // What the panel draws as the marker on each drum's meter: the number actually decided on,
    // after any expression or controller reading, not the text in the field.
    setup.__audio_settings = resolved;
    return resolved;
  }

  /** Fresh per-instrument state: nothing has fired yet, so everything is armed. */
  _newState(clock) {
    const st = { lastTime: clock, inst: {} };
    for (const name of INSTRUMENTS) {
      st.inst[name] = { armed: true, env: 0, peak: 0, lastTrigTime: -Infinity, trigCount: 0 };
    }
    return st;
  }

  /** Advance a state's clock; returns this frame's envelope decay factor. */
  _advance(st, clock) {
    const dt = Math.min(0.1, Math.max(0, clock - st.lastTime));
    st.lastTime = clock;
    return Math.exp(-dt / (ENVELOPE_RELEASE_MS / 1000));
  }

  /**
   * One instrument, one frame: meter -> above threshold? -> rising edge -> trigger.
   * Mutates `inst` (the armed/envelope/peak memory) and returns what the outputs read.
   */
  _stepInstrument(inst, name, bands, rawThreshold, decay, clock) {
    const meter = bands[name] || 0;
    const sounding = bands.presence ? bands.presence[name] !== false : true;
    const threshold = Math.min(1, Math.max(0, rawThreshold));

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

    return { env: inst.env, trig, meter };
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
   * Resolve a numeric param, evaluating `=expr` (time, audio, `midi`/`osc`, sibling parameters)
   * the same way the shader does. See core/numericParam.js.
   */
  _numericParam(node, name, def, ctx, fallback) {
    return numericParamValue(node, name, def, ctx, fallback);
  }
}
