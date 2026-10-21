// Alt-dragging a number in the Custom GLSL editor used to recompile the whole shader on every step,
// dropping the editor under 5 fps. Arming a node compiles its float literals as uniforms once, so a
// drag is a uniform write, and the code is stored on release without another rebuild.

import { describe, it, expect, afterEach } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';
import {
  scanLiveLiterals, armLiveLiterals, disarmLiveLiterals, MAX_LIVE_LITERALS,
} from '../src/codegen/liveCodeLiterals.js';
import { findNumberAt, findNumbers, uniformCastFor } from '../src/ui/components/codeNumberScrub.js';

function build(node) {
  const graph = {
    nodes: [node, { id: '99', kind: 'OutputFinal', params: {}, inputs: ['31'] }],
    connections: [],
  };
  const result = buildWGSL(graph);
  const wgsl = typeof result === 'string' ? result : (result.wgsl || result.code || '');
  return { wgsl, line: wgsl.split('\n').filter((l) => l.includes('node_31 =')).join('\n') };
}

const arm = (node) => armLiveLiterals(node, scanLiveLiterals(node.params.code).skeleton);
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
    expect(line).toContain('2'); // an abstract integer stays a literal
    expect(line).toMatch(/u_params\._31_liveLiteral0/);
    expect(line).toMatch(/u_params\._31_liveLiteral1/);
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

describe('uniformCastFor', () => {
  const cast = (text, needle) => uniformCastFor(text, findNumberAt(text, text.indexOf(needle)));

  it('swaps floats and suffixed integers', () => {
    expect(cast('x * 0.5', '0.5')).toBe('f32');
    expect(cast('x * 1e3', '1e3')).toBe('f32');
    expect(cast('x * 2.0f', '2.0f')).toBe('f32');
    expect(cast('i < 4i', '4i')).toBe('i32');
    expect(cast('i < 4u', '4u')).toBe('u32');
  });

  it('keeps abstract integers, f16 and constant initialisers as literals', () => {
    expect(cast('x * 2', '2')).toBeNull();
    expect(cast('x * 2.0h', '2.0h')).toBeNull();
    expect(cast('const k = 0.5;\nk', '0.5')).toBeNull();
  });
});
