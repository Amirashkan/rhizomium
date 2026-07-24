// src/core/AudioAnalysisProcessor.js
import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';
import { getBrowserAudioCapture } from '../audio/BrowserAudioCapture.js';

/**
 * Drives the Audio Analysis node: a kick detector with two knobs, plus a continuous level output.
 *
 * A fragment shader has no memory between frames, so neither the level envelope nor an onset
 * detector (both inherently stateful) can be expressed in GLSL/WGSL alone — the same reason Hold
 * and Count need CPU helpers. This runs on the CPU every frame and streams four uniforms.
 *
 * WHAT IT DETECTS ON
 * The onset signal from BrowserAudioCapture._computeSpectralFlux: the per-frame rise in linear
 * magnitude across 30-120 Hz (the kick's fundamental), divided by that band's own slowly averaged
 * level. It reads ~0 for a sustained bass note and spikes only when new energy arrives, and the
 * division makes it independent of playback volume. It is deliberately NOT loudness — a bassline
 * holds the band's level high continuously, so loudness cannot separate a kick from the note under
 * it. The `strength` output reports this number, so Threshold can be read off rather than guessed.
 *
 * HOW A HIT IS DECIDED
 * Peak picking, not threshold-crossing. A kick's attack spans several frames as the FFT window
 * slides across it, so "first frame over the line" fires on the way up and again on any later
 * ripple — the classic doubled hit, and one no knob can tune away. Each frame is judged one frame
 * LATE, once its successor is known, and only a strict local maximum can trigger; a multi-frame
 * attack has exactly one. That costs ~16ms of latency, invisible for visuals.
 *
 * A candidate peak must then clear THRESHOLD (absolute, in the units `strength` reports), stand
 * clear of the recent background by an amount SENSE controls, sit in a band that is actually
 * sounding, and fall outside the minimum gap since the last hit.
 *
 * The threshold is absolute rather than a fraction of the strongest recent hit. Scaling it that
 * way makes every new maximum read as exactly 1.0, so a band holding nothing but noise is
 * amplified into a stream of flawless onsets that NO threshold can reject. Volume independence is
 * handled at the source instead (see above), which gets the same benefit without that failure.
 *
 * Detector timing runs on the WALL CLOCK, not the render loop's sim time: audio plays in real time
 * and does not slow with timeScale or stop when the sim clock pauses, so the gap between hits and
 * the envelope decay have to be real milliseconds to mean anything.
 *
 * Uniforms streamed each frame (see compilers/InputNodes.js):
 *   <id>.level    - continuous 0..1 envelope of the audio
 *   <id>.kick     - snaps to 1 on a detected hit, decays over KICK_RELEASE_MS
 *   <id>.trig     - a single-frame 1.0 pulse on the detection frame
 *   <id>.strength - the onset signal Threshold is compared against
 */
// How far back the detector looks to judge "what a hit sounds like around here": the strong peaks
// within this window define the local reference SENSE works against.
const PEAK_WINDOW_S = 6;
// Fewer recent peaks than this and there is nothing to generalise from, so SENSE stands down and
// Threshold decides alone.
const MIN_PEAKS_FOR_REFERENCE = 5;
// Which recent peaks count as "hits" for that reference. Background wiggles vastly outnumber real
// hits, so the reference is the top sliver, not the middle: taking the median of all peaks lands
// among the noise and drags the reference far below any real hit.
const PEAK_REFERENCE_PERCENTILE = 0.9;
// The band must carry at least this much energy (band envelope, 0..1) for a peak to count. The
// onset signal is relative, so without an absolute presence check a silent passage's noise could
// still be shaped into something that looks like a hit.
const MIN_BAND_ENERGY = 0.04;

// --- fixed detector settings --------------------------------------------------------------------
// These were parameters once. They are constants now because none of them was a real choice: each
// has one value that measurement supports, and exposing them only multiplied the ways to be wrong.

// Minimum time between hits. Longer than a kick's own decay tail, whose late ripples would
// otherwise re-trigger, and long enough to step over an intervening hat. Measured on real music,
// 250ms beat 200ms without costing detections. It still clears quarter-note kicks up to ~240 BPM.
const MIN_GAP_MS = 250;
// How long the `kick` envelope takes to fall back to 0. Cosmetic: it shapes the output, it has no
// effect on what gets detected.
const KICK_RELEASE_MS = 140;
// SENSE (0..1) sets how much of a typical recent hit a peak must match to count:
//   1.0 - no comparison at all, Threshold alone decides (most permissive)
//   0.5 - must also reach half of what recent hits reach
//   0.0 - must match recent hits outright (only the strongest survive)
// It can only ever RAISE the bar above Threshold, never lower it. That ordering matters: a purely
// relative test would rescale a band of pure noise into "hits" that no setting could refuse, which
// is a failure this detector has already had once.

export class AudioAnalysisProcessor {
  constructor() {
    // nodeId -> { peaks, env, f1, f2, f1Energy, lastTime, lastKickTime }
    this._state = new Map();
    // Last config JSON pushed to the audio engine, so we only call updateConfig when it changes
    // (the engine is a shared singleton; there's no point re-pushing an identical config per frame).
    this._lastConfigJson = null;
    // Cached audio-engine handle (lazily resolved; may be null in non-browser/test contexts).
    this._audioClient = undefined;
  }

  /** The shared audio engine, resolved lazily (may be null in non-browser/test contexts). */
  _client() {
    if (this._audioClient === undefined) {
      try {
        this._audioClient = getBrowserAudioCapture();
      } catch (e) {
        this._audioClient = null;
      }
    }
    return this._audioClient;
  }

  /**
   * Push the level envelope's settings to the shared audio engine, once.
   *
   * These were once ten node parameters (follower attack/release/gate, four ADSR stages, curve,
   * normalize, band). They are the values they always defaulted to, so `level` behaves exactly as
   * a default node always did — without asking anyone to understand an ADSR to get a kick.
   */
  _applyEngineConfig() {
    const config = {
      follower: { attack_ms: 50.0, release_ms: 200.0, threshold: 0.1 },
      adsr: { attack_ms: 120.0, decay_ms: 180.0, sustain: 0.7, release_ms: 600.0 },
      shaping: { curve: 'exp', normalize: false },
      frequency: { mode: 'bass', customMin: 40.0, customMax: 120.0 },
    };

    const json = JSON.stringify(config);
    if (json === this._lastConfigJson) return;
    this._lastConfigJson = json;
    const client = this._client();
    try {
      client?.updateConfig?.(config);
    } catch (e) {
      // Never let a config push break the render loop.
    }
  }

  /**
   * @param {Object} graph - the live editor graph (nodes + getNode)
   * @param {Object} opts
   * @param {number} opts.time - current animation time in seconds (matches g.time on the GPU).
   *   Used for expression evaluation only, so `=time`-driven params agree with the shader.
   * @param {number} [opts.now] - wall-clock seconds, for detector timing. Defaults to
   *   performance.now()/1000. Deliberately separate from `time`: the render loop's sim clock is
   *   scaled by timeScale and frozen while paused, but audio keeps playing in real time, so
   *   driving the refractory/decay from it would stretch or freeze them against the music.
   * @param {Object} opts.uniformManager - the active ParameterUniformManager (uniformValues map)
   */
  update(graph, { time = 0, now, uniformManager } = {}) {
    if (!graph?.nodes?.length) return;

    const kickNodes = graph.nodes.filter((n) => n?.kind === 'AudioAnalysis');
    if (kickNodes.length === 0) {
      if (this._state.size) this._state.clear();
      return;
    }

    // Drive the envelope engine one frame BEFORE reading it. This runs every frame (the main render
    // loop is continuous) and is de-duped against the engine's own RAF handler, so the envelope
    // stays live even when that handler never registered (a timing race with window.renderLoop) —
    // which otherwise leaves window._audioEnvelopeValue frozen at a stale value.
    try { this._client()?.tick?.(); } catch (e) { /* never break the render loop */ }

    const ctx = this._buildContext(time);
    const clock = Number.isFinite(now)
      ? now
      : (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const live = new Set();

    for (const node of kickNodes) {
      live.add(node.id);

      // 1. Push this node's Band/Follower/ADSR/Shaping settings into the shared envelope engine,
      //    then read back the shaped envelope it produces as the continuous `level` output.
      this._applyEngineConfig();
      const level = ctx.audioEnvelope; // window._audioEnvelopeValue — the shaped envelope

      // Detection runs on the kick band's onset signal, never on loudness: a sustained bassline
      // holds the band's level high continuously, so loudness cannot tell a kick from the note
      // underneath it. The onset signal measures CHANGE — a held note contributes ~0, an attack
      // spikes — which is the property that makes hits separable at all.
      const rawFlux = this._detectionSignal(ctx);
      const bandEnergy = this._bandEnergy(ctx);

      // 2. The two knobs. Everything else about detection is fixed above.
      const threshold = Math.max(0, this._numericParam(node, 'threshold', 1.0, ctx));
      // Sense reads as sensitivity: 1 fires readily, 0 only on hits as strong as the recent best.
      const sense = Math.min(1, Math.max(0, this._numericParam(node, 'sense', 0.6, ctx)));
      const releaseMs = KICK_RELEASE_MS;
      const refractoryMs = MIN_GAP_MS;

      let st = this._state.get(node.id);
      if (!st) {
        st = {
          // Recent local maxima, as [time, value] pairs, trimmed to PEAK_WINDOW_S. These are what
          // Sense compares a candidate against.
          peaks: [],
          env: 0,
          // One-frame delay line for peak picking: f1 is the frame being judged, f2 its
          // predecessor. Both start at Infinity so nothing can look like a peak until two real
          // frames have gone through. f1Energy carries that frame's band energy, so the presence
          // test judges the same frame the peak test does.
          f1: Infinity,
          f2: Infinity,
          f1Energy: 0,
          lastTime: clock,
          lastKickTime: -Infinity,
        };
        this._state.set(node.id, st);
      }

      // Frame delta, clamped so a tab regaining focus (a huge dt) can't blow up the smoothing.
      const dt = Math.min(0.1, Math.max(0, clock - st.lastTime));
      st.lastTime = clock;

      // Used exactly as measured — NOT rescaled against a running peak. Self-normalization was a
      // trap: dividing by a decaying peak-hold makes every new maximum read as 1.0, so a band
      // containing nothing but noise gets amplified into a stream of "perfect" onsets that no
      // threshold can refuse. The signal is already volume-independent, having been divided by the
      // band's own slow level at the source, which is exactly what a fixed threshold needs.
      const flux = rawFlux;

      // Decay the previous envelope exponentially toward 0 over ~`release` ms (tau = release/1000 s)
      // BEFORE testing for a new hit, so a detection this frame lands at a clean, full 1.0.
      st.env *= Math.exp(-dt / (releaseMs / 1000));
      if (st.env < 1e-4) st.env = 0;

      // Peak picking, judged one frame late. The candidate is the PREVIOUS frame (f1); this frame's
      // flux is what tells us whether f1 was the top of the attack. A strict local maximum
      // (f1 >= f2 and f1 > flux) occurs exactly once per transient, so a multi-frame attack yields
      // one hit instead of firing on the way up and again on every later ripple over the line.
      const isPeak = st.f1 >= st.f2 && st.f1 > flux;

      // Remember every local maximum, so the detector always knows the scale of what is going on
      // around it, and drop anything older than the window. The finite check skips the delay
      // line's startup sentinels, which would otherwise be recorded as an infinitely strong hit
      // and hold the reference above everything real for as long as they stayed in the window.
      if (isPeak && Number.isFinite(st.f1)) st.peaks.push([clock, st.f1]);
      while (st.peaks.length && clock - st.peaks[0][0] > PEAK_WINDOW_S) st.peaks.shift();

      // The bar a peak has to clear. THRESHOLD is the absolute part, in the units `strength`
      // reports (on real music a clear kick reads about 1-2.5, the background about 0.07). SENSE
      // adds a relative part: a share of what recent hits around here actually reach, which is
      // what keeps a quiet passage from firing on things a loud one would ignore. Taking the max
      // means Sense can only ever demand MORE, so it cannot rescale noise into hits.
      let bar = threshold;
      if (sense < 1 && st.peaks.length >= MIN_PEAKS_FOR_REFERENCE) {
        const values = st.peaks.map((p) => p[1]).sort((a, b) => a - b);
        const reference = values[Math.floor(values.length * PEAK_REFERENCE_PERCENTILE)];
        bar = Math.max(bar, (1 - sense) * reference);
      }
      const overFloor = st.f1 >= bar;
      // The band must actually be sounding. Flux is relative, so without this the noise floor of a
      // silent passage normalizes into a "strong onset" — a large share of the phantom hits.
      const bandSounding = st.f1Energy >= MIN_BAND_ENERGY;
      const pastRefractory = (clock - st.lastKickTime) * 1000 >= refractoryMs;

      let trig = 0.0;
      if (isPeak && overFloor && bandSounding && pastRefractory) {
        st.env = 1.0;
        st.lastKickTime = clock;
        trig = 1.0;
      }
      // Advance the delay line.
      st.f2 = st.f1;
      st.f1 = flux;
      st.f1Energy = bandEnergy;

      // Expose to the CPU preview (PreviewComputer reads this for the thumbnail) and to the GPU.
      // `level` is the continuous envelope; `kick`/`trig` come from the detector above.
      node.__kickValue = st.env;
      node.__kickTrig = trig;
      node.__kickLevel = level;
      node.__kickStrength = flux;
      this._writeUniform(uniformManager, `${node.id}.kick`, st.env);
      this._writeUniform(uniformManager, `${node.id}.trig`, trig);
      this._writeUniform(uniformManager, `${node.id}.level`, level);
      // The raw onset signal the threshold is compared against. Exposed so the value can be put on
      // screen and read directly: whatever a kick reads here is what Kick Threshold must sit under.
      this._writeUniform(uniformManager, `${node.id}.strength`, flux);
    }

    // Drop state for Audio Analysis nodes that were deleted so it doesn't leak across edits.
    if (this._state.size > live.size) {
      for (const id of this._state.keys()) {
        if (!live.has(id)) this._state.delete(id);
      }
    }
  }

  /**
   * The signal the detector analyses: the kick band's onset signal, published by
   * BrowserAudioCapture._computeSpectralFlux as window._audioFluxBass. Fixed to that band because
   * this is a kick detector; the band ranges live in BrowserAudioCapture._onsetBandRange.
   */
  _detectionSignal(ctx) {
    return ctx.audioFluxBass;
  }

  /**
   * Absolute energy in the kick band (0..1), used ONLY as a presence gate — "is this band sounding
   * at all?". It saturates on real music so it is useless for telling a kick from a bass note,
   * which is why detection runs on the onset signal instead, but that saturation is harmless for a
   * simple floor test.
   */
  _bandEnergy(ctx) {
    return ctx.audioEnvelopeBass;
  }


  _writeUniform(uniformManager, key, value) {
    if (uniformManager?.uniformValues?.has(key)) {
      uniformManager.uniformValues.set(key, value);
    }
  }

  _buildContext(time) {
    return {
      time,
      frame: Math.floor(time * 60),
      // Read the same audio globals the GPU `g` uniform is fed from, so a =audioEnvelope-driven
      // threshold/sensitivity matches what the shader would have sampled.
      audioEnvelope: (typeof window !== 'undefined' && window._audioEnvelopeValue) || 0,
      audioEnvelopeBass: (typeof window !== 'undefined' && window._audioEnvelopeBass) || 0,
      audioEnvelopeMids: (typeof window !== 'undefined' && window._audioEnvelopeMids) || 0,
      audioEnvelopeHighs: (typeof window !== 'undefined' && window._audioEnvelopeHighs) || 0,
      audioEnvelopeFull: (typeof window !== 'undefined' && window._audioEnvelopeFull) || 0,
      // Per-band spectral flux (onset signal) published by BrowserAudioCapture each tick.
      audioFluxBass: (typeof window !== 'undefined' && window._audioFluxBass) || 0,
      audioFluxMids: (typeof window !== 'undefined' && window._audioFluxMids) || 0,
      audioFluxHighs: (typeof window !== 'undefined' && window._audioFluxHighs) || 0,
      audioFluxFull: (typeof window !== 'undefined' && window._audioFluxFull) || 0,
      audioFluxCustom: (typeof window !== 'undefined' && window._audioFluxCustom) || 0,
      PI: Math.PI,
      E: Math.E,
    };
  }

  /**
   * Resolve a numeric param, evaluating `=expr` / time / audio expressions via the shared
   * expression system so it stays consistent with the shader. Mirrors CountNodeProcessor.
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
        } catch (e) {
          return def;
        }
      }
      const parsed = parseFloat(trimmed);
      return Number.isFinite(parsed) ? parsed : def;
    }
    return def;
  }
}
