// The parameter readout ("green text") evaluates =node_<id>_N on the CPU. For the Audio Analysis
// node its live outputs must be exposed as a per-pin array so the pin references resolve
// to the live values instead of reading as 0.

import { describe, it, expect } from 'vitest';
import { ParameterExpressionSystem } from '../src/utils/ParameterExpressionSystem.js';
import { AUDIO_ANALYSIS_PINS } from '../src/core/audioAnalysisPins.js';

describe('Audio Analysis live value exposure', () => {
  const es = new ParameterExpressionSystem();

  it('exposes every output pin, in order, for the CPU expression context', () => {
    const node = { id: '28', kind: 'AudioAnalysis', __audio_level: 0.33, __audio_kick: 0.8, __audio_kickTrig: 1 };
    const v = es._liveInputNodeValue(node);
    expect(v).toHaveLength(AUDIO_ANALYSIS_PINS.length);
    expect(v[AUDIO_ANALYSIS_PINS.indexOf('level')]).toBeCloseTo(0.33);
    expect(v[AUDIO_ANALYSIS_PINS.indexOf('kick')]).toBeCloseTo(0.8);
    expect(v[AUDIO_ANALYSIS_PINS.indexOf('kickTrig')]).toBe(1);
  });

  it('defaults missing live values to 0', () => {
    const node = { id: '5', kind: 'AudioAnalysis' };
    expect(es._liveInputNodeValue(node)).toEqual(AUDIO_ANALYSIS_PINS.map(() => 0));
  });

  it('returns undefined for nodes it does not drive', () => {
    expect(es._liveInputNodeValue({ id: '1', kind: 'ConstFloat' })).toBeUndefined();
  });
});
