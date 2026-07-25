// src/preview/GPUPreviewRenderer.js
// GPU-based shader preview renderer with optional CPU readback

export class GPUPreviewRenderer {
  constructor(device, format) {
    this.device = device;
    this.format = format || 'bgra8unorm';

    // Preview texture cache: nodeId -> { texture, view, sampler, lastUpdate }
    this.previewCache = new Map();

    // Default preview size for node thumbnails
    this.defaultPreviewSize = 256;

    // Readback buffer pool for reuse
    this.readbackBufferPool = [];
    this.maxPoolSize = 5;
  }

  /**
   * Create or get cached preview texture for a node
   * @param {string} nodeId - Node identifier
   * @param {number} size - Texture size (square)
   * @returns {object} Preview texture info
   */
  getOrCreatePreviewTexture(nodeId, size = this.defaultPreviewSize) {
    const cached = this.previewCache.get(nodeId);

    if (cached && cached.texture.width === size) {
      return cached;
    }

    // Destroy old texture if size changed
    if (cached) {
      this.destroyPreviewTexture(nodeId);
    }

    // Create new preview texture
    const texture = this.device.createTexture({
      size: [size, size, 1],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT |
             GPUTextureUsage.TEXTURE_BINDING |
             GPUTextureUsage.COPY_SRC,
      label: `preview-${nodeId}`
    });

    const view = texture.createView();

    const sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    const info = {
      texture,
      view,
      sampler,
      lastUpdate: 0,
      size
    };

    this.previewCache.set(nodeId, info);

    return info;
  }

  /**
   * Render a shader to a preview texture
   * @param {GPURenderPipeline} pipeline - Compiled render pipeline
   * @param {Array<GPUBindGroup>} bindGroups - Bind groups for the shader
   * @param {string} nodeId - Node identifier for caching
   * @param {object} options - Rendering options
   * @returns {object} Preview texture info
   */
  renderToPreviewTexture(pipeline, bindGroups, nodeId, options = {}) {
    const size = options.size || this.defaultPreviewSize;
    const clearColor = options.clearColor || { r: 0, g: 0, b: 0, a: 1 };

    const previewInfo = this.getOrCreatePreviewTexture(nodeId, size);

    const encoder = this.device.createCommandEncoder({
      label: `preview-render-${nodeId}`
    });

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: previewInfo.view,
        clearValue: clearColor,
        loadOp: 'clear',
        storeOp: 'store'
      }]
    });

    renderPass.setPipeline(pipeline);

    // Set all bind groups
    for (let i = 0; i < bindGroups.length; i++) {
      renderPass.setBindGroup(i, bindGroups[i]);
    }

    // Draw fullscreen triangle
    renderPass.draw(3, 1, 0, 0);
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);

    previewInfo.lastUpdate = performance.now();

    return previewInfo;
  }

  /**
   * Readback preview texture data to CPU
   * @param {string} nodeId - Node identifier
   * @param {object} options - Readback options
   * @returns {Promise<Uint8Array>} Pixel data (RGBA)
   */
  async readbackPreviewTexture(nodeId, _options = {}) {
    const previewInfo = this.previewCache.get(nodeId);

    if (!previewInfo) {
      throw new Error(`No preview texture found for node ${nodeId}`);
    }

    const size = previewInfo.size;
    const bytesPerRow = Math.ceil((size * 4) / 256) * 256; // Align to 256 bytes
    const bufferSize = bytesPerRow * size;

    // Get or create readback buffer
    let buffer = this.readbackBufferPool.pop();

    if (!buffer || buffer.size !== bufferSize) {
      buffer?.destroy();
      buffer = this.device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        label: `preview-readback-${nodeId}`
      });
    }

    const encoder = this.device.createCommandEncoder({
      label: `preview-readback-${nodeId}`
    });

    encoder.copyTextureToBuffer(
      { texture: previewInfo.texture },
      { buffer, bytesPerRow },
      { width: size, height: size, depthOrArrayLayers: 1 }
    );

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone?.();

    await buffer.mapAsync(GPUMapMode.READ);
    const mappedRange = buffer.getMappedRange();

    // Copy data before unmapping
    const pixels = new Uint8Array(size * size * 4);

    // Handle padded rows
    for (let y = 0; y < size; y++) {
      const srcOffset = y * bytesPerRow;
      const dstOffset = y * size * 4;
      const rowData = new Uint8Array(mappedRange, srcOffset, size * 4);
      pixels.set(rowData, dstOffset);
    }

    buffer.unmap();

    // Return buffer to pool for reuse
    if (this.readbackBufferPool.length < this.maxPoolSize) {
      this.readbackBufferPool.push(buffer);
    } else {
      buffer.destroy();
    }

    return pixels;
  }

  /**
   * Convert readback pixels to Canvas ImageData
   * @param {Uint8Array} pixels - Pixel data from readback
   * @param {number} size - Texture size
   * @returns {ImageData} Canvas-compatible image data
   */
  pixelsToImageData(pixels, size) {
    return new ImageData(new Uint8ClampedArray(pixels), size, size);
  }

  /**
   * Render preview and readback to Canvas
   * @param {GPURenderPipeline} pipeline - Compiled render pipeline
   * @param {Array<GPUBindGroup>} bindGroups - Bind groups for the shader
   * @param {string} nodeId - Node identifier
   * @param {object} options - Options
   * @returns {Promise<ImageData>} Canvas ImageData
   */
  async renderAndReadback(pipeline, bindGroups, nodeId, options = {}) {
    this.renderToPreviewTexture(pipeline, bindGroups, nodeId, options);
    const pixels = await this.readbackPreviewTexture(nodeId, options);
    const size = options.size || this.defaultPreviewSize;
    return this.pixelsToImageData(pixels, size);
  }

  /**
   * Destroy preview texture for a node
   * @param {string} nodeId - Node identifier
   */
  destroyPreviewTexture(nodeId) {
    const info = this.previewCache.get(nodeId);

    if (info) {
      info.texture.destroy();
      this.previewCache.delete(nodeId);

    }
  }

  /**
   * Clear all cached preview textures
   */
  clearCache() {
    for (const [nodeId, info] of this.previewCache) {
      info.texture.destroy();
    }
    this.previewCache.clear();

  }

  /**
   * Dispose of the renderer and cleanup resources
   */
  dispose() {
    this.clearCache();

    // Destroy readback buffers
    for (const buffer of this.readbackBufferPool) {
      buffer.destroy();
    }
    this.readbackBufferPool = [];
  }
}
