// Regression test: the Resolution node declares four output pins — res (vec2),
// width (f32), height (f32), aspect (f32) — but its compiler used to emit only a
// single vec2 output with no `outputPins`. Connecting width/height/aspect then
// fell back to a vec2->f32 conversion of g.resolution (the average of x and y),
// so those pins produced a fixed, wrong value instead of the real dimensions.
//
// Fix: InputNodes Resolution codegen returns explicit outputPins for all four
// outputs so each pin resolves to its own live g.resolution component.

import { describe, it, expect } from 'vitest';
import { InputNodes } from '../src/codegen/compilers/InputNodes.js';

describe('Resolution node emits a pin per declared output', () => {
  const compiler = new InputNodes();
  const node = { id: '12', kind: 'Resolution', params: {} };
  const result = compiler.compile(node, () => null, () => '0.0');

  it('assigns the whole g.resolution vec2 to the node variable', () => {
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
