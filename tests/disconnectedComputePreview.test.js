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
import { getOutputFormat, setOutputFormat } from '../src/ui/OutputFormat.js';

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

  it('does not overwrite a compute node already registered by this build\'s compile pass', () => {
    // An output-reachable node goes through registerComputeNode during compileNodes, which is
    // where the real getInput (its wired texture sources) is captured.
    cn.beginBuild();
    const getInput = () => 'WIRED_INPUT';
    cn.registerComputeNode({ id: '5', kind: 'ComputeBlur', params: {} }, getInput, [800, 600]);
    const existing = window.computeNodeRegistry.get('5');

    const graph = { nodes: [{ id: '5', kind: 'ComputeBlur', params: {} }], connections: [] };
    cn.registerDisconnectedComputeNodes(graph);

    // Same entry object, untouched - re-registering here would replace getInput with a no-op.
    expect(window.computeNodeRegistry.get('5')).toBe(existing);
    expect(window.computeNodeRegistry.get('5').getInput).toBe(getInput);
  });

  it('refreshes an entry left over from an earlier build so its resolution follows the composition', () => {
    const restore = getOutputFormat();
    try {
      // Build 1: the node is disconnected, so it is registered here at the sim size of the day.
      setOutputFormat(1280, 720, 'test');
      cn.beginBuild();
      const node = { id: '5', kind: 'ComputeNoise', params: {} };
      cn.registerDisconnectedComputeNodes({ nodes: [node], connections: [] });
      const first = window.computeNodeRegistry.get('5');
      expect(first.resolution).toEqual([1280, 720]);

      // Build 2 after the composition is resized. The registry survives across builds, so an
      // "already present, leave it alone" rule freezes this entry forever: ComputeExecutor's reuse
      // signature keys on the resolution, so the node would keep its old texture - old shape, old
      // thumbnail ratio - until it happened to be wired into the output.
      setOutputFormat(720, 1280, 'test');
      cn.beginBuild();
      cn.registerDisconnectedComputeNodes({ nodes: [node], connections: [] });

      expect(window.computeNodeRegistry.get('5')).not.toBe(first);
      expect(window.computeNodeRegistry.get('5').resolution).toEqual([720, 1280]);
    } finally {
      setOutputFormat(restore.width, restore.height, 'test');
    }
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
