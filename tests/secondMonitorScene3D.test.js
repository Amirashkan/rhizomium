import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ draws: [] }));

vi.mock('../src/scene/renderers/ShapeRenderer.js', () => ({
  ShapeRenderer: class { initialize() {} destroy() { this.destroyed = true; } },
}));
vi.mock('../src/scene/renderers/InstanceRenderer.js', () => ({
  InstanceRenderer: class { initialize() {} destroy() { this.destroyed = true; } },
}));
vi.mock('../src/scene/SceneRenderer3D.js', () => ({
  drawFieldMapper: (pass, renderers, frame) => h.draws.push({ pass, renderers, frame }),
}));

import { ReceiverScene3D, fitTargetSize } from '../src/ui/secondMonitorScene3D.js';

function fakeDevice() {
  const textures = [];
  return {
    textures,
    submitted: 0,
    createTexture: vi.fn((desc) => {
      const t = { desc, destroyed: false, createView: () => ({ of: t }), destroy() { this.destroyed = true; } };
      textures.push(t);
      return t;
    }),
    createSampler: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn((d) => ({ d, end: vi.fn() })),
      finish: () => ({}),
    })),
    queue: { submit: vi.fn(function () { this.count = (this.count || 0) + 1; }) },
  };
}

function fakeExec() {
  const field = { label: 'noise-output' };
  return {
    field,
    fallbackTexture: { label: 'fallback' },
    nodeOutputs: new Map([['1', field]]),
    computeTextures: new Map(),
    getNodeOutput(id) { return this.nodeOutputs.get(id) || this.fallbackTexture; },
  };
}

const node = (over = {}) => ({
  id: '42',
  sourceId: '1',
  shapeParams: { mode: 'surface', shape: 'sphere' },
  model: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0, 0, 1]),
  camera: { azimuth: 1, elevation: 0.3, distance: 5, target: [0, 0, 0] },
  ...over,
});

describe('ReceiverScene3D', () => {
  beforeEach(() => {
    h.draws.length = 0;
    vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('draws each 3D node from its source field and publishes it where the output samples it', () => {
    const device = fakeDevice();
    const exec = fakeExec();
    const scene = new ReceiverScene3D(device);
    scene.apply([node()], exec);
    scene.render(exec, 1920, 1080);

    expect(h.draws).toHaveLength(1);
    const { frame } = h.draws[0];
    expect(frame.texture).toBe(exec.field);
    expect(frame.shapeParams.shape).toBe('sphere');
    expect(frame.modelMatrix.elements[12]).toBe(0.5);
    expect(frame.viewMatrix.elements).toHaveLength(16);

    const target = exec.nodeOutputs.get('42');
    expect(target.desc.size).toMatchObject({ width: 1920, height: 1080 });
    expect(exec.computeTextures.get('42').texture).toBe(target);
    // Survives the executor's re-initialize like the editor's 3D output does.
    expect(exec.externalOutputNodeIds.has('42')).toBe(true);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
  });

  it('draws the bare shape when its source has not produced a field yet', () => {
    const exec = fakeExec();
    const scene = new ReceiverScene3D(fakeDevice());
    scene.apply([node({ sourceId: 'missing' })], exec);
    scene.render(exec, 800, 600);
    expect(h.draws[0].frame.texture).toBe(null);
  });

  it('unpublishes and releases a 3D node the editor stops sending', () => {
    const exec = fakeExec();
    const scene = new ReceiverScene3D(fakeDevice());
    scene.apply([node()], exec);
    scene.render(exec, 800, 600);
    const target = exec.nodeOutputs.get('42');

    scene.apply([], exec);
    expect(exec.nodeOutputs.has('42')).toBe(false);
    expect(exec.computeTextures.has('42')).toBe(false);
    expect(exec.externalOutputNodeIds.has('42')).toBe(false);
    expect(scene.ids).toEqual([]);
    // Retired, not destroyed on the spot: a bind group may still reference it.
    expect(target.destroyed).toBe(false);
    for (let i = 0; i < 130; i++) scene.render(exec, 800, 600);
    expect(target.destroyed).toBe(true);
  });

  it('rebuilds its targets at a new size', () => {
    const exec = fakeExec();
    const scene = new ReceiverScene3D(fakeDevice());
    scene.apply([node()], exec);
    scene.render(exec, 800, 600);
    const first = exec.nodeOutputs.get('42');
    scene.render(exec, 1024, 768);
    const second = exec.nodeOutputs.get('42');
    expect(second).not.toBe(first);
    expect(second.desc.size).toMatchObject({ width: 1024, height: 768 });
  });

  it('caps targets at 2048 on the long edge, keeping their shape', () => {
    expect(fitTargetSize(3840, 2160)).toEqual([2048, 1152]);
    expect(fitTargetSize(1280, 720)).toEqual([1280, 720]);
  });
});
