// Regression test: the Pattern node's cells must be square, not the frame's shape.
//
// Bug: "pattern follows the ratio, but has stretched the checker." generatePatternShader
// measured straight in normalized UV, so every cell inherited the composition's aspect —
// a checkerboard on a 16:9 output was built from 16:9 cells, the dots were ellipses and
// the hexagons skewed. Every other generator in the codebase already corrects for this:
// the noise and gradient compute shaders scale x by resolution.x / resolution.y, and the
// Circle/Rectangle/Polygon fragment nodes measure in the same aspect space via u.aspect.
// Pattern was the one that didn't.
//
// Contract: the correction is applied to the UV before the pattern is sampled, and it is
// applied BEFORE the rotation so the pattern still turns about the middle of the frame
// rather than shearing.

import { describe, it, expect } from 'vitest';
import { ComputeNodes } from '../src/codegen/compilers/ComputeNodes.js';

const patternShader = (type) =>
  new ComputeNodes().generatePatternShader({ id: '9', kind: 'ComputePattern', params: { type } }, () => null);

describe('ComputePattern measures in aspect space', () => {
  it('corrects the UV by the output aspect', () => {
    const wgsl = patternShader('Checkerboard');
    expect(wgsl).toContain('let aspect = uniforms.resolution.x / uniforms.resolution.y;');
    expect(wgsl).toContain('uv = vec2<f32>(uv.x * aspect - (aspect - 1.0) * 0.5, uv.y);');
  });

  it('corrects before rotating, so rotation turns rather than shears', () => {
    const wgsl = patternShader('Checkerboard');
    const corrected = wgsl.indexOf('uv.x * aspect');
    const rotated = wgsl.indexOf('rotate2D(uv, uniforms.rotation)');
    expect(corrected).toBeGreaterThan(-1);
    expect(rotated).toBeGreaterThan(corrected);
  });

  it('corrects before scaling, so scaleX/scaleY still count cells per axis', () => {
    const wgsl = patternShader('Dots');
    const corrected = wgsl.indexOf('uv.x * aspect');
    const scaled = wgsl.indexOf('uv = uv * uniforms.scale;');
    expect(scaled).toBeGreaterThan(corrected);
  });

  it('applies to every pattern type - they all share the one UV', () => {
    for (const type of ['Checkerboard', 'Stripes', 'Dots', 'Grid', 'Hexagon', 'Brick']) {
      expect(patternShader(type)).toContain('uv.x * aspect');
    }
  });
});
