import { MessagePriority } from './AsyncQueueManager.js';
import { BackupStore } from './BackupStore.js';
import { migrateProjectData, SAVE_FORMAT_VERSION } from './projectMigrations.js';

async function reinitializeWebGPUAfterLoad() {
  try {
    // Clean up any duplicate canvases
    const allCanvases = document.querySelectorAll("#gpu-canvas");

    if (allCanvases.length > 1) {
      // Remove all but the first one
      for (let i = 1; i < allCanvases.length; i++) {
        allCanvases[i].remove();
      }
    }

    // Get the remaining canvas
    const canvas = document.getElementById("gpu-canvas");
    if (!canvas) {
      throw new Error("No GPU canvas found after cleanup");
    }

    // Force WebGPU reinitialization
    const device = await initWebGPU(canvas);

    if (device) {
      // Force a shader update to test
      updateShaderFromGraph();

      return true;
    } else {
      throw new Error("Failed to reinitialize WebGPU");
    }
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'webgpu-reinitialization',
      context: 'after-file-load'
    });
    return false;
  }
}

export class SaveLoadManager {
  constructor(editor, graph, updateCallback) {
    this.editor = editor;
    this.textureManager = null;
    this.graph = graph;
    this.updateCallback = updateCallback || (() => {});
    this.autosaveKey = "rhizomium.autosave.v2";
    this.backupsKey = "rhizomium.backups.v2";
    this.projectsKey = "rhizomium.projects.v2";

    // Auto-save settings
    this.autosaveInterval = 30000; // 30 seconds
    this.maxBackups = 10;
    this.hasUnsavedChanges = false;
    this.isImporting = false;
    this._lastAutosaveHash = null;
    this._lastBackupHash = null;

    // Backups live in IndexedDB - full texture dataUrls don't fit in the
    // ~5MB localStorage quota once a project grows
    this.backupStore = new BackupStore();
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
    this.hasUnsavedChanges = true;
  }

  /**
   * Cheap content hash (djb2) of a project export, ignoring volatile fields,
   * used to skip redundant autosaves/backups.
   */
  _computeProjectHash(projectData) {
    try {
      const { savedAt, metadata, ...stable } = projectData;
      const str = JSON.stringify(stable);
      let hash = 5381;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
      }
      return `${hash}:${str.length}`;
    } catch (error) {
      return null;
    }
  }
// ADD THESE THREE METHODS to your SaveLoadManager class
// Put them after your export methods, before the file operations section

/**
 * Restore textures from saved data
 */
async restoreTextures(textureData) {
  if (!textureData || !this.textureManager) {
    return;
  }

  const restorePromises = [];

  for (const [nodeId, texInfo] of Object.entries(textureData)) {
    if (texInfo.dataUrl) {
      const promise = this.loadTextureFromDataUrl(nodeId, texInfo.dataUrl, texInfo.filename);
      restorePromises.push(promise);
    }
  }

  if (restorePromises.length > 0) {
    await Promise.all(restorePromises);
  }
}

/**
 * Load texture from data URL and register it
 */
async loadTextureFromDataUrl(nodeId, dataUrl, filename) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = async () => {
      try {
        const bitmap = await createImageBitmap(img);
        
        if (this.textureManager && this.textureManager.device) {
          // Store in textures map
          const textureInfo = {
            bitmap: bitmap,
            width: img.width,
            height: img.height,
            filename: filename,
            dataUrl: dataUrl
          };
          this.textureManager.textures.set(nodeId, textureInfo);
          
          // Create GPU texture
          const gpuTexture = this.textureManager.device.createTexture({
            size: [img.width, img.height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
          });

          // Upload bitmap to GPU
          this.textureManager.device.queue.copyExternalImageToTexture(
            { source: bitmap },
            { texture: gpuTexture },
            [img.width, img.height]
          );

          // Create sampler
          const sampler = this.textureManager.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'repeat',
            addressModeV: 'repeat',
          });

          // Store in gpuTextures map (this is what the renderer checks!)
          if (!this.textureManager.gpuTextures) {
            this.textureManager.gpuTextures = new Map();
          }
          this.textureManager.gpuTextures.set(nodeId, {
            texture: gpuTexture,
            sampler: sampler
          });

          // Invalidate bind group since we have new textures
          this.textureManager.bindGroup = null;
        }

        resolve();
      } catch (err) {

        reject(err);
      }
    };
    
    img.onerror = () => reject(new Error('Failed to load texture image'));
    img.src = dataUrl;
  });
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

      // Core graph data
      nodes: this.exportNodes(),
      connections: this.exportConnections(),
      textures: textureData, // Now textureData is defined

      // Timeline data
      timeline: this.exportTimeline(),

      // MIDI bindings
      midiBindings: this.exportMIDIBindings(),

      // Editor state
      ...(includeViewport && {
        viewport: this.exportViewport(),
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
        for (const [nodeId, texInfo] of this.textureManager.textures.entries()) {
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
            } catch (error) {

            }
          }
        }
      }
    }

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

    // Restore previews if requested
    if (restorePreviews && projectData.previews) {
      this.importPreviews(projectData.previews);
    }

    // CRITICAL: Enhanced shader rebuild sequence after loading
    // Step 1: Wait a frame to ensure DOM is stable
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Step 2: Force WebGPU reinitialization and capture the device
    let gpuDevice = await this.reinitializeWebGPU();
    if (!gpuDevice) {

    }

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
    } else {

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

    // Generate previews for all nodes that should have them enabled
    await new Promise(resolve => setTimeout(resolve, 300));

    if (this.editor && this.editor.previewSystem && this.graph && this.graph.nodes) {
      for (const node of this.graph.nodes) {
        const previewSettings = this.editor.nodePreviews?.get(node.id);

        if (previewSettings && previewSettings.enabled) {
          if (typeof this.editor.previewSystem.generatePreview === 'function') {
            await this.editor.previewSystem.generatePreview(node.id, node);
          }

          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }

    // Final editor redraw
    await new Promise(resolve => setTimeout(resolve, 200));
    if (this.editor && this.editor.draw) {
      if (this.editor.markDirty) this.editor.markDirty('file-load-complete');
      this.editor.draw();
    }

    this.hasUnsavedChanges = false;
    this.updateStatus("Project loaded successfully");

    await new Promise(resolve => setTimeout(resolve, 300));

    if (this.graph && this.graph.nodes) {
      const sorted = this.topologicalSortNodes(this.graph.nodes);

      for (const node of sorted) {
        try {
          if (node.kind?.toLowerCase() === 'outputfinal') {
            continue;
          }

          // Don't delete __thumb - keep existing preview so dependent nodes can use it
          // Only create new canvas if needed
          let canvas = node.__thumb;
          let needsResize = false;

          if (!canvas || canvas.width !== 128 || canvas.height !== 128) {
            canvas = document.createElement('canvas');
            canvas.width = 128;
            canvas.height = 128;
            needsResize = true;
          }

          const ctx = canvas.getContext('2d');

          let renderer = null;

          if (this.editor?.previewSystem?.rendererRegistry) {
            const registry = this.editor.previewSystem.rendererRegistry;
            const nodeType = node.kind?.toLowerCase();

            if (registry[nodeType]) {
              renderer = registry[nodeType];
            } else if (typeof registry.get === 'function') {
              renderer = registry.get(nodeType);
            } else if (typeof registry.getRenderer === 'function') {
              renderer = registry.getRenderer(nodeType);
            } else if (registry.renderers && registry.renderers[nodeType]) {
              renderer = registry.renderers[nodeType];
            }
          }

          if (renderer && typeof renderer === 'function') {
            renderer(ctx, node);
            node.__thumb = canvas;
          } else {

          }

          await new Promise(resolve => setTimeout(resolve, 30));
        } catch (error) {

        }
      }

      // Capture OutputFinal thumbnail from the actual rendered shader
      const outputNode = this.graph.nodes.find(n => n.kind?.toLowerCase() === 'outputfinal');
      if (outputNode) {
        await new Promise(resolve => setTimeout(resolve, 150));
        
        if (typeof window.render === "function") {
          await window.render();
        }
        
        const gpuCanvas = document.getElementById("gpu-canvas");
        if (gpuCanvas) {
          const thumbCanvas = document.createElement('canvas');
          thumbCanvas.width = 128;
          thumbCanvas.height = 128;
          const thumbCtx = thumbCanvas.getContext('2d');

          thumbCtx.drawImage(gpuCanvas, 0, 0, 128, 128);
          outputNode.__thumb = thumbCanvas;

          await new Promise(resolve => setTimeout(resolve, 200));

          for (let i = 0; i < 5; i++) {
            if (this.editor && this.editor.draw) {
              if (this.editor.markDirty) this.editor.markDirty('file-load-retry');
              this.editor.draw();
            }
            await new Promise(resolve => setTimeout(resolve, 50));
          }

          if (this.graph && this.graph.nodes) {
            for (const node of this.graph.nodes) {
              if (this.editor && typeof this.editor.onNodeChanged === 'function') {
                this.editor.onNodeChanged(node);
              }
            }
          }

          if (this.editor && this.editor.draw) {
            if (this.editor.markDirty) this.editor.markDirty('file-load-final-retry');
            this.editor.draw();
          }

          this.hasUnsavedChanges = false;    
        } else {

        }
      }
    }

    this.hasUnsavedChanges = false;
    this.updateStatus("Project loaded successfully");

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
}topologicalSortNodes(nodes) {
  const sorted = [];
  const visited = new Set();
  const temp = new Set();
  
  const visit = (node) => {
    if (temp.has(node.id)) return; // Circular dependency
    if (visited.has(node.id)) return;
    
    temp.add(node.id);
    
    // Visit dependencies first
    if (node.inputs) {
      for (const inputId of node.inputs) {
        if (inputId) {
          const inputNode = nodes.find(n => n.id === inputId);
          if (inputNode) visit(inputNode);
        }
      }
    }
    
    temp.delete(node.id);
    visited.add(node.id);
    sorted.push(node);
  };
  
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      visit(node);
    }
  }
  
  return sorted;
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
          } catch (error) {

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
          } catch (error) {

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
      } catch (error) {

      }
    }

    if (!success) {

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
          } catch (error) {

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
          } catch (error) {

          }
        }
      }

      // Method 9: Force redraw with preview updates multiple times
      if (this.editor) {
        // Mark all nodes as needing preview updates
        if (this.editor.nodePreviews) {
          for (const [nodeId, preview] of this.editor.nodePreviews) {
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
          } catch (error) {

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

  saveToFile(filename = null, format = "json") {
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
          content = JSON.stringify(projectData, null, 2);
          mimeType = "application/json";
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

      this.hasUnsavedChanges = false;
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
      this.updateStatus(`Loaded ${file.name}`);
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'file-load',
        filename: file?.name,
        extension: file?.name?.split(".").pop()
      });
      this.updateStatus(`Load failed: ${error.message}`, "error");
    }
  }

  // =============================================================================
  // LOCAL STORAGE OPERATIONS
  // =============================================================================

  saveToLocal(key = null) {
    try {
      const projectData = this.exportProject();
      const storageKey = key || this.autosaveKey;

      localStorage.setItem(
        storageKey,
        JSON.stringify({
          data: projectData,
          timestamp: Date.now(),
          version: SAVE_FORMAT_VERSION,
        }),
      );

      if (storageKey === this.autosaveKey) {
        this._lastAutosaveHash = this._computeProjectHash(projectData);
      }
      this.hasUnsavedChanges = false;
      this.updateStatus("Project saved locally");
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'local-storage-save',
        key: key || this.autosaveKey
      });
      this.updateStatus(`Local save failed: ${error.message}`, "error");
    }
  }

  async loadFromLocal(key = null) {
    try {
      const storageKey = key || this.autosaveKey;
      const stored = localStorage.getItem(storageKey);

      if (!stored) {
        this.updateStatus("No local save found", "warning");
        return false;
      }

      const { data, timestamp } = JSON.parse(stored);
      const age = Date.now() - timestamp;
      const ageText = this.formatAge(age);

      await this.importProject(data);
      this.updateStatus(`Loaded local save (${ageText} ago)`);

      return true;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'local-storage-load',
        key: key || this.autosaveKey
      });
      this.updateStatus(`Local load failed: ${error.message}`, "error");
      return false;
    }
  }

  async createBackup(reason = "manual") {
    try {
      const projectData = this.exportProject();

      // Skip autosave backups identical to the last one so the list
      // doesn't fill up with duplicate snapshots
      const hash = this._computeProjectHash(projectData);
      if (reason === "autosave" && hash && hash === this._lastBackupHash) {
        return false;
      }

      const backup = {
        id: this.generateId(),
        data: projectData,
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

  setupAutoSave() {
    try {
      // Auto-save interval. hasUnsavedChanges is set via markUnsaved(),
      // called from the shader update path that every graph edit goes through.
      setInterval(() => {
        if (this.hasUnsavedChanges && !this.isImporting && this.shouldAutoSave()) {
          this.saveToLocal();
          this.createBackup("autosave");
        }
      }, this.autosaveInterval);
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'autosave-setup'
      });
    }
  }

  shouldAutoSave() {
    try {
      // Only autosave if there's actual content worth saving
      if (!this.graph || !this.graph.nodes || this.graph.nodes.length === 0) {
        return false;
      }

      // Skip if content is identical to the last autosave. The hash covers
      // the full export, so parameter tweaks count as changes (the old
      // node/connection-count comparison missed them).
      const hash = this._computeProjectHash(this.exportProject());
      if (hash && hash === this._lastAutosaveHash) {
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
      window.addEventListener("beforeunload", (e) => {
        if (this.hasUnsavedChanges) {
          this.saveToLocal();
          // Don't show dialog - just save silently
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
      const stored = localStorage.getItem(this.autosaveKey);
      if (!stored) return false;
      
      const { data, timestamp } = JSON.parse(stored);
      
      // Check if the autosave has actual content (nodes)
      if (!data || !data.nodes || data.nodes.length === 0) {
        return false;
      }
      
      // Check if the autosave is recent enough to matter (not older than 24 hours)
      const age = Date.now() - timestamp;
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
      const stored = localStorage.getItem(this.autosaveKey);
      if (!stored) return null;

      const { timestamp } = JSON.parse(stored);
      const age = Date.now() - timestamp;
      
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
          };
        }
      }
        // Export ALL node properties, not just specific ones
        const excludedKeys = ['inputs', 'outputs', 'x', 'y', 'w', 'h', 'id', 'kind', 'type'];
        
        for (const [key, value] of Object.entries(node)) {
          if (!excludedKeys.includes(key) && value !== undefined) {
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
        if (preview.enabled) {
          previews[nodeId] = {
            size: preview.size,
            showVisualInfo: preview.showVisualInfo,
          };
        }
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

async importNodes(nodeData) {
  try {
    // Create an ID mapping to preserve connections
    const idMap = new Map();

    this.graph.nodes = (nodeData || []).map((data) => {
      // PRESERVE ORIGINAL IDs - don't regenerate them!
      // This ensures node references like "=node_14" keep working
      const nodeId = String(data.id);
      idMap.set(nodeId, nodeId);  // Map to itself since we're not changing IDs

      const node = {
        id: nodeId,  // Use the ORIGINAL ID
        type: data.kind || "Unknown",
        kind: data.kind || "Unknown",
        x: data.position?.x || data.x || 0,
        y: data.position?.y || data.y || 0,
        w: data.size?.width || data.w || 180,
        h: data.size?.height || data.h || 60,
        inputs: [],
        outputs: [],
      };

      // ... rest of property restoration
      if (data.value !== undefined) node.value = data.value;
      if (data.xv !== undefined) node.xv = data.xv;
      if (data.yv !== undefined) node.yv = data.yv;
      if (data.expr !== undefined) node.expr = data.expr;
      if (data.props !== undefined) node.props = { ...data.props };

      const parameterKeys = ['min', 'max', 'step', 'default', 'label', 'units', 'precision'];
      for (const key of parameterKeys) {
        if (data[key] !== undefined) {
          node[key] = data[key];
        }
      }

      for (const [key, value] of Object.entries(data)) {
        if (!['id', 'kind', 'position', 'size', 'inputs', 'outputs'].includes(key) && 
            !node.hasOwnProperty(key)) {
          node[key] = value;
        }
      }

      const inputCount = data.inputs?.length || 0;
      node.inputs = new Array(inputCount).fill(null);

      return node;
    });

    // Store the ID map for use in importConnections
    this._importIdMap = idMap;
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'node-import',
      nodeDataLength: nodeData?.length || 0
    });
    this.graph.nodes = [];
  }
}
importConnections(connectionData) {
  try {
    const idMap = this._importIdMap || new Map();
    
    this.graph.connections = (connectionData || []).map(conn => ({
      from: {
        nodeId: idMap.get(String(conn.from.nodeId)) || String(conn.from.nodeId),
        pin: conn.from.pin || 0,
      },
      to: {
        nodeId: idMap.get(String(conn.to.nodeId)) || String(conn.to.nodeId),
        pin: conn.to.pin || 0,
      },
    }));

    const nodeMap = new Map(this.graph.nodes.map(n => [n.id, n]));
    
    for (const conn of this.graph.connections) {
      const toNode = nodeMap.get(conn.to.nodeId);
      if (toNode) {
        const toPin = conn.to.pin || 0;
        while (toNode.inputs.length <= toPin) {
          toNode.inputs.push(null);
        }
        toNode.inputs[toPin] = conn.from.nodeId;
      }
    }

    // Clean up the temporary ID map
    delete this._importIdMap;
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

  importPreviews(previewData) {
    try {
      if (!this.editor?.nodePreviews) return;

      for (const [nodeId, previewSettings] of Object.entries(previewData)) {
        this.editor.nodePreviews.set(nodeId, {
          enabled: true,
          size: previewSettings.size || "small",
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

  async readFile(file) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
      } catch (error) {
        window.errorHandler?.handleError(error, { 
          component: 'file-read',
          filename: file?.name
        });
        reject(error);
      }
    });
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
        statusEl.className = type;

        // Clear status after 3 seconds
        setTimeout(() => {
          if (statusEl.textContent === message) {
            statusEl.textContent = "Idle";
            statusEl.className = "";
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