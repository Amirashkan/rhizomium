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
 *   2. Runs kick detection on that envelope: an absolute floor (`threshold`) rejects noise, an
 *      adaptive baseline (`sensitivity`) fires on transients rather than steady loudness, a
 *      rising-edge gate catches the attack, and a refractory debounce (`refractory` ms) keeps one
 *      hit from producing a burst.
 *
 * It streams three uniforms the node compiled down to (see compilers/InputNodes.js) which the GPU
 * renderer sends to the shader each frame:
 *   <id>.level - the live shaped envelope in [0,1] (moves continuously while audio plays)
 *   <id>.kick  - a [0,1] envelope that snaps to 1 on a detected hit and decays over `kickRelease` ms
 *   <id>.trig  - a single-frame 1.0 pulse on the detection frame
 */
export class AudioAnalysisProcessor {
  constructor() {
    // nodeId -> { baseline, env, prevEnergy, lastTime, lastKickTime }
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
        normalize: node.params?.normalize !== false && node.params?.normalize !== 'false',
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
   * @param {number} opts.time - current animation time in seconds (matches g.time on the GPU)
   * @param {Object} opts.uniformManager - the active ParameterUniformManager (uniformValues map)
   */
  update(graph, { time = 0, uniformManager } = {}) {
    if (!graph?.nodes?.length) return;

    const kickNodes = graph.nodes.filter((n) => n?.kind === 'AudioAnalysis');
    if (kickNodes.length === 0) {
      if (this._state.size) this._state.clear();
      return;
    }

    const ctx = this._buildContext(time);
    const live = new Set();

    for (const node of kickNodes) {
      live.add(node.id);

      // 1. Push this node's Band/Follower/ADSR/Shaping settings into the shared envelope engine,
      //    then read back the shaped envelope it produces as the analysis signal.
      this._applyEngineConfig(node, ctx);
      const energy = ctx.audioEnvelope; // window._audioEnvelopeValue — the shaped envelope

      // 2. Kick-detection controls.
      const threshold = Math.max(0, this._numericParam(node, 'threshold', 0.15, ctx));
      const sensitivity = Math.max(1.0, this._numericParam(node, 'sensitivity', 1.6, ctx));
      const releaseMs = Math.max(1, this._numericParam(node, 'kickRelease', 140.0, ctx));
      const refractoryMs = Math.max(0, this._numericParam(node, 'refractory', 90.0, ctx));

      let st = this._state.get(node.id);
      if (!st) {
        st = { baseline: energy, env: 0, prevEnergy: energy, lastTime: time, lastKickTime: -Infinity };
        this._state.set(node.id, st);
      }

      // Frame delta, clamped so a tab regaining focus (a huge dt) can't blow up the smoothing.
      const dt = Math.min(0.1, Math.max(0, time - st.lastTime));
      st.lastTime = time;

      // Adaptive baseline: an asymmetric EMA that rises fairly slowly and falls slowly, so a
      // transient briefly spikes ABOVE it. Attack is deliberately not instant, otherwise the
      // baseline would chase the kick and the sensitivity test could never see it. Time constants
      // are in seconds; the (1 - exp(-dt/tau)) form makes the smoothing frame-rate independent.
      const riseAlpha = 1 - Math.exp(-dt / 0.30);
      const fallAlpha = 1 - Math.exp(-dt / 0.50);
      const alpha = energy > st.baseline ? riseAlpha : fallAlpha;
      st.baseline += (energy - st.baseline) * alpha;

      // Decay the previous envelope exponentially toward 0 over ~`release` ms (tau = release/1000 s)
      // BEFORE testing for a new hit, so a detection this frame lands at a clean, full 1.0.
      st.env *= Math.exp(-dt / (releaseMs / 1000));
      if (st.env < 1e-4) st.env = 0;

      // Onset test: energy still climbing, clears the absolute floor, and clearly exceeds the
      // adaptive baseline — and we're past the refractory window since the last detected hit.
      const rising = energy > st.prevEnergy;
      const overFloor = energy >= threshold;
      const overBaseline = energy >= st.baseline * sensitivity + 1e-4;
      const pastRefractory = (time - st.lastKickTime) * 1000 >= refractoryMs;

      let trig = 0.0;
      if (rising && overFloor && overBaseline && pastRefractory) {
        st.env = 1.0;
        st.lastKickTime = time;
        trig = 1.0;
      }
      st.prevEnergy = energy;

      // Expose to the CPU preview (PreviewComputer reads this for the thumbnail) and to the GPU.
      node.__kickValue = st.env;
      node.__kickTrig = trig;
      node.__kickLevel = energy;
      this._writeUniform(uniformManager, `${node.id}.kick`, st.env);
      this._writeUniform(uniformManager, `${node.id}.trig`, trig);
      this._writeUniform(uniformManager, `${node.id}.level`, energy);
    }

    // Drop state for Audio Analysis nodes that were deleted so it doesn't leak across edits.
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
