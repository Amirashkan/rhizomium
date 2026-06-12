// Regression tests for parameter node references in fragment shader codegen.
//
// Bug: a partial or unknown reference like "=node_" (committed while the user
// was still typing the node id) was emitted verbatim into WGSL, producing
// "unresolved value 'node_'" and invalidating the whole render pipeline.

import { describe, it, expect } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';

function buildWithScale(scaleExpr) {
  const graph = {
    nodes: [
      { id: '5', kind: 'ConstFloat', params: { value: 2.0 }, inputs: [] },
      { id: '7', kind: 'SimplexNoise', params: { scale: 4.0, amplitude: 1.0, offset: 0.0 }, inputs: [] },
      {
        id: '28',
        kind: 'FBMNoise',
        params: {
          scale: scaleExpr,
          octaves: 4,
          persistence: 0.5,
          lacunarity: 2.0,
          amplitude: 1.0,
          offset: 0.0,
          gain: 0.5,
          warp: 0.3,
        },
        inputs: [],
      },
      { id: '99', kind: 'OutputFinal', params: {}, inputs: ['28'] },
    ],
    connections: [],
  };

  const result = buildWGSL(graph);
  const code = typeof result === 'string' ? result : result.code || result.shader || result.wgsl;
  return code.split('\n').find((l) => l.includes('let node_28'));
}

describe('parameter node references in fragment codegen', () => {
  it('resolves a valid reference to the compiled node variable', () => {
    const line = buildWithScale('=node_5');
    expect(line).toContain('node_5');
    expect(line).not.toMatch(/\bnode_(?![0-9])/);
  });

  it('falls back to the default for an incomplete reference (=node_)', () => {
    const line = buildWithScale('=node_');
    expect(line).not.toMatch(/\bnode_\b/);
    expect(line).toContain('3.000000'); // FBM scale default
  });

  it('falls back to the default for a reference to a nonexistent node', () => {
    const line = buildWithScale('=node_999');
    expect(line).not.toContain('node_999');
    expect(line).toContain('3.000000');
  });

  it('supports references inside arithmetic expressions', () => {
    const line = buildWithScale('=node_5 * 2');
    expect(line).toContain('(node_5 * 2.0)');
  });

  it('falls back when an expression contains an incomplete reference', () => {
    const line = buildWithScale('=node_ * 2');
    expect(line).not.toMatch(/\bnode_\s/);
    expect(line).toContain('3.000000');
  });

  it('maps component references to WGSL member access on vector nodes', () => {
    const line = buildWithScale('=node_7_x');
    expect(line).toContain('node_7.x');
  });

  it('ignores component suffix on scalar nodes', () => {
    const line = buildWithScale('=node_5_x');
    expect(line).toContain('node_5');
    expect(line).not.toContain('node_5.x');
    expect(line).not.toContain('node_5_x');
  });
});
