// Regression test: a fragment/visual node driven by an Audio Analysis pin — WIRED from a pin, or
// referencing one via "=node_<id>_N" — must refresh its GPU thumbnail as the audio signal moves.
//
// Bug: updateAnimatedFragmentPreviews() (the per-frame GPU-thumbnail refresh) covered compute nodes,
// time/audio EXPRESSION references, Hold and Random Value — but not Audio Analysis. A shape wired to
// the kick pin (or referencing =node_<id>_2) tracked the audio in the main render while its node
// thumbnail stayed frozen. Fix: collect an Audio Analysis node's downstream (wired + expression) and
// refresh those visual thumbnails whenever any of its level/kick/trig outputs changed this frame.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PreviewIntegration } from '../src/core/preview/PreviewIntegration.js';

describe('updateAnimatedFragmentPreviews refreshes Audio Analysis-driven thumbnails', () => {
  let prevSpm;
  beforeEach(() => { prevSpm = window.shaderPreviewManager; });
  afterEach(() => { window.shaderPreviewManager = prevSpm; });

  function makeSelf(graph) {
    const refreshed = [];
    const self = Object.create(PreviewIntegration.prototype);
    self.editor = { graph };
    // Record refresh calls instead of touching the GPU.
    self._refreshNodePreview = (node) => { refreshed.push(node.id); };
    return { self, refreshed };
  }

  it('refreshes a wired Circle and an expression-ref Circle when audio changes, and skips when steady', () => {
    const audio = { id: '10', kind: 'AudioAnalysis', params: {}, inputs: [] };
    const wired = { id: '11', kind: 'Circle', params: {}, inputs: ['10'] };
    const exprRef = { id: '12', kind: 'Circle', params: { radius: '=node_10_2' }, inputs: [] };
    const graph = {
      nodes: [audio, wired, exprRef],
      connections: [{ from: { nodeId: '10', pin: 1 }, to: { nodeId: '11', pin: 0 } }],
    };

    window.shaderPreviewManager = {
      enableGPUPreview: true,
      isComputeNode: () => false,
      isVisualNode: (n) => n.kind === 'Circle' || n.kind === 'AudioAnalysis',
    };

    const { self, refreshed } = makeSelf(graph);

    // Frame 1: live audio -> both consumers refresh.
    audio.__audio_level = 0.2; audio.__audio_kick = 0.5; audio.__audio_kickTrig = 0;
    self.updateAnimatedFragmentPreviews();
    expect(refreshed).toContain('11'); // wired from kick pin
    expect(refreshed).toContain('12'); // references trig pin

    // Frame 2: nothing changed -> no downstream refresh.
    refreshed.length = 0;
    self.updateAnimatedFragmentPreviews();
    expect(refreshed).toEqual([]);

    // Frame 3: audio moved -> refresh again.
    audio.__audio_level = 0.8; audio.__audio_kick = 0.9; audio.__audio_kickTrig = 1;
    self.updateAnimatedFragmentPreviews();
    expect(refreshed).toContain('11');
    expect(refreshed).toContain('12');
  });

  it('does not refresh anything when GPU preview is disabled', () => {
    const audio = { id: '10', kind: 'AudioAnalysis', params: {}, inputs: [],
      __audio_level: 0.2, __audio_kick: 0.5, __audio_kickTrig: 1 };
    const wired = { id: '11', kind: 'Circle', params: {}, inputs: ['10'] };
    const graph = {
      nodes: [audio, wired],
      connections: [{ from: { nodeId: '10', pin: 1 }, to: { nodeId: '11', pin: 0 } }],
    };
    window.shaderPreviewManager = { enableGPUPreview: false, isComputeNode: () => false, isVisualNode: () => true };
    const { self, refreshed } = makeSelf(graph);
    self.updateAnimatedFragmentPreviews();
    expect(refreshed).toEqual([]);
  });
});
