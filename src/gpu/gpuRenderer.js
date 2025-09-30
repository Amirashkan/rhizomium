// src/gpu/gpuRenderer.js
// Optimized WebGPU renderer with batched uniform updates
let _paramUniformBuffer = null;
let _uniformManager = null;
let _paramUniformData = null;

let _device = null;
let _context = null;
let _format = null;
let _canvas = null;
let _pipeline = null;
let _uniformBuffer = null;
let _bindGroup = null;

let _lastUserSrcHash = null;
let _lastCompileOK = false;
let _loggedForHash = new Set();

// PERFORMANCE OPTIMIZATION: Reuse uniform data buffer
let _uniformData = new Float32Array(4); // [time, pad1, pad2, pad3]
let _lastTimeUpdate = 0;
let _frameCount = 0;
const UNIFORM_UPDATE_INTERVAL = 16; // Update uniforms every ~16ms (60fps)

// Simple string hash
function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export async function initWebGPU(canvas) {
  if (_device) return _device;

  try {
    if (!navigator.gpu) {
      throw new Error("WebGPU not available in this browser");
    }

    _canvas = canvas || document.getElementById("gpu-canvas");
    if (!_canvas) {
      throw new Error("Canvas element not found");
    }

    _context = _canvas.getContext("webgpu");
    if (!_context) {
      throw new Error("Failed to get WebGPU context from canvas");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("WebGPU adapter not available");
    }

    _device = await adapter.requestDevice();
    if (!_device) {
      throw new Error("Failed to get WebGPU device");
    }

    _format = navigator.gpu.getPreferredCanvasFormat();
    _context.configure({
      device: _device,
      format: _format,
      alphaMode: "premultiplied",
    });

    // Create uniform buffer for time
    _uniformBuffer = _device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    console.log("WebGPU initialized successfully");
    return _device;

  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'webgpu-init',
      type: 'webgpu-error' 
    });
    throw error;
  }
}

function createDummyTexture() {
  try {
    const texture = _device.createTexture({
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    const whitePixel = new Uint8Array([255, 255, 255, 255]);
    _device.queue.writeTexture(
      { texture },
      whitePixel,
      { bytesPerRow: 4 },
      { width: 1, height: 1 },
    );

    const textureView = texture.createView();
    const sampler = _device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    return { textureView, sampler };
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'texture-creation',
      type: 'texture-error' 
    });
    throw error;
  }
}

function createDummyCubeTexture() {
  try {
    const texture = _device.createTexture({
      size: [1, 1, 6],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      dimension: "2d",
    });

    const whitePixel = new Uint8Array([255, 255, 255, 255]);
    for (let face = 0; face < 6; face++) {
      _device.queue.writeTexture(
        { texture, origin: [0, 0, face] },
        whitePixel,
        { bytesPerRow: 4 },
        { width: 1, height: 1 },
      );
    }

    const textureView = texture.createView({ dimension: "cube" });
    const sampler = _device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    return { textureView, sampler };
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'cube-texture-creation',
      type: 'texture-error' 
    });
    throw error;
  }
}

function createPipelineAndBindGroup(wgsl) {
  try {
    const module = _device.createShaderModule({ code: wgsl });

    const pipeline = _device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_main", targets: [{ format: _format }] },
      primitive: { topology: "triangle-list" },
    });

    const hasTextureSample = wgsl.includes("textureSample(");
    const hasTexture2D = hasTextureSample && wgsl.includes("texture_2d<f32>");
    const hasTextureCube = hasTextureSample && wgsl.includes("texture_cube<f32>");
    const needsTextures = hasTexture2D || hasTextureCube;
    const hasParamUniforms = _paramUniformBuffer !== null;

    console.log("Shader analysis:", {
      hasTextureSample,
      hasTexture2D,
      hasTextureCube,
      needsTextures,
      hasParamUniforms
    });

    const bindGroupLayout = pipeline.getBindGroupLayout(0);

    // Build bind group entries
    const entries = [
      { binding: 0, resource: { buffer: _uniformBuffer } }
    ];

    if (needsTextures) {
      let textureView, sampler;

      if (hasTextureCube) {
        const dummy = createDummyCubeTexture();
        textureView = dummy.textureView;
        sampler = dummy.sampler;
        console.log("Using dummy cube texture");
      } else if (hasTexture2D) {
        if (window.textureManager?.textures.size > 0) {
          const textureInfo = Array.from(window.textureManager.textures.values())[0];
          textureView = textureInfo.textureView;
          sampler = textureInfo.sampler;
          console.log("Using loaded 2D texture");
        } else {
          const dummy = createDummyTexture();
          textureView = dummy.textureView;
          sampler = dummy.sampler;
          console.log("Using dummy 2D texture");
        }
      }

      entries.push(
        { binding: 1, resource: textureView },
        { binding: 2, resource: sampler }
      );
    }

    if (hasParamUniforms) {
      const paramBinding = needsTextures ? 3 : 1;
      entries.push({
        binding: paramBinding,
        resource: { buffer: _paramUniformBuffer }
      });
      console.log(`Added parameter uniforms at binding ${paramBinding}`);
    }

    const bindGroup = _device.createBindGroup({
      layout: bindGroupLayout,
      entries: entries
    });

    console.log(`Created bind group with ${entries.length} entries`);
    return { pipeline, bindGroup };
    
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'pipeline-creation',
      type: 'compilation-error' 
    });
    throw error;
  }
}

export async function setShaderSource(wgsl, uniformManager = null) {
  if (!_device) {
    const error = new Error("initWebGPU must be called first");
    window.errorHandler?.handleError(error, { 
      component: 'shader-compilation',
      type: 'shader-error' 
    });
    throw error;
  }

  const srcHash = hash(String(wgsl || ""));
  if (srcHash === _lastUserSrcHash && !_lastCompileOK) {
    return false;
  }

  _lastUserSrcHash = srcHash;
  _uniformManager = uniformManager;

  console.log("=== SHADER COMPILATION ===");
  console.log("WGSL Source (first 500 chars):", wgsl.substring(0, 500));
  console.log("Has uniform manager:", !!uniformManager);
  console.log("Dynamic params count:", uniformManager?.uniformValues.size || 0);
  console.log("===========================");

  try {
    _device.pushErrorScope("validation");
    _device.pushErrorScope("internal");

    // Create parameter uniform buffer if needed
    if (uniformManager && uniformManager.uniformValues.size > 0) {
      const valueCount = uniformManager.uniformValues.size;
      const bufferSize = Math.max(16, Math.ceil(valueCount * 4 / 16) * 16);
      
      _paramUniformBuffer = _device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'Parameter Uniforms'
      });

      _paramUniformData = new Float32Array(Array.from(uniformManager.uniformValues.values()));
      _device.queue.writeBuffer(_paramUniformBuffer, 0, _paramUniformData);
      
      console.log(`Created parameter uniform buffer: ${bufferSize} bytes, ${valueCount} params`);
    } else {
      _paramUniformBuffer = null;
      _paramUniformData = null;
    }

    const result = createPipelineAndBindGroup(wgsl);

    const errs = await Promise.all([
      _device.popErrorScope(),
      _device.popErrorScope(),
    ]);
    const msgs = errs.filter(Boolean);
    if (msgs.length) throw msgs[0];

    _pipeline = result.pipeline;
    _bindGroup = result.bindGroup;
    _lastCompileOK = true;

    if (_bindGroup) {
      _lastTimeUpdate = 0;
    }

    console.log(`Shader compiled successfully. Has bind group: ${_bindGroup !== null}`);
    return true;
  } catch (e) {
    _lastCompileOK = false;
    if (!_loggedForHash.has(srcHash)) {
      _loggedForHash.add(srcHash);
      window.errorHandler?.handleError(e, { 
        component: 'shader-compilation',
        type: 'shader-error',
        shaderSource: wgsl
      });
    }
    return false;
  }
}

export function render() {
  if (!_device || !_context || !_pipeline) return;
  window._gpuFrameCount = (window._gpuFrameCount || 0) + 1;

  try {
    // Update time uniform
    if (_bindGroup) {
      const now = performance.now();
      if (now - _lastTimeUpdate >= UNIFORM_UPDATE_INTERVAL) {
        _uniformData[0] = now / 1000;
        _device.queue.writeBuffer(_uniformBuffer, 0, _uniformData);
        _lastTimeUpdate = now;
      }
    }

    // Update parameter uniforms if needed
    if (_uniformManager && _paramUniformBuffer && window.editor?.graph) {
      _uniformManager.updateValues(window.editor.graph);
        console.log('Frame update - params changed:', changed);
      const values = Array.from(_uniformManager.uniformValues.values());
      
      // Safety check: only update if we have values and buffer exists
      if (values.length > 0 && _paramUniformData) {
        // Check if buffer size matches
        if (values.length === _paramUniformData.length) {
          _paramUniformData.set(values);
          _device.queue.writeBuffer(_paramUniformBuffer, 0, _paramUniformData);
        } else {
          // Buffer size mismatch - shader needs recompilation
          console.warn('Parameter uniform buffer size mismatch - skipping update until recompile');
        }
      }
    }

    // Render
    const encoder = _device.createCommandEncoder();
    const view = _context.getCurrentTexture().createView();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });

    pass.setPipeline(_pipeline);

    if (_bindGroup) {
      pass.setBindGroup(0, _bindGroup);
    }

    pass.draw(3, 1, 0, 0);
    pass.end();

    _device.queue.submit([encoder.finish()]); // ← Fixed: was commandEncoder
    
    _frameCount++;
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'gpu-render',
      type: 'webgpu-error' 
    });
  }
}
export function getPerformanceStats() {
  return {
    frameCount: _frameCount,
    avgUniformUpdateInterval: UNIFORM_UPDATE_INTERVAL,
    lastTimeUpdate: _lastTimeUpdate
  };
}

// Backward-compatible aliases
export const updateShader = setShaderSource;
export const drawFrame = render;
export function clearOnce() { /* no-op */ }
export function smokeTest() { /* no-op */ }