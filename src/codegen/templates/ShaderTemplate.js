// src/codegen/templates/ShaderTemplate.js
// UPDATED: Integrates function definitions before fs_main

import { OPTIMIZED_NOISE_FUNCTIONS_WGSL } from '../compilers/NoiseNodes.js';

export class ShaderTemplate {
  /**
   * Get the default shader when no valid graph is provided
   * @returns {string} Default WGSL shader
   */
  getDefaultShader() {
    return `
struct Globals { time: f32, }
@group(0) @binding(0) var<uniform> u : Globals;
@group(0) @binding(1) var<uniform> res : Resolution;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2<f32>, 6>(
    vec2<f32>(-1.0,-1.0), vec2<f32>( 1.0,-1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>( 1.0,-1.0), vec2<f32>( 1.0, 1.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(p[vid], 0.0, 1.0);
  out.uv = 0.5 * (p[vid] + vec2<f32>(1.0,1.0));
  return out;
}
fn random(st: vec2<f32>) -> f32 {
  return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}`;
  }
  
  /**
   * Build the complete shader from components
   * @param {Object} options 
   * @param {Array} options.lines - Compiled node lines
   * @param {string} options.textureBindings - Texture binding declarations
   * @param {string} options.shapeFunctions - Shape function definitions (NEW)
   * @param {string} options.transformHelpers - Transform helper functions (NEW)
   * @returns {string} Complete WGSL shader
   */
  buildShader({ lines, textureBindings, shapeFunctions = '', transformHelpers = '' }) {
    return `
struct Globals {
  time: f32,
}
struct Resolution {
  width: f32,
  height: f32,
  aspect: f32,
}

@group(0) @binding(0) var<uniform> u : Globals;
@group(0) @binding(1) var<uniform> res : Resolution;
struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>
}

${this.getVertexShader()}

${this.getUtilityFunctions()}

// ============================================================================
// TRANSFORM HELPER FUNCTIONS
// ============================================================================

${transformHelpers}

// ============================================================================
// SHAPE FUNCTIONS
// ============================================================================

${shapeFunctions}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var finalColor: vec3<f32> = vec3<f32>(0.0);
  ${lines.join("\n  ")}
  let _keep_uniform = u.time * 0.0 + res.width * 0.0;
  return vec4<f32>(finalColor + vec3<f32>(_keep_uniform), 1.0);
}
`;
  }
  
  /**
   * Get the vertex shader code
   * @returns {string}
   */
  getVertexShader() {
    return `@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), 
    vec2<f32>( 3.0, -1.0), 
    vec2<f32>(-1.0,  3.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(p[vid], 0.0, 1.0);
  out.uv = 0.5 * (p[vid] + vec2<f32>(1.0, 1.0));
  return out;
}`;
  }
  
  /**
   * Get utility functions for noise and math operations
   * INCLUDES: Basic utilities + Legacy noise + Optimized noise functions
   * @returns {string}
   */
  getUtilityFunctions() {
    return `
// ============================================================================
// BASIC UTILITY FUNCTIONS
// ============================================================================

fn random(st: vec2<f32>) -> f32 {
  return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn rectField(uv: vec2<f32>, center: vec2<f32>, size: vec2<f32>, epsilon: f32) -> f32 {
  let d = abs(uv - center) - size * 0.5;
  let dist = length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-epsilon, epsilon, dist);
}

// ============================================================================
// OPTIMIZED NOISE FUNCTIONS (from NoiseNodes.js)
// ============================================================================

${OPTIMIZED_NOISE_FUNCTIONS_WGSL}

// ============================================================================
// LEGACY/ADDITIONAL NOISE FUNCTIONS (kept for compatibility)
// ============================================================================

fn fbm(st: vec2<f32>, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var maxValue = 0.0;
  for (var i = 0; i < octaves; i++) {
    value += valueNoise(st * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
}

fn voronoi(st: vec2<f32>, randomness: f32) -> vec2<f32> {
  let n = floor(st);
  let f = fract(st);
  var minDist = 1.0;
  var minPoint = vec2<f32>(0.0);
  
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let neighbor = vec2<f32>(f32(i), f32(j));
      let point = vec2<f32>(random(n + neighbor), random(n + neighbor + vec2<f32>(0.1))) * randomness;
      let diff = neighbor + point - f;
      let dist = length(diff);
      
      if (dist < minDist) {
        minDist = dist;
        minPoint = point;
      }
    }
  }
  
  return vec2<f32>(minDist, minPoint.x);
}

fn warpedNoise(st: vec2<f32>, scale: f32, warpScale: f32, warpStrength: f32, octaves: i32) -> f32 {
  let warp1 = vec2<f32>(
    valueNoise(st * warpScale),
    valueNoise(st * warpScale + vec2<f32>(5.2, 1.3))
  );
  
  let warp2 = vec2<f32>(
    valueNoise(st * warpScale + 4.0 * warp1 + vec2<f32>(1.7, 9.2)),
    valueNoise(st * warpScale + 4.0 * warp1 + vec2<f32>(8.3, 2.8))
  );
  
  let warpedPos = st + warpStrength * warp2;
  return fbm(warpedPos * scale, octaves, 0.5, 2.0);
}
`;
  }
}

/**
 * NEW: Generate shader with function-based compilation support
 */
export function generateShader(compiledData, textureBindings) {
  const { lines, uniformStruct, shapeFunctions = '', transformHelpers = '' } = compiledData;
  
  // Determine binding numbers based on what's present
  const hasTextures = textureBindings && textureBindings.trim().length > 0;
  
  // Adjust parameter uniform binding based on texture presence
  let adjustedUniformStruct = uniformStruct || '';
  if (adjustedUniformStruct) {
    const correctBinding = hasTextures ? 4 : 2;
        if (adjustedUniformStruct.includes('@binding(')) {
      adjustedUniformStruct = adjustedUniformStruct.replace(/@binding\(\d+\)/, `@binding(${correctBinding})`);
    } else {
      adjustedUniformStruct = adjustedUniformStruct.replace(
        'var<uniform> params:',
        `@binding(${correctBinding}) var<uniform> params:`
      );
    }
  }

  return `
struct Globals {
  time: f32,
}
struct Resolution {
  width: f32,
  height: f32,
  aspect: f32,
}

@group(0) @binding(0) var<uniform> u : Globals;
@group(0) @binding(1) var<uniform> res : Resolution;
${textureBindings || ''}

${adjustedUniformStruct}

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), 
    vec2<f32>( 3.0, -1.0), 
    vec2<f32>(-1.0,  3.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(p[vid], 0.0, 1.0);
  out.uv = 0.5 * (p[vid] + vec2<f32>(1.0, 1.0));
  return out;
}

${generateHelperFunctions()}

// ============================================================================
// TRANSFORM HELPER FUNCTIONS
// ============================================================================

${transformHelpers}

// ============================================================================
// SHAPE FUNCTIONS
// ============================================================================

${shapeFunctions}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var finalColor = vec3<f32>(0.0);
  
${lines.join('\n')}
  
  let _keep_uniform = u.time * 0.0 + res.width * 0.0;
  return vec4<f32>(finalColor + vec3<f32>(_keep_uniform), 1.0);
}
`;
}

function generateHelperFunctions() {
  return `
${OPTIMIZED_NOISE_FUNCTIONS_WGSL}

fn random(st: vec2<f32>) -> f32 {
  return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}
`;
}