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

// A device whose textures know their size and whether they were destroyed.
function sizedDevice() {
  const created = [];
  let workDone = null;
  return {
    created,
    createTexture: vi.fn(({ size }) => {
      const t = { width: size.width, height: size.height, destroyed: false };
      t.createView = () => ({ of: t });
      t.destroy = vi.fn(() => { t.destroyed = true; });
      created.push(t);
      return t;
    }),
    createSampler: vi.fn(() => ({})),
    queue: {
      copyExternalImageToTexture: vi.fn(),
      onSubmittedWorkDone: vi.fn(() => new Promise((r) => { workDone = r; })),
    },
    finishWork: () => workDone && workDone(),
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
    // Flagged so a window-local producer (the Text rasteriser) never overwrites the editor's copy.
    expect(tm.gpuTextures.get('node_7').external).toBe(true);
    expect(tm.getTexture('node_7').external).toBe(true);
  });

  it('no-ops without a device', async () => {
    const tm = new TextureManager();
    await tm.injectExternalTexture('n', { width: 1, height: 1 });
    expect(tm.gpuTextures.size).toBe(0);
  });

  it('copies a same-sized re-broadcast into the texture it already has', async () => {
    const tm = new TextureManager();
    tm.device = sizedDevice();
    const first = { width: 64, height: 64, close: vi.fn() };
    await tm.injectExternalTexture('n', first);
    const view = tm.gpuTextures.get('n').textureView;
    tm.bindGroup = { built: true };

    await tm.injectExternalTexture('n', { width: 64, height: 64, close: vi.fn() });

    expect(tm.device.createTexture).toHaveBeenCalledTimes(1);
    expect(tm.device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
    // Same view, so no bind group has to be rebuilt.
    expect(tm.gpuTextures.get('n').textureView).toBe(view);
    expect(tm.bindGroup).toEqual({ built: true });
    expect(first.close).toHaveBeenCalled();
  });

  it('frees the replaced texture once the GPU is done with it when the size changes', async () => {
    const tm = new TextureManager();
    tm.device = sizedDevice();
    await tm.injectExternalTexture('n', { width: 64, height: 64 });
    const old = tm.device.created[0];

    await tm.injectExternalTexture('n', { width: 128, height: 128 });

    expect(tm.gpuTextures.get('n').texture).toBe(tm.device.created[1]);
    expect(tm.bindGroup).toBeNull();
    expect(old.destroy).not.toHaveBeenCalled(); // a frame in flight may still sample it
    tm.device.finishWork();
    await Promise.resolve();
    expect(old.destroy).toHaveBeenCalled();
  });

  it("replaces and frees this window's own Text raster rather than writing into it", async () => {
    const tm = new TextureManager();
    tm.device = sizedDevice();
    const local = tm.device.createTexture({ size: { width: 64, height: 64 } });
    tm.gpuTextures.set('t', { texture: local, textureView: local.createView() });
    tm.textures.set('t', { texture: local, width: 64, height: 64 });

    await tm.injectExternalTexture('t', { width: 64, height: 64 });

    expect(tm.gpuTextures.get('t').texture).not.toBe(local);
    expect(tm.gpuTextures.get('t').external).toBe(true);
    tm.device.finishWork();
    await Promise.resolve();
    expect(local.destroy).toHaveBeenCalled();
  });
});
