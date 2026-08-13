// Regression tests: adding a node is a single undo step, wire included.
//
// Bug: dragging a wire out of a pin and Tab-creating a node (AddNodePalette._placeNode) recorded two
// separate undo entries - CREATE_NODE for the node, then CREATE_CONNECTION for the wire the new
// node was auto-connected with. The first Ctrl+Z only removed the wire and left the node behind;
// a second Ctrl+Z was needed to remove the node itself.
//
// Contract locked in: the whole gesture goes on the undo stack as one entry (UndoManager
// transactions), so one Ctrl+Z removes the node and its wire together, and one Ctrl+Shift+Z
// brings both back.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UndoManager } from '../src/core/UndoManager.js';
import { ConnectionManager } from '../src/core/ConnectionManager.js';
import { AddNodePalette } from '../src/ui/AddNodePalette.js';
import { makeNode } from '../src/data/NodeDefs.js';

describe('UndoManager transactions', () => {
  let graph;
  let undoManager;

  beforeEach(() => {
    graph = { nodes: [], connections: [], selection: new Set() };
    undoManager = new UndoManager(graph, null);
  });

  it('folds every action recorded while open into one undo entry', () => {
    const a = makeNode('Time', 0, 0);
    const b = makeNode('Sin', 100, 0);
    graph.nodes.push(a, b);

    undoManager.beginTransaction('add node');
    undoManager.recordNodeCreation(b);
    undoManager.recordConnectionCreation(a.id, b.id, 0);
    // Nothing is visible on the stack until the transaction closes
    expect(undoManager.undoStack).toHaveLength(0);
    undoManager.commitTransaction();

    expect(undoManager.undoStack).toHaveLength(1);
    expect(undoManager.undoStack[0].type).toBe('COMPOSITE');
    expect(undoManager.undoStack[0].actions.map(a => a.type)).toEqual([
      'CREATE_NODE',
      'CREATE_CONNECTION',
    ]);
  });

  it('does not wrap a lone action, and records nothing for an empty transaction', () => {
    const node = makeNode('Time', 0, 0);
    graph.nodes.push(node);

    undoManager.beginTransaction('add node');
    undoManager.recordNodeCreation(node);
    undoManager.commitTransaction();

    expect(undoManager.undoStack).toHaveLength(1);
    expect(undoManager.undoStack[0].type).toBe('CREATE_NODE');

    undoManager.beginTransaction('add node');
    undoManager.commitTransaction();

    expect(undoManager.undoStack).toHaveLength(1);
  });

  it('undoes the sub-actions in reverse order and redoes them in order', () => {
    const a = makeNode('Time', 0, 0);
    const b = makeNode('Sin', 100, 0);
    graph.nodes.push(a, b);
    b.inputs = [a.id];
    graph.connections.push({ from: { nodeId: a.id, pin: 0 }, to: { nodeId: b.id, pin: 0 } });

    undoManager.beginTransaction('add node');
    undoManager.recordNodeCreation(b);
    undoManager.recordConnectionCreation(a.id, b.id, 0);
    undoManager.commitTransaction();

    expect(undoManager.undo()).toBe(true);
    expect(graph.nodes.map(n => n.id)).toEqual([a.id]);
    expect(graph.connections).toHaveLength(0);

    expect(undoManager.redo()).toBe(true);
    expect(graph.nodes.map(n => n.id)).toEqual([a.id, b.id]);
    expect(graph.connections).toHaveLength(1);
    expect(graph.nodes.find(n => n.id === b.id).inputs[0]).toBe(a.id);
  });

  it('aborting a transaction records nothing', () => {
    const node = makeNode('Time', 0, 0);
    graph.nodes.push(node);

    undoManager.beginTransaction('add node');
    undoManager.recordNodeCreation(node);
    undoManager.abortTransaction();

    expect(undoManager.undoStack).toHaveLength(0);
  });
});

describe('AddNodePalette node creation with an active wire drag', () => {
  let graph;
  let undoManager;
  let connections;
  let menu;
  let source;
  let previousHandlers;

  beforeEach(() => {
    graph = { nodes: [], connections: [], selection: new Set() };
    undoManager = new UndoManager(graph, null);
    connections = new ConnectionManager(graph, () => {});

    previousHandlers = {
      undoManager: window.undoManager,
      eventHandler: window.eventHandler,
      editor: window.editor,
      onNodeCreated: window.onNodeCreated,
      onConnectionCreated: window.onConnectionCreated,
      onConnectionDeleted: window.onConnectionDeleted,
    };

    // Same wiring main.js installs
    window.undoManager = undoManager;
    window.eventHandler = { connections };
    window.editor = undefined;
    window.onNodeCreated = (node) => undoManager.recordNodeCreation(node);
    window.onConnectionCreated = (s, t, i, o) =>
      undoManager.recordConnectionCreation(s, t, i, o);
    window.onConnectionDeleted = (data) => undoManager.recordConnectionDeletion(data);

    source = makeNode('Time', 0, 0);
    graph.nodes.push(source);

    menu = new AddNodePalette(graph, () => {});
    menu.canvasPos = { x: 200, y: 120 };
  });

  afterEach(() => {
    window.undoManager = previousHandlers.undoManager;
    window.eventHandler = previousHandlers.eventHandler;
    window.editor = previousHandlers.editor;
    window.onNodeCreated = previousHandlers.onNodeCreated;
    window.onConnectionCreated = previousHandlers.onConnectionCreated;
    window.onConnectionDeleted = previousHandlers.onConnectionDeleted;
  });

  it('records the node and its auto-connected wire as a single undo step', () => {
    connections.startWireDrag(source.id, 0, { x: 200, y: 120 }, false);

    menu._placeNode('Sin');

    const created = graph.nodes.find(n => n.id !== source.id);
    expect(created).toBeDefined();
    expect(graph.connections).toHaveLength(1);
    expect(created.inputs[0]).toBe(source.id);

    // One gesture, one undo entry
    expect(undoManager.undoStack).toHaveLength(1);
    expect(undoManager.undoStack[0].type).toBe('COMPOSITE');
  });

  it('removes the node and the wire with a single undo', () => {
    connections.startWireDrag(source.id, 0, { x: 200, y: 120 }, false);
    menu._placeNode('Sin');

    expect(undoManager.undo()).toBe(true);

    expect(graph.nodes.map(n => n.id)).toEqual([source.id]);
    expect(graph.connections).toHaveLength(0);
    expect(undoManager.undoStack).toHaveLength(0);
  });

  it('restores the node and the wire with a single redo', () => {
    connections.startWireDrag(source.id, 0, { x: 200, y: 120 }, false);
    menu._placeNode('Sin');
    undoManager.undo();

    expect(undoManager.redo()).toBe(true);

    const restored = graph.nodes.find(n => n.id !== source.id);
    expect(restored).toBeDefined();
    expect(graph.connections).toHaveLength(1);
    expect(restored.inputs[0]).toBe(source.id);
  });

  it('still records a plain node add (no wire drag) as one undo step', () => {
    menu._placeNode('Sin');

    expect(graph.nodes).toHaveLength(2);
    expect(undoManager.undoStack).toHaveLength(1);
    expect(undoManager.undoStack[0].type).toBe('CREATE_NODE');

    expect(undoManager.undo()).toBe(true);
    expect(graph.nodes.map(n => n.id)).toEqual([source.id]);
  });
});
