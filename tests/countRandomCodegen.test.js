// Codegen for the Count and Random input nodes.
//
// Count has no shader-expressible memory (like Hold): its running value is computed on the CPU by
// CountNodeProcessor and streamed in via the "<id>.count" uniform, so the compiler just reads the
// uniform reference that getParam returns. Random is a self-contained clock-driven hash.

import { describe, it, expect } from 'vitest';
import { InputNodes } from '../src/codegen/compilers/InputNodes.js';

describe('Count node codegen', () => {
  const compiler = new InputNodes();

  it('reads the count uniform that getParam registers', () => {
    const node = { id: '5', kind: 'Count', params: {} };
    const getParam = (name) => (name === 'count' ? 'u_params._5_count' : '0.0');
    const result = compiler.compile(node, () => '0.0', getParam);
    expect(result.line).toBe('let node_5 = u_params._5_count;');
    expect(result.outputType).toBe('f32');
  });

  it('falls back to a 0/1 pulse gate when no uniform manager is available', () => {
    const node = { id: '6', kind: 'Count', params: { threshold: 0.5 } };
    const result = compiler.compile(node, () => 'in_pulse', null);
    expect(result.line).toBe('let node_6 = select(0.0, 1.0, in_pulse >= 0.500000);');
    expect(result.outputType).toBe('f32');
  });
});

describe('Random Value node codegen', () => {
  const compiler = new InputNodes();

  it('emits a clock-driven fract(sin(...)) hash in [0,1] driven by the speed uniform', () => {
    // getParam registers numeric params as live uniforms; speed flows through as a uniform ref.
    const node = { id: '9', kind: 'RandomValue', params: { speed: 2 } };
    const getParam = (name) => (name === 'speed' ? 'u_params._9_speed' : '0.0');
    const result = compiler.compile(node, () => null, getParam);
    expect(result.line).toBe('let node_9 = fract(sin(g.time * u_params._9_speed * 12.9898) * 43758.5453);');
    expect(result.outputType).toBe('f32');
  });

  it('bakes the numeric speed literal when no uniform registration is available', () => {
    const node = { id: '3', kind: 'RandomValue', params: { speed: 2 } };
    const result = compiler.compile(node, () => null, null);
    expect(result.line).toBe('let node_3 = fract(sin(g.time * 2.000000 * 12.9898) * 43758.5453);');
  });
});
