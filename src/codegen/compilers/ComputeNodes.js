// src/codegen/compilers/ComputeNodes.js
// Compiler for compute shader nodes that generate GPU textures

import { UnifiedParameterHandler } from '../../parameters/UnifiedParameterHandler.js';

export class ComputeNodes {
  constructor() {
    this.uniformManager = null;
    this.paramHandler = new UnifiedParameterHandler();
    this.computeTextureRegistry = new Map(); // Maps nodeId -> { texture, manager, lastUpdate }
    this.computeManagers = new Map(); // Maps nodeId -> ComputeShaderManager instance
  }

  setUniformManager(manager) {
    this.uniformManager = manager;
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
      'ComputeThreshold'
    ].includes(kind);
  }

  /**
   * Compile a compute shader node
   * Compute nodes don't generate inline WGSL code - they execute on GPU and return texture references
   */
  compile(node, getInput, getParam) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");

    console.log('[ComputeNodes] Compiling node:', node.kind, nodeId);

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
    const textureId = `compute_${nodeId}`;

    // Sample the compute output texture
    const line = `let uv_${nodeId} = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
    let node_${nodeId}_rgba = textureSample(${textureId}, sampler_${textureId}, uv_${nodeId});
    let node_${nodeId} = node_${nodeId}_rgba;`;

    // Define output pins for accessing different channels
    const outputPins = [
      { expression: `node_${nodeId}_rgba`, type: "vec4" },     // RGBA
      { expression: `node_${nodeId}_rgba.xyz`, type: "vec3" }, // RGB
      { expression: `vec3<f32>(node_${nodeId}_rgba.r, 0.0, 0.0)`, type: "vec3" }, // R
      { expression: `vec3<f32>(0.0, node_${nodeId}_rgba.g, 0.0)`, type: "vec3" }, // G
      { expression: `vec3<f32>(0.0, 0.0, node_${nodeId}_rgba.b)`, type: "vec3" }, // B
      { expression: `vec3<f32>(node_${nodeId}_rgba.a)`, type: "vec3" }, // A
    ];

    return { line, outputType: "vec4", outputPins, isComputeNode: true };
  }

  /**
   * Get resolution for compute shader output texture
   */
  getResolution(node) {
    const resParam = node.params?.resolution;
    if (resParam) {
      const size = parseInt(resParam);
      return [size, size];
    }
    return [512, 512]; // Default
  }

  /**
   * Register a compute node for GPU execution
   */
  registerComputeNode(node, getInput, resolution) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");

    // Determine if this node needs feedback (previous frame texture)
    const feedbackNodes = ['ComputeReactionDiffusion', 'ComputeCellular', 'ComputeFeedback', 'ComputeFeedbackField'];
    const supportsFeedback = feedbackNodes.includes(node.kind);

    // Store compute node info for later execution
    if (!window.computeNodeRegistry) {
      window.computeNodeRegistry = new Map();
    }

    window.computeNodeRegistry.set(nodeId, {
      node,
      getInput,
      resolution,
      wgslCode: this.generateComputeWGSL(node, getInput),
      supportsFeedback,
      lastInputHash: null // For tracking when inputs change
    });

    console.log(`[ComputeNodes] Registered compute node: ${node.kind} (${nodeId}), feedback: ${supportsFeedback}`);
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
      default:
        console.warn(`[ComputeNodes] No shader generator for ${node.kind}`);
        return this.generateFallbackShader(node);
    }
  }

  /**
   * Generate compute noise shader
   */
  generateNoiseShader(node, getInput) {
    const scale = this.getParamValue(node, 'scale', 8.0);
    const octaves = this.getParamValue(node, 'octaves', 5);
    const speed = this.getParamValue(node, 'speed', 0.1);
    const colorize = this.getParamValue(node, 'colorize', true);

    const shader = `
// Compute Noise Shader
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  scale: f32,
  octaves: f32,
  speed: f32,
  padding: vec2<f32>
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

  var noisePos = uv * uniforms.scale;
  noisePos += vec2<f32>(time * 0.1, time * 0.15);

  let noiseValue = fbm(noisePos, i32(uniforms.octaves));

  ${colorize ? `
  // Colorize the noise
  let hue = noiseValue + time * 0.1;
  let h = fract(hue);
  let s = 0.7;
  let v = 0.8 + noiseValue * 0.2;

  let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3<f32>(h) + k.xyz) * 6.0 - k.www);
  let rgb = v * mix(vec3<f32>(1.0), clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), s);

  textureStore(outputTexture, texCoord, vec4<f32>(rgb, 1.0));
  ` : `
  // Grayscale noise
  textureStore(outputTexture, texCoord, vec4<f32>(noiseValue, noiseValue, noiseValue, 1.0));
  `}
}`;

    console.log('[ComputeNodes] Generated noise shader:\n', shader);
    return shader;
  }

  /**
   * Generate compute blur shader
   */
  generateBlurShader(node, getInput) {
    const radius = this.getParamValue(node, 'radius', 5.0);

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
    const kernel = this.getParamValue(node, 'kernel', 'Sharpen');
    const strength = this.getParamValue(node, 'strength', 1.0);

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
    const mode = this.getParamValue(node, 'mode', 'Binary');
    const threshold = this.getParamValue(node, 'threshold', 0.5);
    const thresholdMin = this.getParamValue(node, 'thresholdMin', 0.3);
    const thresholdMax = this.getParamValue(node, 'thresholdMax', 0.7);
    const outputLow = this.getParamValue(node, 'outputLow', 0.0);
    const outputHigh = this.getParamValue(node, 'outputHigh', 1.0);

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

  // DEBUG: For testing - output a visible pattern to confirm shader is running
  // Comment this out and uncomment the final textureStore when debugging is done
  // let debugColor = vec4<f32>(vec2<f32>(texCoord) / vec2<f32>(texSize), 0.5, 1.0);
  // textureStore(outputTexture, vec2<u32>(texCoord), debugColor);

  textureStore(outputTexture, vec2<u32>(texCoord), color);
}`;

    console.log(`[ComputeNodes] Generated threshold shader with mode: ${mode}, modeIndex: ${modeIndex}`);
    console.log(`[ComputeNodes] Threshold params from shader gen: threshold=${threshold}, outputLow=${outputLow}, outputHigh=${outputHigh}`);
    return shader;
  }

  /**
   * Generate feedback shader
   */
  generateFeedbackShader(node, getInput) {
    const decay = this.getParamValue(node, 'decay', 0.95);
    const scale = this.getParamValue(node, 'scale', 1.01);

    return `
// Compute Feedback Shader
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  decay: f32,
  scale: f32,
  rotation: f32
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

  // Sample input and feedback
  let input = textureLoad(inputTexture, texCoord, 0);

  var feedback = vec4<f32>(0.0);
  if (feedbackUV.x >= 0.0 && feedbackUV.x <= 1.0 && feedbackUV.y >= 0.0 && feedbackUV.y <= 1.0) {
    let fbCoord = vec2<i32>(feedbackUV * vec2<f32>(texSize));
    feedback = textureLoad(feedbackTexture, fbCoord, 0);
  }

  let result = input + feedback * uniforms.decay;
  textureStore(outputTexture, vec2<u32>(texCoord), result);
}`;
  }

  /**
   * Generate reaction-diffusion shader
   */
  generateReactionDiffusionShader(node, getInput) {
    // Get pattern preset and apply preset parameters
    const pattern = this.getParamValue(node, 'pattern', 'Coral');
    const presets = this.getReactionDiffusionPresets();
    const preset = presets[pattern] || presets['Coral'];

    // Allow user to override preset values with manual parameters
    const feedRate = this.getParamValue(node, 'feedRate', preset.feedRate);
    const killRate = this.getParamValue(node, 'killRate', preset.killRate);
    const diffusionA = this.getParamValue(node, 'diffusionA', 1.0);
    const diffusionB = this.getParamValue(node, 'diffusionB', 0.5);
    const timestep = this.getParamValue(node, 'timestep', 1.0);

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

    console.log('[ComputeNodes] Generated improved reaction-diffusion shader');
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
    const mode = this.getParamValue(node, 'mode', 'Flow');
    const decay = this.getParamValue(node, 'decay', 0.98);
    const diffusion = this.getParamValue(node, 'diffusion', 0.1);
    const feedback = this.getParamValue(node, 'feedback', 0.5);
    const speed = this.getParamValue(node, 'speed', 1.0);

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

// Custom mode: user-defined behavior
fn customMode(coord: vec2<i32>, size: vec2<i32>, input: vec4<f32>) -> vec4<f32> {
  let prev = sampleWrap(prevFrame, coord, size);
  let diff = computeDiffusion(coord, size);

  // Custom: mix of all behaviors
  var result = prev * uniforms.decay;
  result += diff * uniforms.diffusion * 0.1;
  result += input * uniforms.feedback * 0.2;

  // Add some interesting non-linear behavior
  result = result + result * result * 0.1 * uniforms.speed;

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

  // Select mode (0=Flow, 1=Reaction-Diffusion, 2=Accumulate, 3=Custom)
  var result: vec4<f32>;

  // Mode selection based on parameter
  let modeType = ${this.getModeIndex(mode)};

  if (modeType == 0) {
    result = flowMode(texCoord, texSize, input);
  } else if (modeType == 1) {
    result = reactionDiffusionMode(texCoord, texSize, input);
  } else if (modeType == 2) {
    result = accumulateMode(texCoord, texSize, input);
  } else {
    result = customMode(texCoord, texSize, input);
  }

  textureStore(outputTexture, vec2<u32>(texCoord), result);
}`;
  }

  /**
   * Convert mode string to index
   */
  getModeIndex(mode) {
    const modes = {
      'Flow': 0,
      'Reaction-Diffusion': 1,
      'Accumulate': 2,
      'Custom': 3
    };
    return modes[mode] || 0;
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
   * Get parameter value - simple implementation
   */
  getParamValue(node, paramName, defaultValue) {
    if (!node.params || !(paramName in node.params)) {
      return defaultValue;
    }

    const value = node.params[paramName];
    return value !== undefined ? value : defaultValue;
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
