/**
 * The VJ set - scenes, presets, playlist - lived only in browser storage, so a
 * saved project came back without the scenes and playlist built for it. It now
 * travels in the project file.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// A stand-in for the vjScenes object store.
const db = vi.hoisted(() => ({ rows: new Map() }));
vi.mock('../src/core/rhizomiumDB.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runTransaction: async (_storeName, _mode, fn) => fn({
    put: (value) => { db.rows.set(value.id, value); },
    get: (id) => db.rows.get(id),
    getAll: () => [],
    delete: () => {},
  }),
}));

const { VJControlPanel } = await import('../src/vj/VJControlPanel.js');
const { SaveLoadManager } = await import('../src/core/SaveLoadManager.js');

function makeEditor() {
  return {
    graph: { nodes: [] },
    onChange: vi.fn(),
    saveLoadManager: {
      exportProject: vi.fn(() => ({ nodes: [{ id: '1', kind: 'Circle', params: {} }] })),
      importProject: vi.fn(async () => true),
    },
  };
}

async function makePanel() {
  const panel = new VJControlPanel(makeEditor());
  await panel.ready;
  return panel;
}

function makeManager() {
  const manager = Object.create(SaveLoadManager.prototype);
  manager.graph = { nodes: [], connections: [] };
  manager.editor = {};
  manager.collectTextureData = () => ({});
  return manager;
}

describe('VJ set in the project file', () => {
  const panels = [];

  beforeEach(() => {
    db.rows.clear();
    localStorage.clear();
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    panels.splice(0).forEach(p => p.container.remove());
    delete window.vjControlPanel;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('round-trips scenes, presets and playlist through a project file', async () => {
    const source = await makePanel();
    panels.push(source);
    source.sceneManager.addScene('a', { nodes: [] }, 'Opener');
    source.sceneManager.addScene('b', { nodes: [] }, 'Drop');
    source.presetManager.capturePreset('Calm');
    source.playlistManager.addToPlaylist('b', 12);
    source.playlistManager.addToPlaylist('a', 8);

    window.vjControlPanel = source;
    const file = JSON.parse(JSON.stringify(makeManager().exportProject({ includeVJSet: true })));
    expect(file.vjSet).toBeTruthy();

    const target = await makePanel();
    panels.push(target);
    target.sceneManager.addScene('old', { nodes: [] }, 'Other project');
    window.vjControlPanel = target;
    await makeManager().importVJSet(file.vjSet);

    expect(target.sceneManager.getAllScenes().map(s => s.name)).toEqual(['Opener', 'Drop']);
    expect(target.presetManager.getAllPresets().map(p => p.name)).toEqual(['Calm']);
    expect(target.playlistManager.getPlaylist().map(i => i.sceneId)).toEqual(['b', 'a']);

    // Written through, so a reload shows the opened project's set.
    const reloaded = await makePanel();
    panels.push(reloaded);
    expect(reloaded.sceneManager.getAllScenes().map(s => s.name)).toEqual(['Opener', 'Drop']);
  });

  it('keeps the set out of every export but the project file', async () => {
    const panel = await makePanel();
    panels.push(panel);
    panel.sceneManager.addScene('a', { nodes: [] }, 'Opener');
    window.vjControlPanel = panel;

    // Scene captures, publishes, viewer links and autosave all use the default.
    expect(makeManager().exportProject()).not.toHaveProperty('vjSet');
  });

  it('leaves the set alone when a file saved before it travelled is opened', async () => {
    const panel = await makePanel();
    panels.push(panel);
    panel.sceneManager.addScene('a', { nodes: [] }, 'Opener');
    window.vjControlPanel = panel;

    await makeManager().importVJSet(undefined);

    expect(panel.sceneManager.getAllScenes().map(s => s.name)).toEqual(['Opener']);
  });

  it('does not swap the set when a scene is switched to', async () => {
    const manager = makeManager();
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
    manager.importVJSet = vi.fn(async () => {});
    vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0));

    const project = { nodes: [], connections: [], vjSet: { version: 1 } };
    await manager.importProject(project);
    expect(manager.importVJSet).not.toHaveBeenCalled();

    await manager.importProject(project, { restoreVJSet: true });
    expect(manager.importVJSet).toHaveBeenCalledWith({ version: 1 });

    vi.unstubAllGlobals();
  });

  it('keeps the set New Project replaces, and brings it back', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const panel = await makePanel();
    panels.push(panel);
    panel.sceneManager.addScene('a', { nodes: [] }, 'Opener');
    panel.presetManager.capturePreset('Calm');
    panel.playlistManager.addToPlaylist('a', 12);
    await panel.saveToStorage();

    await panel.startNewSet();
    expect(panel.isSetEmpty()).toBe(true);

    // Survives a reload: the kept copy is in IndexedDB, not only in memory.
    const reloaded = await makePanel();
    panels.push(reloaded);
    expect(await reloaded.restorePreviousSet()).toBe(true);
    expect(reloaded.sceneManager.getAllScenes().map(s => s.name)).toEqual(['Opener']);
    expect(reloaded.presetManager.getAllPresets().map(p => p.name)).toEqual(['Calm']);
    expect(reloaded.playlistManager.getPlaylist().map(i => i.sceneId)).toEqual(['a']);
  });

  it('swaps rather than loses when restoring twice', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const panel = await makePanel();
    panels.push(panel);
    panel.sceneManager.addScene('a', { nodes: [] }, 'First');
    await panel.importSet({ scenes: { version: 1, scenes: [{ id: 'b', name: 'Second' }], sceneOrder: ['b'] } });

    await panel.restorePreviousSet();
    expect(panel.sceneManager.getAllScenes().map(s => s.name)).toEqual(['First']);
    await panel.restorePreviousSet();
    expect(panel.sceneManager.getAllScenes().map(s => s.name)).toEqual(['Second']);
  });

  it('does not keep an empty set over a real one', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const panel = await makePanel();
    panels.push(panel);
    panel.sceneManager.addScene('a', { nodes: [] }, 'Opener');
    await panel.startNewSet();
    await panel.startNewSet();

    await panel.restorePreviousSet();
    expect(panel.sceneManager.getAllScenes().map(s => s.name)).toEqual(['Opener']);
  });

  it('reads a set from an exported, recovered or project file', () => {
    const set = { version: 1, scenes: { scenes: [] }, playlist: { playlist: [] } };
    expect(VJControlPanel.setFromFileData(set)).toBe(set);
    expect(VJControlPanel.setFromFileData({ nodes: [], vjSet: set })).toBe(set);
    // A plain project without a set is not one.
    expect(VJControlPanel.setFromFileData({ nodes: [], connections: [] })).toBe(null);
  });
});
