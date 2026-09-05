/**
 * panelGeometry.js — where a floating window was before anyone moved it.
 *
 * Window → Reset Layout has to put every panel back, and "back" is not one
 * thing in this app: some windows are placed by a stylesheet (the timeline,
 * the VJ panel), and others write their whole box inline in JS (the 3D
 * viewport at `top: 60px; right: 16px`, the preferences window centred with a
 * translate). Stripping the inline geometry restores the first kind and
 * strands the second — a `position: fixed` window with no anchor left.
 *
 * So the geometry is recorded rather than guessed, by the two helpers that are
 * the only way a window ever moves: makeDraggable and makeResizable both call
 * rememberDefaultGeometry() as they are wired up, which is during the panel's
 * construction and therefore before any drag. Whatever the panel opened with —
 * inline, empty because the stylesheet owns it, or a mix — is what a reset
 * restores, and no panel has to describe its own defaults twice.
 */

/** The properties a drag or a resize can write. */
const GEOMETRY_PROPERTIES = ['left', 'top', 'right', 'bottom', 'width', 'height', 'transform'];

/** element -> its opening geometry. Weak, so a closed window is collectable. */
const defaults = new WeakMap();

/**
 * Record a window's untouched geometry, once.
 *
 * Later calls are ignored: the first sighting is the only one guaranteed to
 * predate a drag.
 *
 * @param {HTMLElement} panel
 */
export function rememberDefaultGeometry(panel) {
  if (!panel?.style || defaults.has(panel)) return;

  const geometry = {};
  for (const property of GEOMETRY_PROPERTIES) {
    // An empty string is a real answer — it means the stylesheet owns that
    // edge and a reset has to hand it back, not leave a dragged value behind.
    geometry[property] = panel.style.getPropertyValue(property);
  }
  defaults.set(panel, geometry);
}

/**
 * Put a window back where it opened.
 *
 * @param {HTMLElement} panel
 * @returns {boolean} false when nothing was ever recorded for this element
 */
export function restoreDefaultGeometry(panel) {
  const geometry = panel?.style ? defaults.get(panel) : null;
  if (!geometry) return false;

  for (const property of GEOMETRY_PROPERTIES) {
    const value = geometry[property];
    if (value) {
      panel.style.setProperty(property, value);
    } else {
      panel.style.removeProperty(property);
    }
  }
  return true;
}

/** Whether this window's opening geometry is known. */
export function hasDefaultGeometry(panel) {
  return !!panel?.style && defaults.has(panel);
}
