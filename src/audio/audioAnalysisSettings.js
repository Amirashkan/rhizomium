/**
 * Shared settings for the real-time audio analysis: how the meters are shaped, and where each
 * drum's trigger threshold sits.
 *
 * There is ONE analysis engine (BrowserAudioCapture's RealtimeAudioAnalysis) producing ONE set of
 * meters for the whole patch, so its shaping is a property of the instrument, not of a node. These
 * used to be parameters on each Audio Analysis node, which meant two such nodes fought over the
 * engine — the last one the processor touched won, and the other node's sliders silently did
 * nothing. Hoisting them here gives the Audio panel a single control surface, and gives every
 * Audio Value node the same numbers the panel is showing.
 *
 * Persisted to localStorage rather than into the patch: they are dialled in against the track that
 * happens to be playing, which is a property of the room and the set, not of the composition.
 */

const STORAGE_KEY = 'glsl-node-editor.audio-analysis.settings';

export const AUDIO_ANALYSIS_DEFAULTS = Object.freeze({
  // Meter shape. Attack short enough to catch a transient, release long enough that a hit stays
  // visible for a few frames. These change what the meters LOOK like, which in turn changes what a
  // threshold has to be set to — they are not a second detector.
  attack: 8,
  release: 120,
  gain: 1,
  // One threshold per drum, each on its own 0..1 meter. Set each ABOVE where its meter idles
  // between hits and BELOW where it peaks on one — which is exactly what the panel's meters are
  // for. Under the idle level the trigger stays permanently held open, which produces FEWER
  // triggers rather than more.
  kickThresh: 0.5,
  snareThresh: 0.5,
  hatThresh: 0.5,
});

/** Bounds, so a stored or typed value can never put the analysis somewhere it cannot recover from. */
const RANGES = {
  attack: [1, 200],
  release: [1, 2000],
  gain: [0, 8],
  kickThresh: [0, 1],
  snareThresh: [0, 1],
  hatThresh: [0, 1],
};

function clampSetting(name, value) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num)) return AUDIO_ANALYSIS_DEFAULTS[name];
  const [min, max] = RANGES[name] || [-Infinity, Infinity];
  return Math.min(max, Math.max(min, num));
}

let settings = { ...AUDIO_ANALYSIS_DEFAULTS };
const listeners = new Set();

function load() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    for (const name of Object.keys(AUDIO_ANALYSIS_DEFAULTS)) {
      if (stored?.[name] !== undefined) settings[name] = clampSetting(name, stored[name]);
    }
  } catch {
    // A corrupt or unavailable store is not worth failing over: the defaults are usable.
  }
}
load();

function persist() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  } catch {
    // Private mode / quota: keep running with the in-memory value.
  }
}

/** The current settings. A copy, so a caller cannot mutate the shared object behind the listeners. */
export function getAudioAnalysisSettings() {
  return { ...settings };
}

/**
 * Merge a partial update in and notify. Returns the new settings.
 * Values outside a setting's range are clamped rather than rejected, so a drag to the end of a
 * slider lands on the end of the range instead of reverting.
 */
export function updateAudioAnalysisSettings(patch = {}) {
  let changed = false;
  for (const [name, value] of Object.entries(patch)) {
    if (!(name in AUDIO_ANALYSIS_DEFAULTS)) continue;
    const next = clampSetting(name, value);
    if (next !== settings[name]) {
      settings[name] = next;
      changed = true;
    }
  }
  if (changed) {
    persist();
    for (const fn of listeners) {
      try { fn(getAudioAnalysisSettings()); } catch { /* one bad listener must not stop the rest */ }
    }
  }
  return getAudioAnalysisSettings();
}

/** Back to the defaults above. */
export function resetAudioAnalysisSettings() {
  return updateAudioAnalysisSettings(AUDIO_ANALYSIS_DEFAULTS);
}

/** Subscribe to changes; returns an unsubscribe function. */
export function subscribeAudioAnalysisSettings(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}
