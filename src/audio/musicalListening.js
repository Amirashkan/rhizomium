/**
 * musicalListening.js - the one MusicalListener, and who is asking for it.
 *
 * Shaped exactly like audioAnalysisTaps.js, for the same reason: the analysis
 * runs in the render path, so anything it does has to be free when nothing
 * wants it. The performer sets `wanted` while its director is on; nothing else
 * pays for it.
 *
 * Deliberately NOT an entry in AUDIO_TAP_CHANNELS. That list's order is a
 * contract with node pin indices (core/graphHydration.js), and more to the
 * point a listening description is not a number a node can modulate with — it
 * is prose for a model and a readout for the artist.
 */

import { MusicalListener, ONSET_WEIGHTS, summarise } from './MusicalListener.js';

export { ONSET_WEIGHTS, summarise };

let listener = null;
let wanted = false;

/** The shared listener, made on first use. */
export function getMusicalListener() {
  if (!listener) listener = new MusicalListener();
  return listener;
}

/** Ask the analysis to keep feeding the listener. */
export function setMusicalListeningWanted(value) {
  const next = !!value;
  if (next === wanted) return;
  wanted = next;
  // Starting fresh matters more here than anywhere else in the audio path: a
  // ninety-second memory of the LAST set is worse than no memory at all.
  if (!wanted) resetMusicalListening();
}

export function musicalListeningWanted() {
  return wanted;
}

/** What the music has been doing. Safe to call at frame rate — it caches. */
export function describeMusic(time) {
  return getMusicalListener().describe(time);
}

/** Forget everything heard so far. */
export function resetMusicalListening() {
  if (listener) listener.reset();
}
