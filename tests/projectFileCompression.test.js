// tests/projectFileCompression.test.js
//
// A patch carries its media inside it, as base64 `data:` URLs — four characters
// per three bytes, so a project with a 20 MB video is a 26 MB file and a third of
// that is the encoding. Gzipping the file gives that third back and lands within
// half a percent of the raw media size, which is the floor for keeping it
// losslessly. Old files must still open, so reading sniffs the gzip magic number
// rather than assuming.
import { describe, it, expect, vi } from 'vitest';
import {
  canCompressProjects,
  encodeProjectFile,
  decodeProjectFile,
} from '../src/core/projectFile.js';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';

const project = (mediaBytes = 0) => JSON.stringify({
  app: 'Rhizomium-Web',
  nodes: [{ id: '1', kind: 'Texture2D' }],
  textures: mediaBytes
    ? { 1: { filename: 'clip.mp4', dataUrl: `data:video/mp4;base64,${'QUJDRA'.repeat(mediaBytes / 6)}` } }
    : {},
});

describe('a project file on disk', () => {
  it('round-trips through compression unchanged', async () => {
    const text = project(60_000);
    const encoded = await encodeProjectFile(text);

    expect(await decodeProjectFile(new Blob([encoded]))).toBe(text);
  });

  it('is gzip when the browser can compress', async () => {
    // Guard rather than skip: the same assertion should hold wherever it can run.
    if (!canCompressProjects()) return;
    const encoded = await encodeProjectFile(project(6_000));

    expect(encoded).toBeInstanceOf(Uint8Array);
    expect([encoded[0], encoded[1]]).toEqual([0x1f, 0x8b]);
  });

  it('is meaningfully smaller than the JSON it came from', async () => {
    if (!canCompressProjects()) return;
    const text = project(600_000);
    const encoded = await encodeProjectFile(text);

    expect(encoded.byteLength).toBeLessThan(text.length * 0.8);
  });

  it('still reads a file written before compression existed', async () => {
    const text = project(3_000);

    expect(await decodeProjectFile(new Blob([text]))).toBe(text);
  });

  it('writes plain text when the browser has no CompressionStream', async () => {
    const original = globalThis.CompressionStream;
    globalThis.CompressionStream = undefined;
    try {
      const text = project(1_000);
      expect(await encodeProjectFile(text)).toBe(text);
    } finally {
      globalThis.CompressionStream = original;
    }
  });
});

describe('which encoding a save uses', () => {
  const manager = () => ({
    exportProject: () => ({ app: 'Rhizomium-Web', nodes: [] }),
    _encodeForFile: SaveLoadManager.prototype._encodeForFile,
    _fileMimeType: SaveLoadManager.prototype._fileMimeType,
  });

  it('compresses a .rz — the app opens it, nobody reads it', async () => {
    if (!canCompressProjects()) return;
    const content = await manager()._encodeForFile('patch.rz');

    expect(content).toBeInstanceOf(Uint8Array);
    expect(manager()._fileMimeType(content)).toBe('application/gzip');
  });

  it('leaves a .json readable, since that is what it is for', async () => {
    const content = await manager()._encodeForFile('patch.json');

    expect(typeof content).toBe('string');
    expect(content).toContain('\n  '); // still pretty-printed
    expect(manager()._fileMimeType(content)).toBe('application/json');
  });

  it('goes by the name the user chose, not the format asked for', async () => {
    if (!canCompressProjects()) return;
    // Picking "patch.json" in a Save-as dialog that offered .rz must still write JSON.
    expect(typeof await manager()._encodeForFile('patch.json')).toBe('string');
    expect(await manager()._encodeForFile('patch.rz')).toBeInstanceOf(Uint8Array);
  });
});

describe('opening a project file', () => {
  const manager = () => ({
    readFile: SaveLoadManager.prototype.readFile,
  });

  it('inflates a compressed one on the way in', async () => {
    const text = project(2_000);
    const file = new Blob([await encodeProjectFile(text)]);

    expect(JSON.parse(await manager().readFile(file)).app).toBe('Rhizomium-Web');
  });

  it('reports a file it cannot read instead of returning junk', async () => {
    const handled = vi.fn();
    vi.stubGlobal('window', { errorHandler: { handleError: handled } });
    const broken = { slice: () => { throw new Error('gone'); }, text: () => { throw new Error('gone'); } };

    await expect(manager().readFile(broken)).rejects.toThrow();
    expect(handled).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
