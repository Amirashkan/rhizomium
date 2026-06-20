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

  it('packs color stops at the WGSL std430 stride (8 floats/stop, color at +4)', () => {
    // WGSL: struct ColorStop { position: f32, color: vec4<f32> } => 32 bytes / stop.
    const mgr = bare({
      device: fakeDevice(),
      colorStopsBuffer: { size: 256 },
      colorStopsData: new Float32Array(64),
      node: { kind: 'ComputeGradient' },
    });

    mgr.updateColorStopsBuffer([
      { position: 0.0, color: [1, 0, 0, 1] },
      { position: 1.0, color: [0, 0, 1, 1] },
    ]);

    // stop 0 at floats [0..7]: position at 0, color (vec4, 16-byte aligned) at +4.
    expect(mgr.colorStopsData[0]).toBe(0.0);
    expect(Array.from(mgr.colorStopsData.slice(4, 8))).toEqual([1, 0, 0, 1]);
    // stop 1 at floats [8..15]: position at 8, color at +12.
    expect(mgr.colorStopsData[8]).toBe(1.0);
    expect(Array.from(mgr.colorStopsData.slice(12, 16))).toEqual([0, 0, 1, 1]);
  });

  // Feedback ping-pong state machine — the stateful path the second-monitor
  // receiver now drives natively (it runs its own copy of the simulation).
  it('swapBuffers toggles the ping-pong write target each frame', () => {
    const a = { id: 'A' };
    const b = { id: 'B' };
    const mgr = bare({
      supportsFeedback: true,
      currentWriteTexture: 'A',
      storageTextureA: a,
      storageTextureB: b,
      storageTexture: a,
    });

    mgr.swapBuffers();
    expect(mgr.currentWriteTexture).toBe('B');
    expect(mgr.storageTexture).toBe(b); // write target follows the toggle

    mgr.swapBuffers();
    expect(mgr.currentWriteTexture).toBe('A');
    expect(mgr.storageTexture).toBe(a);
  });

  it('swapBuffers is a no-op for stateless nodes (no feedback)', () => {
    const mgr = bare({
      supportsFeedback: false,
      currentWriteTexture: 'A',
      storageTextureA: { id: 'A' },
      storageTextureB: { id: 'B' },
      storageTexture: { id: 'A' },
    });
    mgr.swapBuffers();
    expect(mgr.currentWriteTexture).toBe('A'); // unchanged
  });

  it('destroy() releases both ping-pong textures (no feedback leak on rebuild)', () => {
    const destroyed = [];
    const tex = (id) => ({ id, destroy: () => destroyed.push(id) });
    const mgr = bare({
      storageTexture: tex('S'),
      storageTextureA: tex('A'),
      storageTextureB: tex('B'),
      outputTexture: tex('OUT'),
      uniformBuffer: { destroy: () => destroyed.push('U') },
      colorStopsBuffer: null,
      fallbackInputTexture: null,
    });
    mgr.destroy();
    expect(destroyed).toEqual(expect.arrayContaining(['A', 'B', 'OUT', 'S']));
    expect(mgr.storageTextureA).toBeNull();
    expect(mgr.storageTextureB).toBeNull();
  });
});
