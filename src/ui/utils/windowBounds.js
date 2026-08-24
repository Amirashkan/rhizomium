/**
 * windowBounds.js — where a floating window is allowed to sit.
 *
 * The top menu bar is fixed chrome painted above every floating panel
 * (#top-menu-bar is z-index 2000; the panels sit at 1000–1001), and the
 * canvases already start below it (`top: 40px`). The free-floating windows
 * were the exception: their drag handlers clamped to `top >= 0`, so a window
 * dragged upward slid its whole title bar into the bar's band. That is not a
 * cosmetic overlap — the header is the only thing the window can be grabbed
 * by and it carries the lock / fullscreen / close buttons, so once it is under
 * the bar the window is stranded: clicks there open File / Edit / View
 * instead. Raising the window above the bar would only trade the problem for
 * menus opening behind a panel, so every drag path clamps through here and the
 * header always stays below the chrome.
 */

/** #top-menu-bar's height in CSS, used when the element can't be measured. */
const FALLBACK_BAR_HEIGHT = 40;

/**
 * The y a floating window's top edge must not cross.
 *
 * Returns 0 when there is no menu bar to avoid — the second-monitor page has
 * none, and the preview hides the app chrome (`display: none`) in fullscreen,
 * where the whole viewport is fair game.
 *
 * @returns {number} viewport y of the bottom of the top chrome
 */
export function topChromeBottom() {
  if (typeof document === 'undefined') return 0;

  const bar = document.getElementById('top-menu-bar');
  if (!bar) return 0;

  if (typeof getComputedStyle === 'function') {
    const style = getComputedStyle(bar);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) {
      return 0;
    }
  }

  const bottom = bar.getBoundingClientRect?.().bottom ?? 0;
  // A measured 0 means an unlaid-out document (tests, a page mid-load), not a
  // zero-height bar — fall back to the height the stylesheet gives it.
  return bottom > 0 ? Math.round(bottom) : FALLBACK_BAR_HEIGHT;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * Clamp a floating window's position to the area it may occupy: below the top
 * chrome, and far enough inside the viewport to still be grabbable.
 *
 * How much has to stay on screen is the caller's choice. Pass `width`/`height`
 * to keep the whole window inside the viewport; pass `keepVisibleX` /
 * `keepVisibleY` instead to allow it to hang off the right/bottom edges as
 * long as that many pixels remain reachable.
 *
 * @param {number} left - proposed left, in viewport px
 * @param {number} top - proposed top, in viewport px
 * @param {object} [options]
 * @param {number} [options.width] - window width (keep it fully on screen)
 * @param {number} [options.height] - window height (keep it fully on screen)
 * @param {number} [options.keepVisibleX] - px that must stay past the left edge
 * @param {number} [options.keepVisibleY] - px that must stay above the bottom
 * @returns {{left: number, top: number}} the allowed position
 */
export function clampPanelPosition(left, top, options = {}) {
  const { width = 0, height = 0, keepVisibleX = 0, keepVisibleY = 0 } = options;

  const viewportWidth = (typeof window !== 'undefined' && window.innerWidth) || 0;
  const viewportHeight = (typeof window !== 'undefined' && window.innerHeight) || 0;
  const minTop = topChromeBottom();

  const maxLeft = viewportWidth - (keepVisibleX > 0 ? keepVisibleX : width);
  const maxTop = viewportHeight - (keepVisibleY > 0 ? keepVisibleY : height);

  return {
    left: clamp(left, 0, Math.max(0, maxLeft)),
    // A window taller than the space under the bar would give maxTop < minTop;
    // pinning it to minTop keeps the header reachable, which is the point.
    top: clamp(top, minTop, Math.max(minTop, maxTop)),
  };
}
