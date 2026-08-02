// Regression test: refreshAllThumbnails must redraw EVERY node, on both preview paths.
//
// A thumbnail's shape comes from the texture it was read back from, and that texture is
// sized from the composition. So after a resolution change every existing thumbnail is
// stale in a way nothing else can detect — the nodes themselves are unchanged. This is the
// explicit redraw pass, and it has to cover the whole graph: the reported symptom was that
// only the nodes some later edit happened to touch picked up the new ratio.

import { describe, it, expect, vi } from 'vitest';
import { ShaderPreviewManager } from '../src/preview/ShaderPreviewManager.js';

function makeManager(nodes, { previewSystem = null } = {}) {
  const self = Object.create(ShaderPreviewManager.prototype);
  self.shaderCache = new Map([['stale', 'wgsl']]);
  self.fragmentRenderer = { clearCache: vi.fn() };
  self.editor = { graph: { nodes }, previewSystem };
  self._thumbQueue = new Map();
  self.pendingNodes = new Set();
  return self;
}

describe('ShaderPreviewManager.refreshAllThumbnails', () => {
  it('runs every node through the preview funnel', () => {
    const nodes = [
      { id: '1', kind: 'ComputePattern' },
      { id: '2', kind: 'Rectangle' },
      { id: '3', kind: 'Circle' },
      { id: '4', kind: 'Polygon' },
    ];
    const generateNodePreview = vi.fn();
    const spm = makeManager(nodes, { previewSystem: { generateNodePreview } });

    spm.refreshAllThumbnails();

    expect(generateNodePreview.mock.calls.map(([n]) => n.id)).toEqual(['1', '2', '3', '4']);
  });

  it('drops the fragment texture cache - those textures were rendered at the old size', () => {
    const spm = makeManager([{ id: '1', kind: 'Circle' }], {
      previewSystem: { generateNodePreview: vi.fn() },
    });

    spm.refreshAllThumbnails();

    // The cache keys on the render size, so every entry is unreachable after a resize;
    // leaving them behind would orphan a full set of GPU textures on each change.
    expect(spm.fragmentRenderer.clearCache).toHaveBeenCalledTimes(1);
    expect(spm.shaderCache.size).toBe(0);
  });

  it('keeps going when one node cannot preview', () => {
    const nodes = [{ id: '1', kind: 'Circle' }, { id: '2', kind: 'Rectangle' }, { id: '3', kind: 'Polygon' }];
    const seen = [];
    const generateNodePreview = vi.fn((node) => {
      seen.push(node.id);
      if (node.id === '2') throw new Error('compile failed');
    });
    const spm = makeManager(nodes, { previewSystem: { generateNodePreview } });

    spm.refreshAllThumbnails();

    expect(seen).toEqual(['1', '2', '3']);
  });

  it('falls back to the thumbnail queue when the preview system is not wired yet', () => {
    const spm = makeManager([{ id: '1', kind: 'Circle' }]);
    spm.requestNodePreview = vi.fn();

    spm.refreshAllThumbnails();

    expect(spm.requestNodePreview).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), true);
  });

  it('does nothing on an empty graph', () => {
    const spm = makeManager([]);
    expect(() => spm.refreshAllThumbnails()).not.toThrow();
    expect(spm.fragmentRenderer.clearCache).not.toHaveBeenCalled();
  });
});
