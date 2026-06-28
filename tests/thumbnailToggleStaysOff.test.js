// Regression test: a node whose per-node preview (the eye/dot button) is toggled OFF must stay off.
//
// Bug: toggleNodePreview clears node.__thumb when switched off, but the CPU thumbnail path in
// PreviewComputer._generateEnhancedThumbnails ran on every computePreviews() (each parameter change
// and on the render loop) and regenerated node.__thumb for every CPU/scalar node without consulting
// the per-node toggle. So a toggled-off thumbnail came right back on the next computation — it
// "wouldn't stay off". The GPU path already honored the toggle (PreviewSystem.generateNodePreview /
// PreviewIntegration._refreshNodePreview); only this CPU path was missing the guard.
//
// Contract: _generateEnhancedThumbnails skips (and clears) the thumbnail of any node whose
// nodePreviews entry has enabled === false.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PreviewComputer } from '../src/core/PreviewComputer.js';

// Drive _generateEnhancedThumbnails without the full computePreviews pipeline. We stub the two
// helpers it calls (topological sort + thumbnail creation) so the test isolates the toggle guard.
function makeHarness() {
  const self = {
    _topologicalSort: (nodes) => nodes, // order is irrelevant for this guard
    _createNodeThumbnail: () => 'CPU_THUMB', // sentinel; real impl needs a canvas context
    _generateEnhancedThumbnails: PreviewComputer.prototype._generateEnhancedThumbnails,
  };
  return self;
}

describe('_generateEnhancedThumbnails honors the per-node preview toggle', () => {
  let previousSpm;
  let previousEditor;

  beforeEach(() => {
    previousSpm = window.shaderPreviewManager;
    previousEditor = window.editor;
    // No GPU preview: keep all nodes on the CPU thumbnail path so the guard under test is exercised.
    window.shaderPreviewManager = { enableGPUPreview: false };
    window.editor = { nodePreviews: new Map() };
  });

  afterEach(() => {
    window.shaderPreviewManager = previousSpm;
    window.editor = previousEditor;
  });

  it('does not regenerate a thumbnail for a node toggled off', () => {
    const node = { id: '1', kind: 'Add', params: {}, __thumb: 'STALE' };
    window.editor.nodePreviews.set('1', { enabled: false });

    makeHarness()._generateEnhancedThumbnails([node], new Map());

    // The toggled-off node keeps no thumbnail: the stale one is cleared and not recreated.
    expect(node.__thumb).toBe(null);
  });

  it('regenerates a thumbnail for a node whose preview is enabled', () => {
    const node = { id: '2', kind: 'Add', params: {}, __thumb: null };
    window.editor.nodePreviews.set('2', { enabled: true });

    makeHarness()._generateEnhancedThumbnails([node], new Map());

    expect(node.__thumb).toBe('CPU_THUMB');
  });

  it('regenerates a thumbnail for a node with no per-node preview entry (default on)', () => {
    const node = { id: '3', kind: 'Add', params: {}, __thumb: null };

    makeHarness()._generateEnhancedThumbnails([node], new Map());

    expect(node.__thumb).toBe('CPU_THUMB');
  });

  it('keeps off nodes off while still refreshing enabled ones in the same pass', () => {
    const off = { id: '4', kind: 'Add', params: {}, __thumb: 'STALE' };
    const on = { id: '5', kind: 'Add', params: {}, __thumb: null };
    window.editor.nodePreviews.set('4', { enabled: false });
    window.editor.nodePreviews.set('5', { enabled: true });

    makeHarness()._generateEnhancedThumbnails([off, on], new Map());

    expect(off.__thumb).toBe(null);
    expect(on.__thumb).toBe('CPU_THUMB');
  });
});
