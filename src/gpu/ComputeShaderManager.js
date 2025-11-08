/**
 * ComputeShaderManager
 * Manages WebGPU compute pipelines and compute shader execution
 */
export class ComputeShaderManager {
  constructor(device) {
    this.device = device;
    this.computePipeline = null;
    this.bindGroup = null;

    // Storage textures for compute output
    this.storageTexture = null;
    this.outputTexture = null;

    // Uniform buffers
    this.uniformBuffer = null;
    this.uniformData = new Float32Array(8); // [resolution.x, resolution.y, time, scale, octaves_as_float, speed, pad0, pad1]

    // Workgroup configuration
    this.workgroupSize = { x: 8, y: 8, z: 1 };
    this.dispatchSize = { x: 0, y: 0, z: 1 };

    // Texture dimensions
    this.textureWidth = 0;
    this.textureHeight = 0;
  }

  /**
   * Initialize compute shader with WGSL source code
   */
  async initialize(wgslSource, width, height) {
    this.textureWidth = width;
    this.textureHeight = height;

    // Calculate dispatch size based on workgroup size
    this.dispatchSize.x = Math.ceil(width / this.workgroupSize.x);
    this.dispatchSize.y = Math.ceil(height / this.workgroupSize.y);

    // Create storage texture for compute output
    this.createStorageTextures(width, height);

    // Create uniform buffer
    this.createUniformBuffer();

    // Create compute pipeline
    await this.createComputePipeline(wgslSource);

    console.log('[ComputeShaderManager] Initialized:', {
      textureSize: `${width}x${height}`,
      workgroupSize: `${this.workgroupSize.x}x${this.workgroupSize.y}`,
      dispatchSize: `${this.dispatchSize.x}x${this.dispatchSize.y}`
    });
  }

  /**
   * Create storage textures for compute shader
   */
  createStorageTextures(width, height) {
    // Storage texture (write-only from compute shader)
    this.storageTexture = this.device.createTexture({
      size: [width, height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
    });

    // Output texture (for rendering to canvas)
    this.outputTexture = this.device.createTexture({
      size: [width, height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    });

    console.log('[ComputeShaderManager] Storage textures created');
  }

  /**
   * Create uniform buffer for time and resolution
   */
  createUniformBuffer() {
    this.uniformBuffer = this.device.createBuffer({
      size: 32, // 8 floats * 4 bytes = 32 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    console.log('[ComputeShaderManager] Uniform buffer created');
  }

  /**
   * Create compute pipeline from WGSL source
   */
  async createComputePipeline(wgslSource) {
    try {
      // Create shader module
      const shaderModule = this.device.createShaderModule({
        code: wgslSource,
        label: 'Compute Shader Module'
      });

      // Create bind group layout
      const bindGroupLayout = this.device.createBindGroupLayout({
        label: 'Compute Bind Group Layout',
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'uniform' }
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: {
              access: 'write-only',
              format: 'rgba8unorm',
              viewDimension: '2d'
            }
          }
        ]
      });

      // Create pipeline layout
      const pipelineLayout = this.device.createPipelineLayout({
        label: 'Compute Pipeline Layout',
        bindGroupLayouts: [bindGroupLayout]
      });

      // Create compute pipeline
      this.computePipeline = this.device.createComputePipeline({
        label: 'Compute Pipeline',
        layout: pipelineLayout,
        compute: {
          module: shaderModule,
          entryPoint: 'main'
        }
      });

      // Create bind group
      this.bindGroup = this.device.createBindGroup({
        label: 'Compute Bind Group',
        layout: bindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: this.uniformBuffer }
          },
          {
            binding: 1,
            resource: this.storageTexture.createView()
          }
        ]
      });

      console.log('[ComputeShaderManager] Compute pipeline created successfully');
    } catch (error) {
      console.error('[ComputeShaderManager] Failed to create compute pipeline:', error);
      throw error;
    }
  }

  /**
   * Update uniform buffer with current time and resolution
   */
  updateUniforms(time) {
    this.uniformData[0] = this.textureWidth;
    this.uniformData[1] = this.textureHeight;
    this.uniformData[2] = time;
    this.uniformData[3] = 8.0; // scale (default)
    this.uniformData[4] = 5.0; // octaves (default, as float since i32 in struct but we use f32 in buffer)
    this.uniformData[5] = 0.1; // speed (default)
    this.uniformData[6] = 0.0; // padding
    this.uniformData[7] = 0.0; // padding

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.uniformData.buffer,
      0,
      this.uniformData.byteLength
    );
  }

  /**
   * Dispatch compute shader and copy result to output texture
   */
  dispatch(commandEncoder, time) {
    if (!this.computePipeline || !this.bindGroup) {
      console.warn('[ComputeShaderManager] Cannot dispatch: pipeline not initialized');
      return;
    }

    // Update uniforms
    this.updateUniforms(time);

    // Create compute pass
    const computePass = commandEncoder.beginComputePass({
      label: 'Compute Pass'
    });

    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.bindGroup);
    computePass.dispatchWorkgroups(
      this.dispatchSize.x,
      this.dispatchSize.y,
      this.dispatchSize.z
    );

    computePass.end();

    // Copy storage texture to output texture
    commandEncoder.copyTextureToTexture(
      { texture: this.storageTexture },
      { texture: this.outputTexture },
      [this.textureWidth, this.textureHeight, 1]
    );
  }

  /**
   * Get the output texture for rendering
   */
  getOutputTexture() {
    return this.outputTexture;
  }

  /**
   * Get workgroup configuration info
   */
  getWorkgroupInfo() {
    return {
      workgroupSize: { ...this.workgroupSize },
      dispatchSize: { ...this.dispatchSize },
      textureSize: {
        width: this.textureWidth,
        height: this.textureHeight
      }
    };
  }

  /**
   * Resize textures
   */
  resize(width, height) {
    this.textureWidth = width;
    this.textureHeight = height;

    // Recalculate dispatch size
    this.dispatchSize.x = Math.ceil(width / this.workgroupSize.x);
    this.dispatchSize.y = Math.ceil(height / this.workgroupSize.y);

    // Recreate textures
    this.createStorageTextures(width, height);

    // Recreate bind group with new texture views
    if (this.computePipeline) {
      this.bindGroup = this.device.createBindGroup({
        label: 'Compute Bind Group',
        layout: this.computePipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: { buffer: this.uniformBuffer }
          },
          {
            binding: 1,
            resource: this.storageTexture.createView()
          }
        ]
      });
    }

    console.log('[ComputeShaderManager] Resized to', `${width}x${height}`);
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.storageTexture?.destroy();
    this.outputTexture?.destroy();
    this.uniformBuffer?.destroy();

    this.computePipeline = null;
    this.bindGroup = null;
    this.storageTexture = null;
    this.outputTexture = null;
    this.uniformBuffer = null;

    console.log('[ComputeShaderManager] Destroyed');
  }
}
