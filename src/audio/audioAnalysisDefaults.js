/**
 * The analysis's settings: what they are, what they mean, and what they are worth before anything
 * sets them.
 *
 * Declarations only. The values in a running patch live on the **Audio node** — one node, its
 * parameters, nothing else — because everything a control needs is what a node parameter already
 * gets: MIDI learn, expressions (`=midi * 0.6 + 0.2`), undo, and travelling with the patch. A
 * threshold is the number a live set is spent dialling in, so it has to be reachable from a knob.
 *
 * This replaces a localStorage-backed store the Audio panel used to write to. That store was a
 * SECOND place the same numbers could live, and a patch could hold both: the node said 0.8, the
 * store said 0.3, and which one the engine used depended on whether the patch happened to contain
 * an Audio node — invisible from either surface. One writable home, and the panel reads it.
 *
 * With no Audio node in the patch the analysis runs on the defaults below and the panel says so,
 * offering the node. Nothing is silently editable that is not visible on a node.
 */

/**
 * Every setting, in the order the Audio node lists them, with the range each is clamped to.
 *
 * The node definition builds its parameters from this (see data/nodes/InputNodes.js), so a range
 * cannot drift between the field a value is typed into and the engine that reads it.
 */
export const AUDIO_ANALYSIS_SETTINGS = Object.freeze([
  // One threshold per drum, each on its own 0..1 meter. Set each ABOVE where its meter idles
  // between hits and BELOW where it peaks on one — which is exactly what the panel's meters are
  // for. Under the idle level the trigger stays permanently held open, which produces FEWER
  // triggers rather than more.
  { name: 'kickThresh', label: 'Kick Thresh', default: 0.5, min: 0, max: 1, step: 0.01 },
  { name: 'snareThresh', label: 'Snare Thresh', default: 0.5, min: 0, max: 1, step: 0.01 },
  { name: 'hatThresh', label: 'Hat Thresh', default: 0.5, min: 0, max: 1, step: 0.01 },
  // Meter shape. Attack short enough to catch a transient, release long enough that a hit stays
  // visible for a few frames. These change what the meters LOOK like, which in turn changes what a
  // threshold has to be set to — they are not a second detector.
  { name: 'attack', label: 'Attack (ms)', default: 8, min: 1, max: 200, step: 1, unit: ' ms' },
  { name: 'release', label: 'Release (ms)', default: 120, min: 1, max: 2000, step: 5, unit: ' ms' },
  // How hot the meters read: a trim on the tonal bands' level, and on how big a jump above its own
  // background a drum's meter needs before it reads full scale. At 0 every meter is dead.
  { name: 'gain', label: 'Gain', default: 1, min: 0, max: 8, step: 0.05 },
]);

/** The setting names, in order. */
export const AUDIO_SETTING_NAMES = Object.freeze(AUDIO_ANALYSIS_SETTINGS.map((s) => s.name));

/** Each setting by name, for a lookup that does not scan. */
export const AUDIO_SETTING_SPECS = Object.freeze(Object.fromEntries(
  AUDIO_ANALYSIS_SETTINGS.map((s) => [s.name, Object.freeze(s)]),
));

/** What the analysis runs on before an Audio node says otherwise. */
export const AUDIO_ANALYSIS_DEFAULTS = Object.freeze(Object.fromEntries(
  AUDIO_ANALYSIS_SETTINGS.map((s) => [s.name, s.default]),
));

/**
 * A value forced into its setting's range.
 *
 * Clamped rather than rejected: a parameter can hold an expression, and an expression can produce
 * anything at all. A release of -5 ms or a threshold of 40 does not just misbehave, it wedges the
 * detector — so the engine takes the nearest usable number instead, and a value that is not a
 * number at all falls back to the default.
 */
export function clampAudioSetting(name, value) {
  const spec = AUDIO_SETTING_SPECS[name];
  if (!spec) return value;
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(num)) return spec.default;
  return Math.min(spec.max, Math.max(spec.min, num));
}

/** Every setting at its default, as a fresh object the caller may keep. */
export function audioAnalysisDefaults() {
  return { ...AUDIO_ANALYSIS_DEFAULTS };
}
