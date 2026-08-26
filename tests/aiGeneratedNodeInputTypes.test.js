// The node generator declares what each pin carries. Those types have to reach the node, because
// they are what an unconnected pin defaults to: a vec2 pin the generated code takes `.xy` of must
// default to vec2<f32>(0.0), not to a scalar the shader cannot swizzle. Dropping them left the
// compiler guessing from the code — and a pin that is only ever multiplied gives it nothing to
// guess from, so the shader failed to compile and the output went black.

import { describe, it, expect, beforeEach } from 'vitest';
import { insertGeneratedNode } from '../src/ai/applyResult.js';

describe('insertGeneratedNode', () => {
  beforeEach(() => {
    window.graph = { nodes: [], selection: new Set() };
    window.editor = undefined;
    window.undoManager = undefined;
  });

  it('carries the declared pin types onto the node', () => {
    const node = insertGeneratedNode({
      name: 'Fluid Plume',
      outputType: 'vec3',
      code: 'input0.x + input1',
      inputs: [
        { label: 'UV', type: 'vec2' },
        { label: 'Density', type: 'f32' },
      ],
    });

    expect(node.params.inputTypes).toEqual(['vec2', 'f32']);
    expect(node.params.outputType).toBe('vec3');
  });

  it('falls back to f32 for a pin with a type it does not recognise', () => {
    const node = insertGeneratedNode({
      code: 'input0',
      inputs: [{ label: 'Amount', type: 'float' }, { label: 'Other' }],
    });

    expect(node.params.inputTypes).toEqual(['f32', 'f32']);
  });

  it('leaves inputTypes off a node that declares no pins', () => {
    const node = insertGeneratedNode({ code: 'input0', inputs: [] });
    expect(node.params.inputTypes).toBeUndefined();
  });
});
