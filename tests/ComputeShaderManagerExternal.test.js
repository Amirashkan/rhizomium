import { describe, it, expect, vi } from 'vitest';
import { ComputeShaderManager } from '../src/gpu/ComputeShaderManager.js';

// Exercise the external-uniform injection path on a bare object backed by the
// real prototype, so we run the actual method bodies without a real GPU device.
function bare(props = {}) {
  return Object.assign(Object.create(ComputeShaderManager.prototype), props);
}

function fakeDevice() {
  const writes = [];
  return {
    writes,
    queue: { writeBuffer: (buffer, off, ab, dOff, len) => writes.push({ buffer, len }) },
    createBuffer: (desc) => ({ size: desc.size, _label: desc.label }),
  };
}

describe('ComputeShaderManager external uniforms', () => {
  it('updateUniforms in external mode writes injected bytes and never re-packs params', () => {
    const device = fakeDevice();
    const uniformBuffer = { size: 64 };
    const mgr = bare({
      device,
      uniformBuffer,
      uniformData: new Float32Array(16),
      colorStopsData: new Float32Array(64),
      externalUniformMode: true,
      _externalPacked: new Float32Array([1, 2, 3, 4]),
      _externalColorStops: null,
      // If the normal path ran it would read this.node.* / packComputeUniforms.
      node: { get kind() { throw new Error('must not re-pack in external mode'); } },
    });

    expect(() => mgr.updateUniforms(0)).not.toThrow();
    expect(Array.from(mgr.uniformData.slice(0, 4))).toEqual([1, 2, 3, 4]);
    expect(device.writes.find((w) => w.buffer === uniformBuffer)).toBeTruthy();
  });

  it('writeRawComputeUniforms stores bytes and uploads uniforms + gradient color stops', () => {
    const device = fakeDevice();
    const uniformBuffer = { size: 64 };
    const mgr = bare({
      device,
      uniformBuffer,
      colorStopsBuffer: null,
      uniformData: new Float32Array(16),
      colorStopsData: new Float32Array(64),
      externalUniformMode: true,
      _externalPacked: null,
      _externalColorStops: null,
      node: { kind: 'ComputeGradient' },
    });

    const packed = new Float32Array(16).fill(2);
    const stops = new Float32Array(64).fill(0.5);
    mgr.writeRawComputeUniforms(packed, stops);

    expect(mgr._externalPacked).toBe(packed);
    expect(mgr._externalColorStops).toBe(stops);
    // A color-stops buffer is lazily created and written alongside the uniforms.
    expect(mgr.colorStopsBuffer).toBeTruthy();
    expect(device.writes.find((w) => w.buffer === uniformBuffer)).toBeTruthy();
    expect(device.writes.find((w) => w.buffer === mgr.colorStopsBuffer)).toBeTruthy();
  });
});
