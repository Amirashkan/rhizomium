// src/preview/ShaderPreviewManager.js
// Main coordinator for real-time shader preview with GPU compute and throttling

import { PreviewThrottler } from './PreviewThrottler.js';
import { GPUPreviewRenderer } from './GPUPreviewRenderer.js';
import { buildWGSL } from '../codegen/glslBuilder.js';
import { shaderModuleCache, hashWGSL } from '../gpu/ShaderModuleCache.js';

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

    // Cache for compiled preview shaders (nodeId -> shader code for change detection)
    this.shaderCache = new Map();
    
    // PERFORMANCE: Use centralized shader module cache to avoid recompiling identical WGSL
    this.shaderModuleCache = shaderModuleCache;
  }

  /**
   * Request preview update for a node
   * @param {object} node - The node to preview
   * @param {boolean} immediate - If true, bypass throttling
   */
  requestNodePreview(node, immediate = false) {
    if (!node || !node.id) {
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

    for (const nodeId of nodeIds) {
      const node = this.editor.graph?.nodes?.find(n => n.id === nodeId);

      if (!node) {
        continue;
      }

      try {
        await this.updateNodePreview(node);
      } catch (error) {

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
      return;
    }

    const computeInfo = computeExecutor.computeTextures.get(node.id);

    if (!computeInfo || !computeInfo.texture) {
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
    try {
      // Create a temporary graph with just this node for preview
      const previewGraph = this.createPreviewGraph(node);

      // Get cache key
      const cacheKey = this.getNodeCacheKey(node);

      // Check if shader is cached and still valid
      const cached = this.shaderCache.get(cacheKey);
      if (cached && cached.pipeline) {
        // Render using cached pipeline
        await this.renderFragmentPreview(node, cached.pipeline, cached.bindGroups);
        return;
      }

      // Compile shader for this node
      const shaderResult = buildWGSL(previewGraph);

      if (!shaderResult || !shaderResult.wgsl) {
        this.fallbackToLegacyPreview(node);
        return;
      }

      // Create render pipeline
      const pipeline = await this.createPreviewPipeline(shaderResult.wgsl, node.id);

      if (!pipeline) {
        this.fallbackToLegacyPreview(node);
        return;
      }

      // Create bind groups for uniforms and textures
      const bindGroups = this.createPreviewBindGroups(node, shaderResult.uniformManager);

      // Cache the compiled shader
      this.shaderCache.set(cacheKey, {
        pipeline,
        bindGroups,
        uniformManager: shaderResult.uniformManager,
        timestamp: Date.now()
      });

      // Render the preview
      await this.renderFragmentPreview(node, pipeline, bindGroups);

    } catch (error) {

      this.fallbackToLegacyPreview(node);
    }
  }

  /**
   * Create a minimal graph containing just this node for preview
   * @param {object} node - The node to preview
   * @returns {object} Preview graph
   */
  createPreviewGraph(node) {
    // Create a minimal graph with UV input and this node
    return {
      nodes: [
        {
          id: 'preview_uv',
          kind: 'UV',
          label: 'UV',
          x: 0,
          y: 0
        },
        {
          ...node,
          x: 100,
          y: 0
        },
        {
          id: 'preview_output',
          kind: 'Output',
          label: 'Output',
          x: 200,
          y: 0
        }
      ],
      connections: [
        // Connect UV to node's first input (if it has inputs)
        ...(node.inputs > 0 ? [{
          fromNode: 'preview_uv',
          fromPin: 'UV',
          toNode: node.id,
          toPin: node.pinsIn?.[0] || 'UV'
        }] : []),
        // Connect node to output
        {
          fromNode: node.id,
          fromPin: node.pinsOut?.[0] || 'Color',
          toNode: 'preview_output',
          toPin: 'Color'
        }
      ]
    };
  }

  /**
   * Create render pipeline for preview
   * @param {string} wgsl - WGSL shader source
   * @param {string} nodeId - Node ID for labeling
   * @returns {Promise<GPURenderPipeline>}
   */
  async createPreviewPipeline(wgsl, nodeId) {
    try {
      // PERFORMANCE: Use shader module cache to avoid recompiling identical WGSL
      // CRITICAL FIX: Cache is now device-specific - pass device to get/set
      const wgslHash = hashWGSL(wgsl, false);
      let shaderModule = this.shaderModuleCache.get(this.device, wgslHash);
      
      if (!shaderModule) {
        // Create shader module if not cached
        shaderModule = this.device.createShaderModule({
          label: `preview-shader-${nodeId}`,
          code: wgsl
        });
        this.shaderModuleCache.set(this.device, wgslHash, shaderModule);
      }

      // Check for compilation errors
      const compilationInfo = await shaderModule.getCompilationInfo();
      const errors = compilationInfo.messages.filter(m => m.type === 'error');

      if (errors.length > 0) {

        return null;
      }

      const pipeline = this.device.createRenderPipeline({
        label: `preview-pipeline-${nodeId}`,
        layout: 'auto',
        vertex: {
          module: shaderModule,
          entryPoint: 'vertex_main',
          buffers: []
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fragment_main',
          targets: [{
            format: this.format
          }]
        },
        primitive: {
          topology: 'triangle-list'
        }
      });

      return pipeline;
    } catch (error) {

      return null;
    }
  }

  /**
   * Create bind groups for preview rendering
   * @param {object} node - The node being previewed
   * @param {object} uniformManager - Uniform manager from shader compilation
   * @returns {Array<GPUBindGroup>}
   */
  createPreviewBindGroups(node, uniformManager) {
    const bindGroups = [];

    try {
      // Create uniform buffer if needed
      if (uniformManager && uniformManager.getSize() > 0) {
        const uniformBuffer = this.device.createBuffer({
          size: Math.max(uniformManager.getSize(), 16), // Minimum 16 bytes
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: `preview-uniforms-${node.id}`
        });

        // Write uniform data
        const uniformData = uniformManager.getArrayBuffer();
        if (uniformData && uniformData.byteLength > 0) {
          this.device.queue.writeBuffer(uniformBuffer, 0, uniformData);
        }

        // Create bind group with uniforms
        // Note: This is a simplified version - may need adjustment based on actual shader layout
        const bindGroup = this.device.createBindGroup({
          label: `preview-bindgroup-${node.id}`,
          layout: this.device.createBindGroupLayout({
            entries: [{
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
              buffer: { type: 'uniform' }
            }]
          }),
          entries: [{
            binding: 0,
            resource: { buffer: uniformBuffer }
          }]
        });

        bindGroups.push(bindGroup);
      }
    } catch (error) {

    }

    return bindGroups;
  }

  /**
   * Render fragment preview to texture and optionally readback
   * @param {object} node - The node being previewed
   * @param {GPURenderPipeline} pipeline - Render pipeline
   * @param {Array<GPUBindGroup>} bindGroups - Bind groups
   */
  async renderFragmentPreview(node, pipeline, bindGroups) {
    try {
      // Render to preview texture
      const previewInfo = this.gpuRenderer.renderToPreviewTexture(
        pipeline,
        bindGroups || [],
        node.id,
        { size: this.previewSize }
      );

      // Readback to CPU for thumbnail if enabled
      if (this.enableCPUReadback) {
        const pixels = await this.gpuRenderer.readbackPreviewTexture(node.id);
        const imageData = this.gpuRenderer.pixelsToImageData(pixels, this.previewSize);

        // Create canvas from ImageData
        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(imageData, 0, 0);

        node.__thumb = canvas;
      } else {
        // Just mark that we have a GPU texture (no CPU readback)
        node.__gpuPreview = previewInfo;
      }
    } catch (error) {

      this.fallbackToLegacyPreview(node);
    }
  }

  /**
   * Get cache key for node (includes parameters for invalidation)
   * @param {object} node - The node
   * @returns {string} Cache key
   */
  getNodeCacheKey(node) {
    // Include node kind and parameter values in cache key
    const params = JSON.stringify(node.props || {});
    return `${node.id}_${node.kind}_${params}`;
  }

  /**
   * Fall back to legacy preview system
   * @param {object} node - The node
   */
  fallbackToLegacyPreview(node) {
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
    }

    if (options.enableCPUReadback !== undefined) {
      this.enableCPUReadback = options.enableCPUReadback;
    }

    if (options.previewSize !== undefined) {
      this.previewSize = options.previewSize;
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
   * Destroy preview texture for a specific node
   * @param {string} nodeId - Node ID
   */
  destroyPreviewTexture(nodeId) {
    if (this.gpuRenderer && typeof this.gpuRenderer.destroyPreviewTexture === 'function') {
      this.gpuRenderer.destroyPreviewTexture(nodeId);
    }
    this.shaderCache.delete(nodeId);
    this.pendingNodes.delete(nodeId);
  }

  /**
   * Clear all preview caches
   */
  clearCache() {
    this.gpuRenderer.clearCache();
    this.shaderCache.clear();
  }

  /**
   * Dispose of the preview manager
   */
  dispose() {
    this.throttler.dispose();
    this.gpuRenderer.dispose();
    this.shaderCache.clear();
    this.pendingNodes.clear();
  }
}
