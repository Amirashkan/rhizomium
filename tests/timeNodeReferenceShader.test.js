// Regression test: referencing a Time node from a parameter (e.g. a Transform param)
// must animate on the GPU at 60fps, exactly like the built-in `=time` expression.
//
// Bug: a node reference is stored as `=node_<id>`, which contains no literal "time". The shader
// generator emitted the identifier `node_<id>` verbatim — but a *referenced* (not wired) node is
// never declared in the shader, so the WGSL failed to compile and the value froze / snapped back.
// Meanwhile `=time` worked because it maps to the GPU clock `g.time`.
//
// Fix: generateShader resolves `node_<id>` references to Time nodes to their GPU
// expression (g.time), so the shader compiles and animates from the clock.

import { describe, it, expect } from 'vitest';
import { unifiedExpressionSystem } from '../src/utils/UnifiedExpressionSystem.js';

describe('generateShader resolves Time node references to the GPU clock', () => {
  const timeGraph = { nodes: [{ id: 5, kind: 'Time', params: {} }] };

  it('compiles a bare Time node reference to g.time (same as =time)', () => {
    expect(unifiedExpressionSystem.generateShader('=node_5', {}, timeGraph)).toBe('g.time');
    expect(unifiedExpressionSystem.generateShader('=time', {}, timeGraph)).toBe('g.time');
  });

  it('compiles a Time reference inside a larger expression', () => {
    expect(unifiedExpressionSystem.generateShader('=node_5 * 2', {}, timeGraph)).toBe('(g.time * 2.0)');
    expect(unifiedExpressionSystem.generateShader('=sin(node_5)', {}, timeGraph)).toBe('sin(g.time)');
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

// Regression test: referencing a Mouse node from a parameter (e.g. =node_3_x) must read the live
// GPU mouse global, mirroring a wired Mouse node which compiles to `g.mouse` (see InputNodes.js).
//
// Bug: a Mouse node reference (`=node_3_x`) was not resolved by the shader generator — only
// Time was. The undefined identifier `node_3_x` made the generator fall back to `0.0`,
// so the parameter (and everything downstream of it) rendered as 0 regardless of cursor position.
describe('generateShader resolves Mouse node references to the GPU mouse global', () => {
  const mouseGraph = { nodes: [{ id: 3, kind: 'Mouse', params: {} }] };

  it('compiles a component reference to the matching g.mouse channel', () => {
    expect(unifiedExpressionSystem.generateShader('=node_3_x', {}, mouseGraph)).toBe('g.mouse.x');
    expect(unifiedExpressionSystem.generateShader('=node_3_y', {}, mouseGraph)).toBe('g.mouse.y');
    expect(unifiedExpressionSystem.generateShader('=node_3_z', {}, mouseGraph)).toBe('g.mouse.z');
    expect(unifiedExpressionSystem.generateShader('=node_3_w', {}, mouseGraph)).toBe('g.mouse.w');
  });

  it('compiles a bare Mouse node reference to the whole vec4', () => {
    expect(unifiedExpressionSystem.generateShader('=node_3', {}, mouseGraph)).toBe('g.mouse');
  });

  it('resolves a Mouse component inside a larger expression', () => {
    expect(unifiedExpressionSystem.generateShader('=node_3_x * 2', {}, mouseGraph)).toBe('(g.mouse.x * 2.0)');
    expect(unifiedExpressionSystem.generateShader('=sin(node_3_y)', {}, mouseGraph)).toBe('sin(g.mouse.y)');
  });

  it('matches the kind case-insensitively', () => {
    const graph = { nodes: [{ id: 3, kind: 'mouse', params: {} }] };
    expect(unifiedExpressionSystem.generateShader('=node_3_x', {}, graph)).toBe('g.mouse.x');
  });
});

// Same story for the Wave node (a free-running LFO): a parameter that REFERENCES one is the main
// way it gets used, so `=node_<id>` has to resolve to the wave's GPU expression. Its params aren't
// GPU globals in this path, so their current values are baked in — see
// _buildInputNodeReferenceMapping.
describe('generateShader resolves Wave node references to the wave expression', () => {
  it('compiles a reference to the clock-driven wave', () => {
    const graph = { nodes: [{ id: 7, kind: 'Wave', params: { shape: 'Sine', frequency: 2 } }] };
    const shader = unifiedExpressionSystem.generateShader('=node_7', {}, graph);
    expect(shader).toContain('g.time');
    expect(shader).toContain('sin(');
    expect(shader).toContain('2.0');
    expect(shader).not.toBe('0.0');
  });

  it('bakes the selected shape, not just the sine', () => {
    const graph = { nodes: [{ id: 7, kind: 'Wave', params: { shape: 'Square', pulseWidth: 0.25 } }] };
    const shader = unifiedExpressionSystem.generateShader('=node_7', {}, graph);
    expect(shader).toContain('select(');
    expect(shader).toContain('0.25');
  });

  it('resolves a Wave reference inside a larger expression', () => {
    const graph = { nodes: [{ id: 7, kind: 'Wave', params: {} }] };
    const shader = unifiedExpressionSystem.generateShader('=node_7 * 0.5', {}, graph);
    expect(shader).toContain('g.time');
    expect(shader).toContain('* 0.5');
  });

  it('matches the kind case-insensitively', () => {
    const graph = { nodes: [{ id: 7, kind: 'wave', params: {} }] };
    expect(unifiedExpressionSystem.generateShader('=node_7', {}, graph)).toContain('g.time');
  });
});
