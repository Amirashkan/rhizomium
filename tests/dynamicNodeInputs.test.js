// Expandable node inputs — the "+" chip on nodes that combine an arbitrary number of upstream
// signals (Mix, Switch, Custom GLSL, Expression).
//
// The pin count lives on the node INSTANCE (`node.inputCount`), so everything that draws,
// hit-tests or compiles a pin has to read it from data/nodeInputs.js rather than from the static
// node definition. These tests pin down the three places that can silently drift apart:
//
//   1. the helper itself (count, labels, clamping to the spec's min/max),
//   2. the shared layout geometry the renderer and the event handler both use,
//   3. the compilers, which must emit code for every pin the node actually shows.

import { describe, it, expect } from 'vitest';
import {
  getDynamicInputSpec,
  getInputCount,
  getInputLabel,
  canAddInput,
  canRemoveInput,
  addNodeInput,
  removeNodeInput,
  setInputCount,
} from '../src/data/nodeInputs.js';
import {
  ROW_H,
  rowCenterY,
  nodeMinHeight,
  dynamicInputButtons,
  hitChip,
} from '../src/core/pinLayout.js';
import { buildWGSL } from '../src/codegen/glslBuilder.js';
import { ComputeNodes } from '../src/codegen/compilers/ComputeNodes.js';

function mixNode(inputCount, inputs = []) {
  return { id: '7', kind: 'ComputeMix', params: { mode: 'Mix' }, inputCount, inputs };
}

describe('expandable input helper', () => {
  it('falls back to the definition count for a node that has never been expanded', () => {
    expect(getInputCount({ kind: 'ComputeMix', inputs: [] })).toBe(2);
    expect(getInputCount({ kind: 'Switch', inputs: [] })).toBe(4);
  });

  it('reports no spec for a fixed-pin node, so it gets no "+" chip', () => {
    expect(getDynamicInputSpec({ kind: 'Remap' })).toBeNull();
    expect(canAddInput({ kind: 'Remap', inputs: [] })).toBe(false);
  });

  it('grows and shrinks the pin list, keeping node.inputs the same length', () => {
    const node = mixNode(undefined, [null, null]);

    expect(addNodeInput(node)).toBe(2);
    expect(getInputCount(node)).toBe(3);
    expect(node.inputs).toHaveLength(3);

    expect(removeNodeInput(node)).toBe(2);
    expect(getInputCount(node)).toBe(2);
    expect(node.inputs).toHaveLength(2);
  });

  it('stops at the spec bounds instead of producing pins nothing wires up', () => {
    const node = mixNode(undefined, [null, null]);

    while (canAddInput(node)) addNodeInput(node);
    expect(getInputCount(node)).toBe(getDynamicInputSpec(node).max);
    expect(addNodeInput(node)).toBe(-1);

    while (canRemoveInput(node)) removeNodeInput(node);
    expect(getInputCount(node)).toBe(getDynamicInputSpec(node).min);
    expect(removeNodeInput(node)).toBe(-1);
  });

  it('clamps a count from a hand-edited or stale project file', () => {
    expect(getInputCount(mixNode(99))).toBe(getDynamicInputSpec({ kind: 'ComputeMix' }).max);
    expect(getInputCount(mixNode(0))).toBe(getDynamicInputSpec({ kind: 'ComputeMix' }).min);
  });

  it('continues each node kind own pin naming past the definition list', () => {
    expect(getInputLabel(mixNode(4), 1)).toBe('Input B'); // named by the definition
    expect(getInputLabel(mixNode(4), 2)).toBe('Input C'); // generated
    expect(getInputLabel(mixNode(4), 3)).toBe('Input D');

    const sw = { kind: 'Switch', inputCount: 6, inputs: [] };
    expect(getInputLabel(sw, 4)).toBe('E');

    const custom = { kind: 'CustomGLSL', inputCount: 6, inputs: [] };
    expect(getInputLabel(custom, 5)).toBe('Input 5');

    const expr = { kind: 'Expr', inputCount: 4, inputs: [] };
    expect(getInputLabel(expr, 3)).toBe('d');
  });

  it('setInputCount restores an exact count (the undo path) and resizes inputs', () => {
    const node = mixNode(6, [null, null, null, null, null, null]);
    setInputCount(node, 3);
    expect(getInputCount(node)).toBe(3);
    expect(node.inputs).toHaveLength(3);
  });
});

describe('expandable input layout', () => {
  const node = { x: 100, y: 200 };

  it('reserves a grid row for the chips so they never sit on the last pin', () => {
    const withoutChips = nodeMinHeight(node, 3, 1, 0, 0);
    const withChips = nodeMinHeight(node, 3, 1, 0, 1);
    expect(withChips - withoutChips).toBe(ROW_H);
  });

  it('puts the chips on the row directly below the last socket row', () => {
    const { centerY } = dynamicInputButtons(node, 3, 1, 0);
    expect(centerY).toBe(rowCenterY(node, 0, 3));
  });

  it('grows the node by exactly one row per added pin', () => {
    const two = nodeMinHeight(node, 2, 1, 0, 1);
    const three = nodeMinHeight(node, 3, 1, 0, 1);
    expect(three - two).toBe(ROW_H);
  });

  it('hit-tests the drawn chip rectangles, and nothing between them', () => {
    const { add, remove } = dynamicInputButtons(node, 2, 1, 0);
    expect(hitChip(add, add.x + 1, add.y + 1)).toBe(true);
    expect(hitChip(remove, remove.x + 1, remove.y + 1)).toBe(true);
    // The gap between the two chips belongs to neither.
    const gapX = add.x + add.w + 2;
    expect(hitChip(add, gapX, add.y + 2)).toBe(false);
    expect(hitChip(remove, gapX, add.y + 2)).toBe(false);
  });
});

function compile(graph) {
  const result = buildWGSL(graph);
  return typeof result === 'string' ? result : (result.wgsl || result.code || '');
}

describe('expandable inputs in fragment codegen', () => {
  it('Switch selects a pin the definition never named', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'ConstVec3', params: { x: 1, y: 0, z: 0 }, inputs: [] },
        {
          id: '2',
          kind: 'Switch',
          params: { select: 5 },
          inputCount: 6,
          inputs: [null, null, null, null, null, '1'],
        },
        { id: '9', kind: 'OutputFinal', params: {}, inputs: ['2'] },
      ],
      connections: [],
    };
    // With the fixed four-pin range this clamped to pin 3 (unconnected) and went black.
    expect(compile(graph)).toMatch(/let node_2 = node_1;/);
  });

  it('a dynamic Switch select folds over every pin, not just the first four', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'ConstFloat', params: { value: 4 }, inputs: [] },
        { id: '3', kind: 'ConstVec3', params: { x: 1, y: 0, z: 0 }, inputs: [] },
        {
          id: '2',
          kind: 'Switch',
          params: { select: '=node_1' },
          inputCount: 6,
          inputs: [null, null, null, null, '3', null],
        },
        { id: '9', kind: 'OutputFinal', params: {}, inputs: ['2'] },
      ],
      connections: [],
    };
    const code = compile(graph);
    expect(code).toMatch(/sel_2 == 4/);
    expect(code).toMatch(/sel_2 == 5/);
  });

  it('Custom GLSL substitutes an input past input3', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'ConstFloat', params: { value: 2 }, inputs: [] },
        {
          id: '2',
          kind: 'CustomGLSL',
          params: { code: 'input5 * 2.0', outputType: 'f32' },
          inputCount: 6,
          inputs: [null, null, null, null, null, '1'],
        },
        { id: '9', kind: 'OutputFinal', params: {}, inputs: ['2'] },
      ],
      connections: [],
    };
    const code = compile(graph);
    // The name must be replaced by the wired input, not left as an undeclared identifier.
    expect(code).not.toMatch(/\binput5\b/);
    expect(code).toMatch(/node_2 = \(node_1\) \* 2\.0/);
  });

  it('Expression resolves a variable named after an added pin', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'ConstFloat', params: { value: 3 }, inputs: [] },
        { id: '2', kind: 'Expr', expr: 'c * 2.0', inputCount: 3, inputs: [null, null, '1'] },
        { id: '9', kind: 'OutputFinal', params: {}, inputs: ['2'] },
      ],
      connections: [],
    };
    const code = compile(graph);
    expect(code).toMatch(/node_2 = \(node_1\) \* 2\.0/);
  });

  it('leaves a two-pin Expression alone (c is not a variable there)', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'ConstFloat', params: { value: 3 }, inputs: [] },
        { id: '2', kind: 'Expr', expr: 'a + b', inputs: ['1', null] },
        { id: '9', kind: 'OutputFinal', params: {}, inputs: ['2'] },
      ],
      connections: [],
    };
    expect(compile(graph)).toMatch(/node_2 = \(node_1\) \+ \(0\.0\)/);
  });
});

describe('expandable inputs in the Mix compute shader', () => {
  const compiler = new ComputeNodes();

  it('declares one texture binding per pin, appended past the original two', () => {
    const wgsl = compiler.generateMixShader(mixNode(4, [null, null, '3', '4']));
    expect(wgsl).toMatch(/@binding\(2\) var inputTextureA/);
    expect(wgsl).toMatch(/@binding\(4\) var inputTexture1/);
    expect(wgsl).toMatch(/@binding\(5\) var inputTexture2/);
    expect(wgsl).toMatch(/@binding\(6\) var inputTexture3/);
  });

  it('binding numbers match ComputeShaderManager expectation (2, 4, then 5+)', () => {
    expect(ComputeNodes.mixInputBinding(0)).toBe(2);
    expect(ComputeNodes.mixInputBinding(1)).toBe(4);
    expect(ComputeNodes.mixInputBinding(2)).toBe(5);
    expect(ComputeNodes.mixInputBinding(3)).toBe(6);
  });

  it('blends every connected input onto the running result, in pin order', () => {
    const wgsl = compiler.generateMixShader(mixNode(4, ['1', '2', '3', '4']));
    expect(wgsl).toMatch(/blended = blendPair\(blended, color1\.rgb\);/);
    expect(wgsl).toMatch(/blended = blendPair\(blended, color2\.rgb\);/);
    expect(wgsl).toMatch(/blended = blendPair\(blended, color3\.rgb\);/);
  });

  it('skips an unconnected extra pin so its black fallback cannot darken the result', () => {
    const wgsl = compiler.generateMixShader(mixNode(4, ['1', '2', null, '4']));
    // Pin 2 is unwired: declared (the bind group still needs it) but never blended.
    expect(wgsl).toMatch(/@binding\(5\) var inputTexture2/);
    expect(wgsl).not.toMatch(/blendPair\(blended, color2\.rgb\)/);
    expect(wgsl).toMatch(/blendPair\(blended, color3\.rgb\)/);
  });

  it('still emits the plain A-over-B blend for an unexpanded Mix', () => {
    const wgsl = compiler.generateMixShader(mixNode(undefined, [null, null]));
    expect(wgsl).toMatch(/@binding\(4\) var inputTexture1/);
    expect(wgsl).not.toMatch(/@binding\(5\)/);
    // Input B blends even when unwired — unchanged from before Mix became expandable.
    expect(wgsl).toMatch(/blended = blendPair\(blended, color1\.rgb\);/);
  });
});
