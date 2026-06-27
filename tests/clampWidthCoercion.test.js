// Regression test: width-mismatched secondary inputs on type-aware math builtins.
//
// Bug: the type-aware math compilers (Clamp, Smoothstep, Step, Mix, Mod) take the *value*
// input's type as the output width but spliced connected min/max/edge inputs in via their raw
// code without coercing them to that width. When a secondary input's width differed from the
// value's -- exactly what happens when type metadata goes stale/wrong after an undo restore --
// the generated builtin call mixed widths, e.g.
//   clamp(node_v /* vec3 */, node_min /* f32 */, node_max /* f32 */)
// which is invalid WGSL and invalidates the whole shader module (black render).
//
// Fix: secondary inputs are coerced to the value/x width derived from the value's actual type.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';

// vec3 producer (Combine3) feeds the value/x slot; scalar producers (ConstFloat) feed the
// secondary slots, so without coercion the builtin call would mix vec3 and f32 arguments.
function buildBuiltin(kind, inputs) {
  const graph = {
    nodes: [
      { id: '1', kind: 'ConstFloat', params: { value: 0.2 }, inputs: [] },
      { id: '2', kind: 'ConstFloat', params: { value: 0.8 }, inputs: [] },
      { id: '3', kind: 'Combine3', params: {}, inputs: [] },
      { id: '10', kind, params: {}, inputs },
      { id: '99', kind: 'OutputFinal', params: {}, inputs: ['10'] },
    ],
    connections: [],
  };
  const result = buildWGSL(graph);
  const code = typeof result === 'string' ? result : result.wgsl || result.code || result.shader;
  return code.split('\n').find((l) => l.includes('let node_10 ='));
}

// A bare vec3 builtin argument (the variable itself or a vec3 literal) is fine; a bare scalar
// node reference / scalar literal sitting next to it is the width mismatch we are guarding against.
function expectNoBareScalarBesideVec3(line) {
  // The value reference node_3 (vec3) should appear...
  expect(line).toContain('node_3');
  // ...and every scalar source must be wrapped into a vec3, never spliced in bare next to the
  // vec3 value (the pre-fix `clamp(node_3, node_1, node_2)` width mismatch).
  expect(line).not.toContain('node_3, node_1');
  expect(line).not.toMatch(/node_1,\s*node_2/);
  expect(line).toContain('vec3<f32>(node_1)');
  expect(line).toContain('vec3<f32>(node_2)');
}

describe('type-aware math builtins coerce secondary inputs to the value width', () => {
  beforeEach(() => {
    delete window.editor;
    delete window.nodeCompiler;
  });

  it('Clamp coerces scalar min/max to the vec3 value width', () => {
    const line = buildBuiltin('Clamp', ['3', '1', '2']);
    expect(line).toContain('clamp(');
    expectNoBareScalarBesideVec3(line);
  });

  it('Smoothstep coerces scalar edges to the vec3 x width', () => {
    // smoothstep(edge0, edge1, x): edges are inputs 0/1, x is input 2.
    const line = buildBuiltin('Smoothstep', ['1', '2', '3']);
    expect(line).toContain('smoothstep(');
    expect(line).toContain('node_3');
    expect(line).toContain('vec3<f32>(node_1)');
    expect(line).toContain('vec3<f32>(node_2)');
  });

  it('Step coerces the scalar edge to the vec3 x width', () => {
    // step(edge, x): edge is input 0, x is input 1.
    const line = buildBuiltin('Step', ['1', '3']);
    expect(line).toContain('step(');
    expect(line).toContain('node_3');
    expect(line).toContain('vec3<f32>(node_1)');
  });

  it('Mix coerces the scalar endpoint to the vec3 width but keeps t scalar', () => {
    // mix(a, b, t): a=input0 (vec3), b=input1 (scalar), t=input2 (scalar).
    const line = buildBuiltin('Mix', ['3', '1', '2']);
    expect(line).toContain('mix(');
    expect(line).toContain('node_3');
    expect(line).toContain('vec3<f32>(node_1)'); // endpoint widened
    expect(line).toContain('node_2'); // blend factor stays scalar
    expect(line).not.toContain('vec3<f32>(node_2)');
  });

  it('Mod coerces the scalar divisor to the vec3 dividend width', () => {
    const line = buildBuiltin('Mod', ['3', '1']);
    expect(line).toContain('node_3');
    expect(line).toContain('vec3<f32>(node_1)');
  });
});
