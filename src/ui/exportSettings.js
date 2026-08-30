/**
 * exportSettings.js - What a local export is, apart from how big it is.
 *
 * The export SIZE already has an owner: the export role in OutputFormat.js,
 * derived from the composition so the aspect ratio can never fork. Everything
 * else an export needs - still or video, how long, how many frames a second,
 * how many bits to spend on them, whether the loaded music rides along, what
 * the file ends up called - lives here.
 *
 * These are machine settings, not artwork: two artists opening the same project
 * should be able to want different things out of it, and a 4K sixty-second
 * render is a property of the machine asked to make it. So they persist to
 * localStorage and never travel in the project file.
 *
 * The estimate helpers are deliberately pure. The export panel shows the size
 * of a file before the artist spends two minutes recording it, and the only way
 * that number can be trusted is if the exporter derives its bitrate from the
 * same function that drew it.
 */

export const MIN_FPS = 1;
export const MAX_FPS = 120;
export const MIN_DURATION = 1;
export const MAX_DURATION = 300;

/** Frame rates worth one click. Anything else is typed into the box. */
export const FPS_PRESETS = [24, 25, 30, 50, 60];

/**
 * Quality is a multiplier on the resolution-derived baseline below, not an
 * absolute bitrate: "High" has to mean the same visible thing at 720p and at
 * 4K, and an absolute number cannot.
 */
export const VIDEO_QUALITY_STEPS = [
  { id: "draft", label: "Draft (smallest file)", factor: 0.45 },
  { id: "standard", label: "Standard", factor: 1 },
  { id: "high", label: "High", factor: 2 },
  { id: "max", label: "Maximum (largest file)", factor: 3.5 },
];

/**
 * Bitrate bounds for a local export. The ceiling is far above the one publish
 * uses, on purpose: an upload has a server to answer to, a file on disk does
 * not, and silently halving an artist's Maximum render to hit an upload limit
 * they are not subject to is the kind of help nobody asked for.
 */
export const MIN_BITRATE = 1_000_000;
export const MAX_BITRATE = 150_000_000;

export const EXPORT_FORMATS = ["png", "video"];

export const DEFAULT_EXPORT_SETTINGS = {
  format: "video",
  fps: 60,
  duration: 5,
  quality: "standard",
  includeAudio: true,
  filenamePrefix: "shader",
};

const STORAGE_KEY = "rhizo.exportSettings";

const listeners = new Set();

const state = { ...DEFAULT_EXPORT_SETTINGS };

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

/**
 * Reduce whatever arrived to a usable settings object. Every field falls back
 * to the current value rather than the default, so a partial patch - which is
 * what every control in the panel sends - only moves what it names.
 */
function sanitize(patch, base = state) {
  const next = { ...base };
  if (patch == null) return next;

  if (EXPORT_FORMATS.includes(patch.format)) next.format = patch.format;

  if (patch.fps !== undefined) {
    next.fps = Math.round(clampNumber(patch.fps, MIN_FPS, MAX_FPS, base.fps));
  }
  if (patch.duration !== undefined) {
    // Kept to a tenth of a second: finer than that is noise at these lengths,
    // and it keeps the filename and the estimate from growing a decimal tail.
    const duration = clampNumber(patch.duration, MIN_DURATION, MAX_DURATION, base.duration);
    next.duration = Math.round(duration * 10) / 10;
  }
  if (patch.quality !== undefined && VIDEO_QUALITY_STEPS.some((q) => q.id === patch.quality)) {
    next.quality = patch.quality;
  }
  if (patch.includeAudio !== undefined) next.includeAudio = !!patch.includeAudio;
  if (patch.filenamePrefix !== undefined) {
    next.filenamePrefix = sanitizeFilenamePrefix(patch.filenamePrefix, base.filenamePrefix);
  }

  return next;
}

/**
 * Make a prefix safe to hand to a download. Path separators and the characters
 * Windows refuses become dashes rather than disappearing, so a name stays
 * recognisable to whoever typed it; an empty result falls back rather than
 * producing a file called ".mp4".
 */
export function sanitizeFilenamePrefix(value, fallback = DEFAULT_EXPORT_SETTINGS.filenamePrefix) {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[-.\s]+|[-.\s]+$/g, "")
    .slice(0, 64);
  return cleaned || fallback;
}

function readStorage() {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage() {
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, tests) - the settings still apply
    // for this session, they just do not outlive it.
  }
}

const stored = readStorage();
if (stored) Object.assign(state, sanitize(stored, DEFAULT_EXPORT_SETTINGS));

export function getExportSettings() {
  return { ...state };
}

/**
 * Apply a partial change. Returns true when something actually moved, so the
 * panel's own controls do not fight the listener that syncs them.
 */
export function setExportSettings(patch, source = "unknown") {
  const next = sanitize(patch);
  const changed = Object.keys(next).some((key) => next[key] !== state[key]);
  if (!changed) return false;

  Object.assign(state, next);
  writeStorage();

  listeners.forEach((listener) => {
    try {
      listener(getExportSettings(), source);
    } catch (err) {
      console.warn("[exportSettings] listener failed:", err);
    }
  });
  return true;
}

export function resetExportSettings(source = "reset") {
  return setExportSettings({ ...DEFAULT_EXPORT_SETTINGS }, source);
}

/** Subscribe to every change. Returns an unsubscribe function. */
export function subscribeExportSettings(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getQualityStep(id) {
  return VIDEO_QUALITY_STEPS.find((q) => q.id === id) || VIDEO_QUALITY_STEPS[1];
}

/**
 * Bits per second a frame of this size deserves at Standard quality.
 *
 * Bits per pixel falls as the frame grows: a 4K frame is not four times as much
 * NEW information as a 1080p one, it is the same image described more finely,
 * and paying per-pixel at the small-frame rate produces enormous files that
 * look no better. Frame rate is paid for on a square root for the same reason -
 * consecutive frames at 60fps differ less than at 30.
 */
export function baseVideoBitrate({ width, height, fps }) {
  const pixels = Math.max(1, Math.round(width || 0) * Math.round(height || 0));
  const megapixels = pixels / 1_000_000;

  let bitsPerPixel;
  if (megapixels <= 1) {
    bitsPerPixel = 1.5;
  } else if (megapixels <= 2.5) {
    bitsPerPixel = 1.2;
  } else if (megapixels <= 8) {
    bitsPerPixel = 1.0;
  } else {
    bitsPerPixel = 0.8;
  }

  const fpsMultiplier = Math.max(1, Math.sqrt(clampNumber(fps, MIN_FPS, MAX_FPS, 60) / 30));
  return Math.floor(pixels * bitsPerPixel * fpsMultiplier);
}

/**
 * The bitrate an export will actually be recorded at.
 *
 * `maxSizeMB` is the caller's budget, not this module's opinion: publish has an
 * upload limit to respect, a download does not. When one is given the video
 * bitrate is scaled to fit it, and the audio track is charged against the same
 * budget because it rides in the same file.
 */
export function resolveVideoBitrate({
  width,
  height,
  fps,
  quality = "standard",
  duration = 0,
  audioBitrate = 0,
  maxSizeMB = 0,
} = {}) {
  const wanted = Math.floor(baseVideoBitrate({ width, height, fps }) * getQualityStep(quality).factor);

  let bitrate = wanted;
  if (maxSizeMB > 0 && duration > 0) {
    const estimatedMB = estimateFileSizeMB({ videoBitrate: wanted, audioBitrate, duration });
    if (estimatedMB > maxSizeMB) {
      // 0.95 leaves room for container overhead, which the bitrate does not
      // describe and which is what pushes a "just under" file over the line.
      bitrate = Math.floor(wanted * (maxSizeMB / estimatedMB) * 0.95);
    }
  }

  return Math.max(MIN_BITRATE, Math.min(MAX_BITRATE, bitrate));
}

/** Megabytes a recording of this shape comes out at, container overhead aside. */
export function estimateFileSizeMB({ videoBitrate = 0, audioBitrate = 0, duration = 0 } = {}) {
  const bits = (videoBitrate + audioBitrate) * Math.max(0, duration);
  return bits / (8 * 1024 * 1024);
}

/** A size in bytes as something to read: "842 KB", "12.4 MB". */
export function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * The name the file lands under: prefix, what it is, and when.
 *
 * The timestamp is not decoration - an artist exporting the same patch six
 * times while tuning it needs six files, and a browser download that collides
 * either overwrites or grows a "(3)" nobody can read. Sortable, so the last
 * render is the last line.
 */
export function buildExportFilename({
  prefix = DEFAULT_EXPORT_SETTINGS.filenamePrefix,
  width,
  height,
  fps = 0,
  extension = "png",
  date = new Date(),
} = {}) {
  const safePrefix = sanitizeFilenamePrefix(prefix);
  const parts = [safePrefix];

  if (width > 0 && height > 0) parts.push(`${Math.round(width)}x${Math.round(height)}`);
  if (fps > 0) parts.push(`${Math.round(fps)}fps`);

  const stamp = (date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date())
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, -5);
  parts.push(stamp);

  return `${parts.join("-")}.${extension}`;
}

/**
 * Everything the panel needs to describe an export before it happens: the
 * bitrate it will use, the size it should come out at, and a one-line summary.
 */
export function describeExport({
  format = state.format,
  width,
  height,
  fps = state.fps,
  duration = state.duration,
  quality = state.quality,
  audioBitrate = 0,
  containerLabel = "",
} = {}) {
  const resolution = `${Math.round(width || 0)} × ${Math.round(height || 0)}`;

  if (format === "png") {
    return {
      resolution,
      videoBitrate: 0,
      estimatedBytes: 0,
      // A PNG of a shader frame is entirely dependent on what the shader drew -
      // a flat gradient and a noise field at the same size differ by an order
      // of magnitude - so promising a number here would be inventing one.
      summary: `${resolution} PNG · single frame`,
    };
  }

  const videoBitrate = resolveVideoBitrate({ width, height, fps, quality, duration, audioBitrate });
  const estimatedBytes = estimateFileSizeMB({ videoBitrate, audioBitrate, duration }) * 1024 * 1024;

  const summaryParts = [
    resolution,
    `${formatDuration(duration)} · ${Math.round(fps)} fps`,
    `~${formatFileSize(estimatedBytes)}`,
  ];
  if (containerLabel) summaryParts.push(containerLabel);
  if (audioBitrate > 0) summaryParts.push("with audio");

  return {
    resolution,
    videoBitrate,
    estimatedBytes,
    summary: summaryParts.join(" · "),
  };
}

/** "8s", "1:04" - seconds up to a minute, then minutes and seconds. */
export function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  if (total < 60) {
    return Number.isInteger(total) ? `${total}s` : `${total.toFixed(1)}s`;
  }
  const minutes = Math.floor(total / 60);
  const rest = Math.round(total - minutes * 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
