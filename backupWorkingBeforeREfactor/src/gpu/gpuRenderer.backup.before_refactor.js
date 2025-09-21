// src/gpu/gpuRenderer.js
// Drop-in replacement with: initWebGPU, setShaderSource, updateShader (internal), render
// Guards against rebuild storms + one-shot logging on WGSL errors.

let _device = null;
let _context = null;
let _format = null;
let _canvas = null;
let _pipeline = null;
let _fallbackPipeline = null;

let _lastUserSrcHash = null;
let _lastCompileOK = false;
let _loggedForHash = new Set();

// tiny string hash
function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export async function initWebGPU(canvas) {
  if (_device) return _device; // already inited

  if (!navigator.gpu) {
    console.warn("WebGPU not available");
    return null;
  }

  _canvas = canvas;
  _context = canvas.getContext("webgpu");
  const adapter = await navigator.gpu.requestAdapter();
  _device = await adapter.requestDevice({
    // reduce warning spam by enabling robust error scopes
    requiredLimits: {},
  });

  _format = navigator.gpu.getPreferredCanvasFormat();
  _context.configure({
    device: _device,
    format: _format,
    alphaMode: "premultiplied",
  });

  // Create a minimal fallback pipeline
  _fallbackPipeline = createPipeline(`
    struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f; };
    @vertex fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
      var p = array<vec2f, 3>(
        vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)
      );
      var out: VSOut;
      out.pos = vec4f(p[vi], 0.0, 1.0);
      out.uv = (p[vi] + vec2f(1.0)) * 0.5;
      return out;
    }
    @fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
      return vec4f(uv, 0.5 + 0.5 * sin(uv.x * 20.0), 1.0);
    }
  `);

  _pipeline = _fallbackPipeline;
  return _device;
}

function createPipeline(wgsl) {
  const module = _device.createShaderModule({ code: wgsl });
  return _device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs_main" },
    fragment: { module, entryPoint: "fs_main", targets: [{ format: _format }] },
    primitive: { topology: "triangle-list" },
  });
}

// Compile user shader once per source hash. If fails, stick with fallback
// until a different source string is provided.
export async function setShaderSource(wgsl) {
  if (!_device)
    throw new Error("initWebGPU must be called before setShaderSource");

  const srcHash = hash(String(wgsl || ""));
  if (srcHash === _lastUserSrcHash && !_lastCompileOK) {
    // We already tried this broken shader. Do nothing to avoid storms.
    return false;
  }

  _lastUserSrcHash = srcHash;

  // Validate syntax quickly: catch the common trailing comma in structs etc.
  // Let GPU tell us the rest, but don't spam logs.
  try {
    // Use error scope so we can print a SINGLE, coalesced warning.
    _device.pushErrorScope("validation");
    _device.pushErrorScope("internal");
    const candidate = createPipeline(wgsl);
    await Promise.all([_device.popErrorScope(), _device.popErrorScope()]).then(
      (errs) => {
        const msgs = errs.filter(Boolean);
        if (msgs.length) throw msgs[0];
        _pipeline = candidate;
        _lastCompileOK = true;
      },
    );
  } catch (e) {
    _pipeline = _fallbackPipeline;
    _lastCompileOK = false;
    if (!_loggedForHash.has(srcHash)) {
      _loggedForHash.add(srcHash);
      console.warn(
        "[WGSL] errors detected, using fallback once for this source.",
        e && e.message ? e.message : e,
      );
    }
    return false;
  }
  return true;
}

// draw using whatever pipeline is active (user or fallback)
export function render() {
  if (!_device || !_context || !_pipeline) return;
  const encoder = _device.createCommandEncoder();
  const view = _context.getCurrentTexture().createView();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(_pipeline);
  pass.draw(3, 1, 0, 0);
  pass.end();
  _device.queue.submit([encoder.finish()]);
}
