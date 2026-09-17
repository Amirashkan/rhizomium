/**
 * audioDeck.js — the Audio panel's transport, driven from somewhere other than
 * the Audio panel.
 *
 * The panel (src/ui/AudioSettingsPanel.js) is where a person loads a track and
 * presses play. Everything under it is BrowserAudioCapture: one element, one
 * analysis engine, one set of meters. This is the same transport addressed by
 * name rather than by pointer, so a set that arrived with its own beds can play
 * them — see ActionExecutor.doAudio() and the `audio` action.
 *
 * It is deliberately thin. It does not own state, does not decide when to play
 * anything, and holds no file of its own beyond the one the element is pointed
 * at: the truth about what is playing lives on the audio element, exactly as it
 * does for the panel, so the panel and the performer can never disagree about
 * what the meters are reading. The panel repaints from the same client events
 * this fires, which is why loading a bed here shows up there with nothing
 * passed between them.
 *
 * The one rule it enforces is the one the hardware enforces: a file and a live
 * input cannot both feed the analysis. `play()` drops the live input (that is
 * BrowserAudioCapture.play()'s own behaviour) and says so in what it returns,
 * so the caller can put it in the log rather than the artist discovering it
 * when their microphone goes quiet.
 */

import { getBrowserAudioCapture } from './BrowserAudioCapture.js';

/** What the deck reports back, so a caller never has to inspect the client. */
const state = (client) => {
  const el = client?.audioElement || null;
  return {
    file: (typeof el?.dataset?.fileName === 'string' && el.dataset.fileName) || '',
    loaded: !!el?.src,
    playing: el ? !el.paused && !el.ended && el.readyState > 2 : false,
    live: client?.liveKind || null,
    position: el?.currentTime || 0,
  };
};

/**
 * One deck over the shared capture client.
 *
 * @param {object} [client] the capture client, injected by the tests. Left out,
 *   it is the singleton every meter in the editor is already reading.
 */
export function createAudioDeck(client = null) {
  const capture = () => client || getBrowserAudioCapture();

  return {
    /** What the transport is doing, as the panel would describe it. */
    describe() {
      try {
        return state(capture());
      } catch {
        return { file: '', loaded: false, playing: false, live: null, position: 0 };
      }
    },

    /**
     * Point the analysis at a file.
     *
     * The name is parked on the element the way the panel parks it, because
     * that is where describeAudioSource() reads it from — a bed loaded here
     * and a bed loaded by hand have to name themselves the same way.
     */
    async load(file, name = '') {
      const audio = capture();
      await audio.loadFile(file);
      const el = audio.audioElement;
      if (el) {
        el.dataset.fileName = String(name || file?.name || '');
        // A bed is a loop by default: the beds that come with a show are
        // shorter than the section they are under as often as not, and a set
        // that falls silent halfway through a look is a set with a hole in it.
        el.loop = true;
      }
      return state(audio);
    },

    /** @returns {{ok: boolean, reason?: string, stoppedLive?: string}} */
    async play() {
      const audio = capture();
      if (!audio.audioElement?.src) return { ok: false, reason: 'nothing is loaded' };

      // Read before play(), which drops it: what the artist gets back is "the
      // microphone was stopped", which is the surprising half of this.
      const stoppedLive = audio.liveKind || '';
      try {
        await audio.play();
      } catch (error) {
        // Autoplay policy is the common one, and it is recoverable: the artist
        // presses play in the Audio panel once and every later start works.
        return { ok: false, reason: String(error?.message || error) };
      }
      return { ok: true, ...(stoppedLive ? { stoppedLive } : {}) };
    },

    pause() {
      capture().pause();
      return { ok: true };
    },

    stop() {
      capture().stop();
      return { ok: true };
    },

    /** Move the playhead of the bed, in seconds. */
    seek(seconds) {
      const el = capture().audioElement;
      if (!el) return { ok: false, reason: 'nothing is loaded' };
      const position = Number(seconds);
      if (!Number.isFinite(position) || position < 0) return { ok: false, reason: 'not a position' };
      // Past the end of the track is the start of it: the element clamps to
      // the duration and sits there paused, which reads as a dead bed.
      el.currentTime = Number.isFinite(el.duration) && el.duration > 0
        ? position % el.duration
        : position;
      return { ok: true };
    },
  };
}

let deck = null;

/** The deck over the editor's own capture client. */
export function getAudioDeck() {
  if (!deck) deck = createAudioDeck();
  return deck;
}
