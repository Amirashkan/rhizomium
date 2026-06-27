// Regression test: the Resolution node declares four output pins — res (vec2),
// width (f32), height (f32), aspect (f32) — but its compiler used to emit only a
// single vec2 output with no `outputPins`. Connecting width/height/aspect then
// fell back to a vec2->f32 conversion of g.resolution (the average of x and y),
// so those pins produced a fixed, wrong value instead of the real dimensions.
//
// Fix: InputNodes Resolution codegen returns explicit outputPins for all four
// outputs so each pin resolves to its own live g.resolution component.

import { describe, it, expect, afterEach } from 'vitest';
import { InputNodes } from '../src/codegen/compilers/InputNodes.js';

describe('Resolution node emits a pin per declared output', () => {
  const compiler = new InputNodes();
  const node = { id: '12', kind: 'Resolution', params: {} };
  const result = compiler.compile(node, () => null, () => '0.0');

  it('assigns the whole g.resolution vec2 to the node variable (Preview is the default)', () => {
    expect(result.line).toBe('let node_12 = g.resolution;');
    expect(result.outputType).toBe('vec2');
  });

  it('exposes res / width / height / aspect as distinct, live pins', () => {
    expect(result.outputPins).toEqual([
      { expression: 'node_12', type: 'vec2' },
      { expression: 'node_12.x', type: 'f32' },
      { expression: 'node_12.y', type: 'f32' },
      { expression: '(node_12.x / node_12.y)', type: 'f32' },
    ]);
  });
});

describe('Resolution node Display mode bakes the monitor resolution as a constant', () => {
  const compiler = new InputNodes();

  afterEach(() => {
    delete globalThis.window;
  });

  it('emits a vec2 literal of screen size * devicePixelRatio instead of g.resolution', () => {
    globalThis.window = { devicePixelRatio: 2, screen: { width: 1280, height: 720 } };
    const node = { id: '7', kind: 'Resolution', params: { mode: 'Display' } };
    const result = compiler.compile(node, () => null, () => '0.0');
    expect(result.line).toBe('let node_7 = vec2<f32>(2560.0, 1440.0);');
    // Pins still resolve to components of the baked constant.
    expect(result.outputPins[1]).toEqual({ expression: 'node_7.x', type: 'f32' });
  });

  it('still uses g.resolution when mode is explicitly Preview', () => {
    globalThis.window = { devicePixelRatio: 2, screen: { width: 1280, height: 720 } };
    const node = { id: '8', kind: 'Resolution', params: { mode: 'Preview' } };
    const result = compiler.compile(node, () => null, () => '0.0');
    expect(result.line).toBe('let node_8 = g.resolution;');
  });
});
