// src/gpu/gpuRenderer.js
// ✅ Stable single-instance WebGPU renderer for Rhizomium

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

let _uniformData = new Float32Array(4);      // [time, pad1, pad2, pad3]
let _resolutionData = new Float32Array(4);   // [width, height, aspect, pad]
let _lastTimeUpdate = 0;
let _frameCount = 0;
const UNIFORM_UPDATE_INTERVAL = 16; // ~60fps

// Hash utility
function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export async function initWebGPU(canvas, forceReconfigure = false) {
  console.log("🔧 initWebGPU called, _device exists:", !!_device, "force:", forceReconfigure);

  if (_device && !forceReconfigure) {
    console.log("✅ Returning existing device");
    return _device;
  }

  try {
    if (!navigator.gpu) throw new Error("WebGPU not available in this browser");

    _canvas = canvas || document.getElementById("gpu-canvas");
    if (!_canvas) throw new Error("Canvas element not found");

    _context = _canvas.getContext("webgpu");
    if (!_context) throw new Error("Failed to get WebGPU context");

    const adapter = await navigator.gpu.requestAdapter();
    _device = await adapter.requestDevice();
    window._gpuDevice = _device;

    _format = navigator.gpu.getPreferredCanvasFormat();
    _context.configure({
      device: _device,
      format: _format,
      alphaMode: "premultiplied",
    });

    _uniformBuffer = _device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    _resolutionBuffer = _device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    _resolutionData[0] = _canvas.width;
    _resolutionData[1] = _canvas.height;
    _resolutionData[2] = _canvas.width / _canvas.height;
    _device.queue.writeBuffer(_resolutionBuffer, 0, _resolutionData);

    console.log("✅ WebGPU initialized successfully");
    return _device;
  } catch (error) {
    window.errorHandler?.handleError(error, { component: "webgpu-init" });
    throw error;
  }
}

function createDummyTexture() {
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
    { width: 1, height: 1 }
  );

  const textureView = texture.createView();
  const sampler = _device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  return { textureView, sampler };
}

function createDummyCubeTexture() {
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
      { width: 1, height: 1 }
    );
  }

  const textureView = texture.createView({ dimension: "cube" });
  const sampler = _device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  });

  return { textureView, sampler };
}

function createPipelineAndBindGroup(wgsl) {
  const module = _device.createShaderModule({ code: wgsl });
  const pipeline = _device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs_main" },
    fragment: { module, entryPoint: "fs_main", targets: [{ format: _format }] },
    primitive: { topology: "triangle-list" },
  });

  const bindGroupLayout = pipeline.getBindGroupLayout(0);
  const hasParamUniforms = wgsl.includes("struct ParamUniforms") && _paramUniformBuffer !== null;

  const entries = [
    { binding: 0, resource: { buffer: _uniformBuffer } },
    { binding: 1, resource: { buffer: _resolutionBuffer } },
  ];

  if (hasParamUniforms) {
    entries.push({ binding: 2, resource: { buffer: _paramUniformBuffer } });
  }

  const hasTextureSample = wgsl.includes("textureSample(");
  if (hasTextureSample) {
    const isCube = wgsl.includes("texture_cube<f32>");
    const dummy = isCube ? createDummyCubeTexture() : createDummyTexture();
    entries.push(
      { binding: 3, resource: dummy.textureView },
      { binding: 4, resource: dummy.sampler }
    );
  }

  const bindGroup = _device.createBindGroup({
    layout: bindGroupLayout,
    entries,
  });

  return { pipeline, bindGroup };
}

// ✅ Fixed version – no "this.device"
export async function setShaderSource(wgsl, uniformManager = null) {
  try {
    if (!_device) {
      console.error("❌ GPU device not initialized");
      return;
    }

    const { pipeline, bindGroup } = createPipelineAndBindGroup(wgsl);
    _pipeline = pipeline;
    _bindGroup = bindGroup;

    console.log("✅ Shader compiled successfully");

    if (uniformManager && typeof uniformManager.updateUniformBuffer === "function") {
      _uniformManager = uniformManager;
      uniformManager.updateUniformBuffer(_device);
    }
  } catch (err) {
    console.error("❌ Error in setShaderSource:", err);
    window.ErrorHandler?.handleError(err);
  }
}

export function render() {
  if (!_device || !_context || !_pipeline || !_bindGroup) return;

  const now = performance.now();

  if (now - _lastTimeUpdate >= UNIFORM_UPDATE_INTERVAL) {
    _uniformData[0] = now / 1000;
    _device.queue.writeBuffer(_uniformBuffer, 0, _uniformData);
    _lastTimeUpdate = now;
  }

  if (_canvas && _resolutionBuffer) {
    if (_resolutionData[0] !== _canvas.width || _resolutionData[1] !== _canvas.height) {
      _resolutionData[0] = _canvas.width;
      _resolutionData[1] = _canvas.height;
      _resolutionData[2] = _canvas.width / _canvas.height;
      _device.queue.writeBuffer(_resolutionBuffer, 0, _resolutionData);
    }
  }

  if (_uniformManager && _paramUniformBuffer && _paramUniformData) {
    const values = Array.from(_uniformManager.uniformValues.values());
    if (values.length > 0 && values.length === _paramUniformData.length) {
      _paramUniformData.set(values);
      _device.queue.writeBuffer(_paramUniformBuffer, 0, _paramUniformData);
    }
  }

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
  pass.setBindGroup(0, _bindGroup);
  pass.draw(3, 1, 0, 0);
  pass.end();

  _device.queue.submit([encoder.finish()]);
  _frameCount++;
}

export function clearPipeline() {
  console.log("🧹 Clearing GPU pipeline and resources");
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

    console.log("✅ Pipeline cleared");
  } catch (error) {
    console.error("Error clearing pipeline:", error);
    window.errorHandler?.handleError(error);
  }
}

export function getPerformanceStats() {
  return {
    frameCount: _frameCount,
    avgUniformUpdateInterval: UNIFORM_UPDATE_INTERVAL,
    lastTimeUpdate: _lastTimeUpdate,
  };
}

export const updateShader = setShaderSource;
export const drawFrame = render;

export function forceReset() {
  console.log("🔥 FORCE RESETTING GPU STATE");
  if (_paramUniformBuffer) _paramUniformBuffer.destroy();
  _paramUniformBuffer = null;
  _uniformManager = null;
  _paramUniformData = null;
  _pipeline = null;
  _bindGroup = null;
  _lastUserSrcHash = null;
  _lastCompileOK = false;
  _loggedForHash.clear();
  console.log("✅ GPU state reset complete");
}
