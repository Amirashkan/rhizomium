// Regression tests for a CustomGLSL body written the way a shader function is
// written — ending in `return <expr>;`.
//
// Bug: the compiler splices a node's body into an assignment, `node_<id> =
// <expr>`, and reduced the last line to an expression only when it was bare or
// a `let`/`var` declaration. A `return` was left where it stood, so the body
//
//   let a = uv.x;
//   return vec4<f32>(a, 0.0, 0.0, 1.0);
//
// compiled to `node_beam = return vec4<f32>(...)`. That is not WGSL: the
// shader failed to build, every pipeline downstream was invalidated, and the
// node went black behind a parse error that named the generated line rather
// than anything the author had written.
//
// Second bug on the same path: the block form declared the holding variable as
// `var node_x: vec4`, and `vec4` alone names no type in WGSL — the element
// type is part of the name. The shorthand is right for a constructor and wrong
// after a colon.

import { describe, it, expect } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';

function shaderFor(code, outputType = 'vec4') {
  const graph = {
    nodes: [
      { id: 'beam', kind: 'CustomGLSL', params: { code, outputType }, inputs: [] },
      { id: '9', kind: 'OutputFinal', params: {}, inputs: ['beam'] },
    ],
    connections: [],
  };
  const result = buildWGSL(graph);
  return typeof result === 'string' ? result : (result.wgsl || result.code || '');
}

describe('a CustomGLSL body that returns its value', () => {
  it('assigns what the return returns, not the return itself', () => {
    const wgsl = shaderFor('let a = uv.x;\nlet b = uv.y;\nreturn vec4<f32>(a, b, 0.0, 1.0);');

    expect(wgsl).not.toMatch(/=\s*return\b/);
    expect(wgsl).toMatch(/node_beam = vec4<f32>\(temp_beam_0, temp_beam_1, 0\.0, 1\.0\);/);
  });

  it('handles a one-line body that returns', () => {
    const wgsl = shaderFor('return vec4<f32>(uv, 0.0, 1.0);');
    expect(wgsl).not.toMatch(/=\s*return\b/);
    expect(wgsl).toMatch(/node_beam = vec4<f32>\(in\.uv, 0\.0, 1\.0\)/);
  });

  it('declares the holding variable with a type WGSL has', () => {
    const wgsl = shaderFor('var acc = 0.0;\nfor (var i = 0; i < 3; i++) { acc += 1.0; }\nreturn vec4<f32>(acc, 0.0, 0.0, 1.0);');

    // `var node_beam: vec4` names no type; the element type is part of the name.
    expect(wgsl).not.toMatch(/var node_beam:\s*vec\d\s*=/);
    expect(wgsl).toMatch(/var node_beam:\s*vec4<f32>/);
  });

  it('still reads a body that ends in a bare expression', () => {
    const wgsl = shaderFor('let a = uv.x;\nvec4<f32>(a, 0.0, 0.0, 1.0)');
    expect(wgsl).toMatch(/node_beam = vec4<f32>\(temp_beam_0, 0\.0, 0\.0, 1\.0\)/);
  });

  it('still reads a body that ends in a declaration', () => {
    const wgsl = shaderFor('let a = uv.x;\nlet out = vec4<f32>(a, 0.0, 0.0, 1.0);');
    expect(wgsl).not.toMatch(/=\s*let\b/);
    expect(wgsl).toMatch(/vec4<f32>\(temp_beam_0, 0\.0, 0\.0, 1\.0\)/);
  });
});
