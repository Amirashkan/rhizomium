// The fragment-path noise hashes must actually decorrelate their input.
//
// hash12/hash22 are "Hash without Sine" (Dave Hoskins). The load-bearing line is
//
//   p3 += dot(p3, p3.yzx + 33.33);
//
// which mixes the components into each other. Without it the result stays close
// to a linear function of p, and every noise that interpolates it over a lattice
// - value, fast (so ridged and warp), worley, voronoi - renders as smooth bands
// instead of noise. The marginal distribution still looks uniform when it is
// broken, so a histogram test would not have caught it; what breaks is the
// spatial correlation between neighbouring lattice points, which is what these
// tests measure.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOISE_FUNCTION_DEFINITIONS } from '../src/codegen/compilers/NoiseNodes.js';

const AVALANCHE = 'p3 += dot(p3, p3.yzx + 33.33);';

// Port of the WGSL, so the test measures behaviour rather than just text.
const fract = (x) => x - Math.floor(x);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function hash12(x, y) {
  let p3 = [x * 0.1031, y * 0.1031, x * 0.1031].map(fract);
  const d = dot3(p3, [p3[1] + 33.33, p3[2] + 33.33, p3[0] + 33.33]);
  p3 = p3.map((v) => v + d);
  return fract((p3[0] + p3[1]) * p3[2]);
}

function hash22(x, y) {
  let p3 = [x * 0.1031, y * 0.1030, x * 0.0973].map(fract);
  const d = dot3(p3, [p3[1] + 33.33, p3[2] + 33.33, p3[0] + 33.33]);
  p3 = p3.map((v) => v + d);
  return [fract((p3[0] + p3[1]) * p3[2]), fract((p3[0] + p3[2]) * p3[1])];
}

// Pearson correlation between each lattice point and its neighbour one step on.
function neighbourCorrelation(sample, step, n = 64) {
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0, k = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const a = sample(x, y);
      const b = sample(x + step[0], y + step[1]);
      sx += a; sy += b; sxy += a * b; sxx += a * a; syy += b * b; k++;
    }
  }
  const denom = Math.sqrt((k * sxx - sx * sx) * (k * syy - sy * sy));
  return denom === 0 ? 1 : (k * sxy - sx * sy) / denom;
}

describe('fragment-path noise hashes', () => {
  it('keeps the avalanche step in the generated WGSL', () => {
    expect(NOISE_FUNCTION_DEFINITIONS.hash12).toContain(AVALANCHE);
    expect(NOISE_FUNCTION_DEFINITIONS.hash22).toContain(AVALANCHE);
  });

  it('keeps the avalanche step in shaderlib.wgsl', () => {
    // happy-dom does not give import.meta.url a file: scheme, so resolve from
    // the repo root, which is vitest's cwd.
    const lib = readFileSync(join(process.cwd(), 'src/assets/shaderlib.wgsl'), 'utf8');
    const hashes = lib.slice(lib.indexOf('fn hash22'));
    expect(hashes.split(AVALANCHE).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('does not carry a constant-only mix, which does not decorrelate anything', () => {
    // The pre-fix form folded `dot(p3, vec3(33.33))` into the final fract and
    // skipped the self-mix entirely.
    for (const src of [NOISE_FUNCTION_DEFINITIONS.hash12, NOISE_FUNCTION_DEFINITIONS.hash22]) {
      expect(src).not.toMatch(/dot\(p3,\s*vec3<f32>\(33\.33\)\)/);
      expect(src).not.toMatch(/\+\s*vec2<f32>\(33\.33\)\)/);
    }
  });

  it('decorrelates neighbouring lattice points in x and y', () => {
    // The broken hash measured 0.63 in x and -0.45 in y; a working one sits
    // near zero. 0.15 leaves room for sampling noise without admitting those.
    for (const step of [[1, 0], [0, 1], [1, 1]]) {
      expect(Math.abs(neighbourCorrelation(hash12, step))).toBeLessThan(0.15);
      expect(Math.abs(neighbourCorrelation((x, y) => hash22(x, y)[0], step))).toBeLessThan(0.15);
      expect(Math.abs(neighbourCorrelation((x, y) => hash22(x, y)[1], step))).toBeLessThan(0.15);
    }
  });

  it('still spreads values across the unit interval', () => {
    const buckets = new Array(10).fill(0);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) buckets[Math.min(9, Math.floor(hash12(x, y) * 10))]++;
    }
    const expected = 4096 / 10;
    const chi2 = buckets.reduce((s, b) => s + (b - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(30);
  });
});
