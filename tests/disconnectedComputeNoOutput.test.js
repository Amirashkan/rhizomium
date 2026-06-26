// Regression tests: a compute node placed on the canvas BEFORE the output is wired up must still
// be dispatched so its per-node preview shows real GPU output instead of a placeholder.
//
// Bug: when the graph has no connected OutputFinal, the build/render pipeline bailed before the
// compute nodes were ever registered or dispatched:
//   - buildWGSL returned early (no output chain) before registerDisconnectedComputeNodes, so the
//     compute node never landed in window.computeNodeRegistry.
//   - gpuRenderer.render() returned at the `!this.pipeline` guard before executing compute, so even
//     a registered compute node was never dispatched without a main shader.
// Net effect: "place a new compute node, its thumbnail shows a placeholder until I connect it to
// the output."
//
// Fixes covered here:
//   - buildWGSL registers disconnected compute nodes even when there is no compilable output chain.
//   - GPURenderer._dispatchComputeOnly dispatches the registered compute nodes when there's no main
//     pipeline (the path render() takes at the `!this.pipeline` guard).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildWGSL } from '../src/codegen/glslBuilder.js';
import { GPURenderer } from '../src/gpu/gpuRenderer.js';

describe('buildWGSL registers disconnected compute nodes without a connected output', () => {
  let prevRegistry;
  let prevEditor;

  beforeEach(() => {
    prevRegistry = window.computeNodeRegistry;
    prevEditor = window.editor;
    window.computeNodeRegistry = new Map();
    window.editor = { nodePreviews: new Map() };
  });

  afterEach(() => {
    window.computeNodeRegistry = prevRegistry;
    window.editor = prevEditor;
  });

  it('registers a compute node even when the graph has no OutputFinal at all', () => {
    const graph = {
      nodes: [{ id: '10', kind: 'ComputeNoise', params: {}, inputs: [] }],
      connections: [],
    };

    buildWGSL(graph);

    expect(window.computeNodeRegistry.has('10')).toBe(true);
  });

  it('registers a compute node when an OutputFinal exists but is disconnected', () => {
    const graph = {
      nodes: [
        { id: '10', kind: 'ComputeNoise', params: {}, inputs: [] },
        { id: '99', kind: 'OutputFinal', params: {}, inputs: [] },
      ],
      connections: [],
    };

    buildWGSL(graph);

    expect(window.computeNodeRegistry.has('10')).toBe(true);
  });

  it('does not register non-compute nodes', () => {
    const graph = {
      nodes: [{ id: '1', kind: 'UV', params: {}, inputs: [] }],
      connections: [],
    };

    buildWGSL(graph);

    expect(window.computeNodeRegistry.size).toBe(0);
  });
});

describe('GPURenderer dispatches compute nodes without a main pipeline', () => {
  afterEach(() => {
    delete global.window.computeExecutor;
  });

  // Run real method bodies on a bare object backed by the prototype, so we don't stand up a full
  // WebGPU device. Mirrors the pattern in gpuRendererStateTap.test.js.
  function bare(props = {}) {
    return Object.assign(Object.create(GPURenderer.prototype), props);
  }

  it('_dispatchComputeOnly executes the compute pass and submits when initialized', async () => {
    const submits = [];
    const executedTimes = [];
    global.window.computeExecutor = {
      initialized: true,
      execute: vi.fn(async (encoder, time) => { executedTimes.push(time); }),
    };

    const self = bare({
      device: {
        createCommandEncoder: () => ({ finish: () => 'CMD' }),
        queue: {
          submit: (buffers) => submits.push(buffers),
          onSubmittedWorkDone: () => Promise.resolve(),
        },
      },
    });

    await self._dispatchComputeOnly(1.5);

    expect(global.window.computeExecutor.execute).toHaveBeenCalledTimes(1);
    expect(executedTimes).toEqual([1.5]);
    expect(submits).toEqual([['CMD']]);
  });

  it('_dispatchComputeOnly is a no-op when no compute executor is initialized', async () => {
    const created = [];
    const self = bare({
      device: {
        createCommandEncoder: () => { created.push(1); return { finish: () => 'CMD' }; },
        queue: { submit: () => {}, onSubmittedWorkDone: () => Promise.resolve() },
      },
    });

    // No executor at all.
    await self._dispatchComputeOnly(1.5);
    expect(created).toHaveLength(0);

    // Executor present but not yet initialized.
    global.window.computeExecutor = { initialized: false, execute: vi.fn() };
    await self._dispatchComputeOnly(1.5);
    expect(created).toHaveLength(0);
    expect(global.window.computeExecutor.execute).not.toHaveBeenCalled();
  });
});
