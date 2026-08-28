/**
 * ops.js — the wire vocabulary of a collab session, and the rules for applying
 * one artist's edit to another artist's canvas.
 *
 * ## Why a snapshot diff rather than hooked mutations
 *
 * The editor changes the graph from a great many places — EventHandler drags,
 * the parameter panel, the node palette, paste, the AI panel's apply step,
 * undo. Hooking every one of them is how a co-editing feature ends up with a
 * silent hole the first time someone adds a call site. So this layer takes the
 * cheaper and far more honest route: it snapshots the graph, diffs the
 * snapshot against the last one it sent, and emits ops for what actually
 * changed. A new mutation path is covered the day it is written, by nobody.
 *
 * The cost is resolution. A diff sees the result of an edit, not the gesture:
 * a drag arrives as a handful of positions rather than a stroke, and two edits
 * inside one tick arrive together. That is the right trade for a shared canvas
 * and the wrong one for a shared text buffer, which is not what this is.
 *
 * ## Convergence, stated plainly
 *
 * Ordering is last-writer-wins per target, on a Lamport clock with the peer id
 * breaking ties (`ops.js` is deterministic: every peer resolves the same pair
 * the same way, so a late op cannot revive a value that a newer edit replaced).
 * That makes concurrent edits *converge*, which is not the same as making them
 * *correct*: two artists dragging the same node land on one position, but two
 * artists restructuring the same branch can still produce a graph neither
 * intended. This is a shared canvas with a consistent view, not an operational
 * transform. docs/collab-space.md says so where an artist can read it.
 *
 * ## The two halves of a wire
 *
 * A wire lives twice — in `graph.connections` as
 * `{from:{nodeId,pin}, to:{nodeId,pin}}`, which is what the renderer draws, and
 * in `node.inputs[pin]`, which is what codegen, the graph processor and the
 * compute executor actually read. Writing only the first produces a graph that
 * LOOKS wired and compiles as if it were not. Every wire op here maintains
 * both, the way ConnectionManager does for wires the artist drags. See
 * src/core/cloneGraph.js, which exists for the same reason.
 */

import { makeNode } from '../data/NodeDefs.js';
import { setInputCount } from '../data/nodeInputs.js';

/** Envelope version. Bump when an op's shape changes, never when one is added. */
export const OPS_VERSION = 1;

/**
 * The per-node properties a snapshot carries besides position.
 *
 * Everything an artist can change about a node instance and nothing the
 * runtime recomputes: a cached preview or a compiled shader has no business
 * crossing the network, and sending one would make every peer's idle graph
 * look permanently dirty to the diff.
 */
const NODE_FIELDS = ['params', 'value', 'expr', 'props', 'inputCount', 'name'];

/** Stable key for a wire, so two peers name the same wire the same way. */
export function wireKey(conn) {
  return `${conn.from.nodeId}:${conn.from.pin}>${conn.to.nodeId}:${conn.to.pin}`;
}

function copyValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

/**
 * A comparable, sendable picture of the graph.
 *
 * Deliberately plain data: the diff has to be able to compare two of these
 * cheaply and often, and the session has to be able to send one as a snapshot
 * to a joining peer.
 */
export function snapshotGraph(graph) {
  const nodes = {};
  for (const node of graph?.nodes || []) {
    if (!node?.id) continue;
    const fields = {};
    for (const key of NODE_FIELDS) {
      if (node[key] !== undefined) fields[key] = copyValue(node[key]);
    }
    nodes[node.id] = {
      kind: node.kind,
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
      fields,
    };
  }

  const wires = {};
  for (const conn of graph?.connections || []) {
    if (!conn?.from?.nodeId || !conn?.to?.nodeId) continue;
    wires[wireKey(conn)] = {
      from: { nodeId: conn.from.nodeId, pin: conn.from.pin },
      to: { nodeId: conn.to.nodeId, pin: conn.to.pin },
    };
  }

  return { nodes, wires };
}

/** Positions move constantly; a sub-pixel difference is not an edit. */
const MOVE_EPSILON = 0.5;

function sameFields(a = {}, b = {}) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The ops that turn `prev` into `next`.
 *
 * Emitted in an order a receiver can apply straight through: nodes appear
 * before the wires that need them, and wires disappear before the nodes they
 * hang off.
 *
 * @param {object} prev - the last snapshot sent
 * @param {object} next - the current snapshot
 * @param {{by: string, at: number}} stamp - peer id and Lamport time
 */
export function diffSnapshots(prev, next, stamp) {
  const ops = [];
  const prevNodes = prev?.nodes || {};
  const nextNodes = next?.nodes || {};
  const prevWires = prev?.wires || {};
  const nextWires = next?.wires || {};

  for (const id of Object.keys(nextNodes)) {
    const after = nextNodes[id];
    const before = prevNodes[id];

    if (!before) {
      ops.push({ ...stamp, op: 'node.add', id, kind: after.kind, x: after.x, y: after.y, fields: after.fields });
      continue;
    }
    if (Math.abs(after.x - before.x) > MOVE_EPSILON || Math.abs(after.y - before.y) > MOVE_EPSILON) {
      ops.push({ ...stamp, op: 'node.move', id, x: after.x, y: after.y });
    }
    if (!sameFields(after.fields, before.fields)) {
      ops.push({ ...stamp, op: 'node.set', id, fields: after.fields });
    }
  }

  for (const key of Object.keys(prevWires)) {
    if (!nextWires[key]) ops.push({ ...stamp, op: 'wire.remove', key, wire: prevWires[key] });
  }

  for (const id of Object.keys(prevNodes)) {
    if (!nextNodes[id]) ops.push({ ...stamp, op: 'node.remove', id });
  }

  for (const key of Object.keys(nextWires)) {
    if (!prevWires[key]) ops.push({ ...stamp, op: 'wire.add', key, wire: nextWires[key] });
  }

  return ops;
}

/**
 * A Lamport clock, so "which edit is newer" has an answer that does not depend
 * on two machines agreeing about the time of day. They never do, and a laptop
 * whose clock is ten minutes fast would otherwise win every conflict for as
 * long as it stayed in the room.
 */
export class LamportClock {
  constructor(peerId, at = 0) {
    this.peerId = peerId;
    this.at = at;
  }

  /** Stamp a local edit. */
  tick() {
    this.at += 1;
    return { by: this.peerId, at: this.at };
  }

  /** Take a remote edit's time into account. */
  observe(at) {
    if (Number.isFinite(at) && at > this.at) this.at = at;
    return this.at;
  }
}

/** True when op `a` is newer than the recorded stamp `b` (ties break on peer id). */
function newer(a, b) {
  if (!b) return true;
  if (a.at !== b.at) return a.at > b.at;
  return String(a.by) > String(b.by);
}

/**
 * The per-target high-water mark that makes last-writer-wins deterministic.
 *
 * Keyed by target *and* aspect (`node:7/pos`, `node:7/fields`, `wire:…`), so
 * moving a node does not make a concurrent parameter change on the same node
 * look stale — they are different edits that happen to share an owner.
 */
export class OpClock {
  constructor() {
    this.marks = new Map();
  }

  /** Record an op as applied. */
  accept(key, stamp) {
    this.marks.set(key, { at: stamp.at, by: stamp.by });
  }

  /** Whether this op should be applied at all. */
  admits(key, stamp) {
    return newer(stamp, this.marks.get(key));
  }
}

function targetKey(op) {
  switch (op.op) {
    case 'node.add':
    case 'node.remove':
      return `node:${op.id}/life`;
    case 'node.move':
      return `node:${op.id}/pos`;
    case 'node.set':
      return `node:${op.id}/fields`;
    case 'wire.add':
    case 'wire.remove':
      return `wire:${op.key}`;
    default:
      return null;
  }
}

function assignFields(node, fields = {}) {
  for (const key of NODE_FIELDS) {
    if (key === 'inputCount') continue;
    if (fields[key] !== undefined) node[key] = copyValue(fields[key]);
  }
  // Pin count is the node's shape, not a value: setting it through the helper
  // keeps `inputs` the right length, which is what a wire op will index into.
  if (Number.isFinite(fields.inputCount)) setInputCount(node, fields.inputCount);
}

function detachInput(graph, nodeId, pin) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (node?.inputs) node.inputs[pin] = null;
  graph.connections = graph.connections.filter(
    (c) => !(c.to.nodeId === nodeId && c.to.pin === pin),
  );
}

/**
 * Apply one remote op to the local graph.
 *
 * Returns true when the graph changed, so the caller knows whether a redraw is
 * owed. Unknown ops are ignored rather than thrown: a peer running a newer
 * build should degrade to "I did not see that edit", never take the room down.
 */
export function applyOp(graph, op) {
  if (!graph || !op?.op) return false;

  switch (op.op) {
    case 'node.add': {
      if (graph.nodes.some((n) => n.id === op.id)) return false;
      let node;
      try {
        node = makeNode(op.kind, op.x, op.y);
      } catch {
        // A peer on a newer build added a node kind this one has never heard
        // of. Skipping it leaves a hole in the canvas, which is visible and
        // recoverable; throwing here would take the whole batch down with it.
        return false;
      }
      if (!node) return false;
      node.id = op.id;
      assignFields(node, op.fields);
      graph.add(node);
      return true;
    }

    case 'node.remove': {
      const node = graph.nodes.find((n) => n.id === op.id);
      if (!node) return false;

      // Both halves of every wire this node was part of, in both directions,
      // and explicitly rather than through `graph.remove()`: that method
      // filters connections on `conn.fromNode`/`conn.toNode`, which the live
      // connection shape (`{from:{nodeId,pin}}`) does not have — so it would
      // leave the wires behind, pointing at a node that no longer exists.
      // Downstream `inputs` entries have to be cleared too, or codegen keeps
      // resolving an operand to a deleted node.
      for (const conn of [...graph.connections]) {
        if (conn.from.nodeId === op.id) detachInput(graph, conn.to.nodeId, conn.to.pin);
      }
      graph.connections = graph.connections.filter(
        (c) => c.from.nodeId !== op.id && c.to.nodeId !== op.id,
      );
      graph.remove(node);
      graph.markExecutionOrderDirty?.();
      return true;
    }

    case 'node.move': {
      const node = graph.nodes.find((n) => n.id === op.id);
      if (!node) return false;
      node.x = op.x;
      node.y = op.y;
      return true;
    }

    case 'node.set': {
      const node = graph.nodes.find((n) => n.id === op.id);
      if (!node) return false;
      assignFields(node, op.fields);
      graph.markNodeDirty?.(node.id);
      return true;
    }

    case 'wire.add': {
      const { from, to } = op.wire || {};
      if (!from || !to) return false;
      const source = graph.nodes.find((n) => n.id === from.nodeId);
      const target = graph.nodes.find((n) => n.id === to.nodeId);
      if (!source || !target) return false;

      // An input pin holds one wire. Replacing rather than appending is what
      // ConnectionManager does, and what the renderer and codegen assume.
      detachInput(graph, to.nodeId, to.pin);
      graph.connections.push({
        from: { nodeId: from.nodeId, pin: from.pin },
        to: { nodeId: to.nodeId, pin: to.pin },
      });
      if (!target.inputs) target.inputs = [];
      target.inputs[to.pin] = source.id;
      graph.markExecutionOrderDirty?.();
      return true;
    }

    case 'wire.remove': {
      const { to } = op.wire || {};
      if (!to) return false;
      const existed = graph.connections.some(
        (c) => c.to.nodeId === to.nodeId && c.to.pin === to.pin,
      );
      if (!existed) return false;
      detachInput(graph, to.nodeId, to.pin);
      graph.markExecutionOrderDirty?.();
      return true;
    }

    default:
      return false;
  }
}

/**
 * Apply a batch, skipping anything an equal-or-newer edit has already settled.
 *
 * @returns {{applied: number, skipped: number, changed: boolean}}
 */
export function applyOps(graph, ops, clock) {
  let applied = 0;
  let skipped = 0;
  let changed = false;

  for (const op of ops || []) {
    const key = targetKey(op);
    if (!key) { skipped += 1; continue; }
    if (clock && !clock.admits(key, op)) { skipped += 1; continue; }
    const did = applyOp(graph, op);
    if (did) {
      applied += 1;
      changed = true;
      clock?.accept(key, op);
    } else {
      skipped += 1;
    }
  }

  return { applied, skipped, changed };
}

/** Record local ops against the same clock, so a remote echo cannot undo them. */
export function trackLocalOps(ops, clock) {
  if (!clock) return;
  for (const op of ops || []) {
    const key = targetKey(op);
    if (key) clock.accept(key, op);
  }
}
