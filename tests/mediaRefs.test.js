// The desktop editor saves media by path instead of inlining it: the project
// file, the autosave snapshot and backups name each image, video, audio clip
// and font by where it came from, and opening the project reads those paths
// back. See src/core/mediaRefs.js and src/core/mediaPaths.js.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args) => invoke(...args) }));

import {
  rememberPath, pathFor, linkSource, fingerprint, readMediaAsFile, fileToDataUrl,
  MediaReadError, mimeForName, _resetMediaPaths,
} from '../src/core/mediaPaths.js';
import { externalizeMedia, internalizeMedia } from '../src/core/mediaRefs.js';
import { restorePatchTextures } from '../src/core/patchTextures.js';
import { AudioLibrary } from '../src/vj/AudioLibrary.js';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';
import { migrateProjectData, SAVE_FORMAT_VERSION } from '../src/core/projectMigrations.js';
import { dispatchFileDrop } from '../src/core/tauriMediaDrop.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const AUDIO = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA';
const FONT = 'data:font/ttf;base64,AAEAAAALAIAAAwAwT1MvMg8SBfwAAAC8AAAAYGNtYXAXVtKNAAABHAAAAFRnYXNw';

const file = (name, type = '', bytes = 'xxxx') => new File([bytes], name, { type });

function project(overrides = {}) {
  return {
    version: SAVE_FORMAT_VERSION,
    nodes: [
      { id: '1', kind: 'Texture2D', params: { imageFile: 'a.png' } },
      { id: '2', kind: 'Texture2D', params: { imageFile: 'clip.mp4', sourceType: 'video' } },
      { id: '3', kind: 'AudioSampler', params: { audioFile: 'beat.mp3', audioData: AUDIO } },
      { id: '4', kind: 'Text', params: { fontName: 'Inter', fontData: FONT } },
    ],
    connections: [],
    textures: {
      1: { filename: 'a.png', dataUrl: PNG, width: 1, height: 1, isVideo: false },
      2: { filename: 'clip.mp4', dataUrl: null, width: 640, height: 360, isVideo: true },
    },
    ...overrides,
  };
}

beforeEach(() => {
  _resetMediaPaths();
  invoke.mockReset();
  delete window.__TAURI_INTERNALS__;
});

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
});

describe('the path registry', () => {
  it('answers by File identity and by data: URL content', () => {
    const picked = file('a.png', 'image/png');
    rememberPath(picked, 'C:\\media\\a.png');
    rememberPath(PNG, '/media/a.png');

    expect(pathFor(picked)).toBe('C:\\media\\a.png');
    expect(pathFor(file('a.png', 'image/png'))).toBeNull();
    // Equal content, a different string object: still the same file.
    expect(pathFor(`${PNG}`.slice(0))).toBe('/media/a.png');
    expect(pathFor(PNG.replace('iVBOR', 'iVBOX'))).toBeNull();
    expect(pathFor(null)).toBeNull();
  });

  it('carries a path from a File to the data: URL it was read into', () => {
    const font = file('Inter.ttf');
    rememberPath(font, '/fonts/Inter.ttf');
    expect(linkSource(font, FONT)).toBe('/fonts/Inter.ttf');
    expect(pathFor(FONT)).toBe('/fonts/Inter.ttf');

    // Nothing to carry from a file with no known path.
    expect(linkSource(file('x.ttf'), AUDIO)).toBeNull();
    expect(pathFor(AUDIO)).toBeNull();
  });

  it('fingerprints long payloads by sampling, telling apart edits anywhere in them', () => {
    const long = `data:video/mp4;base64,${'A'.repeat(500_000)}`;
    const edited = `${long.slice(0, 250_000)}B${long.slice(250_001)}`;
    expect(fingerprint(long)).toBe(fingerprint(`${long}`));
    expect(fingerprint(long)).not.toBe(fingerprint(`${long}A`));
    // The end is always sampled.
    expect(fingerprint(long)).not.toBe(fingerprint(`${long.slice(0, -1)}B`));
    expect(fingerprint(edited)).toMatch(/^500022:/);
  });
});

describe('saving media by path', () => {
  it('replaces media with a known path by a reference, and leaves the rest inline', () => {
    const video = file('clip.mp4', 'video/mp4');
    rememberPath(video, '/media/clip.mp4');
    rememberPath(PNG, '/media/a.png');
    rememberPath(FONT, '/fonts/Inter.ttf');
    const data = project();
    const textures = new Map([['2', { file: video, isVideo: true }]]);

    const saved = externalizeMedia(data, { textures });

    expect(saved.textures[1]).toEqual({
      filename: 'a.png', width: 1, height: 1, isVideo: false, dataUrl: null,
      ref: { path: '/media/a.png', name: 'a.png', mime: 'image/png' },
    });
    // A video too large to inline used to be dropped; now it is saved by path.
    expect(saved.textures[2].ref).toEqual({ path: '/media/clip.mp4', name: 'clip.mp4', mime: 'video/mp4' });

    // The font had a path; the audio clip did not, so it stays inline.
    expect(saved.nodes[3].params).toEqual({ fontName: 'Inter', fontData: '' });
    expect(saved.nodes[2].params.audioData).toBe(AUDIO);
    expect(saved.mediaParams).toEqual([
      { nodeId: '4', param: 'fontData', ref: { path: '/fonts/Inter.ttf', name: 'Inter.ttf', mime: 'font/ttf' } },
    ]);

    // The open project is untouched.
    expect(data.textures[1].dataUrl).toBe(PNG);
    expect(data.nodes[3].params.fontData).toBe(FONT);
    expect(data.mediaParams).toBeUndefined();
  });

  it('saves a browser project exactly as before: nothing has a path', () => {
    const data = project();
    const saved = externalizeMedia(data, { textures: new Map() });
    expect(saved.textures).toEqual(data.textures);
    expect(saved.nodes).toEqual(data.nodes);
    expect(saved.mediaParams).toBeUndefined();
  });

  it('names VJ scene media by path too, without touching the live scene list', () => {
    rememberPath(PNG, '/media/a.png');
    const scene = { id: 's1', name: 'Intro', data: project() };
    const data = project({ vjSet: { scenes: { version: 1, scenes: [scene] }, audio: [] } });

    const saved = externalizeMedia(data);

    const savedScene = saved.vjSet.scenes.scenes[0];
    expect(savedScene.data.textures[1].ref.path).toBe('/media/a.png');
    expect(savedScene.data.textures[1].dataUrl).toBeNull();
    expect(scene.data.textures[1].dataUrl).toBe(PNG);
  });

  it('writes back media the project could not find, so saving before relinking loses nothing', () => {
    const lostTexture = { filename: 'gone.png', dataUrl: null, ref: { path: '/old/gone.png', name: 'gone.png' } };
    const lostTrack = { name: 'Bed', type: 'audio/mpeg', ref: { path: '/old/bed.mp3', name: 'bed.mp3' } };
    const missing = [
      { kind: 'texture', nodeId: '1', ref: lostTexture.ref, entry: lostTexture },
      { kind: 'texture', nodeId: '99', ref: { path: '/old/x.png' }, entry: { filename: 'x.png', ref: { path: '/old/x.png' } } },
      { kind: 'param', nodeId: '3', param: 'audioData', ref: { path: '/old/beat.mp3', name: 'beat.mp3' } },
      { kind: 'audio', ref: lostTrack.ref, entry: lostTrack },
    ];
    const data = project({ textures: {}, vjSet: { scenes: { scenes: [] }, audio: [] } });
    data.nodes[2].params.audioData = '';

    const saved = externalizeMedia(data, { missing });

    expect(saved.textures).toEqual({ 1: lostTexture });
    expect(saved.mediaParams).toEqual([
      { nodeId: '3', param: 'audioData', ref: { path: '/old/beat.mp3', name: 'beat.mp3' } },
    ]);
    expect(saved.vjSet.audio).toEqual([lostTrack]);
  });

  it('lets media picked since win over a missing reference', () => {
    const missing = [
      { kind: 'texture', nodeId: '1', ref: { path: '/old/a.png' }, entry: { ref: { path: '/old/a.png' } } },
      { kind: 'param', nodeId: '4', param: 'fontData', ref: { path: '/old/f.ttf' } },
    ];
    const saved = externalizeMedia(project(), { missing });
    expect(saved.textures[1].dataUrl).toBe(PNG);
    expect(saved.nodes[3].params.fontData).toBe(FONT);
    expect(saved.mediaParams).toBeUndefined();
  });
});

describe('opening a project saved by path', () => {
  const files = {
    '/media/a.png': () => file('a.png', 'image/png', 'png-bytes'),
    '/media/clip.mp4': () => file('clip.mp4', 'video/mp4', 'mp4-bytes'),
    '/fonts/Inter.ttf': () => file('Inter.ttf', '', 'ttf-bytes'),
    '/audio/bed.mp3': () => file('bed.mp3', 'audio/mpeg', 'mp3-bytes'),
  };
  const read = vi.fn(async (path) => {
    if (!files[path]) throw new MediaReadError(path, 'not-found');
    const made = files[path]();
    rememberPath(made, path);
    return made;
  });

  function savedProject() {
    const data = project({
      textures: {
        1: { filename: 'a.png', dataUrl: null, width: 1, height: 1, isVideo: false, ref: { path: '/media/a.png', name: 'a.png' } },
        2: { filename: 'clip.mp4', dataUrl: null, isVideo: true, ref: { path: '/media/clip.mp4', name: 'clip.mp4' } },
      },
      mediaParams: [
        { nodeId: '4', param: 'fontData', ref: { path: '/fonts/Inter.ttf', name: 'Inter.ttf' } },
        { nodeId: '3', param: 'audioData', ref: { path: '/gone/beat.mp3', name: 'beat.mp3' } },
      ],
    });
    data.nodes[2].params.audioData = '';
    data.nodes[3].params.fontData = '';
    return data;
  }

  it('reads every reference back into the inline shape the loader takes', async () => {
    const { data, missing } = await internalizeMedia(savedProject(), { read });

    expect(data.textures[1].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(data.textures[2].file).toBeInstanceOf(File);
    expect(data.textures[2].isVideo).toBe(true);
    // A font file with no type of its own is labelled from its extension.
    expect(data.nodes[3].params.fontData).toMatch(/^data:font\/ttf;base64,/);

    // The clip's file is gone: reported, and its reference kept for the next save.
    expect(missing).toEqual([
      expect.objectContaining({ kind: 'param', nodeId: '3', param: 'audioData', ref: { path: '/gone/beat.mp3', name: 'beat.mp3' } }),
    ]);
    expect(data.mediaParams).toEqual([
      { nodeId: '3', param: 'audioData', ref: { path: '/gone/beat.mp3', name: 'beat.mp3' } },
    ]);
  });

  it('round-trips: saving the opened project names the same paths again', async () => {
    const { data, missing } = await internalizeMedia(savedProject(), { read });
    const textures = new Map([['2', { file: data.textures[2].file, isVideo: true }]]);

    const saved = externalizeMedia(data, { textures, missing });

    expect(saved.textures[1].ref.path).toBe('/media/a.png');
    expect(saved.textures[1].dataUrl).toBeNull();
    expect(saved.textures[2].ref.path).toBe('/media/clip.mp4');
    expect(saved.textures[2]).not.toHaveProperty('file');
    expect(saved.nodes[3].params.fontData).toBe('');
    expect(saved.mediaParams).toEqual(expect.arrayContaining([
      expect.objectContaining({ nodeId: '4', param: 'fontData', ref: expect.objectContaining({ path: '/fonts/Inter.ttf' }) }),
      expect.objectContaining({ nodeId: '3', param: 'audioData', ref: expect.objectContaining({ path: '/gone/beat.mp3' }) }),
    ]));
  });

  it('reports a texture it cannot read and leaves the node to open empty', async () => {
    const data = project({
      textures: { 1: { filename: 'x.png', dataUrl: null, ref: { path: '/nowhere/x.png', name: 'x.png' } } },
    });
    const result = await internalizeMedia(data, { read });
    expect(result.data.textures[1].dataUrl).toBeNull();
    expect(result.missing).toEqual([expect.objectContaining({ kind: 'texture', nodeId: '1' })]);
  });

  it('reads the VJ set only when it is asked to, and reports missing tracks', async () => {
    const data = project({
      vjSet: {
        scenes: { scenes: [{ id: 's', data: { nodes: [], textures: { 9: { isVideo: false, dataUrl: null, ref: { path: '/media/a.png' } } } } }] },
        audio: [
          { name: 'Bed', type: 'audio/mpeg', ref: { path: '/audio/bed.mp3', name: 'bed.mp3' } },
          { name: 'Lost', type: 'audio/mpeg', ref: { path: '/audio/lost.mp3', name: 'lost.mp3' } },
          { name: 'Inline', type: 'audio/mpeg', data: AUDIO },
        ],
      },
    });

    const skipped = await internalizeMedia(data, { read });
    expect(skipped.data.vjSet).toBe(data.vjSet);

    const { data: opened, missing } = await internalizeMedia(data, { read, includeVJSet: true });
    expect(opened.vjSet.scenes.scenes[0].data.textures[9].dataUrl).toMatch(/^data:image\/png/);
    expect(opened.vjSet.audio.map((t) => t.name)).toEqual(['Bed', 'Inline']);
    expect(opened.vjSet.audio[0].file).toBeInstanceOf(File);
    expect(missing).toEqual([expect.objectContaining({ kind: 'audio', ref: { path: '/audio/lost.mp3', name: 'lost.mp3' } })]);
  });

  it('does nothing at all to a project with no references', async () => {
    const data = project();
    const result = await internalizeMedia(data, { read: vi.fn() });
    expect(result.data).toBe(data);
    expect(result.missing).toEqual([]);
  });

  it('plays a video read back from disk without a data: URL', async () => {
    const video = file('clip.mp4', 'video/mp4');
    const textureManager = { uploadVideo: vi.fn(async () => ({})) };
    const onTextureChanged = vi.fn();

    const result = await restorePatchTextures(
      textureManager,
      { 2: { filename: 'clip.mp4', dataUrl: null, isVideo: true, file: video } },
      { onTextureChanged },
    );

    expect(textureManager.uploadVideo).toHaveBeenCalledWith('2', video);
    expect(onTextureChanged).toHaveBeenCalledWith('2');
    expect(result).toEqual({ restored: 1, failed: 0 });
  });

  it('still refuses a file-less entry that is not a data: URL', async () => {
    const textureManager = { uploadVideo: vi.fn(), textures: new Map() };
    const result = await restorePatchTextures(textureManager, {
      1: { isVideo: true, file: { not: 'a blob' }, dataUrl: 'https://example.com/x.mp4' },
    });
    expect(textureManager.uploadVideo).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });
});

describe('reading a path on the desktop', () => {
  it('is refused outside the desktop app', async () => {
    await expect(readMediaAsFile('/media/a.png')).rejects.toMatchObject({ code: 'unavailable' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('turns the bytes into a typed File that knows its path', async () => {
    window.__TAURI_INTERNALS__ = {};
    invoke.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);

    const read = await readMediaAsFile('C:\\Show\\loop.webm');

    expect(invoke).toHaveBeenCalledWith('read_media_file', { path: 'C:\\Show\\loop.webm' });
    expect(read.name).toBe('loop.webm');
    expect(read.type).toBe('video/webm');
    expect(read.size).toBe(3);
    expect(pathFor(read)).toBe('C:\\Show\\loop.webm');
  });

  it('tells a missing or ungranted file apart from other failures', async () => {
    window.__TAURI_INTERNALS__ = {};
    invoke.mockRejectedValueOnce('not-found');
    await expect(readMediaAsFile('/a.png')).rejects.toMatchObject({ code: 'not-found', path: '/a.png' });
    invoke.mockRejectedValueOnce('not-granted');
    await expect(readMediaAsFile('/a.png')).rejects.toMatchObject({ code: 'not-granted' });
    invoke.mockRejectedValueOnce(new Error('disk on fire'));
    await expect(readMediaAsFile('/a.png')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('labels typeless files from their extension when inlining them', async () => {
    expect(mimeForName('Inter.WOFF2')).toBe('font/woff2');
    expect(await fileToDataUrl(file('beat.mp3', ''))).toMatch(/^data:audio\/mpeg;base64,/);
    expect(await fileToDataUrl(file('a.png', 'image/png'))).toMatch(/^data:image\/png;base64,/);
  });
});

describe('VJ audio tracks by path', () => {
  function memoryStore() {
    const records = new Map();
    return {
      records,
      getAll: async () => [...records.values()],
      put: async (record) => { records.set(record.id, { ...record }); },
      delete: async (id) => { records.delete(id); },
    };
  }

  it('keeps a picked track\'s path and names it by path in a project file', async () => {
    const store = memoryStore();
    const library = new AudioLibrary(store);
    const picked = file('bed.mp3', 'audio/mpeg');
    rememberPath(picked, '/audio/bed.mp3');
    await library.add([picked, file('inline.mp3', 'audio/mpeg')]);

    // Stored, so the path survives a reload of the library.
    expect([...store.records.values()].find((r) => r.name === 'bed.mp3')?.path).toBe('/audio/bed.mp3');

    const byPath = await library.exportTracks({ byPath: true });
    expect(byPath[0]).toEqual({
      name: 'bed.mp3', type: 'audio/mpeg',
      ref: { path: '/audio/bed.mp3', name: 'bed.mp3', mime: 'audio/mpeg' },
    });
    expect(byPath[1].data).toMatch(/^data:audio\/mpeg;base64,/);

    // Without byPath (the browser) everything is inline as before.
    const inline = await library.exportTracks();
    expect(inline.every((t) => typeof t.data === 'string' && !t.ref)).toBe(true);
  });

  it('imports tracks read back from disk, keeping their paths for the next save', async () => {
    const library = new AudioLibrary(memoryStore());
    const fromDisk = file('bed.mp3', 'audio/mpeg');
    rememberPath(fromDisk, '/audio/bed.mp3');

    await library.importTracks([{ name: 'Opening bed', type: 'audio/mpeg', file: fromDisk }]);

    expect(library.getAll().map((t) => t.name)).toEqual(['Opening bed']);
    const [track] = await library.exportTracks({ byPath: true });
    expect(track.ref.path).toBe('/audio/bed.mp3');
  });
});

describe('SaveLoadManager', () => {
  const P = SaveLoadManager.prototype;

  it('saves the project file by path, keeping still-missing media', async () => {
    rememberPath(PNG, '/media/a.png');
    const lost = { kind: 'param', nodeId: '3', param: 'audioData', ref: { path: '/gone/beat.mp3', name: 'beat.mp3' } };
    const data = project();
    data.nodes[2].params.audioData = '';
    const stub = {
      exportProject: () => data,
      textureManager: { textures: new Map() },
      missingMedia: [lost],
    };

    const saved = await P.exportProjectFile.call(stub);

    expect(saved.textures[1].ref.path).toBe('/media/a.png');
    expect(saved.mediaParams).toEqual([{ nodeId: '3', param: 'audioData', ref: lost.ref }]);
  });

  it('remembers where a video read back from disk came from', async () => {
    const video = file('clip.mp4', 'video/mp4');
    const stub = { textureManager: { uploadVideo: vi.fn(async () => ({})) } };

    await P.restoreTextures.call(stub, {
      2: { isVideo: true, dataUrl: null, file: video, ref: { path: '/media/clip.mp4' } },
    });

    expect(pathFor(video)).toBe('/media/clip.mp4');
  });

  it('relinks a missing font onto its node and drops it from the missing list', async () => {
    const node = { id: '4', kind: 'Text', params: { fontName: 'Inter', fontData: '' } };
    const item = { kind: 'param', nodeId: '4', param: 'fontData', ref: { path: '/old/Inter.ttf', name: 'Inter.ttf' } };
    const stub = {
      graph: { nodes: [node] },
      missingMedia: [item],
      markUnsaved: vi.fn(),
      editor: { draw: vi.fn() },
    };
    const picked = file('Inter.ttf', '', 'font-bytes');
    rememberPath(picked, '/new/Inter.ttf');

    await P.relinkMissingMedia.call(stub, item, picked);

    expect(node.params.fontData).toMatch(/^data:font\/ttf;base64,/);
    expect(pathFor(node.params.fontData)).toBe('/new/Inter.ttf');
    expect(stub.missingMedia).toEqual([]);
    expect(stub.markUnsaved).toHaveBeenCalled();
  });

  it('relinks a missing texture through the same upload a fresh pick takes', async () => {
    const node = { id: '1', kind: 'Texture2D', params: {} };
    const item = { kind: 'texture', nodeId: '1', ref: { path: '/old/a.png' }, entry: { isVideo: false } };
    const textureManager = { uploadTexture: vi.fn(async () => ({ isVideo: false })) };
    const stub = { graph: { nodes: [node] }, missingMedia: [item], markUnsaved: vi.fn(), textureManager };
    const picked = file('a.png', 'image/png');

    await P.relinkMissingMedia.call(stub, item, picked);

    expect(textureManager.uploadTexture).toHaveBeenCalledWith('1', picked, node);
    expect(node.params.sourceType).toBe('image');
    expect(stub.missingMedia).toEqual([]);
  });
});

describe('save format', () => {
  it('opens a v9 project unchanged as v10', () => {
    expect(SAVE_FORMAT_VERSION).toBe(10);
    const v9 = { version: 9, nodes: [{ id: '1', kind: 'Circle', params: {} }], connections: [] };
    const migrated = migrateProjectData(v9);
    expect(migrated.version).toBe(10);
    expect(migrated.nodes).toEqual(v9.nodes);
  });
});

describe('native drops', () => {
  it('replays a drop on the element under the cursor, with the files in it', () => {
    const zone = document.createElement('div');
    document.body.appendChild(zone);
    const received = vi.fn();
    zone.addEventListener('drop', (e) => received([...e.dataTransfer.files].map((f) => f.name)));
    const original = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => zone);
    window.devicePixelRatio = 2;

    try {
      const target = dispatchFileDrop([file('a.png', 'image/png')], 200, 100);
      expect(target).toBe(zone);
      expect(document.elementFromPoint).toHaveBeenCalledWith(100, 50);
      expect(received).toHaveBeenCalledWith(['a.png']);
    } finally {
      document.elementFromPoint = original;
      zone.remove();
    }
  });
});
