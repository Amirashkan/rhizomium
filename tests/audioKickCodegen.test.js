// Codegen for the Audio Kick input node.
//
// Like Count/Hold, the Audio Kick node has no shader-expressible memory: its detection runs on the
// CPU in AudioKickProcessor and streams three uniforms (<id>.kick / <id>.trig / <id>.level). The
// compiler just wires up the uniform references getParam returns, exposing them as the node's three
// output pins (pin 0 = kick, the default output).

import { describe, it, expect } from 'vitest';
import { InputNodes } from '../src/codegen/compilers/InputNodes.js';

describe('AudioKick node codegen', () => {
  const compiler = new InputNodes();

  it('handles the AudioKick kind', () => {
    expect(compiler.handles('AudioKick')).toBe(true);
  });

  it('reads the kick/trig/level uniforms that getParam registers as three output pins', () => {
    const node = { id: '7', kind: 'AudioKick', params: { band: 'Bass', threshold: 0.15 } };
    const getParam = (name) => `u_params._7_${name}`;
    const result = compiler.compile(node, () => '0.0', getParam);

    expect(result.line).toBe('let node_7 = u_params._7_kick;');
    expect(result.outputType).toBe('f32');
    expect(result.outputPins).toEqual([
      { expression: 'u_params._7_kick', type: 'f32' },
      { expression: 'u_params._7_trig', type: 'f32' },
      { expression: 'u_params._7_level', type: 'f32' },
    ]);
  });

  it('falls back to a compilable 0.0 when no uniform manager is available', () => {
    const node = { id: '8', kind: 'AudioKick', params: {} };
    const result = compiler.compile(node, () => '0.0', null);
    expect(result.line).toBe('let node_8 = 0.0;');
    expect(result.outputType).toBe('f32');
  });
});
