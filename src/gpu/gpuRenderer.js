// src/gpu/gpuRenderer.js
// WebGPU renderer with explicit aspect uniform management and safe fallbacks.

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
    this.profiler = null; // ComputeProfiler instance
  }

  clear() {
    this.pipeline = null;
    this.bindGroups = [];
    this.resources = {};
    this.shaderModule = null;
    this._lastAspectWritten = null;
  }

  // Create or recreate MSAA texture to match canvas size
  _createMSAATexture() {
    if (this.msaaTexture) {
      this.msaaTexture.destroy();
    }

    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);

    try {
      this.msaaTexture = this.device.createTexture({
        size: [width, height, 1],
        sampleCount: this.sampleCount,
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        label: "msaa-render-target",
      });
    } catch (err) {
      // Fall back to sampleCount = 1 (no MSAA)
      this.sampleCount = 1;
      this.msaaTexture = null;
      // Will need to recreate pipeline without MSAA

    }
  }

  // Explicit canvas resize method - should only be called on window resize, not during render
  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.floor((this.canvas.clientWidth || window.innerWidth) * dpr));
    const targetHeight = Math.max(1, Math.floor((this.canvas.clientHeight || window.innerHeight) * dpr));

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
      this._lastAspectWritten = null; // force aspect ratio recalculation
      this._createMSAATexture(); // Recreate MSAA texture for new size
    }
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
        return { binding, visibility: STAGES, buffer: { type: "uniform" } };
      case "storage-buffer":
        return { binding, visibility: STAGES, buffer: { type: "read-only-storage" } };
      case "sampler":
        return { binding, visibility: STAGES, sampler: {} };
      case "texture-2d":
        return { binding, visibility: STAGES, texture: {} };
      case "texture-cube":
        return { binding, visibility: STAGES, texture: { viewDimension: "cube" } };
      default:
        return { binding, visibility: STAGES, buffer: { type: "uniform" } };
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

    this.bindGroups = groupIndices.map((groupIndex, layoutIndex) => {
      const bindings = bindingMap.groups[groupIndex];
      const entries = Object.keys(bindings).map((bindingKey) => {
        const binding = parseInt(bindingKey, 10);
        const meta = bindings[binding];
        const resourceKey = `${groupIndex}:${binding}`;

        if (!this.resources[resourceKey]) {
          this.resources[resourceKey] = this._createResourceForBinding(meta);
        }

        const resource = this.resources[resourceKey];
        if (resource.buffer) {
          return { binding, resource: { buffer: resource.buffer } };
        }
        if (resource.sampler) {
          return { binding, resource: resource.sampler };
        }
        if (resource.textureView) {
          return { binding, resource: resource.textureView };
        }
        throw new Error(`Unsupported resource for binding ${resourceKey}`);
      });

      return this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(layoutIndex),
        entries,
      });
    });
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

    const data = new Float32Array([aspect, 0, 0, 0]);
    this.device.queue.writeBuffer(target.buffer, 0, data);
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

    // Get values in order and write to buffer
    const values = Array.from(uniformManager.uniformValues.values());
    const data = new Float32Array(values);

    this.device.queue.writeBuffer(target.buffer, 0, data.buffer, 0, data.byteLength);
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

    // Send to viewer with current time for sync
    window.liveShaderStream.sendParameterUpdate(values, timeSec);
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

    const data = new Float32Array([
      width, height, timeSec, audioEnvelope,
      audioEnvelopeBass, audioEnvelopeMids, audioEnvelopeHighs, audioEnvelopeFull
    ]);

    this.device.queue.writeBuffer(target.buffer, 0, data);
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


      this.shaderModule = this.device.createShaderModule({ code: wgslCode });
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

    // Update all texture and sampler resources with newly loaded textures
    for (const resourceKey in this.resources) {
      const resource = this.resources[resourceKey];
      if (resource.kind === "texture-2d" || resource.kind === "texture-cube" || resource.kind === "sampler") {
        this._applyExternalTextureResource(resource);
      }
    }

    // Rebuild bind groups with updated texture resources
    this.bindGroups = this.bindGroups.map((_, layoutIndex) => {
      const entries = [];

      // Collect all resources for this group
      for (const resourceKey in this.resources) {
        const [groupStr, bindingStr] = resourceKey.split(":");
        const group = parseInt(groupStr, 10);
        const binding = parseInt(bindingStr, 10);

        if (group === layoutIndex) {
          const resource = this.resources[resourceKey];
          if (resource.buffer) {
            entries.push({ binding, resource: { buffer: resource.buffer } });
          } else if (resource.sampler) {
            entries.push({ binding, resource: resource.sampler });
          } else if (resource.textureView) {
            entries.push({ binding, resource: resource.textureView });
          }
        }
      }

      // Sort entries by binding number to ensure correct order
      entries.sort((a, b) => a.binding - b.binding);

      return this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(layoutIndex),
        entries,
      });
    });

    // Mark that we've updated the bind groups
    texManager.bindGroup = {};
  }

  /**
   * Update compute texture bindings after compute shader execution
   * This ensures fragment shaders sample from the latest compute outputs
   */
  _updateComputeTextureBindings() {
    if (!this.pipeline || !this.bindGroups) return;

    const computeExecutor = typeof window !== "undefined" ? window.computeExecutor : null;
    if (!computeExecutor || !computeExecutor.initialized) return;

    // Track if any compute textures were updated
    let hasComputeTextures = false;

    // Update all compute texture resources with fresh texture views from nodeOutputs
    for (const resourceKey in this.resources) {
      const resource = this.resources[resourceKey];

      // Check if this is a compute texture or sampler resource
      if (resource.varName &&
          (resource.varName.startsWith('compute_') ||
           resource.varName.startsWith('sampler_compute_'))) {

        this._applyExternalTextureResource(resource);
        hasComputeTextures = true;
      }
    }

    // Only rebuild bind groups if we found compute textures
    if (!hasComputeTextures) {
      return;
    }

    // Rebuild bind groups with updated compute texture resources
    this.bindGroups = this.bindGroups.map((_, layoutIndex) => {
      const entries = [];

      // Collect all resources for this group
      for (const resourceKey in this.resources) {
        const [groupStr, bindingStr] = resourceKey.split(":");
        const group = parseInt(groupStr, 10);
        const binding = parseInt(bindingStr, 10);

        if (group === layoutIndex) {
          const resource = this.resources[resourceKey];
          if (resource.buffer) {
            entries.push({ binding, resource: { buffer: resource.buffer } });
          } else if (resource.sampler) {
            entries.push({ binding, resource: resource.sampler });
          } else if (resource.textureView) {
            entries.push({ binding, resource: resource.textureView });
          }
        }
      }

      // Sort entries by binding number to ensure correct order
      entries.sort((a, b) => a.binding - b.binding);

      return this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(layoutIndex),
        entries,
      });
    });

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

    const {
      size,
      timeSec,
      devicePixelRatio: devicePixelRatioOverride,
    } = options;

    const resolvedDpr = Number.isFinite(devicePixelRatioOverride)
      ? Math.max(0.5, devicePixelRatioOverride)
      : window.devicePixelRatio || 1;

    const [sizeWidth, sizeHeight] = Array.isArray(size) ? size : [undefined, undefined];

    const baseWidth = Number.isFinite(sizeWidth)
      ? sizeWidth
      : this.canvas.clientWidth || this.canvas.width || 1;
    const baseHeight = Number.isFinite(sizeHeight)
      ? sizeHeight
      : this.canvas.clientHeight || this.canvas.height || 1;

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

    // Ensure MSAA texture exists and matches canvas size (only if MSAA is supported)
    if (this.sampleCount > 1) {
      if (!this.msaaTexture ||
          this.msaaTexture.width !== this.canvas.width ||
          this.msaaTexture.height !== this.canvas.height) {
        this._createMSAATexture();
      }
    }

    // Begin profiling frame
    if (this.profiler) {
      this.profiler.beginFrame();
    }

    const encoder = this.device.createCommandEncoder();

    // Execute compute shaders BEFORE fragment shader
    if (window.computeExecutor && window.computeExecutor.initialized) {
      // Get audio envelope values for compute shader expressions
      const audioEnvelope = window._audioEnvelopeValue || 0.0;
      const audioEnvelopeBass = window._audioEnvelopeBass || 0.0;
      const audioEnvelopeMids = window._audioEnvelopeMids || 0.0;
      const audioEnvelopeHighs = window._audioEnvelopeHighs || 0.0;
      const audioEnvelopeFull = window._audioEnvelopeFull || 0.0;

      await window.computeExecutor.execute(encoder, timeValue, {
        audioEnvelope,
        audioEnvelopeBass,
        audioEnvelopeMids,
        audioEnvelopeHighs,
        audioEnvelopeFull
      });

      // CRITICAL FIX: Update bind groups with fresh compute texture views
      // After compute execution, nodeOutputs has been updated with fresh textures
      // We need to update bind groups BEFORE the fragment render pass begins
      this._updateComputeTextureBindings();
    }

    // Configure render pass based on MSAA support
    const colorAttachment = {
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    };

    if (this.sampleCount > 1 && this.msaaTexture) {
      // MSAA enabled - render to MSAA texture and resolve to canvas
      colorAttachment.view = this.msaaTexture.createView();
      colorAttachment.resolveTarget = this.context.getCurrentTexture().createView();
    } else {
      // No MSAA - render directly to canvas
      colorAttachment.view = this.context.getCurrentTexture().createView();
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

    this.device.queue.submit([encoder.finish()]);
  }

  async captureFrame(options = {}) {
    if (!this.device) {
      throw new Error("GPU device not ready for capture");
    }
    if (!this.pipeline) {
      throw new Error("GPU pipeline missing; build shader before capturing");
    }

    const targetWidth = Math.max(
      1,
      Math.floor(options.width ?? this.canvas.width ?? this.canvas.clientWidth ?? 1)
    );
    const targetHeight = Math.max(
      1,
      Math.floor(options.height ?? this.canvas.height ?? this.canvas.clientHeight ?? 1)
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
