// Regression test: a node whose preview is OFF must stay off across preview computations.
//
// Bug: toggleNodePreview clears node.__thumb when switched off, but the CPU thumbnail path in
// PreviewComputer._generateEnhancedThumbnails ran on every computePreviews() (each parameter change
// and on the render loop) and regenerated node.__thumb for every CPU/scalar node without consulting
// the per-node visibility. So a hidden thumbnail came right back on the next computation — it
// "wouldn't stay off".
//
// Contract: _generateEnhancedThumbnails consults editor.isNodePreviewEnabled (the single source of
// truth that folds in both the explicit toggle and the per-kind default) and clears/skips the
// thumbnail of any node whose preview is off.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PreviewComputer } from '../src/core/PreviewComputer.js';

// Drive _generateEnhancedThumbnails without the full computePreviews pipeline. We stub the two
// helpers it calls (topological sort + thumbnail creation) so the test isolates the visibility guard.
function makeHarness() {
  return {
    _topologicalSort: (nodes) => nodes, // order is irrelevant for this guard
    _createNodeThumbnail: () => 'CPU_THUMB', // sentinel; real impl needs a canvas context
    _generateEnhancedThumbnails: PreviewComputer.prototype._generateEnhancedThumbnails,
  };
}

describe('_generateEnhancedThumbnails honors per-node preview visibility', () => {
  let previousSpm;
  let previousEditor;

  beforeEach(() => {
    previousSpm = window.shaderPreviewManager;
    previousEditor = window.editor;
    // No GPU preview: keep all nodes on the CPU thumbnail path so the guard under test is exercised.
    window.shaderPreviewManager = { enableGPUPreview: false };
    // Inject a controllable visibility oracle; the real one lives on Editor and is tested separately.
    window.editor = {
      _off: new Set(),
      isNodePreviewEnabled(node) { return !this._off.has(node.id); },
    };
  });

  afterEach(() => {
    window.shaderPreviewManager = previousSpm;
    window.editor = previousEditor;
  });

  it('clears and does not regenerate a thumbnail for a node whose preview is off', () => {
    const node = { id: '1', kind: 'Add', params: {}, __thumb: 'STALE' };
    window.editor._off.add('1');

    makeHarness()._generateEnhancedThumbnails([node], new Map());

    expect(node.__thumb).toBe(null);
  });

  it('regenerates a thumbnail for a node whose preview is on', () => {
    const node = { id: '2', kind: 'Add', params: {}, __thumb: null };

    makeHarness()._generateEnhancedThumbnails([node], new Map());

    expect(node.__thumb).toBe('CPU_THUMB');
  });

  it('keeps off nodes off while still refreshing on nodes in the same pass', () => {
    const off = { id: '4', kind: 'Add', params: {}, __thumb: 'STALE' };
    const on = { id: '5', kind: 'Add', params: {}, __thumb: null };
    window.editor._off.add('4');

    makeHarness()._generateEnhancedThumbnails([off, on], new Map());

    expect(off.__thumb).toBe(null);
    expect(on.__thumb).toBe('CPU_THUMB');
  });
});
