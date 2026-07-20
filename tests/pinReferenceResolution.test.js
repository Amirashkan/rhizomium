// A numeric suffix on a reference to a MULTI-OUTPUT node (Audio Analysis, Resolution, Split, ...)
// is an output-PIN index — node_28_0 = pin 0, node_28_2 = pin 2 — not a vector component. This is
// what lets `=node_<id>_2` reach the Audio Analysis node's `trig` pin, etc.

import { describe, it, expect } from 'vitest';
import { resolveScalarRef } from '../src/codegen/processors/scalarRef.js';

function makeTypeConverter(pinsById) {
  const outputPins = new Map();
  const expressions = new Map();
  const types = new Map();
  for (const [id, pins] of Object.entries(pinsById)) {
    outputPins.set(id, pins);
    expressions.set(id, pins[0].expression); // setNodeOutputPins mirrors pin 0 as the default
    types.set(id, pins[0].type);
  }
  return { outputPins, expressions, types };
}

const audioPins = [
  { expression: 'u_params._28_level', type: 'f32' },
  { expression: 'u_params._28_kick', type: 'f32' },
  { expression: 'u_params._28_trig', type: 'f32' },
];

describe('output-pin references on multi-output nodes', () => {
  const graph = { nodes: [{ id: '28', kind: 'AudioAnalysis' }] };
  const tc = makeTypeConverter({ '28': audioPins });

  it('resolves node_<id> (no suffix) to pin 0', () => {
    expect(resolveScalarRef('node_28', graph, tc)).toBe('u_params._28_level');
  });

  it('resolves numeric suffixes to the matching output pin', () => {
    expect(resolveScalarRef('node_28_0', graph, tc)).toBe('u_params._28_level');
    expect(resolveScalarRef('node_28_1', graph, tc)).toBe('u_params._28_kick');
    expect(resolveScalarRef('node_28_2', graph, tc)).toBe('u_params._28_trig');
  });

  it('clamps an out-of-range pin index back to pin 0', () => {
    expect(resolveScalarRef('node_28_9', graph, tc)).toBe('u_params._28_level');
  });
});
