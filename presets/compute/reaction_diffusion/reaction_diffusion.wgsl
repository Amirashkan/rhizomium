// Gray-Scott Reaction-Diffusion Compute Shader
// Simulates two-chemical reaction-diffusion system
// Creates organic patterns: coral, spots, stripes, waves, etc.
// Compatible with Rhizomium ComputeReactionDiffusion node

struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  feedRate: f32,      // Feed rate (F) - typically 0.01 - 0.08
  killRate: f32,      // Kill rate (k) - typically 0.04 - 0.07
  diffusionA: f32,    // Diffusion rate for chemical A
  diffusionB: f32,    // Diffusion rate for chemical B
  timestep: f32       // Simulation speed multiplier
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var stateTexture: texture_2d<f32>;      // Previous state (feedback)
@group(0) @binding(3) var texSampler: sampler;

// Hash function for initialization
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Laplacian operator for diffusion calculation
// Uses 3x3 kernel: center weight = -1, neighbors = 0.2, diagonals = 0.05
fn laplacian(uv: vec2<f32>, channel: i32) -> f32 {
  let pixelSize = 1.0 / uniforms.resolution;

  // Sample center
  var center = textureSample(stateTexture, texSampler, uv);
  var c = 0.0;
  if (channel == 0) { c = center.r; }
  else { c = center.g; }

  // Sample neighbors (cross pattern)
  let n = textureSample(stateTexture, texSampler, uv + vec2<f32>(0.0, pixelSize.y));
  let s = textureSample(stateTexture, texSampler, uv + vec2<f32>(0.0, -pixelSize.y));
  let e = textureSample(stateTexture, texSampler, uv + vec2<f32>(pixelSize.x, 0.0));
  let w = textureSample(stateTexture, texSampler, uv + vec2<f32>(-pixelSize.x, 0.0));

  // Sample diagonals
  let ne = textureSample(stateTexture, texSampler, uv + vec2<f32>(pixelSize.x, pixelSize.y));
  let nw = textureSample(stateTexture, texSampler, uv + vec2<f32>(-pixelSize.x, pixelSize.y));
  let se = textureSample(stateTexture, texSampler, uv + vec2<f32>(pixelSize.x, -pixelSize.y));
  let sw = textureSample(stateTexture, texSampler, uv + vec2<f32>(-pixelSize.x, -pixelSize.y));

  var sum = 0.0;
  if (channel == 0) {
    sum = (n.r + s.r + e.r + w.r) * 0.2 + (ne.r + nw.r + se.r + sw.r) * 0.05;
  } else {
    sum = (n.g + s.g + e.g + w.g) * 0.2 + (ne.g + nw.g + se.g + sw.g) * 0.05;
  }

  return sum - c;
}

// Initialize state with random perturbation
fn initializeState(uv: vec2<f32>) -> vec2<f32> {
  var a = 1.0;  // Chemical A starts at maximum
  var b = 0.0;  // Chemical B starts at minimum

  // Add random seed points for chemical B
  let noise = hash(uv * 100.0 + vec2<f32>(uniforms.time * 0.001));

  // Create small random clusters
  if (noise > 0.97) {
    b = 0.5 + hash(uv * 50.0) * 0.5;
    a = 1.0 - b;
  }

  return vec2<f32>(a, b);
}

// Gray-Scott reaction-diffusion equations
fn reactionDiffusion(uv: vec2<f32>, a: f32, b: f32) -> vec2<f32> {
  // Calculate Laplacians for diffusion
  let laplaceA = laplacian(uv, 0);
  let laplaceB = laplacian(uv, 1);

  // Reaction term: A + 2B → 3B
  let reaction = a * b * b;

  // Feed and kill rates
  let f = uniforms.feedRate;
  let k = uniforms.killRate;

  // Diffusion rates
  let Da = uniforms.diffusionA;
  let Db = uniforms.diffusionB;

  // Time step
  let dt = uniforms.timestep;

  // Update equations:
  // dA/dt = Da * ∇²A - AB² + f(1-A)
  // dB/dt = Db * ∇²B + AB² - (k+f)B
  let dA = (Da * laplaceA - reaction + f * (1.0 - a)) * dt;
  let dB = (Db * laplaceB + reaction - (k + f) * b) * dt;

  // Update concentrations
  var newA = a + dA;
  var newB = b + dB;

  // Clamp to valid range [0, 1]
  newA = clamp(newA, 0.0, 1.0);
  newB = clamp(newB, 0.0, 1.0);

  return vec2<f32>(newA, newB);
}

// Map concentration to color
fn concentrationToColor(a: f32, b: f32) -> vec3<f32> {
  // Visualize chemical B concentration
  // Can be customized for different visual styles

  // Style 1: Grayscale based on B
  // return vec3<f32>(b);

  // Style 2: Blue (A) to Yellow (B)
  let blue = vec3<f32>(0.1, 0.2, 0.8);
  let yellow = vec3<f32>(0.9, 0.8, 0.1);
  var color = mix(blue, yellow, b);

  // Add some brightness modulation
  color *= 0.8 + a * 0.4;

  return color;
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

  // Get current state
  let current = textureSample(stateTexture, texSampler, uv);
  var a = current.r;
  var b = current.g;

  // Initialize if this is the first frame (detect if state is uninitialized)
  if (uniforms.time < 0.1 && a < 0.01 && b < 0.01) {
    let init = initializeState(uv);
    a = init.x;
    b = init.y;
  } else {
    // Run simulation step
    let result = reactionDiffusion(uv, a, b);
    a = result.x;
    b = result.y;
  }

  // Convert concentration to color
  let color = concentrationToColor(a, b);

  // Store state in R and G channels, color in RGB for output
  // Alpha channel can store additional data if needed
  textureStore(outputTexture, texCoord, vec4<f32>(color, 1.0));

  // Note: For true state persistence, we'd write to a separate state buffer
  // This simplified version combines state and visualization
}
