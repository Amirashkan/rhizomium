// Regression test: a node hidden AFTER its preview was enqueued must not have its thumbnail
// rewritten when the queued render finally drains.
//
// Bug: "some nodes (color mix, noise, ...) can not be thumbnail-hidden in the first attempt."
// PreviewSystem.generateNodePreview gates on isNodePreviewEnabled at ENQUEUE time, but the thumbnail
// queue drains asynchronously (one render + GPU readback at a time). If the user clicks the eye to
// hide a node while its render is still queued/in flight, the render lands afterwards and rewrites
// node.__thumb — the thumbnail reappears and the hide only "sticks" on a second click. The in-flight
// render also compiles the node's subgraph shader, which is where the "[Invalid ShaderModule
// fragment-texture-shader-N]" console error came from.
//
// Contract:
//  - _processThumbQueue skips a queued item whose node's preview has since been turned off (no
//    render dispatched).
//  - _textureToThumbnail does not write node.__thumb when the node's preview is off (catches a hide
//    that lands mid-render, after the drain-time gate passed).

import { describe, it, expect, vi } from 'vitest';
import { ShaderPreviewManager } from '../src/preview/ShaderPreviewManager.js';

describe('thumbnail queue honors a hide that lands after enqueue', () => {
  it('_processThumbQueue skips a node whose preview was turned off after it was queued', async () => {
    const off = new Set();
    const nodeFrag = { id: '1', kind: 'ColorMix' };
    const nodeCompute = { id: '2', kind: 'ComputeColorAdjust' };

    const dispatched = [];
    const self = {
      _thumbQueue: new Map(),
      _thumbDraining: false,
      editor: {
        graph: { nodes: [nodeFrag, nodeCompute] },
        isNodePreviewEnabled(node) { return !off.has(node.id); },
      },
      _doFragmentPreview: vi.fn(async (n) => { dispatched.push(['fragment', n.id]); }),
      _doComputePreview: vi.fn(async (n) => { dispatched.push(['compute', n.id]); }),
      _textureToThumbnail: vi.fn(async () => {}),
      fallbackToLegacyPreview: vi.fn(),
      _processThumbQueue: ShaderPreviewManager.prototype._processThumbQueue,
    };

    // Both nodes were enqueued while visible; then the user hid the fragment node.
    self._thumbQueue.set('1', { node: nodeFrag, type: 'fragment' });
    self._thumbQueue.set('2', { node: nodeCompute, type: 'compute' });
    off.add('1');

    await self._processThumbQueue.call(self);

    // Hidden node's render is skipped; the still-visible node still renders.
    expect(dispatched).toEqual([['compute', '2']]);
    expect(self._doFragmentPreview).not.toHaveBeenCalled();
  });

  it('_textureToThumbnail does not rewrite __thumb for a node hidden mid-render', async () => {
    const off = new Set(['7']);
    const node = { id: '7', kind: 'ColorMix', __thumb: null };

    const self = {
      previewThumbSize: 8,
      gpuRenderer: { pixelsToImageData: () => ({}) },
      _renderThumbnailReadback: async () => new Uint8Array(8 * 8 * 4),
      _thumbnailSize: ShaderPreviewManager.prototype._thumbnailSize,
      _textureToThumbnail: ShaderPreviewManager.prototype._textureToThumbnail,
    };

    const prevEditor = globalThis.window?.editor;
    globalThis.window = globalThis.window || {};
    globalThis.window.editor = { isNodePreviewEnabled: (n) => !off.has(n.id) };
    try {
      await self._textureToThumbnail.call(self, { usage: 0x04 }, node);
    } finally {
      globalThis.window.editor = prevEditor;
    }

    expect(node.__thumb).toBeNull();
  });
});
