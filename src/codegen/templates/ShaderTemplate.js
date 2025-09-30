// src/codegen/templates/ShaderTemplate.js
export class ShaderTemplate {
  /**
   * Get the default shader when no valid graph is provided
   * @returns {string} Default WGSL shader
   */
  getDefaultShader() {
    return `
struct Globals { time: f32, }
@group(0) @binding(0) var<uniform> u : Globals;
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
   * @returns {string} Complete WGSL shader
   */
  buildShader({ lines, textureBindings }) {
    return `
struct Globals {
  time: f32,
}

@group(0) @binding(0) var<uniform> u : Globals;${textureBindings}

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>
}

${this.getVertexShader()}

${this.getUtilityFunctions()}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var finalColor: vec3<f32> = vec3<f32>(0.0);
  ${lines.join("\n  ")}
  let _keep_uniform = u.time * 0.0;
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
   * @returns {string}
   */
  getUtilityFunctions() {
    return `fn random(st: vec2<f32>) -> f32 {
  return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}
fn rectField(uv: vec2<f32>, center: vec2<f32>, size: vec2<f32>, epsilon: f32) -> f32 {
  let d = abs(uv - center) - size * 0.5;
  let dist = length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-epsilon, epsilon, dist);
}

fn valueNoise(st: vec2<f32>) -> f32 {
  let i = floor(st);
  let f = fract(st);
  let a = random(i);
  let b = random(i + vec2<f32>(1.0, 0.0));
  let c = random(i + vec2<f32>(0.0, 1.0));
  let d = random(i + vec2<f32>(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

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

fn simplexNoise(st: vec2<f32>) -> f32 {
  let K1 = 0.366025404;
  let K2 = 0.211324865;
  let i = floor(st + (st.x + st.y) * K1);
  let a = st - i + (i.x + i.y) * K2;
  let o = vec2<f32>(step(a.y, a.x), 1.0 - step(a.y, a.x));
  let b = a - o + K2;
  let c = a - 1.0 + 2.0 * K2;
  let h = max(0.5 - vec3<f32>(dot(a, a), dot(b, b), dot(c, c)), vec3<f32>(0.0));
  let n = h * h * h * h * vec3<f32>(
    dot(a, vec2<f32>(random(i) - 0.5, random(i + vec2<f32>(1.0, 0.0)) - 0.5)),
    dot(b, vec2<f32>(random(i + o) - 0.5, random(i + o + vec2<f32>(1.0, 0.0)) - 0.5)),
    dot(c, vec2<f32>(random(i + vec2<f32>(1.0)) - 0.5, random(i + vec2<f32>(2.0, 1.0)) - 0.5))
  );
  return dot(n, vec3<f32>(70.0));
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

fn ridgedNoise(st: vec2<f32>, octaves: i32, lacunarity: f32, gain: f32, offset: f32, threshold: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var prev = 1.0;
  
  for (var i = 0; i < octaves; i++) {
    var n = valueNoise(st * frequency);
    n = abs(n);
    n = offset - n;
    n = n * n;
    n = n * prev;
    prev = n;
    value += n * amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  
  return max(value - threshold, 0.0);
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
}`;
  }
}
export function generateShader(compiledData, textureBindings) {
  const { lines, uniformStruct } = compiledData;
  
  // Determine binding numbers based on what's present
  const hasTextures = textureBindings && textureBindings.trim().length > 0;
  
  // Adjust parameter uniform binding based on texture presence
  let adjustedUniformStruct = uniformStruct || '';
  if (adjustedUniformStruct) {
    const correctBinding = hasTextures ? 3 : 2;
    // Replace binding placeholder if it exists, otherwise add it
    if (adjustedUniformStruct.includes('@binding(')) {
      adjustedUniformStruct = adjustedUniformStruct.replace(/@binding\(\d+\)/, `@binding(${correctBinding})`);
    } else {
      // Insert binding before var<uniform>
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

@group(0) @binding(0) var<uniform> u : Globals;

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

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var finalColor = vec3<f32>(0.0);
  
${lines.join('\n')}
  
  let _keep_uniform = u.time * 0.0;
  return vec4<f32>(finalColor + vec3<f32>(_keep_uniform), 1.0);
}
`;
}

function generateHelperFunctions() {
  return `fn random(st: vec2<f32>) -> f32 {
  return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn hash12(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, vec3<f32>(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn valueNoise(st: vec2<f32>) -> f32 {
  let i = floor(st);
  let f = fract(st);
  let a = random(i);
  let b = random(i + vec2<f32>(1.0, 0.0));
  let c = random(i + vec2<f32>(0.0, 1.0));
  let d = random(i + vec2<f32>(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}`;
}