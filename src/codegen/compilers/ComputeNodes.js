// src/codegen/compilers/ComputeNodes.js
// Compiler for compute shader nodes that generate GPU textures

import { UnifiedParameterHandler } from '../../parameters/UnifiedParameterHandler.js';
import { unifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';

export class ComputeNodes {
  constructor() {
    this.uniformManager = null;
    this.paramHandler = new UnifiedParameterHandler();
    this.computeTextureRegistry = new Map(); // Maps nodeId -> { texture, manager, lastUpdate }
    this.computeManagers = new Map(); // Maps nodeId -> ComputeShaderManager instance
    // Graph being compiled, used to resolve node references in parameter expressions
    // without relying on the ambient window.editor.graph (absent in the external viewer).
    this.graph = null;
  }

  setUniformManager(manager) {
    this.uniformManager = manager;
  }

  setGraph(graph) {
    this.graph = graph;
  }

  setExpressionSystem(expressionSystem) {
    this.paramHandler.setExpressionSystem(expressionSystem);
  }

  handles(kind) {
    return [
      'ComputeNoise',
      'ComputeBlur',
      'ComputeParticles',
      'ComputeFeedback',
      'ComputeReactionDiffusion',
      'ComputeFluidSim',
      'ComputeConvolution',
      'ComputeCellular',
      'ComputeFeedbackField',
      'ComputeThreshold',
      'ComputeColorAdjust',
      'ComputeEdgeDetect',
      'ComputeMorphology',
      'ComputeVoronoi',
      'ComputeGradient',
      'ComputePattern',
      'ComputeWarp',
      'ComputeKaleidoscope',
      'ComputeGlitch',
      'ComputeMix',
      'ComputeTransform',
      'ComputeChannels',
      'ComputeHSV',
      'ComputeHistogram',
      'ComputeLuminance'
    ].includes(kind);
  }

  /**
   * Compile a compute shader node
   * Compute nodes don't generate inline WGSL code - they execute on GPU and return texture references
   */
  compile(node, getInput, getParam) {
    // Sanitize and ensure node_ prefix for consistency
    let nodeId = String(node.id).replace(/[^a-zA-Z0-9_]/g, "_");
    // Remove any existing node_ prefix to avoid double-prefixing
    if (nodeId.startsWith('node_')) {
      nodeId = nodeId.substring(5); // Remove "node_" prefix
    }

    // Analyze node parameters for uniforms
    if (this.uniformManager) {
      this.uniformManager.analyzeNode(node);
    }

    // Determine resolution for this compute node
    const resolution = this.getResolution(node);

    // Register this compute node for execution
    this.registerComputeNode(node, getInput, resolution);

    // Return texture sampling code (similar to Texture2D node)
    // The actual compute shader will be dispatched before fragment shader runs
    const textureId = `compute_node_${nodeId}`;

    // Sample the compute output texture
    const line = `let uv_${nodeId} = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
    let node_${nodeId}_rgba = textureSample(${textureId}, sampler_${textureId}, uv_${nodeId});
    let node_${nodeId} = node_${nodeId}_rgba;`;

    // Single Color (RGBA) output. Channels are extracted downstream with a
    // Split Vec4 node rather than per-channel output pins.
    const outputPins = [
      { expression: `node_${nodeId}_rgba`, type: "vec4" }, // Color (RGBA)
    ];

    return { line, outputType: "vec4", outputPins, isComputeNode: true };
  }

  /**
   * Get resolution for compute shader output texture
   * Uses canvas resolution to maintain aspect ratio
   */
  getResolution(node) {
    // Try to get resolution from floating preview settings (maintains aspect ratio)
    if (window.floatingPreview?.settings?.settings?.resolution) {
      const { width, height } = window.floatingPreview.settings.settings.resolution;
      // Ensure we have valid dimensions
      if (width > 0 && height > 0) {
        return [width, height];
      }
    }

    // Fallback to node parameter (square resolution)
    const resParam = node.params?.resolution;
    if (resParam) {
      const size = parseInt(resParam);
      if (!isNaN(size) && size > 0) {
        return [size, size];
      }
    }
    return [512, 512]; // Default
  }

  /**
   * Register a compute node for GPU execution
   */
  registerComputeNode(node, getInput, resolution) {
    // Use node.id directly for registry (maintain original ID for lookups)
    const registryKey = String(node.id).replace(/[^a-zA-Z0-9_]/g, "_");

    // Determine if this node needs feedback (previous frame texture) or multiple inputs
    // ComputeWarp and ComputeMix use this for their second input texture
    const feedbackNodes = ['ComputeReactionDiffusion', 'ComputeCellular', 'ComputeFeedback', 'ComputeFeedbackField', 'ComputeWarp', 'ComputeMix'];
    const supportsFeedback = feedbackNodes.includes(node.kind);

    // Store compute node info for later execution
    if (!window.computeNodeRegistry) {
      window.computeNodeRegistry = new Map();
    }

    window.computeNodeRegistry.set(registryKey, {
      node,
      getInput,
      resolution,
      wgslCode: this.generateComputeWGSL(node, getInput),
      supportsFeedback,
      lastInputHash: null // For tracking when inputs change
    });

  }

  /**
   * Register compute nodes that the normal compile pass skipped because they are NOT upstream of
   * the active OutputFinal. buildWGSL only compiles output-reachable nodes, so a compute node that
   * isn't wired into the output never lands in window.computeNodeRegistry — ComputeExecutor then
   * never dispatches it, it has no output texture, and its per-node preview falls back to a
   * placeholder until it's connected into the output chain.
   *
   * Registering them here lets the existing ComputeExecutor pipeline dispatch them, so the per-node
   * preview shows the node's real output even while it is still disconnected. This reuses the same
   * machinery as connected compute nodes: input texture binding (including the no-input case) and
   * fragment-input rendering are handled at dispatch time. These nodes are deliberately NOT added
   * to the fragment shader's texture bindings — TextureBindings only binds output-reachable nodes —
   * so the compiled main shader is unaffected.
   *
   * Honors the per-node preview toggle: a node whose preview is switched off is left unregistered so
   * we don't spend a GPU dispatch every frame on a node the user isn't previewing.
   *
   * @param {Object} graph - The full node graph
   */
  registerDisconnectedComputeNodes(graph) {
    if (!graph || !Array.isArray(graph.nodes)) return;
    if (!window.computeNodeRegistry) {
      window.computeNodeRegistry = new Map();
    }

    const nodePreviews = window.editor?.nodePreviews;

    for (const node of graph.nodes) {
      if (!node || !this.handles(node.kind)) continue;

      const registryKey = String(node.id).replace(/[^a-zA-Z0-9_]/g, "_");
      // Already compiled (output-reachable) or registered on a previous build — leave it alone.
      if (window.computeNodeRegistry.has(registryKey)) continue;

      // Respect the per-node preview toggle (green-dot button): no point dispatching a node whose
      // preview is hidden. Absent entry / undefined means the preview is on (the default).
      const pv = nodePreviews?.get?.(node.id);
      if (pv && pv.enabled === false) continue;

      // getInput is unused by compute WGSL generation (input textures are bound at dispatch time),
      // so a no-op is safe; getResolution reads node params / global preview settings only.
      this.registerComputeNode(node, () => null, this.getResolution(node));
    }
  }

  /**
   * Generate WGSL compute shader code for a node
   */
  generateComputeWGSL(node, getInput) {
    switch (node.kind) {
      case 'ComputeNoise':
        return this.generateNoiseShader(node, getInput);
      case 'ComputeBlur':
        return this.generateBlurShader(node, getInput);
      case 'ComputeFeedback':
        return this.generateFeedbackShader(node, getInput);
      case 'ComputeReactionDiffusion':
        return this.generateReactionDiffusionShader(node, getInput);
      case 'ComputeCellular':
        return this.generateCellularShader(node, getInput);
      case 'ComputeFeedbackField':
        return this.generateFeedbackFieldShader(node, getInput);
      case 'ComputeConvolution':
        return this.generateConvolutionShader(node, getInput);
      case 'ComputeThreshold':
        return this.generateThresholdShader(node, getInput);
      case 'ComputeColorAdjust':
        return this.generateColorAdjustShader(node, getInput);
      case 'ComputeEdgeDetect':
        return this.generateEdgeDetectShader(node, getInput);
      case 'ComputeMorphology':
        return this.generateMorphologyShader(node, getInput);
      case 'ComputeVoronoi':
        return this.generateVoronoiShader(node, getInput);
      case 'ComputeGradient':
        return this.generateGradientShader(node, getInput);
      case 'ComputePattern':
        return this.generatePatternShader(node, getInput);
      case 'ComputeWarp':
        return this.generateWarpShader(node, getInput);
      case 'ComputeKaleidoscope':
        return this.generateKaleidoscopeShader(node, getInput);
      case 'ComputeGlitch':
        return this.generateGlitchShader(node, getInput);
      case 'ComputeMix':
        return this.generateMixShader(node, getInput);
      case 'ComputeTransform':
        return this.generateTransformShader(node, getInput);
      case 'ComputeChannels':
        return this.generateChannelsShader(node, getInput);
      case 'ComputeHSV':
        return this.generateHSVShader(node, getInput);
      case 'ComputeHistogram':
        return this.generateHistogramShader(node, getInput);
      case 'ComputeLuminance':
        return this.generateLuminanceShader(node, getInput);
      default:

        return this.generateFallbackShader(node);
    }
  }

  /**
   * Generate compute noise shader
   */
  generateNoiseShader(node, getInput) {
    const scale = this.getParam(node, 'scale', 8.0);
    const octaves = this.getParam(node, 'octaves', 5);
    const speed = this.getParam(node, 'speed', 0.1);
    const colorize = this.getParam(node, 'colorize', true);

    const shader = `
// Compute Noise Shader
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  scale: f32,
  octaves: f32,
  speed: f32,
  colorize: f32,
  _padding: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

// Hash function for pseudo-random numbers
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 2D noise
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let a = hash(i + vec2<f32>(0.0, 0.0));
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian Motion
fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;

  for (var i = 0; i < octaves; i++) {
    value += amplitude * noise(pos * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }

  return value;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<u32>(global_id.xy);
  let texSize = vec2<u32>(u32(uniforms.resolution.x), u32(uniforms.resolution.y));

  if (texCoord.x >= texSize.x || texCoord.y >= texSize.y) {
    return;
  }

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);
  let time = uniforms.time * uniforms.speed;

  // Apply aspect ratio correction to prevent stretching
  let aspect = uniforms.resolution.x / uniforms.resolution.y;
  let uv_corrected = vec2<f32>(uv.x * aspect, uv.y);

  var noisePos = uv_corrected * uniforms.scale;
  noisePos += vec2<f32>(time * 0.1, time * 0.15);

  let noiseValue = fbm(noisePos, i32(uniforms.octaves));

  // Use uniform to determine colorization at runtime
  if (uniforms.colorize > 0.5) {
    // Colorize the noise
    let hue = noiseValue + time * 0.1;
    let h = fract(hue);
    let s = 0.7;
    let v = 0.8 + noiseValue * 0.2;

    let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(vec3<f32>(h) + k.xyz) * 6.0 - k.www);
    let rgb = v * mix(vec3<f32>(1.0), clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), s);

    textureStore(outputTexture, texCoord, vec4<f32>(rgb, 1.0));
  } else {
    // Grayscale noise
    textureStore(outputTexture, texCoord, vec4<f32>(noiseValue, noiseValue, noiseValue, 1.0));
  }
}`;

    return shader;
  }

  /**
   * Generate compute blur shader
   */
  generateBlurShader(node, getInput) {
    const radius = this.getParam(node, 'radius', 5.0);

    return `
// Compute Gaussian Blur Shader
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  radius: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  var color = vec4<f32>(0.0);
  var totalWeight = 0.0;

  let r = i32(uniforms.radius);

  for (var y = -r; y <= r; y++) {
    for (var x = -r; x <= r; x++) {
      let samplePos = texCoord + vec2<i32>(x, y);

      if (samplePos.x >= 0 && samplePos.x < i32(texSize.x) &&
          samplePos.y >= 0 && samplePos.y < i32(texSize.y)) {

        let dist = length(vec2<f32>(f32(x), f32(y)));
        let weight = exp(-dist * dist / (2.0 * uniforms.radius * uniforms.radius));

        color += textureLoad(inputTexture, samplePos, 0) * weight;
        totalWeight += weight;
      }
    }
  }

  color /= totalWeight;
  textureStore(outputTexture, vec2<u32>(texCoord), color);
}`;
  }

  /**
   * Generate compute convolution shader
   */
  generateConvolutionShader(node, getInput) {
    const kernel = this.getParam(node, 'kernel', 'Sharpen');
    const strength = this.getParam(node, 'strength', 1.0);

    // Define convolution kernel matrices
    const kernels = {
      'Sharpen': [
        [0, -1, 0],
        [-1, 5, -1],
        [0, -1, 0]
      ],
      'Edge Detect': [
        [-1, -1, -1],
        [-1, 8, -1],
        [-1, -1, -1]
      ],
      'Emboss': [
        [-2, -1, 0],
        [-1, 1, 1],
        [0, 1, 2]
      ],
      'Custom': [
        [0, 0, 0],
        [0, 1, 0],
        [0, 0, 0]
      ]
    };

    const selectedKernel = kernels[kernel] || kernels['Sharpen'];

    // Format kernel values for WGSL array initialization
    const kernelRows = selectedKernel.map(row =>
      `array<f32, 3>(${row.map(v => v + '.0').join(', ')})`
    ).join(',\n      ');

    return `
// Compute Convolution Shader
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  strength: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// 3x3 Convolution kernel: ${kernel}
const kernel = array<array<f32, 3>, 3>(
  ${kernelRows}
);

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  var result = vec4<f32>(0.0);

  // Apply 3x3 convolution kernel
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let samplePos = texCoord + vec2<i32>(x, y);

      // Clamp to texture boundaries
      if (samplePos.x >= 0 && samplePos.x < i32(texSize.x) &&
          samplePos.y >= 0 && samplePos.y < i32(texSize.y)) {

        let sample = textureLoad(inputTexture, samplePos, 0);
        let weight = kernel[y + 1][x + 1];
        result += sample * weight;
      }
    }
  }

  // Apply strength and blend with original
  let original = textureLoad(inputTexture, texCoord, 0);
  let convolved = result;
  let finalColor = mix(original, convolved, uniforms.strength);

  textureStore(outputTexture, vec2<u32>(texCoord), finalColor);
}`;
  }

  /**
   * Generate threshold shader
   */
  generateThresholdShader(node, getInput) {
    const mode = this.getParam(node, 'mode', 'Binary');
    const threshold = this.getParam(node, 'threshold', 0.5);
    const thresholdMin = this.getParam(node, 'thresholdMin', 0.3);
    const thresholdMax = this.getParam(node, 'thresholdMax', 0.7);
    const outputLow = this.getParam(node, 'outputLow', 0.0);
    const outputHigh = this.getParam(node, 'outputHigh', 1.0);

    const modeIndex = this.getThresholdModeIndex(mode);

    const shader = `
// Compute Threshold Shader - Mode: ${mode}
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  threshold: f32,
  thresholdMin: f32,
  thresholdMax: f32,
  outputLow: f32,
  outputHigh: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// Convert RGB to luminance (Rec. 709)
fn luminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

// Binary threshold: output low if below threshold, high if above
fn binaryThreshold(value: f32, threshold: f32, low: f32, high: f32) -> f32 {
  if (value < threshold) {
    return low;
  } else {
    return high;
  }
}

// Range threshold: output high only if value is within range
fn rangeThreshold(value: f32, minThresh: f32, maxThresh: f32, low: f32, high: f32) -> f32 {
  if (value >= minThresh && value <= maxThresh) {
    return high;
  } else {
    return low;
  }
}

// Adaptive threshold using local neighborhood average
fn adaptiveThreshold(coord: vec2<i32>, texSize: vec2<u32>, threshold: f32, low: f32, high: f32) -> f32 {
  let center = textureLoad(inputTexture, coord, 0);
  let centerLum = luminance(center.rgb);

  // Compute local average in 5x5 neighborhood
  var sum = 0.0;
  var count = 0.0;

  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -2; dx <= 2; dx++) {
      let samplePos = coord + vec2<i32>(dx, dy);

      if (samplePos.x >= 0 && samplePos.x < i32(texSize.x) &&
          samplePos.y >= 0 && samplePos.y < i32(texSize.y)) {
        let sample = textureLoad(inputTexture, samplePos, 0);
        sum += luminance(sample.rgb);
        count += 1.0;
      }
    }
  }

  let localAvg = sum / count;
  let adaptiveThresh = localAvg * (1.0 - threshold);

  if (centerLum > adaptiveThresh) {
    return high;
  } else {
    return low;
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  let input = textureLoad(inputTexture, texCoord, 0);
  let inputLum = luminance(input.rgb);

  var result: f32;

  // Mode: 0=Binary, 1=Range, 2=Adaptive (compile-time constant)
  let modeType = ${modeIndex};

  if (modeType == 0) {
    // Binary threshold
    result = binaryThreshold(inputLum, uniforms.threshold, uniforms.outputLow, uniforms.outputHigh);
  } else if (modeType == 1) {
    // Range threshold
    result = rangeThreshold(inputLum, uniforms.thresholdMin, uniforms.thresholdMax, uniforms.outputLow, uniforms.outputHigh);
  } else {
    // Adaptive threshold
    result = adaptiveThreshold(texCoord, texSize, uniforms.threshold, uniforms.outputLow, uniforms.outputHigh);
  }

  // Output result as grayscale
  let color = vec4<f32>(result, result, result, input.a);
  textureStore(outputTexture, vec2<u32>(texCoord), color);
}`;

    return shader;
  }

  /**
   * Generate feedback shader
   */
  generateFeedbackShader(node, getInput) {
    const decay = this.getParam(node, 'decay', 0.95);
    const scale = this.getParam(node, 'scale', 1.01);

    return `
// Compute Feedback Shader
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  decay: f32,
  scale: f32,
  rotation: f32,
  offsetX: f32,
  offsetY: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;
@group(0) @binding(4) var feedbackTexture: texture_2d<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);

  // Transform UV for feedback
  var feedbackUV = (uv - 0.5) * uniforms.scale;

  // Apply rotation
  let angle = uniforms.rotation;
  let c = cos(angle);
  let s = sin(angle);
  feedbackUV = vec2<f32>(
    feedbackUV.x * c - feedbackUV.y * s,
    feedbackUV.x * s + feedbackUV.y * c
  );

  feedbackUV += 0.5;

  // Apply per-frame offset (pans the feedback trail). offsetX/offsetY are in
  // UV space so small values (±0.1) shift the trail a fraction of the frame.
  feedbackUV += vec2<f32>(uniforms.offsetX, uniforms.offsetY);

  // Sample input and feedback
  let input = textureLoad(inputTexture, texCoord, 0);

  var feedback = vec4<f32>(0.0);
  if (feedbackUV.x >= 0.0 && feedbackUV.x <= 1.0 && feedbackUV.y >= 0.0 && feedbackUV.y <= 1.0) {
    let fbCoord = vec2<i32>(feedbackUV * vec2<f32>(texSize));
    feedback = textureLoad(feedbackTexture, fbCoord, 0);
  }

  // Combine the fresh input with the decayed, transformed feedback using a
  // per-channel max. The original additive form (input + feedback * decay) kept
  // adding full-strength input on top of near-fully-retained feedback every
  // frame, so any coloured region saturated all three channels to 1.0 and the
  // trail blew out to white -- losing the input's colours. A convex mix avoided
  // the blowout but dimmed the input to a few percent per frame, so everything
  // looked too dark. max() keeps the input at full brightness where it is
  // present and lets the trail (feedback * decay) fade out gradually while still
  // never summing past 1.0, so colours are preserved at their true brightness.
  // decay controls how long the trail persists (0 = no trail, 1 = never fades).
  var result = max(input, feedback * uniforms.decay);
  // Keep content opaque so the colours are visible in the preview/composite even
  // while the (initially cleared) feedback buffer still has zero alpha.
  result.a = max(input.a, feedback.a * uniforms.decay);
  textureStore(outputTexture, vec2<u32>(texCoord), result);
}`;
  }

  /**
   * Generate reaction-diffusion shader
   */
  generateReactionDiffusionShader(node, getInput) {
    // Get pattern preset and apply preset parameters
    const pattern = this.getParam(node, 'pattern', 'Coral');
    const presets = this.getReactionDiffusionPresets();
    const preset = presets[pattern] || presets['Coral'];

    // Allow user to override preset values with manual parameters
    const feedRate = this.getParam(node, 'feedRate', preset.feedRate);
    const killRate = this.getParam(node, 'killRate', preset.killRate);
    const diffusionA = this.getParam(node, 'diffusionA', 1.0);
    const diffusionB = this.getParam(node, 'diffusionB', 0.5);
    const timestep = this.getParam(node, 'timestep', 1.0);

    const shader = `
// Reaction-Diffusion (Gray-Scott Model) with Feedback
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  feedRate: f32,
  killRate: f32,
  diffusionA: f32,
  diffusionB: f32,
  timestep: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var prevFrame: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = vec2<i32>(i32(uniforms.resolution.x), i32(uniforms.resolution.y));

  if (texCoord.x >= texSize.x || texCoord.y >= texSize.y) {
    return;
  }

  // Load current state from previous frame using textureLoad
  let current = textureLoad(prevFrame, texCoord, 0);
  var a = current.r;
  var b = current.g;

  // Improved Laplacian for diffusion using 9-point stencil
  // Using proper weights for better accuracy and stability
  var laplaceA = 0.0;
  var laplaceB = 0.0;

  // 9-point stencil with proper weights
  // Center weight: -1.0, Orthogonal neighbors: 0.2, Diagonal neighbors: 0.05
  let center_weight = -1.0;
  let ortho_weight = 0.2;
  let diag_weight = 0.05;

  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      var samplePos = texCoord + vec2<i32>(dx, dy);

      // Wrap-around boundary conditions for seamless tiling
      samplePos.x = (samplePos.x + texSize.x) % texSize.x;
      samplePos.y = (samplePos.y + texSize.y) % texSize.y;

      let sample = textureLoad(prevFrame, samplePos, 0);

      var weight = 0.0;
      if (dx == 0 && dy == 0) {
        weight = center_weight;
      } else if (dx == 0 || dy == 0) {
        weight = ortho_weight;  // Orthogonal neighbors
      } else {
        weight = diag_weight;   // Diagonal neighbors
      }

      laplaceA += sample.r * weight;
      laplaceB += sample.g * weight;
    }
  }

  // Gray-Scott reaction-diffusion equations
  let f = uniforms.feedRate;
  let k = uniforms.killRate;
  let dA = uniforms.diffusionA;
  let dB = uniforms.diffusionB;

  // Scale timestep appropriately - typical RD needs very small steps
  // User timestep is a multiplier, actual dt should be much smaller
  let dt = uniforms.timestep * 0.1; // Scale to 0.01-1.0 range
  // Faster evolution - patterns should develop in 10-30 seconds

  // Reaction term: A + 2B → 3B (simplified Gray-Scott)
  let reaction = a * b * b;

  // Update equations:
  // dA/dt = dA*∇²A - AB² + f(1-A)
  // dB/dt = dB*∇²B + AB² - (k+f)B
  let newA = a + (dA * laplaceA - reaction + f * (1.0 - a)) * dt;
  let newB = b + (dB * laplaceB + reaction - (k + f) * b) * dt;

  // Clamp to valid range [0, 1]
  let clampedA = clamp(newA, 0.0, 1.0);
  let clampedB = clamp(newB, 0.0, 1.0);

  // Colorize output - visualize the pattern
  // Classic approach: show B concentration as brightness
  // B forms the visible pattern, A is the substrate

  // Simple grayscale visualization of B concentration
  // let color = vec3<f32>(clampedB, clampedB, clampedB);

  // Colored visualization: map B concentration to a color gradient
  let t = clampedB;
  var color: vec3<f32>;

  if (t < 0.5) {
    // Low B: dark blue to cyan
    color = mix(vec3<f32>(0.0, 0.0, 0.2), vec3<f32>(0.0, 0.5, 1.0), t * 2.0);
  } else {
    // High B: cyan to yellow/white
    color = mix(vec3<f32>(0.0, 0.5, 1.0), vec3<f32>(1.0, 1.0, 0.3), (t - 0.5) * 2.0);
  }

  textureStore(outputTexture, vec2<u32>(texCoord), vec4<f32>(color, 1.0));
}`;

    return shader;
  }

  /**
   * Generate cellular automata shader
   */
  generateCellularShader(node, getInput) {
    return `
// Cellular Automata (Conway's Game of Life)
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  speed: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var stateTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(stateTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  let current = textureLoad(stateTexture, texCoord, 0).r;
  let alive = current > 0.5;

  // Count live neighbors
  var neighbors = 0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }

      let samplePos = texCoord + vec2<i32>(dx, dy);
      if (samplePos.x >= 0 && samplePos.x < i32(texSize.x) &&
          samplePos.y >= 0 && samplePos.y < i32(texSize.y)) {
        let sample = textureLoad(stateTexture, samplePos, 0).r;
        if (sample > 0.5) {
          neighbors++;
        }
      }
    }
  }

  // Conway's Game of Life rules
  var newState = 0.0;
  if (alive) {
    if (neighbors == 2 || neighbors == 3) {
      newState = 1.0;
    }
  } else {
    if (neighbors == 3) {
      newState = 1.0;
    }
  }

  let color = vec3<f32>(newState);
  textureStore(outputTexture, vec2<u32>(texCoord), vec4<f32>(color, 1.0));
}`;
  }

  /**
   * Generate feedback field shader
   * This shader uses the FeedbackManager for persistent state
   */
  generateFeedbackFieldShader(node, getInput) {
    // NOTE: `mode` is intentionally NOT baked into the shader. It is delivered
    // via uniforms.mode (packed at u[7] by packComputeUniforms) and read at
    // runtime below, so switching modes updates a uniform instead of
    // regenerating the WGSL. A WGSL change would change the manager's reuse
    // signature and wipe the accumulated field — exactly the reset we want to
    // avoid. decay/diffusion/feedback/speed are likewise uniforms.
    const decay = this.getParam(node, 'decay', 0.98);
    const diffusion = this.getParam(node, 'diffusion', 0.1);
    const feedback = this.getParam(node, 'feedback', 0.5);
    const speed = this.getParam(node, 'speed', 1.0);

    return `
// Feedback Field Shader - Persistent Texture System
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  decay: f32,
  diffusion: f32,
  feedback: f32,
  speed: f32,
  mode: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;
@group(0) @binding(4) var prevFrame: texture_2d<f32>;

// Helper: Sample with wrapping
fn sampleWrap(tex: texture_2d<f32>, coord: vec2<i32>, size: vec2<i32>) -> vec4<f32> {
  var wrappedCoord = coord;
  wrappedCoord.x = (wrappedCoord.x + size.x) % size.x;
  wrappedCoord.y = (wrappedCoord.y + size.y) % size.y;
  return textureLoad(tex, wrappedCoord, 0);
}

// Compute diffusion using Laplacian
fn computeDiffusion(coord: vec2<i32>, size: vec2<i32>) -> vec4<f32> {
  var laplacian = vec4<f32>(0.0);

  // 5-point stencil for diffusion
  let center = sampleWrap(prevFrame, coord, size);
  let up = sampleWrap(prevFrame, coord + vec2<i32>(0, -1), size);
  let down = sampleWrap(prevFrame, coord + vec2<i32>(0, 1), size);
  let left = sampleWrap(prevFrame, coord + vec2<i32>(-1, 0), size);
  let right = sampleWrap(prevFrame, coord + vec2<i32>(1, 0), size);

  laplacian = (up + down + left + right - 4.0 * center);

  return laplacian;
}

// Flow field mode: advect based on velocity
fn flowMode(coord: vec2<i32>, size: vec2<i32>, input: vec4<f32>) -> vec4<f32> {
  let uv = vec2<f32>(coord) / vec2<f32>(size);

  // Extract velocity from input (encoded in RG channels)
  let velocity = (input.rg - 0.5) * 2.0 * uniforms.speed;

  // Advect previous frame along velocity field
  let samplePos = vec2<f32>(coord) - velocity * vec2<f32>(size) * 0.1;
  let sampleCoord = vec2<i32>(floor(samplePos));
  let prev = sampleWrap(prevFrame, sampleCoord, size);

  // Add diffusion for smooth flow
  let diff = computeDiffusion(coord, size);

  // Combine: advected color + diffusion + new input
  var result = prev * uniforms.decay;
  result += diff * uniforms.diffusion * 0.1;
  result += input * uniforms.feedback * 0.1;

  return clamp(result, vec4<f32>(0.0), vec4<f32>(1.0));
}

// Reaction-diffusion mode: similar to RD but simpler
fn reactionDiffusionMode(coord: vec2<i32>, size: vec2<i32>, input: vec4<f32>) -> vec4<f32> {
  let current = sampleWrap(prevFrame, coord, size);
  let diff = computeDiffusion(coord, size);

  // Simple reaction: input acts as activator
  let activation = input.r;
  let inhibition = current.r * current.r * 0.5;

  var result = current;
  result.r += (diff.r * uniforms.diffusion + activation * 0.1 - inhibition) * uniforms.speed;
  result.g += (diff.g * uniforms.diffusion * 0.5) * uniforms.speed;
  result.b += (diff.b * uniforms.diffusion * 0.5) * uniforms.speed;

  result *= uniforms.decay;
  result += input * uniforms.feedback * 0.05;

  return clamp(result, vec4<f32>(0.0), vec4<f32>(1.0));
}

// Accumulate mode: simple additive feedback
fn accumulateMode(coord: vec2<i32>, size: vec2<i32>, input: vec4<f32>) -> vec4<f32> {
  let prev = sampleWrap(prevFrame, coord, size);
  let diff = computeDiffusion(coord, size);

  var result = prev * uniforms.decay;
  result += diff * uniforms.diffusion * 0.05;
  result += input * uniforms.feedback;

  return clamp(result, vec4<f32>(0.0), vec4<f32>(1.0));
}

// Swirl mode: rotational advection. Sample the previous frame from a position
// rotated about the field centre, so the accumulated field spins into a vortex.
// The rotation rate is driven by speed and tightens toward the centre, which
// makes it visibly distinct from Flow's input-driven linear advection.
fn swirlMode(coord: vec2<i32>, size: vec2<i32>, input: vec4<f32>) -> vec4<f32> {
  let center = vec2<f32>(size) * 0.5;
  let rel = vec2<f32>(coord) - center;
  let dist = length(rel);

  // Angle per frame: larger near the centre, easing off with distance.
  let angle = uniforms.speed * 0.08 / (1.0 + dist * 0.01);
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec2<f32>(rel.x * c - rel.y * s, rel.x * s + rel.y * c) + center;
  let prev = sampleWrap(prevFrame, vec2<i32>(floor(rotated)), size);

  let diff = computeDiffusion(coord, size);

  var result = prev * uniforms.decay;
  result += diff * uniforms.diffusion * 0.1;
  result += input * uniforms.feedback * 0.2;

  return clamp(result, vec4<f32>(0.0), vec4<f32>(1.0));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = vec2<i32>(i32(uniforms.resolution.x), i32(uniforms.resolution.y));

  if (texCoord.x >= texSize.x || texCoord.y >= texSize.y) {
    return;
  }

  // Load input
  let input = textureLoad(inputTexture, texCoord, 0);

  // Select mode (0=Flow, 1=Reaction-Diffusion, 2=Accumulate, 3=Swirl)
  var result: vec4<f32>;

  // Mode selection based on parameter (runtime uniform, not baked — see note in
  // generateFeedbackFieldShader). 0=Flow, 1=Reaction-Diffusion, 2=Accumulate, 3=Swirl.
  let modeType = i32(uniforms.mode + 0.5);

  if (modeType == 0) {
    result = flowMode(texCoord, texSize, input);
  } else if (modeType == 1) {
    result = reactionDiffusionMode(texCoord, texSize, input);
  } else if (modeType == 2) {
    result = accumulateMode(texCoord, texSize, input);
  } else {
    result = swirlMode(texCoord, texSize, input);
  }

  textureStore(outputTexture, vec2<u32>(texCoord), result);
}`;
  }

  /**
   * Convert threshold mode string to index
   */
  getThresholdModeIndex(mode) {
    const modes = {
      'Binary': 0,
      'Range': 1,
      'Adaptive': 2
    };
    return modes[mode] || 0;
  }

  /**
   * Generate color adjustment shader
   */
  generateColorAdjustShader(node, getInput) {
    const brightness = this.getParam(node, 'brightness', 0.0);
    const contrast = this.getParam(node, 'contrast', 1.0);
    const saturation = this.getParam(node, 'saturation', 1.0);
    const hue = this.getParam(node, 'hue', 0.0);
    const gamma = this.getParam(node, 'gamma', 1.0);
    const exposure = this.getParam(node, 'exposure', 0.0);

    const shader = `
// Compute Color Adjust Shader
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  brightness: f32,
  contrast: f32,
  saturation: f32,
  hue: f32,
  gamma: f32,
  exposure: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// Convert RGB to HSV
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));

  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Convert HSV to RGB
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  // Load input color
  let input = textureLoad(inputTexture, texCoord, 0);
  var color = input.rgb;
  let alpha = input.a;

  // Apply exposure first (affects brightness range)
  color = color * pow(2.0, uniforms.exposure);

  // Apply brightness (additive)
  color = color + vec3<f32>(uniforms.brightness);

  // Apply contrast (around middle gray 0.5)
  color = (color - 0.5) * uniforms.contrast + 0.5;

  // Apply saturation and hue adjustments in HSV space
  var hsv = rgb2hsv(color);

  // Adjust hue (rotate hue by angle in degrees, converted to 0-1 range)
  hsv.x = fract(hsv.x + uniforms.hue / 360.0);

  // Adjust saturation
  hsv.y = clamp(hsv.y * uniforms.saturation, 0.0, 1.0);

  // Convert back to RGB
  color = hsv2rgb(hsv);

  // Apply gamma correction
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / uniforms.gamma));

  // Clamp final result to valid range
  color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));

  textureStore(outputTexture, vec2<u32>(texCoord), vec4<f32>(color, alpha));
}`;

    return shader;
  }

  /**
   * Generate edge detection shader
   */
  generateEdgeDetectShader(node, getInput) {
    const method = this.getParam(node, 'method', 'Sobel');
    const threshold = this.getParam(node, 'threshold', 0.1);
    const strength = this.getParam(node, 'strength', 1.0);
    const invertEdges = this.getParam(node, 'invertEdges', false);

    const methodIndex = this.getEdgeDetectMethodIndex(method);

    const shader = `
// Compute Edge Detection Shader - Method: ${method}
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  threshold: f32,
  strength: f32,
  invertEdges: f32,
  padding: vec2<f32>
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// Convert RGB to luminance (Rec. 709)
fn luminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

// Sample luminance at offset position with bounds checking
fn sampleLum(coord: vec2<i32>, offset: vec2<i32>, texSize: vec2<u32>) -> f32 {
  let samplePos = coord + offset;

  if (samplePos.x >= 0 && samplePos.x < i32(texSize.x) &&
      samplePos.y >= 0 && samplePos.y < i32(texSize.y)) {
    let sample = textureLoad(inputTexture, samplePos, 0);
    return luminance(sample.rgb);
  }

  // Return edge luminance for out-of-bounds
  return 0.0;
}

// Sobel operator (3x3)
fn sobelEdgeDetect(coord: vec2<i32>, texSize: vec2<u32>) -> f32 {
  // Sobel kernels
  // Gx = [-1  0  1]    Gy = [-1 -2 -1]
  //      [-2  0  2]         [ 0  0  0]
  //      [-1  0  1]         [ 1  2  1]

  // Sample 3x3 neighborhood
  let tl = sampleLum(coord, vec2<i32>(-1, -1), texSize);
  let tc = sampleLum(coord, vec2<i32>( 0, -1), texSize);
  let tr = sampleLum(coord, vec2<i32>( 1, -1), texSize);
  let ml = sampleLum(coord, vec2<i32>(-1,  0), texSize);
  let mr = sampleLum(coord, vec2<i32>( 1,  0), texSize);
  let bl = sampleLum(coord, vec2<i32>(-1,  1), texSize);
  let bc = sampleLum(coord, vec2<i32>( 0,  1), texSize);
  let br = sampleLum(coord, vec2<i32>( 1,  1), texSize);

  // Compute gradients
  let gx = -tl + tr - 2.0*ml + 2.0*mr - bl + br;
  let gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;

  // Gradient magnitude
  return sqrt(gx * gx + gy * gy);
}

// Scharr operator (3x3, more accurate rotation invariance)
fn scharrEdgeDetect(coord: vec2<i32>, texSize: vec2<u32>) -> f32 {
  // Scharr kernels (optimized weights)
  // Gx = [-3   0   3]    Gy = [-3 -10  -3]
  //      [-10  0  10]         [ 0   0   0]
  //      [-3   0   3]         [ 3  10   3]

  let tl = sampleLum(coord, vec2<i32>(-1, -1), texSize);
  let tc = sampleLum(coord, vec2<i32>( 0, -1), texSize);
  let tr = sampleLum(coord, vec2<i32>( 1, -1), texSize);
  let ml = sampleLum(coord, vec2<i32>(-1,  0), texSize);
  let mr = sampleLum(coord, vec2<i32>( 1,  0), texSize);
  let bl = sampleLum(coord, vec2<i32>(-1,  1), texSize);
  let bc = sampleLum(coord, vec2<i32>( 0,  1), texSize);
  let br = sampleLum(coord, vec2<i32>( 1,  1), texSize);

  // Compute gradients with Scharr weights
  let gx = -3.0*tl + 3.0*tr - 10.0*ml + 10.0*mr - 3.0*bl + 3.0*br;
  let gy = -3.0*tl - 10.0*tc - 3.0*tr + 3.0*bl + 10.0*bc + 3.0*br;

  // Gradient magnitude (normalized by kernel weight sum)
  return sqrt(gx * gx + gy * gy) / 32.0; // Normalize by sum of weights
}

// Prewitt operator (3x3)
fn prewittEdgeDetect(coord: vec2<i32>, texSize: vec2<u32>) -> f32 {
  // Prewitt kernels (uniform weights)
  // Gx = [-1  0  1]    Gy = [-1 -1 -1]
  //      [-1  0  1]         [ 0  0  0]
  //      [-1  0  1]         [ 1  1  1]

  let tl = sampleLum(coord, vec2<i32>(-1, -1), texSize);
  let tc = sampleLum(coord, vec2<i32>( 0, -1), texSize);
  let tr = sampleLum(coord, vec2<i32>( 1, -1), texSize);
  let ml = sampleLum(coord, vec2<i32>(-1,  0), texSize);
  let mr = sampleLum(coord, vec2<i32>( 1,  0), texSize);
  let bl = sampleLum(coord, vec2<i32>(-1,  1), texSize);
  let bc = sampleLum(coord, vec2<i32>( 0,  1), texSize);
  let br = sampleLum(coord, vec2<i32>( 1,  1), texSize);

  // Compute gradients
  let gx = -tl + tr - ml + mr - bl + br;
  let gy = -tl - tc - tr + bl + bc + br;

  // Gradient magnitude
  return sqrt(gx * gx + gy * gy);
}

// Roberts Cross operator (2x2, diagonal gradients)
fn robertsEdgeDetect(coord: vec2<i32>, texSize: vec2<u32>) -> f32 {
  // Roberts Cross kernels (2x2)
  // Gx = [ 1  0]    Gy = [ 0  1]
  //      [ 0 -1]         [-1  0]

  let c  = sampleLum(coord, vec2<i32>( 0,  0), texSize);
  let cr = sampleLum(coord, vec2<i32>( 1,  0), texSize);
  let cb = sampleLum(coord, vec2<i32>( 0,  1), texSize);
  let cbr = sampleLum(coord, vec2<i32>( 1,  1), texSize);

  // Compute diagonal gradients
  let gx = c - cbr;
  let gy = cr - cb;

  // Gradient magnitude
  return sqrt(gx * gx + gy * gy);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  // Select edge detection method
  var edgeMagnitude: f32;
  let method = ${methodIndex}; // 0=Sobel, 1=Scharr, 2=Prewitt, 3=Roberts

  if (method == 0) {
    edgeMagnitude = sobelEdgeDetect(texCoord, texSize);
  } else if (method == 1) {
    edgeMagnitude = scharrEdgeDetect(texCoord, texSize);
  } else if (method == 2) {
    edgeMagnitude = prewittEdgeDetect(texCoord, texSize);
  } else {
    edgeMagnitude = robertsEdgeDetect(texCoord, texSize);
  }

  // Apply strength multiplier
  edgeMagnitude *= uniforms.strength;

  // Apply threshold
  var edge: f32;
  if (edgeMagnitude >= uniforms.threshold) {
    edge = clamp(edgeMagnitude, 0.0, 1.0);
  } else {
    edge = 0.0;
  }

  // Optionally invert (show non-edges instead of edges)
  if (uniforms.invertEdges > 0.5) {
    edge = 1.0 - edge;
  }

  // Output edge as grayscale, preserve original alpha
  let input = textureLoad(inputTexture, texCoord, 0);
  let color = vec4<f32>(edge, edge, edge, input.a);

  textureStore(outputTexture, vec2<u32>(texCoord), color);
}`;

    return shader;
  }

  /**
   * Convert edge detection method string to index
   */
  getEdgeDetectMethodIndex(method) {
    const methods = {
      'Sobel': 0,
      'Scharr': 1,
      'Prewitt': 2,
      'Roberts': 3
    };
    return methods[method] || 0;
  }

  /**
   * Generate morphology shader
   */
  generateMorphologyShader(node, getInput) {
    const operation = this.getParam(node, 'operation', 'Dilate');
    const kernelSize = this.getParam(node, 'kernelSize', '3x3');
    const iterations = this.getParam(node, 'iterations', 1);
    const strength = this.getParam(node, 'strength', 1.0);

    const operationIndex = this.getMorphologyOperationIndex(operation);
    const kernelRadius = this.getKernelRadius(kernelSize);

    const shader = `
// Compute Morphology Shader - Operation: ${operation}, Kernel: ${kernelSize}
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  strength: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// Sample color at offset position with bounds checking
fn sampleColor(coord: vec2<i32>, offset: vec2<i32>, texSize: vec2<u32>) -> vec4<f32> {
  let samplePos = coord + offset;

  if (samplePos.x >= 0 && samplePos.x < i32(texSize.x) &&
      samplePos.y >= 0 && samplePos.y < i32(texSize.y)) {
    return textureLoad(inputTexture, samplePos, 0);
  }

  // Return black for out-of-bounds (for dilate this won't affect max, for erode it will be minimum)
  return vec4<f32>(0.0, 0.0, 0.0, 0.0);
}

// Dilate operation: Maximum filter (expands bright regions)
fn dilate(coord: vec2<i32>, texSize: vec2<u32>, radius: i32) -> vec4<f32> {
  var maxColor = vec4<f32>(0.0, 0.0, 0.0, 0.0);

  for (var dy = -radius; dy <= radius; dy = dy + 1) {
    for (var dx = -radius; dx <= radius; dx = dx + 1) {
      let sample = sampleColor(coord, vec2<i32>(dx, dy), texSize);
      maxColor = max(maxColor, sample);
    }
  }

  return maxColor;
}

// Erode operation: Minimum filter (shrinks bright regions)
fn erode(coord: vec2<i32>, texSize: vec2<u32>, radius: i32) -> vec4<f32> {
  var minColor = vec4<f32>(1.0, 1.0, 1.0, 1.0);

  for (var dy = -radius; dy <= radius; dy = dy + 1) {
    for (var dx = -radius; dx <= radius; dx = dx + 1) {
      let sample = sampleColor(coord, vec2<i32>(dx, dy), texSize);
      minColor = min(minColor, sample);
    }
  }

  return minColor;
}

// Open operation: Erode then dilate (removes small bright spots)
// Note: True opening requires two passes. This approximates with a single erode pass.
// For proper opening, chain this node (set to Open/Erode) -> another morphology node (set to Dilate)
fn open(coord: vec2<i32>, texSize: vec2<u32>, radius: i32) -> vec4<f32> {
  return erode(coord, texSize, radius);
}

// Close operation: Dilate then erode (removes small dark spots)
// Note: True closing requires two passes. This approximates with a single dilate pass.
// For proper closing, chain this node (set to Close/Dilate) -> another morphology node (set to Erode)
fn close(coord: vec2<i32>, texSize: vec2<u32>, radius: i32) -> vec4<f32> {
  return dilate(coord, texSize, radius);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  // Get original color
  let original = textureLoad(inputTexture, texCoord, 0);

  // Select morphology operation
  let operation = ${operationIndex}; // 0=Dilate, 1=Erode, 2=Open, 3=Close
  let radius = ${kernelRadius};

  var result: vec4<f32>;
  if (operation == 0) {
    result = dilate(texCoord, texSize, radius);
  } else if (operation == 1) {
    result = erode(texCoord, texSize, radius);
  } else if (operation == 2) {
    result = open(texCoord, texSize, radius);
  } else {
    result = close(texCoord, texSize, radius);
  }

  // Blend result with original based on strength
  let finalColor = mix(original, result, uniforms.strength);

  textureStore(outputTexture, vec2<u32>(texCoord), finalColor);
}`;

    return shader;
  }

  /**
   * Convert morphology operation string to index
   */
  getMorphologyOperationIndex(operation) {
    const operations = {
      'Dilate': 0,
      'Erode': 1,
      'Open': 2,
      'Close': 3
    };
    return operations[operation] || 0;
  }

  /**
   * Convert kernel size to radius
   */
  getKernelRadius(kernelSize) {
    const sizes = {
      '3x3': 1,  // radius 1 = 3x3 kernel
      '5x5': 2,  // radius 2 = 5x5 kernel
      '7x7': 3   // radius 3 = 7x7 kernel
    };
    return sizes[kernelSize] || 1;
  }

  /**
   * Generate Voronoi diagram shader
   */
  generateVoronoiShader(node, getInput) {
    const mode = this.getParam(node, 'mode', 'Cells');
    const scale = this.getParam(node, 'scale', 8.0);
    const pointCount = this.getParam(node, 'pointCount', 16);
    const distanceMetric = this.getParam(node, 'distanceMetric', 'Euclidean');
    const seed = this.getParam(node, 'seed', 0.0);
    const animate = this.getParam(node, 'animate', true);
    const speed = this.getParam(node, 'speed', 0.1);

    const modeIndex = this.getVoronoiModeIndex(mode);
    const metricIndex = this.getDistanceMetricIndex(distanceMetric);

    const shader = `
// Compute Voronoi Shader - Mode: ${mode}, Metric: ${distanceMetric}
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  scale: f32,
  seed: f32,
  speed: f32,
  padding: vec2<f32>
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

// Hash function for pseudo-random numbers
fn hash2(p: vec2<f32>) -> vec2<f32> {
  var p3 = fract(vec3<f32>(p.xyx) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

fn hash1(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Distance metrics
fn distEuclidean(a: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = a - b;
  return length(d);
}

fn distManhattan(a: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(a - b);
  return d.x + d.y;
}

fn distChebyshev(a: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(a - b);
  return max(d.x, d.y);
}

fn distMinkowski(a: vec2<f32>, b: vec2<f32>) -> f32 {
  let d = abs(a - b);
  let p = 3.0; // Minkowski parameter
  return pow(pow(d.x, p) + pow(d.y, p), 1.0 / p);
}

fn getDistance(a: vec2<f32>, b: vec2<f32>, metric: i32) -> f32 {
  if (metric == 0) {
    return distEuclidean(a, b);
  } else if (metric == 1) {
    return distManhattan(a, b);
  } else if (metric == 2) {
    return distChebyshev(a, b);
  } else {
    return distMinkowski(a, b);
  }
}

// Voronoi function
fn voronoi(uv: vec2<f32>, metric: i32) -> vec4<f32> {
  let gridUV = uv * uniforms.scale;
  let gridCell = floor(gridUV);
  let gridFract = fract(gridUV);

  var minDist1 = 100.0;
  var minDist2 = 100.0;
  var minPoint = vec2<f32>(0.0);
  var minCellId = vec2<f32>(0.0);

  // Search in 3x3 neighborhood
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let neighbor = vec2<f32>(f32(x), f32(y));
      let cellId = gridCell + neighbor;

      // Generate random point in this cell
      var pointOffset = hash2(cellId + uniforms.seed);

      // Animate point if enabled
      ${animate ? `
      let t = uniforms.time * uniforms.speed;
      pointOffset += vec2<f32>(sin(t + cellId.x), cos(t + cellId.y)) * 0.3;
      pointOffset = fract(pointOffset);
      ` : ''}

      let point = neighbor + pointOffset;
      let dist = getDistance(gridFract, point, metric);

      if (dist < minDist1) {
        minDist2 = minDist1;
        minDist1 = dist;
        minPoint = point;
        minCellId = cellId;
      } else if (dist < minDist2) {
        minDist2 = dist;
      }
    }
  }

  // Return: (distance1, distance2, cellId.x, cellId.y)
  return vec4<f32>(minDist1, minDist2, minCellId.xy);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<u32>(global_id.xy);
  let texSize = vec2<u32>(u32(uniforms.resolution.x), u32(uniforms.resolution.y));

  if (texCoord.x >= texSize.x || texCoord.y >= texSize.y) {
    return;
  }

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);

  // Apply aspect ratio correction to prevent stretching
  let aspect = uniforms.resolution.x / uniforms.resolution.y;
  let uv_corrected = vec2<f32>(uv.x * aspect, uv.y);

  let metric = ${metricIndex}; // 0=Euclidean, 1=Manhattan, 2=Chebyshev, 3=Minkowski
  let voronoiData = voronoi(uv_corrected, metric);
  let dist1 = voronoiData.x;
  let dist2 = voronoiData.y;
  let cellId = voronoiData.zw;

  var color: vec3<f32>;
  let mode = ${modeIndex}; // 0=Cells, 1=Distance, 2=Borders, 3=Worley

  if (mode == 0) {
    // Cells mode: Color by cell ID with varied hues
    // Generate different hash values for hue, saturation, and value
    let hash_hue = hash1(cellId + vec2<f32>(uniforms.seed, 0.0));
    let hash_sat = hash1(cellId + vec2<f32>(uniforms.seed + 1.234, 5.678));
    let hash_val = hash1(cellId + vec2<f32>(uniforms.seed + 2.345, 6.789));

    // Map hash to HSV values
    let hue = hash_hue; // Already 0-1 from hash
    let sat = 0.6 + hash_sat * 0.4; // 0.6 to 1.0
    let val = 0.7 + hash_val * 0.3; // 0.7 to 1.0

    // HSV to RGB conversion
    let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(vec3<f32>(hue) + k.xyz) * 6.0 - k.www);
    color = val * mix(k.xxx, clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), sat);
  } else if (mode == 1) {
    // Distance mode: Visualize distance field
    let d = clamp(dist1 * 2.0, 0.0, 1.0);
    color = vec3<f32>(d);
  } else if (mode == 2) {
    // Borders mode: Show cell borders
    let borderWidth = 0.05;
    let border = smoothstep(0.0, borderWidth, dist2 - dist1);
    color = vec3<f32>(border);
  } else {
    // Worley noise mode: F2 - F1
    let worley = clamp(dist2 - dist1, 0.0, 1.0);
    color = vec3<f32>(worley);
  }

  textureStore(outputTexture, texCoord, vec4<f32>(color, 1.0));
}`;

    return shader;
  }

  /**
   * Generate gradient shader
   */
  generateGradientShader(node, getInput) {
    const type = this.getParam(node, 'type', 'Linear');
    const angle = this.getParam(node, 'angle', 0.0);
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const radius = this.getParam(node, 'radius', 0.5);
    const repeat = this.getParam(node, 'repeat', 1);
    const reverse = this.getParam(node, 'reverse', false);
    const colorMode = this.getParam(node, 'colorMode', 'Grayscale');
    const saturation = this.getParam(node, 'saturation', 0.8);
    const brightness = this.getParam(node, 'brightness', 1.0);
    const interpolation = this.getParam(node, 'interpolation', 'Linear');

    // Get color stops (max 8 stops supported)
    const colorStops = this.getParam(node, 'colorStops', [
      { position: 0.0, color: [0, 0, 0, 1] },
      { position: 1.0, color: [1, 1, 1, 1] }
    ]);

    const numStops = Math.min(colorStops.length, 8);
    const typeIndex = this.getGradientTypeIndex(type);
    const colorModeIndex = this.getColorModeIndex(colorMode);
    const interpolationIndex = this.getInterpolationIndex(interpolation);

    // Debug logging
    console.log('[ComputeGradient Shader Generation]', {
      colorMode,
      colorModeIndex,
      type,
      typeIndex,
      interpolation,
      interpolationIndex,
      numStops,
      colorStops: colorStops.slice(0, 2)
    });

    const shader = `
// Compute Gradient Shader - Type: ${type}, ColorMode: ${colorMode}
struct ColorStop {
  position: f32,
  color: vec4<f32>
}

struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  angle: f32,
  center: vec2<f32>,
  radius: f32,
  repeat: f32,
  saturation: f32,
  brightness: f32,
  numStops: f32,
  _padding1: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<storage, read> colorStops: array<ColorStop, 8>;

const PI = 3.14159265359;

// HSV to RGB conversion
fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3<f32>(h) + k.xyz) * 6.0 - k.www);
  return v * mix(vec3<f32>(1.0), clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), s);
}

// Smooth interpolation
fn smoothInterp(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

// Sample color from gradient stops
fn sampleGradient(t: f32, interpMode: i32) -> vec4<f32> {
  let numStops = i32(uniforms.numStops);

  if (numStops == 0) {
    return vec4<f32>(0.0);
  }

  if (t <= colorStops[0].position) {
    return colorStops[0].color;
  }

  if (t >= colorStops[numStops - 1].position) {
    return colorStops[numStops - 1].color;
  }

  // Find the two stops to interpolate between
  for (var i = 0; i < numStops - 1; i++) {
    let pos0 = colorStops[i].position;
    let pos1 = colorStops[i + 1].position;

    if (t >= pos0 && t <= pos1) {
      let localT = (t - pos0) / (pos1 - pos0);

      // Apply interpolation mode
      var adjustedT = localT;
      if (interpMode == 1) {
        // Step interpolation
        adjustedT = 0.0;
      } else if (interpMode == 2) {
        // Smooth interpolation
        adjustedT = smoothInterp(localT);
      }

      return mix(colorStops[i].color, colorStops[i + 1].color, adjustedT);
    }
  }

  return colorStops[0].color;
}

// Linear gradient
fn gradientLinear(uv: vec2<f32>, angle: f32) -> f32 {
  let radians = angle * PI / 180.0;
  let dir = vec2<f32>(cos(radians), sin(radians));
  return dot(uv - 0.5, dir) + 0.5;
}

// Radial gradient
fn gradientRadial(uv: vec2<f32>, center: vec2<f32>, radius: f32) -> f32 {
  let dist = length(uv - center);
  return 1.0 - clamp(dist / radius, 0.0, 1.0);
}

// Angular/Conical gradient
fn gradientAngular(uv: vec2<f32>, center: vec2<f32>, angle: f32) -> f32 {
  let offset = uv - center;
  var a = atan2(offset.y, offset.x);
  a = a / (2.0 * PI) + 0.5; // Normalize to 0-1

  // Apply angle rotation
  a = fract(a + angle / 360.0);

  return a;
}

// Diamond gradient
fn gradientDiamond(uv: vec2<f32>, center: vec2<f32>, radius: f32) -> f32 {
  let offset = abs(uv - center);
  let dist = (offset.x + offset.y);
  return 1.0 - clamp(dist / radius, 0.0, 1.0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<u32>(global_id.xy);
  let texSize = vec2<u32>(u32(uniforms.resolution.x), u32(uniforms.resolution.y));

  if (texCoord.x >= texSize.x || texCoord.y >= texSize.y) {
    return;
  }

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);

  // Apply aspect ratio correction to prevent stretching in radial/angular gradients
  let aspect = uniforms.resolution.x / uniforms.resolution.y;
  let uv_corrected = vec2<f32>(uv.x * aspect - (aspect - 1.0) * 0.5, uv.y);
  let center_corrected = vec2<f32>(uniforms.center.x * aspect, uniforms.center.y);

  var gradient: f32;
  let gradientType = ${typeIndex}; // 0=Linear, 1=Radial, 2=Angular, 3=Diamond

  if (gradientType == 0) {
    gradient = gradientLinear(uv, uniforms.angle);
  } else if (gradientType == 1) {
    gradient = gradientRadial(uv_corrected, center_corrected, uniforms.radius);
  } else if (gradientType == 2) {
    gradient = gradientAngular(uv_corrected, center_corrected, uniforms.angle);
  } else {
    gradient = gradientDiamond(uv_corrected, center_corrected, uniforms.radius);
  }

  // Apply repeat
  gradient = fract(gradient * uniforms.repeat);

  // Apply reverse
  ${reverse ? `
  gradient = 1.0 - gradient;
  ` : ''}

  // Apply color mode
  var color: vec4<f32>;
  let colorMode = ${colorModeIndex}; // 0=Grayscale, 1=Rainbow, 2=Gradient

  if (colorMode == 1) {
    // Rainbow spectrum
    let rgb = hsv2rgb(gradient, uniforms.saturation, uniforms.brightness);
    color = vec4<f32>(rgb, 1.0);
  } else if (colorMode == 2) {
    // Gradient with color stops
    color = sampleGradient(gradient, ${interpolationIndex});
  } else {
    // Grayscale
    let gray = gradient * uniforms.brightness;
    color = vec4<f32>(gray, gray, gray, 1.0);
  }

  textureStore(outputTexture, texCoord, color);
}`;

    return shader;
  }

  /**
   * Generate pattern shader
   */
  generatePatternShader(node, getInput) {
    const type = this.getParam(node, 'type', 'Checkerboard');
    const scaleX = this.getParam(node, 'scaleX', 8.0);
    const scaleY = this.getParam(node, 'scaleY', 8.0);
    const rotation = this.getParam(node, 'rotation', 0.0);
    const thickness = this.getParam(node, 'thickness', 0.5);
    const smoothness = this.getParam(node, 'smoothness', 0.01);

    const typeIndex = this.getPatternTypeIndex(type);

    const shader = `
// Compute Pattern Shader - Type: ${type}
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  _padding1: f32,
  scale: vec2<f32>,
  rotation: f32,
  thickness: f32,
  smoothness: f32,
  _padding2: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

const PI = 3.14159265359;

// Rotate UV coordinates
fn rotate2D(uv: vec2<f32>, angle: f32) -> vec2<f32> {
  let center = vec2<f32>(0.5);
  let offset = uv - center;
  let radians = angle * PI / 180.0;
  let c = cos(radians);
  let s = sin(radians);
  let rotated = vec2<f32>(
    offset.x * c - offset.y * s,
    offset.x * s + offset.y * c
  );
  return rotated + center;
}

// Checkerboard pattern
fn patternCheckerboard(uv: vec2<f32>) -> f32 {
  let cell = floor(uv);
  // Replicate mod(cell.x + cell.y, 2.0) without using mod()
  // fract(n * 0.5) * 2.0 gives: 0,1,0,1,... for n=0,1,2,3,...
  return fract((cell.x + cell.y) * 0.5) * 2.0;
}

// Stripes pattern (horizontal by default, use rotation for vertical/diagonal)
fn patternStripes(uv: vec2<f32>, thickness: f32) -> f32 {
  let stripePos = fract(uv.y);
  return smoothstep(thickness - uniforms.smoothness, thickness + uniforms.smoothness, stripePos);
}

// Dots pattern
fn patternDots(uv: vec2<f32>, thickness: f32) -> f32 {
  let cell = fract(uv);
  let center = vec2<f32>(0.5);
  let dist = length(cell - center);
  let radius = thickness * 0.5;
  return 1.0 - smoothstep(radius - uniforms.smoothness, radius + uniforms.smoothness, dist);
}

// Grid pattern
fn patternGrid(uv: vec2<f32>, thickness: f32) -> f32 {
  let cell = fract(uv);
  let lineWidth = thickness * 0.1;

  let edgeX = smoothstep(lineWidth, lineWidth + uniforms.smoothness, cell.x) *
              smoothstep(lineWidth, lineWidth + uniforms.smoothness, 1.0 - cell.x);
  let edgeY = smoothstep(lineWidth, lineWidth + uniforms.smoothness, cell.y) *
              smoothstep(lineWidth, lineWidth + uniforms.smoothness, 1.0 - cell.y);

  return 1.0 - (edgeX * edgeY);
}

// Hexagon pattern
fn patternHexagon(uv: vec2<f32>, thickness: f32) -> f32 {
  // Hexagonal grid
  let s = vec2<f32>(1.0, 1.732); // sqrt(3)
  let p = vec2<f32>(uv.x, uv.y * s.y);

  let pi = floor(p);
  var pf = fract(p);

  // Determine which of 3 hexagon tiles we're in
  var h = 0.0;
  if (pf.x + pf.y > 1.0) {
    pf = 1.0 - pf;
    h = 1.0;
  }

  // Distance to center of hexagon
  let center = vec2<f32>(0.5);
  let dist = length(pf - center);

  return 1.0 - smoothstep(thickness * 0.5 - uniforms.smoothness,
                          thickness * 0.5 + uniforms.smoothness, dist);
}

// Brick pattern
fn patternBrick(uv: vec2<f32>, thickness: f32) -> f32 {
  var pos = uv;

  // Offset every other row
  let row = floor(pos.y);
  // WGSL doesn't have mod(), use fract for alternating pattern
  pos.x += step(1.0, fract(row * 0.5) * 2.0) * 0.5;

  let cell = fract(pos);
  let mortarWidth = (1.0 - thickness) * 0.1;

  let edgeX = smoothstep(mortarWidth, mortarWidth + uniforms.smoothness, cell.x) *
              smoothstep(mortarWidth, mortarWidth + uniforms.smoothness, 1.0 - cell.x);
  let edgeY = smoothstep(mortarWidth, mortarWidth + uniforms.smoothness, cell.y) *
              smoothstep(mortarWidth, mortarWidth + uniforms.smoothness, 1.0 - cell.y);

  return edgeX * edgeY;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<u32>(global_id.xy);
  let texSize = vec2<u32>(u32(uniforms.resolution.x), u32(uniforms.resolution.y));

  if (texCoord.x >= texSize.x || texCoord.y >= texSize.y) {
    return;
  }

  var uv = vec2<f32>(texCoord) / vec2<f32>(texSize);

  // Apply rotation
  uv = rotate2D(uv, uniforms.rotation);

  // Apply scale
  uv = uv * uniforms.scale;

  var pattern: f32;
  let patternType = ${typeIndex}; // 0=Checkerboard, 1=Stripes, 2=Dots, 3=Grid, 4=Hexagon, 5=Brick

  if (patternType == 0) {
    pattern = patternCheckerboard(uv);
  } else if (patternType == 1) {
    pattern = patternStripes(uv, uniforms.thickness);
  } else if (patternType == 2) {
    pattern = patternDots(uv, uniforms.thickness);
  } else if (patternType == 3) {
    pattern = patternGrid(uv, uniforms.thickness);
  } else if (patternType == 4) {
    pattern = patternHexagon(uv, uniforms.thickness);
  } else {
    pattern = patternBrick(uv, uniforms.thickness);
  }

  let color = vec3<f32>(pattern);
  textureStore(outputTexture, texCoord, vec4<f32>(color, 1.0));
}`;

    return shader;
  }

  /**
   * Convert Voronoi mode to index
   */
  getVoronoiModeIndex(mode) {
    const modes = {
      'Cells': 0,
      'Distance': 1,
      'Borders': 2,
      'Worley': 3
    };
    return modes[mode] || 0;
  }

  /**
   * Convert distance metric to index
   */
  getDistanceMetricIndex(metric) {
    const metrics = {
      'Euclidean': 0,
      'Manhattan': 1,
      'Chebyshev': 2,
      'Minkowski': 3
    };
    return metrics[metric] || 0;
  }

  /**
   * Convert gradient type to index
   */
  getGradientTypeIndex(type) {
    const types = {
      'Linear': 0,
      'Radial': 1,
      'Angular': 2,
      'Diamond': 3
    };
    return types[type] || 0;
  }

  /**
   * Convert color mode to index
   */
  getColorModeIndex(mode) {
    const modes = {
      'Grayscale': 0,
      'Rainbow': 1,
      'Gradient': 2
    };
    return modes[mode] || 0;
  }

  /**
   * Convert interpolation mode to index
   */
  getInterpolationIndex(mode) {
    const modes = {
      'Linear': 0,
      'Step': 1,
      'Smooth': 2
    };
    return modes[mode] || 0;
  }

  /**
   * Convert pattern type to index
   */
  getPatternTypeIndex(type) {
    const types = {
      'Checkerboard': 0,
      'Stripes': 1,
      'Dots': 2,
      'Grid': 3,
      'Hexagon': 4,
      'Brick': 5
    };
    return types[type] || 0;
  }

  /**
   * Generate warp distortion shader
   */
  generateWarpShader(node, getInput) {
    const mode = this.getParam(node, 'mode', 'Displace');
    const strength = this.getParam(node, 'strength', 0.1);
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const radius = this.getParam(node, 'radius', 0.5);
    const frequency = this.getParam(node, 'frequency', 4.0);
    const phase = this.getParam(node, 'phase', 0.0);

    const modeIndex = this.getWarpModeIndex(mode);

    const shader = `
// Compute Warp Distortion Shader - Mode: ${mode}
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  strength: f32,
  center: vec2<f32>,
  radius: f32,
  frequency: f32,
  phase: f32,
  _padding: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;
@group(0) @binding(4) var warpField: texture_2d<f32>;

const PI = 3.14159265359;

// Sample texture with boundary clamping using textureLoad (for compute shaders)
fn sampleTexture(tex: texture_2d<f32>, uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  // Convert UV to pixel coordinates
  let pixelCoord = vec2<i32>(uv * vec2<f32>(texSize));

  // Clamp to texture boundaries
  let clampedCoord = clamp(pixelCoord, vec2<i32>(0), vec2<i32>(texSize) - vec2<i32>(1));

  return textureLoad(tex, clampedCoord, 0);
}

// Displace mode: Direct UV displacement based on warp field
fn applyDisplace(uv: vec2<f32>, warpValue: vec4<f32>) -> vec2<f32> {
  // Use RG channels as displacement vector
  let displacement = (warpValue.rg - 0.5) * 2.0; // Remap from [0,1] to [-1,1]
  return uv + displacement * uniforms.strength;
}

// Twist mode: Rotate UV around center based on distance
fn applyTwist(uv: vec2<f32>, warpValue: vec4<f32>) -> vec2<f32> {
  let offset = uv - uniforms.center;
  let dist = length(offset);

  // Twist intensity - warp field adds variation (not multiplies)
  let warpIntensity = (warpValue.r - 0.5) * 2.0; // Remap to [-1,1]
  let falloff = 1.0 - smoothstep(0.0, uniforms.radius, dist);
  let angle = (dist + warpIntensity * 0.5) * uniforms.strength * falloff * PI * 2.0;

  // Rotate around center
  let c = cos(angle);
  let s = sin(angle);
  let rotated = vec2<f32>(
    offset.x * c - offset.y * s,
    offset.x * s + offset.y * c
  );

  return uniforms.center + rotated;
}

// Bulge mode: Push outward from center
fn applyBulge(uv: vec2<f32>, warpValue: vec4<f32>) -> vec2<f32> {
  let offset = uv - uniforms.center;
  let dist = length(offset);

  if (dist < 0.001) {
    return uv;
  }

  let warpIntensity = (warpValue.r - 0.5) * 2.0; // Remap to [-1,1]
  let falloff = 1.0 - smoothstep(0.0, uniforms.radius, dist);

  // Bulge outward - warp field adds spatial variation
  let bulgeAmount = (uniforms.strength + warpIntensity * 0.5) * falloff;
  let newDist = dist * (1.0 + bulgeAmount);

  return uniforms.center + normalize(offset) * newDist;
}

// Pinch mode: Pull inward toward center
fn applyPinch(uv: vec2<f32>, warpValue: vec4<f32>) -> vec2<f32> {
  let offset = uv - uniforms.center;
  let dist = length(offset);

  if (dist < 0.001) {
    return uv;
  }

  let warpIntensity = (warpValue.r - 0.5) * 2.0; // Remap to [-1,1]
  let falloff = 1.0 - smoothstep(0.0, uniforms.radius, dist);

  // Pinch inward - warp field adds spatial variation
  let pinchAmount = (uniforms.strength + warpIntensity * 0.5) * falloff;
  let newDist = dist * (1.0 - pinchAmount);

  return uniforms.center + normalize(offset) * newDist;
}

// Wave mode: Sinusoidal wave distortion
fn applyWave(uv: vec2<f32>, warpValue: vec4<f32>) -> vec2<f32> {
  let warpIntensity = (warpValue.r - 0.5) * 2.0; // Remap to [-1,1]

  // Create wave pattern based on frequency and phase
  let phaseRad = uniforms.phase * PI / 180.0;
  let waveX = sin(uv.y * uniforms.frequency * PI * 2.0 + phaseRad);
  let waveY = sin(uv.x * uniforms.frequency * PI * 2.0 + phaseRad);

  // Apply wave displacement - warp field adds spatial variation
  let displacement = vec2<f32>(waveX, waveY) * (uniforms.strength + warpIntensity * 0.5) * 0.1;

  return uv + displacement;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);
  let warpSize = textureDimensions(warpField);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);

  // Sample warp field at current position
  let warpValue = sampleTexture(warpField, uv, warpSize);

  // Apply distortion based on mode
  var distortedUV: vec2<f32>;
  let mode = ${modeIndex}; // 0=Displace, 1=Twist, 2=Bulge, 3=Pinch, 4=Wave

  if (mode == 0) {
    distortedUV = applyDisplace(uv, warpValue);
  } else if (mode == 1) {
    distortedUV = applyTwist(uv, warpValue);
  } else if (mode == 2) {
    distortedUV = applyBulge(uv, warpValue);
  } else if (mode == 3) {
    distortedUV = applyPinch(uv, warpValue);
  } else {
    distortedUV = applyWave(uv, warpValue);
  }

  // Sample input texture at distorted UV coordinates
  let color = sampleTexture(inputTexture, distortedUV, texSize);

  textureStore(outputTexture, vec2<u32>(texCoord), color);
}`;

    return shader;
  }

  /**
   * Generate glitch effect shader
   */
  generateGlitchShader(node, getInput) {
    const type = this.getParam(node, 'type', 'RGB Shift');
    const intensity = this.getParam(node, 'intensity', 0.5);
    const frequency = this.getParam(node, 'frequency', 0.5);
    const blockSize = this.getParam(node, 'blockSize', 0.05);
    const seed = this.getParam(node, 'seed', 0.0);

    const typeIndex = this.getGlitchTypeIndex(type);

    const shader = `
// Compute Glitch Shader - Type: ${type}
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  intensity: f32,
  frequency: f32,
  _padding1: f32,
  blockSize: f32,
  seed: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// Hash function for pseudo-random values
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Hash for vec2 output
fn hash2(p: vec2<f32>) -> vec2<f32> {
  let p3 = fract(vec3<f32>(p.xyx) * vec3<f32>(0.1031, 0.1030, 0.0973));
  let p4 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p4.xx + p4.yz) * p4.zy);
}

// Safe texture sampling with clamping
fn sampleTexture(tex: texture_2d<f32>, uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  let clampedUV = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  let coord = vec2<i32>(clampedUV * vec2<f32>(texSize));
  return textureLoad(tex, coord, 0);
}

// RGB Shift effect - chromatic aberration
fn applyRGBShift(uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  let shiftAmount = uniforms.intensity * 0.02;

  // Add some randomness based on vertical position and time
  let rowHash = hash(vec2<f32>(uv.y * 10.0, floor(uniforms.time * 2.0 + uniforms.seed)));
  let shift = shiftAmount * (1.0 + rowHash * 0.5);

  let r = sampleTexture(inputTexture, uv + vec2<f32>(shift, 0.0), texSize).r;
  let g = sampleTexture(inputTexture, uv, texSize).g;
  let b = sampleTexture(inputTexture, uv - vec2<f32>(shift, 0.0), texSize).b;

  return vec4<f32>(r, g, b, 1.0);
}

// Block glitch effect - horizontal displacement blocks
fn applyBlockGlitch(uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  let blockHeight = uniforms.blockSize;
  let blockY = floor(uv.y / blockHeight);
  let blockTime = floor(uniforms.time * 10.0 + uniforms.seed);

  // Generate random value for this block
  let randVal = hash(vec2<f32>(blockY, blockTime));

  // Apply glitch to random blocks based on frequency
  var glitchedUV = uv;
  if (randVal < uniforms.frequency) {
    // Random horizontal offset
    let offset = (randVal - 0.5) * uniforms.intensity * 0.3;
    glitchedUV.x += offset;

    // Occasionally add color corruption
    if (randVal < uniforms.frequency * 0.3) {
      let color = sampleTexture(inputTexture, glitchedUV, texSize);
      let glitchColor = vec3<f32>(color.r, color.b, color.g); // Channel swap
      return vec4<f32>(glitchColor, 1.0);
    }
  }

  return sampleTexture(inputTexture, glitchedUV, texSize);
}

// Scanline effect - CRT-style horizontal lines
fn applyScanline(uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  let color = sampleTexture(inputTexture, uv, texSize);

  // Create scanline pattern
  let scanlineFreq = 200.0 * (1.0 + uniforms.frequency * 4.0);
  let scanline = sin(uv.y * scanlineFreq) * 0.5 + 0.5;
  let scanlineIntensity = uniforms.intensity * 0.3;

  // Add moving interference lines
  let interference = sin(uv.y * 50.0 - uniforms.time * 5.0 + uniforms.seed) * 0.5 + 0.5;
  let interferenceIntensity = uniforms.intensity * 0.2;

  // Combine effects
  let darkening = 1.0 - (scanlineIntensity * (1.0 - scanline));
  let brightening = interferenceIntensity * interference * uniforms.frequency;

  let finalColor = color.rgb * darkening + brightening;

  return vec4<f32>(finalColor, color.a);
}

// Pixelate effect - mosaic/low-resolution
fn applyPixelate(uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  // Calculate pixel size based on block size parameter
  let pixelSize = max(uniforms.blockSize, 0.01);

  // Add some jitter based on time and frequency
  let jitter = hash(vec2<f32>(floor(uniforms.time * 5.0 + uniforms.seed), 0.0)) * uniforms.frequency * 0.01;

  // Snap UV to pixel grid
  let pixelUV = floor(uv / (pixelSize + jitter)) * (pixelSize + jitter) + (pixelSize + jitter) * 0.5;

  // Sample at pixelated position
  var color = sampleTexture(inputTexture, pixelUV, texSize);

  // Add color quantization for more intense effect
  if (uniforms.intensity > 0.5) {
    let colorLevels = mix(256.0, 8.0, (uniforms.intensity - 0.5) * 2.0);
    color = floor(color * colorLevels) / colorLevels;
  }

  return color;
}

// Corrupt effect - data corruption/noise artifacts
fn applyCorrupt(uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  let baseColor = sampleTexture(inputTexture, uv, texSize);

  // Create corruption blocks
  let blockSize = uniforms.blockSize * 2.0;
  let blockCoord = floor(uv / blockSize);
  let blockTime = floor(uniforms.time * 3.0 + uniforms.seed);
  let blockHash = hash(blockCoord + blockTime);

  // Determine if this block is corrupted
  if (blockHash < uniforms.frequency) {
    let corruptType = hash(blockCoord * 2.0 + blockTime);

    if (corruptType < 0.33) {
      // Complete corruption - random color
      let randColor = hash2(blockCoord + vec2<f32>(blockTime, uniforms.seed));
      return vec4<f32>(randColor, hash(randColor), 1.0);
    } else if (corruptType < 0.66) {
      // Bit-shift effect - channel displacement
      let offset = (hash2(blockCoord + blockTime) - 0.5) * uniforms.intensity * 0.1;
      let r = sampleTexture(inputTexture, uv + offset, texSize).r;
      let g = sampleTexture(inputTexture, uv - offset, texSize).g;
      let b = baseColor.b;
      return vec4<f32>(r, g, b, 1.0);
    } else {
      // Color inversion/corruption
      return vec4<f32>(1.0 - baseColor.rgb, 1.0);
    }
  }

  // Add noise overlay
  let noise = hash(uv * vec2<f32>(texSize) + blockTime) - 0.5;
  let noisyColor = baseColor.rgb + noise * uniforms.intensity * 0.1;

  return vec4<f32>(noisyColor, baseColor.a);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);

  var color: vec4<f32>;
  let glitchType = ${typeIndex}; // 0=RGB Shift, 1=Block, 2=Scanline, 3=Pixelate, 4=Corrupt

  if (glitchType == 0) {
    color = applyRGBShift(uv, texSize);
  } else if (glitchType == 1) {
    color = applyBlockGlitch(uv, texSize);
  } else if (glitchType == 2) {
    color = applyScanline(uv, texSize);
  } else if (glitchType == 3) {
    color = applyPixelate(uv, texSize);
  } else {
    color = applyCorrupt(uv, texSize);
  }

  textureStore(outputTexture, vec2<u32>(texCoord), color);
}`;

    return shader;
  }

  /**
   * Generate kaleidoscope shader - symmetry and mirroring effects
   */
  generateKaleidoscopeShader(node, getInput) {
    const segments = this.getParam(node, 'segments', 6);
    const rotation = this.getParam(node, 'rotation', 0.0);
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const scale = this.getParam(node, 'scale', 1.0);
    const animate = this.getParam(node, 'animate', false);
    const speed = this.getParam(node, 'speed', 0.5);

    const shader = `
// Compute Kaleidoscope Shader - ${segments} segments
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  segments: f32,
  rotation: f32,
  centerX: f32,
  centerY: f32,
  scale: f32,
  animate: f32,
  speed: f32,
  _padding: vec3<f32>
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

const PI: f32 = 3.14159265359;

// NOTE: textureSample() cannot be used in compute shaders (only in fragment shaders).
// We must use textureLoad() with manual coordinate wrapping for tiling behavior.
// The sampler binding is required by the bind group layout but not used in compute.

// Apply kaleidoscope effect
// Based on working fragment shader implementation from FieldNodes.js
fn applyKaleidoscope(uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  // Normalize to [-1, 1] space (centered at origin)
  var p = uv * 2.0 - vec2<f32>(1.0, 1.0);

  // Apply offset from center parameters (convert [0,1] center to [-1,1] offset)
  p -= vec2<f32>(uniforms.centerX - 0.5, uniforms.centerY - 0.5) * 2.0;

  // Apply zoom/scale
  if (uniforms.scale != 1.0) {
    p /= uniforms.scale;
  }

  // Convert to polar coordinates
  let r = length(p);
  var angle = atan2(p.y, p.x);

  // Apply rotation (convert degrees to radians)
  var rotationRad = uniforms.rotation * PI / 180.0;

  // Add animation if enabled
  if (uniforms.animate > 0.5) {
    rotationRad += uniforms.time * uniforms.speed;
  }

  angle += rotationRad;

  // Calculate segment angle
  let segmentAngle = (2.0 * PI) / uniforms.segments;

  // Fold angle into segment using manual modulo (avoids % operator issues)
  let k = floor(angle / segmentAngle);
  var a = angle - k * segmentAngle;

  // Mirror if in second half of segment (key difference from previous attempt!)
  if (a > segmentAngle * 0.5) {
    a = segmentAngle - a;
  }

  // Convert back to Cartesian
  let x = r * cos(a);
  let y = r * sin(a);

  // Convert back to [0, 1] UV space
  var sampledUV = vec2<f32>(x, y) * 0.5 + vec2<f32>(0.5, 0.5);

  // Wrap coordinates for seamless tiling
  sampledUV = fract(sampledUV);

  // Convert to pixel coordinates and sample
  let pixelCoord = vec2<i32>(sampledUV * vec2<f32>(texSize));
  let clampedCoord = clamp(pixelCoord, vec2<i32>(0), vec2<i32>(texSize) - vec2<i32>(1));

  return textureLoad(inputTexture, clampedCoord, 0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);
  let color = applyKaleidoscope(uv, texSize);

  textureStore(outputTexture, vec2<u32>(texCoord), color);
}`;

    return shader;
  }

  /**
   * Generate mix/blend shader - composite two textures with blend modes
   */
  generateMixShader(node, getInput) {
    const mode = this.getParam(node, 'mode', 'Mix');
    const amount = this.getParam(node, 'amount', 0.5);
    const opacity = this.getParam(node, 'opacity', 1.0);

    const modeIndex = this.getBlendModeIndex(mode);

    const shader = `
// Compute Mix/Blend Shader - Mode: ${mode}
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  amount: f32,
  opacity: f32,
  _padding: vec3<f32>
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTextureA: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;
@group(0) @binding(4) var inputTextureB: texture_2d<f32>;

// Sample texture with boundary clamping using textureLoad
fn sampleTexture(tex: texture_2d<f32>, uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  let pixelCoord = vec2<i32>(uv * vec2<f32>(texSize));
  let clampedCoord = clamp(pixelCoord, vec2<i32>(0), vec2<i32>(texSize) - vec2<i32>(1));
  return textureLoad(tex, clampedCoord, 0);
}

// Blend mode functions
fn blendMultiply(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return base * blend;
}

fn blendScreen(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(1.0) - (vec3<f32>(1.0) - base) * (vec3<f32>(1.0) - blend);
}

fn blendOverlay(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  var result: vec3<f32>;

  if (base.r < 0.5) {
    result.r = 2.0 * base.r * blend.r;
  } else {
    result.r = 1.0 - 2.0 * (1.0 - base.r) * (1.0 - blend.r);
  }

  if (base.g < 0.5) {
    result.g = 2.0 * base.g * blend.g;
  } else {
    result.g = 1.0 - 2.0 * (1.0 - base.g) * (1.0 - blend.g);
  }

  if (base.b < 0.5) {
    result.b = 2.0 * base.b * blend.b;
  } else {
    result.b = 1.0 - 2.0 * (1.0 - base.b) * (1.0 - blend.b);
  }

  return result;
}

fn blendAdd(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return clamp(base + blend, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn blendDifference(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return abs(base - blend);
}

fn blendExclusion(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return base + blend - 2.0 * base * blend;
}

fn blendLighten(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return max(base, blend);
}

fn blendDarken(base: vec3<f32>, blend: vec3<f32>) -> vec3<f32> {
  return min(base, blend);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSizeA = textureDimensions(inputTextureA);
  let texSizeB = textureDimensions(inputTextureB);

  if (texCoord.x >= i32(texSizeA.x) || texCoord.y >= i32(texSizeA.y)) {
    return;
  }

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSizeA);

  // Sample both input textures
  let colorA = sampleTexture(inputTextureA, uv, texSizeA);
  let colorB = sampleTexture(inputTextureB, uv, texSizeB);

  var blendedColor: vec3<f32>;
  let blendMode = ${modeIndex}; // 0=Mix, 1=Add, 2=Multiply, 3=Screen, 4=Overlay, 5=Difference, 6=Exclusion, 7=Lighten, 8=Darken

  if (blendMode == 0) {
    // Mix mode - simple linear interpolation
    blendedColor = mix(colorA.rgb, colorB.rgb, uniforms.amount);
  } else if (blendMode == 1) {
    // Add mode
    blendedColor = blendAdd(colorA.rgb, colorB.rgb);
  } else if (blendMode == 2) {
    // Multiply mode
    blendedColor = blendMultiply(colorA.rgb, colorB.rgb);
  } else if (blendMode == 3) {
    // Screen mode
    blendedColor = blendScreen(colorA.rgb, colorB.rgb);
  } else if (blendMode == 4) {
    // Overlay mode
    blendedColor = blendOverlay(colorA.rgb, colorB.rgb);
  } else if (blendMode == 5) {
    // Difference mode
    blendedColor = blendDifference(colorA.rgb, colorB.rgb);
  } else if (blendMode == 6) {
    // Exclusion mode
    blendedColor = blendExclusion(colorA.rgb, colorB.rgb);
  } else if (blendMode == 7) {
    // Lighten mode
    blendedColor = blendLighten(colorA.rgb, colorB.rgb);
  } else {
    // Darken mode
    blendedColor = blendDarken(colorA.rgb, colorB.rgb);
  }

  // Apply amount (for non-Mix modes, amount controls blend intensity)
  if (blendMode != 0) {
    blendedColor = mix(colorA.rgb, blendedColor, uniforms.amount);
  }

  // Apply opacity
  let finalColor = mix(colorA.rgb, blendedColor, uniforms.opacity);

  textureStore(outputTexture, vec2<u32>(texCoord), vec4<f32>(finalColor, colorA.a));
}`;

    return shader;
  }

  /**
   * Generate transform shader - translate, rotate, scale with pivot controls
   */
  generateTransformShader(node, getInput) {
    const translateX = this.getParam(node, 'translateX', 0.0);
    const translateY = this.getParam(node, 'translateY', 0.0);
    const rotation = this.getParam(node, 'rotation', 0.0);
    const scaleX = this.getParam(node, 'scaleX', 1.0);
    const scaleY = this.getParam(node, 'scaleY', 1.0);
    const pivotX = this.getParam(node, 'pivotX', 0.5);
    const pivotY = this.getParam(node, 'pivotY', 0.5);
    const wrapMode = this.getParam(node, 'wrapMode', 'Repeat');

    const wrapModeIndex = this.getWrapModeIndex(wrapMode);

    const shader = `
// Compute Transform Shader - Translate, Rotate, Scale
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  translateX: f32,
  translateY: f32,
  rotation: f32,
  scaleX: f32,
  scaleY: f32,
  pivotX: f32,
  pivotY: f32,
  _padding: vec2<f32>
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

const PI: f32 = 3.14159265359;
const WRAP_MODE: i32 = ${wrapModeIndex}; // 0=Repeat, 1=Clamp, 2=Mirror

// Sample texture with wrap mode
fn sampleTextureWithWrap(tex: texture_2d<f32>, uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  var wrappedUV = uv;

  // Apply wrap mode
  if (WRAP_MODE == 0) {
    // Repeat
    wrappedUV = fract(uv);
  } else if (WRAP_MODE == 1) {
    // Clamp
    wrappedUV = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  } else if (WRAP_MODE == 2) {
    // Mirror
    wrappedUV.x = abs(fract(uv.x * 0.5) * 2.0 - 1.0);
    wrappedUV.y = abs(fract(uv.y * 0.5) * 2.0 - 1.0);
  }

  // Convert to pixel coordinates and sample
  let pixelCoord = vec2<i32>(wrappedUV * vec2<f32>(texSize));
  let clampedCoord = clamp(pixelCoord, vec2<i32>(0), vec2<i32>(texSize) - vec2<i32>(1));

  return textureLoad(tex, clampedCoord, 0);
}

// Apply 2D transformation
fn applyTransform(uv: vec2<f32>, texSize: vec2<u32>) -> vec4<f32> {
  // Start with UV coordinates
  var p = uv;

  // 1. Translate to pivot point
  let pivot = vec2<f32>(uniforms.pivotX, uniforms.pivotY);
  p -= pivot;

  // 2. Apply scale (inverse, since we're transforming the sampling coordinates)
  let scale = vec2<f32>(uniforms.scaleX, uniforms.scaleY);
  if (scale.x != 0.0 && scale.y != 0.0) {
    p /= scale;
  }

  // 3. Apply rotation (inverse direction for coordinate transformation)
  let angle = -uniforms.rotation * PI / 180.0; // Convert degrees to radians and invert
  let cosA = cos(angle);
  let sinA = sin(angle);
  let rotated = vec2<f32>(
    p.x * cosA - p.y * sinA,
    p.x * sinA + p.y * cosA
  );
  p = rotated;

  // 4. Translate back from pivot
  p += pivot;

  // 5. Apply translation
  p -= vec2<f32>(uniforms.translateX, uniforms.translateY);

  // Sample with wrap mode
  return sampleTextureWithWrap(inputTexture, p, texSize);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);
  let color = applyTransform(uv, texSize);

  textureStore(outputTexture, vec2<u32>(texCoord), color);
}`;

    return shader;
  }

  /**
   * Generate channels shader - swap, extract, combine, remap channels
   */
  generateChannelsShader(node, getInput) {
    const redSource = this.getParam(node, 'redSource', 'R');
    const greenSource = this.getParam(node, 'greenSource', 'G');
    const blueSource = this.getParam(node, 'blueSource', 'B');
    const alphaSource = this.getParam(node, 'alphaSource', 'A');

    const redIndex = this.getChannelSourceIndex(redSource);
    const greenIndex = this.getChannelSourceIndex(greenSource);
    const blueIndex = this.getChannelSourceIndex(blueSource);
    const alphaIndex = this.getChannelSourceIndex(alphaSource);

    const shader = `
// Compute Channels Shader - Swap, Extract, Combine, Remap
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  redSource: f32,
  greenSource: f32,
  blueSource: f32,
  alphaSource: f32,
  _padding: vec3<f32>
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// Channel indices: 0=R, 1=G, 2=B, 3=A, 4=0, 5=1
fn getChannelValue(color: vec4<f32>, channelIndex: i32) -> f32 {
  switch (channelIndex) {
    case 0: { return color.r; }
    case 1: { return color.g; }
    case 2: { return color.b; }
    case 3: { return color.a; }
    case 4: { return 0.0; }
    case 5: { return 1.0; }
    default: { return 0.0; }
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  // Sample input color
  let inputColor = textureLoad(inputTexture, texCoord, 0);

  // Remap channels based on source selections
  let redIndex = i32(uniforms.redSource);
  let greenIndex = i32(uniforms.greenSource);
  let blueIndex = i32(uniforms.blueSource);
  let alphaIndex = i32(uniforms.alphaSource);

  let outputColor = vec4<f32>(
    getChannelValue(inputColor, redIndex),
    getChannelValue(inputColor, greenIndex),
    getChannelValue(inputColor, blueIndex),
    getChannelValue(inputColor, alphaIndex)
  );

  textureStore(outputTexture, vec2<u32>(texCoord), outputColor);
}`;

    return shader;
  }

  /**
   * Convert channel source to index
   * R=0, G=1, B=2, A=3, 0=4, 1=5
   */
  getChannelSourceIndex(source) {
    const sources = {
      'R': 0,
      'G': 1,
      'B': 2,
      'A': 3,
      '0': 4,
      '1': 5
    };
    return sources[source] || 0;
  }

  /**
   * Generate HSV shader for color space operations
   * Supports RGB to HSV, HSV to RGB, and Adjust HSV operations
   */
  generateHSVShader(node, getInput) {
    const operation = this.getParam(node, 'operation', 'Adjust HSV');
    const hueShift = this.getParam(node, 'hueShift', 0.0);
    const saturationMult = this.getParam(node, 'saturationMult', 1.0);
    const valueMult = this.getParam(node, 'valueMult', 1.0);

    // Convert operation to index: 0=RGB to HSV, 1=HSV to RGB, 2=Adjust HSV
    const operationIndex = operation === 'RGB to HSV' ? 0 : operation === 'HSV to RGB' ? 1 : 2;

    const shader = `
// Compute HSV Shader - HSV color space operations and conversions
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  operation: f32,
  hueShift: f32,
  saturationMult: f32,
  valueMult: f32,
  _padding: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// Convert RGB to HSV
fn rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, K.wz), vec4<f32>(c.gb, K.xy), step(c.b, c.g));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));

  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Convert HSV to RGB
fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  // Sample input color
  let inputColor = textureLoad(inputTexture, texCoord, 0);
  var outputColor = inputColor;

  let op = i32(uniforms.operation);

  if (op == 0) {
    // RGB to HSV conversion
    let hsv = rgb2hsv(inputColor.rgb);
    outputColor = vec4<f32>(hsv, inputColor.a);
  } else if (op == 1) {
    // HSV to RGB conversion
    let rgb = hsv2rgb(inputColor.rgb);
    outputColor = vec4<f32>(rgb, inputColor.a);
  } else if (op == 2) {
    // Adjust HSV
    var hsv = rgb2hsv(inputColor.rgb);

    // Apply hue shift (convert degrees to normalized value)
    hsv.x = fract(hsv.x + uniforms.hueShift / 360.0);

    // Apply saturation multiplier
    hsv.y = clamp(hsv.y * uniforms.saturationMult, 0.0, 1.0);

    // Apply value multiplier
    hsv.z = clamp(hsv.z * uniforms.valueMult, 0.0, 1.0);

    // Convert back to RGB
    let rgb = hsv2rgb(hsv);
    outputColor = vec4<f32>(rgb, inputColor.a);
  }

  textureStore(outputTexture, vec2<u32>(texCoord), outputColor);
}`;

    return shader;
  }

  /**
   * Generate Histogram shader for histogram-based operations
   * Supports: Equalize, Normalize, Stretch, Visualize
   */
  generateHistogramShader(node, getInput) {
    const operation = this.getParam(node, 'operation', 'Equalize');
    const channel = this.getParam(node, 'channel', 'Luminance');
    const bins = this.getParam(node, 'bins', 16);
    const strength = this.getParam(node, 'strength', 1.0);

    // Per-invocation histogram arrays are sized to this maximum, so it directly
    // sets the WGSL local-memory footprint per GPU thread (MAX_BINS f32 each, used
    // for the histogram + CDF). A LOCAL adaptive histogram is built from only the
    // subsampled neighbourhood (~81 taps), so bins beyond ~32 can't be populated
    // and just waste local memory and crater occupancy. Keep it small; the runtime
    // `bins` uniform (clamped to this) controls how many of these entries are used.
    const MAX_BINS = 32;

    // Convert operation to index: 0=Equalize, 1=Normalize, 2=Stretch, 3=Visualize
    const operationIndex = operation === 'Equalize' ? 0 : operation === 'Normalize' ? 1 : operation === 'Stretch' ? 2 : 3;

    // Convert channel to index: 0=RGB, 1=R, 2=G, 3=B, 4=Luminance
    const channelIndex = channel === 'RGB' ? 0 : channel === 'R' ? 1 : channel === 'G' ? 2 : channel === 'B' ? 3 : 4;

    const shader = `
// Compute Histogram Shader - Histogram equalization, normalization, and visualization
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  operation: f32,
  channel: f32,
  bins: f32,
  strength: f32,
  _padding: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// Calculate luminance
fn getLuminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.299, 0.587, 0.114));
}

// Maximum number of histogram bins. Arrays are sized to this maximum; only the
// first numBins entries are used. Kept small to bound per-thread local memory.
const MAX_BINS: i32 = ${MAX_BINS};

// Map a [0,1] value to a bin index in [0, numBins - 1].
fn binOf(value: f32, numBins: i32) -> i32 {
  return clamp(i32(value * f32(numBins)), 0, numBins - 1);
}

// Sample a region around a pixel to build local histogram.
// The neighbourhood is SUBSAMPLED with a stride so the tap count stays bounded
// (~9x9 = 81 reads) regardless of radius: a full radius-16 scan is 33x33 = 1089
// textureLoads per pixel, which saturates the GPU at full resolution and is far
// worse when a second viewer runs its own copy of the graph on the same device.
fn computeLocalHistogram(texCoord: vec2<i32>, texSize: vec2<u32>, radius: i32, channel: i32, numBins: i32) -> array<f32, ${MAX_BINS}> {
  var histogram: array<f32, ${MAX_BINS}>;
  var count = 0.0;
  let step = max(1, radius / 4);

  // Build histogram from local neighborhood
  for (var dy = -radius; dy <= radius; dy += step) {
    for (var dx = -radius; dx <= radius; dx += step) {
      let sampleCoord = texCoord + vec2<i32>(dx, dy);

      // Bounds check
      if (sampleCoord.x >= 0 && sampleCoord.x < i32(texSize.x) &&
          sampleCoord.y >= 0 && sampleCoord.y < i32(texSize.y)) {

        let color = textureLoad(inputTexture, sampleCoord, 0);
        var value: f32;

        // Select channel
        if (channel == 1) {
          value = color.r;
        } else if (channel == 2) {
          value = color.g;
        } else if (channel == 3) {
          value = color.b;
        } else {
          value = getLuminance(color.rgb);
        }

        histogram[binOf(value, numBins)] += 1.0;
        count += 1.0;
      }
    }
  }

  // Normalize histogram
  if (count > 0.0) {
    for (var i = 0; i < numBins; i++) {
      histogram[i] /= count;
    }
  }

  return histogram;
}

// Compute cumulative distribution function
fn computeCDF(histogram: array<f32, ${MAX_BINS}>, numBins: i32) -> array<f32, ${MAX_BINS}> {
  var cdf: array<f32, ${MAX_BINS}>;
  cdf[0] = histogram[0];

  for (var i = 1; i < numBins; i++) {
    cdf[i] = cdf[i - 1] + histogram[i];
  }

  return cdf;
}

// Apply histogram equalization
fn equalizeValue(value: f32, cdf: array<f32, ${MAX_BINS}>, numBins: i32) -> f32 {
  return cdf[binOf(value, numBins)];
}

// Apply contrast stretch
fn stretchValue(value: f32, minVal: f32, maxVal: f32) -> f32 {
  if (maxVal > minVal) {
    return clamp((value - minVal) / (maxVal - minVal), 0.0, 1.0);
  }
  return value;
}

// Create histogram visualization
fn visualizeHistogram(uv: vec2<f32>, color: vec4<f32>, histogram: array<f32, ${MAX_BINS}>, numBins: i32) -> vec4<f32> {
  let barHeight = 0.25; // Height of histogram overlay
  let barY = 0.85; // Bottom position

  // Check if we're in the histogram region
  if (uv.y > barY && uv.y < barY + barHeight) {
    let binIndex = i32(uv.x * f32(numBins));
    if (binIndex >= 0 && binIndex < numBins) {
      // Find max histogram value for scaling
      var maxHist = 0.0;
      for (var i = 0; i < numBins; i++) {
        maxHist = max(maxHist, histogram[i]);
      }

      // Scale histogram value
      let histValue = histogram[binIndex] / max(maxHist, 0.001);
      let normalizedY = (uv.y - barY) / barHeight;

      // Draw histogram bar
      if (normalizedY < histValue) {
        // Color bars based on intensity
        let intensity = f32(binIndex) / max(f32(numBins - 1), 1.0);
        return vec4<f32>(intensity, intensity * 0.7, 1.0 - intensity * 0.5, 0.9);
      } else {
        // Semi-transparent background
        return mix(color, vec4<f32>(0.0, 0.0, 0.0, 1.0), 0.5);
      }
    }
  }

  return color;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  let inputColor = textureLoad(inputTexture, texCoord, 0);
  var outputColor = inputColor;

  let op = i32(uniforms.operation);
  let chan = i32(uniforms.channel);
  let str = uniforms.strength;
  let numBins = clamp(i32(uniforms.bins), 2, MAX_BINS);

  // Compute local histogram for adaptive processing
  let radius = 16; // Local neighborhood radius
  let histogram = computeLocalHistogram(texCoord, texSize, radius, chan, numBins);

  if (op == 0) {
    // Equalize - histogram equalization
    let cdf = computeCDF(histogram, numBins);

    if (chan == 0) {
      // Apply to RGB
      let newR = mix(inputColor.r, equalizeValue(inputColor.r, cdf, numBins), str);
      let newG = mix(inputColor.g, equalizeValue(inputColor.g, cdf, numBins), str);
      let newB = mix(inputColor.b, equalizeValue(inputColor.b, cdf, numBins), str);
      outputColor = vec4<f32>(newR, newG, newB, inputColor.a);
    } else if (chan == 1) {
      // Red channel
      let newR = mix(inputColor.r, equalizeValue(inputColor.r, cdf, numBins), str);
      outputColor = vec4<f32>(newR, inputColor.g, inputColor.b, inputColor.a);
    } else if (chan == 2) {
      // Green channel
      let newG = mix(inputColor.g, equalizeValue(inputColor.g, cdf, numBins), str);
      outputColor = vec4<f32>(inputColor.r, newG, inputColor.b, inputColor.a);
    } else if (chan == 3) {
      // Blue channel
      let newB = mix(inputColor.b, equalizeValue(inputColor.b, cdf, numBins), str);
      outputColor = vec4<f32>(inputColor.r, inputColor.g, newB, inputColor.a);
    } else {
      // Luminance - equalize while preserving color
      let lum = getLuminance(inputColor.rgb);
      let newLum = mix(lum, equalizeValue(lum, cdf, numBins), str);

      if (lum > 0.001) {
        let scale = newLum / lum;
        outputColor = vec4<f32>(inputColor.rgb * scale, inputColor.a);
      } else {
        outputColor = vec4<f32>(newLum, newLum, newLum, inputColor.a);
      }
    }
  } else if (op == 1 || op == 2) {
    // Normalize or Stretch - find min/max and stretch
    var minVal = 1.0;
    var maxVal = 0.0;

    // Find local min/max (subsampled with the same step as the histogram build)
    let step = max(1, radius / 4);
    for (var dy = -radius; dy <= radius; dy += step) {
      for (var dx = -radius; dx <= radius; dx += step) {
        let sampleCoord = texCoord + vec2<i32>(dx, dy);

        if (sampleCoord.x >= 0 && sampleCoord.x < i32(texSize.x) &&
            sampleCoord.y >= 0 && sampleCoord.y < i32(texSize.y)) {

          let color = textureLoad(inputTexture, sampleCoord, 0);
          var value: f32;

          if (chan == 1) {
            value = color.r;
          } else if (chan == 2) {
            value = color.g;
          } else if (chan == 3) {
            value = color.b;
          } else {
            value = getLuminance(color.rgb);
          }

          minVal = min(minVal, value);
          maxVal = max(maxVal, value);
        }
      }
    }

    // Apply stretch
    if (chan == 0) {
      // Apply to RGB
      let newR = mix(inputColor.r, stretchValue(inputColor.r, minVal, maxVal), str);
      let newG = mix(inputColor.g, stretchValue(inputColor.g, minVal, maxVal), str);
      let newB = mix(inputColor.b, stretchValue(inputColor.b, minVal, maxVal), str);
      outputColor = vec4<f32>(newR, newG, newB, inputColor.a);
    } else if (chan == 1) {
      let newR = mix(inputColor.r, stretchValue(inputColor.r, minVal, maxVal), str);
      outputColor = vec4<f32>(newR, inputColor.g, inputColor.b, inputColor.a);
    } else if (chan == 2) {
      let newG = mix(inputColor.g, stretchValue(inputColor.g, minVal, maxVal), str);
      outputColor = vec4<f32>(inputColor.r, newG, inputColor.b, inputColor.a);
    } else if (chan == 3) {
      let newB = mix(inputColor.b, stretchValue(inputColor.b, minVal, maxVal), str);
      outputColor = vec4<f32>(inputColor.r, inputColor.g, newB, inputColor.a);
    } else {
      // Luminance
      let lum = getLuminance(inputColor.rgb);
      let newLum = mix(lum, stretchValue(lum, minVal, maxVal), str);

      if (lum > 0.001) {
        let scale = newLum / lum;
        outputColor = vec4<f32>(inputColor.rgb * scale, inputColor.a);
      } else {
        outputColor = vec4<f32>(newLum, newLum, newLum, inputColor.a);
      }
    }
  } else if (op == 3) {
    // Visualize - overlay histogram
    let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);
    outputColor = visualizeHistogram(uv, inputColor, histogram, numBins);
  }

  textureStore(outputTexture, vec2<u32>(texCoord), outputColor);
}`;

    return shader;
  }

  /**
   * Generate Luminance shader for luminance extraction with multiple methods
   * Supports: Rec709, Rec601, Average, Max, Min
   * Output modes: Grayscale, Preserve Color, Isoluminant
   */
  generateLuminanceShader(node, getInput) {
    const method = this.getParam(node, 'method', 'Rec709');
    const outputMode = this.getParam(node, 'outputMode', 'Grayscale');
    const threshold = this.getParam(node, 'threshold', 0.5);

    // Convert method to index: 0=Rec709, 1=Rec601, 2=Average, 3=Max, 4=Min
    const methodIndex = method === 'Rec709' ? 0 : method === 'Rec601' ? 1 : method === 'Average' ? 2 : method === 'Max' ? 3 : 4;

    // Convert outputMode to index: 0=Grayscale, 1=Preserve Color, 2=Isoluminant
    const outputModeIndex = outputMode === 'Grayscale' ? 0 : outputMode === 'Preserve Color' ? 1 : 2;

    const shader = `
// Compute Luminance Shader - Luminance extraction with multiple methods
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  method: f32,
  outputMode: f32,
  threshold: f32,
  _padding: vec2<f32>
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inputTexture: texture_2d<f32>;
@group(0) @binding(3) var texSampler: sampler;

// Calculate luminance using different methods
fn calculateLuminance(color: vec3<f32>, method: i32) -> f32 {
  if (method == 0) {
    // Rec709 (ITU-R BT.709) - HDTV standard
    // Optimized for modern displays with emphasis on green
    return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
  } else if (method == 1) {
    // Rec601 (ITU-R BT.601) - SDTV standard
    // Traditional NTSC coefficients
    return dot(color, vec3<f32>(0.299, 0.587, 0.114));
  } else if (method == 2) {
    // Average - simple arithmetic mean
    return (color.r + color.g + color.b) / 3.0;
  } else if (method == 3) {
    // Max - maximum of RGB components
    return max(max(color.r, color.g), color.b);
  } else {
    // Min - minimum of RGB components (method == 4)
    return min(min(color.r, color.g), color.b);
  }
}

// Apply isoluminant color adjustment
// Adjusts the color to match a target luminance while preserving hue and saturation
fn applyIsoluminant(color: vec3<f32>, targetLuminance: f32, currentLuminance: f32) -> vec3<f32> {
  if (currentLuminance < 0.001) {
    // If current luminance is near zero, return gray at target luminance
    return vec3<f32>(targetLuminance);
  }

  // Scale the color to match target luminance
  let scale = targetLuminance / currentLuminance;
  var result = color * scale;

  // Clamp to valid range while preserving ratios as much as possible
  let maxComponent = max(max(result.r, result.g), result.b);
  if (maxComponent > 1.0) {
    // If any component exceeds 1.0, scale down proportionally
    result = result / maxComponent;
  }

  return result;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(inputTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  // Sample input color
  let inputColor = textureLoad(inputTexture, texCoord, 0);
  var outputColor = inputColor;

  let method = i32(uniforms.method);
  let mode = i32(uniforms.outputMode);
  let thresh = uniforms.threshold;

  // Calculate luminance using selected method
  let luminance = calculateLuminance(inputColor.rgb, method);

  if (mode == 0) {
    // Grayscale - output luminance to all RGB channels
    outputColor = vec4<f32>(luminance, luminance, luminance, inputColor.a);
  } else if (mode == 1) {
    // Preserve Color - apply threshold to show color or grayscale
    // Colors above threshold retain their color, below become grayscale
    if (luminance >= thresh) {
      outputColor = inputColor;
    } else {
      outputColor = vec4<f32>(luminance, luminance, luminance, inputColor.a);
    }
  } else if (mode == 2) {
    // Isoluminant - adjust colors to match threshold luminance
    // Creates an isoluminant surface where all colors have the same luminance
    let targetLuminance = thresh;
    let adjustedColor = applyIsoluminant(inputColor.rgb, targetLuminance, luminance);
    outputColor = vec4<f32>(adjustedColor, inputColor.a);
  }

  textureStore(outputTexture, vec2<u32>(texCoord), outputColor);
}`;

    return shader;
  }

  /**
   * Convert wrap mode to index
   */
  getWrapModeIndex(mode) {
    const modes = {
      'Repeat': 0,
      'Clamp': 1,
      'Mirror': 2
    };
    return modes[mode] || 0;
  }

  /**
   * Convert warp mode to index
   */
  getWarpModeIndex(mode) {
    const modes = {
      'Displace': 0,
      'Twist': 1,
      'Bulge': 2,
      'Pinch': 3,
      'Wave': 4
    };
    return modes[mode] || 0;
  }

  /**
   * Convert glitch type to index
   */
  getGlitchTypeIndex(type) {
    const types = {
      'RGB Shift': 0,
      'Block': 1,
      'Scanline': 2,
      'Pixelate': 3,
      'Corrupt': 4
    };
    return types[type] || 0;
  }

  /**
   * Convert blend mode to index
   */
  getBlendModeIndex(mode) {
    const modes = {
      'Mix': 0,
      'Add': 1,
      'Multiply': 2,
      'Screen': 3,
      'Overlay': 4,
      'Difference': 5,
      'Exclusion': 6,
      'Lighten': 7,
      'Darken': 8
    };
    return modes[mode] || 0;
  }

  /**
   * Generate fallback shader for unsupported compute nodes
   */
  generateFallbackShader(node) {
    return `
struct Uniforms {
  resolution: vec2<f32>,
  time: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<u32>(global_id.xy);
  let texSize = vec2<u32>(u32(uniforms.resolution.x), u32(uniforms.resolution.y));

  if (texCoord.x >= texSize.x || texCoord.y >= texSize.y) {
    return;
  }

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);
  let color = vec3<f32>(uv, 0.5);
  textureStore(outputTexture, texCoord, vec4<f32>(color, 1.0));
}`;
  }

  /**
   * Get parameter value with expression support
   * Unified with FieldNodes to support the same parameter capabilities:
   * - Static values (numeric, boolean)
   * - Expressions starting with = (e.g., =time*2, =sin(time))
   * - Node references (e.g., =node_X)
   * - Shader variables (time, audioEnvelope)
   */
  getParam(node, paramName, defaultValue) {
    const rawValue = node.params?.[paramName] ?? defaultValue;

    // CRITICAL: For string enum parameters (dropdown selections like "Stripes", "Checkerboard"),
    // return the string value directly so it can be used for index lookup.
    // These should be baked into the shader as constants, not passed as uniforms.
    if (typeof rawValue === 'string') {
      const isExpression = rawValue.startsWith('=') || /time|audioEnvelope/.test(rawValue);
      const isNodeReference = /=?\s*node_\d+/.test(rawValue);
      const isNumericString = !isNaN(parseFloat(rawValue)) && isFinite(parseFloat(rawValue));

      // If it's just a plain string (not an expression, not a node ref, not a number),
      // return it directly - it's likely a dropdown enum value like "Stripes"
      if (!isExpression && !isNodeReference && !isNumericString) {
        return rawValue;
      }
    }

    // Check if this is a node reference expression (=node_X or contains node_X)
    // Node references must be evaluated on CPU and passed as uniforms, not generated as shader code
    const isNodeReference = typeof rawValue === 'string' && /=?\s*node_\d+/.test(rawValue);

    // Handle expressions with = prefix (like "=time*2" or "=audioEnvelope")
    // BUT NOT node references - those need CPU evaluation
    if (typeof rawValue === 'string' && rawValue.startsWith('=') && !isNodeReference) {
      try {
        return unifiedExpressionSystem.generateShader(rawValue, {}, this.graph);
      } catch (error) {

        // Fall through to uniform registration below
      }
    }

    // USE UNIFIED AST SYSTEM for dynamic expressions without = prefix
    // This ensures shader code matches CPU evaluation exactly
    if (typeof rawValue === 'string' && !isNodeReference && (/time|audioEnvelope/.test(rawValue))) {
      try {
        return unifiedExpressionSystem.generateShader(rawValue, {}, this.graph);
      } catch (error) {

        // Fall through to uniform registration below
      }
    }

    // Register as uniform for:
    // - Node references (must be CPU-evaluated)
    // - Failed shader generation
    // - Numeric parameters that need dynamic updates
    if (this.uniformManager) {
      let value = rawValue;

      // For node references or failed expressions, store the expression itself
      // It will be evaluated on the CPU side in ComputeShaderManager.updateUniforms()
      if (typeof value === 'string') {
        // If it's a node reference or expression that failed shader generation,
        // just use the default for now - the actual value will be computed at runtime
        const parsed = parseFloat(value);
        value = isNaN(parsed) ? (typeof defaultValue === 'number' ? defaultValue : 0.0) : parsed;
      }

      // CRITICAL: Handle boolean parameters before converting to number
      // Booleans should be converted to 1.0 (true) or 0.0 (false)
      if (typeof value === 'boolean') {
        value = value ? 1.0 : 0.0;
      } else if (typeof value !== 'number') {
        // For other non-number types, try to use the default value
        // If default is boolean, convert it; if it's a number, use it; otherwise use 0.0
        if (typeof defaultValue === 'boolean') {
          value = defaultValue ? 1.0 : 0.0;
        } else if (typeof defaultValue === 'number') {
          value = defaultValue;
        } else {
          value = 0.0;
        }
      }

      // Ensure finite value
      if (!isFinite(value)) {
        value = 0.0;
      }

      // Register with uniform manager
      const paramKey = `${node.id}.${paramName}`;
      this.uniformManager.uniformValues.set(paramKey, value);

      // Generate uniform reference
      const sanitizedKey = paramKey.replace(/[^a-zA-Z0-9_]/g, '_');
      const fieldName = sanitizedKey.startsWith('_') ? sanitizedKey : `_${sanitizedKey}`;
      return `u_params.${fieldName}`;
    }

    // Fallback: For static params without uniform manager
    const result = this.paramHandler.toShaderCode(node.kind, paramName, rawValue, null);

    if (typeof result === 'number') {
      return result === Math.floor(result) ? `${result}.0` : result.toString();
    }

    return result;
  }

  /**
   * @deprecated Use getParam instead - kept for backwards compatibility
   */
  getParamValue(node, paramName, defaultValue) {
    return this.getParam(node, paramName, defaultValue);
  }

  /**
   * Get reaction-diffusion pattern presets
   * These are well-known Gray-Scott parameter combinations
   */
  getReactionDiffusionPresets() {
    return {
      'Coral': {
        feedRate: 0.0545,
        killRate: 0.062,
        description: 'Coral-like branching patterns'
      },
      'Spots': {
        feedRate: 0.039,
        killRate: 0.058,
        description: 'Stable spots that don\'t grow'
      },
      'Stripes': {
        feedRate: 0.035,
        killRate: 0.065,
        description: 'Stripe patterns and labyrinths'
      },
      'Waves': {
        feedRate: 0.014,
        killRate: 0.054,
        description: 'Moving wave patterns'
      },
      'Mitosis': {
        feedRate: 0.0367,
        killRate: 0.0649,
        description: 'Dividing spot patterns'
      },
      'Worms': {
        feedRate: 0.078,
        killRate: 0.061,
        description: 'Worm-like moving patterns'
      },
      'Spirals': {
        feedRate: 0.018,
        killRate: 0.051,
        description: 'Spiral wave patterns'
      }
    };
  }

  /**
   * Clean up compute resources for a node
   */
  cleanup(nodeId) {
    if (this.computeManagers.has(nodeId)) {
      const manager = this.computeManagers.get(nodeId);
      manager.destroy();
      this.computeManagers.delete(nodeId);
    }

    if (this.computeTextureRegistry.has(nodeId)) {
      this.computeTextureRegistry.delete(nodeId);
    }
  }
}
