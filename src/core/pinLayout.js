// Shared vertical layout for a node's pins, used by both the renderer (drawing) and the connection
// manager (hit-testing) so the two never drift.
//
// A group of `count` pins is centered on the node's vertical middle — so a single pin sits at the
// node's center rather than pinned to the top — then clamped to stay below the title bar and above
// the bottom edge. On a node sized to exactly fit its pins this collapses back to starting at
// PIN_TOP, matching the old fixed layout; taller nodes (e.g. with a big thumbnail) center the pins.

export const PIN_TOP = 32;          // first pin stays at least this far below the node top (title bar)
export const PIN_SPACING = 18;      // vertical gap between consecutive pins
export const PIN_BOTTOM_MARGIN = 16; // keep the last pin at least this far above the bottom edge

/** Y of the first pin in a vertically-centered group of `count` pins. */
export function pinGroupStartY(node, count) {
  const top = node.y || 0;
  const h = node.h || 80;
  const groupHeight = Math.max(0, count - 1) * PIN_SPACING;
  const centered = top + h / 2 - groupHeight / 2;
  const minTop = top + PIN_TOP;
  const maxTop = top + h - PIN_BOTTOM_MARGIN - groupHeight;
  // maxTop >= minTop whenever the node is tall enough to hold the pins (guaranteed by the renderer's
  // minimum-height sizing); if not, fall back to minTop so the group still starts below the title.
  return Math.max(minTop, Math.min(centered, maxTop));
}
