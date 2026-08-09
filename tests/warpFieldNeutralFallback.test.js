import { describe, it, expect } from 'vitest';
import { ComputeShaderManager } from '../src/gpu/ComputeShaderManager.js';

// Run the real method bodies on a bare instance, as ComputeShaderManagerExternal does.
function bare(props = {}) {
  return Object.assign(Object.create(ComputeShaderManager.prototype), props);
}

function fakeDevice() {
  const textures = [];
  return {
    textures,
    queue: {
      writeBuffer: () => {},
      writeTexture: (dest, data) => {
        dest.texture.written = data;
      },
    },
    createTexture: (desc) => {
      const tex = { ...desc, createView: () => ({ __of: tex }) };
      textures.push(tex);
      return tex;
    },
    createBindGroup: (desc) => desc,
  };
}

// The warp shader reads its field as (value - 0.5) * 2, so 0.5 is "no displacement".
// Half-float 0.5 is 0x3800 and 1.0 (opaque alpha) is 0x3C00.
const HALF_NEUTRAL = [0x3800, 0x3800, 0x3800, 0x3c00];

describe('ComputeWarp neutral warp-field fallback', () => {
  it('creates a mid-grey 1x1 field texture for ComputeWarp', () => {
    const device = fakeDevice();
    const mgr = bare({ device, node: { kind: 'ComputeWarp' }, needsInput: true });

    mgr.createNeutralFieldTexture();

    expect(mgr.neutralFieldTexture).toBeTruthy();
    expect(mgr.neutralFieldTexture.format).toBe('rgba16float');
    expect(mgr.neutralFieldTexture.size).toMatchObject({ width: 1, height: 1 });
    // rgba16float carries 0.5 exactly; rgba8unorm's nearest value (128/255) does not.
    expect(Array.from(mgr.neutralFieldTexture.written)).toEqual(HALF_NEUTRAL);
  });

  it('creates nothing for the other nodes that bind a second input at binding 4', () => {
    for (const kind of ['ComputeMix', 'ComputeParticles']) {
      const mgr = bare({ device: fakeDevice(), node: { kind }, needsInput: true });
      mgr.createNeutralFieldTexture();
      expect(mgr.neutralFieldTexture).toBeUndefined();
    }
  });

  it('binds the neutral field, not the black fallback, while the Warp Field pin is empty', () => {
    const device = fakeDevice();
    const storage = { createView: () => 'storageView' };
    const fallback = { createView: () => 'blackFallbackView' };
    const neutral = { createView: () => 'neutralView' };
    const mgr = bare({
      device,
      node: { kind: 'ComputeWarp' },
      bindGroupLayout: {},
      uniformBuffer: {},
      supportsFeedback: true,
      needsInput: true,
      currentWriteTexture: 'A',
      storageTextureA: storage,
      storageTextureB: storage,
      inputTexture: { createView: () => 'inputView' },
      fallbackInputTexture: fallback,
      neutralFieldTexture: neutral,
      warpFieldTexture: null,
      textureSampler: {},
      extraInputCount: 0,
      extraInputTextures: [],
    });

    mgr.recreateBindGroup();

    const field = mgr.bindGroup.entries.find((e) => e.binding === 4);
    expect(field.resource).toBe('neutralView');
  });

  it('still prefers a connected warp field over the neutral stand-in', () => {
    const device = fakeDevice();
    const storage = { createView: () => 'storageView' };
    const mgr = bare({
      device,
      node: { kind: 'ComputeWarp' },
      bindGroupLayout: {},
      uniformBuffer: {},
      supportsFeedback: true,
      needsInput: true,
      currentWriteTexture: 'A',
      storageTextureA: storage,
      storageTextureB: storage,
      inputTexture: { createView: () => 'inputView' },
      fallbackInputTexture: { createView: () => 'blackFallbackView' },
      neutralFieldTexture: { createView: () => 'neutralView' },
      warpFieldTexture: { createView: () => 'connectedFieldView' },
      textureSampler: {},
      extraInputCount: 0,
      extraInputTextures: [],
    });

    mgr.recreateBindGroup();

    const field = mgr.bindGroup.entries.find((e) => e.binding === 4);
    expect(field.resource).toBe('connectedFieldView');
  });

  it('leaves ComputeMix on the black fallback for an empty Input B', () => {
    const device = fakeDevice();
    const storage = { createView: () => 'storageView' };
    const mgr = bare({
      device,
      node: { kind: 'ComputeMix' },
      bindGroupLayout: {},
      uniformBuffer: {},
      supportsFeedback: true,
      needsInput: true,
      currentWriteTexture: 'A',
      storageTextureA: storage,
      storageTextureB: storage,
      inputTexture: { createView: () => 'inputView' },
      fallbackInputTexture: { createView: () => 'blackFallbackView' },
      neutralFieldTexture: null,
      warpFieldTexture: null,
      textureSampler: {},
      extraInputCount: 0,
      extraInputTextures: [],
    });

    mgr.recreateBindGroup();

    const field = mgr.bindGroup.entries.find((e) => e.binding === 4);
    expect(field.resource).toBe('blackFallbackView');
  });
});
