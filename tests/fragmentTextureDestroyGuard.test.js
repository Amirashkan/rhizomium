import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';

// The destroy guard and cache-clearing logic don't touch the GPU device, so we can
// exercise them on a real instance with a stub device. We make the deferred-destroy
// path synchronous (computeExecutor._deferDestroy runs immediately) so a destroy that
// is *scheduled* is observable right away — and one that is *held* is observably not.

function makeRenderer() {
  const r = new FragmentTextureRenderer({ /* stub device */ });
  return r;
}

function fakeTexture() {
  return { destroy: vi.fn() };
}

function cache(r, nodeId, w, h) {
  const texture = fakeTexture();
  r.textureCache.set(`${nodeId}_${w}x${h}`, { texture, nodeId, pipeline: {} });
  r.shaderCache.set(nodeId, 'wgsl');
  r.parameterHashes.set(nodeId, 'hash');
  return texture;
}

describe('FragmentTextureRenderer destroy guard', () => {
  beforeEach(() => {
    globalThis.window = globalThis.window || {};
    window.computeExecutor = { _deferDestroy: (fn) => fn() }; // run deferred destroys synchronously
  });
  afterEach(() => {
    if (window) delete window.computeExecutor;
  });

  it('clearCache destroys cached textures and clears all three caches', () => {
    const r = makeRenderer();
    const t1 = cache(r, '25', 256, 256);
    const t2 = cache(r, '30', 256, 256);

    r.clearCache();

    expect(t1.destroy).toHaveBeenCalledTimes(1);
    expect(t2.destroy).toHaveBeenCalledTimes(1);
    expect(r.textureCache.size).toBe(0);
    expect(r.shaderCache.size).toBe(0);
    expect(r.parameterHashes.size).toBe(0); // regression: the old dup clearCache left these
  });

  it('does NOT destroy a held node texture until the read completes', () => {
    const r = makeRenderer();
    const held = cache(r, '25', 256, 256);
    const other = cache(r, '30', 256, 256);

    r.beginRead('25');
    r.clearCache();

    // Held node's texture survives; the unheld one is destroyed immediately.
    expect(held.destroy).not.toHaveBeenCalled();
    expect(other.destroy).toHaveBeenCalledTimes(1);

    r.endRead('25');
    expect(held.destroy).toHaveBeenCalledTimes(1); // flushed once the read finished
  });

  it('invalidateNode respects the read hold and clears the per-node hash', () => {
    const r = makeRenderer();
    const t = cache(r, '25', 256, 256);

    r.beginRead('25');
    r.invalidateNode('25');
    expect(t.destroy).not.toHaveBeenCalled();
    expect(r.parameterHashes.has('25')).toBe(false);
    expect(r.shaderCache.has('25')).toBe(false);

    r.endRead('25');
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });

  it('nested reads only release the hold after the last endRead', () => {
    const r = makeRenderer();
    const t = cache(r, '25', 256, 256);

    r.beginRead('25');
    r.beginRead('25');
    r.invalidateNode('25');

    r.endRead('25');
    expect(t.destroy).not.toHaveBeenCalled(); // still one reader active
    r.endRead('25');
    expect(t.destroy).toHaveBeenCalledTimes(1);
  });
});
