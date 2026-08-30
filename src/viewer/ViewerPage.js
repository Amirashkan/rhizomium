// src/viewer/ViewerPage.js
//
// THE VIEWER PAGE: everything about the page a link leads to that is not the
// patch itself.
//
// The web viewer used to be one fixed page — black ground, letterboxed render,
// notes underneath, controls that fade. Those were reasonable defaults and they
// stay the defaults, but they were also decisions made once, for everyone. An
// artist showing a piece has opinions about the room it hangs in: the wall
// behind it, whether it is framed or fills the wall, whether the apparatus is
// visible at all.
//
//   viewerPage: { title, background, fit, showNotes, controls }
//
// Two rules.
//
// **Defaults serialize to nothing.** A patch whose page settings are all
// default writes no `viewerPage` at all, so every patch published before this
// existed keeps behaving identically and the diff of a `.rz` stays about the
// artwork.
//
// **It travels in the document, not the URL.** A link is a thing people paste
// into chat clients that mangle query strings, and the same patch is shown by
// the gallery without any link of ours around it. The one exception is `?title=`,
// which predates this and stays a URL override so a handoff can be labelled
// without editing the patch.

/** How the render is fitted to the window. */
export const VIEWER_FITS = ['contain', 'cover'];

/** How the controls panel behaves when the patch offers any. */
export const CONTROLS_MODES = ['auto', 'pinned', 'hidden'];

/** What the page looks like when the artist has said nothing about it. */
export const DEFAULT_VIEWER_PAGE = Object.freeze({
  title: '',
  background: '#08080a',
  fit: 'contain',
  showNotes: true,
  controls: 'auto',
});

/** Longest title accepted. Past this it is a description, not a name. */
export const MAX_PAGE_TITLE_LENGTH = 80;

function cleanTitle(raw) {
  if (typeof raw !== 'string') return '';
  let stripped = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    stripped += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return stripped.replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_TITLE_LENGTH).trim();
}

/**
 * Normalize a colour to `#rrggbb`, or null when it is not one.
 *
 * Deliberately only hex. The value is written into the page's `background`, and
 * a document that could put arbitrary CSS there is a document that can put a
 * `url()` in it — a beacon to whatever host the patch's author chose, which is
 * exactly what patchSource.js and patchTextures.js refuse one level up.
 */
export function normalizeColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return null;
}

/**
 * Build a complete page record, filling in and sanitizing every field.
 *
 * @param {object} [opts]
 * @returns {{title: string, background: string, fit: string,
 *            showNotes: boolean, controls: string}}
 */
export function makeViewerPage(opts = {}) {
  return {
    title: cleanTitle(opts?.title),
    background: normalizeColor(opts?.background) || DEFAULT_VIEWER_PAGE.background,
    fit: VIEWER_FITS.includes(opts?.fit) ? opts.fit : DEFAULT_VIEWER_PAGE.fit,
    showNotes: opts?.showNotes === undefined ? DEFAULT_VIEWER_PAGE.showNotes : !!opts.showNotes,
    controls: CONTROLS_MODES.includes(opts?.controls)
      ? opts.controls
      : DEFAULT_VIEWER_PAGE.controls,
  };
}

/**
 * Sanitize ONE field, or return undefined when the value is not usable.
 *
 * The difference from makeViewerPage matters: that fills a missing field with
 * the default, which is right when building a whole page from a document, and
 * wrong when patching one. An edit carrying a value this does not recognise
 * should leave the setting where it was — resetting `fit` to "contain" because
 * something handed it "stretch" would be a silent change nobody asked for.
 */
export function sanitizeField(key, value) {
  switch (key) {
    case 'title':
      return typeof value === 'string' ? cleanTitle(value) : undefined;
    case 'background':
      return normalizeColor(value) || undefined;
    case 'fit':
      return VIEWER_FITS.includes(value) ? value : undefined;
    case 'controls':
      return CONTROLS_MODES.includes(value) ? value : undefined;
    case 'showNotes':
      return typeof value === 'boolean' ? value : undefined;
    default:
      return undefined;
  }
}

/** Is this page exactly the one an artist who said nothing would get? */
export function isDefaultPage(page) {
  const full = makeViewerPage(page);
  return Object.keys(DEFAULT_VIEWER_PAGE).every((key) => full[key] === DEFAULT_VIEWER_PAGE[key]);
}

/**
 * Read whatever a patch carries and say what the page should look like.
 *
 * The one place the viewer calls, so a patch with no `viewerPage`, a patch with
 * half of one, and a hand-edited patch with nonsense in it all land on the same
 * complete record.
 */
export function resolveViewerPage(raw) {
  return makeViewerPage(raw && typeof raw === 'object' ? raw : {});
}

/**
 * The page settings, with edit operations and a change subscription — the same
 * shape as ScreenModel and ViewerControlsModel, so the tool window, the project
 * file and the tests all read one object.
 */
export class ViewerPageModel {
  constructor(initial = {}) {
    this.page = makeViewerPage(initial);
    this._listeners = new Set();
  }

  /**
   * @param {(model: ViewerPageModel) => void} fn
   * @returns {() => void} unsubscribe
   */
  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of [...this._listeners]) {
      try {
        fn(this);
      } catch {
        /* a broken listener is not the model's problem */
      }
    }
  }

  /** @returns {object} a copy of the settings */
  get() {
    return { ...this.page };
  }

  /** @returns {boolean} whether this page is the untouched default */
  get isDefault() {
    return isDefaultPage(this.page);
  }

  /**
   * Change some of the settings. A patch that changes nothing does not notify —
   * a colour dragged back to where it started must not redraw the tool.
   *
   * @param {object} patch any of title, background, fit, showNotes, controls
   * @returns {object} the settings as they now stand
   */
  update(patch = {}) {
    const next = { ...this.page };
    for (const [key, value] of Object.entries(patch || {})) {
      const clean = sanitizeField(key, value);
      if (clean !== undefined) next[key] = clean;
    }

    if (JSON.stringify(next) === JSON.stringify(this.page)) return this.get();
    this.page = next;
    this._emit();
    return this.get();
  }

  /** Back to the page an artist who said nothing would get. */
  reset() {
    return this.update({ ...DEFAULT_VIEWER_PAGE });
  }

  /** @returns {object|null} plain data for the project file, null when default */
  serialize() {
    return this.isDefault ? null : { ...this.page };
  }

  /** Load from serialized data, replacing what is there. */
  deserialize(data) {
    this.page = resolveViewerPage(data);
    this._emit();
  }
}
