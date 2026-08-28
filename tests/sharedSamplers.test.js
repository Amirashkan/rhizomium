// tests/sharedSamplers.test.js
//
// A generated fragment shader used to declare a sampler beside every texture.
// Samplers have a per-stage budget of their own — 16 by default, and one most
// adapters will not raise — so the SAMPLER count, not the texture count, is what
// capped a patch at sixteen texture nodes. Past that the generator dropped
// bindings while the node bodies went on naming them, and the shader would not
// compile at all.
//
// Every sampler the renderer ever bound to those declarations was one of two:
// linear+repeat for an image, linear+clamp for a texture sampled to its edge
// behind a projection-mapped surface. So the shader declares those two and every
// texture points at whichever it already had.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  SHARED_SAMPLER,
  SHARED_SAMPLER_CLAMP,
  SHARED_SAMPLER_COUNT,
  isSharedSampler,
  sharedSampler,
} from '../src/gpu/sharedSamplers.js';
import { TextureBindings } from '../src/codegen/generators/TextureBindings.js';
import { TextureNodes } from '../src/codegen/compilers/TextureNodes.js';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';
import { GPURenderer } from '../src/gpu/gpuRenderer.js';

const makeDevice = () => ({
  createSampler: vi.fn((descriptor) => ({ ...descriptor })),
});

describe('the shared sampler bindings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('are declared once, however many textures a patch has', () => {
    vi.stubGlobal('window', { gpuTextureBindingLimit: 64 });
    const nodes = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), kind: 'Texture2D' }));

    const code = TextureBindings.generate({ nodes: [] }, nodes);

    expect((code.match(/: sampler;/g) || [])).toHaveLength(SHARED_SAMPLER_COUNT);
    expect(code).toContain(`var ${SHARED_SAMPLER}: sampler;`);
    expect(code).toContain(`var ${SHARED_SAMPLER_CLAMP}: sampler;`);
    // ...and no per-node sampler survives.
    expect(code).not.toMatch(/var sampler_\d+: sampler;/);
  });

  it('give every binding in the group a distinct index', () => {
    vi.stubGlobal('window', { gpuTextureBindingLimit: 64 });
    const nodes = [
      { id: '1', kind: 'Texture2D' },
      { id: '2', kind: 'TextureCube' },
      { id: '3', kind: 'ComputeBlur' },
    ];

    const code = TextureBindings.generate({ nodes: [] }, nodes);
    const indices = [...code.matchAll(/@binding\((\d+)\)/g)].map(m => Number(m[1]));

    expect(indices).toEqual([...new Set(indices)]);
    expect(indices).toHaveLength(SHARED_SAMPLER_COUNT + nodes.length);
  });

  it('are what a Texture 2D samples through', () => {
    vi.stubGlobal('window', {});
    const compiled = new TextureNodes().compile(
      { id: '7', kind: 'Texture2D', params: {}, inputs: [] },
      () => null,
      (_node, name, fallback) => fallback,
    );

    expect(compiled.line).toContain(SHARED_SAMPLER);
    expect(compiled.line).not.toContain('sampler_7');
  });

  it('resolve to one linear/repeat and one linear/clamp sampler', () => {
    const device = makeDevice();

    expect(sharedSampler(device, SHARED_SAMPLER)).toMatchObject({
      magFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat',
    });
    expect(sharedSampler(device, SHARED_SAMPLER_CLAMP)).toMatchObject({
      magFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
  });

  it('are created once per device, not once per bind-group rebuild', () => {
    const device = makeDevice();

    sharedSampler(device, SHARED_SAMPLER);
    sharedSampler(device, SHARED_SAMPLER);
    sharedSampler(device, SHARED_SAMPLER_CLAMP);

    expect(device.createSampler).toHaveBeenCalledTimes(2);
    expect(sharedSampler(makeDevice(), SHARED_SAMPLER)).not.toBe(sharedSampler(device, SHARED_SAMPLER));
  });

  it('are recognised by name, and nothing else is', () => {
    expect(isSharedSampler(SHARED_SAMPLER)).toBe(true);
    expect(isSharedSampler('sampler_7')).toBe(false);
    expect(isSharedSampler(undefined)).toBe(false);
  });
});

describe('both renderers bind the shared samplers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the main renderer resolves them without consulting the texture manager', () => {
    vi.stubGlobal('window', {});
    const renderer = Object.create(GPURenderer.prototype);
    renderer.device = makeDevice();

    const resolved = renderer._lookupTextureBinding({}, SHARED_SAMPLER_CLAMP);

    expect(resolved.sampler).toMatchObject({ addressModeU: 'clamp-to-edge' });
  });

  it('the fragment renderer resolves them instead of its default sampler', () => {
    vi.stubGlobal('window', {});
    const renderer = Object.create(FragmentTextureRenderer.prototype);
    renderer.device = makeDevice();

    const resource = renderer._createResource({ kind: 'sampler', varName: SHARED_SAMPLER }, new Map());

    expect(resource).toMatchObject({ addressModeU: 'repeat' });
  });
});
