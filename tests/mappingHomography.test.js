// tests/mappingHomography.test.js
import { describe, it, expect } from 'vitest';
import {
  solveHomography,
  invertMat3,
  applyMat3,
  mat3ToColumnMajor,
} from '../src/mapping/homography.js';

const UNIT = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

/** Corner-for-corner check that `m` really carries `src` onto `dst`. */
function expectMapsCorners(m, src, dst) {
  for (let i = 0; i < 4; i++) {
    const p = applyMat3(m, src[i].x, src[i].y);
    expect(p.x).toBeCloseTo(dst[i].x, 10);
    expect(p.y).toBeCloseTo(dst[i].y, 10);
  }
}

describe('solveHomography', () => {
  it('returns the identity for the unit square onto itself', () => {
    const h = solveHomography(UNIT, UNIT);
    expectMapsCorners(h, UNIT, UNIT);
  });

  it('solves a pure translate and scale', () => {
    const dst = [{ x: 2, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 4 }, { x: 2, y: 4 }];
    const h = solveHomography(UNIT, dst);
    expectMapsCorners(h, UNIT, dst);
    // An affine map has no perspective terms.
    expect(h[6]).toBeCloseTo(0, 10);
    expect(h[7]).toBeCloseTo(0, 10);
  });

  it('solves a keystone, the case an affine map cannot represent', () => {
    const dst = [{ x: 0.2, y: 0.1 }, { x: 0.9, y: 0.25 }, { x: 0.8, y: 0.9 }, { x: 0.05, y: 0.7 }];
    const h = solveHomography(UNIT, dst);
    expectMapsCorners(h, UNIT, dst);
    // Perspective is genuinely present, so the midpoint of the square does NOT
    // land on the centroid of the quad the way an affine map would put it.
    const centre = applyMat3(h, 0.5, 0.5);
    const centroid = {
      x: dst.reduce((s, p) => s + p.x, 0) / 4,
      y: dst.reduce((s, p) => s + p.y, 0) / 4,
    };
    expect(Math.hypot(centre.x - centroid.x, centre.y - centroid.y)).toBeGreaterThan(1e-3);
  });

  it('maps an arbitrary quad onto an arbitrary quad', () => {
    const src = [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.05 }, { x: 0.95, y: 0.85 }, { x: 0.2, y: 0.9 }];
    const dst = [{ x: -0.1, y: 0.3 }, { x: 1.2, y: 0 }, { x: 1.05, y: 1.1 }, { x: 0.15, y: 0.95 }];
    expectMapsCorners(solveHomography(src, dst), src, dst);
  });

  it('pivots past a leading zero coefficient', () => {
    // The first correspondence starts at the origin, which zeroes the first
    // column of the first row — unsolvable without partial pivoting.
    const dst = [{ x: 0, y: 0 }, { x: 1.4, y: 0.1 }, { x: 1.2, y: 1.3 }, { x: 0.1, y: 1 }];
    expectMapsCorners(solveHomography(UNIT, dst), UNIT, dst);
  });

  it('rejects degenerate quads and malformed input', () => {
    const collapsed = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(solveHomography(UNIT, collapsed)).toBeNull();

    const collinear = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    expect(solveHomography(UNIT, collinear)).toBeNull();

    expect(solveHomography(UNIT, UNIT.slice(0, 3))).toBeNull();
    expect(solveHomography(null, UNIT)).toBeNull();
    expect(solveHomography(UNIT, [{ x: NaN, y: 0 }, ...UNIT.slice(1)])).toBeNull();
  });
});

describe('invertMat3', () => {
  it('round-trips a homography', () => {
    const dst = [{ x: 0.2, y: 0.1 }, { x: 0.9, y: 0.25 }, { x: 0.8, y: 0.9 }, { x: 0.05, y: 0.7 }];
    const h = solveHomography(UNIT, dst);
    const inv = invertMat3(h);
    expectMapsCorners(inv, dst, UNIT);
  });

  it('rejects a singular matrix', () => {
    expect(invertMat3([1, 2, 3, 2, 4, 6, 3, 6, 9])).toBeNull();
    expect(invertMat3([1, 2, 3])).toBeNull();
  });
});

describe('applyMat3', () => {
  it('divides through by w', () => {
    // A point whose w works out to 2 must come back halved.
    const m = [1, 0, 0, 0, 1, 0, 0, 0, 2];
    expect(applyMat3(m, 4, 6)).toEqual({ x: 2, y: 3 });
  });

  it('returns null on the horizon, where w is zero', () => {
    const m = [1, 0, 0, 0, 1, 0, 1, 0, 0]; // w = x
    expect(applyMat3(m, 0, 5)).toBeNull();
  });
});

describe('mat3ToColumnMajor', () => {
  it('transposes into the order WebGL expects', () => {
    const rowMajor = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(Array.from(mat3ToColumnMajor(rowMajor))).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });
});
