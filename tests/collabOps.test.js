// The op layer: what one artist's edit does to another artist's canvas.
//
// The case worth pinning hardest is the two halves of a wire. A wire lives in
// `graph.connections` (what the renderer draws) AND in `node.inputs[pin]` (what
// codegen, the graph processor and the compute executor read). A sync that
// wrote only the first would produce a canvas that LOOKS wired to the artist
// receiving it and compiles as if it were not — a bug that shows up as a black
// preview three steps later, with nothing on screen pointing at the cause. Half
// of this file exists to make that regression loud.

import { describe, it, expect } from 'vitest';
import { Graph } from '../src/data/Graph.js';
import { makeNode } from '../src/data/NodeDefs.js';
import {
  OpClock,
  applyOp,
  applyOps,
  diffSnapshots,
  snapshotGraph,
  trackLocalOps,
  wireKey,
} from '../src/collab/ops.js';

function graphWith(...nodes) {
  const graph = new Graph();
  for (const node of nodes) graph.add(node);
  return graph;
}

function connect(graph, from, to, pin = 0) {
  graph.connections.push({ from: { nodeId: from.id, pin: 0 }, to: { nodeId: to.id, pin } });
  to.inputs[pin] = from.id;
}

describe('snapshot and diff', () => {
  it('reports a new node as node.add, carrying its parameters', () => {
    const before = snapshotGraph(new Graph());
    const node = makeNode('ConstFloat', 40, 60);
    node.params = { value: 0.5 };
    const after = snapshotGraph(graphWith(node));

    const ops = diffSnapshots(before, after, { by: 'a', at: 1 });
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'node.add', kind: 'ConstFloat', x: 40, y: 60 });
    expect(ops[0].fields.params).toEqual({ value: 0.5 });
  });

  it('ignores sub-pixel drift so an idle canvas sends nothing', () => {
    const node = makeNode('ConstFloat', 10, 10);
    const graph = graphWith(node);
    const before = snapshotGraph(graph);
    node.x += 0.2;
    expect(diffSnapshots(before, snapshotGraph(graph), { by: 'a', at: 1 })).toHaveLength(0);
  });

  it('separates a move from a parameter change', () => {
    const node = makeNode('ConstFloat', 0, 0);
    const graph = graphWith(node);
    const before = snapshotGraph(graph);
    node.x = 200;
    node.params = { value: 0.9 };

    const ops = diffSnapshots(before, snapshotGraph(graph), { by: 'a', at: 1 });
    expect(ops.map((op) => op.op).sort()).toEqual(['node.move', 'node.set']);
  });

  it('orders removals so a wire never outlives the node it hangs off', () => {
    const source = makeNode('ConstFloat', 0, 0);
    const sink = makeNode('OutputFinal', 100, 0);
    const graph = graphWith(source, sink);
    connect(graph, source, sink);

    const before = snapshotGraph(graph);
    // Delete the way SelectionManager.deleteSelected() does — the node and the
    // wires either side of it. (Graph.remove() alone leaves the wires: it
    // filters on a connection shape this graph stopped using.)
    graph.connections = graph.connections.filter(
      (c) => c.from.nodeId !== source.id && c.to.nodeId !== source.id,
    );
    sink.inputs[0] = null;
    graph.remove(source);
    const ops = diffSnapshots(before, snapshotGraph(graph), { by: 'a', at: 1 });

    const wireIndex = ops.findIndex((op) => op.op === 'wire.remove');
    const nodeIndex = ops.findIndex((op) => op.op === 'node.remove');
    expect(wireIndex).toBeGreaterThanOrEqual(0);
    expect(nodeIndex).toBeGreaterThan(wireIndex);
  });

  it('names the same wire the same way on both sides', () => {
    const conn = { from: { nodeId: '3', pin: 1 }, to: { nodeId: '9', pin: 0 } };
    expect(wireKey(conn)).toBe('3:1>9:0');
  });
});

describe('applying an op', () => {
  it('adds a node with the sender’s id, so later ops address the same node', () => {
    const graph = new Graph();
    const applied = applyOp(graph, {
      op: 'node.add', id: 'remote-1', kind: 'ConstFloat', x: 5, y: 6, fields: { params: { value: 2 } },
    });
    expect(applied).toBe(true);
    expect(graph.getNode('remote-1')).toMatchObject({ kind: 'ConstFloat', x: 5, y: 6 });
    expect(graph.getNode('remote-1').params).toEqual({ value: 2 });
  });

  it('skips a node kind this build has never heard of instead of throwing', () => {
    const graph = new Graph();
    expect(() => applyOp(graph, { op: 'node.add', id: 'x', kind: 'NodeFromTheFuture', x: 0, y: 0 }))
      .not.toThrow();
    expect(graph.nodes).toHaveLength(0);
  });

  it('writes both halves of a wire', () => {
    const source = makeNode('ConstFloat', 0, 0);
    const sink = makeNode('OutputFinal', 100, 0);
    const graph = graphWith(source, sink);

    applyOp(graph, {
      op: 'wire.add',
      key: `${source.id}:0>${sink.id}:0`,
      wire: { from: { nodeId: source.id, pin: 0 }, to: { nodeId: sink.id, pin: 0 } },
    });

    expect(graph.connections).toHaveLength(1);
    // The half everything downstream actually reads.
    expect(sink.inputs[0]).toBe(source.id);
  });

  it('clears both halves when a wire is removed', () => {
    const source = makeNode('ConstFloat', 0, 0);
    const sink = makeNode('OutputFinal', 100, 0);
    const graph = graphWith(source, sink);
    connect(graph, source, sink);

    applyOp(graph, {
      op: 'wire.remove',
      key: `${source.id}:0>${sink.id}:0`,
      wire: { from: { nodeId: source.id, pin: 0 }, to: { nodeId: sink.id, pin: 0 } },
    });

    expect(graph.connections).toHaveLength(0);
    expect(sink.inputs[0]).toBeNull();
  });

  it('replaces rather than stacks when a second wire lands on one input pin', () => {
    const first = makeNode('ConstFloat', 0, 0);
    const second = makeNode('ConstFloat', 0, 50);
    const sink = makeNode('OutputFinal', 100, 0);
    const graph = graphWith(first, second, sink);
    connect(graph, first, sink);

    applyOp(graph, {
      op: 'wire.add',
      key: `${second.id}:0>${sink.id}:0`,
      wire: { from: { nodeId: second.id, pin: 0 }, to: { nodeId: sink.id, pin: 0 } },
    });

    expect(graph.connections).toHaveLength(1);
    expect(sink.inputs[0]).toBe(second.id);
  });

  it('detaches downstream inputs when the node feeding them is removed', () => {
    const source = makeNode('ConstFloat', 0, 0);
    const sink = makeNode('OutputFinal', 100, 0);
    const graph = graphWith(source, sink);
    connect(graph, source, sink);

    applyOp(graph, { op: 'node.remove', id: source.id });

    expect(graph.getNode(source.id)).toBeUndefined();
    expect(graph.connections).toHaveLength(0);
    // Without this the sink still points at a node that no longer exists and
    // codegen resolves the operand to nothing.
    expect(sink.inputs[0]).toBeNull();
  });

  it('drops wires INTO a removed node, not only the ones out of it', () => {
    const source = makeNode('ConstFloat', 0, 0);
    const sink = makeNode('OutputFinal', 100, 0);
    const graph = graphWith(source, sink);
    connect(graph, source, sink);

    applyOp(graph, { op: 'node.remove', id: sink.id });

    // A connection naming a node that is gone survives every later diff as a
    // wire nobody can see and nobody can delete.
    expect(graph.connections).toHaveLength(0);
  });
});

describe('last-writer-wins ordering', () => {
  it('keeps the newer edit when a stale one arrives late', () => {
    const node = makeNode('ConstFloat', 0, 0);
    const graph = graphWith(node);
    const clock = new OpClock();

    applyOps(graph, [{ op: 'node.move', id: node.id, x: 100, y: 0, by: 'b', at: 5 }], clock);
    const result = applyOps(graph, [{ op: 'node.move', id: node.id, x: 10, y: 0, by: 'a', at: 3 }], clock);

    expect(result.applied).toBe(0);
    expect(node.x).toBe(100);
  });

  it('breaks a tie the same way on every peer', () => {
    const build = () => {
      const node = makeNode('ConstFloat', 0, 0);
      return { node, graph: graphWith(node), clock: new OpClock() };
    };
    const a = build();
    const b = build();
    const opA = { op: 'node.move', id: a.node.id, x: 10, y: 0, by: 'aaa', at: 4 };
    const opB = { op: 'node.move', id: b.node.id, x: 20, y: 0, by: 'zzz', at: 4 };

    // Same two edits, opposite arrival order, one answer.
    applyOps(a.graph, [opA, { ...opB, id: a.node.id }], a.clock);
    applyOps(b.graph, [{ ...opB, id: b.node.id }], b.clock);
    applyOps(b.graph, [{ ...opA, id: b.node.id }], b.clock);

    expect(a.node.x).toBe(20);
    expect(b.node.x).toBe(20);
  });

  it('does not let a remote echo undo a local edit', () => {
    const node = makeNode('ConstFloat', 0, 0);
    const graph = graphWith(node);
    const clock = new OpClock();

    const before = snapshotGraph(graph);
    node.x = 300;
    const localOps = diffSnapshots(before, snapshotGraph(graph), { by: 'me', at: 9 });
    trackLocalOps(localOps, clock);

    // The relay fans our own op back to us, and an older one from elsewhere.
    applyOps(graph, [...localOps, { op: 'node.move', id: node.id, x: 0, y: 0, by: 'other', at: 2 }], clock);
    expect(node.x).toBe(300);
  });

  it('ignores an op it does not understand rather than failing the batch', () => {
    const node = makeNode('ConstFloat', 0, 0);
    const graph = graphWith(node);
    const result = applyOps(graph, [
      { op: 'node.teleport', id: node.id, by: 'a', at: 1 },
      { op: 'node.move', id: node.id, x: 7, y: 7, by: 'a', at: 2 },
    ], new OpClock());

    expect(result.skipped).toBe(1);
    expect(result.applied).toBe(1);
    expect(node.x).toBe(7);
  });
});

describe('adopting a room’s canvas', () => {
  it('converges a stale canvas onto the snapshot it is sent', () => {
    const mine = graphWith(makeNode('ConstFloat', 0, 0));

    const theirNode = makeNode('ConstFloat', 500, 500);
    theirNode.id = 'room-1';
    const theirSink = makeNode('OutputFinal', 700, 500);
    theirSink.id = 'room-2';
    const theirs = graphWith(theirNode, theirSink);
    connect(theirs, theirNode, theirSink);
    const roomSnapshot = snapshotGraph(theirs);

    const ops = diffSnapshots(snapshotGraph(mine), roomSnapshot, { by: 'room', at: 0 });
    applyOps(mine, ops, null);

    expect(snapshotGraph(mine)).toEqual(roomSnapshot);
    expect(mine.getNode('room-2').inputs[0]).toBe('room-1');
  });
});
