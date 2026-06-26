// Regression test: a scalar input node (ConstFloat) whose value references a VECTOR must coerce it
// to a scalar, instead of emitting a vec-valued variable typed f32.
//
// Repro (user graph): Mouse -> ... -> ConstFloat (value = "=node_<mouse>") -> Circle radius
// (= "=node_<float>"). The ConstFloat compiled to `let node_F = g.mouse;` (a vec4) while declaring
// outputType f32. The Circle's radius then trusted that f32 type, skipped coercion, and passed the
// vec4 straight into shape_circle(...), producing:
//   "type mismatch for argument 4 in call to 'shape_circle_..': expected 'f32', got 'vec4<f32>'"
// which invalidates the whole shader module -> black render.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';

// ConstFloat (id 5) with the given value, referenced by a Circle's radius (so it is compiled), then
// wired to the output. Returns the float's WGSL line and the circle's call line.
function buildFloatRef(floatValue, extraNodes = [], connections = []) {
  const graph = {
    nodes: [
      ...extraNodes,
      { id: '5', kind: 'ConstFloat', params: { value: floatValue }, inputs: [] },
      { id: '27', kind: 'Circle', params: { centerX: 0.5, centerY: 0.5, radius: '=node_5', epsilon: 0.01 }, inputs: [] },
      { id: '99', kind: 'OutputFinal', params: {}, inputs: ['27'] },
    ],
    connections,
  };
  const result = buildWGSL(graph);
  const code = typeof result === 'string' ? result : result.wgsl;
  const lines = code.split('\n');
  return {
    floatLine: lines.find((l) => l.includes('let node_5 =')),
    circleLine: lines.find((l) => l.includes('let node_27 = shape_circle_27')),
  };
}

describe('ConstFloat scalar coercion of vector references', () => {
  beforeEach(() => {
    delete window.editor;
  });

  it('coerces a bare Mouse (vec4) reference in a ConstFloat to a single scalar channel', () => {
    const { floatLine, circleLine } = buildFloatRef('=node_28', [
      { id: '28', kind: 'Mouse', params: {}, inputs: [] },
    ]);
    // The ConstFloat must be a scalar channel, not the whole vec4.
    expect(floatLine).toContain('g.mouse.x');
    expect(floatLine).not.toMatch(/=\s*g\.mouse\s*;/);
    expect(floatLine).not.toMatch(/=\s*node_28\s*;/);
    // And the radius slot gets the (now genuinely scalar) float, no bare vec4.
    expect(circleLine).toContain('node_5');
  });

  it('coerces a component Mouse reference (=node_28_y) in a ConstFloat', () => {
    const { floatLine } = buildFloatRef('=node_28_y', [
      { id: '28', kind: 'Mouse', params: {}, inputs: [] },
    ]);
    expect(floatLine).toContain('g.mouse.y');
    expect(floatLine).not.toContain('node_28_y');
  });

  it('still bakes a plain numeric ConstFloat value (no expression)', () => {
    const { floatLine } = buildFloatRef(2);
    // Numeric path is unchanged (uniform reference or baked literal), never a vector.
    expect(floatLine).toBeTruthy();
    expect(floatLine).not.toMatch(/g\.mouse/);
  });

  it('keeps a time expression working in a ConstFloat', () => {
    const { floatLine } = buildFloatRef('=sin(time)');
    expect(floatLine).toContain('sin(g.time)');
  });
});
