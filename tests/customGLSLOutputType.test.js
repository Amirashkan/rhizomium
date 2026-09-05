// Regression tests for the CustomGLSL node's reported output type.
//
// Bug: the node reported whatever its `outputType` parameter said — "f32" by default — no matter
// what its body evaluated to. A body like `uv * 2.0` is a vec2, so the consumer converted a vec2
// as if it were a scalar and emitted `finalColor = vec3<f32>(node_7);`. That is not a vec3
// constructor WGSL has ("no matching constructor for 'vec3<f32>(vec2<f32>)'"), so the whole
// fragment shader failed to compile and the node's output went permanently black.
//
// The compiler must register the type the body actually evaluates to, falling back to the declared
// type only where the code cannot be understood.

import { describe, it, expect } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';
import { inferExpressionType, inferBodyType } from '../src/codegen/compilers/wgslExprType.js';

function shaderFor(code, outputType = 'f32') {
  const graph = {
    nodes: [
      { id: '7', kind: 'CustomGLSL', params: { code, outputType }, inputs: [] },
      { id: '9', kind: 'OutputFinal', params: {}, inputs: ['7'] },
    ],
    connections: [],
  };
  const result = buildWGSL(graph);
  return typeof result === 'string' ? result : (result.wgsl || result.code || '');
}

function finalColorAssignment(wgsl) {
  return wgsl.split('\n').find((line) => /^\s*finalColor\s*=/.test(line)).trim();
}

describe('CustomGLSL output type', () => {
  it('feeds a vec2 body into finalColor with a constructor that exists', () => {
    const assignment = finalColorAssignment(shaderFor('uv * 2.0'));
    // The reported bug: `finalColor = vec3<f32>(node_7);` — vec3 has no vec2 constructor.
    expect(assignment).not.toMatch(/vec3<f32>\(node_7\)/);
    expect(assignment).toContain('node_7.x');
  });

  it('still widens a scalar body to vec3, whatever the node declares', () => {
    const assignment = finalColorAssignment(shaderFor('length(uv)', 'vec3'));
    expect(assignment).toBe('finalColor = vec3<f32>(node_7);');
  });

  it('passes a vec3 body straight through', () => {
    const assignment = finalColorAssignment(shaderFor('vec3<f32>(uv, 0.0)'));
    expect(assignment).toBe('finalColor = node_7;');
  });

  it('infers through the locals a multi-line body declares', () => {
    const assignment = finalColorAssignment(shaderFor('let p = uv - 0.5;\nlet d = length(p);\nvec3<f32>(d, d, d)'));
    expect(assignment).toBe('finalColor = node_7;');
  });

  it('keeps the declared type when the body cannot be understood', () => {
    // someHelper() is not a name the inference knows, so nothing is assumed about it.
    const wgsl = shaderFor('someHelper(uv)', 'vec3');
    expect(finalColorAssignment(wgsl)).toBe('finalColor = node_7;');
  });
});

describe('inferExpressionType', () => {
  const env = new Map([['uv', 'vec2'], ['col', 'vec3'], ['t', 'f32']]);

  it.each([
    ['uv * 2.0', 'vec2'],
    ['2.0 * uv', 'vec2'],
    ['-uv', 'vec2'],
    ['uv.x', 'f32'],
    ['uv.xy', 'vec2'],
    ['col.rgb', 'vec3'],
    ['uv[0]', 'f32'],
    ['length(uv)', 'f32'],
    ['distance(uv, vec2<f32>(0.5))', 'f32'],
    ['dot(col, col)', 'f32'],
    ['cross(col, col)', 'vec3'],
    ['normalize(uv)', 'vec2'],
    ['vec4<f32>(col, 1.0)', 'vec4'],
    ['vec3(1.0)', 'vec3'],
    ['mix(col, col, t)', 'vec3'],
    ['smoothstep(0.0, 1.0, uv)', 'vec2'],
    ['sin(t) * uv + vec2<f32>(1.0)', 'vec2'],
    ['(uv - 0.5) * 2.0', 'vec2'],
    ['f32(1)', 'f32'],
    ['1.0', 'f32'],
  ])('types %s as %s', (expression, expected) => {
    expect(inferExpressionType(expression, env)).toBe(expected);
  });

  it.each([
    ['unknownName * 2.0'],          // nothing known about the name
    ['someHelper(uv)'],             // a user-defined function
    ['t < 1.0'],                    // a bool, not a type this speaks
    ['i32(t)'],                     // an integer, not a type this speaks
    ['uv +'],                       // unfinished
    ['sin(uv'],                     // unbalanced
    ['uv.q'],                       // not a swizzle
  ])('gives up on %s', (expression) => {
    expect(inferExpressionType(expression, env)).toBe(null);
  });
});

describe('inferBodyType', () => {
  const env = new Map([['uv', 'vec2']]);

  it('carries let declarations into the final expression', () => {
    expect(inferBodyType(['let p = uv * 2.0;', 'p + 1.0'], env)).toBe('vec2');
  });

  it('honours an explicit type annotation on a declaration', () => {
    expect(inferBodyType(['var acc: vec3<f32> = vec3<f32>(0.0);', 'acc'], env)).toBe('vec3');
  });

  it('gives up when a local it could not type is used', () => {
    expect(inferBodyType(['let p = someHelper(uv);', 'p * 2.0'], env)).toBe(null);
  });

  it('gives up on an empty body', () => {
    expect(inferBodyType([], env)).toBe(null);
  });
});
