// Regression tests: compute nodes that are NOT wired into the output must still be registered for
// GPU execution, so their per-node preview shows real output instead of a placeholder.
//
// Bug: buildWGSL only compiles nodes upstream of the active OutputFinal, so a freshly added /
// disconnected compute node never lands in window.computeNodeRegistry. ComputeExecutor then never
// dispatches it and it has no output texture, so ShaderPreviewManager falls back to a CPU
// placeholder until the node is connected into the chain that reaches the output.
//
// Fix: ComputeNodes.registerDisconnectedComputeNodes(graph) registers every compute node the normal
// pass skipped, so the existing compute pipeline dispatches it. These tests cover that registration
// logic (the GPU dispatch/readback itself runs only in the browser).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComputeNodes } from '../src/codegen/compilers/ComputeNodes.js';

describe('registerDisconnectedComputeNodes', () => {
  let cn;
  let previousRegistry;
  let previousEditor;

  beforeEach(() => {
    cn = new ComputeNodes();
    previousRegistry = window.computeNodeRegistry;
    previousEditor = window.editor;
    window.computeNodeRegistry = new Map();
    window.editor = { nodePreviews: new Map() };
  });

  afterEach(() => {
    window.computeNodeRegistry = previousRegistry;
    window.editor = previousEditor;
  });

  it('registers a disconnected compute node so it gets dispatched', () => {
    const graph = { nodes: [{ id: '10', kind: 'ComputeNoise', params: {} }], connections: [] };

    cn.registerDisconnectedComputeNodes(graph);

    expect(window.computeNodeRegistry.has('10')).toBe(true);
    const entry = window.computeNodeRegistry.get('10');
    expect(entry.node.id).toBe('10');
    // It carries compiled WGSL so ComputeExecutor.initialize can build a manager for it.
    expect(typeof entry.wgslCode).toBe('string');
    expect(entry.wgslCode.length).toBeGreaterThan(0);
  });

  it('ignores non-compute nodes', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'UV', params: {} },
        { id: '2', kind: 'Add', params: {} },
      ],
      connections: [],
    };

    cn.registerDisconnectedComputeNodes(graph);

    expect(window.computeNodeRegistry.size).toBe(0);
  });

  it('does not overwrite a compute node already registered by the main compile pass', () => {
    // Simulate an output-reachable compute node registered during compileNodes.
    const existing = { node: { id: '5', kind: 'ComputeBlur' }, wgslCode: 'ALREADY_COMPILED' };
    window.computeNodeRegistry.set('5', existing);

    const graph = { nodes: [{ id: '5', kind: 'ComputeBlur', params: {} }], connections: [] };
    cn.registerDisconnectedComputeNodes(graph);

    // Same entry object, untouched (not regenerated).
    expect(window.computeNodeRegistry.get('5')).toBe(existing);
    expect(window.computeNodeRegistry.get('5').wgslCode).toBe('ALREADY_COMPILED');
  });

  it('skips nodes whose per-node preview is toggled off', () => {
    window.editor.nodePreviews.set('7', { enabled: false });
    const graph = { nodes: [{ id: '7', kind: 'ComputeNoise', params: {} }], connections: [] };

    cn.registerDisconnectedComputeNodes(graph);

    expect(window.computeNodeRegistry.has('7')).toBe(false);
  });

  it('registers nodes whose preview entry exists but is enabled', () => {
    window.editor.nodePreviews.set('8', { enabled: true, size: 'small' });
    const graph = { nodes: [{ id: '8', kind: 'ComputeNoise', params: {} }], connections: [] };

    cn.registerDisconnectedComputeNodes(graph);

    expect(window.computeNodeRegistry.has('8')).toBe(true);
  });

  it('is a no-op for an invalid graph', () => {
    expect(() => cn.registerDisconnectedComputeNodes(null)).not.toThrow();
    expect(() => cn.registerDisconnectedComputeNodes({})).not.toThrow();
    expect(window.computeNodeRegistry.size).toBe(0);
  });
});
