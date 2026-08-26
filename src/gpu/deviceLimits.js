// src/gpu/deviceLimits.js — how many textures one shader may sample.
//
// WebGPU hands out a device with the SPEC DEFAULTS unless you ask for more, and
// the default is 16 sampled textures and 16 samplers per shader stage. Every
// Texture 2D, Text, cube map and compute output in a patch binds one of each, so
// a graph with seventeen of them compiled to WGSL that named a binding the
// device would not allow. The generator's only recourse was to drop the extras —
// and the node bodies still sample them by name, so the whole shader failed to
// compile and the patch went dark.
//
// Machines can nearly always do far better than 16; the adapter says how much.
// Ask for what it reports, capped at TARGET_BINDINGS (past which the ask buys
// nothing and some drivers charge for the headroom), and let the generator read
// back what was actually granted rather than assuming.

/** What a device gives you when nothing is requested. */
export const DEFAULT_BINDINGS_PER_STAGE = 16;

/** Enough for any hand-authored patch; well inside every backend's real ceiling. */
export const TARGET_BINDINGS = 64;

const KEYS = ['maxSampledTexturesPerShaderStage', 'maxSamplersPerShaderStage'];

/**
 * The `requiredLimits` to pass to adapter.requestDevice() — each key clamped to
 * what this adapter supports, so the request can never be rejected for asking
 * too much, and omitted entirely when the adapter offers no more than the
 * default. Pass the result straight through: `requestDevice({ requiredLimits })`.
 */
export function textureBindingLimits(adapter) {
  const supported = adapter?.limits;
  if (!supported) return {};

  const requiredLimits = {};
  for (const key of KEYS) {
    const available = supported[key];
    if (typeof available !== 'number' || available <= DEFAULT_BINDINGS_PER_STAGE) continue;
    requiredLimits[key] = Math.min(available, TARGET_BINDINGS);
  }
  return requiredLimits;
}

/**
 * Request a device with the texture limits above, falling back to a plain
 * request if this adapter refuses them — a device with the defaults still runs
 * every patch that fits in 16, which is the behaviour we had before.
 */
export async function requestDeviceWithTextureLimits(adapter, descriptor = {}) {
  const requiredLimits = { ...textureBindingLimits(adapter), ...(descriptor.requiredLimits || {}) };
  try {
    const device = await adapter.requestDevice({ ...descriptor, requiredLimits });
    publishTextureBindingLimit(device);
    return device;
  } catch {
    const device = await adapter.requestDevice(descriptor);
    publishTextureBindingLimit(device);
    return device;
  }
}

/**
 * Record what the device actually granted, so code generation — which runs
 * nowhere near a GPUDevice — can size itself to the real machine.
 */
export function publishTextureBindingLimit(device) {
  if (typeof window === 'undefined') return;
  window.gpuTextureBindingLimit = textureBindingLimitOf(device);
}

/** How many texture+sampler pairs one stage of this device may bind. */
export function textureBindingLimitOf(device) {
  const limits = device?.limits;
  const textures = Number(limits?.maxSampledTexturesPerShaderStage);
  const samplers = Number(limits?.maxSamplersPerShaderStage);
  // Each bound texture brings its own sampler, so the smaller ceiling is the one
  // that counts.
  const usable = Math.min(
    Number.isFinite(textures) ? textures : DEFAULT_BINDINGS_PER_STAGE,
    Number.isFinite(samplers) ? samplers : DEFAULT_BINDINGS_PER_STAGE,
  );
  return Math.max(1, usable);
}

/**
 * The limit code generation should respect: what the live device granted, or the
 * spec default when generation runs with no device around (tests, tooling).
 */
export function maxTextureBindings() {
  const published = (typeof window !== 'undefined') ? window.gpuTextureBindingLimit : null;
  return Number.isFinite(published) && published > 0 ? published : DEFAULT_BINDINGS_PER_STAGE;
}
