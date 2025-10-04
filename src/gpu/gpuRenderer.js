// src/gpu/gpuRenderer.js
// Optimized WebGPU renderer with resolution support

let _paramUniformBuffer = null;
let _uniformManager = null;
let _paramUniformData = null;

let _device = null;
let _context = null;
let _format = null;
let _canvas = null;
let _pipeline = null;
let _uniformBuffer = null;
let _resolutionBuffer = null;
let _bindGroup = null;

let _lastUserSrcHash = null;
let _lastCompileOK = false;
let _loggedForHash = new Set();

// PERFORMANCE OPTIMIZATION: Reuse uniform data buffers
let _uniformData = new Float32Array(4); // [time, pad1, pad2, pad3]
let _resolutionData = new Float32Array(4); // [width, height, aspectRatio, pad]
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

export async function initWebGPU(canvas, forceReconfigure = false) {
  console.log('🔧 initWebGPU called, _device exists:', !!_device, 'force:', forceReconfigure);
  
  if (_device && !forceReconfigure) {
    console.log('✅ Returning existing device');
    return _device;
  }

  console.log('🔧 Initializing/reconfiguring WebGPU...');
  
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

    // If we already have a device and just need to reconfigure
    if (_device && forceReconfigure) {
      console.log('🔄 Reconfiguring existing device with canvas');
      _format = navigator.gpu.getPreferredCanvasFormat();
      _context.configure({
        device: _device,
        format: _format,
        alphaMode: "premultiplied",
      });
      
      // Update resolution buffer with new canvas size
      if (_resolutionBuffer) {
        _resolutionData[0] = _canvas.width;
        _resolutionData[1] = _canvas.height;
        _resolutionData[2] = _canvas.width / _canvas.height;
        _device.queue.writeBuffer(_resolutionBuffer, 0, _resolutionData);
      }
      
      console.log("✅ Context reconfigured with existing device");
      return _device;
    }

    // First-time initialization: create new device
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("WebGPU adapter not available");
    }

    _device = await adapter.requestDevice();
    if (!_device) {
      throw new Error("Failed to get WebGPU device");
    }
    
    // Expose device for export functionality
    window._gpuDevice = _device;

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
    
    // Create uniform buffer for resolution
    _resolutionBuffer = _device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    // Initialize resolution data
    _resolutionData[0] = _canvas.width;
    _resolutionData[1] = _canvas.height;
    _resolutionData[2] = _canvas.width / _canvas.height;
    _device.queue.writeBuffer(_resolutionBuffer, 0, _resolutionData);

    console.log("✅ WebGPU initialized successfully");
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

    const bindGroupLayout = pipeline.getBindGroupLayout(0);

    const hasTextureSample = wgsl.includes("textureSample(");
    const hasTexture2D = hasTextureSample && wgsl.includes("texture_2d<f32>");
    const hasTextureCube = hasTextureSample && wgsl.includes("texture_cube<f32>");
    const needsTextures = hasTexture2D || hasTextureCube;
    
    // Check if shader actually has ParamUniforms struct
    const hasParamUniforms = wgsl.includes("struct ParamUniforms") && 
                             _paramUniformBuffer !== null;

    // Build bind group entries
    const entries = [
      { binding: 0, resource: { buffer: _uniformBuffer } },
      { binding: 1, resource: { buffer: _resolutionBuffer } }
    ];

    if (needsTextures) {
      let textureView, sampler;

      if (hasTextureCube) {
        const dummy = createDummyCubeTexture();
        textureView = dummy.textureView;
        sampler = dummy.sampler;
      } else if (hasTexture2D) {
        if (window.textureManager?.textures.size > 0) {
          const textureInfo = Array.from(window.textureManager.textures.values())[0];
          textureView = textureInfo.textureView;
          sampler = textureInfo.sampler;
        } else {
          const dummy = createDummyTexture();
          textureView = dummy.textureView;
          sampler = dummy.sampler;
        }
      }

      entries.push(
        { binding: 2, resource: textureView },
        { binding: 3, resource: sampler }
      );
    }

    if (hasParamUniforms) {
      const paramBinding = needsTextures ? 4 : 2;
      entries.push({
        binding: paramBinding,
        resource: { buffer: _paramUniformBuffer }
      });
    }

    const bindGroup = _device.createBindGroup({
      layout: bindGroupLayout,
      entries: entries
    });

    return { pipeline, bindGroup };
    
  } catch (error) {
    console.error('Pipeline creation error:', error);
    window.errorHandler?.handleError(error, { 
      component: 'pipeline-creation',
      type: 'compilation-error'
    });
    throw error;
  }
}

export async function setShaderSource(wgsl, uniformManager = null) {
    console.log('=== FULL SHADER SOURCE ===');
  console.log(wgsl);  // Print entire shader
  console.log('=== END SHADER ===');
  const lines = wgsl.split('\n');
console.log('=== LINES 10-25 ===');
for (let i = 9; i < 25 && i < lines.length; i++) {
  console.log(`Line ${i + 1}: ${lines[i]}`);
}
console.log('===================');
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
  
  // CLEAR OLD PIPELINE STATE BEFORE CREATING NEW ONE
_pipeline = null;
_bindGroup = null;

// Store the old buffer to destroy AFTER creating the new one
const oldBuffer = _paramUniformBuffer;

_uniformManager = uniformManager;

try {
  _device.pushErrorScope("validation");
  _device.pushErrorScope("internal");

  if (uniformManager && uniformManager.uniformValues.size > 0) {
    const valueCount = uniformManager.uniformValues.size;
    const bufferSize = Math.max(16, Math.ceil(valueCount * 4 / 16) * 16);
    
    // Create NEW buffer first
    _paramUniformBuffer = _device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'Parameter Uniforms'
    });

    _paramUniformData = new Float32Array(valueCount);
    _paramUniformData.set(Array.from(uniformManager.uniformValues.values()));
    _device.queue.writeBuffer(_paramUniformBuffer, 0, _paramUniformData);
    
    // Now destroy the old buffer AFTER the new one is ready
    if (oldBuffer && oldBuffer !== _paramUniformBuffer) {
      // Wait one frame before destroying to ensure no pending operations
      requestAnimationFrame(() => {
        oldBuffer.destroy();
      });
    }
  } else {
    _paramUniformBuffer = null;
    _paramUniformData = null;
    
    // Destroy old buffer after a frame
    if (oldBuffer) {
      requestAnimationFrame(() => {
        oldBuffer.destroy();
      });
    }
  }
    const result = createPipelineAndBindGroup(wgsl);

    const errs = await Promise.all([
      _device.popErrorScope(),
      _device.popErrorScope(),
    ]);
    const msgs = errs.filter(Boolean);
    
    if (msgs.length) {
      console.warn('WebGPU validation error during shader compilation:', msgs[0]);
      window.errorHandler?.handleError(msgs[0], { 
        component: 'shader-compilation',
        type: 'shader-warning'
      });
      _lastCompileOK = false;
      return false;
    }

    _pipeline = result.pipeline;
    _bindGroup = result.bindGroup;
    _lastCompileOK = true;

    if (_bindGroup) {
      _lastTimeUpdate = 0;
    }

    console.log(`Shader compiled successfully`);
    return true;
  } catch (e) {
    _lastCompileOK = false;
    if (!_loggedForHash.has(srcHash)) {
      _loggedForHash.add(srcHash);
      window.errorHandler?.handleError(e, { 
        component: 'shader-compilation',
        type: 'shader-error'
      });
    }
    return false;
  }
}

export function clearPipeline() {
  console.log('🧹 Clearing GPU pipeline and resources');
  
  try {
    if (_paramUniformBuffer) {
      _paramUniformBuffer.destroy();
      _paramUniformBuffer = null;
      _paramUniformData = null;
    }
    
    _uniformManager = null;
    _pipeline = null;
    _bindGroup = null;
    _lastCompileOK = false;
    _lastUserSrcHash = null;
    
    if (_device && _context) {
      try {
        const encoder = _device.createCommandEncoder();
        const view = _context.getCurrentTexture().createView();
        
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view,
            clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        });
        pass.end();
        
        _device.queue.submit([encoder.finish()]);
        console.log('✅ Canvas cleared successfully');
      } catch (clearError) {
        console.warn('Could not clear canvas:', clearError);
      }
    }
    
    console.log('✅ Pipeline cleared successfully');
  } catch (error) {
    console.error('Error clearing pipeline:', error);
    window.errorHandler?.handleError(error, { 
      component: 'gpu-pipeline-clear',
      type: 'webgpu-error' 
    });
  }
}

export function render() {
  if (!_device || !_context || !_pipeline || !_bindGroup) {
    return;
  }
  
  window._gpuFrameCount = (window._gpuFrameCount || 0) + 1;

  try {
    const now = performance.now();
    
    // Update time uniform
    if (_bindGroup && now - _lastTimeUpdate >= UNIFORM_UPDATE_INTERVAL) {
      _uniformData[0] = now / 1000;
      _device.queue.writeBuffer(_uniformBuffer, 0, _uniformData);
      _lastTimeUpdate = now;
    }

    // Update resolution if canvas size changed
    if (_canvas && _resolutionBuffer) {
      if (_resolutionData[0] !== _canvas.width || _resolutionData[1] !== _canvas.height) {
        _resolutionData[0] = _canvas.width;
        _resolutionData[1] = _canvas.height;
        _resolutionData[2] = _canvas.width / _canvas.height;
        _device.queue.writeBuffer(_resolutionBuffer, 0, _resolutionData);
      }
    }

    // CRITICAL: Update parameter uniforms EVERY FRAME
    if (_uniformManager && _paramUniformBuffer && _paramUniformData) {
      // Update the uniform values (re-evaluates dynamic expressions with current time)
      if (window.editor?.graph) {
        if (_uniformManager && _paramUniformBuffer && _paramUniformData) {
  const values = Array.from(_uniformManager.uniformValues.values());
  if (values.length > 0 && values.length === _paramUniformData.length) {
    _paramUniformData.set(values);
    _device.queue.writeBuffer(_paramUniformBuffer, 0, _paramUniformData);
  }
}
      }
      
      // Write updated values to GPU
      const values = Array.from(_uniformManager.uniformValues.values());
      if (values.length > 0 && values.length === _paramUniformData.length) {
        _paramUniformData.set(values);
        _device.queue.writeBuffer(_paramUniformBuffer, 0, _paramUniformData);
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

    _device.queue.submit([encoder.finish()]);
    
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

export const updateShader = setShaderSource;
export const drawFrame = render;
export function clearOnce() { /* no-op */ }
export function smokeTest() { /* no-op */ }
// Add this export function at the bottom of gpuRenderer.js
export function forceReset() {
  console.log('🔥 FORCE RESETTING GPU STATE');
  
  // Destroy everything
  if (_paramUniformBuffer) {
    _paramUniformBuffer.destroy();
  }
  
  _paramUniformBuffer = null;
  _uniformManager = null;
  _paramUniformData = null;
  _pipeline = null;
  _bindGroup = null;
  _lastUserSrcHash = null;
  _lastCompileOK = false;
  _loggedForHash.clear();
  
  console.log('✅ GPU state reset complete');
}