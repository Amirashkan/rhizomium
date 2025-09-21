// shaderlib.wgsl
// Safe math utils + shared helpers. Avoid double-underscore identifiers.

fn safe_smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let lo = min(a, b);
    let hi = max(a, b);
    let d = max(hi - lo, 1e-5);
    let t = clamp((x - lo) / d, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn safe_div(a: f32, b: f32) -> f32 {
    return a / max(b, 1e-6);
}

struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
    var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
    );
    var out: VSOut;
    let p = pos[vid];
    out.position = vec4<f32>(p, 0.0, 1.0);
    out.uv = p * 0.5 + vec2<f32>(0.5, 0.5);
    return out;
}

struct Uniforms {
    time: f32,
    pad1: vec3<f32>,
};
@group(0) @binding(0) var<uniform> u: Uniforms;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = vec3<f32>(uv, 0.5 + 0.5 * sin(u.time));
    return vec4<f32>(c, 1.0);
}
