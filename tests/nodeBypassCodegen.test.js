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

// Compute nodes are bypassed at the texture level in ComputeExecutor (their output texture is
// aliased to the input), so the fragment codegen must NOT rewrite them to a passthrough — they
// keep their normal texture-sampling codegen whether bypassed or not.
function computeLinesForNode2(bypassed) {
  const graph = {
    nodes: [
      { id: '1', kind: 'ComputeNoise', params: {}, inputs: [] },
      { id: '2', kind: 'ComputeBlur', params: {}, inputs: ['1'], bypassed },
      { id: '9', kind: 'OutputFinal', params: {}, inputs: ['2'] },
    ],
    connections: [],
  };
  const result = buildWGSL(graph);
  const code = typeof result === 'string' ? result : (result.wgsl || result.code || '');
  return code.split('\n').filter((l) => /\bnode_2\b/.test(l)).join('\n');
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

  it('does NOT rewrite a bypassed compute node in fragment codegen (texture-level bypass)', () => {
    const bypassed = computeLinesForNode2(true);
    const normal = computeLinesForNode2(false);
    // Compute bypass happens in ComputeExecutor (output texture aliased to input), so the
    // fragment shader for a compute node is identical whether or not it's bypassed.
    expect(bypassed).toBe(normal);
    // And it must not collapse to a plain `node_2 = node_1;` passthrough.
    expect(bypassed).not.toMatch(/let node_2\s*=\s*node_1\s*;/);
  });
});
