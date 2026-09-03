// The parameter readout ("green text") evaluates `=node_<id>` on the CPU. An Audio node's value is
// advanced every frame by AudioAnalysisProcessor rather than computed from the graph, so it has to
// be read live here — the throttled preview value would step, and a node the patch references but
// does not render has no preview value at all.

import { describe, it, expect } from 'vitest';
import { ParameterExpressionSystem } from '../src/utils/ParameterExpressionSystem.js';

describe('Audio live value exposure', () => {
  const es = new ParameterExpressionSystem();

  it('exposes the node’s live channel value for the CPU expression context', () => {
    const node = { id: '28', kind: 'AudioValue', params: { channel: 'kick' }, __audio_value: 0.8 };
    expect(es._liveInputNodeValue(node)).toBeCloseTo(0.8);
  });

  it('reads 0 before the processor has run', () => {
    expect(es._liveInputNodeValue({ id: '5', kind: 'AudioValue', params: { channel: 'level' } })).toBe(0);
  });

  it('returns undefined for nodes it does not drive', () => {
    expect(es._liveInputNodeValue({ id: '1', kind: 'ConstFloat' })).toBeUndefined();
  });
});
