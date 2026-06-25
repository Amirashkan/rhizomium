// Regression tests: a node's preview/thumbnail must reflect a parameter expression that selects
// or reads another node via `node_<id>` (not a wire) — most visibly a Switch whose `select` is
// `=node_28 > 0 ? 1 : 0`.
//
// Two gaps caused the Switch thumbnail to "only show the first input" while the floating preview
// switched correctly:
//   1. FragmentTextureRenderer._extractSubgraph walked only node.inputs (wires), so the referenced
//      node (node_28) was absent from the per-node preview subgraph. Its `node_28` reference then
//      compiled to 0 (unknown identifiers fall back to 0.0), making `select` always 0 → first input.
//   2. PreviewIntegration._collectWithDownstream followed only wires, so when node_28 animated
//      (=sin(time)) the Switch was never collected for a per-frame GPU thumbnail refresh, freezing
//      it even once it picked the right branch.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';
import { PreviewIntegration } from '../src/core/preview/PreviewIntegration.js';

describe('FragmentTextureRenderer subgraph includes expression-referenced nodes', () => {
  let renderer;
  let previousGraph;

  const nodes = [
    { id: '28', kind: 'ConstFloat', inputs: [], params: { value: '=sin(time)' } },
    { id: '3', kind: 'ConstVec3', inputs: [], params: { x: 1, y: 0, z: 0 } },
    { id: '4', kind: 'ConstVec3', inputs: [], params: { x: 0, y: 1, z: 0 } },
    { id: '2', kind: 'Switch', inputs: ['3', '4', null, null], params: { select: '=node_28 > 0 ? 1 : 0' } },
  ];

  beforeEach(() => {
    renderer = new FragmentTextureRenderer(null);
    previousGraph = window.graph;
    window.graph = { getNode: (id) => nodes.find(n => n.id === id) || null };
  });

  afterEach(() => {
    window.graph = previousGraph;
  });

  it('_extractParamNodeReferences finds node ids referenced in a parameter expression', () => {
    const refs = renderer._extractParamNodeReferences(nodes.find(n => n.id === '2'));
    expect(refs).toContain('28');
  });

  it('pulls the expression-referenced node into the Switch subgraph', () => {
    const subgraph = renderer._extractSubgraph(nodes.find(n => n.id === '2'));
    const ids = subgraph.nodes.map(n => n.id);

    // Wired inputs are present...
    expect(ids).toContain('3');
    expect(ids).toContain('4');
    // ...and so is the node referenced only through the `select` expression.
    expect(ids).toContain('28');
    // The referenced node is ordered before the node that references it.
    expect(ids.indexOf('28')).toBeLessThan(ids.indexOf('2'));
  });

  it('does not pull in unrelated nodes', () => {
    const lone = { id: '99', kind: 'ConstFloat', inputs: [], params: { value: 1 } };
    window.graph = { getNode: (id) => [...nodes, lone].find(n => n.id === id) || null };
    const subgraph = renderer._extractSubgraph(nodes.find(n => n.id === '2'));
    expect(subgraph.nodes.map(n => n.id)).not.toContain('99');
  });
});

describe('PreviewIntegration._collectWithDownstream follows expression references', () => {
  // Drive the method off the prototype with a minimal `this`, as the existing live-refresh tests do.
  function makeSelf(graph) {
    return {
      editor: { graph },
      _buildExpressionDependentsMap: PreviewIntegration.prototype._buildExpressionDependentsMap,
      _extractNodeReferences: PreviewIntegration.prototype._extractNodeReferences,
      _collectWithDownstream: PreviewIntegration.prototype._collectWithDownstream,
    };
  }

  it('collects a Switch whose select references an animated node, with no wire between them', () => {
    const graph = {
      nodes: [
        { id: '28', kind: 'ConstFloat', inputs: [], params: { value: '=sin(time)' } },
        { id: '2', kind: 'Switch', inputs: ['3', '4', null, null], params: { select: '=node_28 > 0 ? 1 : 0' } },
      ],
      connections: [], // the Switch depends on node_28 only through the expression
    };
    const self = makeSelf(graph);

    const into = new Set();
    self._collectWithDownstream('28', into, new Set());

    expect(into.has('28')).toBe(true);
    expect(into.has('2')).toBe(true); // would be missing before the fix
  });

  it('still follows wired connections', () => {
    const graph = {
      nodes: [
        { id: 'a', kind: 'ConstFloat', inputs: [], params: {} },
        { id: 'b', kind: 'Multiply', inputs: ['a'], params: {} },
      ],
      connections: [{ from: { nodeId: 'a' }, to: { nodeId: 'b' } }],
    };
    const self = makeSelf(graph);

    const into = new Set();
    self._collectWithDownstream('a', into, new Set());

    expect(into.has('a')).toBe(true);
    expect(into.has('b')).toBe(true);
  });
});
