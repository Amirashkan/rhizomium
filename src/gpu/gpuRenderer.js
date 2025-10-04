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
  // Check gpuTextures instead of textures
  if (window.textureManager?.gpuTextures?.size > 0) {
    const gpuTexture = Array.from(window.textureManager.gpuTextures.values())[0];
    textureView = gpuTexture.texture.createView();
    sampler = gpuTexture.sampler;
    console.log('✅ Using uploaded GPU texture');
  } else {
    const dummy = createDummyTexture();
    textureView = dummy.textureView;
    sampler = dummy.sampler;
    console.log('⚠️ No textures uploaded, using placeholder');
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
}// src/gpu/gpuRenderer.js

export class GPURenderer {
  constructor() {
    this.device = null;
    this.context = null;
    this.renderPipeline = null;
    this.bindGroup0 = null;
    this.bindGroup1 = null;
    this.bindGroup2 = null;
    this.uniformBuffer = null;
    this.vertexBuffer = null;
    this.canvas = null;
    this.textureBindings = new Map();
    this.placeholderTexture = null; // Default 1x1 white texture
    this.placeholderSampler = null;
  }

  /**
   * Initialize WebGPU and create placeholder texture
   */
  async init(canvas, shaderCode) {
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported");
    }

    this.canvas = canvas;
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter.requestDevice();
    this.context = canvas.getContext("webgpu");

    const format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: format,
      alphaMode: "premultiplied",
    });

    // Create placeholder 1x1 white texture
    await this.createPlaceholderTexture();

    // Setup pipeline
    await this.setupPipeline(shaderCode, format);
    this.setupGeometry();
  }

  /**
   * Create a 1x1 white texture to use as placeholder
   */
  async createPlaceholderTexture() {
    // Create 1x1 white texture
    this.placeholderTexture = this.device.createTexture({
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });

    // Write white pixel data
    const whitePixel = new Uint8Array([255, 255, 255, 255]);
    this.device.queue.writeTexture(
      { texture: this.placeholderTexture },
      whitePixel,
      { bytesPerRow: 4 },
      { width: 1, height: 1 }
    );

    // Create sampler for placeholder
    this.placeholderSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });

    console.log('✓ Created placeholder texture (1x1 white)');
  }

  /**
   * Get texture or placeholder
   */
  getTextureOrPlaceholder(textureId) {
    const textureInfo = this.textureBindings.get(textureId);
    if (textureInfo && textureInfo.texture) {
      return {
        texture: textureInfo.texture,
        sampler: textureInfo.sampler
      };
    }
    // Return placeholder if texture not found
    return {
      texture: this.placeholderTexture,
      sampler: this.placeholderSampler
    };
  }

  /**
   * Setup render pipeline with shader code
   */
  async setupPipeline(shaderCode, format) {
    const shaderModule = this.device.createShaderModule({
      code: shaderCode,
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [
        // Bind Group 0: Uniforms
        this.device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform" },
            },
          ],
        }),
        // Bind Group 1: Parameters
        this.device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.FRAGMENT,
              buffer: { type: "uniform" },
            },
          ],
        }),
        // Bind Group 2: Textures (dynamic, created later)
        this.createTextureBindGroupLayout(),
      ],
    });

    this.renderPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 8,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x2" },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [{ format: format }],
      },
      primitive: { topology: "triangle-list" },
    });
  }

  /**
   * Create bind group layout for textures
   * Returns a layout that supports up to 8 textures
   */
  createTextureBindGroupLayout() {
    const entries = [];
    
    // Support up to 8 textures (adjust as needed)
    for (let i = 0; i < 8; i++) {
      entries.push(
        {
          binding: i * 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: i * 2 + 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: {},
        }
      );
    }

    return this.device.createBindGroupLayout({ entries });
  }

  /**
   * Setup geometry (fullscreen quad)
   */
  setupGeometry() {
    const vertices = new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1,
    ]);

    this.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.vertexBuffer, 0, vertices);
  }

  /**
   * Update uniform buffer (resolution, time, etc.)
   */
  updateUniforms(uniforms) {
    if (!this.uniformBuffer) {
      this.uniformBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.bindGroup0 = this.device.createBindGroup({
        layout: this.renderPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
    }

    const data = new Float32Array([
      uniforms.resolution[0],
      uniforms.resolution[1],
      uniforms.time || 0,
      0,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  /**
   * Update parameter buffer
   */
  updateParameters(parameters) {
    if (!parameters || parameters.length === 0) {
      parameters = [0, 0, 0, 0]; // Default empty parameters
    }

    if (!this.parameterBuffer) {
      this.parameterBuffer = this.device.createBuffer({
        size: Math.max(parameters.length * 4, 16),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      this.bindGroup1 = this.device.createBindGroup({
        layout: this.renderPipeline.getBindGroupLayout(1),
        entries: [{ binding: 0, resource: { buffer: this.parameterBuffer } }],
      });
    }

    this.device.queue.writeBuffer(
      this.parameterBuffer,
      0,
      new Float32Array(parameters)
    );
  }

  /**
   * Update texture bindings - always creates bind group even if no textures
   */
// In gpuRenderer.js - add this method
updateTextureBindings(textureIds) {
  const entries = [];
  
  // Get textures from TextureManager
  for (let i = 0; i < textureIds.length; i++) {
    const nodeId = textureIds[i];
    
    // Get GPU texture from TextureManager
    const gpuTexture = window.textureManager?.gpuTextures?.get(nodeId);
    
    if (gpuTexture && gpuTexture.texture && gpuTexture.sampler) {
      entries.push(
        {
          binding: i * 2,
          resource: gpuTexture.texture.createView(),
        },
        {
          binding: i * 2 + 1,
          resource: gpuTexture.sampler,
        }
      );
      console.log(`✅ Added texture binding for node ${nodeId}`);
    } else {
      console.warn(`❌ No GPU texture for node ${nodeId}, using placeholder`);
      // Use placeholder
      entries.push(
        {
          binding: i * 2,
          resource: this.placeholderTexture.createView(),
        },
        {
          binding: i * 2 + 1,
          resource: this.placeholderSampler,
        }
      );
    }
  }
  
  // Create bind group with texture entries
  this.bindGroup2 = this.device.createBindGroup({
    layout: this.renderPipeline.getBindGroupLayout(2),
    entries: entries,
  });
  
  console.log(`✅ Created bind group with ${textureIds.length} texture(s)`);
}

  /**
   * Upload texture from ImageBitmap or HTMLImageElement
   */
  async uploadTexture(textureId, imageSource) {
    // Create texture
    const texture = this.device.createTexture({
      size: { width: imageSource.width, height: imageSource.height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | 
             GPUTextureUsage.COPY_DST | 
             GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Copy image data to texture
    this.device.queue.copyExternalImageToTexture(
      { source: imageSource },
      { texture: texture },
      { width: imageSource.width, height: imageSource.height }
    );

    // Create sampler
    const sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
    });

    // Store in map
    this.textureBindings.set(textureId, { texture, sampler });
    
    console.log(`✓ Uploaded texture: ${textureId} (${imageSource.width}x${imageSource.height})`);
  }

  /**
   * Render frame
   */
  render() {
    if (!this.renderPipeline || !this.bindGroup0 || !this.bindGroup1) {
      console.warn('Pipeline not ready');
      return;
    }

    // Ensure bind group 2 exists (create with placeholder if needed)
    if (!this.bindGroup2) {
      this.updateTextureBindings([]);
    }

    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          storeOp: "store",
        },
      ],
    });

    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.bindGroup0);
    renderPass.setBindGroup(1, this.bindGroup1);
    renderPass.setBindGroup(2, this.bindGroup2);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.draw(6);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Cleanup resources
   */
  dispose() {
    if (this.uniformBuffer) this.uniformBuffer.destroy();
    if (this.parameterBuffer) this.parameterBuffer.destroy();
    if (this.vertexBuffer) this.vertexBuffer.destroy();
    if (this.placeholderTexture) this.placeholderTexture.destroy();
    
    // Cleanup all uploaded textures
    for (const [id, info] of this.textureBindings) {
      if (info.texture) info.texture.destroy();
    }
    this.textureBindings.clear();
  }
}