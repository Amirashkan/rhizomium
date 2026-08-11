// Regression test: a Rectangle's Width and Height must mean what they say.
//
// Bug (round 1): "the rectangle is a 1:1 square with 16:9 ratio set, with a height and width much
// bigger than its surface." The shape function measured BOTH half-extents in y-units after scaling
// x into aspect space, so width == height always drew a square, and the drawn width shrank away
// from the stated one as the composition got wider: on a 16:9 output `width = 0.5` covered 28% of
// the frame, not half of it.
//
// Bug (round 2): measuring width against the frame's width fixed the size but locked the SHAPE to
// the composition. Half-and-half is then half the width and half the height, i.e. a 16:9 rectangle
// on a 16:9 output - the two numbers no longer describe the shape's proportions, and no pair of
// them can draw a square unless the composition is square.
//
// Contract: the two readings are both legitimate and cannot both hold at once, so `sizeMode` picks,
// and the one that makes the numbers describe the SHAPE is the default:
//   Proportional (default)  both extents are measured against the frame's HEIGHT, so width : height
//                    is the drawn ratio and 0.5 x 0.5 is a true square at every render resolution.
//   Frame            width is a fraction of the frame's WIDTH, height a fraction of its HEIGHT, so
//                    1.0 x 1.0 fills the frame at any ratio, at the cost of the shape following it.
// Circle and Polygon are always in y-units - one extent, and it has to stay round - which is
// exactly the unit Proportional shares with them.
//
// Also covers `roundness`: the parameter is in the node definition and the panel, but nothing was
// ever passed to the shader, so the control did nothing.

import { describe, it, expect } from 'vitest';
import { FieldNodes, rectangleIsProportional } from '../src/codegen/compilers/FieldNodes.js';
import { PatternNodes } from '../src/data/nodes/PatternNodes.js';

const compileShape = (node) => {
  const fn = new FieldNodes();
  return fn.compile(node, () => 'in.uv');
};

describe('Rectangle shape codegen', () => {
  const rect = (params = {}) => ({ id: '4', kind: 'Rectangle', params });

  describe('Proportional mode (the default)', () => {
    it('leaves width in y-units so equal extents draw a real square', () => {
      const { functionDef } = compileShape(rect({ sizeMode: 'Proportional' }));
      // Aspect space already measures both axes in frame-heights: scaling x is exactly what
      // would make the shape follow the composition instead of the numbers.
      expect(functionDef).not.toMatch(/_half\.x \*= u\.aspect;/);
    });

    it('is what an absent, empty or unrecognised sizeMode resolves to', () => {
      // Including a project saved before the mode existed: a patch keeps the shape it was
      // authored with rather than silently widening on the next open.
      for (const params of [{}, { sizeMode: '' }, { sizeMode: 'nonsense' }, { sizeMode: 42 }]) {
        expect(compileShape(rect(params)).functionDef).not.toMatch(/_half\.x \*= u\.aspect;/);
      }
    });

    it('is matched case- and whitespace-insensitively, and so is opting out', () => {
      for (const sizeMode of ['proportional', 'PROPORTIONAL', ' Proportional ']) {
        expect(rectangleIsProportional(rect({ sizeMode }))).toBe(true);
      }
      for (const sizeMode of ['Frame', 'frame', ' FRAME ']) {
        expect(rectangleIsProportional(rect({ sizeMode }))).toBe(false);
      }
      expect(rectangleIsProportional(rect())).toBe(true);
    });

    it('still measures the point and the centre in aspect space', () => {
      // Only the WIDTH's unit changes. Centring and the isotropy of the field must not:
      // centerX 0.5 is the middle of the frame in both modes.
      const { functionDef } = compileShape(rect({ sizeMode: 'Proportional' }));
      expect(functionDef).toMatch(/_uvA\.x \*= u\.aspect;/);
      expect(functionDef).toContain('centerX * u.aspect');
    });
  });

  describe('Frame mode', () => {
    it('measures width against the frame width, so 1.0 x 1.0 fills the composition', () => {
      const { functionDef } = compileShape(rect({ sizeMode: 'Frame' }));
      // The x half-extent is carried into aspect space, where the frame spans [0, aspect].
      expect(functionDef).toMatch(/_half\.x \*= u\.aspect;/);
    });
  });

  it('keeps the distance field isotropic so rotation and smoothness stay true', () => {
    for (const sizeMode of ['Proportional', 'Frame']) {
      const { functionDef } = compileShape(rect({ sizeMode }));
      // Both the point and the centre live in aspect space alongside the half-extents.
      expect(functionDef).toMatch(/_uvA\.x \*= u\.aspect;/);
      expect(functionDef).toContain('centerX * u.aspect');
    }
  });

  it('floors the half-extents at zero but does not cap them at the frame', () => {
    // A negative extent would turn the box inside out, so the floor stays. The old ceiling of
    // 1.0 silently discarded anything above it - including the 2.0 the panel's slider allows.
    const { functionDef } = compileShape(rect());
    expect(functionDef).toMatch(/max\(vec2<f32>\(width, height\), vec2<f32>\(0\.0\)\)/);
    expect(functionDef).not.toMatch(/clamp\(\s*vec2<f32>\(width, height\)/);
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

  it('offers the mode on the node, defaulting to the one whose numbers describe the shape', () => {
    // Without this the control is unreachable and the compiler branch is dead code. The default
    // has to agree with rectangleIsProportional's fallback, or a fresh node and a pre-mode
    // project file would render differently from each other.
    const sizeMode = PatternNodes.Rectangle.params.find((p) => p.name === 'sizeMode');
    expect(sizeMode).toBeDefined();
    expect(sizeMode.type).toBe('select');
    expect(sizeMode.options).toEqual(['Proportional', 'Frame']);
    expect(sizeMode.default).toBe('Proportional');
    expect(rectangleIsProportional(rect({ sizeMode: sizeMode.default }))).toBe(true);
  });
});
