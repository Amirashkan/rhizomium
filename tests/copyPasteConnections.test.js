// Regression tests: duplicating or pasting a group of nodes must carry the wires between them.
//
// A wire lives in two places: the `graph.connections` entry the renderer draws, and the
// `node.inputs[pin]` slot every consumer of the graph actually reads — codegen, the topological
// walk in GraphProcessor, the compute executor, the pin-fill state in the renderer. The clone paths
// pushed the connection objects but never wrote `inputs`, so a duplicated or pasted chain showed
// its wires on screen while compiling as if nothing were connected: the copies rendered black and
// their parameters did nothing. From the artist's side the copy had lost its connections.
//
// Contract locked in: every path that clones a group of nodes rebuilds `inputs` on the clones from
// the connections it recreated, and expanded pin counts survive the copy so wires landing on pins
// past the definition's default aren't dropped.

import { describe, it, expect, beforeEach } from 'vitest';
import { SelectionManager } from '../src/core/SelectionManager.js';
import { MenuManager } from '../src/ui/MenuManager.js';
import { makeNode } from '../src/data/NodeDefs.js';
import { getInputCount, addNodeInput } from '../src/data/nodeInputs.js';

function connect(graph, fromNode, toNode, toPin = 0, fromPin = 0) {
  graph.connections.push({
    from: { nodeId: fromNode.id, pin: fromPin },
    to: { nodeId: toNode.id, pin: toPin },
  });
  toNode.inputs[toPin] = fromNode.id;
}

function makeGraph(nodes) {
  return { nodes, connections: [], selection: new Set(nodes.map((n) => n.id)) };
}

/** The nodes added by the clone operation — everything past the originals. */
function clonesOf(graph, originalCount) {
  return graph.nodes.slice(originalCount);
}

describe('cloned nodes keep their connections', () => {
  let source;
  let mix;
  let graph;

  beforeEach(() => {
    source = makeNode('ConstVec2', 0, 0);
    mix = makeNode('Mix', 300, 0);
    graph = makeGraph([source, mix]);
    connect(graph, source, mix, 1);
  });

  it('duplicateSelected wires the clones through node.inputs, not just graph.connections', () => {
    const selection = new SelectionManager(graph, () => {});

    selection.duplicateSelected();

    const [cloneSource, cloneMix] = clonesOf(graph, 2);
    expect(cloneMix.inputs[1]).toBe(cloneSource.id);
    // and the original is untouched
    expect(mix.inputs[1]).toBe(source.id);
  });

  it('pasteFromClipboard wires the pasted nodes through node.inputs', () => {
    const selection = new SelectionManager(graph, () => {});

    expect(selection.copySelected()).toBe(true);
    expect(selection.pasteFromClipboard()).toBe(true);

    const [pastedSource, pastedMix] = clonesOf(graph, 2);
    expect(pastedMix.inputs[1]).toBe(pastedSource.id);
  });

  it('pasted nodes never inherit the source ids of the nodes they were copied from', () => {
    const selection = new SelectionManager(graph, () => {});

    selection.copySelected();
    selection.pasteFromClipboard();

    const originalIds = new Set([source.id, mix.id]);
    for (const clone of clonesOf(graph, 2)) {
      for (const input of clone.inputs || []) {
        expect(originalIds.has(input)).toBe(false);
      }
    }
  });

  it('pasting the same clipboard twice wires each batch to its own copies', () => {
    const selection = new SelectionManager(graph, () => {});

    selection.copySelected();
    selection.pasteFromClipboard();
    const first = clonesOf(graph, 2);
    selection.pasteFromClipboard();
    const second = clonesOf(graph, 4);

    expect(first[1].inputs[1]).toBe(first[0].id);
    expect(second[1].inputs[1]).toBe(second[0].id);
    expect(second[1].inputs[1]).not.toBe(first[0].id);
  });

  it('a wire from outside the selection is dropped from the clone, not left pointing at the original', () => {
    // Only the consumer is selected: its upstream stays behind, so the copy has an empty pin.
    graph.selection = new Set([mix.id]);
    const selection = new SelectionManager(graph, () => {});

    selection.duplicateSelected();

    const [cloneMix] = clonesOf(graph, 2);
    expect(cloneMix.inputs[1]).toBeFalsy();
    expect(cloneMix.inputs[1]).not.toBe(source.id);
  });

  it('MenuManager duplicate wires the clones the same way', () => {
    const menu = Object.create(MenuManager.prototype);
    menu.graph = graph;
    menu.onChange = () => {};
    menu.undoManager = null;

    menu._duplicateSelected();

    const [cloneSource, cloneMix] = clonesOf(graph, 2);
    expect(cloneMix.inputs[1]).toBe(cloneSource.id);
  });
});

describe('cloned nodes keep wires landing on expanded pins', () => {
  let graph;
  let switchNode;
  let extra;
  let expandedPin;

  beforeEach(() => {
    // Switch declares 4 pins; grow it to 5 and wire the new one.
    switchNode = makeNode('Switch', 300, 0);
    expandedPin = addNodeInput(switchNode);
    extra = makeNode('ConstVec2', 0, 0);
    graph = makeGraph([extra, switchNode]);
    connect(graph, extra, switchNode, expandedPin);
    expect(expandedPin).toBe(4);
  });

  it('duplicateSelected keeps the expanded pin and its wire', () => {
    const selection = new SelectionManager(graph, () => {});

    selection.duplicateSelected();

    const [cloneExtra, cloneSwitch] = clonesOf(graph, 2);
    expect(getInputCount(cloneSwitch)).toBe(5);
    expect(cloneSwitch.inputs[expandedPin]).toBe(cloneExtra.id);
  });

  it('MenuManager duplicate keeps the expanded pin and its wire', () => {
    const menu = Object.create(MenuManager.prototype);
    menu.graph = graph;
    menu.onChange = () => {};
    menu.undoManager = null;

    menu._duplicateSelected();

    const [cloneExtra, cloneSwitch] = clonesOf(graph, 2);
    expect(getInputCount(cloneSwitch)).toBe(5);
    expect(cloneSwitch.inputs[expandedPin]).toBe(cloneExtra.id);
  });
});
