struct VertexOut {
  @builtin(position) Position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u_pos: vec2<f32>;
@group(0) @binding(1) var<uniform> u_color: vec3<f32>;

@vertex
fn vs_main(@location(0) pos: vec2<f32>) -> VertexOut {
  var out: VertexOut;
  out.Position = vec4<f32>(pos + u_pos, 0.0, 1.0);
  out.uv = pos;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(u_color, 1.0);
}
