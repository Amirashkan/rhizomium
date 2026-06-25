// Regression test: a node whose thumbnail value comes from a *parameter expression* that
// references another node via `node_<id>` must be recomputed when that referenced node changes.
//
// Bug: PreviewComputer._evaluateDirtyNodes propagated dirtiness to dependents through
// _buildDependentsMap, which only followed wire connections (node.inputs). A Vec2 with
// `=node_28`, or `=node_27 > 1 ? 10 : 20`, or a Switch whose `select` is `=node_X`, depends on the
// referenced node through the expression rather than a wire, so it was never marked dirty when the
// source changed. Its cached value — and therefore the thumbnail regenerated from it — froze, while
// the floating preview (NodeValueComputer, which re-evaluates expressions on demand) stayed correct.
// `=sin(time)` worked only because the literal `time` keyword registers the node as time-animated.
//
// Fix: _buildDependentsMap now also adds a reverse edge from each `node_<id>` referenced in a
// parameter expression to the node that references it, so expression-only dependents are dirtied
// alongside wired ones.

import { describe, it, expect, beforeEach } from 'vitest';
import { PreviewComputer } from '../src/core/PreviewComputer.js';

describe('PreviewComputer expression-reference dirty propagation', () => {
  let computer;

  beforeEach(() => {
    computer = new PreviewComputer();
  });

  it('_buildDependentsMap records expression references as dependents', () => {
    const nodes = [
      { id: '27', kind: 'Time', inputs: [], params: {} },
      { id: '5', kind: 'ConstVec2', inputs: [], params: { x: '=node_27 > 1 ? 10 : 20', y: '0' } },
    ];

    const map = computer._buildDependentsMap(nodes);

    expect(map.get('27')).toBeInstanceOf(Set);
    expect(map.get('27').has('5')).toBe(true);
  });

  it('also follows bare node references and Switch select expressions', () => {
    const nodes = [
      { id: '28', kind: 'ConstFloat', inputs: [], params: { value: '0.5' } },
      { id: '6', kind: 'ConstVec2', inputs: [], params: { x: '=node_28', y: '1' } },
      { id: '7', kind: 'Switch', inputs: ['a', 'b'], params: { select: '=node_28' } },
    ];

    const map = computer._buildDependentsMap(nodes);

    expect(map.get('28').has('6')).toBe(true);
    expect(map.get('28').has('7')).toBe(true);
    // Wire-based edges still work alongside the new expression edges.
    expect(map.get('a').has('7')).toBe(true);
    expect(map.get('b').has('7')).toBe(true);
  });

  it('does not create a self-edge for a self-referencing expression', () => {
    const nodes = [
      { id: '9', kind: 'ConstFloat', inputs: [], params: { value: '=node_9 + 1' } },
    ];

    const map = computer._buildDependentsMap(nodes);

    expect(map.get('9')?.has('9') ?? false).toBe(false);
  });

  it('marks an expression-only dependent dirty when its referenced node changes', () => {
    const graph = {
      nodes: [
        { id: '27', kind: 'ConstFloat', inputs: [], params: { value: '2' } },
        { id: '5', kind: 'ConstVec2', inputs: [], params: { x: '=node_27 > 1 ? 10 : 20', y: '0' } },
      ],
      connections: [],
    };
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));

    // Prime the computer's change-detection caches so the next pass starts from a clean,
    // structurally-unchanged baseline (otherwise the first pass dirties everything).
    computer.graphStructureHash = computer._computeGraphStructureHash(graph);
    for (const node of graph.nodes) {
      computer.lastParameterHashes.set(node.id, computer._computeParameterHash(node));
      computer.lastComputedInputs.set(node.id, computer._snapshotNodeInputs(node));
    }

    // The user changes the referenced node — node_27 — only.
    byId.get('27').params.value = '0';

    const { dirtyNodes } = computer._evaluateDirtyNodes(graph, graph.nodes, byId);

    expect(dirtyNodes.has('27')).toBe(true);
    expect(dirtyNodes.has('5')).toBe(true); // would be missing before the fix
  });
});
