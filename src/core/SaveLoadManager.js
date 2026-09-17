import { MessagePriority } from './AsyncQueueManager.js';
import { serializeProjectFormat, applyProjectFormat } from '../ui/OutputFormat.js';
import { BackupStore } from './BackupStore.js';
import { createAutosaveStore, parseAutosaveEntry } from './AutosaveStore.js';
import { migrateProjectData, SAVE_FORMAT_VERSION } from './projectMigrations.js';
import { modalManager } from '../ui/ModalManager.js';
import { hydrateNodes, hydrateConnections } from './graphHydration.js';
import { dataUrlToBlob } from './dataUrl.js';
import { restorePatchTextures, restoreImageTexture, restoreVideoTexture } from './patchTextures.js';
import { encodeProjectFile, decodeProjectFile } from './projectFile.js';
import { getAnnotationStore } from './AnnotationStore.js';
import { isTauri } from '../utils/isTauri.js';

// Re-exported: this module was the decoder's home before the web viewer
// needed it without the rest of the save/load stack.
export { dataUrlToBlob };

/**
 * Editor-only side effects of a restored texture. An open second-monitor viewer
 * keeps its own texture copies, so a project load has to be re-broadcast there
 * (the same hook FileInputHandler uses for a fresh upload).
 *
 * A module constant rather than a method: the texture methods are exercised
 * against a stub `this` in the tests, and a helper on the prototype would make
 * them depend on the rest of the class again.
 */
const TEXTURE_HOOKS = {
  onTextureChanged: (nodeId) => window.secondMonitorViewer?.onTextureChanged?.(nodeId),
};

export class SaveLoadManager {
  constructor(editor, graph, updateCallback) {
    this.editor = editor;
    this.textureManager = null;
    this.graph = graph;
    this.updateCallback = updateCallback || (() => {});
    this.autosaveKey = "rhizomium.autosave.v2";
    this.backupsKey = "rhizomium.backups.v2";
    this.projectsKey = "rhizomium.projects.v2";

    // Auto-save settings. autosaveEnabled is owned by Preferences -> Saving;
    // PreferencesWindow.applyAll() calls setAutosaveEnabled() at startup, well
    // before the first tick could fire.
    this.autosaveInterval = 30000; // 30 seconds
    this.autosaveEnabled = true;
    this._autosaveTimer = null;
    this._autosaveScheduled = false;
    // Backups keep a history; the autosave snapshot is what a crash restores
    // from. Ten of them a session beats ten of them every five minutes.
    this.autoBackupInterval = 10 * 60 * 1000; // 10 minutes
    this._lastAutoBackupAt = 0;
    this.maxBackups = 10;
    this.hasUnsavedChanges = false;
    // hasUnsavedChanges is cleared by the autosave snapshot too, so it answers
    // "is anything unpersisted right now", not "has this been saved to the
    // artist's file". Only the second one is worth stopping a close over -
    // an autosaved patch the artist never saved still lives nowhere they can
    // find it - so the file-level dirty bit is tracked on its own.
    this.hasUnsavedFileChanges = false;
    this.isImporting = false;
    this._lastAutosaveHash = null;
    this._lastBackupHash = null;

    // The file the project is currently bound to. When the browser supports
    // the File System Access API we keep a live handle so "Save" writes back
    // in place instead of spilling a new timestamped download every time.
    // currentProjectName drives the suggested file name and the window title.
    this.currentFileHandle = null;
    this.currentProjectName = null;

    // Full texture dataUrls don't fit in the ~5MB localStorage quota once a
    // project grows, so backups live in IndexedDB and the autosave snapshot
    // goes to a file on the desktop (IndexedDB in the browser)
    this.backupStore = new BackupStore();
    this.autosaveStore = createAutosaveStore();
    this._migrateLegacyBackups();

    // Worker support
    this.queueManager = null;
    this.useWorker = false;
    this.pendingSerializations = new Map();

    this.setupAutoSave();
    this.setupUnloadHandler();
    // Initialize worker support (deferred, non-blocking)
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        this._initWorkerSupport();
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
        this._initWorkerSupport();
      }, 2000);
    }
  }
  
  /**
   * Initialize worker support
   */
  _initWorkerSupport() {
    if (window.threadSeparationManager) {
      const manager = window.threadSeparationManager;
      if (manager.isWorkerAvailable('saveLoad')) {
        this.queueManager = manager.getQueueManager();
        this.useWorker = true;
        
        // Set up response handler
        const worker = manager.getWorker('saveLoad');
        const originalOnMessage = worker.onmessage;
        worker.onmessage = (e) => {
          if (e.data.type === 'result' && e.data.id) {
            this._handleWorkerResult(e.data);
          }
          // Call original handler for other messages
          if (originalOnMessage) {
            originalOnMessage.call(worker, e);
          }
        };
      }
    }
  }
  
  /**
   * Handle worker result
   */
  _handleWorkerResult(data) {
    if (this.pendingSerializations.has(data.id)) {
      const { resolve, reject } = this.pendingSerializations.get(data.id);
      this.pendingSerializations.delete(data.id);
      
      if (data.error) {
        reject(new Error(data.error));
      } else {
        // Worker returns serialized string directly
        resolve(data.result);
      }
    }
  }

  /**
   * One-time migration of backups from the old localStorage key to IndexedDB.
   */
  async _migrateLegacyBackups() {
    try {
      const stored = localStorage.getItem(this.backupsKey);
      if (!stored) return;

      const backups = JSON.parse(stored);
      if (Array.isArray(backups)) {
        for (const backup of backups) {
          if (backup && backup.id) {
            await this.backupStore.add(backup);
          }
        }
      }
      localStorage.removeItem(this.backupsKey);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'backup-legacy-migration'
      });
    }
  }

  /**
   * Mark the project as having unsaved changes. Called from the shader
   * update path in main.js, which every graph edit flows through.
   */
  markUnsaved() {
    if (this.isImporting) return;
    const wasClean = !this.hasUnsavedFileChanges;
    this.hasUnsavedChanges = true;
    this.hasUnsavedFileChanges = true;
    if (wasClean) this._updateDocumentTitle();
  }

  /**
   * Mark the project as saved where the artist can find it again: a write to
   * their file, or a load that binds the editor to one. The autosave snapshot
   * deliberately does not come through here - it clears hasUnsavedChanges on
   * its own and leaves the file dirty.
   */
  markSaved() {
    this.hasUnsavedChanges = false;
    this.hasUnsavedFileChanges = false;
    this._updateDocumentTitle();
  }

  /**
   * Whether closing now would drop edits made since the last save to a file.
   * An empty canvas is never worth a warning - there is nothing to lose.
   */
  hasUnsavedWork() {
    return !!this.hasUnsavedFileChanges && !!this.graph?.nodes?.length;
  }

  /**
   * Cheap content hash (djb2) of a project export, ignoring volatile fields,
   * used to skip redundant autosaves/backups.
   *
   * Inlined media is summarized rather than hashed: a patch with a video in it
   * carries megabytes of base64, and stringifying that and walking it a
   * character at a time cost ~30ms per call - three calls a tick, which is a
   * visible hitch mid-performance. Length plus both ends distinguishes any
   * texture an artist could actually swap in, and the payload still reaches
   * the snapshot itself untouched.
   */
  _computeProjectHash(projectData) {
    try {
      const { savedAt, metadata, ...stable } = projectData;
      const str = JSON.stringify(stable, (_key, value) =>
        typeof value === "string" && value.length > 1024
          ? `${value.length}:${value.slice(0, 64)}:${value.slice(-64)}`
          : value,
      );
      let hash = 5381;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
      }
      return `${hash}:${str.length}`;
    } catch {
      return null;
    }
  }
/**
 * Restore a saved project's textures onto the GPU.
 *
 * The work itself lives in patchTextures.js, shared with the read-only web
 * viewer, so both restore a patch's media by the same rules — inline data:
 * URLs only, one bad texture never costing the rest of the patch.
 */
async restoreTextures(textureData) {
  await restorePatchTextures(this.textureManager, textureData, TEXTURE_HOOKS);
}

async loadVideoFromDataUrl(nodeId, dataUrl, filename) {
  return restoreVideoTexture(this.textureManager, nodeId, dataUrl, filename, TEXTURE_HOOKS);
}

async loadTextureFromDataUrl(nodeId, dataUrl, filename) {
  return restoreImageTexture(this.textureManager, nodeId, dataUrl, filename, TEXTURE_HOOKS);
}

  // =============================================================================
  // CORE SAVE/LOAD FUNCTIONALITY
  // =============================================================================
  setTextureManager(textureManager) {
    this.textureManager = textureManager;
  }

// Replace your exportProject() method with this fixed version

exportProject(options = {}) {
  try {
    const {
      includeMetadata = true,
      includePreviews = false,
      includeViewport = true,
    } = options;

    // Collect texture data BEFORE creating projectData
    const textureData = this.collectTextureData();

    const projectData = {
      app: "Rhizomium-Web",
      version: SAVE_FORMAT_VERSION,
      format: "rhizomium-project",
      savedAt: new Date().toISOString(),

      // Output format: the authored composition size + sim quality. These are
      // part of the artwork (resolution-dependent sims render differently at a
      // different size), so they travel with the project rather than the machine.
      outputFormat: serializeProjectFormat(),

      // Core graph data
      nodes: this.exportNodes(),
      connections: this.exportConnections(),
      textures: textureData, // Now textureData is defined

      // Timeline data
      timeline: this.exportTimeline(),

      // MIDI bindings
      midiBindings: this.exportMIDIBindings(),

      // OSC bindings
      oscBindings: this.exportOSCBindings(),

      // Projection mapping: the surfaces the output is corner-pinned onto.
      // Part of the artwork's staging, so it travels with the project.
      projectionMapping: this.exportProjectionMapping(),

      // Output screens: which displays this patch is thrown onto and what each
      // one shows. A studio rig is set up once against a physical room and
      // reopened every show night, so it belongs in the file next to the mapping
      // rather than being rebuilt from the menu each time.
      outputScreens: this.exportOutputScreens(),

      // Viewer controls: the parameters this patch offers to whoever opens it
      // in the web viewer. Part of the published work — the piece is the range,
      // not just the frame — so it travels with the document.
      viewerControls: this.exportViewerControls(),

      // The viewer page itself: the ground behind the render, how it is fitted,
      // what apparatus shows. The room the piece hangs in, which is the artist's
      // decision and not the machine's, so it travels with the document too.
      viewerPage: this.exportViewerPage(),

      // Editor state
      ...(includeViewport && {
        viewport: this.exportViewport(),
        viewport3D: this.exportViewport3D(),
      }),

      // Metadata
      ...(includeMetadata && {
        metadata: this.exportMetadata(),
      }),

      // Preview data (optional, can be large)
      ...(includePreviews && {
        previews: this.exportPreviews(),
      }),
    };

    return projectData;
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'project-export',
      options
    });
    throw new Error(`Failed to export project: ${error.message}`);
  }
}

/**
 * Serialize project to JSON string (async, can use worker for large projects)
 */
async serializeProject(options = {}) {
  try {
    const projectData = this.exportProject(options);
    
    // Use worker for serialization if available (for large projects)
    if (this.useWorker && this.queueManager && projectData.nodes.length > 100) {
      const requestId = `serialize_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      return new Promise((resolve, reject) => {
        this.pendingSerializations.set(requestId, { resolve, reject });
        
        this.queueManager.enqueue(
          'saveLoad',
          {
            id: requestId,
            type: 'serialize',
            graph: {
              nodes: projectData.nodes,
              connections: projectData.connections,
              metadata: projectData.metadata || {}
            }
          },
          MessagePriority.NORMAL
        );
        
        // Fallback timeout
        setTimeout(() => {
          if (this.pendingSerializations.has(requestId)) {
            this.pendingSerializations.delete(requestId);
            // Fallback to main thread serialization
            resolve(JSON.stringify(projectData, null, 2));
          }
        }, 5000);
      });
    }
    
    // Main thread serialization (synchronous)
    return JSON.stringify(projectData, null, 2);
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'project-serialization',
      options
    });
    throw new Error(`Failed to serialize project: ${error.message}`);
  }
}

// Add this helper method
collectTextureData() {
  const textureData = {};

  if (!this.textureManager) return textureData;

  for (const node of this.graph.nodes) {
    if (node.kind === 'Texture2D' || node.kind === 'TextureCube') {
      const textureInfo = this.textureManager.getTexture(node.id);
      if (textureInfo) {
        textureData[node.id] = {
          filename: textureInfo.filename,
          dataUrl: textureInfo.dataUrl,
          width: textureInfo.width,
          height: textureInfo.height,
          isVideo: !!textureInfo.isVideo,
        };
      }
    }
  }

  return textureData;
}

/**
 * Export timeline data
 */
exportTimeline() {
  if (window.timelineManager) {
    return window.timelineManager.toJSON();
  }
  return null;
}

/**
 * Export MIDI bindings
 */
exportMIDIBindings() {
  if (window.midiBinding) {
    return window.midiBinding.serialize();
  }
  return null;
}

/**
 * Export OSC bindings
 */
exportOSCBindings() {
  if (window.oscBinding) {
    return window.oscBinding.serialize();
  }
  return null;
}

/**
 * Export the projection-mapping surfaces
 */
exportProjectionMapping() {
  if (window.mappingModel) {
    return window.mappingModel.serialize();
  }
  return null;
}

/**
 * Export the output screens — the rig this patch is thrown onto.
 */
exportOutputScreens() {
  if (window.screenModel) {
    return window.screenModel.serialize();
  }
  return null;
}

/**
 * Export the viewer controls — the parameters this patch hands to a visitor.
 *
 * Controls pointing at nodes that are no longer in the graph are left out of
 * the file rather than written and skipped on the way back in. The model itself
 * is not touched: a node deleted by accident is one Ctrl+Z away, and saving in
 * between must not be what makes its control unrecoverable.
 */
exportViewerControls() {
  if (!window.viewerControlsModel) return null;
  return window.viewerControlsModel.serialize(this.graph?.nodes || []);
}

/**
 * Export the viewer page settings.
 *
 * Null when the artist has changed nothing, so a patch that takes the page as
 * it comes carries no `viewerPage` key at all and reads identically to one
 * saved before the setting existed.
 */
exportViewerPage() {
  if (!window.viewerPageModel) return null;
  return window.viewerPageModel.serialize();
}


async importProject(projectData, options = {}) {
  try {
    this.isImporting = true;

    const {
      clearExisting = true,
      validateData = true,
      restoreViewport = true,
      restorePreviews = false,
    } = options;

    // Migrate older save formats to the current one (throws a clear error
    // for files saved by a newer editor version)
    projectData = migrateProjectData(projectData);

    // Validate project data
    if (validateData) {
      this.validateProjectData(projectData);
    }

    // Clear existing graph if requested
    if (clearExisting) {
      this.clearGraph();
    }

    // Import core data
    this.importNodes(projectData.nodes || []);
    this.importConnections(projectData.connections || []);

    // Update node ID counter to avoid conflicts with existing nodes
    if (typeof window.updateNodeIdCounter === 'function') {
      window.updateNodeIdCounter(this.graph.nodes);
    }

    // CRITICAL: Restore textures BEFORE any shader compilation
    if (projectData.textures && this.textureManager) {
      await this.restoreTextures(projectData.textures);

      // Force GPU texture creation for all restored textures
      if (this.textureManager && this.textureManager.device) {
        for (const [, texInfo] of this.textureManager.textures.entries()) {
          if (texInfo.bitmap && !texInfo.gpuTexture) {
            try {
              // Create the GPU texture from the bitmap
              const gpuTexture = this.textureManager.device.createTexture({
                size: [texInfo.width, texInfo.height, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
              });

              // Copy bitmap data to GPU texture
              this.textureManager.device.queue.copyExternalImageToTexture(
                { source: texInfo.bitmap },
                { texture: gpuTexture },
                [texInfo.width, texInfo.height]
              );

              // Store the GPU texture
              texInfo.gpuTexture = gpuTexture;
            } catch {

            }
          }
        }
      }
    }

    // Restore the authored output format before the shader rebuild below, so
    // the first render already uses the project's own size. Older projects have
    // no such field and keep the current setting.
    applyProjectFormat(projectData.outputFormat);

    // Restore viewport
    if (restoreViewport && projectData.viewport) {
      this.importViewport(projectData.viewport);
    }

    // Restore timeline
    if (projectData.timeline) {
      this.importTimeline(projectData.timeline);
    }

    // Restore MIDI bindings
    if (projectData.midiBindings) {
      this.importMIDIBindings(projectData.midiBindings);
    }

    // Restore OSC bindings
    if (projectData.oscBindings) {
      this.importOSCBindings(projectData.oscBindings);
    }

    // Restore projection mapping
    if (projectData.projectionMapping) {
      this.importProjectionMapping(projectData.projectionMapping);
    }

    // Restore the output screens
    if (projectData.outputScreens) {
      this.importOutputScreens(projectData.outputScreens);
    }

    // Restore the viewer controls and the page they appear on. Unconditional
    // for the same reason: opening a second patch must clear the first one's.
    this.importViewerControls(projectData.viewerControls);
    this.importViewerPage(projectData.viewerPage);

    // Restore previews if requested
    if (restorePreviews && projectData.previews) {
      this.importPreviews(projectData.previews);
    }

    // CRITICAL: Enhanced shader rebuild sequence after loading
    // Step 1: Wait a frame to ensure DOM is stable
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Step 2: Force WebGPU reinitialization and capture the device
    let gpuDevice = await this.reinitializeWebGPU();

    // Step 3: Wait another frame after WebGPU init
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Step 4: Multiple shader update attempts with different methods
    await this.forceShaderUpdate();

    // Step 5: Wait for GPU pipeline to stabilize
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Warm up GPU/canvas after loading project to prevent lag on first interaction
    if (window.eventHandler && typeof window.eventHandler._checkAndWarmupAfterInactivity === 'function') {
      window.eventHandler._checkAndWarmupAfterInactivity();
      // Mark interaction start for immediate updates after load
      window.eventHandler._interactionStartTime = Date.now();
      window.eventHandler._justWarmedUp = true;
      // Keep immediate updates active for 2 seconds after load (longer for large projects)
      setTimeout(() => {
        if (window.eventHandler) {
          window.eventHandler._justWarmedUp = false;
        }
      }, 2000);
    }

    // Step 6: Force editor redraw
    if (this.editor && this.editor.draw) {
      if (this.editor.markDirty) this.editor.markDirty('file-load-step6');
      this.editor.draw();
    }

    // Step 7: Enhanced GPU stability and preview fix
    // Try multiple ways to get the GPU device
    if (window.textureManager && window.textureManager.device) {
      gpuDevice = window.textureManager.device;
    } else if (window.gpuDevice) {
      gpuDevice = window.gpuDevice;
    } else if (window.device) {
      gpuDevice = window.device;
    }

    if (gpuDevice && this.editor && this.editor.previewSystem) {
      // Reconnect GPU device to preview components
      if (this.editor.previewSystem.canvasManager) {
        this.editor.previewSystem.canvasManager.device = gpuDevice;
      }

      if (this.editor.previewSystem.rendererRegistry) {
        this.editor.previewSystem.rendererRegistry.device = gpuDevice;
      }
      
      // Force reinitialize preview system with new device
      if (typeof this.editor.previewSystem.reinitialize === 'function') {
        await this.editor.previewSystem.reinitialize(gpuDevice);
      }
      
      // Clear cache and force preview updates
      if (this.editor.previewSystem.canvasManager && this.editor.previewSystem.canvasManager.clearCache) {
        this.editor.previewSystem.canvasManager.clearCache();
      }

      // Force preview regeneration with working GPU connection
      // CRITICAL: Pass nodes array so topological sort can ensure proper render order
      if (typeof this.editor.previewSystem.updateAllPreviews === 'function' && this.graph && this.graph.nodes) {
        await this.editor.previewSystem.updateAllPreviews(this.graph.nodes);
      }
    }

    // Force several renders to stabilize GPU
    for (let i = 0; i < 3; i++) {
      if (typeof window.render === "function") {
        await window.render();
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Force shader update
    if (typeof window.updateShaderFromGraph === "function") {
      await window.updateShaderFromGraph();
    }

    // Force preview updates
    if (this.editor && this.editor.draw) {
      if (this.editor.markDirty) this.editor.markDirty('file-load-preview');
      this.editor.draw();
    }

    // Update preview integrations
    if (this.editor && this.editor.previewSystem) {
      if (typeof this.editor.previewSystem.refreshAll === "function") {
        await this.editor.previewSystem.refreshAll();
      }
    }

    // Final delay and redraw
    await new Promise(resolve => setTimeout(resolve, 200));
    if (this.editor && this.editor.draw) {
      if (this.editor.markDirty) this.editor.markDirty('file-load-final');
      this.editor.draw();
    }

    // Thumbnails for the loaded graph, once the shader rebuild above has settled. They go through
    // the ONE preview funnel (PreviewSystem.generateNodePreview), the same one every other path
    // uses: it renders compute and visual nodes on the GPU and falls back to the CPU approximation
    // only when that genuinely fails, and it honours the per-node eye toggle.
    //
    // This used to paint a thumbnail for every node itself, calling the CPU renderer registry
    // directly and assigning node.__thumb - so a loaded project showed the registry's stand-in
    // cards ("REMAP", "GRAY", "INV", "fx", ...) over nodes whose real rendered output the GPU had
    // already produced, or was about to. The hand-painted write landed last and nothing re-rendered
    // those nodes afterwards, so the placeholder text stayed on screen until the artist touched a
    // parameter. Nothing in the load path writes __thumb by hand any more - including OutputFinal,
    // whose thumbnail the fragment path builds from the node feeding it, at the composition's
    // aspect ratio rather than as a squashed square copy of the output canvas.
    await new Promise(resolve => setTimeout(resolve, 300));

    if (this.editor?.previewSystem?.updateAllPreviews && this.graph?.nodes) {
      this.editor.previewSystem.updateAllPreviews(this.graph.nodes);
    }

    // Final editor redraw
    await new Promise(resolve => setTimeout(resolve, 200));
    if (this.editor && this.editor.draw) {
      if (this.editor.markDirty) this.editor.markDirty('file-load-complete');
      this.editor.draw();
    }

    this.markSaved();
    this.updateStatus("Project loaded successfully");

    // Restore the 3D viewport last: the graph rebuild above creates/auto-shows
    // field mappers, so applying the saved camera/window/visibility here lets
    // the user's saved 3D view win over the auto-show default.
    if (restoreViewport && projectData.viewport3D) {
      this.importViewport3D(projectData.viewport3D);
    }

    return true;

  } catch (error) {
    window.errorHandler?.handleError(error, {
      component: 'project-import',
      options,
      nodeCount: projectData?.nodes?.length || 0
    });
    this.updateStatus(`Import failed: ${error.message}`, "error");
    throw new Error(`Failed to import project: ${error.message}`);
  } finally {
    this.isImporting = false;
  }
}

  // =============================================================================
  // ENHANCED WEBGPU AND SHADER UPDATE METHODS
  // =============================================================================

async reinitializeWebGPU() {
  try {
    // Clean up any duplicate canvases
    const allCanvases = document.querySelectorAll("#gpu-canvas");

    if (allCanvases.length > 1) {
      for (let i = 1; i < allCanvases.length; i++) {
        allCanvases[i].remove();
      }
    }

    // Get the remaining canvas
    const canvas = document.getElementById("gpu-canvas");
    if (!canvas) {

      return null;
    }

    // Force WebGPU reinitialization if the function exists
    if (typeof window.initWebGPU === "function") {
      const device = await window.initWebGPU(canvas, true);
      if (device) {
        // Store device in multiple locations for reliability
        window.gpuDevice = device;
        if (window.textureManager) {
          window.textureManager.device = device;
        }

        return device;
      }
    }

    return null;
  } catch (error) {

    window.errorHandler?.handleError(error, { 
      component: 'webgpu-reinitialization',
      context: 'after-file-load'
    });
    return null;
  }
}

  async forceShaderUpdate() {
    const updateMethods = [
      // Method 1: Primary update callback
      async () => {
        if (this.updateCallback) {
          await this.updateCallback();
          return true;
        }
        return false;
      },

      // Method 2: Global updateShaderFromGraph function
      async () => {
        if (typeof window.updateShaderFromGraph === "function") {
          await window.updateShaderFromGraph();
          return true;
        }
        return false;
      },

      // Method 3: Global rebuild function
      async () => {
        if (typeof window.rebuild === "function") {
          await window.rebuild();
          return true;
        }
        return false;
      },

      // Method 4: Manual WGSL build and update
      async () => {
        if (typeof window.buildWGSL === "function" && typeof window.updateShader === "function") {
          try {
            const wgsl = window.buildWGSL(this.graph);
            await window.updateShader(wgsl);
            return true;
          } catch {

            return false;
          }
        }
        return false;
      },

      // Method 5: Direct shader compilation if available
      async () => {
        if (typeof window.compileShader === "function") {
          try {
            await window.compileShader(this.graph);
            return true;
          } catch {

            return false;
          }
        }
        return false;
      }
    ];

    // Try each method in sequence
    let success = false;
    for (const method of updateMethods) {
      try {
        if (await method()) {
          success = true;
          break;
        }
      } catch {

      }
    }


    return success;
  }

  async updatePreviewSystems() {
    try {
      // Update editor preview integration
      if (this.editor && this.editor.previewIntegration) {
        if (typeof this.editor.previewIntegration.onShaderUpdate === "function") {
          this.editor.previewIntegration.onShaderUpdate();
        }
      }

      // Update floating preview
      if (window.floatingPreview && window.floatingPreview.refresh) {
        window.floatingPreview.refresh();
      }

      // Update GPU renderer if available
      if (window.gpuRenderer && window.gpuRenderer.refresh) {
        window.gpuRenderer.refresh();
      }

      // Trigger canvas refresh events
      const canvas = document.getElementById("gpu-canvas");
      if (canvas) {
        // Dispatch custom events that might trigger updates
        canvas.dispatchEvent(new CustomEvent('shaderUpdated'));
        canvas.dispatchEvent(new CustomEvent('forceRefresh'));
      }
    } catch (error) {

      window.errorHandler?.handleError(error, {
        component: 'preview-system-update'
      });
    }
  }

  async reinitializeRenderingPipeline() {
    try {
      // Method 1: Force GPU device recreation
      if (window.gpuDevice) {
        if (window.gpuDevice.destroy) {
          window.gpuDevice.destroy();
        }
        window.gpuDevice = null;
      }

      // Method 2: Reset render pipelines
      if (window.renderPipeline) {
        window.renderPipeline = null;
      }

      // Method 3: Force canvas context recreation
      const canvas = document.getElementById("gpu-canvas");
      if (canvas) {
        // Get new WebGPU context
        if (typeof window.initWebGPU === "function") {
          await window.initWebGPU(canvas);
        }
      }

      // Method 4: Force texture recreation
      if (window.textureManager && typeof window.textureManager.recreateAll === "function") {
        await window.textureManager.recreateAll();
      }

      // Method 5: Reset shader modules
      if (window.shaderModule) {
        window.shaderModule = null;
      }

      // Method 6: Force buffer recreation
      const bufferObjects = ['uniformBuffer', 'vertexBuffer', 'indexBuffer'];
      for (const bufferName of bufferObjects) {
        if (window[bufferName]) {
          if (window[bufferName].destroy) {
            window[bufferName].destroy();
          }
          window[bufferName] = null;
        }
      }

      // Method 7: Force a complete render cycle
      if (typeof window.render === "function") {
        await window.render();
      }

      // Method 8: Force preview renderer reinitialization
      if (window.previewRenderer && typeof window.previewRenderer.reinitialize === "function") {
        await window.previewRenderer.reinitialize();
      }

      return true;
    } catch (error) {

      window.errorHandler?.handleError(error, {
        component: 'rendering-pipeline-reinitialization'
      });
      return false;
    }
  }

  async recomputeNodePreviews() {
    try {
      // Method 1: Ensure rendering pipeline is ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Method 2: Force a full render before computing previews
      if (typeof window.render === "function") {
        await window.render();
        await window.render(); // Double render to ensure stability
      }

      // Method 3: Simulate canvas interaction to trigger preview system
      const canvas = document.getElementById("gpu-canvas");
      if (canvas) {
        // Simulate mouse move to trigger canvas activity
        const mouseMoveEvent = new MouseEvent('mousemove', {
          clientX: canvas.offsetLeft + 10,
          clientY: canvas.offsetTop + 10,
          bubbles: true
        });
        canvas.dispatchEvent(mouseMoveEvent);

        // Simulate click to ensure canvas is active
        const clickEvent = new MouseEvent('click', {
          clientX: canvas.offsetLeft + 10,
          clientY: canvas.offsetTop + 10,
          bubbles: true
        });
        canvas.dispatchEvent(clickEvent);

        // Trigger focus to activate canvas
        canvas.focus();
      }

      // Wait for canvas events to process
      await new Promise(resolve => setTimeout(resolve, 100));

      // Method 4: Force thumbnail rendering for each node
      if (this.graph && this.graph.nodes) {
        for (const node of this.graph.nodes) {
          try {
            // Force render this specific node's preview
            if (typeof window.renderNodePreview === "function") {
              await window.renderNodePreview(node.id);
            }

            // Force compute and render node value
            if (typeof window.computeAndRenderNodeValue === "function") {
              await window.computeAndRenderNodeValue(node);
            }

            // Force preview update with rendering
            if (this.editor && this.editor.renderNodePreview) {
              await this.editor.renderNodePreview(node.id);
            }

            // Small delay between node renders
            await new Promise(resolve => setTimeout(resolve, 10));
          } catch {

          }
        }
      }

      // Method 5: Force recomputation through preview system
      if (this.editor && this.editor.previewSystem) {
        // Force recompute all node values
        if (typeof this.editor.previewSystem.recomputeAll === "function") {
          await this.editor.previewSystem.recomputeAll();
        }

        // Force refresh all previews
        if (typeof this.editor.previewSystem.refreshAll === "function") {
          await this.editor.previewSystem.refreshAll();
        }

        // Force render all previews
        if (typeof this.editor.previewSystem.renderAll === "function") {
          await this.editor.previewSystem.renderAll();
        }
      }

      // Method 6: Trigger through preview computer
      if (window.previewComputer) {
        if (typeof window.previewComputer.recomputeAll === "function") {
          await window.previewComputer.recomputeAll();
        }
        if (typeof window.previewComputer.renderAll === "function") {
          await window.previewComputer.renderAll();
        }
      }

      // Method 7: Force parameter panel updates for restored parameters
      if (typeof window.updateParameterPanel === "function") {
        window.updateParameterPanel();
      }

      // Trigger parameter binding system updates
      if (window.parameterBindingSystem && typeof window.parameterBindingSystem.updateAll === "function") {
        window.parameterBindingSystem.updateAll();
      }

      // Method 8: Simulate connection events to trigger recomputation
      if (this.graph && this.graph.connections) {
        for (const connection of this.graph.connections) {
          try {
            // Dispatch connection event that might trigger preview updates
            if (this.editor && this.editor.onConnectionChanged) {
              this.editor.onConnectionChanged(connection);
            }

            // Trigger node update for the target node
            const targetNode = this.graph.nodes.find(n => n.id === connection.to.nodeId);
            if (targetNode && this.editor && this.editor.onNodeChanged) {
              this.editor.onNodeChanged(targetNode);
            }
          } catch {

          }
        }
      }

      // Method 9: Force redraw with preview updates multiple times
      if (this.editor) {
        // Mark all nodes as needing preview updates
        if (this.editor.nodePreviews) {
          for (const [, preview] of this.editor.nodePreviews) {
            preview.needsUpdate = true;
            preview.needsRender = true; // Force rendering flag
          }
        }

        // Force redraw multiple times with delays
        const redraws = [0, 50, 150, 300, 500, 1000];
        for (const delay of redraws) {
          setTimeout(() => {
            if (this.editor.draw) {
              if (this.editor.markDirty) this.editor.markDirty('file-load-staged');
              this.editor.draw();
            }

            // Also force render after draw
            if (typeof window.render === "function") {
              window.render();
            }
          }, delay);
        }
      }

      // Method 10: Trigger global preview and parameter update functions
      const globalUpdateFunctions = [
        'updateAllPreviews',
        'recomputePreviews',
        'refreshPreviews',
        'renderPreviews',
        'updateNodePreviews',
        'renderNodePreviews',
        'computeAllNodeValues',
        'renderAllNodeValues',
        'updateParameters',
        'refreshParameters',
        'updateParameterPanels'
      ];

      for (const funcName of globalUpdateFunctions) {
        if (typeof window[funcName] === "function") {
          try {
            await window[funcName]();
          } catch {

          }
        }
      }

      // Method 11: Final canvas interaction and render simulation
      if (canvas) {
        setTimeout(async () => {
          const finalEvent = new MouseEvent('mousemove', {
            clientX: canvas.offsetLeft + 20,
            clientY: canvas.offsetTop + 20,
            bubbles: true
          });
          canvas.dispatchEvent(finalEvent);

          // Final render to ensure everything is displayed
          if (typeof window.render === "function") {
            await window.render();
          }
        }, 300);
      }
    } catch (error) {

      window.errorHandler?.handleError(error, {
        component: 'node-preview-recomputation'
      });
    }
  }

  // =============================================================================
  // FILE OPERATIONS
  // =============================================================================

  async saveToFile(filename = null, format = "json") {
    try {
      const projectData = this.exportProject();
      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/:/g, "-");

      let content, mimeType, extension;

      switch (format) {
        case "json":
          content = JSON.stringify(projectData, null, 2);
          mimeType = "application/json";
          extension = "json";
          break;

        case "rhizomium":
          // Compact, then compressed: a .rz is opened by the app, not read by a
          // person, and its bulk is inlined media.
          content = await encodeProjectFile(JSON.stringify(projectData));
          mimeType = this._fileMimeType(content);
          extension = "rz";
          break;

        case "wgsl":
          content = this.exportWGSL();
          mimeType = "text/plain";
          extension = "wgsl";
          break;

        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      const finalFilename =
        filename || `rhizomium-project-${timestamp}.${extension}`;
      this.downloadFile(content, finalFilename, mimeType);

      this.markSaved();
      this.updateStatus(`Project saved as ${finalFilename}`);
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'file-save',
        format,
        filename
      });
      this.updateStatus(`Save failed: ${error.message}`, "error");
    }
  }

  // ===========================================================================
  // PROJECT FILE SAVE (location + name aware)
  //
  //   saveProject()    "Save"    - writes back to the bound file when we hold a
  //                                live handle; otherwise behaves like Save As.
  //   saveProjectAs()  "Save As" - lets the user pick a location and name via
  //                                the native file picker, or a naming dialog +
  //                                download when that API is unavailable.
  //
  // saveToFile() above is kept for the unconditional exports (Export JSON/WGSL,
  // backups) that should never reuse the bound project file.
  // ===========================================================================

  get supportsFileSystemAccess() {
    return (
      typeof window !== "undefined" &&
      typeof window.showSaveFilePicker === "function"
    );
  }

  getProjectName() {
    return this._baseName(this.currentProjectName) || "Untitled";
  }

  /**
   * Bind the project to a name (and optionally a handle) and reflect it in the
   * window title. Passing markDirty flags the project as needing a save.
   */
  setProjectName(name, { handle = undefined, markDirty = false } = {}) {
    this.currentProjectName = name || null;
    if (handle !== undefined) this.currentFileHandle = handle;
    if (markDirty) {
      this.markUnsaved();
    } else {
      this._updateDocumentTitle();
    }
  }

  _baseName(name) {
    return String(name || "").replace(/\.[^/.]+$/, "").trim();
  }

  /** Strip characters that are illegal in file names on common platforms. */
  _sanitizeFileName(name) {
    return this._baseName(name)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^[\s-]+|[\s-]+$/g, "")
      .trim();
  }

  _suggestedFileName(format = "rhizomium") {
    const ext = format === "wgsl" ? "wgsl" : format === "json" ? "json" : "rz";
    const base = this.currentProjectName
      ? this._sanitizeFileName(this.currentProjectName)
      : `rhizomium-project-${new Date().toISOString().slice(0, 10)}`;
    return `${base || "untitled"}.${ext}`;
  }

  _updateDocumentTitle() {
    try {
      const app = "Rhizomium";
      const name = this.currentProjectName
        ? this._baseName(this.currentProjectName)
        : null;
      const marker = this.hasUnsavedFileChanges ? "• " : "";
      document.title = name ? `${marker}${name} — ${app}` : app;
    } catch {
      /* document may be unavailable in non-DOM contexts */
    }

    // Review comments are stored per project (src/core/AnnotationStore.js), and
    // every path that binds this manager to a different file — open, Save,
    // Save As — lands here. Repointing the store from one place is what keeps
    // one patch's review from showing up on another's nodes.
    try {
      getAnnotationStore().setProjectKey(this.getProjectName());
    } catch {
      /* the review layer is never worth failing a save or an open over */
    }
  }

  /**
   * "Save" - persist to the bound file when possible, else fall through to a
   * Save As so the user can choose a location the first time around.
   *
   * Guarded against re-entrancy: the Save control has more than one click
   * handler, and a second native file picker while one is open throws
   * "File picker already active". The first call wins; duplicates no-op.
   */
  async saveProject() {
    if (this._saveInProgress) return false;
    this._saveInProgress = true;
    try {
      if (this.supportsFileSystemAccess && this.currentFileHandle) {
        try {
          const content = await this._encodeForFile(this.currentFileHandle.name);
          await this._writeToHandle(this.currentFileHandle, content);
          this.markSaved();
          this.updateStatus(`Saved ${this.currentFileHandle.name}`);
          return true;
        } catch (error) {
          // A stale handle (file moved, permission revoked) should not be a
          // dead end - drop it and let the user re-pick a destination.
          if (
            error &&
            (error.name === "NotAllowedError" || error.name === "NotFoundError")
          ) {
            this.currentFileHandle = null;
            return await this._saveProjectAs();
          }
          window.errorHandler?.handleError(error, { component: "project-save" });
          this.updateStatus(`Save failed: ${error.message}`, "error");
          return false;
        }
      }
      return await this._saveProjectAs();
    } finally {
      this._saveInProgress = false;
    }
  }

  /**
   * "Save As" - always asks where/what to save. Public entry point; guards
   * against the duplicate-trigger / "File picker already active" race.
   */
  async saveProjectAs(format = "rhizomium") {
    if (this._saveInProgress) return false;
    this._saveInProgress = true;
    try {
      return await this._saveProjectAs(format);
    } finally {
      this._saveInProgress = false;
    }
  }

  /**
   * Save As implementation (no re-entrancy guard - callers hold it). Uses the
   * native picker when available (true location + name selection, remembers the
   * file for later saves), otherwise prompts for a name and downloads.
   */
  async _saveProjectAs(format = "rhizomium") {
    try {
      if (this.supportsFileSystemAccess) {
        let handle;
        try {
          handle = await window.showSaveFilePicker({
            suggestedName: this._suggestedFileName(format),
            types: [
              {
                description: "Rhizomium Project",
                accept: { "application/json": [".rz", ".json"] },
              },
            ],
          });
        } catch (err) {
          if (err && err.name === "AbortError") {
            this.updateStatus("Save cancelled");
            return false;
          }
          throw err;
        }

        // Encode for the name the user actually chose, so picking .json in the
        // dialog still writes readable JSON.
        await this._writeToHandle(handle, await this._encodeForFile(handle.name));
        this.currentFileHandle = handle;
        this.currentProjectName = handle.name;
        this.markSaved();
        this.updateStatus(`Saved to ${handle.name}`);
        return true;
      }

      // Fallback for browsers without the File System Access API: name it
      // ourselves (the old flow just emitted a timestamped file) and download.
      const suggested = this._baseName(this._suggestedFileName(format));
      const name = await this._promptForName(suggested);
      if (name === null) {
        this.updateStatus("Save cancelled");
        return false;
      }
      const ext = format === "json" ? "json" : "rz";
      const cleaned = this._sanitizeFileName(name) || suggested;
      const fileName = /\.(rz|json)$/i.test(cleaned)
        ? cleaned
        : `${cleaned}.${ext}`;

      const content = await this._encodeForFile(fileName);
      this.downloadFile(content, fileName, this._fileMimeType(content));
      this.currentFileHandle = null; // downloads don't yield a writable handle
      this.currentProjectName = fileName;
      this.markSaved();
      this.updateStatus(`Saved as ${fileName}`);
      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: "project-save-as",
        format,
      });
      this.updateStatus(`Save failed: ${error.message}`, "error");
      return false;
    }
  }

  /** Write a string to a FileSystemFileHandle, re-checking write permission. */
  async _writeToHandle(handle, content) {
    if (typeof handle.queryPermission === "function") {
      const opts = { mode: "readwrite" };
      let perm = await handle.queryPermission(opts);
      if (perm !== "granted" && typeof handle.requestPermission === "function") {
        perm = await handle.requestPermission(opts);
      }
      if (perm !== "granted") {
        const err = new Error("Write permission denied");
        err.name = "NotAllowedError";
        throw err;
      }
    }
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /** Naming dialog used by the download fallback; degrades to window.prompt. */
  async _promptForName(defaultValue) {
    try {
      return await modalManager.prompt(
        "Name your project",
        "Save Project",
        defaultValue,
        {
          placeholder: "my-shader",
          validator: (v) => (v && v.trim() ? null : "Please enter a name"),
        },
      );
    } catch {
      return window.prompt("Save project as:", defaultValue);
    }
  }

  /**
   * "Open…" via the native picker so the opened file becomes the bound file
   * and later saves write straight back to it. Returns the File (and stores the
   * handle) or null if unavailable/cancelled, so callers can fall back to the
   * hidden <input type=file> flow.
   */
  async pickProjectFile() {
    if (
      typeof window === "undefined" ||
      typeof window.showOpenFilePicker !== "function"
    ) {
      return null;
    }
    // Same re-entrancy guard as save: a duplicate trigger must not open a
    // second picker ("File picker already active").
    if (this._pickerInProgress) return null;
    this._pickerInProgress = true;
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [
          {
            description: "Rhizomium Project",
            accept: {
              "application/json": [".rz", ".json"],
              "text/plain": [".wgsl", ".glsl"],
            },
          },
        ],
        multiple: false,
      });
      const file = await handle.getFile();
      // Only .rz/.json round-trip to a writable project; shaders are imports.
      const ext = file.name.split(".").pop().toLowerCase();
      this.currentFileHandle = ext === "rz" || ext === "json" ? handle : null;
      return file;
    } catch (err) {
      if (err && err.name === "AbortError") return null;
      window.errorHandler?.handleError(err, { component: "project-open-pick" });
      return null;
    } finally {
      this._pickerInProgress = false;
    }
  }

  async loadFromFile(file) {
    try {
      this.updateStatus("Loading project...");

      const content = await this.readFile(file);
      const extension = file.name.split(".").pop().toLowerCase();

      let projectData;

      switch (extension) {
        case "json":
        case "rz":
          projectData = JSON.parse(content);
          break;

        case "wgsl":
        case "glsl":
          // Import as shader code - create a basic project structure
          projectData = this.createProjectFromShader(content, extension);
          break;

        default:
          throw new Error(`Unsupported file type: ${extension}`);
      }

      await this.importProject(projectData);

      // Bind the project to the file we just opened so the title and the next
      // "Save" reflect it. pickProjectFile() may already have set a writable
      // handle; the hidden <input> path has none, so a later Save becomes Save As.
      this.currentProjectName = file.name;
      this.markSaved();

      this.updateStatus(`Loaded ${file.name}`);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'file-load',
        filename: file?.name,
        extension: file?.name?.split(".").pop()
      });
      this.updateStatus(`Load failed: ${error.message}`, "error");

      // A patch or project from a newer build is a dead end the artist has to
      // act on (update Rhizomium), not something to leave in the status bar
      // where a dropped file's failure would look like nothing happened.
      if (/newer version of/i.test(error.message || "")) {
        try {
          await modalManager.alert(error.message, "Update Rhizomium");
        } catch {
          /* modal unavailable - the status message already reported it */
        }
      }
    }
  }

  // =============================================================================
  // LOCAL STORAGE OPERATIONS
  // =============================================================================

  /**
   * Persists the current project as the autosave snapshot.
   *
   * The snapshot itself goes to the autosave store - a file on the desktop,
   * IndexedDB in a browser. A project with an inlined texture, let alone a
   * video, runs past the ~5MB localStorage quota, and setItem then throws
   * QuotaExceededError on every autosave tick. localStorage keeps only a small
   * pointer record (timestamp + node counts) so the startup recovery checks
   * can stay synchronous.
   *
   * Passing an explicit key still writes a plain localStorage entry, for the
   * small named saves that path was built for.
   *
   * The autosave tick has already exported and hashed the project to decide
   * whether to run at all, so it hands both in rather than paying for them a
   * second time.
   */
  async saveToLocal(key = null, { projectData: prepared = null, hash = null } = {}) {
    const storageKey = key || this.autosaveKey;
    let projectData = prepared;

    try {
      if (!projectData) projectData = this.exportProject();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'local-storage-save',
        key: storageKey
      });
      this.updateStatus(`Local save failed: ${error.message}`, "error");
      return false;
    }

    const timestamp = Date.now();
    const record = {
      data: projectData,
      timestamp,
      version: SAVE_FORMAT_VERSION,
    };

    let entry;
    if (storageKey === this.autosaveKey) {
      try {
        await this.autosaveStore.put(record);
        // The pointer replaces the old inline payload - which is what frees
        // the quota for users whose storage is already full of one.
        entry = {
          storage: "external",
          timestamp,
          version: SAVE_FORMAT_VERSION,
          nodeCount: projectData.nodes?.length || 0,
          connectionCount: projectData.connections?.length || 0,
        };
      } catch (error) {
        // Neither a file nor IndexedDB available (a locked-down browser): fall
        // back to the inline snapshot, which still covers small enough projects.
        window.errorHandler?.handleError(error, {
          component: 'autosave-snapshot-write'
        });
        entry = record;
      }
    } else {
      entry = record;
    }

    if (!this._writeLocalEntry(storageKey, entry)) {
      // The snapshot itself was stored even when the pointer could not be
      // written, so the project is not lost - only the startup prompt is.
      return entry.storage === "external";
    }

    if (storageKey === this.autosaveKey) {
      this._lastAutosaveHash = hash || this._computeProjectHash(projectData);
    }
    this.hasUnsavedChanges = false;
    this.updateStatus("Project saved locally");
    return true;
  }

  /**
   * Writes one localStorage entry, turning a full quota into a plain-language
   * status instead of the raw QuotaExceededError artists used to see.
   * Returns whether the write landed.
   */
  _writeLocalEntry(storageKey, entry) {
    const serialized = JSON.stringify(entry);
    try {
      // Drop the old value first: a stale multi-megabyte payload under this
      // key still counts against the quota while setItem is being applied.
      localStorage.removeItem(storageKey);
      localStorage.setItem(storageKey, serialized);
      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'local-storage-save',
        key: storageKey,
        bytes: serialized.length
      });
      this.updateStatus(
        entry.storage === "external"
          ? "Autosaved, but browser storage is full"
          : "Local save failed: browser storage is full",
        "error",
      );
      return false;
    }
  }

  async loadFromLocal(key = null) {
    const storageKey = key || this.autosaveKey;
    try {
      const entry = parseAutosaveEntry(localStorage.getItem(storageKey));
      let data = entry?.data || null;
      let timestamp = entry?.timestamp ?? null;

      // Pointer record: the snapshot lives in the autosave store.
      if (!data && storageKey === this.autosaveKey) {
        const record = await this.autosaveStore.get().catch(() => null);
        if (record?.data) {
          data = record.data;
          timestamp = record.timestamp ?? timestamp;
        } else {
          // The pointer can outlive its snapshot if the file was removed or
          // the browser dropped the database; the newest backup is the same
          // content, one tick older.
          const [newest] = await this.getBackups();
          if (newest?.data) {
            data = newest.data;
            timestamp = newest.timestamp ?? timestamp;
          }
        }
      }

      if (!data) {
        this.updateStatus("No local save found", "warning");
        return false;
      }

      await this.importProject(data);
      const ageText =
        typeof timestamp === "number" ? this.formatAge(Date.now() - timestamp) : null;
      this.updateStatus(
        ageText ? `Loaded local save (${ageText} ago)` : "Loaded local save",
      );

      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'local-storage-load',
        key: storageKey
      });
      this.updateStatus(`Local load failed: ${error.message}`, "error");
      return false;
    }
  }

  async createBackup(reason = "manual", { projectData: prepared = null, hash: preparedHash = null } = {}) {
    try {
      const projectData = prepared || this.exportProject();

      // Skip autosave backups identical to the last one so the list
      // doesn't fill up with duplicate snapshots
      const hash = preparedHash || this._computeProjectHash(projectData);
      if (reason === "autosave" && hash && hash === this._lastBackupHash) {
        return false;
      }

      // JSON round-trip so the stored data is exactly what file save /
      // localStorage autosave persist; IndexedDB's structured clone throws
      // on values JSON would silently drop (canvases, functions, ...)
      const backup = {
        id: this.generateId(),
        data: JSON.parse(JSON.stringify(projectData)),
        timestamp: Date.now(),
        reason: reason,
        version: SAVE_FORMAT_VERSION,
        nodeCount: projectData.nodes.length,
        connectionCount: projectData.connections.length,
      };

      await this.backupStore.add(backup);
      await this.backupStore.prune(this.maxBackups);
      this._lastBackupHash = hash;
      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'backup-creation',
        reason
      });
      this.updateStatus(`Backup failed: ${error.message}`, "error");
      return false;
    }
  }

  async getBackups() {
    try {
      return await this.backupStore.getAll();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'backup-retrieval'
      });
      this.updateStatus(`Could not read backups: ${error.message}`, "error");
      return [];
    }
  }

  async deleteBackup(backupId) {
    try {
      await this.backupStore.delete(backupId);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'backup-deletion',
        backupId
      });
      this.updateStatus(`Delete failed: ${error.message}`, "error");
    }
  }

  async clearBackups() {
    try {
      await this.backupStore.clear();
      this._lastBackupHash = null;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'backup-clear'
      });
      this.updateStatus(`Clear failed: ${error.message}`, "error");
    }
  }

  async restoreBackup(backupId) {
    try {
      const backup = await this.backupStore.get(backupId);

      if (!backup) {
        throw new Error("Backup not found");
      }

      await this.importProject(backup.data);
      this.updateStatus(
        `Restored backup from ${new Date(backup.timestamp).toLocaleString()}`,
      );
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'backup-restore',
        backupId
      });
      this.updateStatus(`Restore failed: ${error.message}`, "error");
      throw error;
    }
  }

  // =============================================================================
  // AUTO-SAVE SYSTEM
  // =============================================================================

  /**
   * Turns automatic saving on or off. Disabling it stops the periodic snapshot
   * and the one taken when the tab is hidden or closed, so nothing is written
   * without the artist asking - manual saves, backups and restoring an existing
   * autosave all keep working.
   */
  setAutosaveEnabled(enabled) {
    const next = enabled !== false;
    if (next === this.autosaveEnabled) return;
    this.autosaveEnabled = next;
    this.setupAutoSave();
  }

  setupAutoSave() {
    try {
      if (this._autosaveTimer) {
        clearInterval(this._autosaveTimer);
        this._autosaveTimer = null;
      }
      if (!this.autosaveEnabled) return;

      // Auto-save interval. hasUnsavedChanges is set via markUnsaved(),
      // called from the shader update path that every graph edit goes through.
      // The tick only schedules; the work waits for a gap between frames.
      this._autosaveTimer = setInterval(() => {
        this._scheduleAutoSave();
      }, this.autosaveInterval);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'autosave-setup'
      });
    }
  }

  /**
   * Hands the autosave to the browser's idle time instead of running it
   * straight off the timer.
   *
   * A patch with inlined media is megabytes, and serializing it is main-thread
   * work: landing that in the middle of a frame is what an artist feels as a
   * stutter every 30 seconds. requestIdleCallback puts it in the gap after a
   * frame is committed instead. The timeout is the backstop for a tab that
   * never goes idle - by then the work below has been cut to a few ms, so it
   * fits in a frame's slack even in the worst case.
   */
  _scheduleAutoSave() {
    if (this._autosaveInFlight || this._autosaveScheduled) return;
    if (!this.hasUnsavedChanges || this.isImporting) return;

    this._autosaveScheduled = true;
    const run = () => {
      this._autosaveScheduled = false;
      this._runAutoSave();
    };

    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: this.autosaveInterval });
    } else {
      setTimeout(run, 0);
    }
  }

  /**
   * One autosave pass: export once, hash once, and reuse both downstream.
   * Every one of these used to be paid for three times over per tick.
   */
  async _runAutoSave() {
    if (this._autosaveInFlight) return;
    if (!this.hasUnsavedChanges || this.isImporting) return;

    // Mid-gesture is the one moment a dropped frame is visible on the wall.
    // Nothing is lost by waiting - hasUnsavedChanges stays set, so the next
    // tick picks the same edit up.
    if (this.isPerforming()) return;

    this._autosaveInFlight = true;
    try {
      let projectData;
      try {
        projectData = this.exportProject();
      } catch {
        return; // saveToLocal reports the export failure on the manual path
      }
      const hash = this._computeProjectHash(projectData);
      if (!this.shouldAutoSave(projectData, hash)) return;

      await this.saveToLocal(null, { projectData, hash });

      // Backups are history, not the crash net - the snapshot above is that.
      // One every 30 seconds meant a second full serialization plus a deep
      // copy of the patch on every tick, and bought ten backups spanning five
      // minutes. On this cadence the same ten cover a whole session.
      if (Date.now() - this._lastAutoBackupAt >= this.autoBackupInterval) {
        await this.createBackup("autosave", { projectData, hash });
        this._lastAutoBackupAt = Date.now();
      }
    } finally {
      this._autosaveInFlight = false;
    }
  }

  /**
   * Whether the artist has a hand on a control right now.
   *
   * Deliberately only the drag: a gesture lasts a second or two, so skipping a
   * tick costs nothing. Playback is not included - a set runs for an hour, and
   * blocking on it would mean never saving during the one stretch of work
   * worth keeping.
   */
  isPerforming() {
    return !!this.editor?._parameterDragging;
  }

  shouldAutoSave(projectData = null, hash = null) {
    try {
      // Only autosave if there's actual content worth saving
      if (!this.graph || !this.graph.nodes || this.graph.nodes.length === 0) {
        return false;
      }

      // Skip if content is identical to the last autosave. The hash covers
      // the full export, so parameter tweaks count as changes (the old
      // node/connection-count comparison missed them).
      const contentHash =
        hash || this._computeProjectHash(projectData || this.exportProject());
      if (contentHash && contentHash === this._lastAutosaveHash) {
        return false;
      }

      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'autosave-should-save-check'
      });
      return true; // Default to saving if we can't determine
    }
  }

  setupUnloadHandler() {
    try {
      // The snapshot write is asynchronous (IndexedDB), and a transaction
      // started in beforeunload is not guaranteed to commit - so the real
      // capture point is the tab going hidden, which fires well before the
      // page is torn down (and is the only one mobile browsers reliably send).
      document.addEventListener("visibilitychange", () => {
        if (!this.autosaveEnabled) return;
        if (document.visibilityState === "hidden" && this.hasUnsavedChanges) {
          this.saveToLocal();
        }
      });

      window.addEventListener("beforeunload", (e) => {
        if (this.autosaveEnabled && this.hasUnsavedChanges) {
          this.saveToLocal();
        }

        // The snapshot above survives a crash, but it is not the artist's
        // file - closing on top of edits they never saved still loses the
        // patch as far as they are concerned, so the browser gets to ask.
        // The desktop build handles its own close (see closeGuard.js); a
        // webview's beforeunload dialog is not shown there anyway.
        if (!isTauri() && this.hasUnsavedWork()) {
          e.preventDefault();
          e.returnValue = ""; // older browsers need the assignment to prompt
          return "";
        }
      });
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'unload-handler-setup'
      });
    }
  }

  hasAutosave() {
    try {
      const entry = parseAutosaveEntry(localStorage.getItem(this.autosaveKey));
      if (!entry || typeof entry.timestamp !== "number") return false;

      // Check if the autosave has actual content (nodes)
      if (!entry.nodeCount) {
        return false;
      }

      // Check if the autosave is recent enough to matter (not older than 24 hours)
      const age = Date.now() - entry.timestamp;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      if (age > maxAge) {
        return false;
      }
      
      // Check if current graph is empty (only show autosave prompt if starting fresh)
      if (this.graph && this.graph.nodes && this.graph.nodes.length > 0) {
        return false; // Don't show autosave prompt if there's already content
      }
      
      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'autosave-check'
      });
      return false;
    }
  }

  getAutosaveAge() {
    try {
      const entry = parseAutosaveEntry(localStorage.getItem(this.autosaveKey));
      if (!entry || typeof entry.timestamp !== "number") return null;

      const age = Date.now() - entry.timestamp;
      
      // Return null if autosave is too old to be relevant
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      if (age > maxAge) {
        return null;
      }
      
      return age;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'autosave-age-check'
      });
      return null;
    }
  }

  // =============================================================================
  // DATA EXPORT/IMPORT HELPERS
  // =============================================================================

  exportNodes() {
    try {
      const textureData = {};
      return (this.graph.nodes || []).map((node) => {
        const exportedNode = {
          id: node.id,
          kind: node.kind,
          position: { x: node.x || 0, y: node.y || 0 },
          size: { width: node.w || 180, height: node.h || 60 },
        };
      if ((node.kind === 'Texture2D' || node.kind === 'TextureCube') && this.textureManager) {
        const textureInfo = this.textureManager.getTexture(node.id);
        if (textureInfo) {
          textureData[node.id] = {
            filename: textureInfo.filename,
            dataUrl: textureInfo.dataUrl,
            width: textureInfo.width,
            height: textureInfo.height,
            isVideo: !!textureInfo.isVideo,
          };
        }
      }
        // Export ALL node properties, not just specific ones.
        // Skip runtime-only "__" properties (e.g. __thumb holds an
        // HTMLCanvasElement, which IndexedDB's structured clone rejects)
        // and functions - neither belongs in a save file.
        const excludedKeys = ['inputs', 'outputs', 'x', 'y', 'w', 'h', 'id', 'kind', 'type'];

        for (const [key, value] of Object.entries(node)) {
          if (
            !excludedKeys.includes(key) &&
            !key.startsWith('__') &&
            value !== undefined &&
            typeof value !== 'function'
          ) {
            exportedNode[key] = value;
          }
        }

        // Export input connections
        exportedNode.inputs = (node.inputs || []).map((input, index) => ({
          index,
          connected: !!input,
          ...(input && {
          from: { nodeId: input, pin: 0 },          }),
        }));

        return exportedNode;
      });
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'node-export',
        nodeCount: this.graph?.nodes?.length || 0
      });
      return [];
    }
  }

  exportConnections() {
    try {
      return (this.graph.connections || []).map((conn) => ({
        from: {
          nodeId: conn.from.nodeId,
          pin: conn.from.pin || 0,
        },
        to: {
          nodeId: conn.to.nodeId,
          pin: conn.to.pin || 0,
        },
      }));
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'connection-export',
        connectionCount: this.graph?.connections?.length || 0
      });
      return [];
    }
  }

  exportViewport() {
    try {
      if (!this.editor || !this.editor.viewport) return null;

      const vp = this.editor.viewport;
      return {
        pan: { x: vp.offsetX || 0, y: vp.offsetY || 0 },
        zoom: vp.scale || 1,
      };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-export'
      });
      return null;
    }
  }

  // Capture the 3D viewport panel state (window geometry, camera, spin) so a
  // saved project reopens with the same 3D view. Returns null when the panel
  // isn't present (e.g. a project with no 3D Field Visualizer).
  exportViewport3D() {
    try {
      const panel = (typeof window !== 'undefined' && window.viewportPanel) || null;
      if (!panel || typeof panel.serializeState !== 'function') return null;
      return panel.serializeState();
    } catch (error) {
      window.errorHandler?.handleError(error, { component: 'viewport3d-export' });
      return null;
    }
  }

  exportMetadata() {
    try {
      return {
        created: new Date().toISOString(),
        nodeCount: (this.graph.nodes || []).length,
        connectionCount: (this.graph.connections || []).length,
        editorVersion: "3.0",
        platform: navigator.platform,
        userAgent: navigator.userAgent.slice(0, 100), // Truncated for privacy
      };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'metadata-export'
      });
      return {
        created: new Date().toISOString(),
        editorVersion: "3.0"
      };
    }
  }

  exportPreviews() {
    try {
      if (!this.editor || !this.editor.nodePreviews) return {};

      const previews = {};
      for (const [nodeId, preview] of this.editor.nodePreviews) {
        // Persist every entry with its on/off state (not just the enabled ones) so a thumbnail the
        // user explicitly hid — including a normally-visible visual node — stays hidden on reload
        // rather than reverting to its default.
        previews[nodeId] = {
          enabled: preview.enabled !== false,
          size: preview.size,
          showVisualInfo: preview.showVisualInfo,
        };
      }
      return previews;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'preview-export'
      });
      return {};
    }
  }

  exportWGSL() {
    try {
      // Use your existing WGSL builder
      if (typeof window.buildWGSL === "function") {
        return window.buildWGSL(this.graph);
      }

      // Fallback - get from code element
      const codeEl = document.getElementById("code");
      return codeEl ? codeEl.textContent : "// No WGSL available";
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'wgsl-export'
      });
      return "// Error generating WGSL";
    }
  }

  // =============================================================================
  // DATA IMPORT HELPERS
  // =============================================================================

/**
 * Rebuild the graph's nodes from saved records.
 *
 * The reconstruction itself lives in graphHydration.js, shared with the
 * read-only web viewer, so a patch hydrates identically in both places.
 */
async importNodes(nodeData) {
  try {
    this.graph.nodes = hydrateNodes(nodeData);
  } catch (error) {
    window.errorHandler?.handleError(error, {
      component: 'node-import',
      nodeDataLength: nodeData?.length || 0
    });
    this.graph.nodes = [];
  }
}

/** Rebuild the connections and wire them into each target node's input slots. */
importConnections(connectionData) {
  try {
    this.graph.connections = hydrateConnections(connectionData, this.graph.nodes);
  } catch (error) {
    window.errorHandler?.handleError(error, {
      component: 'connection-import',
      connectionDataLength: connectionData?.length || 0
    });
    this.graph.connections = [];
  }
}

  /**
   * Import timeline data
   */
  importTimeline(timelineData) {
    try {
      if (!window.timelineManager) {

        return;
      }

      window.timelineManager.fromJSON(timelineData);
    } catch (error) {

      window.errorHandler?.handleError(error, {
        component: 'timeline-import'
      });
    }
  }

  /**
   * Import MIDI bindings
   */
  importMIDIBindings(midiData) {
    try {
      if (!window.midiBinding) {

        return;
      }

      window.midiBinding.deserialize(midiData);
    } catch (error) {

      window.errorHandler?.handleError(error, {
        component: 'midi-import'
      });
    }
  }

  /**
   * Import OSC bindings
   */
  importOSCBindings(oscData) {
    try {
      if (!window.oscBinding) {

        return;
      }

      window.oscBinding.deserialize(oscData);
    } catch (error) {

      window.errorHandler?.handleError(error, {
        component: 'osc-import'
      });
    }
  }

  /**
   * Import the projection-mapping surfaces
   */
  importProjectionMapping(mappingData) {
    try {
      if (!window.mappingModel) {

        return;
      }

      window.mappingModel.deserialize(mappingData);
    } catch (error) {

      window.errorHandler?.handleError(error, {
        component: 'mapping-import'
      });
    }
  }

  /**
   * Import the output screens.
   *
   * Loading a rig describes the screens; it never opens them. A project opened
   * to be looked at on one machine must not throw windows onto whatever displays
   * happen to be attached, so every loaded screen starts switched off and the
   * output button is what takes the rig live.
   */
  importOutputScreens(screenData) {
    try {
      if (!window.screenModel) {

        return;
      }

      window.screenModel.deserialize(screenData);
    } catch (error) {

      window.errorHandler?.handleError(error, {
        component: 'screens-import'
      });
    }
  }

  /**
   * Import the viewer controls this patch offers.
   *
   * Always called, even for a project that carries none, so that opening a
   * second patch clears the first one's controls instead of leaving its sliders
   * pointing at node ids that now mean something else entirely.
   */
  importViewerControls(controlData) {
    try {
      if (!window.viewerControlsModel) return;
      window.viewerControlsModel.deserialize(controlData);
      window.viewerControlsModel.prune(this.graph?.nodes || []);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'viewer-controls-import'
      });
    }
  }

  /**
   * Import the viewer page settings. Absent data restores the defaults rather
   * than keeping the last patch's ground colour behind this one's work.
   */
  importViewerPage(pageData) {
    try {
      window.viewerPageModel?.deserialize(pageData);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'viewer-page-import'
      });
    }
  }

  importViewport(viewportData) {
    try {
      if (!this.editor?.viewport) return;

      const vp = this.editor.viewport;
      if (viewportData.pan) {
        vp.offsetX = viewportData.pan.x || 0;
        vp.offsetY = viewportData.pan.y || 0;
      }
      if (viewportData.zoom) {
        vp.scale = viewportData.zoom;
      }
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'viewport-import'
      });
    }
  }

  importViewport3D(viewport3DData) {
    try {
      const panel = (typeof window !== 'undefined' && window.viewportPanel) || null;
      if (!panel || typeof panel.restoreState !== 'function') return;
      panel.restoreState(viewport3DData);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'viewport3d-import'
      });
    }
  }

  importPreviews(previewData) {
    try {
      if (!this.editor?.nodePreviews) return;

      for (const [nodeId, previewSettings] of Object.entries(previewData)) {
        this.editor.nodePreviews.set(nodeId, {
          // Respect the saved on/off state (default on) so a thumbnail the user hid stays hidden
          // across save/reload instead of springing back on.
          enabled: previewSettings.enabled !== false,
          size: previewSettings.size || "large",
          showVisualInfo: previewSettings.showVisualInfo !== false,
        });
      }
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'preview-import'
      });
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  validateProjectData(data) {
    try {
      if (!data || typeof data !== "object") {
        throw new Error("Invalid project data");
      }

      if (!Array.isArray(data.nodes)) {
        throw new Error("Project must contain nodes array");
      }

      if (!Array.isArray(data.connections)) {
        throw new Error("Project must contain connections array");
      }

      // Version compatibility check (migrateProjectData normally runs first
      // and rejects newer formats; this guards direct validate calls)
      if (typeof data.version === "number" && data.version > SAVE_FORMAT_VERSION) {
        throw new Error(
          `Unsupported project format version ${data.version} (supported up to ${SAVE_FORMAT_VERSION})`
        );
      }
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'project-validation',
        hasNodes: Array.isArray(data?.nodes),
        hasConnections: Array.isArray(data?.connections)
      });
      throw error;
    }
  }

  clearGraph() {
    try {
      this.graph.nodes = [];
      this.graph.connections = [];
      this.graph.selection = new Set();

      if (this.editor) {
        if (this.editor.selection?.clear) {
          this.editor.selection.clear();
        }
        if (this.editor.nodePreviews) {
          this.editor.nodePreviews.clear();
        }
      }

      // Drop the compute registry with the graph it describes. It is keyed by node
      // id and is otherwise only pruned one node at a time, as nodes are DELETED —
      // replacing the graph deletes nothing, so every id in it outlives its node and
      // is inherited by whatever the loaded file numbers the same. A Texture 2D
      // landing on a dead compute node's id was then compiled with a
      // compute_node_<id> binding aimed at its own bridged output texture, which
      // invalidates every command buffer that render pass goes into.
      //
      // Bookkeeping ONLY: the managers and their textures are left alone, because
      // the pipeline still on screen is still bound to them and keeps drawing until
      // the loaded graph's shader replaces it — destroying them here is what
      // "Destroyed texture [Texture "Output Texture"] used in a submit" looks like.
      // The rebuild that follows tears them down in initialize(), which holds the
      // old textures alive until the new bind groups are in place.
      window.computeNodeRegistry?.clear?.();
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'graph-clear'
      });
    }
  }

  createProjectFromShader(shaderCode, type) {
    try {
      // Create a basic project with a text/output node containing the shader
      return {
        app: "Rhizomium-Web",
        version: SAVE_FORMAT_VERSION,
        format: "imported-shader",
        savedAt: new Date().toISOString(),
        nodes: [
          {
            id: this.generateId(),
            kind: "TextOutput",
            position: { x: 100, y: 100 },
            size: { width: 300, height: 200 },
            expr: shaderCode,
          },
        ],
        connections: [],
        metadata: {
          imported: true,
          originalType: type,
          created: new Date().toISOString(),
        },
      };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'shader-project-creation',
        type,
        shaderLength: shaderCode?.length || 0
      });
      throw error;
    }
  }

  /**
   * A project file's JSON text. Compressed .rz files are inflated on the way in
   * (see projectFile.js); everything written before compression existed, and
   * every .json/.wgsl import, reads exactly as it always did.
   */
  async readFile(file) {
    try {
      return await decodeProjectFile(file);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'file-read',
        filename: file?.name
      });
      throw error instanceof Error ? error : new Error("Failed to read file");
    }
  }

  /**
   * The project as bytes for `name`: compressed for a .rz, plain pretty-printed
   * JSON for a .json, which stays human-readable interchange.
   */
  async _encodeForFile(name) {
    const projectData = this.exportProject();
    if (/\.json$/i.test(String(name || ""))) {
      return JSON.stringify(projectData, null, 2);
    }
    return await encodeProjectFile(JSON.stringify(projectData));
  }

  /** What encodeProjectFile actually produced: gzip bytes, or plain JSON text. */
  _fileMimeType(content) {
    return typeof content === "string" ? "application/json" : "application/gzip";
  }

  downloadFile(content, filename, mimeType) {
    try {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'file-download',
        filename,
        mimeType
      });
    }
  }

  updateStatus(message, type = "info") {
    try {
      const statusEl = document.getElementById("status");
      if (statusEl) {
        statusEl.textContent = message;
        // Keep the layout class: it is what pushes the readout to the right of
        // the menu bar and draws its live-state dot. Assigning `type` alone
        // dropped it, leaving the status stranded next to the Help menu.
        statusEl.className = type ? `menu-status ${type}` : "menu-status";

        // Clear status after 3 seconds
        setTimeout(() => {
          if (statusEl.textContent === message) {
            statusEl.textContent = "Idle";
            statusEl.className = "menu-status";
          }
        }, 3000);
      }
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'status-update',
        message,
        type
      });
    }
  }

  formatAge(ms) {
    try {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `${days}d`;
      if (hours > 0) return `${hours}h`;
      if (minutes > 0) return `${minutes}m`;
      return `${seconds}s`;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'age-formatting',
        ms
      });
      return 'unknown';
    }
  }

  generateId() {
    try {
      return Math.random().toString(36).slice(2, 15);
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'id-generation'
      });
      return Date.now().toString();
    }
  }
}