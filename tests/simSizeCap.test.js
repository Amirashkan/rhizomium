// The compute-size cap must lower detail, never shape.
//
// Bug: "in a custom ratio, the second viewer goes different." Compute textures were capped with
// Math.min per axis, so any composition whose long edge passed 2048 was RESHAPED: 2560x1080
// (2.37:1) became a 2048x1080 (1.90:1) texture, and 4K became literally square. The editor's own
// preview frames to the output format and looked right, while the second viewer framed itself
// from the reshaped texture - so the two windows disagreed. Standard presets sit under the cap,
// which is why only a custom ratio showed it.
//
// Contract: capping scales both axes by one factor, so the aspect survives; every role keeps the
// composition's shape at every size.

import { describe, it, expect, beforeEach } from 'vitest';
import { ComputeExecutor } from '../src/gpu/ComputeExecutor.js';
import {
  MAX_SIM_EDGE,
  fitToLongEdge,
  resetOutputFormat,
  resolveResolution,
  setOutputFormat,
  setSimQuality,
} from '../src/ui/OutputFormat.js';

const aspect = ({ width, height }) => +(width / height).toFixed(3);

describe('sim textures are capped without being reshaped', () => {
  beforeEach(() => {
    window.localStorage?.clear();
    resetOutputFormat('test');
  });

  it('keeps an ultrawide composition ultrawide', () => {
    setOutputFormat(2560, 1080, 'test');
    const sim = resolveResolution('sim');

    expect(Math.max(sim.width, sim.height)).toBe(MAX_SIM_EDGE);
    expect(aspect(sim)).toBe(aspect({ width: 2560, height: 1080 }));
    expect(sim).toEqual({ width: 2048, height: 864 });
  });

  it('does not turn 4K into a square', () => {
    setOutputFormat(3840, 2160, 'test');
    const sim = resolveResolution('sim');

    expect(sim).toEqual({ width: 2048, height: 1152 });
    expect(aspect(sim)).toBe(1.778);
  });

  it('leaves sizes under the cap untouched (why presets never showed the bug)', () => {
    setOutputFormat(1920, 1080, 'test');
    expect(resolveResolution('sim')).toEqual({ width: 1920, height: 1080 });
  });

  it('caps after the quality scale, so Half of a 4K project fits without capping', () => {
    setOutputFormat(3840, 2160, 'test');
    setSimQuality('half', 'test');
    expect(resolveResolution('sim')).toEqual({ width: 1920, height: 1080 });
  });

  it('preserves the aspect for portrait compositions too', () => {
    setOutputFormat(1080, 2560, 'test');
    expect(resolveResolution('sim')).toEqual({ width: 864, height: 2048 });
  });
});

describe('fitToLongEdge', () => {
  it('returns the size unchanged when it already fits', () => {
    expect(fitToLongEdge({ width: 800, height: 600 }, 2048)).toEqual({ width: 800, height: 600 });
  });

  it('scales both axes by the same factor', () => {
    expect(fitToLongEdge({ width: 4000, height: 1000 }, 2000)).toEqual({ width: 2000, height: 500 });
  });

  it('is a no-op without a usable cap', () => {
    expect(fitToLongEdge({ width: 4000, height: 1000 }, 0)).toEqual({ width: 4000, height: 1000 });
  });
});

describe('ComputeExecutor.fitComputeSize', () => {
  it('caps a per-node override without reshaping it', () => {
    expect(ComputeExecutor.fitComputeSize(4096, 1024)).toEqual([2048, 512]);
  });

  it('passes through sizes within the cap', () => {
    expect(ComputeExecutor.fitComputeSize(1920, 1080)).toEqual([1920, 1080]);
  });

  it('never returns a zero dimension for extreme ratios', () => {
    const [w, h] = ComputeExecutor.fitComputeSize(8192, 4);
    expect(w).toBe(2048);
    expect(h).toBe(1);
  });
});
