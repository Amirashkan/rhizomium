// src/gpu/gpuRenderer.js
// Optimized WebGPU renderer with batched uniform updates

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
      size: 16, // 4 bytes for f32, padded to 16 bytes for alignment
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
    // Create a 1x1 white texture as fallback
    const texture = _device.createTexture({
      size: [1, 1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Fill with white
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
    // Create a 1x1 white cube texture as fallback
    const texture = _device.createTexture({
      size: [1, 1, 6], // 6 faces for cube
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      dimension: "2d",
    });

    // Fill all 6 faces with white
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

    // CORRECT DETECTION: Only count textures that are actually USED, not just declared
    const hasTextureSample = wgsl.includes("textureSample(");
    const hasTexture2D = hasTextureSample && wgsl.includes("texture_2d<f32>");
    const hasTextureCube = hasTextureSample && wgsl.includes("texture_cube<f32>");
    const needsTextures = hasTexture2D || hasTextureCube;

    console.log("Shader analysis:", {
      hasTextureSample,
      hasTexture2D,
      hasTextureCube,
      needsTextures,
    });

    const bindGroupLayout = pipeline.getBindGroupLayout(0);
    let bindGroup = null;

    if (needsTextures) {
      console.log("Creating texture bind group (texture is actually used)");

      let textureView, sampler;

      if (hasTextureCube) {
        // Shader expects cube texture - ALWAYS use cube texture
        const dummy = createDummyCubeTexture();
        textureView = dummy.textureView;
        sampler = dummy.sampler;
        console.log("Using dummy cube texture (shader expects cube)");
      } else if (hasTexture2D) {
        // Shader expects 2D texture - try to use loaded image
        if (window.textureManager && window.textureManager.textures.size > 0) {
          const textureInfo = Array.from(
            window.textureManager.textures.values(),
          )[0];
          textureView = textureInfo.textureView;
          sampler = textureInfo.sampler;
          console.log("Using loaded 2D texture");
        } else {
          const dummy = createDummyTexture();
          textureView = dummy.textureView;
          sampler = dummy.sampler;
          console.log("Using dummy 2D texture");
        }
      } else {
        // Fallback - use 2D dummy
        const dummy = createDummyTexture();
        textureView = dummy.textureView;
        sampler = dummy.sampler;
        console.log("Using fallback 2D texture");
      }

      bindGroup = _device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: _uniformBuffer } },
          { binding: 1, resource: textureView },
          { binding: 2, resource: sampler },
        ],
      });
      console.log("SUCCESS: Created texture bind group");
    } else {
      console.log("Creating simple bind group (texture declared but not used)");

      bindGroup = _device.createBindGroup({
        layout: bindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: _uniformBuffer } }],
      });
      console.log("SUCCESS: Created simple bind group");
    }

    return { pipeline, bindGroup };
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'pipeline-creation',
      type: 'compilation-error' 
    });
    throw error;
  }
}

export function render() {
  if (!_device || !_context || !_pipeline) return;
  window._gpuFrameCount = (window._gpuFrameCount || 0) + 1;

  try {
    // Update uniforms
    if (_bindGroup) {
      const now = performance.now();
      if (now - _lastTimeUpdate >= UNIFORM_UPDATE_INTERVAL) {
        _uniformData[0] = now / 1000;
        _device.queue.writeBuffer(_uniformBuffer, 0, _uniformData);
        _lastTimeUpdate = now;
      }
    }

    // Render
    const encoder = _device.createCommandEncoder();
    const view = _context.getCurrentTexture().createView();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    pass.setPipeline(_pipeline);

    if (_bindGroup) {
      pass.setBindGroup(0, _bindGroup);
    }

    pass.draw(3, 1, 0, 0);
    pass.end();

    _device.queue.submit([encoder.finish()]);
    
    _frameCount++;
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'gpu-render',
      type: 'webgpu-error' 
    });
  }
}

// PERFORMANCE OPTIMIZATION: Force immediate uniform update when shader changes
export async function setShaderSource(wgsl) {
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
    return false; // Already tried this broken shader
  }

  _lastUserSrcHash = srcHash;

  // Debug: log the shader to see what we're actually trying to compile
  console.log("=== SHADER COMPILATION ===");
  console.log("WGSL Source (first 500 chars):", wgsl.substring(0, 500));
  console.log("===========================");

  try {
    _device.pushErrorScope("validation");
    _device.pushErrorScope("internal");

    const result = createPipelineAndBindGroup(wgsl);

    const errs = await Promise.all([
      _device.popErrorScope(),
      _device.popErrorScope(),
    ]);
    const msgs = errs.filter(Boolean);
    if (msgs.length) throw msgs[0];

    _pipeline = result.pipeline;
    _bindGroup = result.bindGroup; // This can be null for shaders without uniforms/textures
    _lastCompileOK = true;

    // PERFORMANCE OPTIMIZATION: Force immediate uniform update after shader change
    if (_bindGroup) {
      _lastTimeUpdate = 0; // Force immediate update on next render
    }

    console.log(
      `Shader compiled successfully. Has bind group: ${_bindGroup !== null}`,
    );
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

// PERFORMANCE OPTIMIZATION: Add function to get performance stats
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
export function clearOnce() {
  /* no-op */
}
export function smokeTest() {
  /* no-op */
}