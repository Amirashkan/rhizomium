import { describe, it, expect } from 'vitest';
import { packComputeUniforms } from '../src/gpu/computeUniformLayout.js';

// Mirror the editor/viewer call: evaluate() resolves numbers/booleans/enums to
// floats. Here we just coerce numbers and pass through the default otherwise,
// which is enough to exercise the static layout.
const ev = (value, def) => (typeof value === 'number' ? value : def);
const ctx = { width: 512, height: 512, time: 1.5, evaluate: ev };

describe('packComputeUniforms - ComputeParticles', () => {
  it('packs particleCount, speed, size, lifetime and color in WGSL struct order', () => {
    const u = packComputeUniforms(
      'ComputeParticles',
      { particleCount: 20000, speed: 2.0, size: 3.5, lifetime: 8.0, color: [0.2, 0.4, 0.6, 0.8] },
      ctx
    );
    expect(u[0]).toBe(512);
    expect(u[1]).toBe(512);
    expect(u[2]).toBe(1.5);
    expect(u[3]).toBe(20000); // particleCount
    expect(u[4]).toBe(2.0); // speed
    expect(u[5]).toBe(3.5); // size
    expect(u[6]).toBe(8.0); // lifetime
    // color unpacked to four scalar fields (colorR..colorA)
    expect(u[7]).toBeCloseTo(0.2);
    expect(u[8]).toBeCloseTo(0.4);
    expect(u[9]).toBeCloseTo(0.6);
    expect(u[10]).toBeCloseTo(0.8);
  });

  it('defaults to visible white particles when params are unset', () => {
    // Regression: ComputeParticles used to fall through to the default case,
    // leaving every param at 0 -> zero particles, zero size, black color.
    const u = packComputeUniforms('ComputeParticles', {}, ctx);
    expect(u[3]).toBe(10000); // particleCount
    expect(u[4]).toBe(1.0); // speed
    expect(u[5]).toBe(2.0); // size
    expect(u[6]).toBe(5.0); // lifetime
    expect(u[7]).toBe(1.0); // colorR
    expect(u[8]).toBe(1.0); // colorG
    expect(u[9]).toBe(1.0); // colorB
    expect(u[10]).toBe(1.0); // colorA
  });
});

describe('packComputeUniforms - ComputeHistogram', () => {
  it('packs operation, channel, bins and strength in WGSL struct order', () => {
    const u = packComputeUniforms(
      'ComputeHistogram',
      { operation: 'Stretch', channel: 'G', bins: 128, strength: 0.75 },
      ctx
    );
    // resolution + time
    expect(u[0]).toBe(512);
    expect(u[1]).toBe(512);
    expect(u[2]).toBe(1.5);
    // operation: Equalize=0, Normalize=1, Stretch=2, Visualize=3
    expect(u[3]).toBe(2.0);
    // channel: RGB=0, R=1, G=2, B=3, Luminance=4
    expect(u[4]).toBe(2.0);
    expect(u[5]).toBe(128); // bins
    expect(u[6]).toBe(0.75); // strength
  });

  it('defaults to a non-zero strength so the node is not a pass-through', () => {
    // Regression: ComputeHistogram used to fall through to the default case,
    // leaving strength at 0 -> mix(input, processed, 0) = input (does nothing).
    const u = packComputeUniforms('ComputeHistogram', {}, ctx);
    expect(u[3]).toBe(0.0); // Equalize
    expect(u[4]).toBe(4.0); // Luminance
    expect(u[6]).toBe(1.0); // strength must default to 1, not 0
  });
});
