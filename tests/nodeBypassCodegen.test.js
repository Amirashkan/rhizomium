// Regression tests for node bypass in fragment shader codegen.
// A bypassed node passes its first input straight through instead of running its own logic.

import { describe, it, expect } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';

function lineForNode2(bypassed) {
  const graph = {
    nodes: [
      { id: '1', kind: 'ConstVec3', params: { x: 1.0, y: 0.0, z: 0.0 }, inputs: [] },
      { id: '2', kind: 'Saturate', params: {}, inputs: ['1'], bypassed },
      { id: '9', kind: 'OutputFinal', params: {}, inputs: ['2'] },
    ],
    connections: [],
  };
  const result = buildWGSL(graph);
  const code = typeof result === 'string' ? result : (result.wgsl || result.code || '');
  return code.split('\n').find((l) => /\blet node_2\b/.test(l)) || '';
}

describe('node bypass codegen', () => {
  it('passes the input straight through when bypassed', () => {
    const line = lineForNode2(true);
    expect(line).toMatch(/let node_2\s*=\s*node_1\s*;/); // node_2 = node_1 (no processing)
  });

  it('runs the node normally when not bypassed', () => {
    const line = lineForNode2(false);
    expect(line).not.toMatch(/let node_2\s*=\s*node_1\s*;/); // wrapped in the node's own op
    expect(line).toContain('node_1'); // still consumes its input
  });
});
