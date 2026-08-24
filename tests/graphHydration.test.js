// Rebuilding a saved graph — the half of loading a project that the editor and
// the web viewer share.
//
// The reason this is its own module with its own tests: the viewer opens the
// same documents the editor writes, and a viewer that hydrated them its own way
// would drift silently. The symptom would be a patch that renders one way in
// the editor and another in the viewer, with nothing in either place to point
// at. So the rules live here, and SaveLoadManager is checked against them.

import { describe, it, expect } from 'vitest';
import { hydrateNodes, hydrateConnections } from '../src/core/graphHydration.js';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';

const SAVED_NODES = [
  {
    id: 'node_1',
    kind: 'ConstFloat',
    position: { x: 40, y: 80 },
    size: { width: 200, height: 70 },
    value: 0.5,
    min: 0,
    max: 1,
    props: { label: 'amount' },
    inputs: [],
  },
  {
    id: 'node_2',
    kind: 'Circle',
    x: 300,
    y: 120,
    radius: '=node_1',
    inputs: [null, null, null],
  },
  { id: 'node_3', kind: 'OutputFinal', inputs: [null] },
];

const SAVED_CONNECTIONS = [
  { from: { nodeId: 'node_2', pin: 0 }, to: { nodeId: 'node_3', pin: 0 } },
  { from: { nodeId: 'node_1', pin: 0 }, to: { nodeId: 'node_2', pin: 2 } },
];

describe('hydrateNodes', () => {
  it('keeps saved ids exactly, because expressions reference them', () => {
    const nodes = hydrateNodes(SAVED_NODES);
    expect(nodes.map((n) => n.id)).toEqual(['node_1', 'node_2', 'node_3']);
    // Renumbering would leave this expression pointing at nothing.
    expect(nodes[1].radius).toBe('=node_1');
  });

  it('reads both the nested and the flat geometry forms', () => {
    const [first, second] = hydrateNodes(SAVED_NODES);
    expect({ x: first.x, y: first.y, w: first.w, h: first.h }).toEqual({
      x: 40,
      y: 80,
      w: 200,
      h: 70,
    });
    // A node saved before the nested form still loads, with the defaults.
    expect({ x: second.x, y: second.y, w: second.w, h: second.h }).toEqual({
      x: 300,
      y: 120,
      w: 180,
      h: 60,
    });
  });

  it('carries parameter metadata and unknown properties across', () => {
    const [first] = hydrateNodes(SAVED_NODES);
    expect(first.value).toBe(0.5);
    expect(first.min).toBe(0);
    expect(first.max).toBe(1);
    expect(first.props).toEqual({ label: 'amount' });
    // props is copied, not shared: editing a loaded node must not write back
    // into the parsed document.
    expect(first.props).not.toBe(SAVED_NODES[0].props);
  });

  it('sets kind and type together, and tolerates a record with neither', () => {
    const [node] = hydrateNodes([{ id: 7, inputs: [] }]);
    expect(node).toMatchObject({ id: '7', kind: 'Unknown', type: 'Unknown' });
  });

  it('keeps input slots positional, holes included', () => {
    const nodes = hydrateNodes(SAVED_NODES);
    expect(nodes[1].inputs).toEqual([null, null, null]);
  });

  it('returns nothing for nothing', () => {
    expect(hydrateNodes(undefined)).toEqual([]);
    expect(hydrateNodes([])).toEqual([]);
  });
});

describe('hydrateConnections', () => {
  it('wires each connection into the target node’s input slot', () => {
    const nodes = hydrateNodes(SAVED_NODES);
    const connections = hydrateConnections(SAVED_CONNECTIONS, nodes);

    expect(connections).toHaveLength(2);
    expect(nodes[2].inputs[0]).toBe('node_2'); // output ← circle
    expect(nodes[1].inputs[2]).toBe('node_1'); // circle radius ← const
    expect(nodes[1].inputs[0]).toBeNull(); // and the untouched pins stay holes
  });

  it('grows the input array when a connection lands past the saved pin count', () => {
    const nodes = hydrateNodes([{ id: 'a', kind: 'X', inputs: [] }]);
    hydrateConnections([{ from: { nodeId: 'b', pin: 0 }, to: { nodeId: 'a', pin: 2 } }], nodes);
    expect(nodes[0].inputs).toEqual([null, null, 'b']);
  });

  it('normalizes ids to strings so numeric ids still match', () => {
    const nodes = hydrateNodes([{ id: 1, kind: 'X', inputs: [null] }]);
    const connections = hydrateConnections(
      [{ from: { nodeId: 2 }, to: { nodeId: 1, pin: 0 } }],
      nodes,
    );
    expect(connections[0]).toEqual({
      from: { nodeId: '2', pin: 0 },
      to: { nodeId: '1', pin: 0 },
    });
    expect(nodes[0].inputs[0]).toBe('2');
  });

  it('drops a malformed connection rather than throwing the document away', () => {
    const nodes = hydrateNodes(SAVED_NODES);
    const connections = hydrateConnections(
      [null, { from: { nodeId: 'node_1' } }, SAVED_CONNECTIONS[0]],
      nodes,
    );
    expect(connections).toHaveLength(1);
  });

  it('ignores a connection to a node that is not in the document', () => {
    const nodes = hydrateNodes(SAVED_NODES);
    expect(() =>
      hydrateConnections([{ from: { nodeId: 'node_1' }, to: { nodeId: 'gone' } }], nodes),
    ).not.toThrow();
  });
});

describe('SaveLoadManager loads a document through the same rules', () => {
  // Against a stub `this`, avoiding the constructor's timers and IndexedDB —
  // the same approach the other SaveLoadManager tests take.
  function makeManager() {
    return {
      graph: { nodes: [], connections: [] },
      importNodes: SaveLoadManager.prototype.importNodes,
      importConnections: SaveLoadManager.prototype.importConnections,
    };
  }

  it('produces exactly what the shared hydration produces', async () => {
    const manager = makeManager();
    await manager.importNodes(SAVED_NODES);
    manager.importConnections(SAVED_CONNECTIONS);

    const nodes = hydrateNodes(SAVED_NODES);
    const connections = hydrateConnections(SAVED_CONNECTIONS, nodes);

    expect(manager.graph.nodes).toEqual(nodes);
    expect(manager.graph.connections).toEqual(connections);
  });
});
