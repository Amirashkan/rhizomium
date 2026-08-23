// src/codegen/templates/ShaderTemplate.js
// Provides ShaderTemplate and generateShader

export class ShaderTemplate {
  static getDefaultShader() {
    return /* wgsl */`
struct U {
  aspect : f32,
};
@group(0) @binding(0) var<uniform> u : U;

struct Globals {
  resolution : vec2<f32>,
  time       : f32,
  audioEnvelope : f32,
  audioEnvelopeBass : f32,
  audioEnvelopeMids : f32,
  audioEnvelopeHighs : f32,
  audioEnvelopeFull : f32,
  mouse      : vec4<f32>,
};
@group(0) @binding(1) var<uniform> g : Globals;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VSOut {
  var p = array<vec2<f32>,3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var out : VSOut;
  out.pos = vec4<f32>(p[vid], 0.0, 1.0);
  out.uv  = 0.5 * (p[vid] + vec2<f32>(1.0, 1.0));
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}`;
  }
}

export function generateShader(
  { lines = [], uniformStruct = "", shapeFunctions = "", transformHelpers = "", noiseHelpers = "", colorHelpers = "", mappingHelpers = "", computeBindings = "" },
  textureBindings = ""
) {
  return /* wgsl */`
struct U {
  aspect : f32,
};
@group(0) @binding(0) var<uniform> u : U;

struct Globals {
  resolution : vec2<f32>,
  time       : f32,
  audioEnvelope : f32,
  audioEnvelopeBass : f32,
  audioEnvelopeMids : f32,
  audioEnvelopeHighs : f32,
  audioEnvelopeFull : f32,
  mouse      : vec4<f32>,
};
@group(0) @binding(1) var<uniform> g : Globals;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VSOut {
  var p = array<vec2<f32>,3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var out : VSOut;
  out.pos = vec4<f32>(p[vid], 0.0, 1.0);
  out.uv  = 0.5 * (p[vid] + vec2<f32>(1.0, 1.0));
  return out;
}

// (Optionally appended user-defined structs)
${uniformStruct}

// Helpers & injected code
${shapeFunctions}
${transformHelpers}
${noiseHelpers}
${colorHelpers}
${mappingHelpers}
${textureBindings}
${computeBindings}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var finalColor : vec3<f32> = vec3<f32>(0.0);
  ${lines.join("\n  ")}
  return vec4<f32>(finalColor, 1.0);
}
`;
}
