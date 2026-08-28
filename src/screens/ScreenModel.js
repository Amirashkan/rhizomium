// src/screens/ScreenModel.js
//
// The document model behind multi-screen output: the ordered list of SCREENS a
// patch is thrown onto, and what each one shows.
//
// One screen is one output window on one display. It carries the display it
// belongs on, the crop of the composition it shows (see screenRegion.js), and
// how many pixels it presents with. That is the whole of it — a screen owns no
// render state, no window handle and no GPU resources, so the screens panel, the
// output bridge, the project file and the tests all read the same object.
//
// This mirrors MappingModel deliberately: plain data plus edit operations plus a
// change subscription. A studio rig is a document — it is set up once against the
// physical room and reopened every show night — so it saves and loads with the
// project rather than being rebuilt from the menu each time.

import { FULL_REGION, isFullRegion, sanitizeRegion, tileRegions } from './screenRegion.js';

/**
 * The screen a plain single-output session uses.
 *
 * Held to a fixed id so that reopening the one-screen case reconnects to the
 * same window label, and so a project saved before multi-screen existed loads
 * into the screen the artist already had.
 */
export const MAIN_SCREEN_ID = 'main';

/**
 * How many screens one machine may drive.
 *
 * Not a licence limit: every screen is a full second render of the composition on
 * the same GPU, and past a handful the shared device is the bottleneck long
 * before the window manager is.
 */
export const MAX_SCREENS = 8;

/** `displayIndex` value meaning "whichever display is not the editor's". */
export const DISPLAY_AUTO = -1;

let _nextScreenId = 1;

/** Reset the screen id counter. Used when loading screens from a project. */
export function resetScreenIdCounter(startFrom = 1) {
  _nextScreenId = startFrom;
}

function clampDisplayMaxDim(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0; // 0 = the display's own resolution
  return Math.max(256, Math.min(7680, n));
}

function clampDisplayIndex(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return DISPLAY_AUTO;
  return Math.min(63, n);
}

/**
 * Build a screen from partial options, filling in every field.
 * @param {object} [opts]
 * @returns {object} a complete screen record
 */
export function makeScreen(opts = {}) {
  const id = (typeof opts.id === 'string' && opts.id) ? opts.id : `screen-${_nextScreenId++}`;
  return {
    id,
    name: typeof opts.name === 'string' && opts.name.trim()
      ? opts.name.trim().slice(0, 64)
      : defaultScreenName(id),
    // A screen that is present but switched off keeps its framing without
    // holding a window open — the rig stays described while a projector is dark.
    enabled: opts.enabled !== false,
    displayIndex: clampDisplayIndex(opts.displayIndex),
    region: sanitizeRegion(opts.region),
    displayMaxDim: clampDisplayMaxDim(opts.displayMaxDim),
  };
}

function defaultScreenName(id) {
  if (id === MAIN_SCREEN_ID) return 'Main output';
  const n = /^screen-(\d+)$/.exec(id);
  return n ? `Screen ${n[1]}` : 'Screen';
}

/**
 * An ordered list of output screens, with edit operations and a change
 * subscription. Every mutation that changes anything notifies once.
 */
export class ScreenModel {
  constructor() {
    /** @type {object[]} */
    this.screens = [];
    this._listeners = new Set();
  }

  /**
   * Subscribe to changes.
   * @param {(model: ScreenModel) => void} fn
   * @returns {() => void} unsubscribe
   */
  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Notify subscribers. Listener errors never stop the others. */
  _emit() {
    for (const fn of [...this._listeners]) {
      try { fn(this); } catch { /* a broken listener is not the model's problem */ }
    }
  }

  /** @returns {object[]} a shallow copy of the screen list, in order */
  list() {
    return this.screens.slice();
  }

  /** @returns {object[]} only the screens that should currently hold a window */
  enabledScreens() {
    return this.screens.filter((s) => s.enabled);
  }

  /** @returns {object|null} the screen with this id */
  get(id) {
    return this.screens.find((s) => s.id === id) || null;
  }

  /** @returns {number} how many screens are described */
  get count() {
    return this.screens.length;
  }

  /**
   * Add a screen.
   * @param {object} [opts] any screen fields to seed it with
   * @returns {object|null} the new screen, or null when the rig is full
   */
  add(opts = {}) {
    if (this.screens.length >= MAX_SCREENS) return null;
    const screen = makeScreen(opts);
    if (this.get(screen.id)) return null; // ids are the window labels: never duplicate
    this.screens.push(screen);
    this._emit();
    return screen;
  }

  /**
   * Ensure the single-output screen exists, so a session that only ever presses
   * the output button has something to open without opening the panel first.
   * @returns {object} the main screen
   */
  ensureMain() {
    const existing = this.get(MAIN_SCREEN_ID);
    if (existing) return existing;
    const screen = makeScreen({ id: MAIN_SCREEN_ID });
    this.screens.unshift(screen);
    this._emit();
    return screen;
  }

  /** Remove a screen. @returns {boolean} whether one was removed */
  remove(id) {
    const i = this.screens.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this.screens.splice(i, 1);
    this._emit();
    return true;
  }

  /** Remove every screen. */
  clear() {
    if (!this.screens.length) return;
    this.screens = [];
    this._emit();
  }

  /**
   * Patch a screen's fields. Only the fields present are touched, and a patch
   * that changes nothing does not notify — a slider dragged back to where it
   * started must not restart every output window.
   * @param {string} id
   * @param {object} patch  any of name, enabled, displayIndex, region, displayMaxDim
   * @returns {object|null} the updated screen
   */
  update(id, patch = {}) {
    const screen = this.get(id);
    if (!screen) return null;
    const next = { ...screen };
    if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim().slice(0, 64);
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (patch.displayIndex !== undefined) next.displayIndex = clampDisplayIndex(patch.displayIndex);
    if (patch.displayMaxDim !== undefined) next.displayMaxDim = clampDisplayMaxDim(patch.displayMaxDim);
    if (patch.region !== undefined) next.region = sanitizeRegion(patch.region);

    if (JSON.stringify(next) === JSON.stringify(screen)) return screen;
    Object.assign(screen, next);
    this._emit();
    return screen;
  }

  /**
   * Replace the rig with a tiled layout: `cols * rows` screens, each framed on
   * its own tile of the composition, in reading order.
   *
   * This is the whole setup for the common studio cases — a mirror wall, a
   * three-projector panorama, a 2x2 video wall — in one action, with the screens
   * left named after their place in the grid so the rig reads at a glance.
   *
   * Existing screens are reused in order where possible, so re-tiling a rig that
   * is already open keeps its windows and display assignments rather than
   * closing and reopening every projector.
   *
   * @param {object} opts
   * @param {number} [opts.cols=1]
   * @param {number} [opts.rows=1]
   * @param {number} [opts.overlap=0] neighbour overlap for edge blending, 0..0.5
   * @returns {object[]} the resulting screens
   */
  applyTiling({ cols = 1, rows = 1, overlap = 0 } = {}) {
    const regions = tileRegions({ cols, rows, overlap }).slice(0, MAX_SCREENS);
    const previous = this.screens;
    const single = regions.length === 1;

    this.screens = regions.map((region, i) => {
      const reused = previous[i];
      const id = reused ? reused.id : (i === 0 ? MAIN_SCREEN_ID : undefined);
      return makeScreen({
        id,
        name: single ? 'Main output' : tileName(i, cols, rows),
        enabled: reused ? reused.enabled : true,
        displayIndex: reused ? reused.displayIndex : DISPLAY_AUTO,
        displayMaxDim: reused ? reused.displayMaxDim : 0,
        region,
      });
    });
    this._emit();
    return this.list();
  }

  /**
   * Point every screen at the whole composition.
   *
   * The other common wall: the same image on several projectors, rather than one
   * image split between them. Unlike a tiling this keeps the rig exactly as it
   * is — the screens, their displays, their resolutions — and only clears the
   * framing, so switching a panorama to a mirror and back does not close a
   * single window.
   *
   * @returns {object[]} the resulting screens
   */
  mirrorAll() {
    let changed = false;
    for (const screen of this.screens) {
      if (isFullRegion(screen.region)) continue;
      screen.region = { ...FULL_REGION };
      changed = true;
    }
    if (changed) this._emit();
    return this.list();
  }

  /**
   * @returns {{screens: object[]}} plain data for the project file
   *
   * `enabled` is deliberately not written. Whether a projector is live right now
   * is the state of a performance, not a property of the artwork: the rig — the
   * displays, the framing, the resolutions — is what the file is for.
   */
  serialize() {
    return {
      screens: this.screens.map((s) => ({
        id: s.id,
        name: s.name,
        displayIndex: s.displayIndex,
        displayMaxDim: s.displayMaxDim,
        region: { ...s.region },
      })),
    };
  }

  /**
   * Load from serialized data, replacing what is there. Unusable entries are
   * dropped rather than loaded broken: a project with a corrupt screen opens
   * with fewer screens, never with a window showing nothing.
   *
   * Every loaded screen starts switched OFF. Opening a file must never throw
   * windows onto whatever displays happen to be attached — someone opening a
   * patch on a laptop to look at it is not asking to go live. The rig is loaded
   * ready; the output button turns it on.
   *
   * @param {{screens?: object[]}|object[]|null} data
   */
  deserialize(data) {
    const raw = Array.isArray(data) ? data : (data && Array.isArray(data.screens) ? data.screens : []);
    const seen = new Set();
    const screens = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      if (screens.length >= MAX_SCREENS) break;
      const screen = makeScreen({ ...entry, enabled: false });
      if (seen.has(screen.id)) continue;
      seen.add(screen.id);
      screens.push(screen);
    }
    // Keep the counter ahead of every generated id in the loaded rig, so the
    // next added screen cannot collide with one that just came out of a file.
    let highest = 0;
    for (const s of screens) {
      const n = /^screen-(\d+)$/.exec(s.id);
      if (n) highest = Math.max(highest, parseInt(n[1], 10));
    }
    resetScreenIdCounter(highest + 1);
    this.screens = screens;
    this._emit();
  }
}

/** Name a tile by its place in the grid: "Left", "Centre 2", "Top left"… */
function tileName(i, cols, rows) {
  const c = Math.max(1, Math.round(cols));
  const r = Math.max(1, Math.round(rows));
  const col = i % c;
  const row = Math.floor(i / c);
  const across = c === 1 ? '' : (c === 2 ? ['Left', 'Right'][col]
    : (c === 3 ? ['Left', 'Centre', 'Right'][col] : `Column ${col + 1}`));
  const down = r === 1 ? '' : (r === 2 ? ['Top', 'Bottom'][row] : `Row ${row + 1}`);
  if (across && down) return `${down} ${across.toLowerCase()}`;
  return across || down || `Screen ${i + 1}`;
}

export { FULL_REGION };
