import { describe, it, expect } from 'vitest';
import { GraphProcessor } from '../src/codegen/processors/GraphProcessor.js';

// Texture 2D -> Multiply -> Warp -> Mix, with Mix wired back into Multiply. Multiply reads Mix
// in the fragment shader as Mix's output texture, so Mix's `let` must come first; before the
// fix Multiply was emitted ahead of it and compiled `vec4<f32>(vec3<f32>(0.0))` for that input.
describe('topologicalSort with a feedback loop through compute nodes', () => {
  const tex = { id: '4', kind: 'Texture2D', inputs: [] };
  const noise = { id: '5', kind: 'ComputeNoise', inputs: [] };
  const mul = { id: '8', kind: 'Multiply', inputs: ['4', '7'] };
  const warp = { id: '6', kind: 'ComputeWarp', inputs: ['8', '5'] };
  const mix = { id: '7', kind: 'ComputeMix', inputs: ['6', '5'] };
  const order = (nodes) => new GraphProcessor().topologicalSort({ nodes }).map((n) => n.id);

  it('emits the looped compute node before the fragment node that reads it', () => {
    for (const nodes of [[mix, warp, mul, noise, tex], [mul, warp, mix, noise, tex], [warp, mix, mul, tex, noise]]) {
      const ids = order(nodes);
      expect(ids.indexOf('7')).toBeLessThan(ids.indexOf('8'));
      expect(ids.indexOf('4')).toBeLessThan(ids.indexOf('8'));
      expect(new Set(ids).size).toBe(5);
      expect(ids).toHaveLength(5);
    }
  });

  it('leaves an acyclic graph in plain dependency order', () => {
    const w = { ...warp, inputs: ['4', '5'] };
    const m = { ...mix, inputs: ['6', '4'] };
    const ids = order([m, w, noise, tex]);
    expect(ids.indexOf('6')).toBeLessThan(ids.indexOf('7'));
    expect(ids.indexOf('4')).toBeLessThan(ids.indexOf('6'));
  });
});
