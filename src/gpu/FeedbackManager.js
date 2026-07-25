// src/gpu/FeedbackManager.js

/**
 * FeedbackManager - High-level abstraction for feedback-based compute simulations
 *
 * Manages ping-pong texture systems for simulations like:
 * - Reaction-diffusion patterns
 * - Flow fields
 * - Cellular automata
 * - Fluid dynamics
 *
 * Features:
 * - Automatic ping-pong buffer swapping
 * - State persistence across frames
 * - .reset() to clear state
 * - Texture pooling for efficiency
 */

export class FeedbackManager {
  /**
   * @param {GPUDevice} device - WebGPU device
   * @param {Object} config - Configuration options
   * @param {number} config.width - Texture width
   * @param {number} config.height - Texture height
   * @param {string} config.format - Texture format (default: 'rgba8unorm')
   * @param {boolean} config.enableHistory - Track texture history for playback
   */
  constructor(device, config = {}) {
    this.device = device;
    this.width = config.width || 512;
    this.height = config.height || 512;
    this.format = config.format || 'rgba8unorm';
    this.enableHistory = config.enableHistory || false;

    // Ping-pong textures
    this.textureA = null;  // Read from this
    this.textureB = null;  // Write to this
    this.currentReadTexture = 'A';  // Which texture to read from

    // State tracking
    this.frameCount = 0;
    this.isInitialized = false;
    this.history = [];  // Optional: store snapshots for playback
    this.maxHistorySize = 100;

    // Bind group cache
    this.bindGroupCache = new Map();
  }

  /**
   * Initialize ping-pong textures
   * @param {Function} initializerFn - Optional function to initialize texture data
   */
  async initialize(initializerFn = null) {
    if (this.isInitialized) {

      return;
    }

    // Create texture A
    this.textureA = this.device.createTexture({
      size: [this.width, this.height, 1],
      format: this.format,
      usage: GPUTextureUsage.STORAGE_BINDING |
             GPUTextureUsage.TEXTURE_BINDING |
             GPUTextureUsage.COPY_DST |
             GPUTextureUsage.COPY_SRC
    });

    // Create texture B
    this.textureB = this.device.createTexture({
      size: [this.width, this.height, 1],
      format: this.format,
      usage: GPUTextureUsage.STORAGE_BINDING |
             GPUTextureUsage.TEXTURE_BINDING |
             GPUTextureUsage.COPY_DST |
             GPUTextureUsage.COPY_SRC
    });

    // Initialize with data if provided
    if (initializerFn) {
      await this._initializeWithData(initializerFn);
    } else {
      // Default: clear to black
      await this.reset();
    }

    this.isInitialized = true;
  }

  /**
   * Initialize textures with custom data
   * @param {Function} initializerFn - Function that returns Uint8Array of pixel data
   */
  async _initializeWithData(initializerFn) {
    const pixelData = initializerFn(this.width, this.height);

    // Write to both textures
    this.device.queue.writeTexture(
      { texture: this.textureA },
      pixelData,
      { bytesPerRow: this.width * 4 },
      { width: this.width, height: this.height }
    );

    this.device.queue.writeTexture(
      { texture: this.textureB },
      pixelData,
      { bytesPerRow: this.width * 4 },
      { width: this.width, height: this.height }
    );
  }

  /**
   * Get the current read texture (previous frame)
   * @returns {GPUTexture}
   */
  getReadTexture() {
    return this.currentReadTexture === 'A' ? this.textureA : this.textureB;
  }

  /**
   * Get the current write texture (current frame)
   * @returns {GPUTexture}
   */
  getWriteTexture() {
    return this.currentReadTexture === 'A' ? this.textureB : this.textureA;
  }

  /**
   * Get texture view for reading
   * @returns {GPUTextureView}
   */
  getReadView() {
    return this.getReadTexture().createView();
  }

  /**
   * Get texture view for writing
   * @returns {GPUTextureView}
   */
  getWriteView() {
    return this.getWriteTexture().createView();
  }

  /**
   * Swap ping-pong buffers (call after each frame)
   */
  swap() {
    this.currentReadTexture = this.currentReadTexture === 'A' ? 'B' : 'A';
    this.frameCount++;

    // Optional: record history
    if (this.enableHistory && this.frameCount % 10 === 0) {
      this._recordSnapshot();
    }
  }

  /**
   * Reset feedback state to initial conditions
   * @param {Function} initializerFn - Optional custom initializer
   */
  async reset(initializerFn = null) {
    this.frameCount = 0;
    this.currentReadTexture = 'A';
    this.history = [];

    if (initializerFn) {
      await this._initializeWithData(initializerFn);
    } else {
      // Clear to black
      const clearData = new Uint8Array(this.width * this.height * 4).fill(0);

      this.device.queue.writeTexture(
        { texture: this.textureA },
        clearData,
        { bytesPerRow: this.width * 4 },
        { width: this.width, height: this.height }
      );

      this.device.queue.writeTexture(
        { texture: this.textureB },
        clearData,
        { bytesPerRow: this.width * 4 },
        { width: this.width, height: this.height }
      );
    }

  }

  /**
   * Resize textures (destroys current state)
   * @param {number} width - New width
   * @param {number} height - New height
   */
  async resize(width, height) {
    if (width === this.width && height === this.height) {
      return;
    }

    // Destroy old textures
    this.destroy();

    // Update dimensions
    this.width = width;
    this.height = height;
    this.isInitialized = false;

    // Reinitialize
    await this.initialize();
  }

  /**
   * Record a snapshot of current state (for history/playback)
   */
  _recordSnapshot() {
    if (this.history.length >= this.maxHistorySize) {
      this.history.shift();
    }

    this.history.push({
      frame: this.frameCount,
      texture: this.currentReadTexture,
      timestamp: Date.now()
    });
  }

  /**
   * Get bind group entries for both textures
   * @param {number} readBinding - Binding index for read texture
   * @param {number} writeBinding - Binding index for write texture
   * @returns {Array} Bind group entries
   */
  getBindGroupEntries(readBinding, writeBinding) {
    return [
      {
        binding: readBinding,
        resource: this.getReadView()
      },
      {
        binding: writeBinding,
        resource: this.getWriteView()
      }
    ];
  }

  /**
   * Get statistics about the feedback system
   * @returns {Object} Stats
   */
  getStats() {
    return {
      frameCount: this.frameCount,
      currentRead: this.currentReadTexture,
      currentWrite: this.currentReadTexture === 'A' ? 'B' : 'A',
      resolution: `${this.width}x${this.height}`,
      historySize: this.history.length,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Serialize state for saving
   * @returns {Object} Serialized state
   */
  serialize() {
    return {
      width: this.width,
      height: this.height,
      format: this.format,
      frameCount: this.frameCount,
      currentReadTexture: this.currentReadTexture
    };
  }

  /**
   * Restore from serialized state
   * @param {Object} data - Serialized state
   */
  async deserialize(data) {
    await this.resize(data.width, data.height);
    this.frameCount = data.frameCount || 0;
    this.currentReadTexture = data.currentReadTexture || 'A';
  }

  /**
   * Cleanup GPU resources
   */
  destroy() {
    if (this.textureA) {
      this.textureA.destroy();
      this.textureA = null;
    }

    if (this.textureB) {
      this.textureB.destroy();
      this.textureB = null;
    }

    this.bindGroupCache.clear();
    this.history = [];
    this.isInitialized = false;

  }
}

/**
 * Create a default initializer for reaction-diffusion systems
 * @param {string} pattern - Pattern type ('spots', 'random', 'center', etc.)
 * @returns {Function} Initializer function
 */
export function createReactionDiffusionInitializer(pattern = 'random') {
  return (width, height) => {
    const pixelData = new Uint8Array(width * height * 4);

    // Initialize A channel to 1.0 (chemical A fully present)
    // Initialize B channel to 0.0, with seed regions
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        // A channel (red) - fully populated
        pixelData[idx] = 255;

        // B channel (green) - seed based on pattern
        let isSeed = false;

        switch (pattern) {
          case 'center': {
            const dx = x - width / 2;
            const dy = y - height / 2;
            const dist = Math.sqrt(dx * dx + dy * dy);
            isSeed = dist < width * 0.1;
            break;
          }

          case 'random':
            isSeed = Math.random() < 0.05;
            break;

          case 'spots': {
            const numSpots = 5;
            for (let i = 0; i < numSpots; i++) {
              const sx = (i + 0.5) / numSpots * width;
              const sy = (i % 2 === 0 ? 0.3 : 0.7) * height;
              const d = Math.sqrt((x - sx) ** 2 + (y - sy) ** 2);
              if (d < width * 0.03) {
                isSeed = true;
              }
            }
            break;
          }

          default:
            isSeed = Math.random() < 0.02;
        }

        pixelData[idx + 1] = isSeed ? 64 : 0;  // B channel
        pixelData[idx + 2] = 0;  // Blue unused
        pixelData[idx + 3] = 255;  // Alpha
      }
    }

    return pixelData;
  };
}

/**
 * Create a flow field initializer
 * @param {string} type - Flow field type ('zero', 'vortex', 'turbulence')
 * @returns {Function} Initializer function
 */
export function createFlowFieldInitializer(type = 'zero') {
  return (width, height) => {
    const pixelData = new Uint8Array(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;

        const nx = x / width - 0.5;
        const ny = y / height - 0.5;

        let vx = 0;
        let vy = 0;

        switch (type) {
          case 'vortex':
            vx = -ny;
            vy = nx;
            break;

          case 'turbulence':
            vx = Math.sin(nx * 10) * 0.5;
            vy = Math.cos(ny * 10) * 0.5;
            break;

          case 'zero':
          default:
            vx = 0;
            vy = 0;
        }

        // Encode velocity as color (normalized to 0-255)
        pixelData[idx] = Math.floor((vx + 1) * 127.5);
        pixelData[idx + 1] = Math.floor((vy + 1) * 127.5);
        pixelData[idx + 2] = 0;
        pixelData[idx + 3] = 255;
      }
    }

    return pixelData;
  };
}
