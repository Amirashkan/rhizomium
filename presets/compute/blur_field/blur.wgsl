// Gaussian Blur Compute Shader
// High-quality blur with configurable radius, quality, and direction
// Compatible with Rhizomium ComputeBlur node

struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  radius: f32,
  quality: f32,      // 0 = Low (9 samples), 1 = Medium (17), 2 = High (25)
  direction: f32,    // 0 = Both, 1 = Horizontal, 2 = Vertical
  pad0: f32,
  pad1: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var texSampler: sampler;
@group(0) @binding(3) var outputTexture: texture_storage_2d<rgba8unorm, write>;

// Gaussian weight function
// sigma = radius / 2.0 for good visual results
fn gaussian(x: f32, sigma: f32) -> f32 {
  let twoSigmaSq = 2.0 * sigma * sigma;
  return exp(-(x * x) / twoSigmaSq) / sqrt(6.28318 * twoSigmaSq);
}

// Calculate total number of samples based on quality
fn getSampleCount() -> i32 {
  let q = i32(uniforms.quality);
  if (q == 0) { return 9; }       // Low: 9 samples
  else if (q == 1) { return 17; } // Medium: 17 samples
  else { return 25; }             // High: 25 samples
}

// 1D blur along a specific direction
fn blur1D(uv: vec2<f32>, direction: vec2<f32>, radius: f32, samples: i32) -> vec4<f32> {
  var color = vec4<f32>(0.0);
  var totalWeight = 0.0;

  let sigma = radius / 2.0;
  let pixelSize = 1.0 / uniforms.resolution;
  let step = direction * pixelSize;

  // Calculate sample positions and weights
  let halfSamples = samples / 2;

  for (var i = -halfSamples; i <= halfSamples; i++) {
    let offset = f32(i) * step;
    let samplePos = uv + offset * radius;

    // Calculate Gaussian weight
    let weight = gaussian(f32(i), sigma);

    // Sample texture
    let sample = textureSample(inputTexture, texSampler, samplePos);

    color += sample * weight;
    totalWeight += weight;
  }

  // Normalize by total weight
  return color / totalWeight;
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

  // Get blur parameters
  let radius = uniforms.radius;
  let samples = getSampleCount();
  let dir = i32(uniforms.direction);

  var result: vec4<f32>;

  if (dir == 0) {
    // Both directions: blur horizontally then vertically
    // For single-pass, we approximate by averaging H and V
    let horizontal = blur1D(uv, vec2<f32>(1.0, 0.0), radius, samples);
    let vertical = blur1D(uv, vec2<f32>(0.0, 1.0), radius, samples);
    result = (horizontal + vertical) * 0.5;
  } else if (dir == 1) {
    // Horizontal only
    result = blur1D(uv, vec2<f32>(1.0, 0.0), radius, samples);
  } else {
    // Vertical only
    result = blur1D(uv, vec2<f32>(0.0, 1.0), radius, samples);
  }

  // Write to output texture
  textureStore(outputTexture, texCoord, result);
}
