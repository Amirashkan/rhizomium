/**
 * ComputeShaderManager
 * Manages WebGPU compute pipelines and compute shader execution
 */
export class ComputeShaderManager {
  constructor(device, node = null) {
    this.device = device;
    this.node = node; // Store node reference to access parameters
    this.computePipeline = null;
    this.bindGroup = null;

    // Ping-pong textures for feedback
    this.storageTextureA = null;  // Write target
    this.storageTextureB = null;  // Read source (previous frame)
    this.outputTexture = null;    // Final output for fragment shader
    this.currentWriteTexture = 'A'; // Toggle between A and B

    // Legacy support
    this.storageTexture = null;

    // Uniform buffers
    this.uniformBuffer = null;
    this.uniformData = new Float32Array(8); // [resolution.x, resolution.y, time, scale, octaves_as_float, speed, pad0, pad1]

    // Workgroup configuration
    this.workgroupSize = { x: 8, y: 8, z: 1 };
    this.dispatchSize = { x: 0, y: 0, z: 1 };

    // Texture dimensions
    this.textureWidth = 0;
    this.textureHeight = 0;

    // Feedback support
    this.supportsFeedback = false;
  }

  /**
   * Initialize compute shader with WGSL source code
   */
  async initialize(wgslSource, width, height, supportsFeedback = false) {
    this.textureWidth = width;
    this.textureHeight = height;
    this.supportsFeedback = supportsFeedback;

    // Calculate dispatch size based on workgroup size
    this.dispatchSize.x = Math.ceil(width / this.workgroupSize.x);
    this.dispatchSize.y = Math.ceil(height / this.workgroupSize.y);

    // Create storage textures for compute output
    this.createStorageTextures(width, height);

    // Create uniform buffer
    this.createUniformBuffer();

    // Create compute pipeline
    await this.createComputePipeline(wgslSource);

    console.log('[ComputeShaderManager] Initialized:', {
      textureSize: `${width}x${height}`,
      workgroupSize: `${this.workgroupSize.x}x${this.workgroupSize.y}`,
      dispatchSize: `${this.dispatchSize.x}x${this.dispatchSize.y}`,
      feedback: supportsFeedback
    });
  }

  /**
   * Create storage textures for compute shader
   */
  createStorageTextures(width, height) {
    if (this.supportsFeedback) {
      // Ping-pong textures for feedback (both read/write)
      this.storageTextureA = this.device.createTexture({
        size: [width, height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
        label: 'Feedback Texture A'
      });

      this.storageTextureB = this.device.createTexture({
        size: [width, height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
        label: 'Feedback Texture B'
      });

      // Legacy support
      this.storageTexture = this.storageTextureA;

      console.log('[ComputeShaderManager] Ping-pong textures created for feedback');
    } else {
      // Single storage texture (no feedback)
      this.storageTexture = this.device.createTexture({
        size: [width, height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        label: 'Storage Texture'
      });

      console.log('[ComputeShaderManager] Storage texture created');
    }

    // Output texture (for rendering to fragment shader)
    this.outputTexture = this.device.createTexture({
      size: [width, height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'Output Texture'
    });
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

      // Build bind group layout entries
      const entries = [
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
      ];

      // Add previous frame texture binding for feedback (textureLoad only, no sampler needed)
      if (this.supportsFeedback) {
        entries.push({
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'float', viewDimension: '2d' }
        });
      }

      // Create bind group layout
      const bindGroupLayout = this.device.createBindGroupLayout({
        label: 'Compute Bind Group Layout',
        entries
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

      // Store bind group layout for dynamic bind group creation
      this.bindGroupLayout = bindGroupLayout;

      // Create initial bind group (will be recreated each frame for feedback)
      this.recreateBindGroup();

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
    // Always set resolution and time first
    this.uniformData[0] = this.textureWidth;
    this.uniformData[1] = this.textureHeight;
    this.uniformData[2] = time;

    // Set node-specific parameters based on node kind
    if (!this.node) {
      // No node - use defaults
      this.uniformData[3] = 8.0;
      this.uniformData[4] = 5.0;
      this.uniformData[5] = 0.1;
      this.uniformData[6] = 0.0;
      this.uniformData[7] = 0.0;
    } else {
      switch (this.node.kind) {
        case 'ComputeNoise':
          this.uniformData[3] = this.node.params?.scale ?? 8.0;
          this.uniformData[4] = this.node.params?.octaves ?? 5;
          this.uniformData[5] = this.node.params?.speed ?? 0.1;
          this.uniformData[6] = 0.0;
          this.uniformData[7] = 0.0;
          break;

        case 'ComputeReactionDiffusion':
          this.uniformData[3] = this.node.params?.feedRate ?? 0.055;
          this.uniformData[4] = this.node.params?.killRate ?? 0.062;
          this.uniformData[5] = this.node.params?.diffusionA ?? 1.0;
          this.uniformData[6] = this.node.params?.diffusionB ?? 0.5;
          this.uniformData[7] = this.node.params?.timestep ?? 1.0;
          break;

        case 'ComputeFeedback':
          this.uniformData[3] = this.node.params?.decay ?? 0.95;
          this.uniformData[4] = this.node.params?.scale ?? 1.01;
          this.uniformData[5] = this.node.params?.rotation ?? 0.0;
          this.uniformData[6] = this.node.params?.offsetX ?? 0.0;
          this.uniformData[7] = this.node.params?.offsetY ?? 0.0;
          break;

        default:
          // Unknown node type - use defaults
          this.uniformData[3] = 0.0;
          this.uniformData[4] = 0.0;
          this.uniformData[5] = 0.0;
          this.uniformData[6] = 0.0;
          this.uniformData[7] = 0.0;
          break;
      }
    }

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      this.uniformData.buffer,
      0,
      this.uniformData.byteLength
    );
  }

  /**
   * Recreate bind group (for ping-pong buffering)
   */
  recreateBindGroup() {
    if (!this.bindGroupLayout) return;

    const entries = [
      {
        binding: 0,
        resource: { buffer: this.uniformBuffer }
      }
    ];

    if (this.supportsFeedback) {
      // Ping-pong: write to one texture, read from the other
      const writeTexture = this.currentWriteTexture === 'A' ? this.storageTextureA : this.storageTextureB;
      const readTexture = this.currentWriteTexture === 'A' ? this.storageTextureB : this.storageTextureA;

      entries.push({ binding: 1, resource: writeTexture.createView() });
      entries.push({ binding: 2, resource: readTexture.createView() });

      // Update legacy reference
      this.storageTexture = writeTexture;
    } else {
      // No feedback - simple binding
      entries.push({ binding: 1, resource: this.storageTexture.createView() });
    }

    this.bindGroup = this.device.createBindGroup({
      label: 'Compute Bind Group',
      layout: this.bindGroupLayout,
      entries
    });
  }

  /**
   * Swap ping-pong buffers
   */
  swapBuffers() {
    if (!this.supportsFeedback) return;

    this.currentWriteTexture = this.currentWriteTexture === 'A' ? 'B' : 'A';
    this.storageTexture = this.currentWriteTexture === 'A' ? this.storageTextureA : this.storageTextureB;
  }

  /**
   * Dispatch compute shader and copy result to output texture
   */
  dispatch(commandEncoder, time) {
    if (!this.computePipeline || !this.bindGroup) {
      console.warn('[ComputeShaderManager] Cannot dispatch: pipeline not initialized');
      return;
    }

    // Debug: Log dispatch (throttled)
    if (!this._lastDispatchLog || Date.now() - this._lastDispatchLog > 2000) {
      const params = this.supportsFeedback ?
        `feedback=true, buffer=${this.currentWriteTexture}` :
        'feedback=false';
      console.log(`[ComputeShaderManager] Dispatching ${this.node?.kind ?? 'unknown'} at time: ${time.toFixed(2)}s, ${params}`);
      if (this.node?.kind === 'ComputeReactionDiffusion') {
        console.log(`  RD params: feed=${this.uniformData[3].toFixed(4)}, kill=${this.uniformData[4].toFixed(4)}, diffA=${this.uniformData[5].toFixed(2)}, diffB=${this.uniformData[6].toFixed(2)}, dt=${this.uniformData[7].toFixed(2)}`);
      }
      this._lastDispatchLog = Date.now();
    }

    // Update uniforms
    this.updateUniforms(time);

    // For feedback, recreate bind group to use correct ping-pong textures
    if (this.supportsFeedback) {
      this.recreateBindGroup();
    }

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

    // Swap buffers for next frame
    if (this.supportsFeedback) {
      this.swapBuffers();
    }
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
