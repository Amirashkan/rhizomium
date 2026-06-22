import { globalResourceRegistry } from './ResourceTracker.js';
import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';
import { expressionSystem } from '../utils/ParameterExpressionSystem.js';
import { shaderModuleCache, hashWGSL } from './ShaderModuleCache.js';
import { packComputeUniforms } from './computeUniformLayout.js';

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
    
    // PERFORMANCE: Use centralized shader module cache to avoid recompiling identical WGSL
    this.shaderModuleCache = shaderModuleCache;

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
    this.inputSampler = null;
    this.warpFieldTexture = null; // For ComputeWarp's second input

    // Track previous texture references to avoid unnecessary bind group recreation
    this._previousInputTexture = null;
    this._previousWarpFieldTexture = null;
    this._previousWriteTexture = null;
    this._bindGroupNeedsUpdate = false;

    // Uniform buffers
    this.uniformBuffer = null;
    this.uniformData = new Float32Array(16); // Expanded to support more parameters [resolution.x, resolution.y, time, param1-12, pad0]

    // Storage buffers
    this.colorStopsBuffer = null; // For gradient color stops
    // WebGPU requires storage buffers to be at least 256 bytes
    // 8 stops * 5 floats = 160 bytes, so we need to pad to 256 bytes = 64 floats
    this.colorStopsData = new Float32Array(64); // Padded to 256 bytes minimum

    // External-uniform mode: a second-monitor mirror window injects the editor's
    // already-packed uniform/color-stop bytes so this manager renders identical
    // output without re-evaluating expressions/audio (which differ per window).
    this.externalUniformMode = false;
    this._externalPacked = null;      // Float32Array(16) injected each frame
    this._externalColorStops = null;  // Float32Array(64) for ComputeGradient

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
   * Evaluate a parameter value - handles expressions, shader variables, and static values
   * @param {*} value - The parameter value (could be number, string expression, etc.)
   * @param {number} defaultValue - Default value if evaluation fails
   * @param {number} time - Current time for expression evaluation
   * @param {Object} audioContext - Audio envelope values (audioEnvelope, audioEnvelopeBass, etc.)
   * @returns {number} The evaluated numeric value
   */
  evaluateParam(value, defaultValue, time, audioContext = {}) {
    // If already a number, return it
    if (typeof value === 'number') {
      return isFinite(value) ? value : defaultValue;
    }

    // If it's a string, it might be an expression
    if (typeof value === 'string') {
      const trimmed = value.trim();

      // Check if it's an expression (either starts with = or contains time/audioEnvelope)
      const isExpression = trimmed.startsWith('=') || /\btime\b/.test(trimmed) || /\baudioEnvelope/.test(trimmed);
      const isNodeReference = /node_\d+/.test(value);

      // Handle expressions (with or without = prefix)
      if (isExpression) {
        try {
          // CRITICAL: If this expression contains node references, compute all previews first
          // to ensure referenced node values are up-to-date
          // Cache the computation per-frame to avoid redundant recalculations
          if (isNodeReference) {
            const now = performance.now();
            const previewComputer = window.editor?.previewComputer;
            if (previewComputer && window.editor?.graph) {
              // Only recompute if not already done this frame (within 1ms)
              // NOTE: This must remain synchronous because expression evaluation happens immediately after
              // and needs the computed values. This is in the GPU render path which is already async.
              if (!previewComputer._lastComputeTime || (now - previewComputer._lastComputeTime) > 1) {
                previewComputer.computePreviews(window.editor.graph);
                previewComputer._lastComputeTime = now;
              }
            }
          }

          // Use expressionSystem which includes node references in evaluation context
          // This enables compute nodes to reference Float, Remap, and other node outputs
          const context = {
            time,
            audioEnvelope: audioContext.audioEnvelope || 0.0,
            audioEnvelopeBass: audioContext.audioEnvelopeBass || 0.0,
            audioEnvelopeMids: audioContext.audioEnvelopeMids || 0.0,
            audioEnvelopeHighs: audioContext.audioEnvelopeHighs || 0.0,
            audioEnvelopeFull: audioContext.audioEnvelopeFull || 0.0
          };
          const result = expressionSystem.evaluateExpression(value, context, this.node);

          return isFinite(result) ? result : defaultValue;
        } catch (error) {
          return defaultValue;
        }
      }

      // Try to parse as number
      const parsed = parseFloat(trimmed);
      return isNaN(parsed) ? defaultValue : parsed;
    }

    // Boolean or other types
    if (typeof value === 'boolean') {
      return value ? 1.0 : 0.0;
    }

    return defaultValue;
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

    // Create sampler for input/feedback textures if needed
    if (this.needsInput || this.supportsFeedback) {
      this.textureSampler = this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge'
      });
    }

    // Create storage textures for compute output
    this.createStorageTextures(width, height);

    // Create uniform buffer
    this.createUniformBuffer();

    // Create compute pipeline
    await this.createComputePipeline(wgslSource);
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

    } else {
      // Single storage texture (no feedback)
      this.storageTexture = this.device.createTexture({
        size: [width, height, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        label: 'Storage Texture'
      });
      this.resourceTracker?.trackTexture(this.storageTexture, { width, height, format: 'rgba8unorm', type: 'storage' });

    }

    // Output texture (for rendering to fragment shader).
    // COPY_SRC lets the per-node preview system read it back for a thumbnail.
    this.outputTexture = this.device.createTexture({
      size: [width, height, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
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
        // Background noise helps pattern formation. Use a DETERMINISTIC per-pixel
        // hash (not Math.random): the second-monitor viewer re-runs this exact
        // seeding in its own renderer, so a fixed seed keeps both windows'
        // reaction-diffusion identical at t=0 — otherwise each starts from a
        // different random field and the chaotic sim diverges completely.
        let hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        hsh = (hsh ^ (hsh >>> 13)) >>> 0;
        let bValue = (hsh % 256) / 256 * 2; // 0-2, identical on every window

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

  }

  /**
   * Reset reaction-diffusion simulation (reinitialize textures)
   * Useful when changing patterns or parameters
   */
  resetReactionDiffusion() {
    if (this.node?.kind === 'ComputeReactionDiffusion' && this.supportsFeedback) {
      this.initializeReactionDiffusionTextures(this.textureWidth, this.textureHeight);
    }
  }

  /**
   * Create uniform buffer for time and resolution
   */
  createUniformBuffer() {
    this.uniformBuffer = this.device.createBuffer({
      label: 'Compute Uniform Buffer',
      size: 64, // 16 floats * 4 bytes = 64 bytes (expanded for more parameters)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.resourceTracker?.trackBuffer(this.uniformBuffer, 64);

  }

  /**
   * Create compute pipeline from WGSL source
   */
  async createComputePipeline(wgslSource) {
    try {
      // PERFORMANCE: Use shader module cache to avoid recompiling identical WGSL
      // CRITICAL FIX: Cache is now device-specific - pass device to get/set
      const wgslHash = hashWGSL(wgslSource, false);
      let shaderModule = this.shaderModuleCache.get(this.device, wgslHash);
      
      if (!shaderModule) {
        // Create shader module if not cached
        shaderModule = this.device.createShaderModule({
          code: wgslSource,
          label: 'Compute Shader Module'
        });
        this.shaderModuleCache.set(this.device, wgslHash, shaderModule);
      }

      // Build bind group layout entries
      // Standard layout:
      // - binding(0): uniforms
      // - binding(1): storage texture (output) - ALWAYS
      // - binding(2): color stops storage buffer (ComputeGradient only) OR input texture (if needsInput) OR feedback texture (if supportsFeedback && !needsInput)
      // - binding(3): sampler (if needsInput || supportsFeedback)
      // - binding(4): feedback texture (if supportsFeedback && needsInput)
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

      // Add color stops storage buffer for ComputeGradient
      if (this.node?.kind === 'ComputeGradient') {
        entries.push({
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' }
        });
      }

      // Add input texture binding for nodes that take inputs from other compute nodes
      if (this.needsInput) {
        entries.push({
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'float', viewDimension: '2d' }
        });
        // Add sampler for input texture
        entries.push({
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          sampler: { type: 'filtering' }
        });
      }

      // Add previous frame texture binding for feedback (uses binding 4 if input exists, else binding 2)
      if (this.supportsFeedback) {
        entries.push({
          binding: this.needsInput ? 4 : 2,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'float', viewDimension: '2d' }
        });
        // Add sampler for feedback texture (binding 3 if no input, binding 5 if input exists)
        if (!this.needsInput) {
          entries.push({
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            sampler: { type: 'filtering' }
          });
        }
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

      // Initialize color stops buffer for ComputeGradient
      if (this.node?.kind === 'ComputeGradient') {
        const defaultColorStops = [
          { position: 0.0, color: [0, 0, 0, 1] },
          { position: 1.0, color: [1, 1, 1, 1] }
        ];
        this.updateColorStopsBuffer(this.node.params?.colorStops || defaultColorStops);
      }

      // Create initial bind group (will be recreated each frame for feedback)
      this.recreateBindGroup();

    } catch (error) {
      throw error;
    }
  }

  /**
   * Update uniform buffer with current time and resolution
   * @param {number} time - Current time in seconds
   * @param {Object} audioContext - Audio envelope values for expression evaluation
   */
  updateUniforms(time, audioContext = {}) {
    // External mode (second-monitor mirror): write the editor's already-packed
    // bytes verbatim instead of re-evaluating params here. Expressions/audio were
    // applied editor-side, so this renders identical output.
    if (this.externalUniformMode) {
      if (this._externalPacked && this.uniformBuffer) {
        this.uniformData.set(this._externalPacked);
        this.device.queue.writeBuffer(
          this.uniformBuffer, 0, this.uniformData.buffer, 0, this.uniformData.byteLength,
        );
      }
      if (this._externalColorStops) {
        if (!this.colorStopsBuffer) {
          this.colorStopsBuffer = this.device.createBuffer({
            label: 'Color Stops Storage Buffer',
            size: this.colorStopsData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
        }
        this.colorStopsData.set(this._externalColorStops);
        this.device.queue.writeBuffer(
          this.colorStopsBuffer, 0, this.colorStopsData.buffer, 0, this.colorStopsData.byteLength,
        );
      }
      return;
    }

    // Pack node-specific uniforms via the shared single-source-of-truth layout
    // (computeUniformLayout.js) so the editor and the external live viewer pack
    // identical buffers for every compute node type.
    const packed = packComputeUniforms(this.node?.kind, this.node?.params, {
      width: this.textureWidth,
      height: this.textureHeight,
      time,
      evaluate: (value, defaultValue) => this.evaluateParam(value, defaultValue, time, audioContext)
    });
    this.uniformData.set(packed);

    // No-node fallback preserved from the previous implementation.
    if (!this.node) {
      this.uniformData[3] = 8.0;
      this.uniformData[4] = 5.0;
      this.uniformData[5] = 0.1;
    }

    // ComputeGradient additionally drives a color-stops storage buffer. The
    // uniform's numStops/padding are packed above; refresh the stop colors here.
    if (this.node?.kind === 'ComputeGradient') {
      const colorStops = this.node.params?.colorStops || [
        { position: 0.0, color: [0, 0, 0, 1] },
        { position: 1.0, color: [1, 1, 1, 1] }
      ];
      this.updateColorStopsBuffer(colorStops);
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
   * Inject externally-packed uniform bytes (from the editor) for the mirror
   * window, then upload them. `packed` is a Float32Array(16); `colorStops` is an
   * optional Float32Array(64) for ComputeGradient. Requires externalUniformMode.
   */
  writeRawComputeUniforms(packed, colorStops) {
    if (packed) this._externalPacked = packed;
    if (colorStops) this._externalColorStops = colorStops;
    if (this.externalUniformMode && this.uniformBuffer) this.updateUniforms(0);
  }

  /**
   * Update color stops storage buffer for gradient nodes
   */
  updateColorStopsBuffer(colorStops) {
    if (!this.colorStopsBuffer) {
      // Create color stops buffer on first use
      this.colorStopsBuffer = this.device.createBuffer({
        label: 'Color Stops Storage Buffer',
        size: this.colorStopsData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });

      // Track resource
      if (this.resourceTracker) {
        this.resourceTracker.trackBuffer(this.colorStopsBuffer, this.colorStopsData.byteLength);
      }
    }

    // Fill color stops data to match the WGSL layout
    //   struct ColorStop { position: f32, color: vec4<f32> }
    // vec4<f32> is 16-byte aligned, so each ColorStop is 32 bytes = 8 floats:
    //   [position, pad, pad, pad, r, g, b, a]. Packing 5 floats/stop (the old
    // code) misaligned every color, so gradients ignored their stops entirely.
    const numStops = Math.min(colorStops.length, 8);
    this.colorStopsData.fill(0); // clear stale stops/padding when count shrinks
    for (let i = 0; i < numStops; i++) {
      const stop = colorStops[i];
      const offset = i * 8;
      this.colorStopsData[offset] = stop.position || 0.0;
      this.colorStopsData[offset + 4] = stop.color?.[0] || 0.0; // R
      this.colorStopsData[offset + 5] = stop.color?.[1] || 0.0; // G
      this.colorStopsData[offset + 6] = stop.color?.[2] || 0.0; // B
      this.colorStopsData[offset + 7] = stop.color?.[3] || 1.0; // A
    }

    // Write to GPU buffer
    this.device.queue.writeBuffer(
      this.colorStopsBuffer,
      0,
      this.colorStopsData.buffer,
      0,
      this.colorStopsData.byteLength
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

    // Binding 2: Color stops storage buffer (for ComputeGradient)
    if (this.node?.kind === 'ComputeGradient' && this.colorStopsBuffer) {
      entries.push({ binding: 2, resource: { buffer: this.colorStopsBuffer } });
    }

    // Binding 2: Input texture (if needed and not ComputeGradient)
    if (this.needsInput) {
      const inputTexture = this.inputTexture || this.fallbackInputTexture;
      entries.push({ binding: 2, resource: inputTexture.createView() });
      // Binding 3: Input sampler
      entries.push({ binding: 3, resource: this.textureSampler });
    }

    // Binding 4 (or 2 if no input): Feedback texture OR warp field (for ComputeWarp) OR second input (for ComputeMix)
    if (this.supportsFeedback) {
      // Special case: ComputeWarp and ComputeMix use binding 4 for second input texture, not feedback
      if (this.node?.kind === 'ComputeWarp' || this.node?.kind === 'ComputeMix') {
        const secondInputTexture = this.warpFieldTexture || this.fallbackInputTexture;
        entries.push({ binding: 4, resource: secondInputTexture.createView() });
      } else {
        const readTexture = this.currentWriteTexture === 'A' ? this.storageTextureB : this.storageTextureA;
        entries.push({ binding: this.needsInput ? 4 : 2, resource: readTexture.createView() });
      }
      // Binding 3: Feedback sampler (only if no input)
      if (!this.needsInput) {
        entries.push({ binding: 3, resource: this.textureSampler });
      }
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
    // Mark that bind group needs recreation if texture reference changed
    this._bindGroupNeedsUpdate = (texture !== this._previousInputTexture);
  }

  /**
   * Set warp field texture (for ComputeWarp node - second input)
   */
  setWarpFieldTexture(texture) {
    this.warpFieldTexture = texture;
    // Mark that bind group needs recreation if texture reference changed
    this._bindGroupNeedsUpdate = (texture !== this._previousWarpFieldTexture);
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
   * @param {GPUCommandEncoder} commandEncoder - WebGPU command encoder
   * @param {number} time - Current time in seconds
   * @param {Object} profiler - Optional profiler for performance tracking
   * @param {Object} audioContext - Audio envelope values for expression evaluation
   */
  dispatch(commandEncoder, time, profiler = null, audioContext = {}) {
    if (!this.computePipeline || !this.bindGroup) {
      return;
    }

    // Update uniforms (includes audio envelope values for expression evaluation)
    this.updateUniforms(time, audioContext);

    // OPTIMIZATION: Only recreate bind group when textures actually change
    // Check if we need to recreate bind group (feedback swap or input texture change)
    const currentWriteTexture = this.currentWriteTexture;
    const needsRecreate = this.supportsFeedback && (currentWriteTexture !== this._previousWriteTexture) ||
                         (this.needsInput && this._bindGroupNeedsUpdate);

    if (needsRecreate) {
      this.recreateBindGroup();
      this._previousInputTexture = this.inputTexture;
      this._previousWarpFieldTexture = this.warpFieldTexture;
      this._previousWriteTexture = currentWriteTexture;
      this._bindGroupNeedsUpdate = false;
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

    // Capture old textures before overwriting references, then defer destruction
    const oldTextures = [
      this.storageTexture,
      this.storageTextureA,
      this.storageTextureB,
      this.outputTexture,
    ].filter(Boolean);
    if (window.computeExecutor) {
      window.computeExecutor._deferDestroy(() => {
        for (const t of oldTextures) { try { t.destroy(); } catch (_) {} }
      });
    } else {
      // No executor to defer through — wait one tick then destroy
      setTimeout(() => { for (const t of oldTextures) { try { t.destroy(); } catch (_) {} } }, 0);
    }

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

  }

  /**
   * Convert channel source string to index
   * Used by ComputeChannels node: R=0, G=1, B=2, A=3, 0=4, 1=5
   */
  getChannelSourceIndex(source) {
    const sources = {
      'R': 0,
      'G': 1,
      'B': 2,
      'A': 3,
      '0': 4,
      '1': 5
    };
    return sources[source] || 0;
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Explicitly destroy each resource owned by this manager.
    // Do NOT call this.resourceTracker.destroy() — the tracker is shared across
    // all managers for the same node (globalResourceRegistry.getOrCreate reuses it),
    // so calling tracker.destroy() would also kill the NEW manager's resources.
    this.storageTexture?.destroy();
    this.storageTextureA?.destroy();
    this.storageTextureB?.destroy();
    this.outputTexture?.destroy();
    this.uniformBuffer?.destroy();
    this.colorStopsBuffer?.destroy();
    this.fallbackInputTexture?.destroy();

    this.computePipeline = null;
    this.bindGroup = null;
    this.storageTexture = null;
    this.storageTextureA = null;
    this.storageTextureB = null;
    this.outputTexture = null;
    this.uniformBuffer = null;
    this.colorStopsBuffer = null;
    this.fallbackInputTexture = null;
  }
}
