// src/gpu/fluidSimViz.js
//
// Visualization pass for the ComputeFluidSim node.
//
// The fluid sim's ping-pong state texture stores raw simulation data
// (RG = encoded velocity, B = dye, see generateFluidSimShader in
// src/codegen/compilers/ComputeNodes.js), which at rest is a mid-gray image —
// not something to show the user. Every other compute node's output texture is
// a plain copy of its storage texture; for the fluid sim ComputeShaderManager
// instead runs this second tiny compute pass, which reads the freshly-written
// state and writes the *displayed* image straight into the node's output
// texture. Keeping display out of the state texture means colorMode is a pure
// uniform switch: changing it never perturbs (or resets) the simulation.
//
// The pass reuses the node's existing uniform buffer, so the struct below MUST
// stay field-for-field identical to the sim shader's Uniforms struct (both are
// packed by the ComputeFluidSim case in computeUniformLayout.js).
//
// Keep this dependency-free: it is imported by ComputeShaderManager, which the
// second-monitor viewer loads too.

export const FLUID_SIM_VIZ_WGSL = `
// Fluid Simulation Visualization Pass
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  viscosity: f32,
  diffusion: f32,
  timestep: f32,
  iterations: f32,
  colorMode: f32,
  curl: f32,
  forceStrength: f32,
  dyeAmount: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var stateTexture: texture_2d<f32>;

// Must match the sim shader's encoding (exact zero at 128/255).
fn decodeVel(rg: vec2<f32>) -> vec2<f32> {
  return (rg * 255.0 - 128.0) / 127.0;
}

fn velAt(c: vec2<i32>, size: vec2<i32>) -> vec2<f32> {
  let cc = clamp(c, vec2<i32>(0), size - 1);
  return decodeVel(textureLoad(stateTexture, cc, 0).rg);
}

fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
  let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3<f32>(h) + k.xyz) * 6.0 - k.www);
  return v * mix(vec3<f32>(1.0), clamp(p - k.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), s);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<i32>(global_id.xy);
  let size = vec2<i32>(i32(uniforms.resolution.x), i32(uniforms.resolution.y));

  if (texCoord.x >= size.x || texCoord.y >= size.y) {
    return;
  }

  let state = textureLoad(stateTexture, texCoord, 0);
  let v = decodeVel(state.rg);
  let dye = state.b;

  let vL = velAt(texCoord + vec2<i32>(-1, 0), size);
  let vR = velAt(texCoord + vec2<i32>(1, 0), size);
  let vU = velAt(texCoord + vec2<i32>(0, -1), size);
  let vD = velAt(texCoord + vec2<i32>(0, 1), size);

  // 0=Dye, 1=Velocity, 2=Vorticity, 3=Pressure (see computeUniformLayout.js)
  let mode = i32(uniforms.colorMode + 0.5);
  var color: vec3<f32>;

  // The sim dithers velocity by +-half an encoding quantum every frame to keep
  // 8-bit decay from stalling; a small display-only dead zone (a few quanta)
  // keeps that dither from showing as background speckle in the derived views.
  let dz = 0.025;

  if (mode == 1) {
    // Velocity: classic direction->hue wheel, brightness from speed.
    let speed = max(length(v) - dz, 0.0);
    let hue = atan2(v.y, v.x) / 6.2831853 + 0.5;
    color = hsv2rgb(hue, 0.85, clamp(speed * 2.5, 0.0, 1.0));
  } else if (mode == 2) {
    // Vorticity: warm = counter-clockwise, cool = clockwise, dye as faint base.
    let wRaw = (vR.y - vL.y - vD.x + vU.x) * 0.5;
    let w = sign(wRaw) * max(abs(wRaw) - dz, 0.0) * 6.0;
    color = vec3<f32>(max(w, 0.0), abs(w) * 0.15, max(-w, 0.0)) + vec3<f32>(dye * 0.15);
  } else if (mode == 3) {
    // Pressure proxy (-divergence): red = compression, blue = expansion.
    let divRaw = (vR.x - vL.x + vD.y - vU.y) * 0.5;
    let div = sign(divRaw) * max(abs(divRaw) - dz, 0.0) * 8.0;
    color = vec3<f32>(max(-div, 0.0), abs(div) * 0.1, max(div, 0.0)) + vec3<f32>(dye * 0.15);
  } else {
    // Dye (default): neutral white smoke on black — composable downstream.
    color = vec3<f32>(dye);
  }

  textureStore(outputTexture, vec2<u32>(texCoord),
               vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0));
}`;
