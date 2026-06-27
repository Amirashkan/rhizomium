// Shared vertical layout for a node's pins, used by both the renderer (drawing) and the connection
// manager (hit-testing) so the two never drift.
//
// A node is split into a top thumbnail band (height stored on node.__thumbBand, 0 when there's no
// thumbnail) and a content area below it. Pins live in the content area: a group of `count` pins is
// centered between the title row (PIN_TOP below the content top) and a strip reserved for the id at
// the bottom (PIN_ID_RESERVE) — so a single pin sits at the content's vertical middle rather than
// near the top. On a node sized to exactly fit its pins this collapses to starting at PIN_TOP.

export const PIN_TOP = 32;         // first pin stays at least this far below the content top (title row)
export const PIN_SPACING = 18;     // vertical gap between consecutive pins
export const PIN_ID_RESERVE = 22;  // bottom strip reserved for the node id, below the lowest pin

/** Vertical [top, bottom] band the pins are centered within (content area minus title and id rows). */
export function pinRegion(node) {
  const contentTop = (node.y || 0) + (node.__thumbBand || 0);
  const top = contentTop + PIN_TOP;
  const bottom = (node.y || 0) + (node.h || 80) - PIN_ID_RESERVE;
  return { top, bottom };
}

/** Y of the first pin in a vertically-centered group of `count` pins within the content area. */
export function pinGroupStartY(node, count) {
  const { top, bottom } = pinRegion(node);
  const groupHeight = Math.max(0, count - 1) * PIN_SPACING;
  const centered = (top + bottom) / 2 - groupHeight / 2;
  const maxTop = bottom - groupHeight;
  // maxTop >= top whenever the node is tall enough to hold the pins (guaranteed by the renderer's
  // minimum-height sizing); if not, fall back to `top` so the group still starts below the title.
  return Math.max(top, Math.min(centered, maxTop));
}
