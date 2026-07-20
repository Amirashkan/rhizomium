// Codegen for the Audio Analysis input node.
//
// Like Count/Hold, the Audio Analysis node has no shader-expressible memory: its detection runs on the
// CPU in AudioAnalysisProcessor and streams three uniforms (<id>.kick / <id>.trig / <id>.level). The
// compiler just wires up the uniform references getParam returns, exposing them as the node's three
// output pins (pin 0 = kick, the default output).

import { describe, it, expect } from 'vitest';
import { InputNodes } from '../src/codegen/compilers/InputNodes.js';

describe('AudioAnalysis node codegen', () => {
  const compiler = new InputNodes();

  it('handles the AudioAnalysis kind', () => {
    expect(compiler.handles('AudioAnalysis')).toBe(true);
  });

  it('exposes level/kick/trig uniforms as three pins, with level as the default (pin 0)', () => {
    const node = { id: '7', kind: 'AudioAnalysis', params: { band: 'Bass', threshold: 0.15 } };
    const getParam = (name) => `u_params._7_${name}`;
    const result = compiler.compile(node, () => '0.0', getParam);

    // Pin 0 is the continuous level, so `=node_7` gives a live value.
    expect(result.line).toBe('let node_7 = u_params._7_level;');
    expect(result.outputType).toBe('f32');
    expect(result.outputPins).toEqual([
      { expression: 'u_params._7_level', type: 'f32' },
      { expression: 'u_params._7_kick', type: 'f32' },
      { expression: 'u_params._7_trig', type: 'f32' },
    ]);
  });

  it('falls back to a compilable 0.0 when no uniform manager is available', () => {
    const node = { id: '8', kind: 'AudioAnalysis', params: {} };
    const result = compiler.compile(node, () => '0.0', null);
    expect(result.line).toBe('let node_8 = 0.0;');
    expect(result.outputType).toBe('f32');
  });
});
