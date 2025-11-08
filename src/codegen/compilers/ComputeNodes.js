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
      'ComputeCellular'
    ].includes(kind);
  }

  /**
   * Compile a compute shader node
   * Compute nodes don't generate inline WGSL code - they execute on GPU and return texture references
   */
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");

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

    // Store compute node info for later execution
    if (!window.computeNodeRegistry) {
      window.computeNodeRegistry = new Map();
    }

    window.computeNodeRegistry.set(nodeId, {
      node,
      getInput,
      resolution,
      wgslCode: this.generateComputeWGSL(node, getInput),
      lastInputHash: null // For tracking when inputs change
    });

    console.log(`[ComputeNodes] Registered compute node: ${node.kind} (${nodeId})`);
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
      default:
        console.warn(`[ComputeNodes] No shader generator for ${node.kind}`);
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
    const colorize = node.params?.colorize ?? true;

    return `
// Compute Noise Shader
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  scale: f32,
  octaves: i32,
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

  let noiseValue = fbm(noisePos, uniforms.octaves);

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
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var outputTexture: texture_storage_2d<rgba8unorm, write>;

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
  rotation: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var feedbackTexture: texture_2d<f32>;
@group(0) @binding(3) var outputTexture: texture_storage_2d<rgba8unorm, write>;

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
    return `
// Reaction-Diffusion (Gray-Scott Model)
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
@group(0) @binding(1) var stateTexture: texture_2d<f32>;
@group(0) @binding(2) var outputTexture: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let texSize = textureDimensions(stateTexture);

  if (texCoord.x >= i32(texSize.x) || texCoord.y >= i32(texSize.y)) {
    return;
  }

  let current = textureLoad(stateTexture, texCoord, 0);
  let a = current.r;
  let b = current.g;

  // Laplacian for diffusion
  var laplaceA = 0.0;
  var laplaceB = 0.0;

  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let samplePos = texCoord + vec2<i32>(dx, dy);
      if (samplePos.x >= 0 && samplePos.x < i32(texSize.x) &&
          samplePos.y >= 0 && samplePos.y < i32(texSize.y)) {
        let sample = textureLoad(stateTexture, samplePos, 0);
        let weight = select(0.2, 0.05, dx == 0 || dy == 0);
        laplaceA += (sample.r - a) * weight;
        laplaceB += (sample.g - b) * weight;
      }
    }
  }

  // Gray-Scott equations
  let f = uniforms.feedRate;
  let k = uniforms.killRate;
  let dt = uniforms.timestep;

  let reaction = a * b * b;
  let newA = a + (uniforms.diffusionA * laplaceA - reaction + f * (1.0 - a)) * dt;
  let newB = b + (uniforms.diffusionB * laplaceB + reaction - (k + f) * b) * dt;

  let color = vec3<f32>(newB, newA, newB * 0.5);
  textureStore(outputTexture, vec2<u32>(texCoord), vec4<f32>(color, 1.0));
}`;
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
@group(0) @binding(1) var stateTexture: texture_2d<f32>;
@group(0) @binding(2) var outputTexture: texture_storage_2d<rgba8unorm, write>;

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
   * Get parameter value with uniform support
   */
  getParam(node, paramName, defaultValue) {
    if (!node.params || !(paramName in node.params)) {
      return defaultValue;
    }

    const value = node.params[paramName];

    // Check if this is an expression/uniform reference
    if (this.uniformManager && this.paramHandler) {
      const result = this.paramHandler.getParamValue(node, paramName, defaultValue);
      if (typeof result === 'string' && result.includes('u_params.')) {
        return result; // Return uniform reference
      }
      return result;
    }

    return value !== undefined ? value : defaultValue;
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
