/**
 * The live value of every audio analysis channel, computed once per frame.
 *
 * An Audio Value node is a TAP: it names one channel and outputs whatever that channel reads right
 * now. Every tap on the same channel reads the same number, and the Audio panel's meters read it
 * too, so what the panel shows is exactly what a deployed node outputs — that is the whole point of
 * setting a threshold against a meter you can see.
 *
 * The values themselves are produced by AudioAnalysisProcessor (band meters straight from the
 * engine; drum envelopes and triggers from its per-instrument edge detection) and parked here for
 * anything that needs to read them without reaching into the render loop.
 */

/**
 * Every channel an Audio node can name.
 *
 * The order is the contract between the places that must agree on it: the node's Channel menu, the
 * panel's rows, the uniforms AudioAnalysisProcessor writes, and the pin-by-index conversion that
 * brings an old all-in-one Audio Analysis node forward (core/graphHydration.js) — where index N of
 * this list IS pin N of that node, so nothing may be reordered or removed from the middle.
 */
export const AUDIO_TAP_CHANNELS = Object.freeze([
  'level', 'low', 'mid', 'high',
  'kick', 'kickTrig', 'snare', 'snareTrig', 'hat', 'hatTrig',
  'kickMeter', 'snareMeter', 'hatMeter',
  'centroid', 'density',
]);

/** The default channel for a freshly deployed tap: a general-purpose live value. */
export const DEFAULT_AUDIO_TAP_CHANNEL = AUDIO_TAP_CHANNELS[0];

/** Human-readable names, for the panel and the node's Channel menu. */
export const AUDIO_TAP_LABELS = Object.freeze({
  level: 'Level',
  low: 'Low',
  mid: 'Mid',
  high: 'High',
  kick: 'Kick',
  kickTrig: 'Kick Trigger',
  snare: 'Snare',
  snareTrig: 'Snare Trigger',
  hat: 'Hat',
  hatTrig: 'Hat Trigger',
  kickMeter: 'Kick Meter',
  snareMeter: 'Snare Meter',
  hatMeter: 'Hat Meter',
  centroid: 'Brightness',
  density: 'Noisiness',
});

/** The drums each channel group is built from, in the order the panel lists them. */
export const AUDIO_INSTRUMENTS = ['kick', 'snare', 'hat'];

/**
 * Channels produced by a threshold decision, and therefore the ones a tap's own Threshold applies
 * to: each drum's envelope and its trigger. A `*Meter` is the signal the threshold is compared TO,
 * and the continuous meters involve no decision at all, so neither reads a threshold.
 */
export const AUDIO_THRESHOLD_CHANNELS = Object.freeze(
  AUDIO_INSTRUMENTS.flatMap((name) => [name, `${name}Trig`]),
);

/** The drum a threshold-carrying channel belongs to, or null for one that takes no threshold. */
export function audioChannelInstrument(channel) {
  return AUDIO_INSTRUMENTS.find((name) => channel === name || channel === `${name}Trig`) || null;
}

function zeroTaps() {
  const out = {};
  for (const name of AUDIO_TAP_CHANNELS) out[name] = 0;
  return out;
}

let taps = zeroTaps();
// Whether `taps` currently holds anything other than silence, so clearing an already-cleared set
// costs a boolean rather than an object per frame in every patch that has no audio in it.
let live = false;

// Computing the taps costs an engine tick and three edge detections per frame, which is wasted work
// in a patch with no Audio Value node in it. The panel sets this while it is on screen so its
// meters stay live even before anything has been deployed.
let wanted = false;

/** Replace this frame's values. Called by AudioAnalysisProcessor. */
export function setAudioTapValues(values) {
  taps = { ...zeroTaps(), ...(values || {}) };
  live = true;
}

/** Every channel's current value, keyed by channel name. */
export function getAudioTapValues() {
  return taps;
}

/** One channel's current value; an unknown channel reads 0 rather than undefined. */
export function audioTapValue(channel) {
  const v = taps[channel];
  return typeof v === 'number' ? v : 0;
}

/** Back to silence — used when nothing is asking for taps any more. */
export function clearAudioTapValues() {
  if (!live) return;
  taps = zeroTaps();
  live = false;
}

/** Ask the processor to keep the taps live even with no Audio Value node in the graph. */
export function setAudioTapsWanted(value) {
  wanted = !!value;
}

/** Whether anything (the Audio panel) is watching the taps directly. */
export function audioTapsWanted() {
  return wanted;
}
