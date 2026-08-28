// tests/loadedSecondTexture.test.js
//
// Two Texture 2D nodes in one loaded patch. Both must come back with a real
// texture bound: an unresolved binding falls through to a 1x1 WHITE dummy in
// both renderers, which is exactly what a node showing flat white looks like.
//
// This walks the real load path — TextureManager, restorePatchTextures,
// GPURenderer's binding lookup — rather than stubs of it, because the failure
// being chased only ever showed up for the SECOND node.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextureManager } from '../src/core/TextureManager.js';
import { restorePatchTextures } from '../src/core/patchTextures.js';
import { GPURenderer } from '../src/gpu/gpuRenderer.js';

function fakeDevice() {
  return {
    createTexture: vi.fn((descriptor) => {
      const texture = { descriptor, destroy: vi.fn() };
      texture.createView = () => ({ of: texture });
      return texture;
    }),
    createSampler: vi.fn((descriptor) => ({ ...descriptor })),
    queue: {
      copyExternalImageToTexture: vi.fn(),
      writeTexture: vi.fn(),
    },
  };
}

const patch = (ids) => Object.fromEntries(
  ids.map((id, i) => [id, {
    filename: `image-${i + 1}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    width: 8,
    height: 4,
  }]),
);

describe('two Texture 2D nodes restored from one patch', () => {
  let OriginalImage;
  let manager;
  let renderer;

  beforeEach(() => {
    OriginalImage = globalThis.Image;
    globalThis.Image = class {
      constructor() { this.width = 8; this.height = 4; }
      set src(_value) { queueMicrotask(() => this.onload?.()); }
    };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 8, height: 4 })));

    manager = new TextureManager();
    manager.device = fakeDevice();

    renderer = Object.create(GPURenderer.prototype);
    renderer.device = fakeDevice();

    vi.stubGlobal('window', { textureManager: manager });
  });

  afterEach(() => {
    globalThis.Image = OriginalImage;
    vi.unstubAllGlobals();
  });

  it('binds a real texture for BOTH, not just the first', async () => {
    await restorePatchTextures(manager, patch(['12', '22']));

    for (const id of ['12', '22']) {
      const info = renderer._lookupTextureBinding(manager, `texture_${id}`);
      expect(info, `node ${id} resolved nothing — it would render the white dummy`).toBeTruthy();
      expect(info.textureView).toBeTruthy();
      expect(info.sampler).toBeTruthy();
    }
  });

  it('gives them separate textures, not two views of one', async () => {
    await restorePatchTextures(manager, patch(['12', '22']));

    const first = renderer._lookupTextureBinding(manager, 'texture_12');
    const second = renderer._lookupTextureBinding(manager, 'texture_22');

    expect(second.texture).not.toBe(first.texture);
  });

  it('keeps each node its own filename', async () => {
    await restorePatchTextures(manager, patch(['12', '22']));

    expect(manager.getTexture('12').filename).toBe('image-1.png');
    expect(manager.getTexture('22').filename).toBe('image-2.png');
  });

  it('is unbothered by ten of them at once', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => String(i + 1));
    await restorePatchTextures(manager, patch(ids));

    const unresolved = ids.filter(id => !renderer._lookupTextureBinding(manager, `texture_${id}`)?.textureView);
    expect(unresolved).toEqual([]);
  });

  it('leaves a node whose media the patch never carried clearly empty', async () => {
    // A video over the inline cap is saved with its filename and NO dataUrl (see
    // TextureManager.MAX_INLINE_VIDEO_BYTES). Nothing can be bound for it — the
    // white it renders is honest, and the node keeps its name so the artist can
    // re-drop the file.
    await restorePatchTextures(manager, {
      12: { filename: 'a.png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
      22: { filename: 'huge-clip.mp4', isVideo: true },
    });

    expect(renderer._lookupTextureBinding(manager, 'texture_12')).toBeTruthy();
    expect(renderer._lookupTextureBinding(manager, 'texture_22')).toBeNull();
  });
});
