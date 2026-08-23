// tests/mappingCompositor.test.js
//
// The compositor's GL side needs a real context, but its GEOMETRY — the two
// matrices every surface is drawn with — is pure math and is what actually
// decides whether a mapped pixel lands in the right place.
import { describe, it, expect } from 'vitest';
import { surfaceMatrices, outputToSource } from '../src/mapping/MappingCompositor.js';
import { createSurface, rectQuad } from '../src/mapping/MappingModel.js';
import { applyMat3 } from '../src/mapping/homography.js';

describe('surfaceMatrices', () => {
  it('maps a surface\'s destination corners onto the unit square', () => {
    const surface = createSurface({
      dst: [{ x: 0.2, y: 0.1 }, { x: 0.9, y: 0.25 }, { x: 0.8, y: 0.9 }, { x: 0.05, y: 0.7 }],
    });
    const { dstToUnit } = surfaceMatrices(surface);
    const expected = rectQuad(0, 0, 1, 1);
    surface.dst.forEach((corner, i) => {
      const q = applyMat3(dstToUnit, corner.x, corner.y);
      expect(q.x).toBeCloseTo(expected[i].x, 9);
      expect(q.y).toBeCloseTo(expected[i].y, 9);
    });
  });

  it('maps the unit square onto the source crop', () => {
    const surface = createSurface({ src: rectQuad(0.25, 0.5, 0.5, 0.5) });
    const { unitToSrc } = surfaceMatrices(surface);
    expect(applyMat3(unitToSrc, 0, 0)).toEqual({ x: 0.25, y: 0.5 });
    const centre = applyMat3(unitToSrc, 0.5, 0.5);
    expect(centre.x).toBeCloseTo(0.5);
    expect(centre.y).toBeCloseTo(0.75);
  });

  it('returns null for a collapsed surface instead of a broken matrix', () => {
    const collapsed = createSurface({
      dst: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
    });
    expect(surfaceMatrices(collapsed)).toBeNull();
  });
});

describe('outputToSource', () => {
  it('is the identity for an unmapped surface', () => {
    const surface = createSurface();
    const p = outputToSource(surface, 0.3, 0.7);
    expect(p.x).toBeCloseTo(0.3);
    expect(p.y).toBeCloseTo(0.7);
  });

  it('reports where a keystoned surface samples from', () => {
    const surface = createSurface({
      dst: [{ x: 0.2, y: 0.1 }, { x: 0.9, y: 0.25 }, { x: 0.8, y: 0.9 }, { x: 0.05, y: 0.7 }],
      src: rectQuad(0, 0, 1, 1),
    });
    // Each destination corner samples the matching corner of the crop.
    const topLeft = outputToSource(surface, surface.dst[0].x, surface.dst[0].y);
    expect(topLeft.x).toBeCloseTo(0, 6);
    expect(topLeft.y).toBeCloseTo(0, 6);
    const bottomRight = outputToSource(surface, surface.dst[2].x, surface.dst[2].y);
    expect(bottomRight.x).toBeCloseTo(1, 6);
    expect(bottomRight.y).toBeCloseTo(1, 6);
  });

  it('composes the destination warp with the source crop', () => {
    const surface = createSurface({
      dst: rectQuad(0, 0, 0.5, 1),      // left half of the projected frame
      src: rectQuad(0.5, 0, 0.5, 1),    // showing the right half of the composition
    });
    const p = outputToSource(surface, 0.25, 0.5);
    expect(p.x).toBeCloseTo(0.75);
    expect(p.y).toBeCloseTo(0.5);
  });

  it('returns null off the surface', () => {
    const surface = createSurface({ dst: rectQuad(0, 0, 0.4, 0.4) });
    expect(outputToSource(surface, 0.9, 0.9)).toBeNull();
  });
});
