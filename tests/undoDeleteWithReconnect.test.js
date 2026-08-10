// Regression tests: deleting a node is a single undo step, bypass wire included.
//
// Bug: deleting a node in the middle of a chain re-wires its neighbours around the gap
// (SelectionManager._autoReconnectWires) and recorded that bypass wire as its own undo entry,
// after the DELETE_NODE entry. The first Ctrl+Z only removed the bypass wire and the node stayed
// deleted; a second Ctrl+Z was needed to bring it back.
//
// Contract locked in: the deletion and the re-wiring go on the undo stack as one entry
// (UndoManager transactions), so one Ctrl+Z restores the node with its original wires and drops
// the bypass, and one Ctrl+Shift+Z deletes it again.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UndoManager } from '../src/core/UndoManager.js';
import { SelectionManager } from '../src/core/SelectionManager.js';
import { makeNode } from '../src/data/NodeDefs.js';

/** Wire source -> target (pin 0), keeping graph.connections and node.inputs in sync. */
function connect(graph, source, target, pin = 0) {
  if (!target.inputs) target.inputs = [];
  while (target.inputs.length <= pin) target.inputs.push(null);
  target.inputs[pin] = source.id;
  graph.connections.push({ from: { nodeId: source.id, pin: 0 }, to: { nodeId: target.id, pin } });
}

describe('deleting a node in a chain', () => {
  let graph;
  let undoManager;
  let selection;
  let a, b, c;
  let previousHandlers;

  beforeEach(() => {
    graph = { nodes: [], connections: [], selection: new Set() };
    undoManager = new UndoManager(graph, null);
    selection = new SelectionManager(graph, () => {});
    selection.setUndoManager(undoManager);

    previousHandlers = {
      undoManager: window.undoManager,
      onNodeDeleted: window.onNodeDeleted,
      onGroupDeleted: window.onGroupDeleted,
      onConnectionCreated: window.onConnectionCreated,
    };

    // Same wiring main.js installs
    window.undoManager = undoManager;
    window.onNodeDeleted = (node) => undoManager.recordNodeDeletion(node);
    window.onGroupDeleted = (nodes) => undoManager.recordGroupDeletion(nodes);
    window.onConnectionCreated = (s, t, i, o) =>
      undoManager.recordConnectionCreation(s, t, i, o);

    // A -> B -> C
    a = makeNode('Time', 0, 0);
    b = makeNode('Sin', 100, 0);
    c = makeNode('Sin', 200, 0);
    graph.nodes.push(a, b, c);
    connect(graph, a, b);
    connect(graph, b, c);
  });

  afterEach(() => {
    window.undoManager = previousHandlers.undoManager;
    window.onNodeDeleted = previousHandlers.onNodeDeleted;
    window.onGroupDeleted = previousHandlers.onGroupDeleted;
    window.onConnectionCreated = previousHandlers.onConnectionCreated;
  });

  it('records the deletion and the bypass wire as a single undo step', () => {
    graph.selection = new Set([b.id]);
    selection.deleteSelected();

    // The neighbours are re-wired around the gap
    expect(graph.nodes.map(n => n.id)).toEqual([a.id, c.id]);
    expect(graph.connections).toHaveLength(1);
    expect(graph.connections[0].from.nodeId).toBe(a.id);
    expect(graph.connections[0].to.nodeId).toBe(c.id);
    expect(c.inputs[0]).toBe(a.id);

    expect(undoManager.undoStack).toHaveLength(1);
    expect(undoManager.undoStack[0].type).toBe('COMPOSITE');
    expect(undoManager.undoStack[0].actions.map(x => x.type)).toEqual([
      'DELETE_NODE',
      'CREATE_CONNECTION',
    ]);
  });

  it('restores the node and its original wires with a single undo', () => {
    graph.selection = new Set([b.id]);
    selection.deleteSelected();

    expect(undoManager.undo()).toBe(true);

    // Back in its original slot, not appended at the end (node order is draw order)
    expect(graph.nodes.map(n => n.id)).toEqual([a.id, b.id, c.id]);

    // Original chain is back and the bypass is gone
    const restoredB = graph.nodes.find(n => n.id === b.id);
    const restoredC = graph.nodes.find(n => n.id === c.id);
    expect(restoredB.inputs[0]).toBe(a.id);
    expect(restoredC.inputs[0]).toBe(b.id);
    expect(graph.connections).toHaveLength(2);
    expect(graph.connections.some(x => x.from.nodeId === a.id && x.to.nodeId === c.id)).toBe(false);

    expect(undoManager.undoStack).toHaveLength(0);
  });

  it('deletes the node and re-wires the bypass again with a single redo', () => {
    graph.selection = new Set([b.id]);
    selection.deleteSelected();
    undoManager.undo();

    expect(undoManager.redo()).toBe(true);

    expect(graph.nodes.map(n => n.id)).toEqual([a.id, c.id]);
    expect(graph.connections).toHaveLength(1);
    expect(graph.connections[0].from.nodeId).toBe(a.id);
    expect(graph.connections[0].to.nodeId).toBe(c.id);
    expect(graph.nodes.find(n => n.id === c.id).inputs[0]).toBe(a.id);
  });

  it('still records a leaf deletion (nothing to re-wire) as one undo step', () => {
    graph.selection = new Set([c.id]);
    selection.deleteSelected();

    expect(undoManager.undoStack).toHaveLength(1);
    expect(undoManager.undoStack[0].type).toBe('DELETE_NODE');

    expect(undoManager.undo()).toBe(true);
    expect(graph.nodes.map(n => n.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it('records nothing when the selection is empty', () => {
    graph.selection = new Set();
    selection.deleteSelected();

    expect(undoManager.undoStack).toHaveLength(0);
    expect(graph.nodes).toHaveLength(3);
  });

  it('restores the node wired to its neighbours, not to itself', () => {
    // The recorded connection lists file the same wire under both "incoming" and "outgoing"
    // (SelectionManager._findAllNodeConnections), so restoring an "outgoing" entry onto the
    // restored node used to point its input at its own id.
    graph.selection = new Set([b.id]);
    selection.deleteSelected();
    undoManager.undo();

    const restoredB = graph.nodes.find(n => n.id === b.id);
    expect(restoredB.inputs).not.toContain(b.id);
    expect(graph.connections.some(x => x.from.nodeId === x.to.nodeId)).toBe(false);
  });
});

describe('deleting several nodes at once', () => {
  let graph;
  let undoManager;
  let selection;
  let a, b, c, d;
  let previousHandlers;

  beforeEach(() => {
    graph = { nodes: [], connections: [], selection: new Set() };
    undoManager = new UndoManager(graph, null);
    selection = new SelectionManager(graph, () => {});
    selection.setUndoManager(undoManager);

    previousHandlers = {
      undoManager: window.undoManager,
      onNodeDeleted: window.onNodeDeleted,
      onGroupDeleted: window.onGroupDeleted,
      onConnectionCreated: window.onConnectionCreated,
    };

    window.undoManager = undoManager;
    window.onNodeDeleted = (node) => undoManager.recordNodeDeletion(node);
    window.onGroupDeleted = (nodes) => undoManager.recordGroupDeletion(nodes);
    window.onConnectionCreated = (s, t, i, o) =>
      undoManager.recordConnectionCreation(s, t, i, o);

    // A -> B -> C -> D
    a = makeNode('Time', 0, 0);
    b = makeNode('Sin', 100, 0);
    c = makeNode('Sin', 200, 0);
    d = makeNode('Sin', 300, 0);
    graph.nodes.push(a, b, c, d);
    connect(graph, a, b);
    connect(graph, b, c);
    connect(graph, c, d);
  });

  afterEach(() => {
    window.undoManager = previousHandlers.undoManager;
    window.onNodeDeleted = previousHandlers.onNodeDeleted;
    window.onGroupDeleted = previousHandlers.onGroupDeleted;
    window.onConnectionCreated = previousHandlers.onConnectionCreated;
  });

  it('restores the whole chain with a single undo', () => {
    graph.selection = new Set([b.id, c.id]);
    selection.deleteSelected();

    expect(graph.nodes.map(n => n.id)).toEqual([a.id, d.id]);
    expect(undoManager.undoStack).toHaveLength(1);

    expect(undoManager.undo()).toBe(true);

    expect(graph.nodes.map(n => n.id).sort()).toEqual([a.id, b.id, c.id, d.id].sort());
    const [rb, rc, rd] = [b, c, d].map(n => graph.nodes.find(x => x.id === n.id));
    expect(rb.inputs[0]).toBe(a.id);
    expect(rc.inputs[0]).toBe(b.id);
    expect(rd.inputs[0]).toBe(c.id);
    expect(graph.connections).toHaveLength(3);
    expect(graph.connections.some(x => x.from.nodeId === x.to.nodeId)).toBe(false);
  });
});
