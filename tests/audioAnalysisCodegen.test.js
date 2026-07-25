// Codegen for the Audio Analysis input node.
//
// Like Count/Hold, the Audio Analysis node has no shader-expressible memory: the meters' followers
// and each trigger's armed state live on the CPU in AudioAnalysisProcessor, which streams one
// uniform per output pin. The compiler just wires up the uniform references getParam returns.
// Pin 0 = level, the default output. The pin order is shared via core/audioAnalysisPins.js.

import { describe, it, expect } from 'vitest';
import { InputNodes } from '../src/codegen/compilers/InputNodes.js';
import { AUDIO_ANALYSIS_PINS } from '../src/core/audioAnalysisPins.js';

describe('AudioAnalysis node codegen', () => {
  const compiler = new InputNodes();

  it('handles the AudioAnalysis kind', () => {
    expect(compiler.handles('AudioAnalysis')).toBe(true);
  });

  it('exposes one uniform per output pin, with level as the default (pin 0)', () => {
    const node = { id: '7', kind: 'AudioAnalysis', params: { band: 'Bass', threshold: 0.15 } };
    const getParam = (name) => `u_params._7_${name}`;
    const result = compiler.compile(node, () => '0.0', getParam);

    // Pin 0 is the continuous level, so `=node_7` gives a live value.
    expect(result.line).toBe('let node_7 = u_params._7_level;');
    expect(result.outputType).toBe('f32');
    expect(result.outputPins).toEqual(
      AUDIO_ANALYSIS_PINS.map((name) => ({ expression: `u_params._7_${name}`, type: 'f32' })),
    );
  });

  it('falls back to a compilable 0.0 when no uniform manager is available', () => {
    const node = { id: '8', kind: 'AudioAnalysis', params: {} };
    const result = compiler.compile(node, () => '0.0', null);
    expect(result.line).toBe('let node_8 = 0.0;');
    expect(result.outputType).toBe('f32');
  });
});
