struct VOut{ @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@group(0) @binding(0) var<uniform> u_time: f32;
@vertex
fn vs(@builtin(vertex_index) vi:u32)->VOut{
  var p = array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0), vec2<f32>(3.0,-1.0), vec2<f32>(-1.0,3.0));
  var out: VOut;
  out.pos = vec4<f32>(p[vi], 0.0, 1.0);
  out.uv = (p[vi]*0.5+vec2<f32>(0.5,0.5))*2.0-1.0;
  return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
  var outputColor: vec3<f32> = vec3<f32>(0.0,0.0,0.0);
  // BEGIN GENERATED
{{GENERATED}}
  // END GENERATED
  return vec4<f32>(outputColor, 1.0);
}
