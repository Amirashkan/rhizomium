// tests/textureBindingLimits.test.js
//
// A device you never asked anything of gives you the spec defaults: 16 sampled
// textures and 16 samplers per shader stage. Every Texture 2D, Text, cube map and
// compute output binds one of each, so a patch with seventeen of them made the
// generator drop the extras — and the node bodies still sample them by name, so
// the whole shader failed to compile rather than degrading. Ask the adapter for
// what it can actually do, and size code generation to what was granted.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEFAULT_BINDINGS_PER_STAGE,
  TARGET_BINDINGS,
  textureBindingLimits,
  textureBindingLimitOf,
  maxTextureBindings,
  requestDeviceWithTextureLimits,
} from '../src/gpu/deviceLimits.js';
import { TextureBindings } from '../src/codegen/generators/TextureBindings.js';

const adapterWith = (limits) => ({
  limits,
  requestDevice: vi.fn(async (descriptor = {}) => ({
    limits: {
      maxSampledTexturesPerShaderStage:
        descriptor.requiredLimits?.maxSampledTexturesPerShaderStage ?? DEFAULT_BINDINGS_PER_STAGE,
      maxSamplersPerShaderStage:
        descriptor.requiredLimits?.maxSamplersPerShaderStage ?? DEFAULT_BINDINGS_PER_STAGE,
    },
  })),
});

describe('asking the adapter for texture headroom', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests up to the target when the adapter can serve it', () => {
    const required = textureBindingLimits(adapterWith({
      maxSampledTexturesPerShaderStage: 1_000_000,
      maxSamplersPerShaderStage: 1024,
    }));

    expect(required.maxSampledTexturesPerShaderStage).toBe(TARGET_BINDINGS);
    expect(required.maxSamplersPerShaderStage).toBe(TARGET_BINDINGS);
  });

  it('never asks for more than the adapter has — the request would be rejected', () => {
    const required = textureBindingLimits(adapterWith({
      maxSampledTexturesPerShaderStage: 32,
      maxSamplersPerShaderStage: 16,
    }));

    expect(required.maxSampledTexturesPerShaderStage).toBe(32);
    // At the default, so there is nothing to ask for.
    expect(required).not.toHaveProperty('maxSamplersPerShaderStage');
  });

  it('asks for nothing at all when the adapter reports no limits', () => {
    expect(textureBindingLimits(undefined)).toEqual({});
    expect(textureBindingLimits({})).toEqual({});
  });

  it('takes the smaller of textures and samplers as the usable limit', () => {
    // Each bound texture brings its own sampler, so 64 textures with 16 samplers
    // is 16 usable pairs, not 64.
    expect(textureBindingLimitOf({
      limits: { maxSampledTexturesPerShaderStage: 64, maxSamplersPerShaderStage: 16 },
    })).toBe(16);
  });

  it('falls back to the spec default for a device that reports nothing', () => {
    expect(textureBindingLimitOf(null)).toBe(DEFAULT_BINDINGS_PER_STAGE);
  });

  it('publishes the granted limit for code generation to read', async () => {
    vi.stubGlobal('window', {});
    const adapter = adapterWith({
      maxSampledTexturesPerShaderStage: 1_000_000,
      maxSamplersPerShaderStage: 1024,
    });

    await requestDeviceWithTextureLimits(adapter);

    expect(window.gpuTextureBindingLimit).toBe(TARGET_BINDINGS);
    expect(maxTextureBindings()).toBe(TARGET_BINDINGS);
  });

  it('still returns a device when the adapter refuses the request', async () => {
    vi.stubGlobal('window', {});
    const adapter = {
      limits: { maxSampledTexturesPerShaderStage: 128, maxSamplersPerShaderStage: 128 },
      requestDevice: vi.fn(async (descriptor = {}) => {
        if (descriptor.requiredLimits && Object.keys(descriptor.requiredLimits).length) {
          throw new Error('OperationError');
        }
        return { limits: {} };
      }),
    };

    const device = await requestDeviceWithTextureLimits(adapter);

    expect(device).toBeTruthy();
    expect(window.gpuTextureBindingLimit).toBe(DEFAULT_BINDINGS_PER_STAGE);
  });
});

describe('code generation sized to the granted limit', () => {
  afterEach(() => vi.unstubAllGlobals());

  const textureNodes = (count) =>
    Array.from({ length: count }, (_, i) => ({ id: String(i + 1), kind: 'Texture2D' }));

  const bound = (code) => (code.match(/var texture_\d+: texture_2d<f32>/g) || []).length;

  it('binds all 20 textures on a device that granted the headroom', () => {
    vi.stubGlobal('window', { gpuTextureBindingLimit: TARGET_BINDINGS });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(bound(TextureBindings.generate({ nodes: [] }, textureNodes(20)))).toBe(20);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still stops at 16 on a device that granted only the default', () => {
    vi.stubGlobal('window', {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(bound(TextureBindings.generate({ nodes: [] }, textureNodes(20)))).toBe(16);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
