// Regression test: a fragment node whose parameter references a Mouse node (e.g. a Circle whose
// radius = "=node_5_x") must refresh its GPU thumbnail as the cursor moves.
//
// Bug: notifyMouseInput() recomputed CPU values and redrew the canvas, but never re-rendered the
// GPU thumbnails of mouse-dependent fragment nodes. Only updateAnimatedFragmentPreviews() refreshes
// GPU thumbnails, and it covers time/audio references and compute nodes — not mouse references. So
// the shape tracked the cursor in the main render while its node thumbnail stayed frozen.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PreviewIntegration } from '../src/core/preview/PreviewIntegration.js';

describe('notifyMouseInput refreshes GPU thumbnails of mouse-dependent fragment nodes', () => {
  let prevSpm;

  beforeEach(() => {
    prevSpm = window.shaderPreviewManager;
  });

  afterEach(() => {
    window.shaderPreviewManager = prevSpm;
  });

  it('re-renders the thumbnail of a Circle whose radius references a Mouse node', () => {
    const mouse = { id: '5', kind: 'Mouse', params: {} };
    const circle = { id: '7', kind: 'Circle', params: { radius: '=node_5_x' } };
    const graph = { nodes: [mouse, circle], connections: [] };

    const updateFragmentNodePreview = vi.fn(() => Promise.resolve());
    window.shaderPreviewManager = {
      enableGPUPreview: true,
      isComputeNode: () => false,
      isVisualNode: (n) => n.kind === 'Circle',
      updateFragmentNodePreview,
      updateComputeNodePreview: vi.fn(() => Promise.resolve()),
    };

    // Drive the real method without running the constructor (which schedules timers/RAF).
    const self = Object.create(PreviewIntegration.prototype);
    self.editor = {
      graph,
      previewComputer: { markNodeDirty: vi.fn(), computePreviews: vi.fn() },
      paramPanel: { refreshParameterDisplays: vi.fn() },
      markDirty: vi.fn(),
      draw: vi.fn(),
    };

    self.notifyMouseInput();

    expect(updateFragmentNodePreview).toHaveBeenCalledTimes(1);
    expect(updateFragmentNodePreview).toHaveBeenCalledWith(circle);
  });

  it('does not refresh GPU thumbnails when GPU preview is disabled', () => {
    const mouse = { id: '5', kind: 'Mouse', params: {} };
    const circle = { id: '7', kind: 'Circle', params: { radius: '=node_5_x' } };
    const graph = { nodes: [mouse, circle], connections: [] };

    const updateFragmentNodePreview = vi.fn(() => Promise.resolve());
    window.shaderPreviewManager = {
      enableGPUPreview: false,
      isComputeNode: () => false,
      isVisualNode: (n) => n.kind === 'Circle',
      updateFragmentNodePreview,
      updateComputeNodePreview: vi.fn(() => Promise.resolve()),
    };

    const self = Object.create(PreviewIntegration.prototype);
    self.editor = {
      graph,
      previewComputer: { markNodeDirty: vi.fn(), computePreviews: vi.fn() },
      paramPanel: { refreshParameterDisplays: vi.fn() },
      markDirty: vi.fn(),
      draw: vi.fn(),
    };

    self.notifyMouseInput();

    expect(updateFragmentNodePreview).not.toHaveBeenCalled();
    // CPU recompute + redraw still happen.
    expect(self.editor.previewComputer.computePreviews).toHaveBeenCalled();
    expect(self.editor.draw).toHaveBeenCalled();
  });
});
