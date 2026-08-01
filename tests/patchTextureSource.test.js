import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';

/**
 * A patch's texture entries carry a `dataUrl`, but the name is a convention,
 * not a guarantee — the value comes from a `.rz` file that was downloaded from
 * the gallery and written by someone else. Assigning a remote URL to img.src
 * would fire an outbound request the moment the patch opens, reporting the
 * viewer's IP and referer to whoever authored it.
 */

// Exercise the methods against a stub `this`, avoiding the constructor's
// timers/IndexedDB/unload handlers (same approach as exportNodesSanitization).
function makeManager() {
  return {
    textureManager: { device: null, textures: new Map() },
    loadTextureFromDataUrl: SaveLoadManager.prototype.loadTextureFromDataUrl,
    restoreTextures: SaveLoadManager.prototype.restoreTextures,
  };
}

const REMOTE_SOURCES = [
  'https://attacker.example/beacon.png',
  'http://attacker.example/beacon.png',
  '//attacker.example/beacon.png',
  '/relative/path.png',
  'blob:https://attacker.example/abcd',
  'javascript:alert(1)',
  'DATA:text/html,<svg onload=alert(1)>',
];

describe('patch textures must be inline data: images', () => {
  let assignedSources;
  let originalSrc;

  beforeEach(() => {
    assignedSources = [];
    // Record every img.src assignment so a request attempt is visible even if
    // happy-dom never performs one.
    originalSrc = Object.getOwnPropertyDescriptor(globalThis.Image.prototype, 'src');
    Object.defineProperty(globalThis.Image.prototype, 'src', {
      configurable: true,
      set(value) { assignedSources.push(value); },
      get() { return assignedSources[assignedSources.length - 1]; },
    });
  });

  afterEach(() => {
    if (originalSrc) {
      Object.defineProperty(globalThis.Image.prototype, 'src', originalSrc);
    }
  });

  it.each(REMOTE_SOURCES)('refuses %s without touching img.src', async (source) => {
    const manager = makeManager();

    await expect(
      manager.loadTextureFromDataUrl('node_1', source, 'x.png'),
    ).rejects.toThrow(/inline data: image/i);

    expect(assignedSources).toEqual([]);
  });

  it('rejects non-string sources', async () => {
    const manager = makeManager();
    for (const bad of [null, undefined, 42, {}, ['data:image/png;base64,AAAA']]) {
      await expect(manager.loadTextureFromDataUrl('n', bad, 'x')).rejects.toThrow();
    }
    expect(assignedSources).toEqual([]);
  });

  it('still accepts a genuine inline data: image', async () => {
    const manager = makeManager();
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    // Reaching img.src is success here; resolution needs a real decode.
    manager.loadTextureFromDataUrl('node_1', dataUrl, 'x.png').catch(() => {});
    await Promise.resolve();

    expect(assignedSources).toEqual([dataUrl]);
  });

  it('a hostile texture does not stop the rest of the patch from loading', async () => {
    const manager = makeManager();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      manager.restoreTextures({
        node_1: { dataUrl: 'https://attacker.example/beacon.png', filename: 'a.png' },
        node_2: { dataUrl: 'https://attacker.example/other.png', filename: 'b.png' },
      }),
    ).resolves.toBeUndefined();

    expect(assignedSources).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
