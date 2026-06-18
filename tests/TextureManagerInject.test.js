import { describe, it, expect, vi } from 'vitest';
import { TextureManager } from '../src/core/TextureManager.js';

function fakeDevice() {
  const view = { _view: true };
  const texture = { createView: () => view };
  return {
    createTexture: vi.fn(() => texture),
    createSampler: vi.fn(() => ({ _sampler: true })),
    queue: { copyExternalImageToTexture: vi.fn() },
    _texture: texture,
    _view: view,
  };
}

describe('TextureManager.injectExternalTexture', () => {
  it('uploads and registers a broadcast texture in both maps, nulling the bind group', async () => {
    const tm = new TextureManager();
    tm.device = fakeDevice();
    tm.bindGroup = { stale: true };

    await tm.injectExternalTexture('node_7', { width: 64, height: 32 });

    expect(tm.device.createTexture).toHaveBeenCalled();
    expect(tm.device.queue.copyExternalImageToTexture).toHaveBeenCalled();
    expect(tm.gpuTextures.get('node_7')).toMatchObject({ textureView: tm.device._view });
    expect(tm.getTexture('node_7')).toMatchObject({ width: 64, height: 32 });
    expect(tm.bindGroup).toBeNull();
  });

  it('no-ops without a device', async () => {
    const tm = new TextureManager();
    await tm.injectExternalTexture('n', { width: 1, height: 1 });
    expect(tm.gpuTextures.size).toBe(0);
  });
});
