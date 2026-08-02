// Regression test: a Rectangle's Width and Height must mean what they say.
//
// Bug: "the rectangle is a 1:1 square with 16:9 ratio set, with a height and width much bigger
// than its surface." The shape function measured BOTH half-extents in y-units after scaling x
// into aspect space, so width == height always drew a square, and the drawn width shrank away
// from the stated one as the composition got wider: on a 16:9 output `width = 0.5` covered 28%
// of the frame, not half of it.
//
// Contract: width is a fraction of the frame's width and height a fraction of its height, so
// 1.0 x 1.0 fills the frame at any ratio. Circle and Polygon deliberately keep their radius in
// y-units - one extent, and it has to stay round.
//
// Also covers `roundness`: the parameter is in the node definition and the panel, but nothing
// was ever passed to the shader, so the control did nothing.

import { describe, it, expect } from 'vitest';
import { FieldNodes } from '../src/codegen/compilers/FieldNodes.js';

const compileShape = (node) => {
  const fn = new FieldNodes();
  return fn.compile(node, () => 'in.uv');
};

describe('Rectangle shape codegen', () => {
  const rect = (params = {}) => ({ id: '4', kind: 'Rectangle', params });

  it('measures width against the frame width, not the frame height', () => {
    const { functionDef } = compileShape(rect());
    // The x half-extent is carried into aspect space, where the frame spans [0, aspect].
    expect(functionDef).toMatch(/_half\.x \*= u\.aspect;/);
  });

  it('keeps the distance field isotropic so rotation and smoothness stay true', () => {
    const { functionDef } = compileShape(rect());
    // Both the point and the centre live in aspect space alongside the half-extents.
    expect(functionDef).toMatch(/_uvA\.x \*= u\.aspect;/);
    expect(functionDef).toContain('centerX * u.aspect');
  });

  it('passes roundness to the shader and applies it as a corner radius', () => {
    const { functionDef, line } = compileShape(rect({ roundness: 0.5 }));
    expect(functionDef).toContain('roundness: f32');
    // Clamped against the shortest half-extent, so it can never invert the shape.
    expect(functionDef).toMatch(/clamp\(roundness, 0\.0, 1\.0\)/);
    // Rounded-box SDF: shrink by r, then grow the distance back by r.
    expect(functionDef).toMatch(/- _?n?_?4_half \+ vec2<f32>\(\w*_?4_r\)/);
    // ...and the call site supplies it.
    expect(line.match(/,/g).length).toBe(8); // uv + 8 params
  });

  it('leaves Circle and Polygon measuring in y-units - they must stay round', () => {
    const circle = compileShape({ id: '5', kind: 'Circle', params: {} });
    const polygon = compileShape({ id: '6', kind: 'Polygon', params: {} });
    expect(circle.functionDef).not.toMatch(/radius \*= u\.aspect/);
    expect(polygon.functionDef).not.toMatch(/radius \* u\.aspect/);
    // Their centres are still placed in aspect space, so 0.5, 0.5 is the middle of the frame.
    expect(circle.functionDef).toContain('centerX * u.aspect');
    expect(polygon.functionDef).toContain('centerX * u.aspect');
  });
});
