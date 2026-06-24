// Regression tests for the Switch node's `select` parameter.
//
// Background: the Switch chooses one of four inputs (A-D) via a `select` parameter.
// To save work, a *constant* select compiles only the chosen branch. But when
// `select` is driven by a node reference or expression (e.g. a Float node fed in as
// "=node_1", or "=sin(time)"), the branch is only known at runtime. The old codegen
// did `Math.floor(node.params.select)`, which turned "=node_1" into NaN, selected no
// branch, and emitted a black `vec3<f32>(0.0)` — the editor showed only black.
//
// The fix compiles all four inputs and selects the active branch at runtime when
// `select` is dynamic, while keeping the single-branch optimization for constants.

import { describe, it, expect } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';

function compile(graph) {
  const result = buildWGSL(graph);
  return typeof result === 'string' ? result : (result.wgsl || result.code || '');
}

describe('Switch dynamic select codegen', () => {
  it('a node reference in `select` drives a runtime selection instead of black', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'ConstFloat', params: { value: 1.0 }, inputs: [] },
        { id: '3', kind: 'ConstVec3', params: { x: 1, y: 0, z: 0 }, inputs: [] },
        { id: '4', kind: 'ConstVec3', params: { x: 0, y: 1, z: 0 }, inputs: [] },
        { id: '2', kind: 'Switch', params: { select: '=node_1' }, inputs: ['3', '4', null, null] },
        { id: '9', kind: 'OutputFinal', params: {}, inputs: ['2'] },
      ],
      connections: [],
    };
    const code = compile(graph);
    // Must NOT collapse to the black fallback.
    expect(code).not.toMatch(/let node_2 = vec3<f32>\(0\.0\);/);
    // Runtime index derived from the referenced node, then a select() chain over inputs.
    expect(code).toMatch(/let sel_2 = i32\(round\(f32\(node_1\)\)\);/);
    expect(code).toMatch(/let node_2 = select\(select\(select\(node_3, node_4, sel_2 == 1\)/);
  });

  it('an animated expression in `select` compiles to the GPU clock', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'ConstFloat', params: { value: '=sin(time)' }, inputs: [] },
        { id: '2', kind: 'Switch', params: { select: '=node_1' }, inputs: [null, null, null, null] },
        { id: '9', kind: 'OutputFinal', params: {}, inputs: ['2'] },
      ],
      connections: [],
    };
    const code = compile(graph);
    expect(code).toMatch(/g\.time/);
    expect(code).toMatch(/let sel_2 = i32\(round\(/);
  });

  it('a constant `select` keeps the single-branch optimization', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'ConstFloat', params: { value: 0.5 }, inputs: [] },
        { id: '2', kind: 'Switch', params: { select: 0 }, inputs: ['1', null, null, null] },
        { id: '9', kind: 'OutputFinal', params: {}, inputs: ['2'] },
      ],
      connections: [],
    };
    const code = compile(graph);
    expect(code).toMatch(/let node_2 = node_1;/);
    expect(code).not.toMatch(/sel_2/);
  });
});
