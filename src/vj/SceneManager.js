/**
 * SceneManager.js
 *
 * Manages multiple scenes (projects) for VJ performance.
 * Handles scene loading, switching, and transitions.
 */

import { runTransaction, VJ_SCENES_STORE } from '../core/rhizomiumDB.js';

// Where scenes were kept before they moved to IndexedDB.
const LEGACY_STORAGE_KEY = 'rhizomium.vj.scenes';
const SCENES_RECORD_ID = 'current';

export class SceneManager {
  constructor(editor, saveLoadManager) {
    this.editor = editor;
    this.saveLoadManager = saveLoadManager;

    // Scene collection
    this.scenes = new Map(); // Map<sceneId, sceneData>
    this.activeSceneId = null;
    this.previousSceneId = null;

    // Scene metadata
    this.sceneOrder = []; // Array of sceneIds for ordering

    // Serializes load() and save() - see save().
    this._storageChain = Promise.resolve();

  }

  /**
   * Add a scene to the collection
   * @param {string} sceneId - Unique identifier for the scene
   * @param {Object} sceneData - Scene data (project JSON)
   * @param {string} name - Display name for the scene
   */
  addScene(sceneId, sceneData, name) {
    const scene = {
      id: sceneId,
      name: name || sceneId,
      data: sceneData,
      thumbnail: null,
      duration: sceneData.timeline?.duration || 10,
      // Free-text cue note - what this scene is for, when to fire it.
      notes: '',
      // While on and this scene is the active one, the panel keeps writing the
      // editor's latest state back into it - see VJControlPanel.autoOverrideTick.
      autoOverride: false,
      addedAt: Date.now(),
      lastUsed: null
    };

    this.scenes.set(sceneId, scene);
    if (!this.sceneOrder.includes(sceneId)) {
      this.sceneOrder.push(sceneId);
    }

    return scene;
  }

  /**
   * Replace a saved scene's project data with the editor's current state.
   * Keep its ID, name, notes, playlist references, and ordering intact.
   * Pass `exported` to use a project export the caller already has.
   */
  overrideSceneWithCurrentState(sceneId, exported = null) {
    const scene = this.scenes.get(sceneId);
    if (!scene || (!exported && !this.saveLoadManager?.exportProject)) return false;
    try {
      const projectData = exported || this.saveLoadManager.exportProject();
      if (!projectData || !Array.isArray(projectData.nodes)) return false;
      scene.data = projectData;
      scene.duration = projectData.timeline?.duration || scene.duration || 10;
      scene.updatedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Copy a scene - project data, notes and all - and slot the copy in right
   * after the original. Returns the new scene, or null if there is none.
   */
  duplicateScene(sceneId, name) {
    const source = this.scenes.get(sceneId);
    if (!source) return null;

    let data;
    try {
      data = typeof structuredClone === 'function'
        ? structuredClone(source.data)
        : JSON.parse(JSON.stringify(source.data));
    } catch {
      return null;
    }

    const newId = `scene_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const copy = this.addScene(newId, data, name || `${source.name} copy`);
    copy.duration = source.duration;
    copy.notes = source.notes || '';

    // addScene appended it; move it next to its original.
    this.sceneOrder = this.sceneOrder.filter(id => id !== newId);
    this.sceneOrder.splice(this.sceneOrder.indexOf(sceneId) + 1, 0, newId);
    return copy;
  }

  /**
   * Move a scene to a new position in the order. `toIndex` is where it ends
   * up, counted after it has been taken out.
   */
  moveScene(sceneId, toIndex) {
    const from = this.sceneOrder.indexOf(sceneId);
    if (from < 0) return false;
    const order = this.sceneOrder.filter(id => id !== sceneId);
    const to = Math.max(0, Math.min(order.length, toIndex));
    order.splice(to, 0, sceneId);
    this.sceneOrder = order;
    return from !== to;
  }

  /**
   * Remove a scene from the collection
   */
  removeScene(sceneId) {
    // Allow removing active scene - just clear the active ID
    if (sceneId === this.activeSceneId) {
      this.activeSceneId = null;
    }

    this.scenes.delete(sceneId);
    this.sceneOrder = this.sceneOrder.filter(id => id !== sceneId);
    return true;
  }

  /**
   * Load a scene from file
   */
  async loadSceneFromFile(file) {
    const text = await file.text();
    const projectData = JSON.parse(text);

    // Validate project data
    if (!projectData.nodes || !Array.isArray(projectData.nodes)) {
      throw new Error('Invalid project file: missing nodes array');
    }

    const sceneId = `scene_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const name = file.name.replace(/\.(json|rhizo)$/i, '');

    const scene = this.addScene(sceneId, projectData, name);
    return scene;
  }

  /**
   * Load scene from current editor state
   */
  captureCurrentScene(name) {
    const projectData = this.saveLoadManager.exportProject();
    const sceneId = `scene_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const scene = this.addScene(sceneId, projectData, name || 'Captured Scene');
    return scene;
  }

  /**
   * Switch to a different scene
   * @param {string} sceneId - ID of scene to switch to
   * @param {boolean} immediate - If true, switch immediately without transition
   */
  async switchToScene(sceneId, _immediate = false) {
    const scene = this.scenes.get(sceneId);
    if (!scene) {

      return false;
    }


    // Store previous scene
    this.previousSceneId = this.activeSceneId;
    this.activeSceneId = sceneId;
    scene.lastUsed = Date.now();

    // Load the scene into the editor
    try {
      await this.saveLoadManager.importProject(scene.data);
      return true;
    } catch {

      return false;
    }
  }

  /**
   * Get all scenes
   */
  getAllScenes() {
    return this.sceneOrder.map(id => this.scenes.get(id)).filter(Boolean);
  }

  /**
   * Get scene by ID
   */
  getScene(sceneId) {
    return this.scenes.get(sceneId);
  }

  /**
   * Reorder scenes
   */
  reorderScenes(newOrder) {
    // Validate that all IDs exist
    const valid = newOrder.every(id => this.scenes.has(id));
    if (!valid) {

      return false;
    }

    this.sceneOrder = [...newOrder];
    return true;
  }

  /**
   * Update scene metadata
   */
  updateSceneMetadata(sceneId, metadata) {
    const scene = this.scenes.get(sceneId);
    if (!scene) return false;

    if (metadata.name !== undefined) scene.name = metadata.name;
    if (metadata.duration !== undefined) scene.duration = metadata.duration;
    if (metadata.notes !== undefined) scene.notes = String(metadata.notes);
    if (metadata.autoOverride !== undefined) scene.autoOverride = !!metadata.autoOverride;

    return true;
  }

  /**
   * Export scenes collection
   */
  exportScenes() {
    const scenesArray = this.getAllScenes();
    return {
      version: 1,
      scenes: scenesArray,
      sceneOrder: this.sceneOrder,
      activeSceneId: this.activeSceneId
    };
  }

  /**
   * Import scenes collection
   */
  importScenes(data) {
    if (!data || !data.scenes) {

      return false;
    }

    try {
      // Clear existing scenes
      this.scenes.clear();
      this.sceneOrder = [];

      // Import scenes
      data.scenes.forEach(scene => {
        this.scenes.set(scene.id, scene);
        this.sceneOrder.push(scene.id);
      });

      if (data.sceneOrder) {
        this.sceneOrder = data.sceneOrder;
      }

      return true;
    } catch {

      return false;
    }
  }

  /**
   * Persist the scene set. Resolves true once it is stored.
   *
   * Scenes used to live in one localStorage key, but every scene is a full
   * project snapshot with its textures inlined, so a couple of them passed the
   * ~5MB quota and every save after that failed silently. They now go to
   * IndexedDB; localStorage is only the fallback where IndexedDB is missing.
   *
   * Writes are chained behind load() and each other, and serialize the set at
   * write time, so an early or slow save can never land over newer scenes.
   */
  save() {
    const write = async () => {
      let json;
      try {
        json = JSON.stringify(this.exportScenes());
      } catch {
        return false;
      }
      try {
        await runTransaction(VJ_SCENES_STORE, 'readwrite', (store) =>
          store.put({ id: SCENES_RECORD_ID, json })
        );
        // The set is safe in IndexedDB; drop the legacy copy so it cannot be
        // restored over newer scenes, and so it stops eating the quota.
        try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch { /* blocked */ }
        return true;
      } catch {
        try {
          localStorage.setItem(LEGACY_STORAGE_KEY, json);
          return true;
        } catch {
          return false;
        }
      }
    };
    this._storageChain = this._storageChain.then(write, write);
    return this._storageChain;
  }

  /**
   * Restore the scene set saved by save(), falling back to - and so migrating -
   * a set left in localStorage by older builds. Scenes already in memory (one
   * captured while the read was in flight) are kept after the stored ones.
   */
  load() {
    const read = async () => {
      let json = null;
      try {
        const record = await runTransaction(VJ_SCENES_STORE, 'readonly', (store) =>
          store.get(SCENES_RECORD_ID)
        );
        if (typeof record?.json === 'string') json = record.json;
      } catch {
        // No IndexedDB here; the localStorage copy is all there is.
      }
      if (json === null) {
        try {
          json = localStorage.getItem(LEGACY_STORAGE_KEY);
        } catch {
          return false;
        }
      }
      if (!json) return false;

      let data;
      try {
        data = JSON.parse(json);
      } catch {
        return false;
      }
      const pending = this.getAllScenes();
      if (!this.importScenes(data)) return false;
      for (const scene of pending) {
        if (this.scenes.has(scene.id)) continue;
        this.scenes.set(scene.id, scene);
        this.sceneOrder.push(scene.id);
      }
      return true;
    };
    const loading = this._storageChain.then(read, read);
    this._storageChain = loading.then(() => undefined, () => undefined);
    return loading;
  }
}
