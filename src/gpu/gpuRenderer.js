// src/gpu/gpuRenderer.js
// WebGPU renderer with explicit aspect uniform management and safe fallbacks.

import { RenderCache } from './RenderCache.js';
import { shaderModuleCache, hashWGSL } from './ShaderModuleCache.js';

const STAGES = GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX;

// Parse WGSL for @group/@binding declarations so we can allocate resources dynamically.
function analyzeBindings(wgsl) {
  const groups = {};
  const re = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<(\w+)>)?\s+([\w_]+)\s*:\s*([^;]+);/g;

  let match;
  while ((match = re.exec(wgsl)) !== null) {
    const groupIndex = parseInt(match[1], 10);
    const bindingIndex = parseInt(match[2], 10);
    const addressSpace = (match[3] || "").trim();
    const varName = match[4];
    const typeStr = match[5].trim();

    let kind = "uniform-buffer";
    if (/^sampler/.test(typeStr)) kind = "sampler";
    else if (/^texture_2d/.test(typeStr)) kind = "texture-2d";
    else if (/^texture_cube/.test(typeStr)) kind = "texture-cube";
    else if (/storage/.test(addressSpace)) kind = "storage-buffer";

    if (!groups[groupIndex]) groups[groupIndex] = {};
    groups[groupIndex][bindingIndex] = { kind, varDecl: `${varName}:${typeStr}` };
  }

  return { groups };
}

export class GPURenderer {
  constructor(device, canvas) {
    this.device = device;
    this.canvas = canvas;
    this.context = canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.sampleCount = 4; // 4x MSAA antialiasing

    this.context.configure({
      device,
      format: this.format,
      alphaMode: "premultiplied",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    this.pipeline = null;
    this.bindGroups = [];
    this.resources = {};
    this.shaderModule = null;
    this._lastAspectWritten = null;
    this.msaaTexture = null; // MSAA render target
    this.msaaTextureSize = { width: 0, height: 0 }; // Track MSAA texture size for validation
    this.profiler = null; // ComputeProfiler instance
    this._currentWgslCode = null; // Store current WGSL code for pipeline recreation
    
    // PERFORMANCE: Shader module cache to avoid recompiling identical WGSL code
    this.shaderCache = shaderModuleCache;
    
    // PERFORMANCE: Bind group cache - cache bind groups by resource hash to avoid unnecessary rebuilds
    this._bindGroupCache = new Map(); // Map<resourceHash, bindGroups[]>
    this._lastResourceHash = null; // Hash of all resources for current bind groups
    
    // CRITICAL PERFORMANCE FIX: Cache canvas dimensions to avoid layout reads during render
    // Reading clientWidth/clientHeight forces synchronous layout recalculation, blocking the main thread
    // This causes FPS drops during panning. Cache is updated only on explicit resize events.
    this._cachedCanvasSize = {
      width: this.canvas.width || 1,
      height: this.canvas.height || 1,
      clientWidth: this.canvas.clientWidth || this.canvas.width || 1,
      clientHeight: this.canvas.clientHeight || this.canvas.height || 1,
    };
    
    // Render cache for intermediate artifacts (textures, framebuffers)
    this.renderCache = new RenderCache(device, {
      maxMemoryMB: 256,
      maxEntries: 100,
      defaultLifetime: 60000 // 60 seconds
    });
    
    // Cache key for MSAA texture
    this._msaaCacheKey = null;
    
    // Setup invalidation hooks if InvalidationManager is available
    this._setupInvalidationHooks();
  }

  clear() {
    this.pipeline = null;
    this.bindGroups = [];
    this.resources = {};
    this.shaderModule = null;
    this._lastAspectWritten = null;
    // Clear bind group cache when clearing renderer
    this._bindGroupCache.clear();
    this._lastResourceHash = null;
    // Note: Don't clear renderCache here - it's managed separately
    // Cache will be cleared when device is lost or explicitly requested
  }
  
  /**
   * Setup hooks for InvalidationManager integration
   * @private
   */
  _setupInvalidationHooks() {
    // Hook into global editor's invalidation manager if available
    if (typeof window !== 'undefined' && window.editor?.invalidationManager) {
      // Store original invalidateNode method
      const originalInvalidateNode = window.editor.invalidationManager.invalidateNode.bind(
        window.editor.invalidationManager
      );
      
      // Wrap to also invalidate cache
      window.editor.invalidationManager.invalidateNode = (node, reason) => {
        originalInvalidateNode(node, reason);
        // Invalidate cache entries for this node
        if (node && node.id) {
          this.renderCache.invalidateNode(node.id, reason);
        }
      };
      
      // Hook into invalidateFull
      const originalInvalidateFull = window.editor.invalidationManager.invalidateFull.bind(
        window.editor.invalidationManager
      );
      
      window.editor.invalidationManager.invalidateFull = (reason) => {
        originalInvalidateFull(reason);
        // Optionally clear cache on full invalidation
        // For now, we keep cache as it may still be valid
        // Uncomment if full invalidation should clear cache:
        // this.renderCache.clear();
      };
    }
    
    // Expose cache metrics globally for monitoring
    if (typeof window !== 'undefined') {
      window.renderCacheMetrics = () => this.getCacheMetrics();
    }
  }
  
  /**
   * Get cache metrics
   * @returns {Object} Cache metrics
   */
  getCacheMetrics() {
    return this.renderCache.getMetrics();
  }
  
  /**
   * Clear render cache
   */
  clearCache() {
    this.renderCache.clear();
    this._msaaCacheKey = null;
  }
  
  /**
   * Cleanup expired cache entries (call periodically, e.g., every 60 seconds)
   */
  cleanupCache() {
    this.renderCache.cleanup();
  }

  // Create or recreate MSAA texture to match canvas size
  _createMSAATexture() {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    
    // Use cache key based on size and sample count
    const cacheKey = `msaa_${width}x${height}_${this.sampleCount}`;
    
    // Check if we can reuse cached texture
    if (this._msaaCacheKey === cacheKey && this.msaaTexture && 
        this.msaaTextureSize.width === width && 
        this.msaaTextureSize.height === height) {
      // Texture is already correct, no need to recreate
      return;
    }

    // Destroy old texture if it exists and wasn't from cache
    if (this.msaaTexture && this._msaaCacheKey !== cacheKey) {
      // Only destroy if it's not in cache (cache manages its own lifecycle)
      if (!this.renderCache.hasKey(this._msaaCacheKey)) {
        try {
          this.msaaTexture.destroy();
        } catch (err) {
          // Texture may already be destroyed
        }
      }
      this.msaaTexture = null;
      this.msaaTextureSize = { width: 0, height: 0 };
    }

    try {
      // Try to get from cache or create new
      this.msaaTexture = this.renderCache.getOrCreateTexture(
        cacheKey,
        { width, height, format: this.format, sampleCount: this.sampleCount },
        () => {
          return this.device.createTexture({
            size: [width, height, 1],
            sampleCount: this.sampleCount,
            format: this.format,
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
            label: "msaa-render-target",
          });
        },
        {
          lifetime: 0, // No expiration for MSAA texture (managed by resize)
          static: false
        }
      );

      // Store size for validation
      this.msaaTextureSize = { width, height };
      this._msaaCacheKey = cacheKey;
    } catch (err) {
      console.warn('[GPURenderer] MSAA texture creation failed:', err.message);
      console.warn('[GPURenderer] This usually happens when GPU memory is exhausted (too many nodes/textures)');
      console.warn('[GPURenderer] Falling back to no MSAA (sampleCount = 1)');

      // Fall back to sampleCount = 1 (no MSAA)
      const oldSampleCount = this.sampleCount;
      this.sampleCount = 1;
      this.msaaTexture = null;
      this.msaaTextureSize = { width: 0, height: 0 };
      this._msaaCacheKey = null;

      // Mark that MSAA is permanently disabled to avoid retry spam
      this._msaaDisabled = true;

      // CRITICAL: If we have a pipeline with the old sample count, we need to recreate it
      // This prevents a mismatch between pipeline MSAA settings and render pass settings
      if (this.pipeline && oldSampleCount !== this.sampleCount && this._currentWgslCode) {
        console.warn('[GPURenderer] Recreating pipeline with sampleCount = 1');
        try {
          const currentBindingMap = analyzeBindings(this._currentWgslCode);
          this._buildLayoutsAndBindGroups(currentBindingMap);
        } catch (pipelineErr) {
          console.error('[GPURenderer] Failed to recreate pipeline:', pipelineErr);
          this.pipeline = null;
        }
      }
    }
  }

  // Explicit canvas resize method - should only be called on window resize, not during render
  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    // Update cache with current layout dimensions (only during explicit resize)
    this._cachedCanvasSize.clientWidth = this.canvas.clientWidth || window.innerWidth;
    this._cachedCanvasSize.clientHeight = this.canvas.clientHeight || window.innerHeight;
    const targetWidth = Math.max(1, Math.floor(this._cachedCanvasSize.clientWidth * dpr));
    const targetHeight = Math.max(1, Math.floor(this._cachedCanvasSize.clientHeight * dpr));

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
      // Update cache with actual canvas dimensions
      this._cachedCanvasSize.width = targetWidth;
      this._cachedCanvasSize.height = targetHeight;
      this._lastAspectWritten = null; // force aspect ratio recalculation
      this._createMSAATexture(); // Recreate MSAA texture for new size
    }
  }

  // Synchronized canvas resize - waits for GPU to finish before resizing
  // This prevents screen tearing and visual glitches during resize operations
  async resizeCanvasSync(width, height) {
    const targetWidth = Math.max(1, Math.floor(width));
    const targetHeight = Math.max(1, Math.floor(height));

    if (this.canvas.width === targetWidth && this.canvas.height === targetHeight) {
      return; // No resize needed
    }

    // CRITICAL: Stop render loop to prevent using textures during resize
    if (window.renderLoop && window.renderLoop.stop) {
      window.renderLoop.stop();
    }

    // CRITICAL: Wait for all pending GPU operations to complete
    // This prevents the canvas from being resized mid-render which causes tearing
    // Also prevents "destroyed texture" errors by ensuring all GPU work finishes
    try {
      await this.device.queue.onSubmittedWorkDone();
      // Wait a bit more to ensure textures are fully released
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (err) {
      console.warn('[GPURenderer] Failed to wait for GPU sync:', err);
    }

    // Now it's safe to resize the canvas
    this.canvas.width = targetWidth;
    this.canvas.height = targetHeight;
    // Update cache with new dimensions
    this._cachedCanvasSize.width = targetWidth;
    this._cachedCanvasSize.height = targetHeight;
    this._cachedCanvasSize.clientWidth = targetWidth; // For sync resize, client = actual
    this._cachedCanvasSize.clientHeight = targetHeight;
    this._lastAspectWritten = null; // force aspect ratio recalculation

    // Immediately recreate MSAA texture to match new canvas size
    // This prevents size mismatch errors on the next render
    this._createMSAATexture();

    // Update aspect ratio uniform for new size
    this._updateAspectUniform();
    
    // Wait a bit more to ensure new textures are ready before rendering resumes
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Create placeholder texture for optional bindings.
  createDummyTexture() {
    const texture = this.device.createTexture({
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const color = new Uint8Array([255, 255, 255, 255]);
    this.device.queue.writeTexture({ texture }, color, { bytesPerRow: 4 }, [1, 1]);
    return texture.createView();
  }

  _entryFromKind(kind, binding) {
    switch (kind) {
      case "uniform-buffer":
        // Uniform buffers can be used in both vertex and fragment stages
        return { binding, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "uniform" } };
      case "storage-buffer":
        // Storage buffers can be used in both stages
        return { binding, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } };
      case "sampler":
        // CRITICAL: Samplers should only be in FRAGMENT stage to avoid exceeding per-stage limit
        return { binding, visibility: GPUShaderStage.FRAGMENT, sampler: {} };
      case "texture-2d":
        // CRITICAL: Textures should only be in FRAGMENT stage to avoid exceeding per-stage limit
        return { binding, visibility: GPUShaderStage.FRAGMENT, texture: {} };
      case "texture-cube":
        // CRITICAL: Cube textures should only be in FRAGMENT stage
        return { binding, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "cube" } };
      default:
        return { binding, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: "uniform" } };
    }
  }

  _createResourceForBinding(meta) {
    const { kind, varDecl } = meta;
    const varName = varDecl.split(":")[0];

    switch (kind) {
      case "uniform-buffer": {
        let size = 64;
        if (varName === "u") {
          // Aspect is a single float; allocate one vec4 (16 bytes) for alignment.
          size = 16;
        } else if (varName === "g") {
          // Globals store resolution.xy, time, and 5 audio envelope values (8 floats total)
          size = 32;
        } else if (varName === "u_params") {
          // Parameter uniforms - calculate size from uniformManager
          const uniformManager = window.nodeCompiler?.uniformManager;
          if (uniformManager && uniformManager.uniformValues.size > 0) {
            const numParams = uniformManager.uniformValues.size;
            size = Math.max(16, Math.ceil(numParams * 4 / 16) * 16); // Round up to 16-byte alignment
          }
        }
        return {
          buffer: this.device.createBuffer({
            size,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: `ubuf:${varName}`,
          }),
          kind,
          varDecl,
          varName,
        };
      }
      case "storage-buffer":
        return {
          buffer: this.device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: `sbuf:${varName}`,
          }),
          kind,
          varDecl,
          varName,
        };
      case "sampler": {
        const resource = {
          sampler: this.device.createSampler({ magFilter: "linear", minFilter: "linear" }),
          kind,
          varDecl,
          varName,
        };
        this._applyExternalTextureResource(resource);
        return resource;
      }
      case "texture-2d":
      case "texture-cube": {
        const resource = {
          textureView: this.createDummyTexture(),
          kind,
          varDecl,
          varName,
        };
        this._applyExternalTextureResource(resource);
        return resource;
      }
      default:
        return {
          buffer: this.device.createBuffer({
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: `ubuf:${varName}`,
          }),
          kind: "uniform-buffer",
          varDecl,
          varName,
        };
    }
  }

  _applyExternalTextureResource(resource) {
    const texManager = typeof window !== "undefined" ? window.textureManager : null;
    if (!texManager || !resource || !resource.varName) return;

    const info = this._lookupTextureBinding(texManager, resource.varName);

    if (!info) {

      return;
    }

    if (resource.textureView && info.textureView) {
      resource.textureView = info.textureView;
    }
    if (resource.sampler && info.sampler) {
      resource.sampler = info.sampler;
    }
  }

  _lookupTextureBinding(texManager, varName) {
    const match = /^(sampler_compute_|textureCube_|texture_|samplerCube_|sampler_|compute_)(.+)$/.exec(varName);
    if (!match) return null;
    const prefix = match[1];
    const sanitizedId = match[2];

    // Check compute textures first (for compute shader nodes)
    if (prefix === 'compute_' || prefix === 'sampler_compute_') {
      const computeExecutor = typeof window !== 'undefined' ? window.computeExecutor : null;

      if (!computeExecutor) {

        return null;
      }

      if (!computeExecutor.computeTextures) {

        return null;
      }

      // Extract node ID from varName (e.g., "node_27" -> "27")
      // The format is compute_node_X or sampler_compute_node_X
      const sanitizedIdToMatch = sanitizedId.replace('node_', '');

      // Look up the current output texture from nodeOutputs (updated every frame)
      const currentOutputTexture = computeExecutor.nodeOutputs?.get(sanitizedIdToMatch);

      // Try direct lookup first
      let computeInfo = computeExecutor.computeTextures.get(sanitizedIdToMatch);

      // Use fresh texture from nodeOutputs if available
      if (currentOutputTexture && computeInfo) {
        computeInfo = { ...computeInfo, texture: currentOutputTexture };
      }

      // If not found, try fuzzy matching for sanitized IDs
      if (!computeInfo) {
        for (const [nodeId, textureData] of computeExecutor.computeTextures) {
          const nodeSanitizedId = nodeId.replace(/[^a-zA-Z0-9_]/g, "_");
          if (nodeSanitizedId === sanitizedIdToMatch) {
            const freshTexture = computeExecutor.nodeOutputs?.get(nodeId);
            computeInfo = freshTexture
              ? { ...textureData, texture: freshTexture }
              : textureData;
            break;
          }
        }
      }

      if (computeInfo) {
        // Return appropriate resource based on prefix
        if (prefix.startsWith('sampler_')) {
          return { sampler: computeInfo.sampler };
        } else {
          return { textureView: computeInfo.texture.createView() };
        }
      } else {

      }
    }

    if (texManager.gpuTextures?.get) {
      const gpuInfo = texManager.gpuTextures.get(sanitizedId);
      if (gpuInfo) {
        this._ensureTextureView(texManager, sanitizedId, gpuInfo);
        return gpuInfo;
      }
    }

    if (typeof texManager.getTexture === "function") {
      const direct = texManager.getTexture(sanitizedId);
      if (direct && (direct.textureView || direct.sampler)) {
        this._ensureTextureView(texManager, sanitizedId, direct);
        return direct;
      }
    }

    if (texManager.textures) {
      for (const [nodeId, info] of texManager.textures.entries()) {
        if (this._sanitizeId(nodeId) === sanitizedId) {
          this._ensureTextureView(texManager, nodeId, info);
          return info;
        }
      }
    }

    if (texManager.gpuTextures) {
      for (const [nodeId, info] of texManager.gpuTextures.entries()) {
        if (this._sanitizeId(nodeId) === sanitizedId) {
          this._ensureTextureView(texManager, nodeId, info);
          return info;
        }
      }
    }

    return null;
  }

  _ensureTextureView(texManager, nodeId, info) {
    if (!info) return;

    if (!info.textureView && info.texture?.createView) {
      info.textureView = info.texture.createView();
      if (texManager.gpuTextures?.set) {
        texManager.gpuTextures.set(nodeId, info);
      }
    }
  }

  _sanitizeId(id) {
    return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
  }

  _buildLayoutsAndBindGroups(bindingMap) {
    const groupIndices = Object.keys(bindingMap.groups)
      .map(Number)
      .sort((a, b) => a - b);

    const layouts = groupIndices.map((groupIndex) => {
      const bindings = bindingMap.groups[groupIndex];
      const entries = Object.keys(bindings).map((binding) =>
        this._entryFromKind(bindings[binding].kind, parseInt(binding, 10))
      );
      return this.device.createBindGroupLayout({ entries });
    });

    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: layouts });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module: this.shaderModule, entryPoint: "vs_main" },
      fragment: { module: this.shaderModule, entryPoint: "fs_main", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
      multisample: { count: this.sampleCount }, // Enable MSAA
    });

    // PERFORMANCE: Create resources first, then use optimized rebuild method
    // This ensures resources are created before we try to build bind groups
    groupIndices.forEach((groupIndex) => {
      const bindings = bindingMap.groups[groupIndex];
      Object.keys(bindings).forEach((bindingKey) => {
        const binding = parseInt(bindingKey, 10);
        const meta = bindings[binding];
        const resourceKey = `${groupIndex}:${binding}`;

        if (!this.resources[resourceKey]) {
          this.resources[resourceKey] = this._createResourceForBinding(meta);
        }
      });
    });

    // PERFORMANCE: Use optimized rebuild method with caching
    // This will build bind groups and cache them for future reuse
    this._rebuildBindGroups(true); // Force rebuild since this is initial setup
  }

  _getUniformByVarName(name) {
    const entry = Object.values(this.resources).find(
      (res) => res && res.kind === "uniform-buffer" && res.varName === name
    );
    return entry || null;
  }

  _updateAspectUniform() {
    const target = this._getUniformByVarName("u");
    if (!target?.buffer) return;

    const width = Math.max(1, this.canvas.width || 1);
    const height = Math.max(1, this.canvas.height || 1);
    const aspect = width / height;

    if (this._lastAspectWritten !== null && Math.abs(this._lastAspectWritten - aspect) < 1e-5) {
      return;
    }

    // PERFORMANCE: Reuse Float32Array to avoid allocation every frame
    if (!this._aspectUniformBuffer) {
      this._aspectUniformBuffer = new Float32Array(4);
    }
    this._aspectUniformBuffer[0] = aspect;
    this._aspectUniformBuffer[1] = 0;
    this._aspectUniformBuffer[2] = 0;
    this._aspectUniformBuffer[3] = 0;
    
    this.device.queue.writeBuffer(target.buffer, 0, this._aspectUniformBuffer);
    this._lastAspectWritten = aspect;
  }

  _writeAspectForSize(width, height) {
    const target = this._getUniformByVarName("u");
    if (!target?.buffer) return;

    const aspect = width / height;
    const data = new Float32Array([aspect, 0, 0, 0]);
    this.device.queue.writeBuffer(target.buffer, 0, data);
  }

  _updateParameterUniforms() {
    const uniformManager = window.nodeCompiler?.uniformManager;
    if (!uniformManager || uniformManager.uniformValues.size === 0) {
      return; // Silent when no uniforms - this is normal
    }

    const target = this._getUniformByVarName("u_params");
    if (!target?.buffer) {
      // Only warn once per missing buffer
      if (!this._warnedMissingParamBuffer) {

        this._warnedMissingParamBuffer = true;
      }
      return;
    }

    // PERFORMANCE: Reuse Float32Array buffer to avoid allocation every frame
    // This reduces GC pressure and frame time variance
    const values = Array.from(uniformManager.uniformValues.values());
    
    // Reuse buffer if size matches, otherwise create new one
    if (!this._paramUniformBuffer || this._paramUniformBuffer.length !== values.length) {
      this._paramUniformBuffer = new Float32Array(values);
    } else {
      // Copy values into existing buffer
      this._paramUniformBuffer.set(values);
    }

    this.device.queue.writeBuffer(target.buffer, 0, this._paramUniformBuffer.buffer, 0, this._paramUniformBuffer.byteLength);
  }

  _sendLiveParameterUpdate(timeSec) {
    // Send parameter + time updates to external viewer if streaming
    if (!window.liveShaderStream || !window.liveShaderStream.isStreaming) {
      return;
    }

    const uniformManager = window.nodeCompiler?.uniformManager;
    if (!uniformManager || uniformManager.uniformValues.size === 0) {
      return;
    }

    // Get values in order (same as _updateParameterUniforms)
    const values = Array.from(uniformManager.uniformValues.values());

    // DEBUG: Log every 60 frames (once per second at 60fps) during drag
    if (window.editor?._parameterDragging && this._dragUpdateCount % 60 === 0) {
      console.log('[gpuRenderer] Sending parameter update during drag');
      console.log('[gpuRenderer] uniformManager.uniformValues.size:', uniformManager.uniformValues.size);
      console.log('[gpuRenderer] uniformValues keys:', Array.from(uniformManager.uniformValues.keys()));
      console.log('[gpuRenderer] values array length:', values.length);
      console.log('[gpuRenderer] first 5 values:', values.slice(0, 5));
    }
    if (window.editor?._parameterDragging) {
      this._dragUpdateCount = (this._dragUpdateCount || 0) + 1;
    } else {
      this._dragUpdateCount = 0;
    }

    // Get audio envelope values for transmission to viewer
    const audioEnvelope = {
      audioEnvelope: window._audioEnvelopeValue || 0.0,
      audioEnvelopeBass: window._audioEnvelopeBass || 0.0,
      audioEnvelopeMids: window._audioEnvelopeMids || 0.0,
      audioEnvelopeHighs: window._audioEnvelopeHighs || 0.0,
      audioEnvelopeFull: window._audioEnvelopeFull || 0.0
    };

    // Send to viewer with current time for sync
    window.liveShaderStream.sendParameterUpdate(values, timeSec, null, audioEnvelope);
  }

  _updateGlobalsUniform(timeSec) {
    const target = this._getUniformByVarName("g");
    if (!target?.buffer) return;

    const width = Math.max(1, this.canvas.width || 1);
    const height = Math.max(1, this.canvas.height || 1);

    // Get all audio envelope values
    const audioEnvelope = window._audioEnvelopeValue || 0.0;
    const audioEnvelopeBass = window._audioEnvelopeBass || 0.0;
    const audioEnvelopeMids = window._audioEnvelopeMids || 0.0;
    const audioEnvelopeHighs = window._audioEnvelopeHighs || 0.0;
    const audioEnvelopeFull = window._audioEnvelopeFull || 0.0;

    // PERFORMANCE: Reuse Float32Array to avoid allocation every frame
    if (!this._globalsUniformBuffer) {
      this._globalsUniformBuffer = new Float32Array(8);
    }
    this._globalsUniformBuffer[0] = width;
    this._globalsUniformBuffer[1] = height;
    this._globalsUniformBuffer[2] = timeSec;
    this._globalsUniformBuffer[3] = audioEnvelope;
    this._globalsUniformBuffer[4] = audioEnvelopeBass;
    this._globalsUniformBuffer[5] = audioEnvelopeMids;
    this._globalsUniformBuffer[6] = audioEnvelopeHighs;
    this._globalsUniformBuffer[7] = audioEnvelopeFull;

    this.device.queue.writeBuffer(target.buffer, 0, this._globalsUniformBuffer);
  }

  _writeGlobalsForSize(width, height, timeSec) {
    const target = this._getUniformByVarName("g");
    if (!target?.buffer) return;

    // Get all audio envelope values
    const audioEnvelope = window._audioEnvelopeValue || 0.0;
    const audioEnvelopeBass = window._audioEnvelopeBass || 0.0;
    const audioEnvelopeMids = window._audioEnvelopeMids || 0.0;
    const audioEnvelopeHighs = window._audioEnvelopeHighs || 0.0;
    const audioEnvelopeFull = window._audioEnvelopeFull || 0.0;

    const data = new Float32Array([
      width, height, timeSec, audioEnvelope,
      audioEnvelopeBass, audioEnvelopeMids, audioEnvelopeHighs, audioEnvelopeFull
    ]);
    this.device.queue.writeBuffer(target.buffer, 0, data);
  }

  presentFallbackColor(color = { r: 0.5, g: 0.5, b: 0.5, a: 1.0 }) {
    if (!this.device || !this.context) return;

    // Ensure MSAA texture exists (only if MSAA is supported)
    if (this.sampleCount > 1 && !this.msaaTexture) {
      this._createMSAATexture();
    }

    const encoder = this.device.createCommandEncoder();

    // Configure color attachment based on MSAA support
    const colorAttachment = {
      loadOp: "clear",
      storeOp: "store",
      clearValue: color,
    };

    if (this.sampleCount > 1 && this.msaaTexture) {
      colorAttachment.view = this.msaaTexture.createView();
      colorAttachment.resolveTarget = this.context.getCurrentTexture().createView();
    } else {
      colorAttachment.view = this.context.getCurrentTexture().createView();
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment],
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  setShaderSource(wgslCode) {
    try {
      // FIX: Skip pipeline rebuild if shader code hasn't changed
      // This prevents black flash during parameter drags when only uniforms change
      if (this._currentWgslCode === wgslCode && this.pipeline) {
        // Shader code unchanged - just update uniforms and continue rendering
        this._updateAspectUniform();
        this._updateParameterUniforms();
        return;
      }

      // Store WGSL code for potential pipeline recreation
      this._currentWgslCode = wgslCode;

      // PERFORMANCE: Compute WGSL hash and check cache before creating shader module
      // Use synchronous djb2 hash to keep setShaderSource synchronous
      const wgslHash = hashWGSL(wgslCode, false);
      
      // Check cache for existing compiled module
      let cachedModule = this.shaderCache.get(wgslHash);
      
      if (cachedModule) {
        this.shaderModule = cachedModule;
      } else {
        // Create new shader module and store in cache
        this.shaderModule = this.device.createShaderModule({ code: wgslCode });
        this.shaderCache.set(wgslHash, this.shaderModule);
      }

      this.resources = {};
      this._lastAspectWritten = null;
      this._warnedMissingParamBuffer = false; // Reset warning flag on new shader
      const bindingMap = analyzeBindings(wgslCode);


      this._buildLayoutsAndBindGroups(bindingMap);
      this._updateAspectUniform();

      // Update parameter uniforms if they exist
      this._updateParameterUniforms();

      // Ensure MSAA texture is created when shader is set
      if (!this.msaaTexture && this.canvas.width > 0 && this.canvas.height > 0) {
        this._createMSAATexture();
      }

      this.canvas.style.backgroundColor = "";
    } catch (err) {

      this.clear();
      this.presentFallbackColor();
      this.canvas.style.backgroundColor = "#7f7f7f";
      window.previewSystem?.showNeutralFallback?.();
    }
  }

  _updateTextureBindings() {
    // Check if texture manager indicates bind groups need updating
    const texManager = typeof window !== "undefined" ? window.textureManager : null;
    if (!texManager) return;

    // Check if textures have been added/changed since last bind group build
    const needsUpdate = texManager.bindGroup === null;
    if (!needsUpdate || !this.pipeline || !this.bindGroups) return;

    // PERFORMANCE: Track if textures actually changed to avoid unnecessary bind group rebuilds
    let texturesChanged = false;
    if (!this._textureResourceHashes) {
      this._textureResourceHashes = new Map();
    }

    // Update all texture and sampler resources with newly loaded textures
    for (const resourceKey in this.resources) {
      const resource = this.resources[resourceKey];
      if (resource.kind === "texture-2d" || resource.kind === "texture-cube" || resource.kind === "sampler") {
        // Check if texture actually changed
        const previousTextureView = this._textureResourceHashes.get(resourceKey);
        this._applyExternalTextureResource(resource);
        const currentTextureView = resource.textureView;
        
        if (previousTextureView !== currentTextureView) {
          texturesChanged = true;
          this._textureResourceHashes.set(resourceKey, currentTextureView);
        }
      }
    }

    // Only rebuild bind groups if textures actually changed
    if (!texturesChanged) {
      // Mark that we've checked (even though nothing changed)
      texManager.bindGroup = {};
      return;
    }

    // PERFORMANCE: Use optimized rebuild method with caching
    // This will only rebuild if resources actually changed
    this._rebuildBindGroups(true); // Force rebuild since textures changed

    // Mark that we've updated the bind groups
    texManager.bindGroup = {};
  }

  /**
   * Generate a hash of all resources in bind groups for caching
   * This allows us to reuse bind groups when resources haven't changed
   * @private
   * @returns {string} Hash string representing current resource state
   */
  _generateResourceHash() {
    // Create a hash from all resource references
    // This is a fast way to detect if any resources changed
    const parts = [];
    
    // Sort resource keys for consistent hashing
    const sortedKeys = Object.keys(this.resources).sort();
    
    for (const resourceKey of sortedKeys) {
      const resource = this.resources[resourceKey];
      parts.push(resourceKey);
      
      if (resource.buffer) {
        // Use buffer size and label for identification
        // Buffer objects themselves are stable, but we track size changes
        parts.push(`buf:${resource.buffer.size || 0}:${resource.buffer.label || ''}`);
      } else if (resource.sampler) {
        // Samplers are stable objects, but we track their existence
        parts.push(`samp:1`);
      } else if (resource.textureView) {
        // Texture views are the actual references that change
        // Use a simple identifier - texture views are object references
        // We can't hash the object itself, but we track if it changed via reference comparison
        // The textureResourceHashes map tracks actual changes, this is just for quick comparison
        parts.push(`tex:1`);
      }
    }
    
    // Simple hash function (djb2)
    let hash = 5381;
    const str = parts.join('|');
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Rebuild bind groups from resources
   * This is the core method that creates bind groups - now with caching support
   * @private
   * @param {boolean} forceRebuild - If true, force rebuild even if hash matches
   * @returns {boolean} True if bind groups were rebuilt, false if cached
   */
  _rebuildBindGroups(forceRebuild = false) {
    if (!this.pipeline) return false;

    // Generate resource hash to check if we can reuse cached bind groups
    const resourceHash = this._generateResourceHash();
    
    // Check cache first (unless forced rebuild)
    if (!forceRebuild && resourceHash === this._lastResourceHash && this.bindGroups.length > 0) {
      // Resources haven't changed, reuse cached bind groups
      return false;
    }

    // Resources changed or cache miss - rebuild bind groups
    // Group resources by their group index
    const resourcesByGroup = new Map();
    
    for (const resourceKey in this.resources) {
      const [groupStr, bindingStr] = resourceKey.split(":");
      const group = parseInt(groupStr, 10);
      const binding = parseInt(bindingStr, 10);
      
      if (!resourcesByGroup.has(group)) {
        resourcesByGroup.set(group, []);
      }
      resourcesByGroup.get(group).push({ binding, resourceKey, resource: this.resources[resourceKey] });
    }
    
    // Get sorted group indices
    const groupIndices = Array.from(resourcesByGroup.keys()).sort((a, b) => a - b);
    const newBindGroups = [];
    
    // Build bind groups for each group index (only for groups that have resources)
    for (const groupIndex of groupIndices) {
      const groupResources = resourcesByGroup.get(groupIndex);
      const entries = [];

      // Collect all resources for this group
      for (const { binding, resource } of groupResources) {
        if (resource.buffer) {
          entries.push({ binding, resource: { buffer: resource.buffer } });
        } else if (resource.sampler) {
          entries.push({ binding, resource: resource.sampler });
        } else if (resource.textureView) {
          entries.push({ binding, resource: resource.textureView });
        }
      }

      // Skip empty groups (shouldn't happen, but safety check)
      if (entries.length === 0) continue;

      // Sort entries by binding number to ensure correct order
      entries.sort((a, b) => a.binding - b.binding);

      try {
        // Find the layout index for this group
        // The layout index corresponds to the position in the pipeline's bind group layouts
        // We need to find which layout index corresponds to this group index
        const layoutIndex = groupIndices.indexOf(groupIndex);
        
        newBindGroups[layoutIndex] = this.device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(layoutIndex),
          entries,
        });
      } catch (err) {
        console.error(`[GPURenderer] Failed to create bind group ${groupIndex} (layout ${groupIndices.indexOf(groupIndex)}):`, err);
        // Continue with other groups
      }
    }
    
    // Filter out undefined entries (in case of errors)
    this.bindGroups = newBindGroups.filter(bg => bg !== undefined);
    this._lastResourceHash = resourceHash;
    
    // Cache the bind groups (limit cache size to prevent memory leaks)
    if (this._bindGroupCache.size > 10) {
      // Remove oldest entry (simple FIFO)
      const firstKey = this._bindGroupCache.keys().next().value;
      this._bindGroupCache.delete(firstKey);
    }
    this._bindGroupCache.set(resourceHash, this.bindGroups);
    
    return true;
  }

  /**
   * Update compute texture bindings after compute shader execution
   * This ensures fragment shaders sample from the latest compute outputs
   */
  _updateComputeTextureBindings() {
    if (!this.pipeline || !this.bindGroups) return;

    const computeExecutor = typeof window !== "undefined" ? window.computeExecutor : null;
    if (!computeExecutor || !computeExecutor.initialized) return;

    // PERFORMANCE: Track if any compute textures actually changed to avoid expensive bind group rebuilds
    let hasComputeTextures = false;
    let texturesChanged = false;

    // Initialize texture change tracking if not exists
    if (!this._computeTextureHashes) {
      this._computeTextureHashes = new Map();
    }

    // Update all compute texture resources with fresh texture views from nodeOutputs
    for (const resourceKey in this.resources) {
      const resource = this.resources[resourceKey];

      // Check if this is a compute texture or sampler resource
      if (resource.varName &&
          (resource.varName.startsWith('compute_') ||
           resource.varName.startsWith('sampler_compute_'))) {

        hasComputeTextures = true;
        
        // Check if texture actually changed by comparing texture view reference
        const previousTextureView = this._computeTextureHashes.get(resourceKey);
        
        // Apply external texture resource (updates resource.textureView)
        this._applyExternalTextureResource(resource);
        
        const currentTextureView = resource.textureView;
        
        if (previousTextureView !== currentTextureView) {
          texturesChanged = true;
          this._computeTextureHashes.set(resourceKey, currentTextureView);
        }
      }
    }

    // Only rebuild bind groups if we found compute textures AND they actually changed
    if (!hasComputeTextures || !texturesChanged) {
      return;
    }

    // PERFORMANCE: Use optimized rebuild method with caching
    this._rebuildBindGroups(true); // Force rebuild since textures changed
  }

  async render(config) {
    let options = {};
    if (Array.isArray(config)) {
      options.size = config;
    } else if (config && typeof config === "object") {
      options = config;
    }

    // REMOVED: Frame-in-flight protection was too aggressive and broke preview
    // The real fix needs to be at the GPU context level, not render call limiting
    // NOTE: Frame skipping during interactions is handled at the render loop level (main.js)
    // to coordinate GPU and canvas rendering properly

    const {
      size,
      timeSec,
      devicePixelRatio: devicePixelRatioOverride,
    } = options;

    const resolvedDpr = Number.isFinite(devicePixelRatioOverride)
      ? Math.max(0.5, devicePixelRatioOverride)
      : window.devicePixelRatio || 1;

    const [sizeWidth, sizeHeight] = Array.isArray(size) ? size : [undefined, undefined];

    // CRITICAL PERFORMANCE FIX: Use cached dimensions instead of reading layout properties
    // Reading clientWidth/clientHeight forces synchronous layout recalculation, blocking the main thread
    // This was causing FPS drops during panning. Cache is updated only on explicit resize events.
    const baseWidth = Number.isFinite(sizeWidth)
      ? sizeWidth
      : this._cachedCanvasSize.clientWidth || this._cachedCanvasSize.width || 1;
    const baseHeight = Number.isFinite(sizeHeight)
      ? sizeHeight
      : this._cachedCanvasSize.clientHeight || this._cachedCanvasSize.height || 1;

    const targetWidth = Math.max(1, Math.floor(baseWidth * resolvedDpr));
    const targetHeight = Math.max(1, Math.floor(baseHeight * resolvedDpr));

    // CRITICAL FIX: NEVER resize canvas during render() - only on explicit resize events
    // Canvas resizing breaks WebGPU presentation timing and causes tearing
    // The canvas should be sized once at init or via window resize handler
    //
    // if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
    //   console.warn('[GPURenderer] Canvas size mismatch - use explicit resize instead');
    // }

    this._updateAspectUniform();

    if (!this.pipeline) {
      this.presentFallbackColor();
      return;
    }

    const timeValue = Number.isFinite(timeSec) ? timeSec : performance.now() * 0.001;
    this._updateGlobalsUniform(timeValue);

    // CRITICAL: Update parameter uniforms every frame so changes are reflected
    this._updateParameterUniforms();

    // Send parameter + time updates to external viewer for real-time sync
    this._sendLiveParameterUpdate(timeValue);

    // CRITICAL: Update texture bindings when new files are loaded
    this._updateTextureBindings();

    // Ensure MSAA texture exists and matches canvas size (only if MSAA is supported and not permanently disabled)
    if (this.sampleCount > 1 && !this._msaaDisabled) {
      if (!this.msaaTexture ||
          this.msaaTextureSize.width !== this.canvas.width ||
          this.msaaTextureSize.height !== this.canvas.height) {
        this._createMSAATexture();
      }
    }

    // Begin profiling frame
    if (this.profiler) {
      this.profiler.beginFrame();
    }

    // SEPARATE GPU RENDER QUEUES
    // Each render() call creates a new command encoder, ensuring canvas and preview
    // rendering use separate command buffers. This allows independent rendering
    // without interference between the main canvas render loop and preview render loop.
    // PERFORMANCE: Label encoder for better GPU profiling/debugging
    const encoder = this.device.createCommandEncoder({ label: 'gpu-render-encoder' });

    // Execute compute shaders BEFORE fragment shader
    if (window.computeExecutor && window.computeExecutor.initialized) {
      // Get audio envelope values for compute shader expressions
      const audioEnvelope = window._audioEnvelopeValue || 0.0;
      const audioEnvelopeBass = window._audioEnvelopeBass || 0.0;
      const audioEnvelopeMids = window._audioEnvelopeMids || 0.0;
      const audioEnvelopeHighs = window._audioEnvelopeHighs || 0.0;
      const audioEnvelopeFull = window._audioEnvelopeFull || 0.0;

      try {
        await window.computeExecutor.execute(encoder, timeValue, {
          audioEnvelope,
          audioEnvelopeBass,
          audioEnvelopeMids,
          audioEnvelopeHighs,
          audioEnvelopeFull
        });
      } catch (computeErr) {
        // Silently handle compute errors to avoid breaking render loop
        // Errors are already logged in computeExecutor.execute()
        console.warn('[GPURenderer] Compute execution error:', computeErr);
      }

      // PERFORMANCE: Only update bind groups if compute nodes were actually dispatched
      // This avoids unnecessary bind group rebuilds when compute shaders didn't run
      const computeExecutor = window.computeExecutor;
      const hasDispatchedNodes = computeExecutor && computeExecutor.dispatchedThisFrame && computeExecutor.dispatchedThisFrame.size > 0;
      
      if (hasDispatchedNodes) {
        // CRITICAL FIX: Update bind groups with fresh compute texture views
        // After compute execution, nodeOutputs has been updated with fresh textures
        // We need to update bind groups BEFORE the fragment render pass begins
        // PERFORMANCE: Only update if textures actually changed to avoid expensive bind group recreation
        // The _updateComputeTextureBindings method now uses optimized caching
        this._updateComputeTextureBindings();
      }
    }

    // Configure render pass based on MSAA support
    const colorAttachment = {
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    };

    try {
      if (this.sampleCount > 1 && this.msaaTexture) {
        // MSAA enabled - render to MSAA texture and resolve to canvas
        colorAttachment.view = this.msaaTexture.createView();
        colorAttachment.resolveTarget = this.context.getCurrentTexture().createView();
      } else {
        // No MSAA - render directly to canvas
        colorAttachment.view = this.context.getCurrentTexture().createView();
      }
    } catch (textureErr) {
      console.error('[GPURenderer] Failed to get canvas texture:', textureErr);
      console.error('[GPURenderer] This likely means GPU memory is exhausted');
      // Show a fallback color to indicate error
      this.presentFallbackColor({ r: 0.2, g: 0, b: 0, a: 1 });
      return;
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment],
    });

    if (!this.pipeline) {

      pass.end();
      return;
    }

    pass.setPipeline(this.pipeline);
    for (let i = 0; i < this.bindGroups.length; i++) {
      pass.setBindGroup(i, this.bindGroups[i]);
    }

    pass.draw(3, 1, 0, 0);
    pass.end();

    // End profiling frame
    if (this.profiler) {
      this.profiler.endFrame(encoder);
    }

    try {
      // PERFORMANCE: Submit command buffer immediately without waiting
      // This allows the render loop to continue while GPU processes the frame
      this.device.queue.submit([encoder.finish()]);
      
      // Store promise for frame presentation - allows frame capture to wait for GPU work
      // But don't await it here - let it resolve asynchronously
      this._lastFramePromise = this.device.queue.onSubmittedWorkDone?.();
    } catch (submitErr) {
      console.error('[GPURenderer] Failed to submit command buffer:', submitErr);
      console.error('[GPURenderer] This likely means GPU memory is exhausted or the device was lost');
      this._lastFramePromise = Promise.resolve();
    }
  }
  
  /**
   * Wait for the last rendered frame to be presented
   * This should be called before capturing the canvas to ensure the frame is ready
   */
  async waitForFrame() {
    if (this._lastFramePromise) {
      try {
        await this._lastFramePromise;
      } catch (err) {
        // Ignore errors - frame might already be presented
      }
    }
  }

  async captureFrame(options = {}) {
    if (!this.device) {
      throw new Error("GPU device not ready for capture");
    }
    if (!this.pipeline) {
      throw new Error("GPU pipeline missing; build shader before capturing");
    }

    // Use cached dimensions to avoid layout reads
    const targetWidth = Math.max(
      1,
      Math.floor(options.width ?? this._cachedCanvasSize.width ?? 1)
    );
    const targetHeight = Math.max(
      1,
      Math.floor(options.height ?? this._cachedCanvasSize.height ?? 1)
    );

    const captureTexture = this.device.createTexture({
      size: [targetWidth, targetHeight, 1],
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      label: "preview-capture-texture",
    });

    // Create MSAA texture for capture (only if MSAA is supported)
    let captureMSAATexture = null;
    if (this.sampleCount > 1) {
      captureMSAATexture = this.device.createTexture({
        size: [targetWidth, targetHeight, 1],
        sampleCount: this.sampleCount,
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        label: "preview-capture-msaa-texture",
      });
    }

    const bytesPerRow = Math.ceil((targetWidth * 4) / 256) * 256;
    const bufferSize = bytesPerRow * targetHeight;

    const outputBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      label: "preview-capture-buffer",
    });

    this._lastAspectWritten = null;
    const captureTime = options.timeSec ?? performance.now() * 0.001;

    this._writeAspectForSize(targetWidth, targetHeight);
    this._writeGlobalsForSize(targetWidth, targetHeight, captureTime);

    const encoder = this.device.createCommandEncoder({ label: "preview-capture-encoder" });

    // Configure color attachment based on MSAA support
    const colorAttachment = {
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    };

    if (this.sampleCount > 1 && captureMSAATexture) {
      colorAttachment.view = captureMSAATexture.createView();
      colorAttachment.resolveTarget = captureTexture.createView();
    } else {
      colorAttachment.view = captureTexture.createView();
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment],
    });

    pass.setPipeline(this.pipeline);
    for (let i = 0; i < this.bindGroups.length; i++) {
      pass.setBindGroup(i, this.bindGroups[i]);
    }
    pass.draw(3, 1, 0, 0);
    pass.end();

    encoder.copyTextureToBuffer(
      { texture: captureTexture },
      { buffer: outputBuffer, bytesPerRow },
      { width: targetWidth, height: targetHeight, depthOrArrayLayers: 1 }
    );

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone?.();

    await outputBuffer.mapAsync(GPUMapMode.READ);
    const mappedRange = outputBuffer.getMappedRange();
    const copy = new Uint8Array(mappedRange.byteLength);
    copy.set(new Uint8Array(mappedRange));
    outputBuffer.unmap();

    outputBuffer.destroy();
    captureTexture.destroy();
    if (captureMSAATexture) {
      captureMSAATexture.destroy();
    }

    this._lastAspectWritten = null;
    this._updateAspectUniform();
    this._updateGlobalsUniform(performance.now() * 0.001);

    return {
      pixels: copy,
      width: targetWidth,
      height: targetHeight,
      bytesPerRow,
    };
  }
}
