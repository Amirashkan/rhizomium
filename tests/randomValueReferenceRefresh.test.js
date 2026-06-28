// Regression test: a fragment node that references a Random Value node via a `=node_<id>` parameter
// expression (e.g. a Circle whose radius is `=node_<random>`) must have its GPU thumbnail re-read
// every frame, because the Random Value is clock-driven and no param/input edit triggers a refresh.
//
// Bug: updateAnimatedFragmentPreviews only collected the downstream of compute nodes,
// expression-time-animated nodes, and Hold nodes — a Random Value reference matched none of those,
// so the consumer's thumbnail froze on a single random value (defeating the node).
//
// Contract: every Random Value node's downstream (following `node_<id>` expression references, not
// just wires) is refreshed each frame.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PreviewIntegration } from '../src/core/preview/PreviewIntegration.js';

function isComputeKind(n) {
  const kind = typeof n === 'string' ? n : n?.kind;
  return !!kind && kind.toLowerCase().startsWith('compute');
}

// Drive updateAnimatedFragmentPreviews without constructing PreviewIntegration (its constructor
// schedules timers / RAF handlers). We only need the method and the helpers it calls.
function makeHarness(graph) {
  const refreshed = [];
  const self = {
    editor: { graph },
    _refreshNodePreview: (node) => refreshed.push(node.id),
    _collectWithDownstream: PreviewIntegration.prototype._collectWithDownstream,
    _buildExpressionDependentsMap: PreviewIntegration.prototype._buildExpressionDependentsMap,
    _extractNodeReferences: PreviewIntegration.prototype._extractNodeReferences,
  };
  PreviewIntegration.prototype.updateAnimatedFragmentPreviews.call(self);
  return refreshed;
}

describe('updateAnimatedFragmentPreviews refreshes Random Value references', () => {
  let previousSpm;
  let previousEditor;

  beforeEach(() => {
    previousSpm = window.shaderPreviewManager;
    previousEditor = window.editor;
    window.shaderPreviewManager = {
      enableGPUPreview: true,
      isComputeNode: isComputeKind,
      // Circle is visual; the Random Value node itself is numeric (not visual).
      isVisualNode: (n) => {
        const kind = typeof n === 'string' ? n : n?.kind;
        return kind !== 'RandomValue' && !isComputeKind(kind);
      },
    };
    window.editor = { paramPanel: null };
  });

  afterEach(() => {
    window.shaderPreviewManager = previousSpm;
    window.editor = previousEditor;
  });

  it('refreshes a Circle whose radius references a Random Value (expression, not wire)', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'RandomValue', inputs: [], params: {} },
        { id: '2', kind: 'Circle', inputs: [], params: { radius: '=node_1' } },
      ],
      connections: [], // referenced via expression only — no wire
    };

    const refreshed = makeHarness(graph);

    expect(refreshed).toContain('2'); // Circle thumbnail tracks the live random value
    expect(refreshed).not.toContain('1'); // Random Value itself has no visual thumbnail
  });

  it('does not refresh consumers when there is no Random Value node', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'ConstFloat', inputs: [], params: { value: 0.5 } },
        { id: '2', kind: 'Circle', inputs: [], params: { radius: '=node_1' } },
      ],
      connections: [],
    };

    const refreshed = makeHarness(graph);

    expect(refreshed).toEqual([]);
  });
});
