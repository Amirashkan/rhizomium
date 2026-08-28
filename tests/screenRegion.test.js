import { describe, it, expect } from 'vitest';
import {
  FULL_REGION,
  sanitizeRegion,
  isFullRegion,
  regionQuad,
  regionAspect,
  composeMappingWithRegion,
  tileRegions,
} from '../src/screens/screenRegion.js';

describe('sanitizeRegion', () => {
  it('reads a missing or unusable region as the whole composition', () => {
    // A screen with no framing is a mirror, never a black rectangle.
    expect(sanitizeRegion(null)).toEqual(FULL_REGION);
    expect(sanitizeRegion(undefined)).toEqual(FULL_REGION);
    expect(sanitizeRegion('nonsense')).toEqual(FULL_REGION);
    expect(sanitizeRegion({ x: NaN, y: NaN, w: NaN, h: NaN })).toEqual(FULL_REGION);
  });

  it('clamps a span to what is left of the composition', () => {
    // A region can never describe pixels the composition does not have.
    const r = sanitizeRegion({ x: 0.8, y: 0.5, w: 1, h: 1 });
    expect(r.x).toBeCloseTo(0.8, 6);
    expect(r.y).toBeCloseTo(0.5, 6);
    expect(r.w).toBeCloseTo(0.2, 6);
    expect(r.h).toBeCloseTo(0.5, 6);
  });

  it('refuses a degenerate crop', () => {
    const r = sanitizeRegion({ x: 0.2, y: 0.2, w: 0, h: -3 });
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });

  it('clamps coordinates into the composition', () => {
    expect(sanitizeRegion({ x: -1, y: 4, w: 0.5, h: 0.5 })).toMatchObject({ x: 0, y: 1 });
  });
});

describe('isFullRegion', () => {
  it('recognises the whole composition, and a crop that is not', () => {
    expect(isFullRegion(FULL_REGION)).toBe(true);
    expect(isFullRegion(null)).toBe(true);
    expect(isFullRegion({ x: 0, y: 0, w: 0.5, h: 1 })).toBe(false);
  });
});

describe('regionQuad', () => {
  it('emits corners in TL, TR, BR, BL order', () => {
    expect(regionQuad({ x: 0.25, y: 0, w: 0.5, h: 1 })).toEqual([
      { x: 0.25, y: 0 }, { x: 0.75, y: 0 }, { x: 0.75, y: 1 }, { x: 0.25, y: 1 },
    ]);
  });
});

describe('regionAspect', () => {
  it('narrows the composition aspect by the crop', () => {
    // A third of a 16:9 composition side-to-side is three times narrower.
    expect(regionAspect(16 / 9, { x: 0, y: 0, w: 1 / 3, h: 1 })).toBeCloseTo((16 / 9) / 3, 6);
  });

  it('is unknown when the composition aspect is', () => {
    expect(regionAspect(0, FULL_REGION)).toBe(0);
  });
});

describe('composeMappingWithRegion', () => {
  const mapping = () => ({
    enabled: true,
    surfaces: [{
      id: 's1',
      enabled: true,
      dst: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      src: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    }],
  });

  it('has nothing to composite for a mirror with no mapping', () => {
    expect(composeMappingWithRegion(null, FULL_REGION)).toBeNull();
    expect(composeMappingWithRegion({ enabled: false, surfaces: [] }, FULL_REGION)).toBeNull();
  });

  it('passes an active mapping through untouched when the screen mirrors', () => {
    const m = mapping();
    expect(composeMappingWithRegion(m, FULL_REGION)).toBe(m);
  });

  it('synthesises the crop as a full-frame surface when nothing is mapped', () => {
    const region = { x: 1 / 3, y: 0, w: 1 / 3, h: 1 };
    const composed = composeMappingWithRegion(null, region);
    expect(composed.enabled).toBe(true);
    expect(composed.surfaces).toHaveLength(1);
    // Samples the middle third, and fills the screen with it.
    expect(composed.surfaces[0].src).toEqual(regionQuad(region));
    expect(composed.surfaces[0].dst).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
    ]);
  });

  it('re-expresses a mapping’s source crop inside the screen’s region', () => {
    // A surface sampling the left half of what its screen shows must sample the
    // left half of the REGION, not of the whole composition.
    const region = { x: 0.5, y: 0, w: 0.5, h: 1 };
    const m = mapping();
    m.surfaces[0].src = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }];
    const composed = composeMappingWithRegion(m, region);
    expect(composed.surfaces[0].src).toEqual([
      { x: 0.5, y: 0 }, { x: 0.75, y: 0 }, { x: 0.75, y: 1 }, { x: 0.5, y: 1 },
    ]);
    // Destination quads are in the screen's own output space and never move.
    expect(composed.surfaces[0].dst).toEqual(m.surfaces[0].dst);
  });

  it('leaves the editor’s snapshot unmutated', () => {
    const m = mapping();
    const before = JSON.parse(JSON.stringify(m));
    composeMappingWithRegion(m, { x: 0.25, y: 0, w: 0.5, h: 1 });
    expect(m).toEqual(before);
  });
});

describe('tileRegions', () => {
  it('abuts tiles that exactly cover the composition', () => {
    const tiles = tileRegions({ cols: 3 });
    expect(tiles).toHaveLength(3);
    expect(tiles[0].x).toBeCloseTo(0, 6);
    expect(tiles[1].x).toBeCloseTo(1 / 3, 6);
    // The last tile is pinned to the far edge so the rig covers everything.
    expect(tiles[2].x + tiles[2].w).toBeCloseTo(1, 6);
  });

  it('overlaps neighbours by the blend fraction, still covering the composition', () => {
    const tiles = tileRegions({ cols: 3, overlap: 0.1 });
    const shared = (tiles[0].x + tiles[0].w) - tiles[1].x;
    expect(shared).toBeCloseTo(tiles[0].w * 0.1, 6);
    expect(tiles[0].x).toBeCloseTo(0, 6);
    expect(tiles[2].x + tiles[2].w).toBeCloseTo(1, 6);
  });

  it('lays a grid out in reading order', () => {
    const tiles = tileRegions({ cols: 2, rows: 2 });
    expect(tiles).toHaveLength(4);
    expect(tiles[0]).toMatchObject({ x: 0, y: 0 });
    expect(tiles[1].x).toBeCloseTo(0.5, 6);
    expect(tiles[1].y).toBeCloseTo(0, 6);
    expect(tiles[2].y).toBeCloseTo(0.5, 6);
  });

  it('is the whole composition for a single tile', () => {
    expect(tileRegions({ cols: 1, rows: 1 })).toEqual([FULL_REGION]);
  });

  it('holds a wild request inside sane bounds', () => {
    expect(tileRegions({ cols: 999, rows: 0, overlap: 5 }).length).toBe(16);
  });
});
