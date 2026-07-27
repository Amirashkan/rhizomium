// Fragment-path node previews must render at the composition's aspect.
//
// Bug: _doFragmentPreview passed (size, size) to renderNodeToTexture, so every
// non-compute node previewed into a square target no matter what the output
// format was. Two things go wrong with that, and only one of them is shape:
//
//   1. The generated shader's `u.aspect` uniform is the target's width/height.
//      A square target composes the node at 1:1 while the main preview composes
//      it at the output ratio, so the thumbnail shows a DIFFERENT IMAGE - noise
//      and shapes are laid out over a different field - not merely a squashed
//      one. That is what "the noise nodes do not follow the ratio" looks like.
//
//   2. _thumbnailSize takes its shape from the source texture, so a square
//      source can only ever produce a square thumbnail, undoing the guarantee
//      thumbnailAspectRatio.test.js makes for compute nodes.
//
// Compute nodes already followed the output aspect through
// resolveResolution('sim'); this covers the fragment path.

import { describe, it, expect } from 'vitest';
import { ShaderPreviewManager } from '../src/preview/ShaderPreviewManager.js';
import { setOutputFormat, getOutputFormat } from '../src/ui/OutputFormat.js';

const previewSize = (budget) =>
  ShaderPreviewManager.prototype._fragmentPreviewSize.call({ previewRenderSize: budget }, budget);

describe('fragment-path previews follow the output aspect', () => {
  it('gives a 16:9 composition a 16:9 preview target', () => {
    setOutputFormat(1920, 1080);
    expect(previewSize(256)).toEqual({ width: 256, height: 144 });
  });

  it('gives a portrait composition a portrait preview target', () => {
    setOutputFormat(1080, 1920);
    expect(previewSize(256)).toEqual({ width: 144, height: 256 });
  });

  it('keeps a square composition square', () => {
    setOutputFormat(1024, 1024);
    expect(previewSize(256)).toEqual({ width: 256, height: 256 });
  });

  it('never exceeds the supersampling budget on the long edge', () => {
    setOutputFormat(3840, 2160);
    const { width, height } = previewSize(256);
    expect(Math.max(width, height)).toBe(256);
    expect(width / height).toBeCloseTo(3840 / 2160, 1);
  });

  it('matches the aspect the shader will be handed as u.aspect', () => {
    setOutputFormat(2560, 1080);
    const { width, height } = previewSize(256);
    const out = getOutputFormat();
    // A mismatch here is the thumbnail composing a different image from the
    // main preview, which is the bug this guards.
    expect(width / height).toBeCloseTo(out.width / out.height, 1);
  });
});
