// src/accessibility/a11ySettings.js
//
// The editor's accessibility settings: one small store that the chrome, the canvas renderer, the
// preview, the screen-reader layer and the playback gate all read from.
//
// Kept apart from PreferencesWindow's own `rhizo.preferences` record on purpose. Those are editing
// conveniences (grid, snapping, autosave) read in one place; these are read by half a dozen
// subsystems that each need to hear when one changes, so they live behind a subscribe() rather
// than being pushed out key by key from a window's change handler.
//
// Two values can say "follow the system": contrast and motion. Those resolve against the
// operating system's own preferences (prefers-contrast, prefers-reduced-motion) every time they are
// read, and the store re-notifies its listeners when the system preference flips, so an artist who
// turns on Windows' contrast theme mid-session does not have to come in here as well.
//
// `motionWarnings` has no stored default at all: until the artist ticks or unticks it, it follows
// prefers-reduced-motion. Someone who has told their OS that motion makes them ill is exactly who
// the warning exists for, and they should not have to find a checkbox before the first patch that
// strobes at them.

const STORAGE_KEY = "rhizo.accessibility";

export const CONTRAST_LEVELS = ["system", "standard", "high", "maximum"];
export const FOCUS_STYLES = ["standard", "bold"];
export const MOTION_PREFERENCES = ["system", "reduce", "full"];
export const ANNOUNCEMENT_LEVELS = ["off", "normal", "verbose"];
export const OUTLINE_ORDERS = ["flow", "position"];
export const COLOR_VISION_MODES = ["simulate", "correct"];
export const COLOR_VISION_PROFILES = [
  "none",
  "protanopia",
  "deuteranopia",
  "tritanopia",
  "achromatopsia",
  "protanomaly",
  "deuteranomaly",
  "tritanomaly",
];

/** Interface sizes offered in the settings, as zoom factors for the editor chrome. */
export const UI_SCALE_STEPS = [1, 1.25, 1.5, 1.75, 2];
export const UI_SCALE_MIN = 1;
export const UI_SCALE_MAX = 2;

/**
 * Every setting, its legal values and its default. A value read back from storage that does not
 * fit is dropped rather than trusted — storage is editable from devtools and survives app updates
 * that may have renamed an option.
 */
export const A11Y_SCHEMA = Object.freeze({
  contrast: { type: "enum", values: CONTRAST_LEVELS, default: "system" },
  uiScale: { type: "number", min: UI_SCALE_MIN, max: UI_SCALE_MAX, default: 1 },
  focusRing: { type: "enum", values: FOCUS_STYLES, default: "standard" },
  reduceMotion: { type: "enum", values: MOTION_PREFERENCES, default: "system" },
  // null = "not chosen yet": follows prefers-reduced-motion (see the header).
  motionWarnings: { type: "boolean", default: null },
  colorVision: { type: "enum", values: COLOR_VISION_PROFILES, default: "none" },
  colorVisionMode: { type: "enum", values: COLOR_VISION_MODES, default: "simulate" },
  announcements: { type: "enum", values: ANNOUNCEMENT_LEVELS, default: "normal" },
  outlineOrder: { type: "enum", values: OUTLINE_ORDERS, default: "flow" },
});

/**
 * Coerce `value` to what `key` accepts, or `undefined` when it cannot be. Numbers are clamped
 * and snapped to a 0.05 step so a stored 1.2499999 reads as 1.25.
 */
export function normalizeA11yValue(key, value) {
  const spec = A11Y_SCHEMA[key];
  if (!spec) return undefined;

  switch (spec.type) {
    case "enum":
      return spec.values.includes(value) ? value : undefined;
    case "boolean":
      if (value === null) return null;
      return typeof value === "boolean" ? value : undefined;
    case "number": {
      const n = typeof value === "string" ? parseFloat(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
      const clamped = Math.min(spec.max, Math.max(spec.min, n));
      return Math.round(clamped * 20) / 20;
    }
    default:
      return undefined;
  }
}

function defaultMatchMedia(query) {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia(query);
    }
  } catch {
    // No media queries here (tests, workers) — every system preference reads as "no".
  }
  return null;
}

function defaultStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage || null : null;
  } catch {
    return null; // Storage blocked: settings still apply, they just do not persist.
  }
}

const SYSTEM_QUERIES = {
  // Windows' high-contrast themes force the page's colours, but not what a canvas draws — so the
  // drawn graph has to be told, and it goes to the strongest level to sit with a forced palette.
  forcedColors: "(forced-colors: active)",
  contrast: "(prefers-contrast: more)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
};

export class A11ySettings {
  /**
   * @param {object} [options]
   * @param {Storage|null} [options.storage]  where settings persist (localStorage by default)
   * @param {(query: string) => MediaQueryList|null} [options.matchMedia]
   */
  constructor({ storage = defaultStorage(), matchMedia = defaultMatchMedia } = {}) {
    this._storage = storage;
    this._matchMedia = matchMedia;
    this._listeners = new Set();
    this._values = this._readStored();
    this._systemWatchers = [];
  }

  // ---- reading -----------------------------------------------------------

  /** The effective value of one setting (motionWarnings resolved against the system). */
  get(key) {
    if (key === "motionWarnings") return this.motionWarningsEnabled();
    if (key in this._values) return this._values[key];
    return A11Y_SCHEMA[key]?.default;
  }

  /** Every setting's effective value. */
  all() {
    const out = {};
    for (const key of Object.keys(A11Y_SCHEMA)) out[key] = this.get(key);
    return out;
  }

  /** Whether the artist has chosen this value themselves (as opposed to the default). */
  isExplicit(key) {
    return key in this._values;
  }

  /** "standard" | "high" | "maximum" — the contrast actually in force. */
  effectiveContrast() {
    const chosen = this.get("contrast");
    if (chosen !== "system") return chosen;
    if (this._systemMatches(SYSTEM_QUERIES.forcedColors)) return "maximum";
    return this._systemMatches(SYSTEM_QUERIES.contrast) ? "high" : "standard";
  }

  /** Whether UI animation should be cut back. */
  prefersReducedMotion() {
    const chosen = this.get("reduceMotion");
    if (chosen === "reduce") return true;
    if (chosen === "full") return false;
    return this._systemMatches(SYSTEM_QUERIES.reducedMotion);
  }

  /** Whether patches are checked for flashing and fast motion before they play. */
  motionWarningsEnabled() {
    const stored = this._values.motionWarnings;
    if (typeof stored === "boolean") return stored;
    return this._systemMatches(SYSTEM_QUERIES.reducedMotion);
  }

  // ---- writing -----------------------------------------------------------

  /**
   * Set one setting. Returns false (and changes nothing) for an unknown key or a value the key
   * does not accept, so a stray caller cannot write garbage that every reader then has to defend
   * against.
   */
  set(key, value) {
    const normalized = normalizeA11yValue(key, value);
    if (normalized === undefined) return false;

    const before = this.get(key);
    if (normalized === null) {
      delete this._values[key];
    } else {
      this._values[key] = normalized;
    }
    this._persist();

    if (this.get(key) !== before || key === "motionWarnings") {
      this._emit({ key, value: this.get(key) });
    }
    return true;
  }

  /** Set several at once with a single notification per changed key. */
  setMany(values = {}) {
    let changed = false;
    for (const [key, value] of Object.entries(values)) {
      changed = this.set(key, value) || changed;
    }
    return changed;
  }

  /** Back to the defaults (and to following the system where that is the default). */
  reset() {
    this._values = {};
    this._persist();
    this._emit({ key: "*", value: null });
  }

  // ---- listening ---------------------------------------------------------

  /**
   * Hear every change. `listener({ key, value })` — key is "*" after a reset and "system" when an
   * operating-system preference changed underneath a setting that follows it.
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Re-notify listeners whenever the OS contrast, forced-colours or motion preference changes.
   * Idempotent; the returned function stops watching.
   */
  watchSystemPreferences() {
    if (this._systemWatchers.length) return () => this.unwatchSystemPreferences();
    for (const query of Object.values(SYSTEM_QUERIES)) {
      const list = this._matchMedia?.(query);
      if (!list || typeof list.addEventListener !== "function") continue;
      const onChange = () => this._emit({ key: "system", value: query });
      list.addEventListener("change", onChange);
      this._systemWatchers.push(() => list.removeEventListener("change", onChange));
    }
    return () => this.unwatchSystemPreferences();
  }

  unwatchSystemPreferences() {
    for (const stop of this._systemWatchers) stop();
    this._systemWatchers = [];
  }

  // ---- internals ---------------------------------------------------------

  _systemMatches(query) {
    try {
      return !!this._matchMedia?.(query)?.matches;
    } catch {
      return false;
    }
  }

  _readStored() {
    const values = {};
    try {
      const raw = this._storage?.getItem?.(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object") {
        for (const [key, value] of Object.entries(parsed)) {
          const normalized = normalizeA11yValue(key, value);
          if (normalized !== undefined && normalized !== null) values[key] = normalized;
        }
      }
    } catch {
      // Unreadable record: start from the defaults rather than refuse to boot.
    }
    return values;
  }

  _persist() {
    try {
      if (Object.keys(this._values).length === 0) {
        this._storage?.removeItem?.(STORAGE_KEY);
      } else {
        this._storage?.setItem?.(STORAGE_KEY, JSON.stringify(this._values));
      }
    } catch {
      // Storage full or blocked — the setting still applies for this session.
    }
  }

  _emit(change) {
    for (const listener of [...this._listeners]) {
      try {
        listener(change);
      } catch (error) {
        console.warn("[a11ySettings] listener failed:", error);
      }
    }
  }
}

let sharedSettings = null;

/** The editor-wide settings store. */
export function getA11ySettings() {
  if (!sharedSettings) sharedSettings = new A11ySettings();
  return sharedSettings;
}

/** Tests only: swap the shared store (pass null to drop it). */
export function setA11ySettingsForTesting(store) {
  sharedSettings = store;
}

/**
 * Write the settings the stylesheet keys off onto the document root:
 *
 *   data-rz-contrast   standard | high | maximum
 *   data-rz-motion     full | reduced
 *   data-rz-focus      standard | bold
 *   data-rz-scaled     present when the interface size is above 100%
 *   --rz-ui-scale      the interface size as a zoom factor
 *
 * src/styles/accessibility.css does the rest; nothing here touches an individual panel.
 */
export function applyA11yToDocument(store = getA11ySettings(), doc = document) {
  const root = doc?.documentElement;
  if (!root) return;

  root.dataset.rzContrast = store.effectiveContrast();
  root.dataset.rzMotion = store.prefersReducedMotion() ? "reduced" : "full";
  root.dataset.rzFocus = store.get("focusRing");

  const scale = store.get("uiScale");
  root.style.setProperty("--rz-ui-scale", String(scale));
  if (scale > 1) {
    root.dataset.rzScaled = "true";
  } else {
    delete root.dataset.rzScaled;
  }
}

/**
 * Apply the settings to the page now and every time they change. Safe to call before the editor
 * exists — it only touches the document root — so main.js calls it first thing, before anything
 * has painted in the wrong contrast.
 *
 * @returns {() => void} stops following the store
 */
export function installA11yDocumentSync(store = getA11ySettings(), doc = document) {
  applyA11yToDocument(store, doc);
  const stopWatching = store.watchSystemPreferences();
  const unsubscribe = store.subscribe(() => applyA11yToDocument(store, doc));
  return () => {
    unsubscribe();
    stopWatching();
  };
}
