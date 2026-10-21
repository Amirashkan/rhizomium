// Alt-dragging a number in the Custom GLSL editor used to recompile the whole shader on every step,
// dropping the editor under 5 fps. While a drag lasts, the dragged literal now compiles as a uniform
// (so each step is a buffer write) and is baked back into the code on release.

import { describe, it, expect, afterEach } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';
import { setLiveLiteral, clearLiveLiteral } from '../src/codegen/liveCodeLiterals.js';
import { findNumberAt, uniformCastFor } from '../src/ui/components/codeNumberScrub.js';

function build(node) {
  const graph = {
    nodes: [node, { id: '99', kind: 'OutputFinal', params: {}, inputs: ['31'] }],
    connections: [],
  };
  const result = buildWGSL(graph);
  const wgsl = typeof result === 'string' ? result : (result.wgsl || result.code || '');
  return { wgsl, line: wgsl.split('\n').filter((l) => l.includes('node_31 =')).join('\n') };
}

function startDrag(node, needle) {
  const code = node.params.code;
  const number = findNumberAt(code, code.indexOf(needle));
  const cast = uniformCastFor(code, number);
  setLiveLiteral(node, { prefix: code.slice(0, number.start), suffix: code.slice(number.end), cast, value: number.value });
  return number;
}

const customNode = (code) => ({ id: '31', kind: 'CustomGLSL', params: { code, outputType: 'f32' }, inputs: [] });

describe('Custom GLSL live literal', () => {
  let node;
  afterEach(() => clearLiveLiteral(node));

  it('compiles the dragged literal as a uniform and keeps the rest of the code', () => {
    node = customNode('sin(uv.x * 10.5) * 0.25');
    startDrag(node, '0.25');
    const { line, wgsl } = build(node);
    expect(line).toContain('10.5');
    expect(line).not.toContain('0.25');
    expect(line).toMatch(/u_params\._31_liveLiteral/);
    expect(line).not.toContain('rz_live_literal');
    expect(wgsl).toMatch(/_31_liveLiteral\s*:\s*f32/);
  });

  it('compiles the same shader whatever value the literal is dragged to', () => {
    node = customNode('input0 * 0.5 + 1.0');
    startDrag(node, '0.5');
    const before = build(node).wgsl;
    node.params.code = 'input0 * 0.73 + 1.0';
    expect(build(node).wgsl).toBe(before);
  });

  it('bakes the literal back once the drag ends', () => {
    node = customNode('input0 * 0.5');
    startDrag(node, '0.5');
    node.params.code = 'input0 * 0.8';
    clearLiveLiteral(node);
    const { line } = build(node);
    expect(line).toContain('0.8');
    expect(line).not.toMatch(/liveLiteral/);
  });

  it('casts suffixed integer literals', () => {
    node = customNode('f32(abs(-3i)) * input0');
    startDrag(node, '3i');
    expect(build(node).line).toMatch(/i32\(u_params\._31_liveLiteral\)/);
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
