// The patch as a structured graph, in words — what the screen-reader outline and the Describe
// Patch dialog are built from.

import { describe, it, expect } from 'vitest';
import { makeNode } from '../src/data/NodeDefs.js';
import {
  patchConnections,
  describeNode,
  orderNodes,
  summarizePatch,
  formatParamValue,
  nodeLabel,
  inputSentence,
  outputSentence,
  nodeConnectionSummary,
  nodeFullDescription,
  outlineSignature,
  outputPins,
  spokenType,
} from '../src/accessibility/graphDescription.js';

/** Time → Add.A, Add → Output; plus a stray Sin nobody wired up. */
function samplePatch() {
  const time = makeNode('Time', 0, 0);
  const add = makeNode('Add', 300, 0);
  const out = makeNode('OutputFinal', 600, 0);
  const stray = makeNode('Sin', 300, 400);
  add.inputs[0] = time.id;
  out.inputs[0] = add.id;
  return {
    graph: {
      nodes: [out, stray, add, time],
      // The drawn list only carries Add → Output; Time → Add lives only on add.inputs, the way a
      // patch built in code (or an older save) can arrive.
      connections: [{ from: { nodeId: add.id, pin: 0 }, to: { nodeId: out.id, pin: 0 } }],
      selection: new Set(),
    },
    time,
    add,
    out,
    stray,
  };
}

describe('patchConnections', () => {
  it('reads the drawn wires and tops them up from node inputs', () => {
    const { graph, time, add, out } = samplePatch();
    const wires = patchConnections(graph);
    expect(wires).toHaveLength(2);
    expect(wires).toContainEqual({ from: { nodeId: add.id, pin: 0 }, to: { nodeId: out.id, pin: 0 } });
    expect(wires).toContainEqual({ from: { nodeId: time.id, pin: 0 }, to: { nodeId: add.id, pin: 0 } });
  });

  it('ignores wires to nodes that no longer exist and never double-feeds an input', () => {
    const { graph, add, out } = samplePatch();
    graph.connections.push({ from: { nodeId: 'ghost', pin: 0 }, to: { nodeId: out.id, pin: 0 } });
    graph.connections.push({ from: { nodeId: add.id, pin: 0 }, to: { nodeId: out.id, pin: 0 } });
    expect(patchConnections(graph)).toHaveLength(2);
  });
});

describe('orderNodes', () => {
  it('follows the signal from source to output in flow order', () => {
    const { graph, time, add, out, stray } = samplePatch();
    const order = orderNodes(graph, 'flow').map((n) => n.id);
    expect(order.indexOf(time.id)).toBeLessThan(order.indexOf(add.id));
    expect(order.indexOf(add.id)).toBeLessThan(order.indexOf(out.id));
    expect(order).toContain(stray.id);
  });

  it('reads left to right in position order', () => {
    const { graph, time, add, stray, out } = samplePatch();
    expect(orderNodes(graph, 'position').map((n) => n.id)).toEqual([time.id, add.id, stray.id, out.id]);
  });

  it('still lists every node when a cycle makes flow order impossible', () => {
    const a = makeNode('Add', 0, 0);
    const b = makeNode('Add', 200, 0);
    a.inputs[0] = b.id;
    b.inputs[0] = a.id;
    const order = orderNodes({ nodes: [a, b], connections: [] }, 'flow');
    expect(order.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('describeNode', () => {
  it('names each input source and each output target', () => {
    const { graph, time, add, out } = samplePatch();
    const desc = describeNode(graph, add);

    expect(desc.label).toBe(`Add #${add.id}`);
    expect(desc.category).toBe('Math');
    expect(desc.inputs[0].from).toMatchObject({ nodeId: time.id, label: `Time #${time.id}`, pinLabel: 't' });
    expect(desc.inputs[1].from).toBeNull();
    expect(desc.outputs[0].to).toEqual([
      expect.objectContaining({ nodeId: out.id, label: `Output #${out.id}`, pinLabel: 'color' }),
    ]);
    expect(desc.params.map((p) => p.name)).toEqual(['a', 'b']);
  });

  it('gives an Output node no output of its own', () => {
    const { out } = samplePatch();
    expect(outputPins(out)).toEqual([]);
  });

  it('reads like a sentence', () => {
    const { graph, add, time } = samplePatch();
    const desc = describeNode(graph, add);
    expect(inputSentence(desc.inputs[0])).toBe(`input A, from Time #${time.id} output t`);
    expect(inputSentence(desc.inputs[1])).toBe('input B, not connected');
    expect(outputSentence(desc.outputs[0])).toMatch(/^output out, feeds Output #\d+ input color$/);
    expect(nodeConnectionSummary(desc)).toBe(
      `2 inputs, 1 connected: from Time #${time.id}. Feeds ${desc.outputs[0].to[0].label}.`,
    );
    expect(nodeFullDescription(desc)).toContain('Parameters: A: 0; B: 0.');
  });

  it('calls a renamed node by its name and its kind', () => {
    const node = makeNode('Add', 0, 0);
    node.name = 'beat gate';
    expect(nodeLabel(node)).toBe(`beat gate (Add) #${node.id}`);
  });
});

describe('summarizePatch', () => {
  it('says what reaches the output, where it starts, and what is left over', () => {
    const { graph, time, add, out, stray } = samplePatch();
    const { text } = summarizePatch(graph);
    expect(text).toContain('4 nodes, 2 wires.');
    expect(text).toContain(`Output #${out.id} is fed by Add #${add.id}.`);
    expect(text).toContain(`The signal starts at Time #${time.id}.`);
    expect(text).toContain(`1 node is not connected: Sin #${stray.id}.`);
  });

  it('notices a patch with no output', () => {
    const node = makeNode('Time', 0, 0);
    expect(summarizePatch({ nodes: [node], connections: [] }).text).toContain('There is no Output node');
    expect(summarizePatch({ nodes: [], connections: [] }).text).toBe('The patch is empty.');
  });
});

describe('formatParamValue', () => {
  it('reads values the way a person would say them', () => {
    expect(formatParamValue(0.123456)).toBe('0.123');
    expect(formatParamValue(-0.0001)).toBe('0');
    expect(formatParamValue(true)).toBe('on');
    expect(formatParamValue('=sin(time * 2)')).toBe('expression =sin(time * 2)');
    expect(formatParamValue([1, 0.5, 0, 1], { type: 'color' })).toBe('#ff8000');
    expect(formatParamValue([1, 0.5, 0, 0.5], { type: 'color' })).toBe('#ff8000, alpha 0.5');
    expect(formatParamValue([0.25, 0.5])).toBe('0.25, 0.5');
    expect(formatParamValue([{}, {}, {}], { type: 'colorstops' })).toBe('gradient, 3 stops');
    expect(formatParamValue('')).toBe('empty');
  });

  it('names pin types in words', () => {
    expect(spokenType('f32')).toBe('number');
    expect(spokenType('vec4')).toBe('colour');
    expect(spokenType('dynamic')).toBe('');
  });
});

describe('outlineSignature', () => {
  it('changes with the wiring and selection, not with parameter values', () => {
    const { graph, add, stray } = samplePatch();
    const before = outlineSignature(graph);

    add.params.a = 42;
    expect(outlineSignature(graph)).toBe(before);

    stray.inputs[0] = add.id;
    const rewired = outlineSignature(graph);
    expect(rewired).not.toBe(before);

    graph.selection = new Set([add.id]);
    expect(outlineSignature(graph)).not.toBe(rewired);
  });
});
