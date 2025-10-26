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

struct U {
    aspect: f32,
};
@group(0) @binding(0) var<uniform> u: U;

struct Globals {
    time: f32,
    pad1: vec3<f32>,
};
@group(0) @binding(1) var<uniform> g: Globals;

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let c = vec3<f32>(uv, 0.5 + 0.5 * sin(g.time));
    return vec4<f32>(c, 1.0);
}
// Add to shaderlib.wgsl
fn hsvToRgb(hsv: vec3<f32>) -> vec3<f32> {
  let h = hsv.x * 6.0;
  let s = hsv.y;
  let v = hsv.z;
  let c = v * s;
  let x = c * (1.0 - abs(h % 2.0 - 1.0));
  let m = v - c;
  
  var rgb: vec3<f32>;
  if (h < 1.0) {
    rgb = vec3<f32>(c, x, 0.0);
  } else if (h < 2.0) {
    rgb = vec3<f32>(x, c, 0.0);
  } else if (h < 3.0) {
    rgb = vec3<f32>(0.0, c, x);
  } else if (h < 4.0) {
    rgb = vec3<f32>(0.0, x, c);
  } else if (h < 5.0) {
    rgb = vec3<f32>(x, 0.0, c);
  } else {
    rgb = vec3<f32>(c, 0.0, x);
  }
  
  return rgb + m;
}

fn rgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
  let cmax = max(max(rgb.r, rgb.g), rgb.b);
  let cmin = min(min(rgb.r, rgb.g), rgb.b);
  let delta = cmax - cmin;
  
  var h: f32 = 0.0;
  if (delta > 0.0) {
    if (cmax == rgb.r) {
      h = ((rgb.g - rgb.b) / delta) % 6.0;
    } else if (cmax == rgb.g) {
      h = (rgb.b - rgb.r) / delta + 2.0;
    } else {
      h = (rgb.r - rgb.g) / delta + 4.0;
    }
    h = h / 6.0;
    if (h < 0.0) {
      h = h + 1.0;
    }
  }
  
  let s = select(0.0, delta / cmax, cmax > 0.0);
  let v = cmax;
  
  return vec3<f32>(h, s, v);
}
fn worleyNoise(p: vec2<f32>, jitter: f32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  
  var minDist = 1.0;
  
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let neighbor = vec2<f32>(f32(x), f32(y));
      let point = hash22(i + neighbor) * jitter + neighbor;
      let diff = point - f;
      let dist = length(diff);
      minDist = min(minDist, dist);
    }
  }
  
  return minDist;
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
  return fract((p3.xx + p3.yz) * p3.zy + vec2<f32>(33.33));
}

fn hash12(p: vec2<f32>) -> f32 {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  return fract((p3.x + p3.y) * p3.z + dot(p3, vec3<f32>(33.33)));
}
