import { globalResourceRegistry } from './ResourceTracker.js';

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

    // Input texture from other compute nodes
    this.inputTexture = null;
    this.fallbackInputTexture = null;

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

    // Input texture support
    this.needsInput = false;

    // Resource tracking
    this.resourceTracker = node?.id ? globalResourceRegistry.getOrCreate(node.id) : null;
  }

  /**
   * Initialize compute shader with WGSL source code
   */
  async initialize(wgslSource, width, height, supportsFeedback = false, needsInput = false) {
    this.textureWidth = width;
    this.textureHeight = height;
    this.supportsFeedback = supportsFeedback;
    this.needsInput = needsInput;

    // Calculate dispatch size based on workgroup size
    this.dispatchSize.x = Math.ceil(width / this.workgroupSize.x);
    this.dispatchSize.y = Math.ceil(height / this.workgroupSize.y);

    // Create fallback input texture if needed
    this.createFallbackInputTexture();

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
      feedback: supportsFeedback,
      needsInput: needsInput
    });
  }

  /**
   * Create fallback input texture (1x1 black texture)
   */
  createFallbackInputTexture() {
    if (!this.needsInput) return;

    const fallbackData = new Uint8Array([0, 0, 0, 255]); // Black pixel

    this.fallbackInputTexture = this.device.createTexture({
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: 'Fallback Input Texture'
    });

    this.device.queue.writeTexture(
      { texture: this.fallbackInputTexture },
      fallbackData,
      { bytesPerRow: 4 },
      { width: 1, height: 1 }
    );

    console.log('[ComputeShaderManager] Created fallback input texture');
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
      this.resourceTracker?.trackTexture(this.storageTextureA, { width, height, format: 'rgba8unorm', type: 'feedback-A' });

      this.storageTextureB = this.device.createTexture({
        size: [width, height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
        label: 'Feedback Texture B'
      });
      this.resourceTracker?.trackTexture(this.storageTextureB, { width, height, format: 'rgba8unorm', type: 'feedback-B' });

      // Initialize feedback textures for reaction-diffusion
      if (this.node?.kind === 'ComputeReactionDiffusion') {
        this.initializeReactionDiffusionTextures(width, height);
      }

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
      this.resourceTracker?.trackTexture(this.storageTexture, { width, height, format: 'rgba8unorm', type: 'storage' });

      console.log('[ComputeShaderManager] Storage texture created');
    }

    // Output texture (for rendering to fragment shader)
    this.outputTexture = this.device.createTexture({
      size: [width, height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      label: 'Output Texture'
    });
    this.resourceTracker?.trackTexture(this.outputTexture, { width, height, format: 'rgba8unorm', type: 'output' });
  }

  /**
   * Initialize reaction-diffusion textures with proper initial state
   * A=1.0 everywhere, B=0.15-0.25 in seed regions, tiny noise elsewhere
   */
  initializeReactionDiffusionTextures(width, height) {
    const pixelData = new Uint8Array(width * height * 4);

    // Create multiple seed points for interesting patterns
    const seeds = [
      { x: 0.5, y: 0.5, radius: 0.1 },       // Center (larger)
      { x: 0.25, y: 0.25, radius: 0.04 },    // Top-left
      { x: 0.75, y: 0.25, radius: 0.04 },    // Top-right
      { x: 0.25, y: 0.75, radius: 0.04 },    // Bottom-left
      { x: 0.75, y: 0.75, radius: 0.04 },    // Bottom-right
    ];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const uvX = x / width;
        const uvY = y / height;

        // A channel (chemical A) - start at 1.0 everywhere
        pixelData[idx + 0] = 255;

        // B channel (chemical B) - start VERY low, slightly higher in seed regions
        // Background has tiny noise to help pattern formation
        let bValue = Math.random() * 2; // Background noise: 0-2 (0-1% of max)

        for (const seed of seeds) {
          const dx = uvX - seed.x;
          const dy = uvY - seed.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < seed.radius) {
            // Inside seed region - use 25% flat (0.25 is typical for RD sims)
            // No falloff - just mark the region
            const seedB = 64; // 25% of 255 (0.25 in normalized coords)
            bValue = seedB;
          }
        }
        pixelData[idx + 1] = Math.floor(bValue);

        // G and A channels unused
        pixelData[idx + 2] = 0;
        pixelData[idx + 3] = 255;
      }
    }

    // Write initial data to both ping-pong textures
    this.device.queue.writeTexture(
      { texture: this.storageTextureA },
      pixelData,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    );

    this.device.queue.writeTexture(
      { texture: this.storageTextureB },
      pixelData,
      { bytesPerRow: width * 4, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    );

    console.log('[ComputeShaderManager] Reaction-diffusion textures initialized with seed patterns');
  }

  /**
   * Reset reaction-diffusion simulation (reinitialize textures)
   * Useful when changing patterns or parameters
   */
  resetReactionDiffusion() {
    if (this.node?.kind === 'ComputeReactionDiffusion' && this.supportsFeedback) {
      this.initializeReactionDiffusionTextures(this.textureWidth, this.textureHeight);
      console.log('[ComputeShaderManager] Reaction-diffusion simulation reset');
    }
  }

  /**
   * Create uniform buffer for time and resolution
   */
  createUniformBuffer() {
    this.uniformBuffer = this.device.createBuffer({
      size: 32, // 8 floats * 4 bytes = 32 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.resourceTracker?.trackBuffer(this.uniformBuffer, 32);

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
      // Standard layout:
      // - binding(0): uniforms
      // - binding(1): storage texture (output) - ALWAYS
      // - binding(2): input texture (if needsInput)
      // - binding(3): feedback texture (if supportsFeedback)
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

      // Add input texture binding for nodes that take inputs from other compute nodes
      if (this.needsInput) {
        entries.push({
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'float', viewDimension: '2d' }
        });
      }

      // Add previous frame texture binding for feedback (uses binding 3 if input exists, else binding 2)
      if (this.supportsFeedback) {
        entries.push({
          binding: this.needsInput ? 3 : 2,
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

    // Binding 1: Always the output storage texture
    if (this.supportsFeedback) {
      // Ping-pong: write to one texture, read from the other
      const writeTexture = this.currentWriteTexture === 'A' ? this.storageTextureA : this.storageTextureB;
      entries.push({ binding: 1, resource: writeTexture.createView() });

      // Update legacy reference
      this.storageTexture = writeTexture;
    } else {
      entries.push({ binding: 1, resource: this.storageTexture.createView() });
    }

    // Binding 2: Input texture (if needed)
    if (this.needsInput) {
      const inputTexture = this.inputTexture || this.fallbackInputTexture;
      entries.push({ binding: 2, resource: inputTexture.createView() });
    }

    // Binding 3 (or 2 if no input): Feedback texture (if needed)
    if (this.supportsFeedback) {
      const readTexture = this.currentWriteTexture === 'A' ? this.storageTextureB : this.storageTextureA;
      entries.push({ binding: this.needsInput ? 3 : 2, resource: readTexture.createView() });
    }

    this.bindGroup = this.device.createBindGroup({
      label: 'Compute Bind Group',
      layout: this.bindGroupLayout,
      entries
    });
  }

  /**
   * Set input texture from another compute node
   */
  setInputTexture(texture) {
    this.inputTexture = texture;
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
  dispatch(commandEncoder, time, profiler = null) {
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

    // Begin profiling
    const dispatchId = profiler ? profiler.beginDispatch(
      commandEncoder,
      this.node?.kind || 'Compute',
      {
        dispatchSize: this.dispatchSize,
        workgroupSize: this.workgroupSize
      }
    ) : -1;

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

    // End profiling
    if (profiler) {
      profiler.endDispatch(commandEncoder, dispatchId);
    }

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
    // Use resource tracker if available (it will handle all tracked resources)
    if (this.resourceTracker) {
      this.resourceTracker.destroy();
    } else {
      // Fallback: manual cleanup if no tracker
      this.storageTexture?.destroy();
      this.storageTextureA?.destroy();
      this.storageTextureB?.destroy();
      this.outputTexture?.destroy();
      this.uniformBuffer?.destroy();
      this.fallbackInputTexture?.destroy();
    }

    this.computePipeline = null;
    this.bindGroup = null;
    this.storageTexture = null;
    this.storageTextureA = null;
    this.storageTextureB = null;
    this.outputTexture = null;
    this.uniformBuffer = null;
    this.fallbackInputTexture = null;

    console.log('[ComputeShaderManager] Destroyed');
  }
}
