/**
 * VJ scenes did not survive a reload.
 *
 *   - they were written only by Save All, so capturing, importing, deleting or
 *     annotating a scene was lost unless the user also pressed it
 *   - they were written to one localStorage key, and every scene is a full
 *     project snapshot with its textures inlined, so a couple of scenes passed
 *     the ~5MB quota and every save after that failed silently
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// A stand-in for the vjScenes object store.
const db = vi.hoisted(() => ({ rows: new Map(), available: true }));
vi.mock('../src/core/rhizomiumDB.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runTransaction: async (_storeName, _mode, fn) => {
    if (!db.available) throw new Error('IndexedDB is not available in this browser');
    return fn({
      put: (value) => { db.rows.set(value.id, value); },
      get: (id) => db.rows.get(id),
    });
  },
}));

const { SceneManager } = await import('../src/vj/SceneManager.js');
const { VJControlPanel } = await import('../src/vj/VJControlPanel.js');

const LEGACY_KEY = 'rhizomium.vj.scenes';

// A texture-sized payload: far past what localStorage will hold.
const BIG_TEXTURE = 'data:image/png;base64,' + 'A'.repeat(6 * 1024 * 1024);

function makeEditor() {
  return {
    graph: { nodes: [] },
    onChange: vi.fn(),
    saveLoadManager: {
      exportProject: vi.fn(() => ({ nodes: [{ id: '1', kind: 'Texture', params: { src: BIG_TEXTURE } }] })),
      importProject: vi.fn(async () => true),
    },
  };
}

function quotaLimitedLocalStorage(limit = 5 * 1024 * 1024) {
  const original = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (String(value).length > limit) {
      const error = new Error(`Setting the value of '${key}' exceeded the quota.`);
      error.name = 'QuotaExceededError';
      throw error;
    }
    return original.call(this, key, value);
  });
}

describe('VJ scene persistence', () => {
  beforeEach(() => {
    db.rows.clear();
    db.available = true;
    localStorage.clear();
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
    window.requestAnimationFrame = globalThis.requestAnimationFrame;
    window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('stores scenes too large for localStorage', async () => {
    quotaLimitedLocalStorage();
    const manager = new SceneManager(null, makeEditor().saveLoadManager);
    manager.captureCurrentScene('Big');

    expect(await manager.save()).toBe(true);

    const reloaded = new SceneManager(null, makeEditor().saveLoadManager);
    expect(await reloaded.load()).toBe(true);
    expect(reloaded.getAllScenes().map(s => s.name)).toEqual(['Big']);
    expect(reloaded.getAllScenes()[0].data.nodes[0].params.src).toBe(BIG_TEXTURE);
  });

  it('migrates a set saved to localStorage by older builds', async () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({
      version: 1,
      scenes: [{ id: 'old', name: 'Old', data: { nodes: [] }, notes: '' }],
      sceneOrder: ['old'],
    }));

    const manager = new SceneManager(null, makeEditor().saveLoadManager);
    expect(await manager.load()).toBe(true);
    expect(manager.getScene('old').name).toBe('Old');

    // Once written to IndexedDB, the legacy copy goes so it can never be
    // restored over newer scenes.
    expect(await manager.save()).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(db.rows.has('current')).toBe(true);
  });

  it('falls back to localStorage where IndexedDB is missing', async () => {
    db.available = false;
    const manager = new SceneManager(null, { exportProject: () => ({ nodes: [] }) });
    manager.captureCurrentScene('Small');

    expect(await manager.save()).toBe(true);

    const reloaded = new SceneManager(null, null);
    expect(await reloaded.load()).toBe(true);
    expect(reloaded.getAllScenes().map(s => s.name)).toEqual(['Small']);
  });

  it('keeps a scene captured while the stored set is still loading', async () => {
    db.rows.set('current', {
      id: 'current',
      json: JSON.stringify({ version: 1, scenes: [{ id: 'a', name: 'A', data: { nodes: [] } }], sceneOrder: ['a'] }),
    });

    const manager = new SceneManager(null, makeEditor().saveLoadManager);
    const loading = manager.load();
    const early = manager.captureCurrentScene('Early');
    const saving = manager.save();

    await loading;
    expect(await saving).toBe(true);

    expect(manager.getAllScenes().map(s => s.id)).toEqual(['a', early.id]);
    const stored = JSON.parse(db.rows.get('current').json);
    expect(stored.sceneOrder).toEqual(['a', early.id]);
  });

  it('saves a captured scene without Save All', async () => {
    const panel = new VJControlPanel(makeEditor());
    await panel.ready;
    vi.spyOn(window, 'prompt').mockReturnValue('Opener');

    panel.captureCurrentScene();
    await panel.sceneManager.save();

    const reloaded = new VJControlPanel(makeEditor());
    await reloaded.ready;
    expect(reloaded.sceneManager.getAllScenes().map(s => s.name)).toEqual(['Opener']);

    panel.container.remove();
    reloaded.container.remove();
  });

  it('saves a removed scene without Save All', async () => {
    const panel = new VJControlPanel(makeEditor());
    await panel.ready;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    panel.sceneManager.addScene('a', { nodes: [] }, 'A');
    panel.sceneManager.addScene('b', { nodes: [] }, 'B');
    await panel.persistScenes();
    panel.show();
    panel.switchTab('scenes');

    const card = panel.scenesArea.querySelector('.vj-scene-card');
    card.querySelector('.vj-btn-danger').click();
    await panel.sceneManager.save();

    const reloaded = new VJControlPanel(makeEditor());
    await reloaded.ready;
    expect(reloaded.sceneManager.getAllScenes().map(s => s.id)).toEqual(['b']);

    panel.hide();
    panel.container.remove();
    reloaded.container.remove();
  });
});
