// A =node_<id> reference must NOT be cached (its referenced value can change every frame), and a
// scalar node's pin-0 reference (=node_<id>_0) must resolve on the CPU. Regression cover for the
// "green text / value preview frozen" and "node_X_0 reads 0" reports.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ParameterExpressionSystem } from '../src/utils/ParameterExpressionSystem.js';

describe('node-reference expression liveness (CPU readout)', () => {
  let es, node;

  beforeEach(() => {
    es = new ParameterExpressionSystem();
    // A single-output scalar node whose live preview value we mutate between evals.
    node = { id: '7', kind: 'Remap', params: {}, __preview: 0.2 };
    globalThis.window = globalThis.window || {};
    window.editor = { graph: { nodes: [node] }, previewComputer: { lastComputedValues: new Map([['7', 0.2]]) } };
  });

  afterEach(() => {
    delete window.editor;
  });

  const consumer = { id: 'c', kind: 'ConstFloat', params: {} };

  it('re-evaluates =node_<id> instead of returning a stale cached value', () => {
    expect(es.evaluateExpression('=node_7', {}, consumer)).toBeCloseTo(0.2);
    // Referenced node's live value moves; the readout must follow, not stay cached.
    node.__preview = 0.9;
    window.editor.previewComputer.lastComputedValues.set('7', 0.9);
    expect(es.evaluateExpression('=node_7', {}, consumer)).toBeCloseTo(0.9);
  });

  it('resolves =node_<id>_0 (pin 0) for a single-output scalar node', () => {
    expect(es.evaluateExpression('=node_7_0', {}, consumer)).toBeCloseTo(0.2);
    node.__preview = 0.55;
    window.editor.previewComputer.lastComputedValues.set('7', 0.55);
    expect(es.evaluateExpression('=node_7_0', {}, consumer)).toBeCloseTo(0.55);
  });
});
