// src/gpu/gpuRenderer.js
// WebGPU renderer with explicit aspect uniform management and safe fallbacks.

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
    
    // PERFORMANCE: Shader module cache to avoid recompiling identical WGSL code
    this.shaderCache = shaderModuleCache;
  }

  clear() {
    this.pipeline = null;
    this.bindGroups = [];
    this.resources = {};
    this.shaderModule = null;
    this._lastAspectWritten = null;
    this._lastShaderSource = null; // PERFORMANCE: Clear shader cache on reset
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
    if (!info) return;

    if (resource.textureView && info.textureView) {
      resource.textureView = info.textureView;
    }
    if (resource.sampler && info.sampler) {
      resource.sampler = info.sampler;
    }
  }

  _lookupTextureBinding(texManager, varName) {
    const match = /^(textureCube_|texture_|samplerCube_|sampler_)(.+)$/.exec(varName);
    if (!match) return null;
    const sanitizedId = match[2];

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
    console.log(`[GPURenderer] aspect uniform <- ${aspect.toFixed(4)} (${width}x${height})`);
  }

  _writeAspectForSize(width, height) {
    const target = this._getUniformByVarName("u");
    if (!target?.buffer) return;

    const aspect = width / height;
    const data = new Float32Array([aspect, 0, 0, 0]);
    this.device.queue.writeBuffer(target.buffer, 0, data);
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

    // Debug logging (every 2 seconds)
    if (!this._lastGPUDebugLog || Date.now() - this._lastGPUDebugLog > 2000) {
      console.log('[GPU] Writing envelope uniforms:', {
        bass: audioEnvelopeBass.toFixed(3),
        mids: audioEnvelopeMids.toFixed(3),
        highs: audioEnvelopeHighs.toFixed(3),
        full: audioEnvelopeFull.toFixed(3)
      });
      this._lastGPUDebugLog = Date.now();
    }

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

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: color,
      }],
    });
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  setShaderSource(wgslCode) {
    try {
      // PERFORMANCE: Skip GPU pipeline recreation if shader code hasn't changed
      // This was causing <10 FPS during parameter dragging:
      // - Every parameter change called this function
      // - GPU shader compilation + pipeline recreation = 5-20ms
      // - At 60 events/sec = 300-1200ms overhead/sec
      if (this._lastShaderSource === wgslCode) {
        console.log("[GPURenderer] Shader unchanged - skipping pipeline recreation");
        return; // Same shader, no need to recreate GPU pipeline
      }

      console.log("[GPURenderer] Shader changed - recreating pipeline");
      this._lastShaderSource = wgslCode;

      // PERFORMANCE: Compute WGSL hash and check cache before creating shader module
      // Use synchronous djb2 hash to keep setShaderSource synchronous
      const wgslHash = hashWGSL(wgslCode, false);
      
      // Check cache for existing compiled module
      let cachedModule = this.shaderCache.get(wgslHash);
      
      if (cachedModule) {
        console.log(`[GPURenderer] Using cached shader module (hash: ${wgslHash.substring(0, 16)}...)`);
        this.shaderModule = cachedModule;
      } else {
        // Create new shader module and store in cache
        console.log(`[GPURenderer] Compiling new shader module (hash: ${wgslHash.substring(0, 16)}...)`);
        this.shaderModule = this.device.createShaderModule({ code: wgslCode });
        this.shaderCache.set(wgslHash, this.shaderModule);
      }

      this.resources = {};
      this._lastAspectWritten = null;
      const bindingMap = analyzeBindings(wgslCode);
      this._buildLayoutsAndBindGroups(bindingMap);
      this._updateAspectUniform();
      this.canvas.style.backgroundColor = "";
      console.log("[GPURenderer] Shader compiled & pipeline created");
    } catch (err) {
      console.error("[GPURenderer] Shader compile/pipeline error:", err);
      this.clear();
      this.presentFallbackColor();
      this.canvas.style.backgroundColor = "#7f7f7f";
      window.previewSystem?.showNeutralFallback?.();
    }
  }

  render(config) {
    let options = {};
    if (Array.isArray(config)) {
      options.size = config;
    } else if (config && typeof config === "object") {
      options = config;
    }

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

    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
      this._lastAspectWritten = null; // force update after resize
    }

    this._updateAspectUniform();

    if (!this.pipeline) {
      this.presentFallbackColor();
      return;
    }

    const timeValue = Number.isFinite(timeSec) ? timeSec : performance.now() * 0.001;
    this._updateGlobalsUniform(timeValue);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });

    pass.setPipeline(this.pipeline);
    for (let i = 0; i < this.bindGroups.length; i++) {
      pass.setBindGroup(i, this.bindGroups[i]);
    }

    pass.draw(3, 1, 0, 0);
    pass.end();
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
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: captureTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
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
