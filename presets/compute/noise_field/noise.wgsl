// Animated Noise Field Compute Shader
// Generates multi-octave procedural noise using FBM (Fractal Brownian Motion)
// Compatible with Rhizomium ComputeNoise node

struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  scale: f32,
  octaves: f32,
  speed: f32,
  colorize: f32,  // 0.0 = grayscale, 1.0 = colorized
  pad0: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

// Hash function for pseudo-random number generation
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 2D Perlin-style noise function
fn noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);

  // Cubic Hermite interpolation for smooth noise
  let u = f * f * (3.0 - 2.0 * f);

  // Sample four corners of the cell
  let a = hash(i + vec2<f32>(0.0, 0.0));
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));

  // Bilinear interpolation
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian Motion - layered noise for natural-looking patterns
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

// Convert HSV to RGB for colorized output
fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3<f32>(h) + k.xyz) * 6.0 - k.www);
  return v * mix(vec3<f32>(1.0), clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), s);
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

  // Apply scale and animation
  let time = uniforms.time * uniforms.speed;
  var noisePos = uv * uniforms.scale;
  noisePos += vec2<f32>(time * 0.1, time * 0.15);

  // Generate multi-octave noise
  let octaves = i32(uniforms.octaves);
  var noiseValue = fbm(noisePos, octaves);

  // Add swirling motion for more organic feel
  let swirl = vec2<f32>(
    sin(uv.y * 6.28318 + time * 0.5),
    cos(uv.x * 6.28318 + time * 0.5)
  ) * 0.3;
  let swirlNoise = fbm(noisePos + swirl, octaves);

  // Combine noise patterns
  noiseValue = mix(noiseValue, swirlNoise, 0.5);

  // Generate output color
  var color: vec3<f32>;

  if (uniforms.colorize > 0.5) {
    // Colorized mode: map noise to rainbow spectrum
    let hue = fract(noiseValue + time * 0.1);
    let saturation = 0.7;
    let brightness = 0.8 + noiseValue * 0.2;
    color = hsv2rgb(hue, saturation, brightness);
  } else {
    // Grayscale mode: useful for displacement or masks
    color = vec3<f32>(noiseValue);
  }

  // Write to output texture
  textureStore(outputTexture, texCoord, vec4<f32>(color, 1.0));
}
