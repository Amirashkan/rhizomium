// Regression test: node thumbnails must keep the render's aspect ratio.
//
// Bug: "the thumbnails lose their ratio when i change the render ratio."
// _textureToThumbnail always downscaled into a SQUARE size x size target, so a 1920x1080 render
// was squashed into 128x128. Renderer._renderNodeThumbnail fits the thumbnail into the node's
// preview band by the thumbnail's OWN dimensions, so a square thumbnail carrying stretched
// content is drawn square - the distortion has no way to be undone downstream.
//
// Contract: the thumbnail target carries the source aspect ratio (long edge = the thumbnail
// budget), so the downscale never distorts and the node band letterboxes it correctly.

import { describe, it, expect } from 'vitest';
import { ShaderPreviewManager } from '../src/preview/ShaderPreviewManager.js';

const thumbnailSize = (previewThumbSize, texture) =>
  ShaderPreviewManager.prototype._thumbnailSize.call({ previewThumbSize }, texture);

describe('GPU thumbnails preserve the source aspect ratio', () => {
  it('keeps a square source square', () => {
    expect(thumbnailSize(128, { width: 512, height: 512 })).toEqual({ width: 128, height: 128 });
  });

  it('gives a 16:9 render a 16:9 thumbnail instead of a squashed square', () => {
    expect(thumbnailSize(128, { width: 1920, height: 1080 })).toEqual({ width: 128, height: 72 });
  });

  it('handles portrait sources (long edge gets the budget)', () => {
    expect(thumbnailSize(128, { width: 1080, height: 1920 })).toEqual({ width: 72, height: 128 });
  });

  it('never rounds an extreme aspect ratio down to zero pixels', () => {
    const size = thumbnailSize(128, { width: 4096, height: 8 });
    expect(size.width).toBe(128);
    expect(size.height).toBe(1);
  });

  it('falls back to a square when the source reports no size', () => {
    expect(thumbnailSize(64, {})).toEqual({ width: 64, height: 64 });
    expect(thumbnailSize(64, { width: 0, height: 0 })).toEqual({ width: 64, height: 64 });
  });
});
