import { describe, it, expect, vi } from 'vitest';
import { GPURenderer } from '../src/gpu/gpuRenderer.js';

// These exercise the second-monitor "state tap" surface in isolation, on a bare
// object backed by the real prototype, so we avoid standing up a full WebGPU
// device while still running the actual method bodies.
function bare(props = {}) {
  return Object.assign(Object.create(GPURenderer.prototype), props);
}

describe('GPURenderer state tap', () => {
  it('setStateTap stores a function and clears on null', () => {
    const self = bare();
    GPURenderer.prototype.setStateTap.call(self, () => {});
    expect(typeof self._stateTap).toBe('function');
    GPURenderer.prototype.setStateTap.call(self, null);
    expect(self._stateTap).toBeNull();
  });

  it('_emitStateSnapshot is a no-op when no tap is registered', () => {
    const self = bare({ _stateTap: null });
    expect(() => self._emitStateSnapshot()).not.toThrow();
  });

  it('_emitStateSnapshot emits sliced copies of the current uniform bytes', () => {
    const got = [];
    const self = bare({
      _stateTap: (snap) => got.push(snap),
      _currentWgslCode: 'WGSL',
      _aspectUniformBuffer: new Float32Array([1.5, 0, 0, 0]),
      _globalsUniformBuffer: new Float32Array([8, 8, 2, 0, 0, 0, 0, 0]),
      _paramUniformBuffer: new Float32Array([0.1, 0.2]),
    });

    self._emitStateSnapshot();

    expect(got).toHaveLength(1);
    const snap = got[0];
    expect(snap.wgsl).toBe('WGSL');
    expect(Array.from(snap.globals)).toEqual([8, 8, 2, 0, 0, 0, 0, 0]);
    expect(Array.from(snap.params)).toEqual([0.1, 0.2].map((v) => Math.fround(v)));

    // The snapshot is a copy: overwriting the renderer's reused buffer next frame
    // must not mutate what we already handed out.
    self._globalsUniformBuffer[2] = 99;
    expect(snap.globals[2]).toBe(2);
  });

  it('isNativeMirrorEligible is true only for a uniforms-only shader', () => {
    expect(GPURenderer.prototype.isNativeMirrorEligible.call({ resources: {} })).toBe(false);
    expect(GPURenderer.prototype.isNativeMirrorEligible.call({
      resources: { u: { kind: 'uniform-buffer' }, g: { kind: 'uniform-buffer' } },
    })).toBe(true);
    expect(GPURenderer.prototype.isNativeMirrorEligible.call({
      resources: { u: { kind: 'uniform-buffer' }, tex: { kind: 'texture-2d' } },
    })).toBe(false);
    expect(GPURenderer.prototype.isNativeMirrorEligible.call({
      resources: { s: { kind: 'storage-buffer' } },
    })).toBe(false);
  });

  it('externalUniformMode short-circuits the per-frame uniform writers', () => {
    const guard = () => { throw new Error('should not derive uniforms in external mode'); };
    const self = bare({ externalUniformMode: true, _getUniformByVarName: guard });
    expect(() => self._updateAspectUniform()).not.toThrow();
    expect(() => self._updateGlobalsUniform(1)).not.toThrow();
    expect(() => self._updateParameterUniforms()).not.toThrow();
  });

  it('writeRawUniforms writes u/g bytes and grows u_params to fit', () => {
    const writes = [];
    const created = [];
    const uBuf = { size: 16 };
    const gBuf = { size: 32 };
    const pBuf = { size: 16 }; // too small for 8 params (32 bytes)
    const self = bare({
      _rebuildBindGroups: vi.fn(),
      resources: {
        u: { kind: 'uniform-buffer', varName: 'u', buffer: uBuf },
        g: { kind: 'uniform-buffer', varName: 'g', buffer: gBuf },
        p: { kind: 'uniform-buffer', varName: 'u_params', buffer: pBuf },
      },
      device: {
        queue: { writeBuffer: (b, o, ab, off, len) => writes.push({ b, len }) },
        createBuffer: (desc) => { const nb = { size: desc.size }; created.push(nb); return nb; },
      },
    });

    self.writeRawUniforms({
      aspect: new Float32Array([1, 0, 0, 0]),
      globals: new Float32Array([8, 8, 0, 0, 0, 0, 0, 0]),
      params: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7]), // 32 bytes
    });

    expect(writes.find((w) => w.b === uBuf)?.len).toBe(16);
    expect(writes.find((w) => w.b === gBuf)?.len).toBe(32);
    // u_params grew: a new buffer was created, bind groups rebuilt, bytes written.
    expect(created).toHaveLength(1);
    expect(created[0].size).toBeGreaterThanOrEqual(32);
    expect(self._rebuildBindGroups).toHaveBeenCalled();
    const grown = self.resources.p.buffer;
    expect(grown).toBe(created[0]);
    expect(writes.find((w) => w.b === grown)?.len).toBe(32);
  });

  it('writeRawUniforms never overflows a fixed-size buffer', () => {
    const writes = [];
    const uBuf = { size: 16 };
    const self = bare({
      _rebuildBindGroups: vi.fn(),
      resources: { u: { kind: 'uniform-buffer', varName: 'u', buffer: uBuf } },
      device: {
        queue: { writeBuffer: (b, o, ab, off, len) => writes.push({ b, len }) },
        createBuffer: vi.fn(),
      },
    });

    // Over-sized data for the non-growable u buffer is clamped to its capacity.
    self.writeRawUniforms({ aspect: new Float32Array([1, 2, 3, 4, 5, 6]) }); // 24 bytes
    expect(writes.find((w) => w.b === uBuf)?.len).toBe(16);
    expect(self.device.createBuffer).not.toHaveBeenCalled();
  });
});
