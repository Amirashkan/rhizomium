// tests/loadedTextureBinding.test.js
//
// A Texture 2D in an OPENED project kept its filename and rendered flat white,
// with the console repeating:
//
//   [Texture "fragment-texture-22"] usage (TextureBinding|RenderAttachment)
//   includes writable usage and another usage in the same synchronization scope.
//
// Two independent load-time defects, both fixed here:
//
//  1. Restoring a patch's inlined image registered { texture, sampler } and no
//     textureView, while a fresh upload registers { texture, textureView, sampler }.
//     The fragment/preview renderer demanded the view and fell through to its 1x1
//     white dummy — so the node, and every texture bridged from it, showed white.
//
//  2. window.computeNodeRegistry survives a graph replacement (loading a project
//     clears the graph without deleting nodes one at a time), so a loaded node
//     inherits a dead compute node's id. The Texture 2D was then compiled with a
//     compute_node_<id> binding on top of its own texture_<id> pair, which resolves
//     to the node's own bridged output texture — the texture its render pass draws
//     into — invalidating every command buffer that pass went into.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';
import { TextureBindings } from '../src/codegen/generators/TextureBindings.js';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';
import { restoreImageTexture } from '../src/core/patchTextures.js';

const makeTexture = (label) => {
  const texture = { label, viewCount: 0 };
  texture.createView = () => {
    texture.viewCount += 1;
    return { label: `${label}-view`, of: texture };
  };
  return texture;
};

function makeRenderer() {
  const renderer = Object.create(FragmentTextureRenderer.prototype);
  renderer.device = {
    createTexture: vi.fn(() => makeTexture('dummy')),
    createSampler: vi.fn(() => ({ fallback: true })),
    queue: { writeTexture: vi.fn() },
  };
  return renderer;
}

describe('a Texture 2D restored from a saved project', () => {
  let renderer;

  beforeEach(() => {
    renderer = makeRenderer();
    vi.stubGlobal('window', {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it('binds the restored image, not the white dummy, when the entry has no view yet', () => {
    const texture = makeTexture('restored');
    // Exactly what a restore used to register: a texture and a sampler, no view.
    window.textureManager = {
      textures: new Map([['22', { filename: 'photo.png' }]]),
      gpuTextures: new Map([['22', { texture, sampler: { real: true } }]]),
    };

    const view = renderer._createResource({ kind: 'texture-2d', varName: 'texture_22' }, new Map());

    expect(view.of).toBe(texture);
    expect(renderer.device.createTexture).not.toHaveBeenCalled(); // no 1x1 white fallback
  });

  it('creates that view once, not once per bind-group rebuild', () => {
    const texture = makeTexture('restored');
    window.textureManager = { textures: new Map(), gpuTextures: new Map([['22', { texture }]]) };

    const meta = { kind: 'texture-2d', varName: 'texture_22' };
    renderer._createResource(meta, new Map());
    renderer._createResource(meta, new Map());
    renderer._createResource(meta, new Map());

    expect(texture.viewCount).toBe(1);
  });

  it('still finds the sampler for the same node', () => {
    const sampler = { real: true };
    window.textureManager = {
      textures: new Map(),
      gpuTextures: new Map([['22', { texture: makeTexture('restored'), sampler }]]),
    };

    expect(renderer._createResource({ kind: 'sampler', varName: 'sampler_22' }, new Map())).toBe(sampler);
  });

  it('does not let a half-populated entry shadow a usable one in the other map', () => {
    const texture = makeTexture('restored');
    window.textureManager = {
      // The bitmap-only entry a restore writes first; the GPU entry is the usable one.
      textures: new Map([['22', { filename: 'photo.png', width: 4, height: 4 }]]),
      gpuTextures: new Map([['22', { texture }]]),
      getTexture(id) { return this.textures.get(id); },
    };

    const view = renderer._createResource({ kind: 'texture-2d', varName: 'texture_22' }, new Map());
    expect(view.of).toBe(texture);
  });

  it('falls back to the white dummy only when the node really has no texture', () => {
    window.textureManager = { textures: new Map(), gpuTextures: new Map() };

    renderer._createResource({ kind: 'texture-2d', varName: 'texture_99' }, new Map());
    expect(renderer.device.createTexture).toHaveBeenCalled();
  });
});

describe('restoring a patch image registers it the way a fresh upload does', () => {
  let OriginalImage;

  beforeEach(() => {
    OriginalImage = globalThis.Image;
    // A decode that resolves, without depending on the DOM's image loading.
    globalThis.Image = class {
      constructor() { this.width = 8; this.height = 4; }
      set src(_value) { queueMicrotask(() => this.onload?.()); }
    };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 8, height: 4 })));
  });

  afterEach(() => {
    globalThis.Image = OriginalImage;
    vi.unstubAllGlobals();
  });

  it('uploads through the texture manager, so the entry carries a view', async () => {
    const uploaded = [];
    const textureManager = {
      device: {},
      textures: new Map(),
      gpuTextures: new Map(),
      uploadToGPU(nodeId, bitmap) {
        uploaded.push([nodeId, bitmap]);
        const texture = makeTexture(`gpu-${nodeId}`);
        this.gpuTextures.set(nodeId, { texture, textureView: texture.createView(), sampler: {} });
      },
    };

    await restoreImageTexture(textureManager, '22', 'data:image/png;base64,iVBORw0KGgo=', 'photo.png');

    expect(uploaded).toHaveLength(1);
    expect(textureManager.gpuTextures.get('22').textureView).toBeTruthy();
    expect(textureManager.textures.get('22').filename).toBe('photo.png');
  });

  it('registers a view even for a manager that has no uploadToGPU of its own', async () => {
    const textureManager = {
      device: {
        createTexture: vi.fn(() => makeTexture('inline')),
        createSampler: vi.fn(() => ({ sampler: true })),
        queue: { copyExternalImageToTexture: vi.fn() },
      },
      textures: new Map(),
    };

    await restoreImageTexture(textureManager, '22', 'data:image/png;base64,iVBORw0KGgo=', 'photo.png');

    const entry = textureManager.gpuTextures.get('22');
    expect(entry.texture).toBeTruthy();
    expect(entry.textureView).toBeTruthy();
    expect(entry.sampler).toBeTruthy();
  });
});

describe('a binding that names the pass its own render target', () => {
  let renderer;

  beforeEach(() => {
    renderer = makeRenderer();
    vi.stubGlobal('window', {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it('refuses to sample the texture the pass is drawing into', () => {
    const output = makeTexture('fragment-texture-22');
    window.computeExecutor = { nodeOutputs: new Map([['22', output]]), computeTextures: new Map() };

    const resource = renderer._createResource(
      { kind: 'texture-2d', varName: 'compute_node_22' },
      new Map(),
      null,
      output,
    );

    // The white dummy costs this one binding; sampling the attachment would have
    // invalidated every command buffer the pass was batched into.
    expect(resource.of).not.toBe(output);
    expect(renderer.device.createTexture).toHaveBeenCalled();
  });

  it('still samples another node\'s output texture', () => {
    const other = makeTexture('fragment-texture-30');
    window.computeExecutor = { nodeOutputs: new Map([['30', other]]), computeTextures: new Map() };

    const resource = renderer._createResource(
      { kind: 'texture-2d', varName: 'compute_node_30' },
      new Map(),
      null,
      makeTexture('fragment-texture-22'),
    );

    expect(resource.of).toBe(other);
  });
});

describe('compute bindings from a registry that outlived its graph', () => {
  beforeEach(() => vi.stubGlobal('window', {}));
  afterEach(() => vi.unstubAllGlobals());

  const graph = { nodes: [] };

  it('does not bind a loaded Texture 2D as a compute output it never was', () => {
    // Node 22 is a compute node no more: the file that was opened numbered a
    // Texture 2D with the same id.
    window.computeNodeRegistry = new Map([['22', { node: { id: '22', kind: 'ComputeBlur' } }]]);
    const nodes = [{ id: '22', kind: 'Texture2D' }];

    const code = TextureBindings.generate(graph, nodes);

    expect(code).toContain('var texture_22: texture_2d<f32>');
    expect(code).not.toContain('compute_node_22');
  });

  it('still binds a real compute node exactly once', () => {
    window.computeNodeRegistry = new Map([['30', { node: { id: '30', kind: 'ComputeBlur' } }]]);
    const nodes = [{ id: '30', kind: 'ComputeBlur' }];

    const code = TextureBindings.generate(graph, nodes);

    expect(code.match(/var compute_node_30: texture_2d<f32>/g)).toHaveLength(1);
  });
});

describe('replacing the graph tears down the compute stack it was built for', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clears the registry, managers and cached fragment textures', () => {
    const computeExecutor = { clear: vi.fn(), clearFragmentCache: vi.fn() };
    vi.stubGlobal('window', { computeExecutor });

    const manager = {
      graph: { nodes: [{ id: '1' }], connections: [{}], selection: new Set(['1']) },
      clearGraph: SaveLoadManager.prototype.clearGraph,
    };

    manager.clearGraph();

    expect(manager.graph.nodes).toEqual([]);
    expect(computeExecutor.clear).toHaveBeenCalled();
    expect(computeExecutor.clearFragmentCache).toHaveBeenCalled();
  });

  it('is a no-op on the compute stack when there is no executor (the viewer)', () => {
    vi.stubGlobal('window', {});
    const manager = {
      graph: { nodes: [], connections: [], selection: new Set() },
      clearGraph: SaveLoadManager.prototype.clearGraph,
    };

    expect(() => manager.clearGraph()).not.toThrow();
  });
});
