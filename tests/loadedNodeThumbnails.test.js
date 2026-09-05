// tests/loadedNodeThumbnails.test.js
//
// Opening a project used to leave placeholder cards on the canvas: nodes whose thumbnail should be
// their real rendered output ("Remap", "To Grayscale", "Invert Color", "Expression", ...) came back
// showing the CPU renderer registry's stand-in text — "REMAP", "GRAY", "INV", "fx" — and kept it
// until the artist touched a parameter.
//
// Two things put them there, both covered here:
//
//   1. importProject painted a thumbnail for every loaded node itself, calling the CPU renderer
//      registry directly and assigning node.__thumb. That ran after (and over) the GPU previews.
//   2. The thumbnail queue rendered into the node object captured when an item was ENQUEUED. A load
//      replaces every node object with a fresh one carrying the same id, so a preview queued before
//      the load wrote its result into an orphan and the node on screen never got its image.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShaderPreviewManager } from '../src/preview/ShaderPreviewManager.js';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';
import { SAVE_FORMAT_VERSION } from '../src/core/projectMigrations.js';

// A ShaderPreviewManager with only the state the thumbnail queue touches, and the three render
// paths stubbed so a drain records where each thumbnail landed without any GPU.
function makeManager(nodes, { enabled = () => true } = {}) {
  const spm = Object.create(ShaderPreviewManager.prototype);
  spm.editor = { graph: { nodes }, isNodePreviewEnabled: enabled };
  spm._thumbQueue = new Map();
  spm._thumbDraining = false;
  spm._doComputePreview = async (node) => { node.__thumb = 'gpu-compute'; };
  spm._doFragmentPreview = async (node) => { node.__thumb = 'gpu-fragment'; };
  spm._textureToThumbnail = async (texture, node) => { node.__thumb = texture; };
  spm.fallbackToLegacyPreview = (node) => { node.__thumb = 'cpu-placeholder'; };
  return spm;
}

describe('thumbnail queue after the graph is replaced', () => {
  it('renders into the node now in the graph, not the object queued before the load', async () => {
    const stale = { id: '7', kind: 'ColorInvert' };
    const spm = makeManager([stale]);

    // Queued while the old graph was live (the render loop queues previews continuously)...
    spm._thumbQueue.set('7', { node: stale, type: 'fragment' });
    // ...and the load lands before the queue drains: same id, brand new object.
    const loaded = { id: '7', kind: 'ColorInvert' };
    spm.editor.graph.nodes = [loaded];

    await spm._processThumbQueue();

    expect(loaded.__thumb).toBe('gpu-fragment');
    expect(stale.__thumb).toBeUndefined();
  });

  it('does the same for compute previews and for externally rendered textures', async () => {
    const staleCompute = { id: '1', kind: 'ComputeNoise' };
    const staleExternal = { id: '2', kind: 'ComputeFieldMapper' };
    const spm = makeManager([staleCompute, staleExternal]);

    spm._thumbQueue.set('1', { node: staleCompute, type: 'compute' });
    spm._thumbQueue.set('2', { node: staleExternal, type: 'external', texture: 'viewport-texture' });

    const loadedCompute = { id: '1', kind: 'ComputeNoise' };
    const loadedExternal = { id: '2', kind: 'ComputeFieldMapper' };
    spm.editor.graph.nodes = [loadedCompute, loadedExternal];

    await spm._processThumbQueue();

    expect(loadedCompute.__thumb).toBe('gpu-compute');
    expect(loadedExternal.__thumb).toBe('viewport-texture');
    expect(staleCompute.__thumb).toBeUndefined();
    expect(staleExternal.__thumb).toBeUndefined();
  });

  it('falls back to the CPU approximation on the live node when the GPU render throws', async () => {
    const stale = { id: '7', kind: 'Circle' };
    const spm = makeManager([stale]);
    spm._doFragmentPreview = async () => { throw new Error('no device'); };

    spm._thumbQueue.set('7', { node: stale, type: 'fragment' });
    const loaded = { id: '7', kind: 'Circle' };
    spm.editor.graph.nodes = [loaded];

    await spm._processThumbQueue();

    expect(loaded.__thumb).toBe('cpu-placeholder');
    expect(stale.__thumb).toBeUndefined();
  });

  it('still skips a node the load removed from the graph', async () => {
    const deleted = { id: '9', kind: 'Remap' };
    const spm = makeManager([]);
    spm._thumbQueue.set('9', { node: deleted, type: 'fragment' });

    await spm._processThumbQueue();

    expect(deleted.__thumb).toBeUndefined();
    expect(spm._thumbDraining).toBe(false);
  });

  it('reads the eye toggle off the live node, so a hidden thumbnail stays hidden', async () => {
    const stale = { id: '7', kind: 'Circle' };
    const loaded = { id: '7', kind: 'Circle' };
    // Only the object currently in the graph is hidden; the queued one still reads as visible.
    const spm = makeManager([loaded], { enabled: (node) => node !== loaded });

    spm._thumbQueue.set('7', { node: stale, type: 'fragment' });
    await spm._processThumbQueue();

    expect(loaded.__thumb).toBeUndefined();
    expect(stale.__thumb).toBeUndefined();
  });
});

describe('importProject and node thumbnails', () => {
  let manager;
  let nodes;
  let updateAllPreviews;

  beforeEach(() => {
    // A loaded graph whose thumbnails the preview funnel has already produced.
    nodes = [
      { id: '1', kind: 'Remap', __thumb: 'gpu-render' },
      { id: '2', kind: 'ColorToGrayscale', __thumb: 'gpu-render' },
      { id: '3', kind: 'OutputFinal', __thumb: 'gpu-render' },
    ];
    updateAllPreviews = vi.fn();

    const previewSystem = {
      updateAllPreviews,
      // The CPU renderer registry the load path used to reach into directly. Any call to it here
      // would be the placeholder repaint coming back.
      rendererRegistry: {
        getRenderer: vi.fn(() => () => { throw new Error('registry must not be used on load'); }),
      },
    };

    manager = Object.create(SaveLoadManager.prototype);
    manager.graph = { nodes };
    manager.editor = {
      previewSystem,
      draw: vi.fn(),
      markDirty: vi.fn(),
      onNodeChanged: vi.fn(),
    };
    manager.updateStatus = vi.fn();
    manager.clearGraph = vi.fn();
    manager.importNodes = vi.fn();
    manager.importConnections = vi.fn();
    manager.importViewerControls = vi.fn();
    manager.importViewerPage = vi.fn();
    manager.validateProjectData = vi.fn();
    manager.reinitializeWebGPU = vi.fn(async () => null);
    manager.forceShaderUpdate = vi.fn(async () => true);
    manager._updateDocumentTitle = vi.fn();

    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('leaves the rendered thumbnails alone and asks the preview funnel to refresh them', async () => {
    await SaveLoadManager.prototype.importProject.call(manager, {
      app: 'Rhizomium-Web',
      version: SAVE_FORMAT_VERSION,
      nodes: [],
      connections: [],
    });

    // Nothing in the load path paints a thumbnail by hand any more — including OutputFinal, which
    // used to get a squashed square copy of the output canvas.
    for (const node of nodes) {
      expect(node.__thumb).toBe('gpu-render');
    }
    expect(manager.editor.previewSystem.rendererRegistry.getRenderer).not.toHaveBeenCalled();

    // Refreshing goes through the one funnel that prefers the GPU and honours the eye toggle.
    expect(updateAllPreviews).toHaveBeenCalledWith(nodes);
  }, 20000);
});
