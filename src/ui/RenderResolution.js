/**
 * RenderResolution.js - The single source of truth for the render resolution.
 *
 * Everything that rasterises the graph reads from here: the floating preview,
 * PNG export, animation export and gallery publishing. There is exactly one
 * editor for this value (Preview / Export Settings); every other surface either
 * displays it or follows it.
 */

export const MIN_WIDTH = 128;
export const MAX_WIDTH = 7680;
export const MIN_HEIGHT = 128;
export const MAX_HEIGHT = 4320;

export const DEFAULT_RESOLUTION = { width: 512, height: 512 };

export const RESOLUTION_PRESETS = [
  { id: "512", label: "512 × 512 (square)", width: 512, height: 512 },
  { id: "1024", label: "1024 × 1024 (square)", width: 1024, height: 1024 },
  { id: "2048", label: "2048 × 2048 (square)", width: 2048, height: 2048 },
  { id: "720p", label: "720p (1280 × 720)", width: 1280, height: 720 },
  { id: "1080p", label: "1080p (1920 × 1080)", width: 1920, height: 1080 },
  { id: "1440p", label: "1440p (2560 × 1440)", width: 2560, height: 1440 },
  { id: "4K", label: "4K (3840 × 2160)", width: 3840, height: 2160 },
];

const STORAGE_KEY = "rhizo.renderResolution";

const listeners = new Set();
const current = { ...DEFAULT_RESOLUTION };

function clamp(value, min, max, fallback) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function readStored() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      width: clamp(parsed?.width, MIN_WIDTH, MAX_WIDTH, DEFAULT_RESOLUTION.width),
      height: clamp(parsed?.height, MIN_HEIGHT, MAX_HEIGHT, DEFAULT_RESOLUTION.height),
    };
  } catch {
    return null;
  }
}

function writeStored(resolution) {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(resolution));
  } catch {
    // Storage unavailable (private mode, tests) - the in-memory value still applies.
  }
}

const stored = readStored();
if (stored) {
  current.width = stored.width;
  current.height = stored.height;
}

/** Current render resolution. Always a fresh object, never the internal state. */
export function getRenderResolution() {
  return { width: current.width, height: current.height };
}

/**
 * Set the render resolution. Values are clamped to the supported range and the
 * change is broadcast to every listener (preview, settings UI, exporters).
 * @returns {boolean} true when the value actually changed.
 */
export function setRenderResolution(width, height, source = "unknown") {
  const next = {
    width: clamp(width, MIN_WIDTH, MAX_WIDTH, current.width),
    height: clamp(height, MIN_HEIGHT, MAX_HEIGHT, current.height),
  };

  if (next.width === current.width && next.height === current.height) {
    return false;
  }

  current.width = next.width;
  current.height = next.height;
  writeStored(next);

  listeners.forEach((listener) => {
    try {
      listener(getRenderResolution(), source);
    } catch (err) {
      console.warn("[RenderResolution] listener failed:", err);
    }
  });

  return true;
}

/** Subscribe to resolution changes. Returns an unsubscribe function. */
export function subscribeRenderResolution(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Preset id matching the given resolution, or "custom". */
export function matchPreset(resolution = getRenderResolution()) {
  const preset = RESOLUTION_PRESETS.find(
    (p) => p.width === resolution.width && p.height === resolution.height,
  );
  return preset ? preset.id : "custom";
}

/** Preset definition by id, or null for "custom"/unknown ids. */
export function getPreset(id) {
  return RESOLUTION_PRESETS.find((p) => p.id === id) || null;
}

export function resetRenderResolution(source = "reset") {
  return setRenderResolution(DEFAULT_RESOLUTION.width, DEFAULT_RESOLUTION.height, source);
}
