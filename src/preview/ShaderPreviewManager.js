// src/preview/ShaderPreviewManager.js
// Main coordinator for real-time shader preview with GPU compute and throttling

import { PreviewThrottler } from './PreviewThrottler.js';
import { GPUPreviewRenderer } from './GPUPreviewRenderer.js';

export class ShaderPreviewManager {
  constructor(editor, device, format) {
    this.editor = editor;
    this.device = device;
    this.format = format;

    // Initialize subsystems
    this.throttler = new PreviewThrottler();
    this.gpuRenderer = new GPUPreviewRenderer(device, format);

    // Preview mode settings
    this.enableGPUPreview = true;  // Use GPU for previews
    this.enableCPUReadback = true; // Readback to CPU for thumbnails
    this.previewSize = 128;        // Default preview size

    // Track nodes pending preview update
    this.pendingNodes = new Set();

    // Cache for compiled preview shaders
    this.shaderCache = new Map();

    console.log('[ShaderPreviewManager] Initialized');
  }

  /**
   * Request preview update for a node
   * @param {object} node - The node to preview
   * @param {boolean} immediate - If true, bypass throttling
   */
  requestNodePreview(node, immediate = false) {
    if (!node || !node.id) {
      console.warn('[ShaderPreviewManager] Invalid node for preview');
      return;
    }

    this.pendingNodes.add(node.id);

    this.throttler.requestUpdate(() => {
      this.updatePendingPreviews();
    }, immediate);
  }

  /**
   * Request preview updates for multiple nodes
   * @param {Array<object>} nodes - Nodes to preview
   * @param {boolean} immediate - If true, bypass throttling
   */
  requestNodesPreviews(nodes, immediate = false) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return;
    }

    for (const node of nodes) {
      if (node && node.id) {
        this.pendingNodes.add(node.id);
      }
    }

    this.throttler.requestUpdate(() => {
      this.updatePendingPreviews();
    }, immediate);
  }

  /**
   * Update all pending node previews
   */
  async updatePendingPreviews() {
    if (this.pendingNodes.size === 0) {
      return;
    }

    const nodeIds = Array.from(this.pendingNodes);
    this.pendingNodes.clear();

    console.log(`[ShaderPreviewManager] Updating ${nodeIds.length} node previews`);

    for (const nodeId of nodeIds) {
      const node = this.editor.graph?.nodes?.find(n => n.id === nodeId);

      if (!node) {
        console.warn(`[ShaderPreviewManager] Node ${nodeId} not found`);
        continue;
      }

      try {
        await this.updateNodePreview(node);
      } catch (error) {
        console.error(`[ShaderPreviewManager] Failed to update preview for ${nodeId}:`, error);
      }
    }
  }

  /**
   * Update preview for a single node
   * @param {object} node - The node to preview
   */
  async updateNodePreview(node) {
    if (!this.enableGPUPreview) {
      // Fall back to existing preview system
      if (this.editor.previewSystem) {
        this.editor.previewSystem.generateNodePreview(node);
      }
      return;
    }

    try {
      // For compute nodes, use their output texture directly
      if (this.isComputeNode(node)) {
        await this.updateComputeNodePreview(node);
        return;
      }

      // For fragment nodes, compile and render
      await this.updateFragmentNodePreview(node);
    } catch (error) {
      console.error(`[ShaderPreviewManager] Error updating preview for ${node.id}:`, error);

      // Fall back to CPU preview on error
      if (this.editor.previewSystem) {
        this.editor.previewSystem.generateNodePreview(node);
      }
    }
  }

  /**
   * Check if a node is a compute node
   * @param {object} node - The node to check
   * @returns {boolean}
   */
  isComputeNode(node) {
    const computeNodeTypes = [
      'noise', 'blur', 'particles', 'feedback',
      'reactiondiffusion', 'fluidsim', 'cellular'
    ];

    return computeNodeTypes.includes(node.kind?.toLowerCase());
  }

  /**
   * Update preview for a compute node
   * @param {object} node - The compute node
   */
  async updateComputeNodePreview(node) {
    const computeExecutor = window.computeExecutor;

    if (!computeExecutor || !computeExecutor.computeTextures) {
      console.warn('[ShaderPreviewManager] ComputeExecutor not available');
      return;
    }

    const computeInfo = computeExecutor.computeTextures.get(node.id);

    if (!computeInfo || !computeInfo.texture) {
      console.warn(`[ShaderPreviewManager] No compute texture for ${node.id}`);
      return;
    }

    if (this.enableCPUReadback) {
      // Readback compute texture to CPU for thumbnail
      try {
        const pixels = await this.readbackComputeTexture(computeInfo.texture);
        const imageData = this.gpuRenderer.pixelsToImageData(pixels, computeInfo.texture.width);

        // Create canvas from ImageData
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        node.__thumb = canvas;
      } catch (error) {
        console.error(`[ShaderPreviewManager] Failed to readback compute texture:`, error);
      }
    } else {
      // Just mark that we have a GPU texture (no CPU readback)
      node.__gpuPreview = computeInfo;
    }
  }

  /**
   * Readback a compute texture to CPU
   * @param {GPUTexture} texture - The texture to readback
   * @returns {Promise<Uint8Array>} Pixel data
   */
  async readbackComputeTexture(texture) {
    const size = texture.width;
    const bytesPerRow = Math.ceil((size * 4) / 256) * 256;
    const bufferSize = bytesPerRow * size;

    const buffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: 'compute-texture-readback'
    });

    const encoder = this.device.createCommandEncoder({
      label: 'compute-texture-readback-encoder'
    });

    encoder.copyTextureToBuffer(
      { texture },
      { buffer, bytesPerRow },
      { width: size, height: size, depthOrArrayLayers: 1 }
    );

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone?.();

    await buffer.mapAsync(GPUMapMode.READ);
    const mappedRange = buffer.getMappedRange();

    // Copy data with row padding handled
    const pixels = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y++) {
      const srcOffset = y * bytesPerRow;
      const dstOffset = y * size * 4;
      const rowData = new Uint8Array(mappedRange, srcOffset, size * 4);
      pixels.set(rowData, dstOffset);
    }

    buffer.unmap();
    buffer.destroy();

    return pixels;
  }

  /**
   * Update preview for a fragment shader node
   * @param {object} node - The fragment node
   */
  async updateFragmentNodePreview(node) {
    // This requires compiling a shader for the node and rendering it
    // For now, fall back to existing preview system
    // TODO: Implement fragment shader preview compilation

    if (this.editor.previewSystem) {
      this.editor.previewSystem.generateNodePreview(node);
    }
  }

  /**
   * Set preview mode (enable/disable GPU preview and CPU readback)
   * @param {object} options - Preview mode options
   */
  setPreviewMode(options = {}) {
    if (options.enableGPUPreview !== undefined) {
      this.enableGPUPreview = options.enableGPUPreview;
      console.log(`[ShaderPreviewManager] GPU preview: ${this.enableGPUPreview}`);
    }

    if (options.enableCPUReadback !== undefined) {
      this.enableCPUReadback = options.enableCPUReadback;
      console.log(`[ShaderPreviewManager] CPU readback: ${this.enableCPUReadback}`);
    }

    if (options.previewSize !== undefined) {
      this.previewSize = options.previewSize;
      console.log(`[ShaderPreviewManager] Preview size: ${this.previewSize}`);
    }
  }

  /**
   * Begin interaction (drag, edit, compile)
   * @param {string} type - Interaction type
   */
  beginInteraction(type) {
    switch (type) {
      case 'drag':
        this.throttler.beginDrag();
        break;
      case 'edit':
        this.throttler.beginEdit();
        break;
      case 'compile':
        this.throttler.beginCompile();
        break;
      default:
        console.warn(`[ShaderPreviewManager] Unknown interaction type: ${type}`);
    }
  }

  /**
   * End interaction
   * @param {string} type - Interaction type
   */
  endInteraction(type) {
    switch (type) {
      case 'drag':
        this.throttler.endDrag();
        break;
      case 'edit':
        this.throttler.endEdit();
        break;
      case 'compile':
        this.throttler.endCompile();
        break;
      default:
        console.warn(`[ShaderPreviewManager] Unknown interaction type: ${type}`);
    }

    // Trigger immediate update after interaction ends
    this.requestNodesPreviews(
      Array.from(this.pendingNodes).map(id =>
        this.editor.graph?.nodes?.find(n => n.id === id)
      ).filter(Boolean),
      true // immediate
    );
  }

  /**
   * Clear all preview caches
   */
  clearCache() {
    this.gpuRenderer.clearCache();
    this.shaderCache.clear();
    console.log('[ShaderPreviewManager] Cleared all caches');
  }

  /**
   * Dispose of the preview manager
   */
  dispose() {
    this.throttler.dispose();
    this.gpuRenderer.dispose();
    this.shaderCache.clear();
    this.pendingNodes.clear();
    console.log('[ShaderPreviewManager] Disposed');
  }
}
