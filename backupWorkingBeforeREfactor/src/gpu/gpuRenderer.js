// src/gpu/gpuRenderer.js
// Complete WebGPU renderer with uniform buffer and texture support

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

  if (!navigator.gpu) {
    console.warn("WebGPU not available");
    return null;
  }

  _canvas = canvas || document.getElementById("gpu-canvas");
  if (!_canvas) {
    throw new Error("Canvas element not found");
  }

  _context = _canvas.getContext("webgpu");
  const adapter = await navigator.gpu.requestAdapter();
  _device = await adapter.requestDevice();

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

  return _device;
}

function createDummyTexture() {
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
}

function createDummyCubeTexture() {
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
}

// Replace your createPipelineAndBindGroup function with this:

// Replace your createPipelineAndBindGroup function with this:

// Replace your createPipelineAndBindGroup function with this:

// Replace your createPipelineAndBindGroup function with this:

function createPipelineAndBindGroup(wgsl) {
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
}
export function render() {
  if (!_device || !_context || !_pipeline) return;

  // Only update uniforms if we have a bind group (shader uses uniforms)
  if (_bindGroup) {
    const time = performance.now() / 1000;
    const timeData = new Float32Array([time]);
    _device.queue.writeBuffer(_uniformBuffer, 0, timeData);
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

  // Only set bind group if the shader expects it
  if (_bindGroup) {
    pass.setBindGroup(0, _bindGroup);
  }

  pass.draw(3, 1, 0, 0);
  pass.end();

  _device.queue.submit([encoder.finish()]);
}

export async function setShaderSource(wgsl) {
  if (!_device) throw new Error("initWebGPU must be called first");

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

    console.log(
      `Shader compiled successfully. Has bind group: ${_bindGroup !== null}`,
    );
    return true;
  } catch (e) {
    _lastCompileOK = false;
    if (!_loggedForHash.has(srcHash)) {
      _loggedForHash.add(srcHash);
      console.warn("[WGSL] Shader compilation failed:", e.message || e);
    }
    return false;
  }
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
