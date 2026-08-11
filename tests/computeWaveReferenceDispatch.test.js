// Regression: a compute node whose parameter references a clock-driven Input node
// (`=node_<wave>`) must keep dispatching, because that referenced value moves every frame with no
// param edit to notice.
//
// Bug: hasTimeDependentReferencedNodes resolved each referenced id through window.computeNodeRegistry,
// which only ever holds COMPUTE nodes. A reference to a Wave (or Time, or Random Value) therefore
// resolved to nothing and was judged static, so a compute node driven by one stopped re-dispatching
// until something else marked it dirty. ComputeFeedback happened to be on the executor's own
// TIME_DEPENDENT_NODES list and so survived, but e.g. a ComputeMix whose amount is `=node_<wave>`
// did not.
//
// Fix: fall back to the graph when the registry has no entry, and treat the clock-driven Input
// kinds as time-dependent.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComputeExecutor } from '../src/gpu/ComputeExecutor.js';

describe('hasTimeDependentReferencedNodes', () => {
  let previousRegistry, previousEditor, previousGraph;

  // Exercised off the prototype: the method only reads window state, so this keeps the test clear
  // of the constructor's GPU device.
  const check = (node) =>
    ComputeExecutor.prototype.hasTimeDependentReferencedNodes.call(
      { hasTimeDependentParameters: ComputeExecutor.prototype.hasTimeDependentParameters },
      node
    );

  const withGraph = (nodes) => {
    window.editor = { graph: { nodes } };
    window.graph = { getNode: (id) => nodes.find(n => String(n.id) === String(id)) || null };
  };

  beforeEach(() => {
    previousRegistry = window.computeNodeRegistry;
    previousEditor = window.editor;
    previousGraph = window.graph;
    // Deliberately empty: a Wave is not a compute node, so it is never in here.
    window.computeNodeRegistry = new Map();
  });

  afterEach(() => {
    window.computeNodeRegistry = previousRegistry;
    window.editor = previousEditor;
    window.graph = previousGraph;
  });

  it('sees a Wave reference as animated even though it is not in the compute registry', () => {
    withGraph([{ id: '7', kind: 'Wave', params: {} }]);
    expect(check({ id: 'm', kind: 'ComputeMix', params: { amount: '=node_7' } })).toBe(true);
  });

  it('does the same for the other clock-driven Input nodes', () => {
    withGraph([
      { id: '1', kind: 'Time', params: {} },
      { id: '2', kind: 'RandomValue', params: {} },
    ]);
    expect(check({ id: 'm', kind: 'ComputeMix', params: { amount: '=node_1' } })).toBe(true);
    expect(check({ id: 'm', kind: 'ComputeMix', params: { amount: '=node_2' } })).toBe(true);
  });

  it('still treats a reference to a static node as static', () => {
    // The point of the check is to avoid dispatching every frame for nothing; a plain constant
    // must not start forcing dispatches.
    withGraph([{ id: '5', kind: 'ConstFloat', params: { value: 0.5 } }]);
    expect(check({ id: 'm', kind: 'ComputeMix', params: { amount: '=node_5' } })).toBe(false);
  });

  it('still honours a referenced node with its own time expression', () => {
    withGraph([{ id: '5', kind: 'ConstFloat', params: { value: '=sin(time)' } }]);
    expect(check({ id: 'm', kind: 'ComputeMix', params: { amount: '=node_5' } })).toBe(true);
  });

  it('returns false when nothing is referenced at all', () => {
    withGraph([{ id: '7', kind: 'Wave', params: {} }]);
    expect(check({ id: 'm', kind: 'ComputeMix', params: { amount: 0.5 } })).toBe(false);
  });

  it('still resolves compute references through the registry', () => {
    const noise = { id: '3', kind: 'ComputeNoise', params: {} };
    window.computeNodeRegistry.set('3', { node: noise });
    withGraph([noise]);
    expect(check({ id: 'm', kind: 'ComputeMix', params: { amount: '=node_3' } })).toBe(true);
  });
});
