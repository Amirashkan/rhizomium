// The parameter readout ("green text") evaluates =node_<id>_N on the CPU. For the Audio Analysis
// node its live outputs must be exposed as a [level, kick, trig] array so the pin references resolve
// to the live values instead of reading as 0.

import { describe, it, expect } from 'vitest';
import { ParameterExpressionSystem } from '../src/utils/ParameterExpressionSystem.js';

describe('Audio Analysis live value exposure', () => {
  const es = new ParameterExpressionSystem();

  it('exposes level/kick/trig as [pin0, pin1, pin2] for the CPU expression context', () => {
    const node = { id: '28', kind: 'AudioAnalysis', __kickLevel: 0.33, __kickValue: 0.8, __kickTrig: 1 };
    expect(es._liveInputNodeValue(node)).toEqual([0.33, 0.8, 1]);
  });

  it('defaults missing live values to 0', () => {
    const node = { id: '5', kind: 'AudioAnalysis' };
    expect(es._liveInputNodeValue(node)).toEqual([0, 0, 0]);
  });

  it('returns undefined for nodes it does not drive', () => {
    expect(es._liveInputNodeValue({ id: '1', kind: 'ConstFloat' })).toBeUndefined();
  });
});
