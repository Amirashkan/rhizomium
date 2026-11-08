import { describe, it, expect, vi } from 'vitest';
import { TextureManager } from '../src/core/TextureManager.js';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';

describe('VJ scene media lifecycle', () => {
  it('stops and removes every outgoing video from the per-frame upload set', () => {
    const manager = new TextureManager();
    const firstVideo = {
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    };
    const secondVideo = {
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    };
    manager.videos.set('scene-a-video', { video: firstVideo, objectUrl: null, lastFrameTime: -1 });
    manager.videos.set('scene-a-video-2', { video: secondVideo, objectUrl: null, lastFrameTime: -1 });

    expect(manager.releaseAllVideos()).toBe(2);

    expect(firstVideo.pause).toHaveBeenCalledOnce();
    expect(firstVideo.removeAttribute).toHaveBeenCalledWith('src');
    expect(firstVideo.load).toHaveBeenCalledOnce();
    expect(secondVideo.pause).toHaveBeenCalledOnce();
    expect(manager.videos.size).toBe(0);

    // The render loop can no longer upload frames from the outgoing scene.
    manager.device = {
      queue: { copyExternalImageToTexture: vi.fn() },
      createTexture: vi.fn(),
    };
    manager.updateVideoTextures();
    expect(manager.device.queue.copyExternalImageToTexture).not.toHaveBeenCalled();
  });

  it('releases outgoing scene videos when SaveLoadManager replaces the graph', () => {
    const nodes = [{ id: 'old-video-node' }];
    const releaseAllVideos = vi.fn(() => {
      // Release happens while the outgoing graph is still identifiable.
      expect(manager.graph.nodes).toBe(nodes);
    });
    const manager = {
      graph: { nodes, connections: [{ id: 'old-connection' }], selection: new Set(['old-video-node']) },
      textureManager: { releaseAllVideos },
      editor: {
        selection: { clear: vi.fn() },
        nodePreviews: new Map([['old-video-node', {}]]),
      },
    };
    const previousRegistry = window.computeNodeRegistry;
    window.computeNodeRegistry = { clear: vi.fn() };

    try {
      SaveLoadManager.prototype.clearGraph.call(manager);

      expect(releaseAllVideos).toHaveBeenCalledOnce();
      expect(manager.graph.nodes).toEqual([]);
      expect(manager.graph.connections).toEqual([]);
      expect(manager.graph.selection.size).toBe(0);
    } finally {
      if (previousRegistry === undefined) delete window.computeNodeRegistry;
      else window.computeNodeRegistry = previousRegistry;
    }
  });
});
