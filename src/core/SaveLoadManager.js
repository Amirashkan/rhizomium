

async function reinitializeWebGPUAfterLoad() {
  try {
    console.log("🔧 Reinitializing WebGPU after file load...");

    // Clean up any duplicate canvases
    const allCanvases = document.querySelectorAll("#gpu-canvas");
    console.log(`Found ${allCanvases.length} canvas elements with gpu-canvas id`);

    if (allCanvases.length > 1) {
      console.log("⚠️ Multiple canvases detected, cleaning up...");
      // Remove all but the first one
      for (let i = 1; i < allCanvases.length; i++) {
        allCanvases[i].remove();
        console.log(`Removed duplicate canvas ${i}`);
      }
    }

    // Get the remaining canvas
    const canvas = document.getElementById("gpu-canvas");
    if (!canvas) {
      throw new Error("No GPU canvas found after cleanup");
    }

    // Force WebGPU reinitialization
    console.log("🔄 Reinitializing WebGPU...");

    const device = await initWebGPU(canvas);

    if (device) {
      console.log("✅ WebGPU reinitialized successfully");

      // Force a shader update to test
      console.log("🔄 Testing shader update...");
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

    this.setupAutoSave();
    this.setupUnloadHandler();
  }
// ADD THESE THREE METHODS to your SaveLoadManager class
// Put them after your export methods, before the file operations section

/**
 * Restore textures from saved data
 */
async restoreTextures(textureData) {
  if (!textureData || !this.textureManager) {
    console.log("No texture data to restore or no texture manager");
    return;
  }
  
  const restorePromises = [];

  for (const [nodeId, texInfo] of Object.entries(textureData)) {
    if (texInfo.dataUrl) {
      console.log(`Scheduling restoration of texture for node ${nodeId}: ${texInfo.filename}`);
      const promise = this.loadTextureFromDataUrl(nodeId, texInfo.dataUrl, texInfo.filename);
      restorePromises.push(promise);
    }
  }

  if (restorePromises.length > 0) {
    await Promise.all(restorePromises);
    console.log(`✓ Restored ${restorePromises.length} textures`);
  } else {
    console.log("No textures to restore");
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

          console.log(`✓ Restored texture: ${filename} for node ${nodeId}`);
        }
        
        resolve();
      } catch (err) {
        console.error(`Failed to restore texture for node ${nodeId}:`, err);
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
      version: 2,
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
    const {
      clearExisting = true,
      validateData = true,
      restoreViewport = true,
      restorePreviews = false,
    } = options;

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
      console.log("🎨 Restoring textures from save file...");
      console.log("Texture data keys:", Object.keys(projectData.textures));
      await this.restoreTextures(projectData.textures);
      console.log("✅ Textures restored");
// After this line:
await this.restoreTextures(projectData.textures);
console.log("✅ Textures restored");

// Add this:
// Force GPU texture creation for all restored textures
if (this.textureManager && this.textureManager.device) {
  console.log("🎨 Creating GPU textures from restored bitmaps...");
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
        console.log(`✓ Created GPU texture for node ${nodeId}`);
      } catch (error) {
        console.error(`Failed to create GPU texture for node ${nodeId}:`, error);
      }
    }
  }
  console.log("✅ GPU textures created");
}


    } else {
      console.log("⚠️ No textures in save file or no texture manager");
      console.log("  textures present:", !!projectData.textures);
      console.log("  textureManager present:", !!this.textureManager);
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
    console.log("🔄 Starting comprehensive shader rebuild after project load...");

    // Step 1: Wait a frame to ensure DOM is stable
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Step 2: Force WebGPU reinitialization and capture the device
    let gpuDevice = await this.reinitializeWebGPU();
    if (!gpuDevice) {
      console.warn("WebGPU reinitialization failed, continuing with shader update...");
    }

    // Step 3: Wait another frame after WebGPU init
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Step 4: Multiple shader update attempts with different methods
    await this.forceShaderUpdate();

    // Step 5: Wait for GPU pipeline to stabilize
    await new Promise(resolve => setTimeout(resolve, 200));

    // Step 6: Force editor redraw
    if (this.editor && this.editor.draw) {
      if (this.editor.markDirty) this.editor.markDirty('file-load-step6');
      this.editor.draw();
    }

    // Step 7: Enhanced GPU stability and preview fix
    console.log("Ensuring GPU and previews are ready...");

    // Try multiple ways to get the GPU device
    if (window.textureManager && window.textureManager.device) {
      gpuDevice = window.textureManager.device;
      console.log("Got GPU device from textureManager");
    } else if (window.gpuDevice) {
      gpuDevice = window.gpuDevice;
      console.log("Got GPU device from window.gpuDevice");
    } else if (window.device) {
      gpuDevice = window.device;
      console.log("Got GPU device from window.device");
    }

    if (gpuDevice && this.editor && this.editor.previewSystem) {
      console.log("Reconnecting GPU device to preview system...");
      
      // Reconnect GPU device to preview components
      if (this.editor.previewSystem.canvasManager) {
        this.editor.previewSystem.canvasManager.device = gpuDevice;
        console.log("GPU device reconnected to CanvasManager");
      }
      
      if (this.editor.previewSystem.rendererRegistry) {
        this.editor.previewSystem.rendererRegistry.device = gpuDevice;
        console.log("GPU device reconnected to RendererRegistry");
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
      console.warn("GPU device or preview system not available for reconnection");
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

    console.log("GPU and preview update completed");

    // Generate previews for all nodes that should have them enabled
    console.log("🔄 Generating previews for enabled nodes...");
    await new Promise(resolve => setTimeout(resolve, 300));

    if (this.editor && this.editor.previewSystem && this.graph && this.graph.nodes) {
      for (const node of this.graph.nodes) {
        const previewSettings = this.editor.nodePreviews?.get(node.id);
        
        if (previewSettings && previewSettings.enabled) {
          console.log(`Generating preview for node ${node.kind} (${node.id})`);
          
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
    console.log("🔄 Forcing thumbnail regeneration with direct rendering...");

    if (this.graph && this.graph.nodes) {
      const sorted = this.topologicalSortNodes(this.graph.nodes);
      
      for (const node of sorted) {
        try {
          if (node.kind?.toLowerCase() === 'outputfinal') {
            console.log(`Skipping direct render for OutputFinal, will use shader result`);
            continue;
          }
          
          delete node.__thumb;
          
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 128;
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
            console.log(`Rendered thumbnail for ${node.kind} (${node.id})`);
          } else {
            console.warn(`No renderer found for ${node.kind}`);
          }
          
          await new Promise(resolve => setTimeout(resolve, 30));
        } catch (error) {
          console.warn(`Failed to render thumbnail for node ${node.id}:`, error);
        }
      }
      
      console.log("✅ Direct thumbnail rendering complete");

      // Capture OutputFinal thumbnail from the actual rendered shader
      const outputNode = this.graph.nodes.find(n => n.kind?.toLowerCase() === 'outputfinal');
      if (outputNode) {
        console.log("Capturing OutputFinal thumbnail from main canvas...");
        
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
          
          console.log("🔄 Forcing editor to display all thumbnails...");
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
          console.warn("Main GPU canvas not found for OutputFinal capture");
        }
      }
    }

    this.hasUnsavedChanges = false;
    this.updateStatus("Project loaded successfully");

    console.log("✅ Project import completed with full shader update sequence");
    return true;
    
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'project-import',
      options,
      nodeCount: projectData?.nodes?.length || 0
    });
    this.updateStatus(`Import failed: ${error.message}`, "error");
    throw new Error(`Failed to import project: ${error.message}`);
  }
}

  // =============================================================================
  // ENHANCED WEBGPU AND SHADER UPDATE METHODS
  // =============================================================================

async reinitializeWebGPU() {
  try {
    console.log("🔧 Reinitializing WebGPU after file load...");

    // Clean up any duplicate canvases
    const allCanvases = document.querySelectorAll("#gpu-canvas");
    console.log(`Found ${allCanvases.length} canvas elements with gpu-canvas id`);

    if (allCanvases.length > 1) {
      console.log("⚠️ Multiple canvases detected, cleaning up...");
      for (let i = 1; i < allCanvases.length; i++) {
        allCanvases[i].remove();
        console.log(`Removed duplicate canvas ${i}`);
      }
    }

    // Get the remaining canvas
    const canvas = document.getElementById("gpu-canvas");
    if (!canvas) {
      console.error("No GPU canvas found after cleanup");
      return null;
    }

    // Force WebGPU reinitialization if the function exists
    if (typeof window.initWebGPU === "function") {
      console.log("🔄 Calling initWebGPU...");
      const device = await window.initWebGPU(canvas, true);
      if (device) {
        console.log("✅ WebGPU reinitialized successfully");
        
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
    console.error("WebGPU reinitialization failed:", error);
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
    console.log("🔄 Forcing shader update with multiple methods...");

    const updateMethods = [
      // Method 1: Primary update callback
      async () => {
        if (this.updateCallback) {
          console.log("Trying primary update callback...");
          await this.updateCallback();
          return true;
        }
        return false;
      },

      // Method 2: Global updateShaderFromGraph function
      async () => {
        if (typeof window.updateShaderFromGraph === "function") {
          console.log("Trying window.updateShaderFromGraph...");
          await window.updateShaderFromGraph();
          return true;
        }
        return false;
      },

      // Method 3: Global rebuild function
      async () => {
        if (typeof window.rebuild === "function") {
          console.log("Trying window.rebuild...");
          await window.rebuild();
          return true;
        }
        return false;
      },

      // Method 4: Manual WGSL build and update
      async () => {
        if (typeof window.buildWGSL === "function" && typeof window.updateShader === "function") {
          try {
            console.log("Trying manual WGSL build...");
            const wgsl = window.buildWGSL(this.graph);
            await window.updateShader(wgsl);
            console.log("Manual shader update successful");
            return true;
          } catch (error) {
            console.warn("Manual shader update failed:", error);
            return false;
          }
        }
        return false;
      },

      // Method 5: Direct shader compilation if available
      async () => {
        if (typeof window.compileShader === "function") {
          try {
            console.log("Trying direct shader compilation...");
            await window.compileShader(this.graph);
            return true;
          } catch (error) {
            console.warn("Direct shader compilation failed:", error);
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
          console.log("✅ Shader update method succeeded");
          break;
        }
      } catch (error) {
        console.warn("Shader update method failed:", error);
      }
    }

    if (!success) {
      console.warn("⚠️ All shader update methods failed");
    }

    return success;
  }

  async updatePreviewSystems() {
    console.log("🔄 Updating preview systems...");

    try {
      // Update editor preview integration
      if (this.editor && this.editor.previewIntegration) {
        if (typeof this.editor.previewIntegration.onShaderUpdate === "function") {
          console.log("Updating editor preview integration...");
          this.editor.previewIntegration.onShaderUpdate();
        }
      }

      // Update floating preview
      if (window.floatingPreview && window.floatingPreview.refresh) {
        console.log("Refreshing floating preview...");
        window.floatingPreview.refresh();
      }

      // Update GPU renderer if available
      if (window.gpuRenderer && window.gpuRenderer.refresh) {
        console.log("Refreshing GPU renderer...");
        window.gpuRenderer.refresh();
      }

      // Trigger canvas refresh events
      const canvas = document.getElementById("gpu-canvas");
      if (canvas) {
        // Dispatch custom events that might trigger updates
        canvas.dispatchEvent(new CustomEvent('shaderUpdated'));
        canvas.dispatchEvent(new CustomEvent('forceRefresh'));
      }

      console.log("✅ Preview systems updated");
    } catch (error) {
      console.warn("Preview system update failed:", error);
      window.errorHandler?.handleError(error, { 
        component: 'preview-system-update'
      });
    }
  }

  async reinitializeRenderingPipeline() {
    console.log("🔄 Reinitializing rendering pipeline...");

    try {
      // Method 1: Force GPU device recreation
      if (window.gpuDevice) {
        console.log("Destroying existing GPU device...");
        if (window.gpuDevice.destroy) {
          window.gpuDevice.destroy();
        }
        window.gpuDevice = null;
      }

      // Method 2: Reset render pipelines
      if (window.renderPipeline) {
        console.log("Clearing render pipeline...");
        window.renderPipeline = null;
      }

      // Method 3: Force canvas context recreation
      const canvas = document.getElementById("gpu-canvas");
      if (canvas) {
        console.log("Recreating canvas context...");
        
        // Get new WebGPU context
        if (typeof window.initWebGPU === "function") {
          const newDevice = await window.initWebGPU(canvas);
          if (newDevice) {
            console.log("Canvas context recreated successfully");
          }
        }
      }

      // Method 4: Force texture recreation
      if (window.textureManager && typeof window.textureManager.recreateAll === "function") {
        console.log("Recreating textures...");
        await window.textureManager.recreateAll();
      }

      // Method 5: Reset shader modules
      if (window.shaderModule) {
        console.log("Clearing shader modules...");
        window.shaderModule = null;
      }

      // Method 6: Force buffer recreation
      const bufferObjects = ['uniformBuffer', 'vertexBuffer', 'indexBuffer'];
      for (const bufferName of bufferObjects) {
        if (window[bufferName]) {
          console.log(`Clearing ${bufferName}...`);
          if (window[bufferName].destroy) {
            window[bufferName].destroy();
          }
          window[bufferName] = null;
        }
      }

      // Method 7: Force a complete render cycle
      if (typeof window.render === "function") {
        console.log("Forcing render cycle...");
        await window.render();
      }

      // Method 8: Force preview renderer reinitialization
      if (window.previewRenderer && typeof window.previewRenderer.reinitialize === "function") {
        console.log("Reinitializing preview renderer...");
        await window.previewRenderer.reinitialize();
      }

      console.log("✅ Rendering pipeline reinitialization completed");
      return true;
    } catch (error) {
      console.warn("Rendering pipeline reinitialization failed:", error);
      window.errorHandler?.handleError(error, { 
        component: 'rendering-pipeline-reinitialization'
      });
      return false;
    }
  }

  async recomputeNodePreviews() {
    console.log("🔄 Recomputing node previews with rendering...");

    try {
      // Method 1: Ensure rendering pipeline is ready
      await new Promise(resolve => setTimeout(resolve, 100));

      // Method 2: Force a full render before computing previews
      if (typeof window.render === "function") {
        console.log("Pre-render to initialize GPU state...");
        await window.render();
        await window.render(); // Double render to ensure stability
      }

      // Method 3: Simulate canvas interaction to trigger preview system
      console.log("Simulating canvas interaction...");
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
        console.log("Force rendering thumbnails for all nodes...");
        
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
            console.warn(`Failed to render preview for node ${node.id}:`, error);
          }
        }
      }

      // Method 5: Force recomputation through preview system
      if (this.editor && this.editor.previewSystem) {
        console.log("Triggering preview system recomputation...");
        
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
        console.log("Triggering preview computer...");
        if (typeof window.previewComputer.recomputeAll === "function") {
          await window.previewComputer.recomputeAll();
        }
        if (typeof window.previewComputer.renderAll === "function") {
          await window.previewComputer.renderAll();
        }
      }

      // Method 7: Force parameter panel updates for restored parameters
      console.log("Updating parameter panels...");
      if (typeof window.updateParameterPanel === "function") {
        window.updateParameterPanel();
      }
      
      // Trigger parameter binding system updates
      if (window.parameterBindingSystem && typeof window.parameterBindingSystem.updateAll === "function") {
        window.parameterBindingSystem.updateAll();
      }

      // Method 8: Simulate connection events to trigger recomputation
      if (this.graph && this.graph.connections) {
        console.log("Simulating connection events to trigger preview updates...");
        
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
            console.warn(`Failed to trigger connection event for connection:`, error);
          }
        }
      }

      // Method 9: Force redraw with preview updates multiple times
      if (this.editor) {
        console.log("Forcing editor redraw with preview updates...");
        
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
            console.log(`Calling ${funcName}...`);
            await window[funcName]();
          } catch (error) {
            console.warn(`${funcName} failed:`, error);
          }
        }
      }

      // Method 11: Final canvas interaction and render simulation
      if (canvas) {
        console.log("Final canvas interaction and render simulation...");
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

      console.log("✅ Node preview recomputation with rendering completed");
    } catch (error) {
      console.warn("Node preview recomputation failed:", error);
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
          version: 2,
        }),
      );

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

  createBackup(reason = "manual") {
    try {
      const backups = this.getBackups();
      const projectData = this.exportProject();

      const backup = {
        id: this.generateId(),
        data: projectData,
        timestamp: Date.now(),
        reason: reason,
        nodeCount: projectData.nodes.length,
        connectionCount: projectData.connections.length,
      };

      backups.unshift(backup);

      // Keep only recent backups
      if (backups.length > this.maxBackups) {
        backups.splice(this.maxBackups);
      }

      localStorage.setItem(this.backupsKey, JSON.stringify(backups));
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'backup-creation',
        reason
      });
    }
  }

  getBackups() {
    try {
      const stored = localStorage.getItem(this.backupsKey);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'backup-retrieval'
      });
      return [];
    }
  }

  async restoreBackup(backupId) {
    try {
      const backups = this.getBackups();
      const backup = backups.find((b) => b.id === backupId);

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
    }
  }

  // =============================================================================
  // AUTO-SAVE SYSTEM
  // =============================================================================

  setupAutoSave() {
    try {
      // Auto-save interval
      setInterval(() => {
        if (this.hasUnsavedChanges && this.shouldAutoSave()) {
          this.saveToLocal();
          this.createBackup("autosave");
        }
      }, this.autosaveInterval);

      // Mark changes when graph is modified
      const originalOnChange = this.updateCallback;
      this.updateCallback = (...args) => {
        this.hasUnsavedChanges = true;
        return originalOnChange(...args);
      };
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
      
      // Don't autosave if it's the same as what's already saved
      const currentData = this.exportProject();
      const stored = localStorage.getItem(this.autosaveKey);
      
      if (stored) {
        try {
          const { data: storedData } = JSON.parse(stored);
          // Simple comparison - if node count is the same, probably the same project
          if (storedData && 
              storedData.nodes && 
              storedData.nodes.length === currentData.nodes.length &&
              storedData.connections &&
              storedData.connections.length === currentData.connections.length) {
            return false; // Don't save if it looks like the same content
          }
        } catch (e) {
          // If we can't parse stored data, go ahead and save
        }
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
        pan: { x: vp.panX || 0, y: vp.panY || 0 },
        zoom: vp.zoom || 1,
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

    console.log("Nodes imported with new IDs:", this.graph.nodes.map(n => ({ 
      id: n.id, 
      type: n.type 
    })));
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

    console.log("Connections imported with remapped IDs");
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
        console.warn('TimelineManager not available for import');
        return;
      }

      window.timelineManager.fromJSON(timelineData);
      console.log('Timeline data imported successfully');
    } catch (error) {
      console.error('Failed to import timeline data:', error);
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
        console.warn('MIDIParameterBinding not available for import');
        return;
      }

      window.midiBinding.deserialize(midiData);
      console.log('MIDI bindings imported successfully');
    } catch (error) {
      console.error('Failed to import MIDI bindings:', error);
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
        vp.panX = viewportData.pan.x || 0;
        vp.panY = viewportData.pan.y || 0;
      }
      if (viewportData.zoom) {
        vp.zoom = viewportData.zoom;
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

      // Version compatibility check
      if (data.version && data.version > 2) {
        console.warn(
          "Loading project from newer version - some features may not work correctly",
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
        version: 2,
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

      console.log(`[${type.toUpperCase()}] ${message}`);
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