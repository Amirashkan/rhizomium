// Regression test: a node whose parameter expression references a Split channel — e.g. a ConstFloat
// with value "=node_<split>_0" (Mouse -> Split -> Float) — must compute a live numeric pin value.
//
// Bug: PreviewComputer built the expression evaluation context inline and only exposed plain-array
// node values, with LETTER suffixes (node_5_x). A Split node's value is a { type:'split', values }
// object, and the editor references a channel by NUMERIC index (node_5_0). So "=node_34_0" found no
// matching identifier, the CPU evaluation threw, and the value froze at 0 — the pin label never
// tracked the cursor. Both the ConstFloat path and _evaluateParam (ConstVec components, ...) shared
// the gap; they now use _addNodeRefsToContext, which unwraps split objects and exposes both the
// letter and the numeric channel index.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PreviewComputer } from '../src/core/PreviewComputer.js';

describe('Split channel reference in a pin-value preview', () => {
  let computer;
  let savedMouse;

  beforeEach(() => {
    computer = new PreviewComputer();
    savedMouse = window._mousePosition;
  });

  afterEach(() => {
    window._mousePosition = savedMouse;
  });

  function mouseSplitFloatGraph(channelRef) {
    return {
      nodes: [
        { id: 'm', kind: 'Mouse', inputs: [], params: {} },
        { id: '34', kind: 'Split4', inputs: ['m'], params: {} },
        { id: 'f', kind: 'ConstFloat', inputs: [], params: { value: channelRef } },
      ],
      connections: [{ from: { nodeId: 'm', pin: 0 }, to: { nodeId: '34', pin: 0 } }],
    };
  }

  it('resolves a numeric Split channel (=node_34_0) to the mouse x and tracks it live', () => {
    window._mousePosition = [0.3, 0.7, 0, 0];
    const graph = mouseSplitFloatGraph('=node_34_0');

    computer.computePreviews(graph); // first pass dirties everything (structure change)
    const f = graph.nodes.find((n) => n.id === 'f');
    expect(f.__preview).toBeCloseTo(0.3, 5);

    // Cursor moves: Mouse value changes with no param/input change, so the app marks it dirty.
    window._mousePosition = [0.8, 0.1, 0, 0];
    computer.markNodeDirty('m'); // cascades to Split (wire) + Float (expression ref)
    computer.computePreviews(graph);
    expect(f.__preview).toBeCloseTo(0.8, 5);
  });

  it('resolves a letter Split channel (=node_34_y) too', () => {
    window._mousePosition = [0.3, 0.7, 0, 0];
    const graph = mouseSplitFloatGraph('=node_34_y');
    computer.computePreviews(graph);
    const f = graph.nodes.find((n) => n.id === 'f');
    expect(f.__preview).toBeCloseTo(0.7, 5);
  });

  it('exposes numeric channels of a plain vector node via _evaluateParam (ConstVec component)', () => {
    const graph = {
      nodes: [
        { id: '2', kind: 'ConstVec2', inputs: [], params: { x: '0.25', y: '0.9' } },
        { id: '3', kind: 'ConstVec2', inputs: [], params: { x: '=node_2_1', y: '0' } },
      ],
      connections: [],
    };
    computer.computePreviews(graph);
    const out = graph.nodes.find((n) => n.id === '3');
    // node_2_1 is channel 1 (y) of the vec2 = 0.9.
    expect(out.__preview[0]).toBeCloseTo(0.9, 5);
  });
});
