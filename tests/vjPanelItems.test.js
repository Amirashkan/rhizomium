/**
 * Working with the items in the VJ panel: scenes, presets and playlist rows can
 * be renamed, duplicated, removed and reordered (from a context menu or by
 * dragging), and a scene can be set to auto-override - follow the editor's
 * edits while it is the live scene.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// A stand-in for the vjScenes object store.
const db = vi.hoisted(() => ({ rows: new Map() }));
vi.mock('../src/core/rhizomiumDB.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runTransaction: async (_storeName, _mode, fn) => fn({
    put: (value) => { db.rows.set(value.id, value); },
    get: (id) => db.rows.get(id),
  }),
}));

const { VJControlPanel } = await import('../src/vj/VJControlPanel.js');
const { VJ_SCENE_IMPORT_SOURCE } = await import('../src/vj/TransitionManager.js');

/**
 * An editor whose project is a plain object: exportProject returns a copy of
 * it, importProject replaces it and records its source the way
 * SaveLoadManager does.
 */
function makeEditor() {
  const editor = {
    graph: { nodes: [] },
    project: { nodes: [{ id: '1', kind: 'ConstFloat', value: 0 }] },
    _lastDirtyTimestamp: 0,
    onChange: vi.fn(),
    edit(value) {
      this.project = { nodes: [{ id: '1', kind: 'ConstFloat', value }] };
      this._lastDirtyTimestamp++;
    },
  };
  editor.saveLoadManager = {
    isImporting: false,
    importCount: 0,
    lastImportSource: null,
    exportProject: vi.fn(() => JSON.parse(JSON.stringify(editor.project))),
    importProject: vi.fn(async (data, options = {}) => {
      editor.saveLoadManager.importCount++;
      editor.project = JSON.parse(JSON.stringify(data));
      editor._lastDirtyTimestamp++;
      editor.saveLoadManager.lastImportSource = options.source || null;
      return true;
    }),
  };
  return editor;
}

function addScene(panel, name, value = 0) {
  const id = `scene_${name}`;
  panel.sceneManager.addScene(id, { nodes: [{ id: '1', kind: 'ConstFloat', value }] }, name);
  return id;
}

const sceneNames = (panel) => panel.sceneManager.getAllScenes().map(s => s.name);
const sceneCards = (panel) => [...panel.scenesArea.querySelectorAll('.vj-scene-card')];
const menu = () => document.querySelector('.vj-context-menu');
const menuItem = (label) =>
  [...document.querySelectorAll('.vj-context-item')].find(b => b.textContent.endsWith(label));

function rightClick(el) {
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
}

/** Drag `source` and drop it on the far half of `target` (after it). */
function dragOnto(source, target, { after = true } = {}) {
  // jsdom lays nothing out: every rect is zero-sized at the origin, so a
  // positive coordinate is "after" and a negative one "before".
  const at = after ? 5 : -5;
  source.dispatchEvent(new MouseEvent('dragstart', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: at, clientY: at }));
  target.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: at, clientY: at }));
  source.dispatchEvent(new MouseEvent('dragend', { bubbles: true }));
}

function typeName(input, name, key = 'Enter') {
  input.value = name;
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('VJ panel items', () => {
  let panel;
  let editor;

  beforeEach(async () => {
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
    window.requestAnimationFrame = globalThis.requestAnimationFrame;
    window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    db.rows.clear();
    localStorage.clear();
    editor = makeEditor();
    panel = new VJControlPanel(editor);
    await panel.ready;
    panel.show();
    panel.transitionDurationInput.value = '0';
  });

  afterEach(() => {
    panel.hide();
    panel.sceneManager.getAllScenes().forEach(s => { s.autoOverride = false; });
    panel.updateAutoOverrideWatch();
    clearTimeout(panel._autoPersistTimer);
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  describe('scene context menu', () => {
    it('opens on right-click and closes on Escape or a click elsewhere', () => {
      addScene(panel, 'A');
      panel.refreshScenes();

      rightClick(sceneCards(panel)[0]);
      expect(menu()).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(menu()).toBeNull();

      rightClick(sceneCards(panel)[0]);
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(menu()).toBeNull();
    });

    it('leaves the browser menu alone on a scene note', () => {
      addScene(panel, 'A');
      panel.refreshScenes();
      rightClick(sceneCards(panel)[0].querySelector('.vj-scene-notes'));
      expect(menu()).toBeNull();
    });

    it('renames a scene in place', async () => {
      const a = addScene(panel, 'A');
      panel.refreshScenes();

      rightClick(sceneCards(panel)[0]);
      menuItem('Rename…').click();

      const input = panel.scenesArea.querySelector('.vj-rename-input');
      expect(input.value).toBe('A');
      typeName(input, 'Intro');

      expect(panel.sceneManager.getScene(a).name).toBe('Intro');
      expect(sceneCards(panel)[0].querySelector('.vj-scene-name').textContent).toBe('Intro');
      await panel.sceneManager._storageChain;
      expect(JSON.parse(db.rows.get('current').json).scenes[0].name).toBe('Intro');
    });

    it('keeps the old name when a rename is cancelled or left empty', () => {
      const a = addScene(panel, 'A');
      panel.refreshScenes();

      panel.renameScene(a);
      typeName(panel.scenesArea.querySelector('.vj-rename-input'), 'Nope', 'Escape');
      expect(panel.sceneManager.getScene(a).name).toBe('A');

      panel.renameScene(a);
      typeName(panel.scenesArea.querySelector('.vj-rename-input'), '   ');
      expect(panel.sceneManager.getScene(a).name).toBe('A');
      expect(sceneCards(panel)[0].querySelector('.vj-scene-name').textContent).toBe('A');
    });

    it('does not load the scene when its rename field is clicked', () => {
      const a = addScene(panel, 'A');
      panel.refreshScenes();
      const switchToScene = vi.spyOn(panel, 'switchToScene');

      panel.renameScene(a);
      panel.scenesArea.querySelector('.vj-rename-input').click();
      expect(switchToScene).not.toHaveBeenCalled();
    });

    it('duplicates a scene next to the original with its own copy of the data', () => {
      const a = addScene(panel, 'A', 1);
      addScene(panel, 'B');
      panel.sceneManager.updateSceneMetadata(a, { notes: 'opener' });
      panel.refreshScenes();

      rightClick(sceneCards(panel)[0]);
      menuItem('Duplicate').click();

      expect(sceneNames(panel)).toEqual(['A', 'A copy', 'B']);
      const copy = panel.sceneManager.getAllScenes()[1];
      expect(copy.id).not.toBe(a);
      expect(copy.notes).toBe('opener');
      expect(copy.data).toEqual(panel.sceneManager.getScene(a).data);

      copy.data.nodes[0].value = 99;
      expect(panel.sceneManager.getScene(a).data.nodes[0].value).toBe(1);
    });

    it('removes a scene after confirming', () => {
      addScene(panel, 'A');
      addScene(panel, 'B');
      panel.refreshScenes();

      rightClick(sceneCards(panel)[0]);
      menuItem('Remove').click();

      expect(window.confirm).toHaveBeenCalled();
      expect(sceneNames(panel)).toEqual(['B']);
    });

    it('moves a scene to the start or end of the list', () => {
      addScene(panel, 'A');
      addScene(panel, 'B');
      const c = addScene(panel, 'C');
      panel.refreshScenes();

      rightClick(sceneCards(panel)[2]);
      expect(menuItem('Move to end').disabled).toBe(true);
      menuItem('Move to start').click();
      expect(sceneNames(panel)).toEqual(['C', 'A', 'B']);

      panel.moveScene(c, 2);
      expect(sceneNames(panel)).toEqual(['A', 'B', 'C']);
    });

    it('opens the same menu from the card ⋯ button', () => {
      addScene(panel, 'A');
      panel.refreshScenes();
      [...sceneCards(panel)[0].querySelectorAll('button')].find(b => b.title === 'More actions').click();
      expect(menuItem('Duplicate')).toBeTruthy();
    });
  });

  describe('dragging to reorder', () => {
    it('reorders scenes, and Ctrl+number follows the new order', async () => {
      addScene(panel, 'A');
      addScene(panel, 'B');
      addScene(panel, 'C');
      panel.refreshScenes();

      let cards = sceneCards(panel);
      dragOnto(cards[0], cards[2]);
      expect(sceneNames(panel)).toEqual(['B', 'C', 'A']);

      cards = sceneCards(panel);
      dragOnto(cards[2], cards[0], { after: false });
      expect(sceneNames(panel)).toEqual(['A', 'B', 'C']);

      cards = sceneCards(panel);
      dragOnto(cards[2], cards[0]);
      expect(sceneNames(panel)).toEqual(['A', 'C', 'B']);

      await panel.sceneManager._storageChain;
      const stored = JSON.parse(db.rows.get('current').json);
      expect(stored.sceneOrder).toEqual(['scene_A', 'scene_C', 'scene_B']);
    });

    it('ignores a drop from another list', () => {
      addScene(panel, 'A');
      addScene(panel, 'B');
      panel.refreshScenes();
      panel.presetManager.capturePreset('P');
      panel.refreshPresets();

      const presetCard = panel.presetsArea.querySelector('.vj-preset-card');
      const cards = sceneCards(panel);
      presetCard.dispatchEvent(new MouseEvent('dragstart', { bubbles: true }));
      cards[1].dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 5 }));
      expect(sceneNames(panel)).toEqual(['A', 'B']);
    });

    it('does not start a drag from a scene note', () => {
      addScene(panel, 'A');
      panel.refreshScenes();
      const card = sceneCards(panel)[0];
      card.querySelector('.vj-scene-notes').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(card.draggable).toBe(false);
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(card.draggable).toBe(true);
    });

    it('reorders playlist rows and keeps the current row tracked', () => {
      const a = addScene(panel, 'A');
      const b = addScene(panel, 'B');
      const c = addScene(panel, 'C');
      [a, b, c].forEach(id => panel.addSceneToPlaylist(id));
      panel.playlistManager.currentIndex = 0;
      panel.switchTab('playlist');

      const rows = [...panel.playlistItems.querySelectorAll('.vj-playlist-item')];
      dragOnto(rows[0], rows[2]);

      expect(panel.playlistManager.playlist.map(i => i.sceneId)).toEqual([b, c, a]);
      expect(panel.playlistManager.currentIndex).toBe(2);
      const stored = JSON.parse(localStorage.getItem('rhizomium.vj.playlist'));
      expect(stored.playlist.map(i => i.sceneId)).toEqual([b, c, a]);
    });

    it('reorders presets', () => {
      panel.presetManager.capturePreset('P1');
      panel.presetManager.capturePreset('P2');
      panel.switchTab('presets');

      const cards = [...panel.presetsArea.querySelectorAll('.vj-preset-card')];
      dragOnto(cards[1], cards[0], { after: false });
      expect(panel.presetManager.getAllPresets().map(p => p.name)).toEqual(['P2', 'P1']);
    });
  });

  describe('preset and playlist menus', () => {
    it('renames, duplicates and deletes presets', () => {
      const p = panel.presetManager.capturePreset('P');
      panel.switchTab('presets');

      rightClick(panel.presetsArea.querySelector('.vj-preset-card'));
      menuItem('Rename…').click();
      typeName(panel.presetsArea.querySelector('.vj-rename-input'), 'Strobe');
      expect(panel.presetManager.presets.get(p.id).name).toBe('Strobe');

      panel.duplicatePreset(p.id);
      expect(panel.presetManager.getAllPresets().map(x => x.name)).toEqual(['Strobe', 'Strobe copy']);

      panel.deletePreset(p.id);
      expect(panel.presetManager.getAllPresets().map(x => x.name)).toEqual(['Strobe copy']);
      const stored = JSON.parse(localStorage.getItem('rhizomium.vj.presets'));
      expect(stored.presets.map(x => x.name)).toEqual(['Strobe copy']);
    });

    it('re-captures a preset from the current parameters', () => {
      editor.graph.nodes = [{ id: 'n1', kind: 'ConstFloat', params: { value: 1 } }];
      const p = panel.presetManager.capturePreset('P');
      editor.graph.nodes[0].params.value = 5;

      panel.updatePresetFromCurrent(p.id);
      expect(panel.presetManager.presets.get(p.id).parameterState.n1.params.value).toBe(5);
    });

    it('duplicates and removes playlist rows', () => {
      const a = addScene(panel, 'A');
      const b = addScene(panel, 'B');
      panel.addSceneToPlaylist(a);
      panel.addSceneToPlaylist(b);
      panel.playlistManager.updatePlaylistItem(0, { duration: 7 });
      panel.switchTab('playlist');

      rightClick(panel.playlistItems.querySelector('.vj-playlist-item'));
      menuItem('Duplicate').click();
      expect(panel.playlistManager.playlist.map(i => [i.sceneId, i.duration])).toEqual([[a, 7], [a, 7], [b, 10]]);

      panel.removePlaylistItem(0);
      expect(panel.playlistManager.playlist.map(i => i.sceneId)).toEqual([a, b]);
    });

    it('labels the playlist move buttons', () => {
      const a = addScene(panel, 'A');
      panel.addSceneToPlaylist(a);
      panel.switchTab('playlist');
      const row = panel.playlistItems.querySelector('.vj-playlist-item');
      const labels = [...row.querySelectorAll('.vj-playlist-actions button')].map(b => b.textContent);
      expect(labels).toEqual(['↑', '↓', '×']);
    });
  });

  describe('auto-override', () => {
    const autoBtn = (panel, i = 0) => sceneCards(panel)[i].querySelector('.vj-auto-override-btn');

    it('writes edits into the live scene', async () => {
      const a = addScene(panel, 'A', 1);
      await panel.switchToScene(a);
      autoBtn(panel).click();
      expect(autoBtn(panel).dataset.state).toBe('live');

      editor.edit(42);
      expect(panel.autoOverrideTick()).toBe(true);
      expect(panel.sceneManager.getScene(a).data.nodes[0].value).toBe(42);

      // Nothing new - nothing written.
      expect(panel.autoOverrideTick()).toBe(false);
    });

    it('persists what it wrote once edits settle', async () => {
      vi.useFakeTimers();
      try {
        const a = addScene(panel, 'A', 1);
        await panel.switchToScene(a);
        panel.setSceneAutoOverride(a, true);
        await panel.sceneManager._storageChain;

        editor.edit(7);
        panel.autoOverrideTick();
        await vi.advanceTimersByTimeAsync(2000);
        await panel.sceneManager._storageChain;

        const stored = JSON.parse(db.rows.get('current').json);
        expect(stored.scenes[0].data.nodes[0].value).toBe(7);
        expect(stored.scenes[0].autoOverride).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('runs on its own while a scene has it on, and stops when none do', async () => {
      vi.useFakeTimers();
      try {
        const a = addScene(panel, 'A', 1);
        await panel.switchToScene(a);
        panel.setSceneAutoOverride(a, true);
        expect(panel._autoOverrideTimer).not.toBeNull();

        editor.edit(3);
        await vi.advanceTimersByTimeAsync(1600);
        expect(panel.sceneManager.getScene(a).data.nodes[0].value).toBe(3);

        panel.setSceneAutoOverride(a, false);
        expect(panel._autoOverrideTimer).toBeNull();
        editor.edit(4);
        await vi.advanceTimersByTimeAsync(5000);
        expect(panel.sceneManager.getScene(a).data.nodes[0].value).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves a scene alone while another one is live', async () => {
      const a = addScene(panel, 'A', 1);
      const b = addScene(panel, 'B', 2);
      panel.setSceneAutoOverride(a, true);
      await panel.switchToScene(b);
      panel.refreshScenes();

      expect(autoBtn(panel, 0).dataset.state).toBe('armed');
      editor.edit(42);
      expect(panel.autoOverrideTick()).toBe(false);
      expect(panel.sceneManager.getScene(a).data.nodes[0].value).toBe(1);
      expect(panel.sceneManager.getScene(b).data.nodes[0].value).toBe(2);
    });

    it('does not write the next scene into the one being left', async () => {
      const a = addScene(panel, 'A', 1);
      const b = addScene(panel, 'B', 2);
      await panel.switchToScene(a);
      panel.setSceneAutoOverride(a, true);

      editor.edit(10);
      await panel.switchToScene(b);
      // A caught its last edit on the way out, and nothing of B's.
      expect(panel.sceneManager.getScene(a).data.nodes[0].value).toBe(10);

      editor.edit(11);
      panel.autoOverrideTick();
      expect(panel.sceneManager.getScene(a).data.nodes[0].value).toBe(10);
    });

    it('pauses when the editor loads a project that is not a VJ scene', async () => {
      const a = addScene(panel, 'A', 1);
      await panel.switchToScene(a);
      panel.setSceneAutoOverride(a, true);

      // File > Open, a backup restore...
      await editor.saveLoadManager.importProject({ nodes: [{ id: '9', kind: 'Other', value: 9 }] });
      expect(panel.autoOverrideTick()).toBe(false);
      expect(panel.sceneManager.getScene(a).data.nodes[0].value).toBe(1);
      expect(autoBtn(panel).dataset.state).toBe('paused');

      // Loading the scene again picks the link back up.
      await panel.switchToScene(a);
      expect(autoBtn(panel).dataset.state).toBe('live');
      editor.edit(5);
      expect(panel.autoOverrideTick()).toBe(true);
      expect(panel.sceneManager.getScene(a).data.nodes[0].value).toBe(5);
    });

    it('waits out a transition', async () => {
      const a = addScene(panel, 'A', 1);
      await panel.switchToScene(a);
      panel.setSceneAutoOverride(a, true);

      editor.edit(8);
      panel.transitionManager.isTransitioning = true;
      expect(panel.autoOverrideTick()).toBe(false);
      panel.transitionManager.isTransitioning = false;
      expect(panel.autoOverrideTick()).toBe(true);
    });

    it('tags scene loads so the editor knows where its project came from', async () => {
      const a = addScene(panel, 'A', 1);
      await panel.switchToScene(a);
      expect(editor.saveLoadManager.importProject).toHaveBeenLastCalledWith(
        expect.anything(),
        { source: VJ_SCENE_IMPORT_SOURCE }
      );
    });

    it('is offered as a checkable item in the scene menu', async () => {
      const a = addScene(panel, 'A', 1);
      panel.refreshScenes();
      rightClick(sceneCards(panel)[0]);
      const item = menuItem('Auto-override while live');
      expect(item.getAttribute('aria-checked')).toBe('false');
      item.click();
      expect(panel.sceneManager.getScene(a).autoOverride).toBe(true);
    });
  });
});
