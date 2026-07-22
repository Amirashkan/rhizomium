// Regression test: updateNodeThumbnailFromTexture must honor the per-node preview toggle.
//
// Bug: the 3D Field Visualizer (ComputeFieldMapper) mirrors its rendered scene into the node's
// editor thumbnail straight from the render loop (~4x/sec) via updateNodeThumbnailFromTexture.
// That path bypasses the PreviewSystem.generateNodePreview funnel where every other path consults
// isNodePreviewEnabled, so a hidden Field Mapper had its thumbnail rewritten on the very next frame
// and could never be turned off — "it is not possible to hide thumbnails".
//
// Contract: updateNodeThumbnailFromTexture consults the editor's isNodePreviewEnabled oracle and
// enqueues no thumbnail work for a node whose preview is off.

import { describe, it, expect } from 'vitest';
import { ShaderPreviewManager } from '../src/preview/ShaderPreviewManager.js';

// Drive updateNodeThumbnailFromTexture via the prototype with a minimal `this` so we don't need a
// real GPU device. We stub the two side effects it would trigger for a visible node.
function makeHarness(off = new Set()) {
  const enqueued = [];
  const self = {
    enableGPUPreview: true,
    editor: {
      _off: off,
      isNodePreviewEnabled(node) { return !this._off.has(node.id); },
    },
    _syncDevice() {},
    _thumbQueue: { set: (id, entry) => enqueued.push({ id, entry }) },
    _processThumbQueue() {},
    updateNodeThumbnailFromTexture: ShaderPreviewManager.prototype.updateNodeThumbnailFromTexture,
  };
  return { self, enqueued };
}

const texture = { usage: 0x04 }; // sampleable sentinel; never read on the skip path

describe('updateNodeThumbnailFromTexture honors per-node preview visibility', () => {
  it('does not enqueue thumbnail work for a node whose preview is off', () => {
    const { self, enqueued } = makeHarness(new Set(['9']));

    self.updateNodeThumbnailFromTexture.call(self, { id: '9', kind: 'ComputeFieldMapper' }, texture);

    expect(enqueued).toEqual([]);
  });

  it('enqueues thumbnail work for a node whose preview is on', () => {
    const { self, enqueued } = makeHarness();

    self.updateNodeThumbnailFromTexture.call(self, { id: '10', kind: 'ComputeFieldMapper' }, texture);

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].id).toBe('10');
  });
});
