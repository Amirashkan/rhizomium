// Regression test: nodes downstream of a compute node (most importantly the OutputFinal node) must
// have their per-node thumbnail re-read every frame, so they track the live compute output.
//
// Bug: updateAnimatedFragmentPreviews re-read compute nodes and expression-animated nodes (+ their
// downstream) every frame, but NOT the nodes downstream of compute nodes. So in a graph like
// ComputeNoise -> Remap -> OutputFinal, the compute node's thumbnail animated while Remap's
// and OutputFinal's froze on the last frame they were edited — the OutputFinal thumbnail visibly
// diverged from the floating preview (the live main render). The output node "wasn't showing its
// input."
//
// Contract: every node downstream of a compute node is refreshed each frame (compute nodes via
// their own texture-readback path; their downstream visual consumers via _refreshNodePreview).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PreviewIntegration } from '../src/core/preview/PreviewIntegration.js';

function isComputeKind(n) {
  const kind = typeof n === 'string' ? n : n?.kind;
  return !!kind && kind.toLowerCase().startsWith('compute');
}

// Drive updateAnimatedFragmentPreviews without constructing PreviewIntegration (its constructor
// schedules timers / RAF handlers). We only need the method and the two helpers it calls.
function makeHarness(graph) {
  const refreshed = [];
  const self = {
    editor: { graph },
    _lastAnimPreview: -100000, // ensure the 30fps throttle never short-circuits the test
    _refreshNodePreview: (node) => refreshed.push(node.id),
    _collectWithDownstream: PreviewIntegration.prototype._collectWithDownstream,
    // _collectWithDownstream now also follows `node_<id>` expression references, built once here.
    _buildExpressionDependentsMap: PreviewIntegration.prototype._buildExpressionDependentsMap,
    _extractNodeReferences: PreviewIntegration.prototype._extractNodeReferences,
  };
  PreviewIntegration.prototype.updateAnimatedFragmentPreviews.call(self);
  return refreshed;
}

describe('updateAnimatedFragmentPreviews refreshes compute-downstream nodes', () => {
  let previousSpm;
  let previousEditor;

  beforeEach(() => {
    previousSpm = window.shaderPreviewManager;
    previousEditor = window.editor;
    window.shaderPreviewManager = {
      enableGPUPreview: true,
      isComputeNode: isComputeKind,
      isVisualNode: (n) => !isComputeKind(n), // OutputFinal / Remap are visual; compute is not
    };
    // No expression-animated nodes for these tests — isolate the compute-downstream behavior.
    window.editor = { paramPanel: null };
  });

  afterEach(() => {
    window.shaderPreviewManager = previousSpm;
    window.editor = previousEditor;
  });

  it('refreshes the OutputFinal node fed directly by a compute node', () => {
    const graph = {
      nodes: [
        { id: 'c', kind: 'ComputeNoise', inputs: [] },
        { id: 'o', kind: 'OutputFinal', inputs: ['c'] },
      ],
      connections: [{ from: { nodeId: 'c' }, to: { nodeId: 'o' } }],
    };

    const refreshed = makeHarness(graph);

    expect(refreshed).toContain('c'); // compute node itself
    expect(refreshed).toContain('o'); // OutputFinal now tracks the live compute output
  });

  it('refreshes a fragment node and OutputFinal sitting downstream of a compute node', () => {
    const graph = {
      nodes: [
        { id: 'c', kind: 'ComputeNoise', inputs: [] },
        { id: 'r', kind: 'Remap', inputs: ['c'] },
        { id: 'o', kind: 'OutputFinal', inputs: ['r'] },
      ],
      connections: [
        { from: { nodeId: 'c' }, to: { nodeId: 'r' } },
        { from: { nodeId: 'r' }, to: { nodeId: 'o' } },
      ],
    };

    const refreshed = makeHarness(graph);

    expect(refreshed).toContain('c');
    expect(refreshed).toContain('r');
    expect(refreshed).toContain('o');
  });

  it('does not refresh anything when there are no compute or animated nodes', () => {
    const graph = {
      nodes: [
        { id: 'r', kind: 'Remap', inputs: [] },
        { id: 'o', kind: 'OutputFinal', inputs: ['r'] },
      ],
      connections: [{ from: { nodeId: 'r' }, to: { nodeId: 'o' } }],
    };

    const refreshed = makeHarness(graph);

    expect(refreshed).toEqual([]);
  });
});
