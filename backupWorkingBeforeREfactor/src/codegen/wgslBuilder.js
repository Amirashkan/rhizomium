//src\codegen\wgslBuilder.js
function generateTextureBindings(graph) {
  let textureBindings = "";
  let bindingIndex = 1; // Start after uniforms

  if (!graph.nodes)
    return { bindings: textureBindings, nextBinding: bindingIndex };

  for (const node of graph.nodes) {
    if (node.kind === "Texture2D") {
      const nodeId = sanitize(node.id);
      textureBindings += `
@group(0) @binding(${bindingIndex}) var texture_${nodeId}: texture_2d<f32>;
@group(0) @binding(${bindingIndex + 1}) var sampler_${nodeId}: sampler;`;
      bindingIndex += 2;
    } else if (node.kind === "TextureCube") {
      const nodeId = sanitize(node.id);
      textureBindings += `
@group(0) @binding(${bindingIndex}) var textureCube_${nodeId}: texture_cube<f32>;
@group(0) @binding(${bindingIndex + 1}) var samplerCube_${nodeId}: sampler;`;
      bindingIndex += 2;
    }
  }

  return { bindings: textureBindings, nextBinding: bindingIndex };
}
function topoOrder(graph) {
  const nodes = graph.nodes || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set();
  const out = [];
  function visit(id) {
    if (!id || visited.has(id)) return;
    visited.add(id);
    const n = byId.get(id);
    if (!n) return;
    for (const inp of n.inputs || []) if (inp) visit(inp);
    out.push(n);
  }
  for (const n of nodes) visit(n.id);
  return out;
}

function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
}

export function buildWGSL(graph) {
  let ordered = topoOrder(graph);

  function pickActiveOutput(graph) {
    const outs = (graph.nodes || []).filter((n) =>
      /OutputFinal/i.test(n.kind || n.type || n.name || ""),
    );
    const connected = outs.filter(
      (o) => Array.isArray(o.inputs) && o.inputs[0],
    );
    if (connected.length) return connected[connected.length - 1];
    return outs[outs.length - 1] || null;
  }

  function upstreamSet(start, byId) {
    const vis = new Set();
    (function dfs(id) {
      if (!id || vis.has(id)) return;
      vis.add(id);
      const n = byId.get(id);
      if (!n) return;
      for (const inp of n.inputs || []) if (inp) dfs(inp);
    })(start);
    return vis;
  }

  const outNode = pickActiveOutput(graph);
  if (outNode) {
    const byId = new Map((graph.nodes || []).map((n) => [n.id, n]));
    const keep = upstreamSet(outNode.id, byId);
    ordered = ordered.filter((n) => keep.has(n.id));
  }

  if (!outNode || ordered.length === 0) {
    return `
struct Globals { time: f32, }
@group(0) @binding(0) var<uniform> u : Globals;
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2<f32>, 6>(
    vec2<f32>(-1.0,-1.0), vec2<f32>( 1.0,-1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>( 1.0,-1.0), vec2<f32>( 1.0, 1.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(p[vid], 0.0, 1.0);
  out.uv = 0.5 * (p[vid] + vec2<f32>(1.0,1.0));
  return out;
}
fn random(st: vec2<f32>) -> f32 {
  return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}
fn valueNoise(st: vec2<f32>) -> f32 {
  let i = floor(st);
  let f = fract(st);
  let a = random(i);
  let b = random(i + vec2<f32>(1.0, 0.0));
  let c = random(i + vec2<f32>(0.0, 1.0));
  let d = random(i + vec2<f32>(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
fn fbm(st: vec2<f32>, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var maxValue = 0.0;
  for (var i = 0; i < octaves; i++) {
    value += valueNoise(st * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
}
fn simplexNoise(st: vec2<f32>) -> f32 {
  let K1 = 0.366025404;
  let K2 = 0.211324865;
  let i = floor(st + (st.x + st.y) * K1);
  let a = st - i + (i.x + i.y) * K2;
  let o = vec2<f32>(step(a.y, a.x), 1.0 - step(a.y, a.x));
  let b = a - o + K2;
  let c = a - 1.0 + 2.0 * K2;
  let h = max(0.5 - vec3<f32>(dot(a, a), dot(b, b), dot(c, c)), vec3<f32>(0.0));
  let n = h * h * h * h * vec3<f32>(
    dot(a, vec2<f32>(random(i) - 0.5, random(i + vec2<f32>(1.0, 0.0)) - 0.5)),
    dot(b, vec2<f32>(random(i + o) - 0.5, random(i + o + vec2<f32>(1.0, 0.0)) - 0.5)),
    dot(c, vec2<f32>(random(i + vec2<f32>(1.0)) - 0.5, random(i + vec2<f32>(2.0, 1.0)) - 0.5))
  );
  return dot(n, vec3<f32>(70.0));
}
fn voronoi(st: vec2<f32>, randomness: f32) -> vec2<f32> {
  let n = floor(st);
  let f = fract(st);
  var minDist = 1.0;
  var minPoint = vec2<f32>(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let neighbor = vec2<f32>(f32(i), f32(j));
      let point = random(n + neighbor) * randomness;
      point = 0.5 + 0.5 * sin(6.2831 * point);
      let diff = neighbor + point - f;
      let dist = length(diff);
      if (dist < minDist) {
        minDist = dist;
        minPoint = point;
      }
    }
  }
  return vec2<f32>(minDist, random(n + minPoint));
}
fn ridgedNoise(st: vec2<f32>, octaves: i32, lacunarity: f32, gain: f32, offset: f32, threshold: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var prev = 1.0;
  for (var i = 0; i < octaves; i++) {
    var n = valueNoise(st * frequency);
    n = abs(n);
    n = offset - n;
    n = n * n;
    n = n * prev;
    prev = n;
    value += n * amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return max(value - threshold, 0.0);
}
fn warpedNoise(st: vec2<f32>, scale: f32, warpScale: f32, warpStrength: f32, octaves: i32) -> f32 {
  let warp1 = vec2<f32>(
    valueNoise(st * warpScale),
    valueNoise(st * warpScale + vec2<f32>(5.2, 1.3))
  );
  let warp2 = vec2<f32>(
    valueNoise(st * warpScale + 4.0 * warp1 + vec2<f32>(1.7, 9.2)),
    valueNoise(st * warpScale + 4.0 * warp1 + vec2<f32>(8.3, 2.8))
  );
  let warpedPos = st + warpStrength * warp2;
  return fbm(warpedPos * scale, octaves, 0.5, 2.0);
}
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}`;
  }

  const lines = [];
  const types = new Map();
  const exprs = new Map();

  function want(id, wantType) {
    const sid = sanitize(id);
    let e = exprs.get(id);
    let t = types.get(id);
    if (!e) {
      e = "vec3<f32>(0.0)";
      t = "vec3";
    }

    function toVec4(e, t) {
      if (t === "vec4") return [e, "vec4"];
      if (t === "vec3") return [`vec4<f32>(${e}, 1.0)`, "vec4"];
      if (t === "vec2") return [`vec4<f32>(${e}.x, ${e}.y, 0.0, 1.0)`, "vec4"];
      if (t === "f32") return [`vec4<f32>(${e})`, "vec4"];
      return [`vec4<f32>(${e}, 1.0)`, "vec4"];
    }
    function toVec3(e, t) {
      if (t === "vec3") return [e, "vec3"];
      if (t === "vec4") return [`vec3<f32>(${e}.x, ${e}.y, ${e}.z)`, "vec3"]; // Extract RGB
      if (t === "vec2") return [`vec3<f32>(${e}.x, ${e}.y, 0.0)`, "vec3"];
      if (t === "f32") return [`vec3<f32>(${e})`, "vec3"];
      return [e, "vec3"];
    }
    function toF32(e, t) {
      if (t === "f32") return [e, "f32"];
      if (t === "vec4") return [`${e}.w`, "f32"]; // Extract alpha
      if (t === "vec2") return [`(${e}.x + ${e}.y) * 0.5`, "f32"];
      if (t === "vec3") return [`(${e}.x + ${e}.y + ${e}.z) / 3.0`, "f32"];
      return [e, "f32"];
    }

    if (wantType === "vec4") return toVec4(e, t)[0];
    if (wantType === "vec3") return toVec3(e, t)[0];
    if (wantType === "vec2") {
      if (t === "vec2") return e;
      if (t === "vec4") return `vec2<f32>(${e}.x, ${e}.y)`;
      if (t === "vec3") return `vec2<f32>(${e}.x, ${e}.y)`;
      if (t === "f32") return `vec2<f32>(${e})`;
      return `vec2<f32>(0.0)`;
    }
    if (wantType === "f32") return toF32(e, t)[0];
    return e;
  }

  for (const n of ordered) {
    const id = sanitize(n.id);
    let line = "";
    let outType = "vec3";

    switch (n.kind) {
      case "Texture2D": {
        const uv = n.inputs?.[0] ? want(n.inputs[0], "vec2") : "in.uv";
        const textureId = sanitize(n.id);
        line = `let node_${id} = textureSample(texture_${textureId}, sampler_${textureId}, ${uv});`;
        outType = "vec4";
        break;
      }

      case "TextureCube": {
        const dir = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "normalize(vec3<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0, 1.0))";
        const textureId = sanitize(n.id);
        line = `let node_${id} = textureSample(textureCube_${textureId}, samplerCube_${textureId}, ${dir});`;
        outType = "vec4";
        break;
      }
      case "UV": {
        line = `let node_${id} = in.uv;`;
        outType = "vec2";
        break;
      }
      case "Time": {
        line = `let node_${id} = u.time;`;
        outType = "f32";
        break;
      }
      case "ConstFloat": {
        const v = typeof n.value === "number" ? n.value : 0.0;
        line = `let node_${id} = ${v.toFixed(6)};`;
        outType = "f32";
        break;
      }
      case "Expr": {
        const a = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        const b = n.inputs?.[1] ? want(n.inputs[1], "f32") : "0.0";
        let expr = (n.expr || "a").toString();
        expr = expr
          .replace(/\bu_time\b/g, "u.time")
          .replace(/\buv\b/g, "in.uv");
        expr = expr.replace(/\ba\b/g, `(${a})`).replace(/\bb\b/g, `(${b})`);
        line = `let node_${id} = ${expr};`;
        outType = "f32";
        break;
      }
      case "CircleField": {
        const R = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.25";
        const E = n.inputs?.[1] ? want(n.inputs[1], "f32") : "0.02";
        line = `let node_${id} = 1.0 - smoothstep((${R}) - max(${E}, 0.0001), (${R}) + max(${E}, 0.0001), distance(in.uv, vec2<f32>(0.5, 0.5)));`;
        outType = "f32";
        break;
      }
      case "Multiply": {
        const A = n.inputs?.[0] ? want(n.inputs[0], "vec3") : "vec3<f32>(0.0)";
        const B = n.inputs?.[1] ? want(n.inputs[1], "vec3") : "vec3<f32>(0.0)";
        line = `let node_${id} = (${A}) * (${B});`;
        outType = "vec3";
        break;
      }
      case "Add": {
        const A = n.inputs?.[0] ? want(n.inputs[0], "vec3") : "vec3<f32>(0.0)";
        const B = n.inputs?.[1] ? want(n.inputs[1], "vec3") : "vec3<f32>(0.0)";
        line = `let node_${id} = (${A}) + (${B});`;
        outType = "vec3";
        break;
      }
      case "Saturate": {
        const v = n.inputs?.[0] ? want(n.inputs[0], "vec3") : "vec3<f32>(0.0)";
        line = `let node_${id} = clamp(${v}, vec3<f32>(0.0), vec3<f32>(1.0));`;
        outType = "vec3";
        break;
      }
      case "Random": {
        const uv = n.inputs?.[0] ? want(n.inputs[0], "vec2") : "in.uv";
        const seed = n.props?.seed ?? 1.0;
        const scale = n.props?.scale ?? 1.0;
        line = `let node_${id} = vec3<f32>(random(${uv} * ${scale.toFixed(3)} + vec2<f32>(${seed.toFixed(3)})));`;
        outType = "vec3";
        break;
      }
      case "ValueNoise": {
        const uv = n.inputs?.[0] ? want(n.inputs[0], "vec2") : "in.uv";
        const scale = n.props?.scale ?? 5.0;
        const amplitude = n.props?.amplitude ?? 1.0;
        const offset = n.props?.offset ?? 0.0;
        const power = n.props?.power ?? 1.0;
        line = `let node_${id} = vec3<f32>(clamp(pow(valueNoise(${uv} * ${scale.toFixed(3)}) * ${amplitude.toFixed(3)} + ${offset.toFixed(3)}, ${power.toFixed(3)}), 0.0, 1.0));`;
        outType = "vec3";
        break;
      }
      case "FBMNoise": {
        const uv = n.inputs?.[0] ? want(n.inputs[0], "vec2") : "in.uv";
        const scale = n.props?.scale ?? 3.0;
        const octaves = n.props?.octaves ?? 4;
        const persistence = n.props?.persistence ?? 0.5;
        const lacunarity = n.props?.lacunarity ?? 2.0;
        const amplitude = n.props?.amplitude ?? 1.0;
        const offset = n.props?.offset ?? 0.0;
        const gain = n.props?.gain ?? 0.5;
        const warp = n.props?.warp ?? 0.0;
        let uvExpr = `${uv} * ${scale.toFixed(3)}`;
        if (warp > 0.001) {
          uvExpr = `${uvExpr} + vec2<f32>(valueNoise(${uv} * ${(scale * 2.0).toFixed(3)}) * ${warp.toFixed(3)})`;
        }
        line = `let node_${id} = vec3<f32>(clamp((fbm(${uvExpr}, ${octaves}, ${persistence.toFixed(3)}, ${lacunarity.toFixed(3)}) * ${amplitude.toFixed(3)} + ${offset.toFixed(3)}) * ${gain.toFixed(3)}, 0.0, 1.0));`;
        outType = "vec3";
        break;
      }
      case "SimplexNoise": {
        const uv = n.inputs?.[0] ? want(n.inputs[0], "vec2") : "in.uv";
        const scale = n.props?.scale ?? 4.0;
        const amplitude = n.props?.amplitude ?? 1.0;
        const offset = n.props?.offset ?? 0.0;
        const ridge = n.props?.ridge ?? false;
        const turbulence = n.props?.turbulence ?? false;
        let noiseExpr = `simplexNoise(${uv} * ${scale.toFixed(3)})`;
        if (ridge) {
          noiseExpr = `abs(${noiseExpr})`;
        }
        if (turbulence) {
          noiseExpr = `abs(${noiseExpr})`;
        }
        line = `let node_${id} = vec3<f32>(clamp(${noiseExpr} * ${amplitude.toFixed(3)} + ${offset.toFixed(3)}, 0.0, 1.0));`;
        outType = "vec3";
        break;
      }
      case "VoronoiNoise": {
        const uv = n.inputs?.[0] ? want(n.inputs[0], "vec2") : "in.uv";
        const scale = n.props?.scale ?? 8.0;
        const randomness = n.props?.randomness ?? 1.0;
        const smoothness = n.props?.smoothness ?? 0.0;
        const outputType = n.props?.outputType ?? 0;
        let voronoiExpr = `voronoi(${uv} * ${scale.toFixed(3)}, ${randomness.toFixed(3)})`;
        if (outputType === 1) {
          voronoiExpr = `${voronoiExpr}.y`;
        } else {
          voronoiExpr = `${voronoiExpr}.x`;
        }
        if (smoothness > 0.001) {
          voronoiExpr = `smoothstep(0.0, ${smoothness.toFixed(3)}, ${voronoiExpr})`;
        }
        line = `let node_${id} = vec3<f32>(clamp(${voronoiExpr}, 0.0, 1.0));`;
        outType = "vec3";
        break;
      }
      case "RidgedNoise": {
        const uv = n.inputs?.[0] ? want(n.inputs[0], "vec2") : "in.uv";
        const scale = n.props?.scale ?? 4.0;
        const octaves = n.props?.octaves ?? 6;
        const lacunarity = n.props?.lacunarity ?? 2.0;
        const gain = n.props?.gain ?? 0.5;
        const amplitude = n.props?.amplitude ?? 1.0;
        const offset = n.props?.offset ?? 1.0;
        const threshold = n.props?.threshold ?? 0.0;
        line = `let node_${id} = vec3<f32>(clamp(ridgedNoise(${uv} * ${scale.toFixed(3)}, ${octaves}, ${lacunarity.toFixed(3)}, ${gain.toFixed(3)}, ${offset.toFixed(3)}, ${threshold.toFixed(3)}) * ${amplitude.toFixed(3)}, 0.0, 1.0));`;
        outType = "vec3";
        break;
      }
      case "WarpNoise": {
        const uv = n.inputs?.[0] ? want(n.inputs[0], "vec2") : "in.uv";
        const scale = n.props?.scale ?? 3.0;
        const warpScale = n.props?.warpScale ?? 2.0;
        const warpStrength = n.props?.warpStrength ?? 0.1;
        const octaves = n.props?.octaves ?? 3;
        const amplitude = n.props?.amplitude ?? 1.0;
        line = `let node_${id} = vec3<f32>(clamp(warpedNoise(${uv}, ${scale.toFixed(3)}, ${warpScale.toFixed(3)}, ${warpStrength.toFixed(3)}, ${octaves}) * ${amplitude.toFixed(3)}, 0.0, 1.0));`;
        outType = "vec3";
        break;
      }

      case "Sin": {
        const inp = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        line = `let node_${id} = sin(${inp});`;
        outType = "f32";
        break;
      }

      case "Cos": {
        const inp = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        line = `let node_${id} = cos(${inp});`;
        outType = "f32";
        break;
      }

      case "Tan": {
        const inp = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        line = `let node_${id} = tan(${inp});`;
        outType = "f32";
        break;
      }

      case "Floor": {
        const inp = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        line = `let node_${id} = floor(${inp});`;
        outType = "f32";
        break;
      }

      case "Fract": {
        const inp = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        line = `let node_${id} = fract(${inp});`;
        outType = "f32";
        break;
      }

      case "Abs": {
        const inp = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        line = `let node_${id} = abs(${inp});`;
        outType = "f32";
        break;
      }

      case "Sqrt": {
        const inp = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        line = `let node_${id} = sqrt(max(${inp}, 0.0));`;
        outType = "f32";
        break;
      }

      case "Pow": {
        const base = n.inputs?.[0] ? want(n.inputs[0], "f32") : "1.0";
        const exp = n.inputs?.[1] ? want(n.inputs[1], "f32") : "2.0";
        line = `let node_${id} = pow(${base}, ${exp});`;
        outType = "f32";
        break;
      }

      case "Min": {
        const a = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        const b = n.inputs?.[1] ? want(n.inputs[1], "f32") : "0.0";
        line = `let node_${id} = min(${a}, ${b});`;
        outType = "f32";
        break;
      }

      case "Max": {
        const a = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        const b = n.inputs?.[1] ? want(n.inputs[1], "f32") : "0.0";
        line = `let node_${id} = max(${a}, ${b});`;
        outType = "f32";
        break;
      }

      case "Clamp": {
        const value = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        const minVal = n.inputs?.[1] ? want(n.inputs[1], "f32") : "0.0";
        const maxVal = n.inputs?.[2] ? want(n.inputs[2], "f32") : "1.0";
        line = `let node_${id} = clamp(${value}, ${minVal}, ${maxVal});`;
        outType = "f32";
        break;
      }

      case "Smoothstep": {
        const edge0 = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        const edge1 = n.inputs?.[1] ? want(n.inputs[1], "f32") : "1.0";
        const x = n.inputs?.[2] ? want(n.inputs[2], "f32") : "0.5";
        line = `let node_${id} = smoothstep(${edge0}, ${edge1}, ${x});`;
        outType = "f32";
        break;
      }

      case "Step": {
        const edge = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.5";
        const x = n.inputs?.[1] ? want(n.inputs[1], "f32") : "0.0";
        line = `let node_${id} = step(${edge}, ${x});`;
        outType = "f32";
        break;
      }

      case "Subtract": {
        const a = n.inputs?.[0] ? want(n.inputs[0], "vec3") : "vec3<f32>(0.0)";
        const b = n.inputs?.[1] ? want(n.inputs[1], "vec3") : "vec3<f32>(0.0)";
        line = `let node_${id} = (${a}) - (${b});`;
        outType = "vec3";
        break;
      }

      case "Divide": {
        const a = n.inputs?.[0] ? want(n.inputs[0], "vec3") : "vec3<f32>(1.0)";
        const b = n.inputs?.[1] ? want(n.inputs[1], "vec3") : "vec3<f32>(1.0)";
        line = `let node_${id} = (${a}) / max((${b}), vec3<f32>(0.0001));`;
        outType = "vec3";
        break;
      }

      case "Length": {
        const vec = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "vec3<f32>(0.0)";
        line = `let node_${id} = length(${vec});`;
        outType = "f32";
        break;
      }

      case "Distance": {
        const a = n.inputs?.[0] ? want(n.inputs[0], "vec3") : "vec3<f32>(0.0)";
        const b = n.inputs?.[1] ? want(n.inputs[1], "vec3") : "vec3<f32>(0.0)";
        line = `let node_${id} = distance(${a}, ${b});`;
        outType = "f32";
        break;
      }

      case "Dot": {
        const a = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "vec3<f32>(1.0, 0.0, 0.0)";
        const b = n.inputs?.[1]
          ? want(n.inputs[1], "vec3")
          : "vec3<f32>(0.0, 1.0, 0.0)";
        line = `let node_${id} = dot(${a}, ${b});`;
        outType = "f32";
        break;
      }

      case "Normalize": {
        const vec = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "vec3<f32>(1.0, 0.0, 0.0)";
        line = `let node_${id} = normalize(${vec});`;
        outType = "vec3";
        break;
      }

      case "Sign": {
        const inp = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        line = `let node_${id} = sign(${inp});`;
        outType = "f32";
        break;
      }

      case "Mod": {
        const a = n.inputs?.[0] ? want(n.inputs[0], "f32") : "0.0";
        const b = n.inputs?.[1] ? want(n.inputs[1], "f32") : "1.0";
        line = `let node_${id} = ${a} - ${b} * floor(${a} / max(${b}, 0.0001));`;
        outType = "f32";
        break;
      }
      case "Dot": {
        const a = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "vec3<f32>(1.0, 0.0, 0.0)";
        const b = n.inputs?.[1]
          ? want(n.inputs[1], "vec3")
          : "vec3<f32>(0.0, 1.0, 0.0)";
        line = `let node_${id} = dot(${a}, ${b});`;
        outType = "f32";
        break;
      }

      case "Cross": {
        const a = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "vec3<f32>(1.0, 0.0, 0.0)";
        const b = n.inputs?.[1]
          ? want(n.inputs[1], "vec3")
          : "vec3<f32>(0.0, 1.0, 0.0)";
        line = `let node_${id} = cross(${a}, ${b});`;
        outType = "vec3";
        break;
      }

      case "Normalize": {
        const vec = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "vec3<f32>(1.0, 0.0, 0.0)";
        line = `let node_${id} = normalize(${vec});`;
        outType = "vec3";
        break;
      }

      case "Length": {
        const vec = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "vec3<f32>(0.0)";
        line = `let node_${id} = length(${vec});`;
        outType = "f32";
        break;
      }

      case "Distance": {
        const a = n.inputs?.[0] ? want(n.inputs[0], "vec3") : "vec3<f32>(0.0)";
        const b = n.inputs?.[1] ? want(n.inputs[1], "vec3") : "vec3<f32>(0.0)";
        line = `let node_${id} = distance(${a}, ${b});`;
        outType = "f32";
        break;
      }

      case "Reflect": {
        const incident = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "vec3<f32>(1.0, -1.0, 0.0)";
        const normal = n.inputs?.[1]
          ? want(n.inputs[1], "vec3")
          : "vec3<f32>(0.0, 1.0, 0.0)";
        line = `let node_${id} = reflect(${incident}, ${normal});`;
        outType = "vec3";
        break;
      }

      case "Refract": {
        const incident = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "vec3<f32>(1.0, -1.0, 0.0)";
        const normal = n.inputs?.[1]
          ? want(n.inputs[1], "vec3")
          : "vec3<f32>(0.0, 1.0, 0.0)";
        const eta = n.inputs?.[2] ? want(n.inputs[2], "f32") : "1.5";
        line = `let node_${id} = refract(${incident}, ${normal}, ${eta});`;
        outType = "vec3";
        break;
      }

      case "Texture2D": {
        const uv = n.inputs?.[0] ? want(n.inputs[0], "vec2") : "in.uv";
        const textureId = sanitize(n.id);

        // Sample the texture - this returns a vec4 (RGBA)
        line = `let node_${id} = textureSample(texture_${textureId}, sampler_${textureId}, ${uv});`;
        outType = "vec4";
        break;
      }

      case "TextureCube": {
        const dir = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "normalize(vec3<f32>(in.uv.x * 2.0 - 1.0, in.uv.y * 2.0 - 1.0, 1.0))";
        const textureId = sanitize(n.id);

        line = `let node_${id} = textureSample(textureCube_${textureId}, samplerCube_${textureId}, ${dir});`;
        outType = "vec4";
        break;
      }

      case "OutputFinal": {
        const c = n.inputs?.[0]
          ? want(n.inputs[0], "vec3")
          : "vec3<f32>(0.0,0.0,0.0)";
        line = `finalColor = ${c};`;
        outType = "vec3";
        break;
      }
      default: {
        line = `let node_${id} = vec3<f32>(0.0);`;
        outType = "vec3";
        break;
      }
    }

    lines.push(line);
    if (n.kind !== "OutputFinal") {
      exprs.set(n.id, `node_${id}`);
      types.set(n.id, outType);
    }
  }
  const textureInfo = generateTextureBindings(graph);
  return `
struct Globals { time: f32, }
@group(0) @binding(0) var<uniform> u : Globals;${textureInfo.bindings}
struct VSOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var p = array<vec2<f32>, 6>(
    vec2<f32>(-1.0,-1.0), vec2<f32>( 1.0,-1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>( 1.0,-1.0), vec2<f32>( 1.0, 1.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(p[vid], 0.0, 1.0);
  out.uv = 0.5 * (p[vid] + vec2<f32>(1.0,1.0));
  return out;
}
fn random(st: vec2<f32>) -> f32 {
  return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}
fn valueNoise(st: vec2<f32>) -> f32 {
  let i = floor(st);
  let f = fract(st);
  let a = random(i);
  let b = random(i + vec2<f32>(1.0, 0.0));
  let c = random(i + vec2<f32>(0.0, 1.0));
  let d = random(i + vec2<f32>(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
fn fbm(st: vec2<f32>, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var maxValue = 0.0;
  for (var i = 0; i < octaves; i++) {
    value += valueNoise(st * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxValue;
}
fn simplexNoise(st: vec2<f32>) -> f32 {
  let K1 = 0.366025404;
  let K2 = 0.211324865;
  let i = floor(st + (st.x + st.y) * K1);
  let a = st - i + (i.x + i.y) * K2;
  let o = vec2<f32>(step(a.y, a.x), 1.0 - step(a.y, a.x));
  let b = a - o + K2;
  let c = a - 1.0 + 2.0 * K2;
  let h = max(0.5 - vec3<f32>(dot(a, a), dot(b, b), dot(c, c)), vec3<f32>(0.0));
  let n = h * h * h * h * vec3<f32>(
    dot(a, vec2<f32>(random(i) - 0.5, random(i + vec2<f32>(1.0, 0.0)) - 0.5)),
    dot(b, vec2<f32>(random(i + o) - 0.5, random(i + o + vec2<f32>(1.0, 0.0)) - 0.5)),
    dot(c, vec2<f32>(random(i + vec2<f32>(1.0)) - 0.5, random(i + vec2<f32>(2.0, 1.0)) - 0.5))
  );
  return dot(n, vec3<f32>(70.0));
}
fn voronoi(st: vec2<f32>, randomness: f32) -> vec2<f32> {
  let n = floor(st);
  let f = fract(st);
  var minDist = 1.0;
  var minPoint = vec2<f32>(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let neighbor = vec2<f32>(f32(i), f32(j));
      let point = random(n + neighbor) * randomness;
      point = 0.5 + 0.5 * sin(6.2831 * point);
      let diff = neighbor + point - f;
      let dist = length(diff);
      if (dist < minDist) {
        minDist = dist;
        minPoint = point;
      }
    }
  }
  return vec2<f32>(minDist, random(n + minPoint));
}
fn ridgedNoise(st: vec2<f32>, octaves: i32, lacunarity: f32, gain: f32, offset: f32, threshold: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var prev = 1.0;
  for (var i = 0; i < octaves; i++) {
    var n = valueNoise(st * frequency);
    n = abs(n);
    n = offset - n;
    n = n * n;
    n = n * prev;
    prev = n;
    value += n * amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return max(value - threshold, 0.0);
}
fn warpedNoise(st: vec2<f32>, scale: f32, warpScale: f32, warpStrength: f32, octaves: i32) -> f32 {
  let warp1 = vec2<f32>(
    valueNoise(st * warpScale),
    valueNoise(st * warpScale + vec2<f32>(5.2, 1.3))
  );
  let warp2 = vec2<f32>(
    valueNoise(st * warpScale + 4.0 * warp1 + vec2<f32>(1.7, 9.2)),
    valueNoise(st * warpScale + 4.0 * warp1 + vec2<f32>(8.3, 2.8))
  );
  let warpedPos = st + warpStrength * warp2;
  return fbm(warpedPos * scale, octaves, 0.5, 2.0);
}
@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  var finalColor: vec3<f32> = vec3<f32>(0.0);
  ${lines.join("\n  ")}
  let _keep_uniform = u.time * 0.0;
return vec4<f32>(finalColor + vec3<f32>(_keep_uniform), 1.0);}`;
}
a;
