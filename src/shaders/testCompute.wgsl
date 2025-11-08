// Test Compute Shader - Animated Noise Pattern
// Generates a procedural noise texture using compute shader

struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  padding: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

// Hash function for pseudo-random number generation
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 2D noise function
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);

  // Cubic Hermite interpolation
  let u = f * f * (3.0 - 2.0 * f);

  // Four corners of cell
  let a = hash(i + vec2<f32>(0.0, 0.0));
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));

  // Bilinear interpolation
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian Motion (FBM) - layered noise
fn fbm(p: vec2<f32>) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;

  for (var i = 0; i < 5; i++) {
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

  // Bounds check
  if (texCoord.x >= texSize.x || texCoord.y >= texSize.y) {
    return;
  }

  // Normalize coordinates to [0, 1]
  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);

  // Create animated noise
  let time = uniforms.time;

  // Scale UV for noise frequency
  let scale = 8.0;
  var noisePos = uv * scale;

  // Animate noise over time
  noisePos += vec2<f32>(time * 0.1, time * 0.15);

  // Generate multi-octave noise
  var noiseValue = fbm(noisePos);

  // Add swirling motion
  let swirl = vec2<f32>(
    sin(uv.y * 3.14159 * 2.0 + time),
    cos(uv.x * 3.14159 * 2.0 + time)
  ) * 0.5;

  let swirlNoise = fbm(noisePos + swirl);

  // Combine noise patterns
  noiseValue = mix(noiseValue, swirlNoise, 0.5);

  // Create color gradient based on noise
  let hue = noiseValue + time * 0.1;

  // HSV to RGB conversion for colorful output
  let h = fract(hue);
  let s = 0.7;
  let v = 0.8 + noiseValue * 0.2;

  let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3<f32>(h) + k.xyz) * 6.0 - k.www);
  let rgb = v * mix(vec3<f32>(1.0), clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), s);

  // Add some variation in alpha for testing
  let alpha = 1.0;

  // Write to output texture
  textureStore(outputTexture, texCoord, vec4<f32>(rgb, alpha));
}
