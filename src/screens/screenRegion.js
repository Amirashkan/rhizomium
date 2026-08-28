// src/screens/screenRegion.js
//
// The geometry behind per-screen framing: which part of the composition one
// output screen shows, and how that folds into the projection mapping the screen
// already warps through.
//
// A REGION is a normalised crop of the composition — (0,0) top-left to (1,1)
// bottom-right — exactly the space a mapping surface's `src` quad lives in. A
// screen showing the whole composition has the full region and is the mirror
// case; three screens with regions {0,0,1/3,1}, {1/3,0,1/3,1}, {2/3,0,1/3,1} tile
// one wide composition across three projectors.
//
// Regions are normalised rather than pixel rects for the same reason mapping
// quads are: a wall laid out against a 1920x1080 output still lands correctly
// when the same project is thrown at 4K, or when one projector in the rig is a
// different resolution from its neighbours.
//
// Everything here is pure data in, pure data out — no DOM, no GL, no channel —
// so the editor's screens panel, the output window's receiver and the tests all
// compute framing the same way.

/** The whole composition: what a mirrored screen shows. */
export const FULL_REGION = Object.freeze({ x: 0, y: 0, w: 1, h: 1 });

/** Smallest crop we allow. Below this a screen is a magnifying glass, not a screen. */
const MIN_SPAN = 0.01;

function clamp01(v, fallback = 0) {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

/**
 * Coerce anything into a usable region: inside the composition, never inverted,
 * never degenerate. A missing or unusable region reads as the full composition,
 * so a screen with no framing set is a mirror rather than a black rectangle.
 *
 * @param {{x?:number,y?:number,w?:number,h?:number}|null|undefined} region
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function sanitizeRegion(region) {
  if (!region || typeof region !== 'object') return { ...FULL_REGION };
  const x = clamp01(region.x, 0);
  const y = clamp01(region.y, 0);
  // A span is clamped against what is left of the composition from (x, y), so a
  // region can never describe pixels the composition does not have.
  const w = Math.min(Math.max(clamp01(region.w, 1), MIN_SPAN), Math.max(MIN_SPAN, 1 - x));
  const h = Math.min(Math.max(clamp01(region.h, 1), MIN_SPAN), Math.max(MIN_SPAN, 1 - y));
  return { x, y, w, h };
}

/** True when the region is the whole composition (within float tolerance). */
export function isFullRegion(region) {
  const r = sanitizeRegion(region);
  return Math.abs(r.x) < 1e-6 && Math.abs(r.y) < 1e-6
    && Math.abs(r.w - 1) < 1e-6 && Math.abs(r.h - 1) < 1e-6;
}

/**
 * The region as a corner quad in TL, TR, BR, BL order — the order every quad in
 * the mapping system uses.
 * @returns {Array<{x:number,y:number}>}
 */
export function regionQuad(region) {
  const { x, y, w, h } = sanitizeRegion(region);
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/**
 * The aspect ratio of what a screen actually shows.
 *
 * The composition's own aspect describes the whole frame; a screen showing a
 * third of it side-to-side shows something three times narrower. This is the
 * shape the output window letterboxes into its display.
 *
 * @param {number} compositionAspect the composition's width/height
 * @param {object} region
 * @returns {number} the visible slice's width/height, or 0 when unknown
 */
export function regionAspect(compositionAspect, region) {
  if (!Number.isFinite(compositionAspect) || compositionAspect <= 0) return 0;
  const r = sanitizeRegion(region);
  return compositionAspect * (r.w / r.h);
}

/**
 * Fold a screen's region into a projection mapping.
 *
 * A mapping surface samples the composition through its `src` quad. When the
 * screen is showing only a crop, the artist authored those surfaces against what
 * that screen SHOWS — so each src coordinate is re-expressed inside the region:
 * a surface sampling the left half of its screen samples the left half of the
 * region, not the left half of the whole composition.
 *
 * With no mapping (or an inactive one) the region still has to be applied, so
 * this synthesises the one surface that is exactly "show this crop, full frame".
 * That keeps the output window to a single presentation path: a cropped screen
 * always composites, whether or not anything is mapped.
 *
 * @param {{enabled?:boolean, surfaces?:Array}|null} snapshot a MappingModel.serialize()
 * @param {object} region the screen's crop of the composition
 * @returns {{enabled:boolean, surfaces:Array}|null} a snapshot to deserialize, or
 *   null when there is nothing to composite (full region, no active mapping)
 */
export function composeMappingWithRegion(snapshot, region) {
  const r = sanitizeRegion(region);
  const active = !!(snapshot && snapshot.enabled
    && Array.isArray(snapshot.surfaces) && snapshot.surfaces.length > 0);

  if (isFullRegion(r)) return active ? snapshot : null;

  if (!active) {
    // Nothing mapped: the crop itself is the whole job.
    return {
      enabled: true,
      surfaces: [{
        id: 'region',
        name: 'Screen region',
        enabled: true,
        locked: true,
        opacity: 1,
        softEdge: 0,
        dst: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
        src: regionQuad(r),
      }],
    };
  }

  return {
    ...snapshot,
    surfaces: snapshot.surfaces.map((s) => ({
      ...s,
      src: (Array.isArray(s.src) ? s.src : regionQuad(FULL_REGION)).map((p) => ({
        x: r.x + clamp01(p?.x, 0) * r.w,
        y: r.y + clamp01(p?.y, 0) * r.h,
      })),
    })),
  };
}

/**
 * Lay out a grid of regions that together cover the composition.
 *
 * `overlap` is the fraction of each tile shared with its neighbour — the
 * headroom a projector rig needs for edge blending, where two beams cross and
 * their soft edges add back up to one continuous image. At 0 the tiles simply
 * abut, which is what an LED wall or a set of discrete monitors wants.
 *
 * @param {object} [opts]
 * @param {number} [opts.cols=1] columns across the composition
 * @param {number} [opts.rows=1] rows down it
 * @param {number} [opts.overlap=0] neighbour overlap, 0..0.5 of a tile
 * @returns {Array<{x:number,y:number,w:number,h:number}>} row-major regions
 */
export function tileRegions({ cols = 1, rows = 1, overlap = 0 } = {}) {
  const c = Math.max(1, Math.min(16, Math.round(Number(cols) || 1)));
  const r = Math.max(1, Math.min(16, Math.round(Number(rows) || 1)));
  const o = Math.min(0.5, Math.max(0, Number(overlap) || 0));

  // n tiles of width w, each sharing `o * w` with the one before it, must span
  // the composition exactly: n*w - (n-1)*o*w = 1.
  const span = (n) => 1 / (n - (n - 1) * o);
  const tw = span(c);
  const th = span(r);
  const stepX = tw * (1 - o);
  const stepY = th * (1 - o);

  const out = [];
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < c; col++) {
      out.push(sanitizeRegion({
        // The last tile is pinned to the far edge rather than left a float
        // rounding short of it, so the rig covers the composition completely.
        x: col === c - 1 ? Math.max(0, 1 - tw) : col * stepX,
        y: row === r - 1 ? Math.max(0, 1 - th) : row * stepY,
        w: tw,
        h: th,
      }));
    }
  }
  return out;
}
