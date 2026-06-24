// Regression test: referencing a Time / RandomTime node from a parameter (e.g. a Transform param)
// must animate on the GPU at 60fps, exactly like the built-in `=time` expression.
//
// Bug: a node reference is stored as `=node_<id>`, which contains no literal "time". The shader
// generator emitted the identifier `node_<id>` verbatim — but a *referenced* (not wired) node is
// never declared in the shader, so the WGSL failed to compile and the value froze / snapped back.
// Meanwhile `=time` worked because it maps to the GPU clock `g.time`.
//
// Fix: generateShader resolves `node_<id>` references to Time/RandomTime nodes to their GPU
// expression (g.time / the RandomTime formula), so the shader compiles and animates from the clock.

import { describe, it, expect } from 'vitest';
import { unifiedExpressionSystem } from '../src/utils/UnifiedExpressionSystem.js';

describe('generateShader resolves Time/RandomTime node references to the GPU clock', () => {
  const timeGraph = { nodes: [{ id: 5, kind: 'Time', params: {} }] };

  it('compiles a bare Time node reference to g.time (same as =time)', () => {
    expect(unifiedExpressionSystem.generateShader('=node_5', {}, timeGraph)).toBe('g.time');
    expect(unifiedExpressionSystem.generateShader('=time', {}, timeGraph)).toBe('g.time');
  });

  it('compiles a Time reference inside a larger expression', () => {
    expect(unifiedExpressionSystem.generateShader('=node_5 * 2', {}, timeGraph)).toBe('(g.time * 2.0)');
    expect(unifiedExpressionSystem.generateShader('=sin(node_5)', {}, timeGraph)).toBe('sin(g.time)');
  });

  it('compiles a RandomTime reference to the GPU random formula (mirrors InputNodes codegen)', () => {
    const graph = { nodes: [{ id: 7, kind: 'RandomTime', params: { speed: 2 } }] };
    expect(unifiedExpressionSystem.generateShader('=node_7', {}, graph))
      .toBe('fract(sin(g.time * 2.0 * 12.9898) * 43758.5453)');
  });

  it('defaults RandomTime speed to 1.0 when unset', () => {
    const graph = { nodes: [{ id: 7, kind: 'RandomTime', params: {} }] };
    expect(unifiedExpressionSystem.generateShader('=node_7', {}, graph))
      .toBe('fract(sin(g.time * 1.0 * 12.9898) * 43758.5453)');
  });

  it('matches the kind case-insensitively', () => {
    const graph = { nodes: [{ id: 5, kind: 'time', params: {} }] };
    expect(unifiedExpressionSystem.generateShader('=node_5', {}, graph)).toBe('g.time');
  });

  it('leaves references to non-time nodes untouched (out of scope here)', () => {
    const graph = { nodes: [{ id: 9, kind: 'ConstFloat', params: { value: 3 } }] };
    expect(unifiedExpressionSystem.generateShader('=node_9', {}, graph)).toBe('node_9');
  });

  it('does not crash when no graph is available', () => {
    expect(unifiedExpressionSystem.generateShader('=node_5', {}, null)).toBe('node_5');
  });
});
