/**
 * ResourceTracker - Centralized GPU resource management for nodes
 *
 * Tracks all GPU resources (textures, buffers, samplers) associated with a node
 * and provides automatic cleanup to prevent memory leaks.
 */

export class ResourceTracker {
  constructor(nodeId) {
    this.nodeId = nodeId;

    // Track different resource types
    this.textures = new Set();
    this.buffers = new Set();
    this.samplers = new Set();
    this.bindGroups = new Set();
    this.bindGroupLayouts = new Set();
    this.pipelines = new Set();

    // Track metadata
    this.createdAt = Date.now();
    this.destroyed = false;

    // Track resource sizes for debugging/monitoring
    this.stats = {
      textureMemory: 0,
      bufferMemory: 0,
      totalResources: 0
    };
  }

  /**
   * Track a texture resource
   * @param {GPUTexture} texture - The texture to track
   * @param {Object} metadata - Optional metadata (width, height, format)
   */
  trackTexture(texture, metadata = {}) {
    if (!texture || this.destroyed) return;

    this.textures.add(texture);

    // Calculate approximate memory usage
    const { width = 512, height = 512, format = 'rgba8unorm' } = metadata;
    const bytesPerPixel = this._getBytesPerPixel(format);
    const memoryBytes = width * height * bytesPerPixel;
    this.stats.textureMemory += memoryBytes;
    this.stats.totalResources++;

    // Store metadata on texture for debugging
    texture.__resourceTrackerMetadata = {
      nodeId: this.nodeId,
      trackedAt: Date.now(),
      ...metadata
    };
  }

  /**
   * Track a buffer resource
   * @param {GPUBuffer} buffer - The buffer to track
   * @param {number} size - Size in bytes
   */
  trackBuffer(buffer, size = 0) {
    if (!buffer || this.destroyed) return;

    this.buffers.add(buffer);
    this.stats.bufferMemory += size;
    this.stats.totalResources++;

    buffer.__resourceTrackerMetadata = {
      nodeId: this.nodeId,
      trackedAt: Date.now(),
      size
    };
  }

  /**
   * Track a sampler resource
   * @param {GPUSampler} sampler - The sampler to track
   */
  trackSampler(sampler) {
    if (!sampler || this.destroyed) return;
    this.samplers.add(sampler);
    this.stats.totalResources++;
  }

  /**
   * Track a bind group
   * @param {GPUBindGroup} bindGroup - The bind group to track
   */
  trackBindGroup(bindGroup) {
    if (!bindGroup || this.destroyed) return;
    this.bindGroups.add(bindGroup);
  }

  /**
   * Track a bind group layout
   * @param {GPUBindGroupLayout} layout - The layout to track
   */
  trackBindGroupLayout(layout) {
    if (!layout || this.destroyed) return;
    this.bindGroupLayouts.add(layout);
  }

  /**
   * Track a pipeline
   * @param {GPUComputePipeline|GPURenderPipeline} pipeline - The pipeline to track
   */
  trackPipeline(pipeline) {
    if (!pipeline || this.destroyed) return;
    this.pipelines.add(pipeline);
  }

  /**
   * Untrack a specific texture (useful for manual cleanup)
   * @param {GPUTexture} texture - The texture to untrack
   */
  untrackTexture(texture) {
    if (this.textures.has(texture)) {
      const metadata = texture.__resourceTrackerMetadata;
      if (metadata) {
        const { width = 512, height = 512, format = 'rgba8unorm' } = metadata;
        const bytesPerPixel = this._getBytesPerPixel(format);
        const memoryBytes = width * height * bytesPerPixel;
        this.stats.textureMemory -= memoryBytes;
      }
      this.textures.delete(texture);
      this.stats.totalResources--;
    }
  }

  /**
   * Untrack a specific buffer
   * @param {GPUBuffer} buffer - The buffer to untrack
   */
  untrackBuffer(buffer) {
    if (this.buffers.has(buffer)) {
      const metadata = buffer.__resourceTrackerMetadata;
      if (metadata && metadata.size) {
        this.stats.bufferMemory -= metadata.size;
      }
      this.buffers.delete(buffer);
      this.stats.totalResources--;
    }
  }

  /**
   * Destroy all tracked resources
   * @returns {Object} Cleanup statistics
   */
  destroy() {
    if (this.destroyed) {

      return this.getStats();
    }

    const startTime = performance.now();
    let destroyedCount = 0;
    let errorCount = 0;

    // Destroy textures
    for (const texture of this.textures) {
      try {
        if (texture && typeof texture.destroy === 'function') {
          texture.destroy();
          destroyedCount++;
        }
      } catch {

        errorCount++;
      }
    }

    // Destroy buffers
    for (const buffer of this.buffers) {
      try {
        if (buffer && typeof buffer.destroy === 'function') {
          buffer.destroy();
          destroyedCount++;
        }
      } catch {

        errorCount++;
      }
    }

    // Samplers don't need explicit destruction (managed by device)
    // Same for bind groups, layouts, and pipelines

    // Clear all sets
    this.textures.clear();
    this.buffers.clear();
    this.samplers.clear();
    this.bindGroups.clear();
    this.bindGroupLayouts.clear();
    this.pipelines.clear();

    this.destroyed = true;
    const duration = performance.now() - startTime;

    const stats = {
      ...this.getStats(),
      destroyedCount,
      errorCount,
      duration: duration.toFixed(2) + 'ms'
    };

    return stats;
  }

  /**
   * Get current resource statistics
   * @returns {Object} Resource statistics
   */
  getStats() {
    return {
      nodeId: this.nodeId,
      textures: this.textures.size,
      buffers: this.buffers.size,
      samplers: this.samplers.size,
      bindGroups: this.bindGroups.size,
      pipelines: this.pipelines.size,
      textureMemoryMB: (this.stats.textureMemory / (1024 * 1024)).toFixed(2),
      bufferMemoryMB: (this.stats.bufferMemory / (1024 * 1024)).toFixed(2),
      totalMemoryMB: ((this.stats.textureMemory + this.stats.bufferMemory) / (1024 * 1024)).toFixed(2),
      totalResources: this.stats.totalResources,
      destroyed: this.destroyed,
      lifetimeMs: Date.now() - this.createdAt
    };
  }

  /**
   * Check if tracker has any resources
   * @returns {boolean}
   */
  hasResources() {
    return this.textures.size > 0 ||
           this.buffers.size > 0 ||
           this.samplers.size > 0 ||
           this.bindGroups.size > 0 ||
           this.pipelines.size > 0;
  }

  /**
   * Get bytes per pixel for a texture format
   * @private
   */
  _getBytesPerPixel(format) {
    const formatMap = {
      'rgba8unorm': 4,
      'rgba8snorm': 4,
      'rgba8uint': 4,
      'rgba8sint': 4,
      'rgba16float': 8,
      'rgba32float': 16,
      'r32float': 4,
      'rg32float': 8,
      'bgra8unorm': 4
    };
    return formatMap[format] || 4; // Default to 4 bytes
  }
}

/**
 * Global resource tracker registry
 * Maps node IDs to their resource trackers
 */
export class ResourceTrackerRegistry {
  constructor() {
    this.trackers = new Map();
  }

  /**
   * Get or create a resource tracker for a node
   * @param {string} nodeId - Node ID
   * @returns {ResourceTracker}
   */
  getOrCreate(nodeId) {
    if (!this.trackers.has(nodeId)) {
      this.trackers.set(nodeId, new ResourceTracker(nodeId));
    }
    return this.trackers.get(nodeId);
  }

  /**
   * Get an existing tracker
   * @param {string} nodeId - Node ID
   * @returns {ResourceTracker|undefined}
   */
  get(nodeId) {
    return this.trackers.get(nodeId);
  }

  /**
   * Destroy and remove a tracker
   * @param {string} nodeId - Node ID
   * @returns {Object|null} Cleanup statistics
   */
  destroy(nodeId) {
    const tracker = this.trackers.get(nodeId);
    if (tracker) {
      const stats = tracker.destroy();
      this.trackers.delete(nodeId);
      return stats;
    }
    return null;
  }

  /**
   * Destroy all trackers
   * @returns {Object} Overall cleanup statistics
   */
  destroyAll() {
    const stats = {
      totalNodes: this.trackers.size,
      totalTextures: 0,
      totalBuffers: 0,
      totalMemoryMB: 0
    };

    for (const [nodeId, tracker] of this.trackers) {
      const nodeStats = tracker.destroy();
      stats.totalTextures += parseInt(nodeStats.textures) || 0;
      stats.totalBuffers += parseInt(nodeStats.buffers) || 0;
      stats.totalMemoryMB += parseFloat(nodeStats.totalMemoryMB) || 0;
    }

    this.trackers.clear();
    stats.totalMemoryMB = stats.totalMemoryMB.toFixed(2);

    return stats;
  }

  /**
   * Get statistics for all trackers
   * @returns {Array} Array of statistics objects
   */
  getAllStats() {
    const stats = [];
    for (const tracker of this.trackers.values()) {
      stats.push(tracker.getStats());
    }
    return stats;
  }

  /**
   * Get total memory usage across all nodes
   * @returns {Object} Memory statistics
   */
  getTotalMemoryUsage() {
    let totalTextureMemory = 0;
    let totalBufferMemory = 0;
    let totalResources = 0;

    for (const tracker of this.trackers.values()) {
      const stats = tracker.getStats();
      totalTextureMemory += parseFloat(stats.textureMemoryMB) || 0;
      totalBufferMemory += parseFloat(stats.bufferMemoryMB) || 0;
      totalResources += tracker.stats.totalResources || 0;
    }

    return {
      textureMemoryMB: totalTextureMemory.toFixed(2),
      bufferMemoryMB: totalBufferMemory.toFixed(2),
      totalMemoryMB: (totalTextureMemory + totalBufferMemory).toFixed(2),
      totalResources,
      totalNodes: this.trackers.size
    };
  }
}

// Create global registry instance
export const globalResourceRegistry = new ResourceTrackerRegistry();
