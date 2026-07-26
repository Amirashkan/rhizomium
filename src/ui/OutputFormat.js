/**
 * OutputFormat.js - One aspect ratio, many pixel densities.
 *
 * The output format is the composition you are authoring: its width and height
 * are the sole owner of the project's aspect ratio. Everything that rasterises
 * derives from it through resolveResolution(role), so no two surfaces can ever
 * disagree about the SHAPE of the image - only about how many pixels they spend
 * on it:
 *
 *   output    the composition itself (export default, viewer reference)
 *   preview   output x preview quality - a machine-local performance knob
 *   sim       output x sim quality - the internal compute/feedback textures
 *   export    the output size, or a per-export override
 *
 * Persistence scopes differ on purpose:
 *   - output size and sim quality are part of the ARTWORK (resolution-dependent
 *     sims look different at a different size), so they are saved in the project
 *     file and mirrored to localStorage only as the between-projects default;
 *   - preview quality and the export target belong to the MACHINE, so they live
 *     in localStorage and never travel with a project.
 */

export const MIN_WIDTH = 128;
export const MAX_WIDTH = 7680;
export const MIN_HEIGHT = 128;
export const MAX_HEIGHT = 4320;

/** Derived targets may go below the authored minimum, but never to nothing. */
const MIN_DERIVED = 64;

/**
 * Longest edge a simulation texture may have. Compute work is quadratic in area
 * and every feedback node holds two of these, so the sim role is capped even at
 * Full quality. The cap scales BOTH axes, so it can lower the sim's detail but
 * never its shape - see fitToLongEdge.
 */
export const MAX_SIM_EDGE = 2048;

export const DEFAULT_OUTPUT = { width: 1280, height: 720 };

export const OUTPUT_PRESETS = [
  { id: "512", label: "512 × 512 (square)", width: 512, height: 512 },
  { id: "1024", label: "1024 × 1024 (square)", width: 1024, height: 1024 },
  { id: "2048", label: "2048 × 2048 (square)", width: 2048, height: 2048 },
  { id: "720p", label: "720p (1280 × 720)", width: 1280, height: 720 },
  { id: "1080p", label: "1080p (1920 × 1080)", width: 1920, height: 1080 },
  { id: "1440p", label: "1440p (2560 × 1440)", width: 2560, height: 1440 },
  { id: "4K", label: "4K (3840 × 2160)", width: 3840, height: 2160 },
];

/** Quality steps are scale factors so they survive a change of output size. */
export const QUALITY_STEPS = [
  { id: "full", label: "Full", scale: 1 },
  { id: "half", label: "Half", scale: 0.5 },
  { id: "quarter", label: "Quarter", scale: 0.25 },
];

export const ROLES = ["output", "preview", "sim", "export"];

const OUTPUT_STORAGE_KEY = "rhizo.outputFormat";
const MACHINE_STORAGE_KEY = "rhizo.renderQuality";

const listeners = new Set();

const state = {
  output: { ...DEFAULT_OUTPUT },
  previewQuality: "full",
  simQuality: "full",
  exportTarget: { mode: "output", width: DEFAULT_OUTPUT.width, height: DEFAULT_OUTPUT.height },
};

function clamp(value, min, max, fallback) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function sanitizeSize(size, fallback = DEFAULT_OUTPUT) {
  if (!size) return fallback ? { ...fallback } : null;
  const width = clamp(size.width, MIN_WIDTH, MAX_WIDTH, NaN);
  const height = clamp(size.height, MIN_HEIGHT, MAX_HEIGHT, NaN);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return fallback ? { ...fallback } : null;
  }
  return { width, height };
}

function qualityScale(id) {
  return QUALITY_STEPS.find((q) => q.id === id)?.scale ?? 1;
}

function sanitizeQuality(id, fallback = "full") {
  return QUALITY_STEPS.some((q) => q.id === id) ? id : fallback;
}

function readStorage(key) {
  try {
    const raw = window.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, tests) - values still apply in-session.
  }
}

// Boot: the last session's output as the between-projects default, plus the
// machine's own quality knobs. Loading a project overrides output and sim.
const storedOutput = readStorage(OUTPUT_STORAGE_KEY);
if (storedOutput) state.output = sanitizeSize(storedOutput, DEFAULT_OUTPUT);

const storedMachine = readStorage(MACHINE_STORAGE_KEY);
if (storedMachine) {
  state.previewQuality = sanitizeQuality(storedMachine.previewQuality);
  const target = storedMachine.exportTarget;
  if (target?.mode === "custom") {
    state.exportTarget = { mode: "custom", ...sanitizeSize(target, state.output) };
  }
}

/** Roles whose resolution moves when the given setting changes. */
function affectedRoles(kind) {
  switch (kind) {
    case "output": return ROLES.slice();
    case "previewQuality": return ["preview"];
    case "simQuality": return ["sim"];
    case "exportTarget": return ["export"];
    default: return [];
  }
}

function emit(kind, source) {
  const change = { kind, source, roles: affectedRoles(kind) };
  listeners.forEach((listener) => {
    try {
      listener(change);
    } catch (err) {
      console.warn("[OutputFormat] listener failed:", err);
    }
  });
}

/**
 * Apply a quality scale. The minimum is enforced by scaling LESS, never by
 * clamping one axis: flooring the axes separately would reshape an extreme
 * composition (4000x100 at quarter would land on 1000x64, a different image).
 */
function scaled(size, scale) {
  const shortEdge = Math.min(size.width, size.height);
  const effective = Math.max(scale, MIN_DERIVED / shortEdge);
  return {
    width: Math.max(1, Math.round(size.width * effective)),
    height: Math.max(1, Math.round(size.height * effective)),
  };
}

/**
 * Cap a size to a long edge WITHOUT reshaping it. Clamping the axes separately
 * is the tempting version and it is wrong: a 2560x1080 composition capped per
 * axis becomes 2048x1080, i.e. 1.90:1 instead of 2.37:1, and every surface that
 * frames itself from that texture then disagrees with the composition. The cap
 * is a hard limit, so it wins over the quality minimum above - it just never
 * takes an axis below one pixel.
 * @returns {{width:number, height:number}} scaled down, or unchanged if it fits.
 */
export function fitToLongEdge(size, maxEdge) {
  const longEdge = Math.max(size.width, size.height);
  if (!(maxEdge > 0) || longEdge <= maxEdge) {
    return { width: size.width, height: size.height };
  }
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** The authored composition size. */
export function getOutputFormat() {
  return { ...state.output };
}

/** Aspect ratio of the composition - the one thing every role shares. */
export function getOutputAspect() {
  return state.output.width / state.output.height;
}

/**
 * Pixel dimensions for a role. Every renderer should call this rather than
 * reading a stored size, so the aspect ratio can never fork.
 * @param {"output"|"preview"|"sim"|"export"} role
 */
export function resolveResolution(role = "output") {
  switch (role) {
    case "preview":
      return scaled(state.output, qualityScale(state.previewQuality));
    case "sim":
      // Capped, so the settings window reports the size the sims really get.
      return fitToLongEdge(scaled(state.output, qualityScale(state.simQuality)), MAX_SIM_EDGE);
    case "export":
      return state.exportTarget.mode === "custom"
        ? { width: state.exportTarget.width, height: state.exportTarget.height }
        : { ...state.output };
    case "output":
    default:
      return { ...state.output };
  }
}

/** Set the composition size. Moves every role, since all of them derive from it. */
export function setOutputFormat(width, height, source = "unknown") {
  const next = {
    width: clamp(width, MIN_WIDTH, MAX_WIDTH, state.output.width),
    height: clamp(height, MIN_HEIGHT, MAX_HEIGHT, state.output.height),
  };
  if (next.width === state.output.width && next.height === state.output.height) return false;

  state.output = next;
  writeStorage(OUTPUT_STORAGE_KEY, next);
  emit("output", source);
  return true;
}

export function getPreviewQuality() {
  return state.previewQuality;
}

/** Preview quality is machine-local: it never changes the artwork. */
export function setPreviewQuality(id, source = "unknown") {
  const next = sanitizeQuality(id, state.previewQuality);
  if (next === state.previewQuality) return false;

  state.previewQuality = next;
  persistMachineSettings();
  emit("previewQuality", source);
  return true;
}

export function getSimQuality() {
  return state.simQuality;
}

/**
 * Sim quality is part of the artwork: feedback, fluid and noise sims are
 * resolution-dependent, so a lower setting is a different image, not a softer
 * one. It is saved with the project for that reason.
 */
export function setSimQuality(id, source = "unknown") {
  const next = sanitizeQuality(id, state.simQuality);
  if (next === state.simQuality) return false;

  state.simQuality = next;
  emit("simQuality", source);
  return true;
}

export function getExportTarget() {
  return { ...state.exportTarget };
}

/**
 * Export size. "output" follows the composition; "custom" re-renders the
 * composite at an explicit size (the sims stay at their authored resolution).
 */
export function setExportTarget(target, source = "unknown") {
  const next = target?.mode === "custom"
    ? { mode: "custom", ...sanitizeSize(target, state.output) }
    : { mode: "output", ...state.output };

  const unchanged = next.mode === state.exportTarget.mode
    && next.width === state.exportTarget.width
    && next.height === state.exportTarget.height;
  if (unchanged) return false;

  state.exportTarget = next;
  persistMachineSettings();
  emit("exportTarget", source);
  return true;
}

function persistMachineSettings() {
  writeStorage(MACHINE_STORAGE_KEY, {
    previewQuality: state.previewQuality,
    exportTarget: state.exportTarget,
  });
}

/** Subscribe to every change. Returns an unsubscribe function. */
export function subscribeOutputFormat(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Subscribe to changes that move one role's resolution. */
export function subscribeRole(role, listener) {
  return subscribeOutputFormat((change) => {
    if (change.roles.includes(role)) listener(resolveResolution(role), change);
  });
}

/** Preset id matching a size, or "custom". */
export function matchPreset(size = getOutputFormat()) {
  const preset = OUTPUT_PRESETS.find((p) => p.width === size.width && p.height === size.height);
  return preset ? preset.id : "custom";
}

export function getPreset(id) {
  return OUTPUT_PRESETS.find((p) => p.id === id) || null;
}

/** The part of this state that belongs to the project file. */
export function serializeProjectFormat() {
  return {
    output: getOutputFormat(),
    simQuality: state.simQuality,
  };
}

/**
 * Apply a project's authored format. Missing fields keep the current value, so
 * projects saved before this existed load unchanged.
 */
export function applyProjectFormat(data, source = "project") {
  if (!data) return false;

  let changed = false;
  const size = sanitizeSize(data.output ?? data.resolution, null);
  if (size) changed = setOutputFormat(size.width, size.height, source) || changed;
  if (data.simQuality) changed = setSimQuality(data.simQuality, source) || changed;
  return changed;
}

export function resetOutputFormat(source = "reset") {
  const changed = setOutputFormat(DEFAULT_OUTPUT.width, DEFAULT_OUTPUT.height, source);
  setPreviewQuality("full", source);
  setSimQuality("full", source);
  setExportTarget({ mode: "output" }, source);
  return changed;
}
