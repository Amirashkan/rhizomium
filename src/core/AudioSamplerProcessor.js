// src/core/AudioSamplerProcessor.js
import { numericParamValue } from './numericParam.js';

/**
 * Plays the Audio Sampler nodes' files.
 *
 * Each sampler in the live graph gets one <audio> element. "The scene turned on" is the moment a
 * sampler node first appears in the graph: opening a patch, switching to a VJ scene (which imports
 * the scene's project and so builds fresh node objects), or adding the node. Players are keyed by
 * the node OBJECT as well as its id — two scenes routinely share ids like node_3, and switching back
 * to a scene must start its clip again rather than carry on the other scene's player.
 *
 * When a node leaves the graph (deleted, or its scene switched away) its clip stops.
 *
 * Only inline `data:` audio is played, for the same reason patchTextures.js refuses anything else:
 * a patch is opened on other people's machines, and a remote URL would be fetched on open.
 *
 * Runs once per frame from the render loop, like the other CPU-side node processors, so Volume and
 * Speed can follow an expression (`=midi`, `=audioEnvelopeBass`).
 */
const SAMPLER_KIND = 'AudioSampler';
const MIN_RATE = 0.0625;
const MAX_RATE = 16;

export function isPlayableAudioSource(src) {
  return typeof src === 'string' && /^data:(audio|video)\//i.test(src.trim());
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class AudioSamplerProcessor {
  /**
   * @param {object} [opts]
   * @param {() => HTMLAudioElement} [opts.createAudio] - element factory (tests pass a stub)
   */
  constructor({ createAudio } = {}) {
    this._createAudio = createAudio || (() => new Audio());
    // nodeId -> { node, src, audio, wantsPlay }
    this._players = new Map();
    this._unlockListener = null;
  }

  update(graph, { time = 0 } = {}) {
    const nodes = (graph?.nodes || []).filter((n) => n?.kind === SAMPLER_KIND);
    if (nodes.length === 0 && this._players.size === 0) return;

    const live = new Set();
    let ctx = null;

    for (const node of nodes) {
      live.add(node.id);
      const src = isPlayableAudioSource(node.params?.audioData) ? node.params.audioData : '';

      let entry = this._players.get(node.id);
      if (entry && (entry.node !== node || entry.src !== src)) {
        // A different scene's node under the same id, or a new file on this one: start over.
        this._dispose(entry);
        entry = null;
      }
      if (!entry) {
        entry = { node, src, audio: null, wantsPlay: false };
        this._players.set(node.id, entry);
        if (src) {
          entry.audio = this._createAudio();
          entry.audio.preload = 'auto';
          entry.audio.src = src;
          if (node.params?.playOnStart !== false) this._play(entry);
        }
      }
      if (!entry.audio) continue;

      ctx ||= this._buildContext(time);
      const audio = entry.audio;
      audio.loop = !!node.params?.loop;
      const volume = clamp(numericParamValue(node, 'volume', 1, ctx), 0, 1);
      if (audio.volume !== volume) audio.volume = volume;
      const rate = clamp(numericParamValue(node, 'playbackRate', 1, ctx), MIN_RATE, MAX_RATE);
      if (audio.playbackRate !== rate) audio.playbackRate = rate;
    }

    for (const [id, entry] of this._players) {
      if (!live.has(id)) {
        this._dispose(entry);
        this._players.delete(id);
      }
    }
  }

  /** Play a sampler's clip from the start (the node's Play button). */
  play(nodeId) {
    const entry = this._players.get(nodeId);
    if (!entry?.audio) return;
    entry.audio.currentTime = 0;
    this._play(entry);
  }

  /** Stop a sampler's clip and rewind it (the node's Stop button). */
  stop(nodeId) {
    const entry = this._players.get(nodeId);
    if (!entry?.audio) return;
    entry.wantsPlay = false;
    entry.audio.pause();
    entry.audio.currentTime = 0;
  }

  isPlaying(nodeId) {
    const audio = this._players.get(nodeId)?.audio;
    return !!audio && !audio.paused;
  }

  /** Silence everything, e.g. when the editor is torn down. */
  dispose() {
    for (const entry of this._players.values()) this._dispose(entry);
    this._players.clear();
    this._removeUnlockListener();
  }

  _play(entry) {
    entry.wantsPlay = true;
    let result;
    try {
      result = entry.audio.play();
    } catch {
      result = null;
    }
    // A browser refuses to start sound before the page has had a click or a key press. Hold the
    // request and retry on the first one, so a patch opened from a link still starts its clip.
    if (result && typeof result.then === 'function') {
      result.then(
        () => { if (!entry.wantsPlay) entry.audio?.pause(); },
        () => { if (entry.wantsPlay && entry.audio) this._armUnlock(); },
      );
    }
  }

  _armUnlock() {
    if (this._unlockListener || typeof window === 'undefined') return;
    this._unlockListener = () => {
      this._removeUnlockListener();
      for (const entry of this._players.values()) {
        if (entry.wantsPlay && entry.audio?.paused) this._play(entry);
      }
    };
    window.addEventListener('pointerdown', this._unlockListener, true);
    window.addEventListener('keydown', this._unlockListener, true);
  }

  _removeUnlockListener() {
    if (!this._unlockListener) return;
    window.removeEventListener('pointerdown', this._unlockListener, true);
    window.removeEventListener('keydown', this._unlockListener, true);
    this._unlockListener = null;
  }

  _dispose(entry) {
    entry.wantsPlay = false;
    const audio = entry.audio;
    entry.audio = null;
    if (!audio) return;
    try {
      audio.pause();
      // Let go of the decoded clip rather than keep a scene's sound alive after it has gone.
      audio.removeAttribute?.('src');
      audio.load?.();
    } catch {
      // A half-torn-down element is still silent.
    }
  }

  _buildContext(time) {
    const w = typeof window !== 'undefined' ? window : {};
    return {
      time,
      frame: Math.floor(time * 60),
      audioEnvelope: w._audioEnvelopeValue || 0,
      audioEnvelopeBass: w._audioEnvelopeBass || 0,
      audioEnvelopeMids: w._audioEnvelopeMids || 0,
      audioEnvelopeHighs: w._audioEnvelopeHighs || 0,
      audioEnvelopeFull: w._audioEnvelopeFull || 0,
      PI: Math.PI,
      E: Math.E,
    };
  }
}
