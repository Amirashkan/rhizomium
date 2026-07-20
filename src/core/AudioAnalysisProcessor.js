// src/core/AudioAnalysisProcessor.js
import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';

/**
 * Drives the Audio Analysis node — a precise kick / onset detector on the live audio input.
 *
 * A kick drum is a low-frequency transient. A fragment shader has no memory between frames, so an
 * onset detector (which is inherently stateful) can't be expressed in GLSL/WGSL alone — the same
 * reason Hold and Count need CPU helpers. The detection lives here on the CPU: every frame this
 * reads the chosen band's energy (the same window._audioEnvelope* globals the GPU `g` uniform is
 * fed from) and decides whether a kick just happened, then writes three uniforms the node compiled
 * down to (see compilers/InputNodes.js) which the GPU renderer streams to the shader each frame:
 *   <id>.kick  - a [0,1] envelope that snaps to 1 on a detected hit and decays over `release` ms
 *   <id>.trig  - a single-frame 1.0 pulse on the detection frame
 *   <id>.level - the raw band energy being watched
 *
 * Why this is "precise" rather than a bare threshold:
 *   - Adaptive baseline: the energy is compared against a slow-moving running average, so it fires
 *     on a *transient* (energy jumping well above its recent level) instead of on "bass is loud".
 *     A sustained bassline sits near its own baseline and won't keep re-triggering.
 *   - Absolute floor (`threshold`): the editable minimum energy a hit must clear, so background
 *     noise / near-silence can't trip the adaptive test. This is the primary user-facing control.
 *   - Rising-edge gate: a hit is only registered while the energy is still climbing, catching the
 *     attack of the transient rather than its tail.
 *   - Refractory debounce (`refractory` ms): after a hit, further detection is suppressed for a
 *     short window so a single kick yields exactly one detection instead of a burst.
 */
export class AudioAnalysisProcessor {
  constructor() {
    // nodeId -> { baseline, env, prevEnergy, lastTime, lastKickTime }
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

    const kickNodes = graph.nodes.filter((n) => n?.kind === 'AudioAnalysis');
    if (kickNodes.length === 0) {
      if (this._state.size) this._state.clear();
      return;
    }

    const ctx = this._buildContext(time);
    const live = new Set();

    for (const node of kickNodes) {
      live.add(node.id);

      const band = this._bandName(node);
      const energy = this._bandEnergy(band, ctx);
      const threshold = Math.max(0, this._numericParam(node, 'threshold', 0.15, ctx));
      const sensitivity = Math.max(1.0, this._numericParam(node, 'sensitivity', 1.6, ctx));
      const releaseMs = Math.max(1, this._numericParam(node, 'release', 140.0, ctx));
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

  /** The selected frequency band, normalised to one of the known names (defaults to Bass). */
  _bandName(node) {
    const raw = node.params?.band;
    const name = typeof raw === 'string' ? raw.trim().toLowerCase() : 'bass';
    if (name === 'mids' || name === 'mid') return 'mids';
    if (name === 'highs' || name === 'high' || name === 'treble') return 'highs';
    if (name === 'full' || name === 'fullband' || name === 'all') return 'full';
    return 'bass';
  }

  /** Read the live energy for a band from the same audio globals the shader `g` uniform uses. */
  _bandEnergy(band, ctx) {
    switch (band) {
      case 'mids': return ctx.audioEnvelopeMids;
      case 'highs': return ctx.audioEnvelopeHighs;
      case 'full': return ctx.audioEnvelopeFull || ctx.audioEnvelope;
      case 'bass':
      default: return ctx.audioEnvelopeBass;
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
