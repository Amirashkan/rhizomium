// Alt-dragging a number in the Custom GLSL editor used to recompile the whole shader on every step,
// dropping the editor under 5 fps. Arming a node compiles its float literals as uniforms once, so a
// drag is a uniform write, and the code is stored on release without another rebuild.

import { describe, it, expect, afterEach } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';
import {
  scanLiveLiterals, armLiveLiterals, disarmLiveLiterals, rejectLiveIntegers, liveLiteralsFor, MAX_LIVE_LITERALS,
} from '../src/codegen/liveCodeLiterals.js';
import { findNumbers } from '../src/ui/components/codeNumberScrub.js';

function build(node) {
  const graph = {
    nodes: [node, { id: '99', kind: 'OutputFinal', params: {}, inputs: ['31'] }],
    connections: [],
  };
  const result = buildWGSL(graph);
  const wgsl = typeof result === 'string' ? result : (result.wgsl || result.code || '');
  return { wgsl, line: wgsl.split('\n').filter((l) => l.includes('node_31 =')).join('\n') };
}

const arm = (node) => armLiveLiterals(node, node.params.code);
const customNode = (code) => ({ id: '31', kind: 'CustomGLSL', params: { code, outputType: 'f32' }, inputs: [] });

describe('Custom GLSL live literals', () => {
  let node;
  afterEach(() => disarmLiveLiterals(node));

  it('compiles every float literal of an armed node as a uniform', () => {
    node = customNode('sin(uv.x * 10.5) * 0.25 + 2');
    arm(node);
    const { line, wgsl } = build(node);
    expect(line).not.toContain('10.5');
    expect(line).not.toContain('0.25');
    expect(line).not.toMatch(/\+ 2\b/);
    expect(line).toMatch(/u_params\._31_liveLiteral0/);
    expect(line).toMatch(/u_params\._31_liveLiteral2/);
    expect(line).not.toContain('rz_live_literal');
    expect(wgsl).toMatch(/_31_liveLiteral1\s*:\s*f32/);
  });

  it('compiles the same shader whatever values the literals hold', () => {
    node = customNode('input0 * 0.5 + 1.0');
    arm(node);
    const before = build(node).wgsl;
    node.params.code = 'input0 * -0.73 + 1.0';
    expect(build(node).wgsl).toBe(before);
  });

  it('bakes the literals again once the code changes shape', () => {
    node = customNode('input0 * 0.5');
    arm(node);
    node.params.code = 'input0 * 0.8 + uv.x';
    const { line } = build(node);
    expect(line).toContain('0.8');
    expect(line).not.toMatch(/liveLiteral/);
  });

  it('casts suffixed integer literals', () => {
    node = customNode('f32(abs(-3i)) * input0');
    arm(node);
    expect(build(node).line).toMatch(/i32\(u_params\._31_liveLiteral0\)/);
  });

  it('re-arms without integers once their typing is rejected', () => {
    node = customNode('input0 * 0.5 + 2');
    arm(node);
    expect(rejectLiveIntegers(node, node.params.code).literals.map((l) => l.text)).toEqual(['0.5']);
    expect(build(node).line).toMatch(/\+ 2\b/);
    // The same shape is armed without integers from then on.
    expect(arm(node).literals.map((l) => l.text)).toEqual(['0.5']);
    expect(rejectLiveIntegers(node, node.params.code)).toBeUndefined();
    expect(liveLiteralsFor(node, 'input0 * 0.9 + 2')).not.toBeNull();
  });

  it('leaves an unarmed node baked', () => {
    node = customNode('input0 * 0.5');
    expect(build(node).line).toContain('0.5');
  });
});

describe('scanLiveLiterals', () => {
  it('skips comments and caps the count', () => {
    expect(scanLiveLiterals('x * 0.5 // 0.25').literals.map((l) => l.text)).toEqual(['0.5']);
    const many = Array.from({ length: MAX_LIVE_LITERALS + 1 }, (_, i) => `${i}.5`).join(' + ');
    expect(scanLiveLiterals(many)).toBeNull();
  });

  it('finds every number in order', () => {
    expect(findNumbers('a(1.0, -2.5)\nb * 3 // 4').map((n) => n.text)).toEqual(['1.0', '-2.5', '3']);
  });
});

describe('literal types', () => {
  const casts = (code) => Object.fromEntries((scanLiveLiterals(code)?.literals || []).map((l) => [`${l.start}:${l.text}`, l.cast]));
  // The first standalone occurrence of `needle` (not the `3` of `f32`).
  const castOf = (code, needle) => {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const start = new RegExp(`(?<![\\w.])${escaped}(?![\\w.])`).exec(code)?.index;
    const literal = (scanLiveLiterals(code)?.literals || []).find((l) => l.start === start);
    return literal ? literal.cast : null;
  };

  it('types floats and suffixed integers by their own spelling', () => {
    expect(castOf('x * 0.5', '0.5')).toBe('f32');
    expect(castOf('x * 1e3', '1e3')).toBe('f32');
    expect(castOf('x * 2.0f', '2.0f')).toBe('f32');
    expect(castOf('i < 4i', '4i')).toBe('i32');
    expect(castOf('i < 4u', '4u')).toBe('u32');
  });

  it('reads an unsuffixed integer as f32 in float math', () => {
    expect(castOf('sin(x * 10)', '10')).toBe('f32');
    expect(castOf('pow(x, 2) + 1', '2')).toBe('f32');
    expect(castOf('vec3<f32>(1, 0, 0)', '1')).toBe('f32');
    expect(castOf('f32(i) * 3', '3')).toBe('f32');
  });

  it('reads an unsuffixed integer as an integer where the code needs one', () => {
    const loop = 'var s = 0.0;\nfor (var i = 0; i < 8; i++) { s += f32(i); }\ns';
    expect(castOf(loop, '0')).toBe('i32');
    expect(castOf(loop, '8')).toBe('i32');
    expect(castOf('let n = 5;\nlet k = n * 2;\nf32(k)', '2')).toBe('i32');
    expect(castOf('let a = arr[2];', '2')).toBe('i32');
    expect(castOf('let b = i32(x) % 3;', '3')).toBe('i32');
    expect(castOf('let c = u >> 1;', '1')).toBe('u32');
    expect(castOf('var j: u32 = 4;', '4')).toBe('u32');
    expect(castOf('var y: f32 = 4;', '4')).toBe('f32');
  });

  it('keeps f16 literals, constants and type sizes baked', () => {
    expect(castOf('x * 2.0h', '2.0h')).toBeNull();
    expect(castOf('const k = 0.5;\nk', '0.5')).toBeNull();
    expect(castOf('var a: array<f32, 4>;', '4')).toBeNull();
    expect(casts('// 3.0 in a comment\nx')).toEqual({});
  });
});
