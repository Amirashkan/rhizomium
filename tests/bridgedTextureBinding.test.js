// tests/bridgedTextureBinding.test.js
//
// A fragment subgraph bridged to a texture — for a projection-mapping surface,
// a field mapper, or any other consumer of an arbitrary graph output — is
// published in ComputeExecutor.nodeOutputs and has NO computeTextures entry;
// that map holds real compute nodes only. The renderer used nodeOutputs solely
// to refresh an existing computeTextures entry, so a bridged texture resolved
// to nothing and the binding fell through to the 1x1 white dummy: every mapped
// surface showed flat white instead of its flow.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GPURenderer } from '../src/gpu/gpuRenderer.js';

const makeTexture = (label) => ({ label, createView: () => ({ label: `${label}-view` }) });

function makeRenderer() {
  const renderer = Object.create(GPURenderer.prototype);
  renderer.device = { createSampler: vi.fn((d) => ({ sampler: true, ...d })) };
  return renderer;
}

describe('bridged texture bindings', () => {
  let renderer;
  const texManager = {};

  beforeEach(() => {
    renderer = makeRenderer();
    vi.stubGlobal('window', {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it('resolves a bridged fragment texture that has no compute entry', () => {
    const texture = makeTexture('bridged');
    window.computeExecutor = {
      computeTextures: new Map(),           // no entry: this is not a compute node
      nodeOutputs: new Map([['4', texture]]),
    };

    const resolved = renderer._lookupTextureBinding(texManager, 'compute_node_4');
    expect(resolved.texture).toBe(texture);
    expect(resolved.textureView).toBeTruthy();
  });

  it('gives the bridged texture a sampler, since it arrives without one', () => {
    window.computeExecutor = {
      computeTextures: new Map(),
      nodeOutputs: new Map([['4', makeTexture('bridged')]]),
    };
    const resolved = renderer._lookupTextureBinding(texManager, 'sampler_compute_node_4');
    expect(resolved.sampler).toBeTruthy();
  });

  it('reuses one sampler rather than making one per binding per frame', () => {
    window.computeExecutor = {
      computeTextures: new Map(),
      nodeOutputs: new Map([['4', makeTexture('a')], ['5', makeTexture('b')]]),
    };
    renderer._lookupTextureBinding(texManager, 'sampler_compute_node_4');
    renderer._lookupTextureBinding(texManager, 'sampler_compute_node_5');
    renderer._lookupTextureBinding(texManager, 'sampler_compute_node_4');
    expect(renderer.device.createSampler).toHaveBeenCalledTimes(1);
  });

  it('matches a node id that had to be sanitised for the shader', () => {
    const texture = makeTexture('bridged');
    window.computeExecutor = {
      computeTextures: new Map(),
      nodeOutputs: new Map([['node-7', texture]]),
    };
    expect(renderer._lookupTextureBinding(texManager, 'compute_node_7').texture).toBe(texture);
  });

  it('still prefers a real compute node\'s own entry and sampler', () => {
    const computeTex = makeTexture('compute');
    const fresh = makeTexture('fresh');
    const ownSampler = { sampler: 'compute-own' };
    window.computeExecutor = {
      computeTextures: new Map([['4', { texture: computeTex, sampler: ownSampler }]]),
      nodeOutputs: new Map([['4', fresh]]),
    };

    // The live texture wins, but the compute node's own sampler is kept.
    expect(renderer._lookupTextureBinding(texManager, 'compute_node_4').texture).toBe(fresh);
    expect(renderer._lookupTextureBinding(texManager, 'sampler_compute_node_4').sampler).toBe(ownSampler);
    expect(renderer.device.createSampler).not.toHaveBeenCalled();
  });

  it('resolves nothing when the node has produced no texture at all', () => {
    window.computeExecutor = { computeTextures: new Map(), nodeOutputs: new Map() };
    expect(renderer._lookupTextureBinding(texManager, 'compute_node_9')).toBeNull();
  });
});
