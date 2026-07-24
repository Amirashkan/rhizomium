// src/core/AudioAnalysisProcessor.js
import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';
import { getBrowserAudioCapture } from '../audio/BrowserAudioCapture.js';

/**
 * Drives the Audio Analysis node — live envelope analysis + precise kick/onset detection.
 *
 * A fragment shader has no memory between frames, so neither the envelope follower/ADSR nor an
 * onset detector (both inherently stateful) can be expressed in GLSL/WGSL alone — the same reason
 * Hold and Count need CPU helpers. This runs on the CPU every frame and does two things:
 *
 *   1. Pushes the node's Band / Follower / ADSR / Shaping params into the shared audio-envelope
 *      engine (BrowserAudioCapture.updateConfig — the same controls that used to live in the Audio
 *      settings panel), then reads back the resulting shaped envelope (window._audioEnvelopeValue).
 *   2. Runs kick detection on the band's SPECTRAL FLUX (the per-frame positive change in the
 *      log-magnitude spectrum, from BrowserAudioCapture's unsmoothed onset analyser) — not on
 *      loudness. Flux is ~0 for a sustained bass note and spikes only when new energy arrives,
 *      which is what makes hits separable at all. For Band: Bass that flux is kick-shaped: taken
 *      over 30-120 Hz with broadband energy subtracted, so a snare or clap cancels out instead of
 *      having to be tuned away.
 *
 *      Detection is PEAK-PICKING, not threshold-crossing. A kick's attack spans several frames
 *      (the FFT window slides across it), so "first frame over the line" fires somewhere on the
 *      way up and then fires again on any later ripple that clears the line — the classic source
 *      of doubled hits, and one no threshold/sensitivity value can tune away. Instead each frame
 *      is judged one frame LATE, once its successor is known, and only a strict local maximum can
 *      trigger. A multi-frame attack has exactly one local max, so it produces exactly one hit.
 *      Cost: ~16ms of latency, invisible for visuals.
 *
 *      A candidate peak must also clear an adaptive threshold (median + `sensitivity` * MAD over
 *      ~1.5s of past flux — robust statistics that hit-frames barely move), clear an absolute
 *      floor (`threshold`, in flux units, where 1.0 means every bin in the band jumped by the full
 *      30 dB cap at once), sit in a band that actually has energy, and fall outside the refractory
 *      window (`refractory` ms) of the last hit.
 *
 *      The floor is deliberately absolute rather than relative to a running peak. Dividing by a
 *      decaying peak-hold sounds appealing — "fire on anything near the strongest recent hit" —
 *      but it makes every new maximum read as exactly 1.0, so a band holding nothing but noise is
 *      amplified into a stream of flawless onsets that NO threshold can reject. Flux is built from
 *      dB differences and is therefore already volume-independent, so an absolute floor stays
 *      meaningful across tracks without that failure mode.
 *
 *      All detector timing runs on the WALL CLOCK, not the render loop's sim time: audio plays in
 *      real time and does not slow down with timeScale or stop when the sim clock pauses, so
 *      `refractory` ms and `kickRelease` ms have to be real milliseconds to mean anything.
 *
 * It streams three uniforms the node compiled down to (see compilers/InputNodes.js) which the GPU
 * renderer sends to the shader each frame:
 *   <id>.level - the live shaped envelope in [0,1] (moves continuously while audio plays)
 *   <id>.kick  - a [0,1] envelope that snaps to 1 on a detected hit and decays over `kickRelease` ms
 *   <id>.trig  - a single-frame 1.0 pulse on the detection frame
 */
// Onset-detector tuning (internal; the node's params scale on top of these).
// How many recent flux frames feed the median/MAD statistics (~1.5s at 60fps).
const FLUX_HISTORY = 90;
// Floor for the MAD term so an unnaturally steady passage can't shrink the adaptive threshold into
// a hair trigger. Absolute, in flux units, for the same reason `threshold` is (see below).
const MIN_MAD = 0.01;
// The selected band must carry at least this much energy (per-band envelope, 0..1) for a peak to
// count as a hit. Flux is a RELATIVE measure — normalization would happily turn the noise floor of
// a silent passage into a "strong onset" — so an absolute presence gate is what keeps the detector
// quiet between tracks, during breakdowns, and while paused.
const MIN_BAND_ENERGY = 0.04;

export class AudioAnalysisProcessor {
  constructor() {
    // nodeId -> { peak, history, env, prevFlux, lastTime, lastKickTime }
    this._state = new Map();
    // Last config JSON pushed to the audio engine, so we only call updateConfig when it changes
    // (the engine is a shared singleton; there's no point re-pushing an identical config per frame).
    this._lastConfigJson = null;
    // Cached audio-engine handle (lazily resolved; may be null in non-browser/test contexts).
    this._audioClient = undefined;
  }

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
   * Build the envelope-engine config from a node's params and push it to the shared audio engine,
   * but only when it actually changed. These are exactly the controls the Audio settings panel used
   * to expose (Follower / ADSR / Shaping / Frequency band).
   */
  _applyEngineConfig(node, ctx) {
    const bandMap = { bass: 'bass', mids: 'mids', highs: 'highs', full: 'fullband', custom: 'custom' };
    const curveMap = { linear: 'linear', exponential: 'exp', exp: 'exp', sigmoid: 'sigmoid' };
    const bandRaw = (typeof node.params?.band === 'string' ? node.params.band : 'Bass').toLowerCase();
    const curveRaw = (typeof node.params?.curve === 'string' ? node.params.curve : 'Exponential').toLowerCase();

    const config = {
      follower: {
        attack_ms: this._numericParam(node, 'attack', 50.0, ctx),
        release_ms: this._numericParam(node, 'envRelease', 200.0, ctx),
        threshold: this._numericParam(node, 'gate', 0.1, ctx),
      },
      adsr: {
        attack_ms: this._numericParam(node, 'adsrAttack', 120.0, ctx),
        decay_ms: this._numericParam(node, 'adsrDecay', 180.0, ctx),
        sustain: this._numericParam(node, 'sustain', 0.7, ctx),
        release_ms: this._numericParam(node, 'adsrRelease', 600.0, ctx),
      },
      shaping: {
        curve: curveMap[curveRaw] || 'exp',
        normalize: node.params?.normalize === true || node.params?.normalize === 'true',
      },
      frequency: {
        mode: bandMap[bandRaw] || 'bass',
        customMin: this._numericParam(node, 'customMin', 60.0, ctx),
        customMax: this._numericParam(node, 'customMax', 250.0, ctx),
      },
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
      this._applyEngineConfig(node, ctx);
      const level = ctx.audioEnvelope; // window._audioEnvelopeValue — the shaped envelope

      // The onset detector runs on the band's SPECTRAL FLUX, not on any loudness envelope. The
      // per-band energy (shaped(rms*3), dB-scaled, clamped to 1) that detection used to read sits
      // near saturation on real music — a sustained bassline holds it at 0.7+ and a kick only nudges
      // it, so no threshold/sensitivity pair can separate hits from steady loudness. Flux measures
      // frame-to-frame spectral CHANGE: a held note contributes ~0, a kick's attack spikes, which is
      // the property that makes precise detection possible at all.
      const rawFlux = this._detectionSignal(node, ctx);
      const bandEnergy = this._bandEnergy(node, ctx);

      // 2. Kick-detection controls.
      const threshold = Math.max(0, this._numericParam(node, 'threshold', 0.12, ctx));
      const sensitivity = Math.max(0, this._numericParam(node, 'sensitivity', 2.5, ctx));
      const releaseMs = Math.max(1, this._numericParam(node, 'kickRelease', 140.0, ctx));
      const refractoryMs = Math.max(0, this._numericParam(node, 'refractory', 200.0, ctx));

      let st = this._state.get(node.id);
      if (!st) {
        st = {
          history: [],
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

      // Detection runs on the flux exactly as measured — NOT rescaled against a running peak.
      // Self-normalization was a trap: dividing by a decaying peak-hold makes every new maximum
      // read as 1.0, so a band containing nothing but noise gets amplified into a stream of
      // "perfect" onsets and no `threshold` value can refuse them. Raw flux is already an absolute,
      // volume-independent quantity (it is built from dB differences, so turning the track up
      // shifts every bin equally and changes nothing), which is exactly what a threshold needs.
      const flux = rawFlux;

      // Adaptive threshold from robust statistics over the last ~1.5s of flux:
      // median + sensitivity * MAD. Unlike a mean/EMA baseline, the median barely moves when a
      // few hit-frames land in the window, so a busy passage doesn't drag the threshold up and
      // a breakdown doesn't turn it into a hair trigger (MAD is floored for the same reason).
      const median = this._median(st.history);
      const mad = Math.max(MIN_MAD, this._median(st.history.map((v) => Math.abs(v - median))));
      const adaptive = median + sensitivity * mad;
      st.history.push(flux);
      if (st.history.length > FLUX_HISTORY) st.history.shift();

      // Decay the previous envelope exponentially toward 0 over ~`release` ms (tau = release/1000 s)
      // BEFORE testing for a new hit, so a detection this frame lands at a clean, full 1.0.
      st.env *= Math.exp(-dt / (releaseMs / 1000));
      if (st.env < 1e-4) st.env = 0;

      // Peak picking, judged one frame late. The candidate is the PREVIOUS frame (f1); this frame's
      // flux is what tells us whether f1 was the top of the attack. A strict local maximum
      // (f1 >= f2 and f1 > flux) occurs exactly once per transient, so a multi-frame attack yields
      // one hit instead of firing on the way up and again on every later ripple over the line.
      const isPeak = st.f1 >= st.f2 && st.f1 > flux;
      // Absolute floor, in flux units: 1.0 would mean every bin in the band jumped by the full
      // 30 dB cap in a single frame, so raising this always fires less and 1.0 fires essentially
      // never. Measured on real drums a kick's onset lands around 0.15-0.95 in the kick band while
      // snares and hats sit near 0.03-0.04, so the default 0.12 clears kicks and refuses the rest.
      const overFloor = st.f1 >= threshold;
      const overAdaptive = st.f1 >= adaptive + 1e-9;
      // The band must actually be sounding. Flux is relative, so without this the noise floor of a
      // silent passage normalizes into a "strong onset" — a large share of the phantom hits.
      const bandSounding = st.f1Energy >= MIN_BAND_ENERGY;
      const pastRefractory = (clock - st.lastKickTime) * 1000 >= refractoryMs;

      let trig = 0.0;
      if (isPeak && overFloor && overAdaptive && bandSounding && pastRefractory) {
        st.env = 1.0;
        st.lastKickTime = clock;
        trig = 1.0;
      }
      // Advance the delay line.
      st.f2 = st.f1;
      st.f1 = flux;
      st.f1Energy = bandEnergy;

      // Expose to the CPU preview (PreviewComputer reads this for the thumbnail) and to the GPU.
      // `level` reports the shaped envelope (the Follower/ADSR/Shaping output); `kick`/`trig` come
      // from the spectral-flux onset detector above.
      node.__kickValue = st.env;
      node.__kickTrig = trig;
      node.__kickLevel = level;
      this._writeUniform(uniformManager, `${node.id}.kick`, st.env);
      this._writeUniform(uniformManager, `${node.id}.trig`, trig);
      this._writeUniform(uniformManager, `${node.id}.level`, level);
    }

    // Drop state for Audio Analysis nodes that were deleted so it doesn't leak across edits.
    if (this._state.size > live.size) {
      for (const id of this._state.keys()) {
        if (!live.has(id)) this._state.delete(id);
      }
    }
  }

  /**
   * The signal the onset/kick detector analyses: the band-limited spectral flux for the node's
   * selected Band (BrowserAudioCapture's _computeSpectralFlux, published as window._audioFlux*).
   * This is intentionally NOT a loudness envelope — flux is ~0 for sustained sound and spikes
   * only on new energy, so hits stay separable even when the band's level sits near saturation.
   * Custom gets its own flux computed over the node's custom Hz range.
   */
  _detectionSignal(node, ctx) {
    const band = (typeof node.params?.band === 'string' ? node.params.band : 'Bass').toLowerCase();
    switch (band) {
      case 'mids': return ctx.audioFluxMids;
      case 'highs': return ctx.audioFluxHighs;
      case 'full': return ctx.audioFluxFull;
      case 'custom': return ctx.audioFluxCustom;
      case 'bass':
      default: return ctx.audioFluxBass;
    }
  }

  /**
   * Absolute energy in the node's band (the per-band envelope, 0..1), used ONLY as a presence
   * gate — "is this band sounding at all?". It's a poor discriminator between a kick and a
   * sustained note (it saturates on real music, which is why detection moved to flux), but that
   * saturation is harmless for a simple floor test. Custom has no dedicated band envelope, so it
   * falls back to full-band presence.
   */
  _bandEnergy(node, ctx) {
    const band = (typeof node.params?.band === 'string' ? node.params.band : 'Bass').toLowerCase();
    switch (band) {
      case 'mids': return ctx.audioEnvelopeMids;
      case 'highs': return ctx.audioEnvelopeHighs;
      case 'full': return ctx.audioEnvelopeFull;
      case 'custom': return ctx.audioEnvelopeFull;
      case 'bass':
      default: return ctx.audioEnvelopeBass;
    }
  }

  /** Median of a non-empty array (returns 0 for an empty one). Copies before sorting. */
  _median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
