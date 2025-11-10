/**
 * SceneManager.js
 *
 * Manages multiple scenes (projects) for VJ performance.
 * Handles scene loading, switching, and transitions.
 */

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
    try {
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
    } catch (error) {
      console.error('[SceneManager] Failed to load scene from file:', error);
      throw error;
    }
  }

  /**
   * Load scene from current editor state
   */
  captureCurrentScene(name) {
    const projectData = this.saveLoadManager.export();
    const sceneId = `scene_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const scene = this.addScene(sceneId, projectData, name || 'Captured Scene');
    return scene;
  }

  /**
   * Switch to a different scene
   * @param {string} sceneId - ID of scene to switch to
   * @param {boolean} immediate - If true, switch immediately without transition
   */
  async switchToScene(sceneId, immediate = false) {
    const scene = this.scenes.get(sceneId);
    if (!scene) {
      console.error(`[SceneManager] Scene not found: ${sceneId}`);
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
    } catch (error) {
      console.error('[SceneManager] Failed to load scene:', error);
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
      console.error('[SceneManager] Invalid scene order');
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
      console.error('[SceneManager] Invalid scenes data');
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
    } catch (error) {
      console.error('[SceneManager] Failed to import scenes:', error);
      return false;
    }
  }

  /**
   * Save scenes to localStorage
   */
  saveToLocalStorage() {
    try {
      const data = this.exportScenes();
      localStorage.setItem('rhizomium.vj.scenes', JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('[SceneManager] Failed to save scenes:', error);
      return false;
    }
  }

  /**
   * Load scenes from localStorage
   */
  loadFromLocalStorage() {
    try {
      const json = localStorage.getItem('rhizomium.vj.scenes');
      if (!json) return false;

      const data = JSON.parse(json);
      return this.importScenes(data);
    } catch (error) {
      console.error('[SceneManager] Failed to load scenes:', error);
      return false;
    }
  }
}
