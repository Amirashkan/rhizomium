import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SaveLoadManager, dataUrlToBlob } from '../src/core/SaveLoadManager.js';

// A patch carries its media inline. These cover the video half of that: what gets written into
// the file, and what the loader will (and will not) accept back.

function manager(textureManager) {
  const slm = new SaveLoadManager({}, { nodes: [] }, () => {});
  slm.setTextureManager(textureManager);
  return slm;
}

function fakeTextureManager() {
  return {
    textures: new Map(),
    gpuTextures: new Map(),
    device: {},
    getTexture(id) { return this.textures.get(id); },
    uploadVideo: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  globalThis.window = globalThis.window || {};
});

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL, preserving the MIME type', () => {
    const blob = dataUrlToBlob('data:video/mp4;base64,QUJD'); // "ABC"
    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBe(3);
  });

  it('refuses malformed and non-base64 URLs', () => {
    expect(() => dataUrlToBlob('data:video/mp4')).toThrow(/Malformed/);
    expect(() => dataUrlToBlob('data:video/mp4,plain')).toThrow(/base64/);
  });
});

describe('video textures in a saved patch', () => {
  it('records isVideo alongside the inlined source', () => {
    const tm = fakeTextureManager();
    tm.textures.set('n1', {
      filename: 'clip.mp4', dataUrl: 'data:video/mp4;base64,QUJD',
      width: 320, height: 180, isVideo: true,
    });
    const slm = manager(tm);
    slm.graph = { nodes: [{ id: 'n1', kind: 'Texture2D' }] };

    expect(slm.collectTextureData().n1).toMatchObject({
      filename: 'clip.mp4', isVideo: true, width: 320, height: 180,
    });
  });

  it('routes a saved video back through the video upload path', async () => {
    const tm = fakeTextureManager();
    const slm = manager(tm);

    await slm.restoreTextures({
      n1: { filename: 'clip.mp4', dataUrl: 'data:video/mp4;base64,QUJD', isVideo: true },
    });

    expect(tm.uploadVideo).toHaveBeenCalledTimes(1);
    const [nodeId, file, options] = tm.uploadVideo.mock.calls[0];
    expect(nodeId).toBe('n1');
    expect(file.name).toBe('clip.mp4');
    // Handed back so re-saving the patch doesn't re-encode the same bytes.
    expect(options.dataUrl).toBe('data:video/mp4;base64,QUJD');
  });

  it('refuses a remote video URL rather than fetching it on open', async () => {
    const tm = fakeTextureManager();
    const slm = manager(tm);

    await expect(
      slm.loadVideoFromDataUrl('n1', 'https://attacker.example/x.mp4', 'x.mp4')
    ).rejects.toThrow(/inline data: video URL/);
    expect(tm.uploadVideo).not.toHaveBeenCalled();
  });

  it('skips a video that was too large to inline, leaving the rest of the patch intact', async () => {
    const tm = fakeTextureManager();
    const slm = manager(tm);

    await slm.restoreTextures({
      big: { filename: 'huge.mp4', dataUrl: null, isVideo: true },
    });

    expect(tm.uploadVideo).not.toHaveBeenCalled();
  });
});
