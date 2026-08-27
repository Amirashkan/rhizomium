// src/gpu/sharedSamplers.js — one sampler binding for every texture, instead of
// one each.
//
// The generated fragment shader used to declare a sampler beside every texture:
// `texture_7` + `sampler_7`, `compute_node_9` + `sampler_compute_node_9`, and so
// on. Samplers are a per-shader-stage resource with a budget of their own — 16 by
// default, and unlike sampled textures that is a number many adapters will not
// raise — so a patch's texture budget was really its SAMPLER budget, and a
// seventeenth texture node lost its binding while the node body went on sampling
// it by name, leaving the whole shader uncompilable.
//
// Every sampler the renderer ever bound to those declarations was one of exactly
// two: linear+repeat for an image (that is what TextureManager creates for every
// upload, and what makes a Transform tile its source), and linear+clamp for a
// texture bridged behind a projection-mapped surface (a wrap there puts the far
// edge's pixels in a one-texel seam along the near edge). So there is nothing to
// lose by declaring those two and pointing every texture at whichever it already
// had.

/** Linear, repeating — what TextureManager gives every uploaded image. */
export const SHARED_SAMPLER = 'sampler_shared';

/** Linear, clamped — for a texture sampled right up to its edge. */
export const SHARED_SAMPLER_CLAMP = 'sampler_shared_clamp';

const DESCRIPTORS = {
  [SHARED_SAMPLER]: {
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  },
  [SHARED_SAMPLER_CLAMP]: {
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  },
};

/** How many sampler bindings a generated fragment shader declares. */
export const SHARED_SAMPLER_COUNT = Object.keys(DESCRIPTORS).length;

/** Is this the name of a shared sampler binding? */
export function isSharedSampler(varName) {
  return typeof varName === 'string' && Object.hasOwn(DESCRIPTORS, varName);
}

// Per device, so a lost or replaced device doesn't hand back its predecessor's
// samplers, and so bind-group rebuilds (every frame, for the fragment renderer)
// don't allocate.
const CACHE = new WeakMap();

/** The one GPUSampler this device uses for that binding, created on first ask. */
export function sharedSampler(device, varName) {
  const descriptor = DESCRIPTORS[varName];
  if (!device || !descriptor) return null;

  let perDevice = CACHE.get(device);
  if (!perDevice) {
    perDevice = new Map();
    CACHE.set(device, perDevice);
  }

  let sampler = perDevice.get(varName);
  if (!sampler) {
    sampler = device.createSampler({ label: varName, ...descriptor });
    perDevice.set(varName, sampler);
  }
  return sampler;
}
