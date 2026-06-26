// Regression test: evaluating a parameter expression that references a live input node
// (Mouse/Time/RandomTime) on the CPU must read the live cursor/clock value, not 0.
//
// Bug: the CPU evaluation context only included nodes that the PreviewComputer had computed.
// An unwired Mouse node referenced only by an expression (e.g. radius = "=node_28_x") was never
// computed, so the identifier was undefined and the parameter (and its panel readout) showed 0.00.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { expressionSystem } from '../src/utils/ParameterExpressionSystem.js';

describe('CPU evaluation of live input-node references', () => {
  const circle = { id: '27', kind: 'Circle', params: {} };

  beforeEach(() => {
    window.editor = {
      graph: {
        nodes: [
          { id: '28', kind: 'Mouse', params: {} },
          circle,
        ],
      },
    };
  });

  afterEach(() => {
    delete window.editor;
    delete window._mousePosition;
    expressionSystem.clearCache?.();
  });

  it('reads the live mouse X channel for =node_28_x', () => {
    window._mousePosition = [0.42, 0.73, 0, 0];
    const value = expressionSystem.evaluateExpression('=node_28_x', {}, circle);
    expect(value).toBeCloseTo(0.42, 5);
  });

  it('falls back to screen center (0.5) before any cursor input', () => {
    const value = expressionSystem.evaluateExpression('=node_28_y', {}, circle);
    expect(value).toBeCloseTo(0.5, 5);
  });

  it('supports the mouse reference inside an arithmetic expression', () => {
    window._mousePosition = [0.5, 0.25, 0, 0];
    const value = expressionSystem.evaluateExpression('=node_28_y * 2', {}, circle);
    expect(value).toBeCloseTo(0.5, 5);
  });

  it('resolves a numeric channel index (=node_28_1 == the y channel)', () => {
    window._mousePosition = [0.42, 0.73, 0, 0];
    const value = expressionSystem.evaluateExpression('=node_28_1', {}, circle);
    expect(value).toBeCloseTo(0.73, 5);
  });
});
