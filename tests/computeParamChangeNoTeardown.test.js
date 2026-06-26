/**
 * A compute-node parameter edit must NOT tear down the node's GPU manager.
 *
 * Compute parameters are delivered as uniforms (read live each dispatch), so a
 * param edit recompiles via ComputeExecutor.initialize(), whose reuse path keeps
 * the existing manager when the WGSL is unchanged — and only that reuse preserves
 * a feedback node's accumulated ping-pong state. The panel's value manager used
 * to explicitly destroy the manager + delete its registry entry on every compute
 * param change, which wiped feedback nodes on drag-release. This guards against
 * that regression.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExpressionParameterValueManager, expressionSystem } from '../src/utils/ParameterExpressionSystem.js';

describe('compute param edit does not destroy the manager', () => {
  let savedExecutor, savedRegistry, savedEditor;

  beforeEach(() => {
    savedExecutor = window.computeExecutor;
    savedRegistry = window.computeNodeRegistry;
    savedEditor = window.editor;
  });

  afterEach(() => {
    window.computeExecutor = savedExecutor;
    window.computeNodeRegistry = savedRegistry;
    window.editor = savedEditor;
  });

  it('keeps the registry entry and manager, and recompiles via onChange', () => {
    const node = { id: '28', kind: 'ComputeFeedback', params: { decay: 0.95 } };
    const graph = { nodes: [node], connections: [] };

    const destroy = vi.fn();
    const manager = { destroy };
    window.computeExecutor = {
      computeManagers: new Map([['28', manager]]),
      computeTextures: new Map([['28', { texture: {} }]]),
      nodeOutputs: new Map([['28', {}]]),
      inputHashes: new Map([['28', 'h']]),
      _deferDestroy: (fn) => fn(),
    };
    window.computeNodeRegistry = new Map([['28', { node }]]);

    const onChange = vi.fn();
    window.editor = { onChange };

    const vm = new ExpressionParameterValueManager(graph, null, null, expressionSystem);
    vm.setValue(node, 'decay', 0.5);

    // Manager + registry survive the edit (so feedback state is preserved by reuse).
    expect(destroy).not.toHaveBeenCalled();
    expect(window.computeExecutor.computeManagers.has('28')).toBe(true);
    expect(window.computeNodeRegistry.has('28')).toBe(true);

    // The value is stored and a recompile is triggered.
    expect(node.params.decay).toBe(0.5);
    expect(onChange).toHaveBeenCalled();
  });
});
