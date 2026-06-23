// Regression tests for the CustomGLSL node in fragment shader codegen.
//
// Bug: while the user is still typing in the CustomGLSL code editor, the live
// recompile sees half-finished expressions. A trailing operator like "input0 +"
// was emitted verbatim as `let node_31 = (0.0)+;`, an unclosed "sin(input0" as
// `let node_31 = sin((0.0);`, etc. WebGPU rejects this WGSL and floods the
// console with shader-compile errors on every keystroke
// ("unable to parse right side of + expression").
//
// The compiler must instead emit a harmless default of the declared output type
// until the expression is finished, keeping the shader compilable.

import { describe, it, expect } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';

function lineForCustomGLSL(code, outputType = 'f32') {
  const graph = {
    nodes: [
      { id: '31', kind: 'CustomGLSL', params: { code, outputType }, inputs: [] },
      { id: '99', kind: 'OutputFinal', params: {}, inputs: ['31'] },
    ],
    connections: [],
  };
  const result = buildWGSL(graph);
  const wgsl = typeof result === 'string' ? result : (result.wgsl || result.code || '');
  // Collapse the node's (possibly multi-line) compiled block to inspect it.
  return wgsl.split('\n').filter((l) => l.includes('node_31')).join('\n');
}

// A balanced-delimiter, no-dangling-operator string is the minimum bar for the
// generated WGSL not to be a parse error.
function isStructurallyComplete(line) {
  const open = (line.match(/\(/g) || []).length;
  const close = (line.match(/\)/g) || []).length;
  if (open !== close) return false;
  if (/[+\-*/%&|^=]\s*;/.test(line)) return false; // dangling binary operator
  return true;
}

describe('CustomGLSL codegen', () => {
  it('compiles a complete expression normally', () => {
    const line = lineForCustomGLSL('input0 * 2.0');
    expect(line).toContain('node_31');
    expect(isStructurallyComplete(line)).toBe(true);
  });

  it('does not emit a dangling operator for a half-typed expression (input0 +)', () => {
    const line = lineForCustomGLSL('input0 +');
    // The reported bug: `let node_31 = (0.0)+;`
    expect(line).not.toMatch(/[+\-*/%&|^=]\s*;/);
    expect(isStructurallyComplete(line)).toBe(true);
  });

  it('does not emit unbalanced parentheses for an unclosed call (sin(input0)', () => {
    const line = lineForCustomGLSL('sin(input0');
    expect(isStructurallyComplete(line)).toBe(true);
  });

  it('does not emit an unfinished member access (input0.)', () => {
    const line = lineForCustomGLSL('input0.');
    expect(line).not.toMatch(/[)\]a-zA-Z_]\.\s*;/);
    expect(isStructurallyComplete(line)).toBe(true);
  });

  it('falls back to a default matching the declared output type', () => {
    const line = lineForCustomGLSL('input0 +', 'vec3');
    expect(isStructurallyComplete(line)).toBe(true);
    // vec3 output must still declare a vec3-typed value, not a bare scalar that
    // would mismatch the registered output type downstream.
    expect(line).toContain('vec3<f32>');
  });

  it('still compiles a valid multi-line expression', () => {
    const line = lineForCustomGLSL('let a = input0 * 2.0;\na + 1.0');
    expect(isStructurallyComplete(line)).toBe(true);
    expect(line).not.toMatch(/[+\-*/%&|^=]\s*;/);
  });
});

// The Expression (Expr) node does the same a/b string substitution and so shares
// the exact same half-typed-expression hazard ("a +" -> `let node_12 = (0.0)+;`).
function lineForExpr(expr) {
  const graph = {
    nodes: [
      { id: '12', kind: 'Expr', expr, params: {}, inputs: [] },
      { id: '99', kind: 'OutputFinal', params: {}, inputs: ['12'] },
    ],
    connections: [],
  };
  const result = buildWGSL(graph);
  const wgsl = typeof result === 'string' ? result : (result.wgsl || result.code || '');
  return wgsl.split('\n').filter((l) => l.includes('node_12')).join('\n');
}

describe('Expr codegen', () => {
  it('compiles a complete expression normally', () => {
    const line = lineForExpr('a + b');
    expect(line).toContain('node_12');
    expect(isStructurallyComplete(line)).toBe(true);
  });

  it('does not emit a dangling operator for a half-typed expression (a +)', () => {
    const line = lineForExpr('a +');
    expect(line).not.toMatch(/[+\-*/%&|^=]\s*;/);
    expect(isStructurallyComplete(line)).toBe(true);
  });

  it('does not emit unbalanced parentheses for an unclosed call (sin(a)', () => {
    const line = lineForExpr('sin(a');
    expect(isStructurallyComplete(line)).toBe(true);
  });
});
