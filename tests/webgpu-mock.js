/**
 * WebGPU Mock for CI Testing
 *
 * Provides a mock implementation of WebGPU APIs for testing compute pipelines
 * in CI environments without real GPU hardware.
 *
 * This mock tracks operations and allows validation of:
 * - Uniform updates
 * - Dispatch dimensions
 * - Texture content
 * - Pipeline creation
 * - Resource cleanup
 */

/**
 * Mock GPU texture that stores pixel data
 */
export class MockGPUTexture {
  constructor(descriptor) {
    this.width = descriptor.size.width || descriptor.size[0];
    this.height = descriptor.size.height || descriptor.size[1];
    this.depth = descriptor.size.depth || descriptor.size[2] || 1;
    this.format = descriptor.format;
    this.usage = descriptor.usage;
    this.dimension = descriptor.dimension || '2d';
    this.mipLevelCount = descriptor.mipLevelCount || 1;
    this.sampleCount = descriptor.sampleCount || 1;

    // Store pixel data (RGBA, 4 bytes per pixel)
    const pixelCount = this.width * this.height * this.depth;
    this.data = new Uint8Array(pixelCount * 4);

    // Initialize with deterministic pattern for testing
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = 0;     // R
      this.data[i + 1] = 0; // G
      this.data[i + 2] = 0; // B
      this.data[i + 3] = 255; // A
    }

    this.destroyed = false;
  }

  createView(descriptor = {}) {
    return new MockGPUTextureView(this, descriptor);
  }

  destroy() {
    this.destroyed = true;
    this.data = null;
  }

  /**
   * Calculate checksum of texture data for validation
   */
  getChecksum() {
    if (!this.data) return 0;

    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      sum = (sum + this.data[i] * (i + 1)) >>> 0;
    }
    return sum;
  }

  /**
   * Simulate compute shader writing to texture
   */
  writeComputeResult(time, params = {}) {
    if (!this.data) return;

    // Simulate deterministic compute output based on time and params
    const scale = params.scale || 1.0;
    const speed = params.speed || 1.0;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = (y * this.width + x) * 4;
        const uv_x = x / this.width;
        const uv_y = y / this.height;

        // Simple deterministic pattern
        const noise = Math.sin((uv_x + time * speed) * scale * 10) *
                      Math.cos((uv_y + time * speed) * scale * 10);
        const value = Math.floor((noise * 0.5 + 0.5) * 255);

        this.data[idx] = value;
        this.data[idx + 1] = value;
        this.data[idx + 2] = value;
        this.data[idx + 3] = 255;
      }
    }
  }
}

/**
 * Mock GPU texture view
 */
export class MockGPUTextureView {
  constructor(texture, descriptor) {
    this.texture = texture;
    this.descriptor = descriptor;
  }
}

/**
 * Mock GPU buffer for uniforms and storage
 */
export class MockGPUBuffer {
  constructor(descriptor) {
    this.size = descriptor.size;
    this.usage = descriptor.usage;
    this.data = new ArrayBuffer(descriptor.size);
    this.destroyed = false;

    // Track write operations for validation
    this.writeHistory = [];
  }

  getMappedRange(offset = 0, size) {
    const actualSize = size || (this.size - offset);
    return new Uint8Array(this.data, offset, actualSize);
  }

  unmap() {
    // Mock implementation
  }

  destroy() {
    this.destroyed = true;
    this.data = null;
  }

  /**
   * Track buffer writes for testing
   */
  writeBuffer(data, offset = 0) {
    const view = new Uint8Array(this.data, offset, data.byteLength);
    view.set(new Uint8Array(data));

    this.writeHistory.push({
      offset,
      size: data.byteLength,
      timestamp: Date.now()
    });
  }
}

/**
 * Mock GPU sampler
 */
export class MockGPUSampler {
  constructor(descriptor) {
    this.descriptor = descriptor;
  }
}

/**
 * Mock GPU bind group layout
 */
export class MockGPUBindGroupLayout {
  constructor(descriptor) {
    this.entries = descriptor.entries;
  }
}

/**
 * Mock GPU bind group
 */
export class MockGPUBindGroup {
  constructor(descriptor) {
    this.layout = descriptor.layout;
    this.entries = descriptor.entries;
  }
}

/**
 * Mock GPU shader module
 */
export class MockGPUShaderModule {
  constructor(descriptor) {
    this.code = descriptor.code;
    this.compilationInfo = {
      messages: []
    };
  }

  getCompilationInfo() {
    return Promise.resolve(this.compilationInfo);
  }
}

/**
 * Mock GPU compute pipeline
 */
export class MockGPUComputePipeline {
  constructor(descriptor) {
    this.layout = descriptor.layout;
    this.compute = descriptor.compute;
    this.dispatchCount = 0;
    this.lastDispatchDimensions = null;
  }

  getBindGroupLayout(_index) {
    return new MockGPUBindGroupLayout({ entries: [] });
  }

  /**
   * Record dispatch for validation
   */
  recordDispatch(x, y, z) {
    this.dispatchCount++;
    this.lastDispatchDimensions = { x, y, z };
  }
}

/**
 * Mock GPU compute pass encoder
 */
export class MockGPUComputePassEncoder {
  constructor(commandEncoder) {
    this.commandEncoder = commandEncoder;
    this.pipeline = null;
    this.bindGroups = new Map();
    this.dispatches = [];
  }

  setPipeline(pipeline) {
    this.pipeline = pipeline;
  }

  setBindGroup(index, bindGroup, dynamicOffsets) {
    this.bindGroups.set(index, { bindGroup, dynamicOffsets });
  }

  dispatchWorkgroups(x, y = 1, z = 1) {
    if (this.pipeline) {
      this.pipeline.recordDispatch(x, y, z);
    }

    this.dispatches.push({ x, y, z });
    this.commandEncoder.dispatchHistory.push({ x, y, z });
  }

  end() {
    // Mock implementation
  }
}

/**
 * Mock GPU command encoder
 */
export class MockGPUCommandEncoder {
  constructor(device) {
    this.device = device;
    this.dispatchHistory = [];
    this.copyHistory = [];
  }

  beginComputePass(_descriptor = {}) {
    return new MockGPUComputePassEncoder(this);
  }

  copyTextureToTexture(source, destination, copySize) {
    this.copyHistory.push({ source, destination, copySize });

    // Actually copy data for testing
    const srcTexture = source.texture || source;
    const dstTexture = destination.texture || destination;

    if (srcTexture.data && dstTexture.data) {
      dstTexture.data.set(srcTexture.data);
    }
  }

  copyBufferToTexture(source, destination, copySize) {
    this.copyHistory.push({ source, destination, copySize });
  }

  finish() {
    return new MockGPUCommandBuffer(this);
  }
}

/**
 * Mock GPU command buffer
 */
export class MockGPUCommandBuffer {
  constructor(encoder) {
    this.encoder = encoder;
  }
}

/**
 * Mock GPU queue
 */
export class MockGPUQueue {
  constructor(device) {
    this.device = device;
    this.submitHistory = [];
  }

  submit(commandBuffers) {
    this.submitHistory.push({
      buffers: commandBuffers,
      timestamp: Date.now()
    });

    // Simulate compute execution
    for (const buffer of commandBuffers) {
      if (buffer.encoder && buffer.encoder.dispatchHistory.length > 0) {
        // Trigger compute writes
        this.device._executeCompute(buffer.encoder);
      }
    }
  }

  writeBuffer(buffer, bufferOffset, data, dataOffset, size) {
    buffer.writeBuffer(data.slice(dataOffset, dataOffset + size), bufferOffset);
  }

  writeTexture(destination, data, _dataLayout, _size) {
    const texture = destination.texture || destination;

    if (texture.data && data) {
      // Copy data to texture
      const bytesToCopy = Math.min(data.length, texture.data.length);
      texture.data.set(new Uint8Array(data.buffer || data, 0, bytesToCopy));
    }
  }
}

/**
 * Mock GPU device
 */
export class MockGPUDevice {
  constructor() {
    this.features = new Set(['timestamp-query']);
    this.limits = {
      maxTextureDimension2D: 8192,
      maxComputeWorkgroupSizeX: 256,
      maxComputeWorkgroupSizeY: 256,
      maxComputeWorkgroupSizeZ: 64,
      maxComputeInvocationsPerWorkgroup: 256,
      maxComputeWorkgroupsPerDimension: 65535
    };
    this.queue = new MockGPUQueue(this);

    // Track created resources
    this.textures = [];
    this.buffers = [];
    this.pipelines = [];

    // Current compute state for simulation
    this.currentTime = 0;
    this.currentParams = {};
  }

  createTexture(descriptor) {
    const texture = new MockGPUTexture(descriptor);
    this.textures.push(texture);
    return texture;
  }

  createBuffer(descriptor) {
    const buffer = new MockGPUBuffer(descriptor);
    this.buffers.push(buffer);
    return buffer;
  }

  createSampler(descriptor) {
    return new MockGPUSampler(descriptor);
  }

  createShaderModule(descriptor) {
    return new MockGPUShaderModule(descriptor);
  }

  createBindGroupLayout(descriptor) {
    return new MockGPUBindGroupLayout(descriptor);
  }

  createBindGroup(descriptor) {
    return new MockGPUBindGroup(descriptor);
  }

  createPipelineLayout(descriptor) {
    return { bindGroupLayouts: descriptor.bindGroupLayouts };
  }

  createComputePipeline(descriptor) {
    const pipeline = new MockGPUComputePipeline(descriptor);
    this.pipelines.push(pipeline);
    return pipeline;
  }

  createCommandEncoder(_descriptor = {}) {
    return new MockGPUCommandEncoder(this);
  }

  /**
   * Internal method to simulate compute execution
   */
  _executeCompute(encoder) {
    // Find storage textures and write compute results
    for (const texture of this.textures) {
      if (texture.usage & GPUTextureUsage.STORAGE_BINDING) {
        texture.writeComputeResult(this.currentTime, this.currentParams);
      }
    }

    // Execute any texture copies in the encoder
    if (encoder.copyHistory) {
      for (const copy of encoder.copyHistory) {
        const srcTexture = copy.source.texture || copy.source;
        const dstTexture = copy.destination.texture || copy.destination;

        if (srcTexture.data && dstTexture.data) {
          dstTexture.data.set(srcTexture.data);
        }
      }
    }
  }

  /**
   * Set simulation parameters for testing
   */
  setSimulationParams(time, params) {
    this.currentTime = time;
    this.currentParams = { ...params };
  }

  destroy() {
    // Clean up all resources
    for (const texture of this.textures) {
      if (!texture.destroyed) texture.destroy();
    }
    for (const buffer of this.buffers) {
      if (!buffer.destroyed) buffer.destroy();
    }
  }
}

/**
 * Mock GPU adapter
 */
export class MockGPUAdapter {
  constructor() {
    this.features = new Set(['timestamp-query']);
    this.limits = {
      maxTextureDimension2D: 8192
    };
  }

  async requestDevice(_descriptor = {}) {
    return new MockGPUDevice();
  }
}

/**
 * Mock GPU implementation
 */
export class MockGPU {
  async requestAdapter(_options = {}) {
    return new MockGPUAdapter();
  }

  getPreferredCanvasFormat() {
    return 'bgra8unorm';
  }
}

/**
 * GPU texture usage flags (mock)
 */
export const GPUTextureUsage = {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10
};

/**
 * GPU buffer usage flags (mock)
 */
export const GPUBufferUsage = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200
};

/**
 * GPU shader stage flags (mock)
 */
export const GPUShaderStage = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4
};

/**
 * GPU map mode flags (mock)
 */
export const GPUMapMode = {
  READ: 0x0001,
  WRITE: 0x0002
};

/**
 * Setup global WebGPU mock
 */
export function setupWebGPUMock() {
  global.navigator = global.navigator || {};
  global.navigator.gpu = new MockGPU();

  global.GPUTextureUsage = GPUTextureUsage;
  global.GPUBufferUsage = GPUBufferUsage;
  global.GPUShaderStage = GPUShaderStage;
  global.GPUMapMode = GPUMapMode;
}
