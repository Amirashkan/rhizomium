// src/codegen/compilers/NoiseNodes.js
export class NoiseNodes {
  handles(kind) {
    const noiseTypes = [
      'Random', 'ValueNoise', 'FBMNoise', 'SimplexNoise', 
      'VoronoiNoise', 'RidgedNoise', 'WarpNoise'
    ];
    return noiseTypes.includes(kind);
  }
  
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'Random':
        return this.compileRandom(node, getInput, nodeId);
      case 'ValueNoise':
        return this.compileValueNoise(node, getInput, nodeId);
      case 'FBMNoise':
        return this.compileFBMNoise(node, getInput, nodeId);
      case 'SimplexNoise':
        return this.compileSimplexNoise(node, getInput, nodeId);
      case 'VoronoiNoise':
        return this.compileVoronoiNoise(node, getInput, nodeId);
      case 'RidgedNoise':
        return this.compileRidgedNoise(node, getInput, nodeId);
      case 'WarpNoise':
        return this.compileWarpNoise(node, getInput, nodeId);
      default:
        return this.compileGenericNoise(node, getInput, nodeId);
    }
  }
  
  getParam(node, paramName, defaultValue) {
    if (node.params && node.params.hasOwnProperty(paramName)) {
      const value = node.params[paramName];
      
      if (typeof value === 'string' && value.trim().startsWith('=')) {
        try {
          const expressionSystem = window.expressionSystem;
          if (expressionSystem) {
            const result = expressionSystem.evaluateExpression(value, {}, node);
            return result !== null && result !== undefined ? result : defaultValue;
          }
        } catch (error) {
          console.warn(`Expression evaluation failed for ${paramName}:`, error);
        }
        
        const numericValue = parseFloat(value.substring(1));
        return isNaN(numericValue) ? defaultValue : numericValue;
      }
      
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = parseFloat(value);
        return isNaN(parsed) ? defaultValue : parsed;
      }
      
      return value;
    }
    
    return defaultValue;
  }
  
  formatParam(value) {
    if (typeof value === 'number') {
      return `${value.toFixed(6)}`;
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? '0.0' : `${parsed.toFixed(6)}`;
    }
    return '0.0';
  }
  
  compileRandom(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const seed = this.formatParam(this.getParam(node, 'seed', 1.0));
    const scale = this.formatParam(this.getParam(node, 'scale', 1.0));
    
    const line = `let node_${nodeId} = vec3<f32>(hash12(${uv} * ${scale} + vec2<f32>(${seed})));`;
    return { line, outputType: "vec3" };
  }
  
  compileValueNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = this.formatParam(this.getParam(node, 'scale', 5.0));
    const amplitude = this.formatParam(this.getParam(node, 'amplitude', 1.0));
    const offset = this.formatParam(this.getParam(node, 'offset', 0.0));
    const power = this.formatParam(this.getParam(node, 'power', 1.0));
    
    const line = `let node_${nodeId} = vec3<f32>(pow(valueNoise(${uv} * ${scale}) * ${amplitude} + ${offset}, ${power}));`;
    return { line, outputType: "vec3" };
  }
  
  compileFBMNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = this.formatParam(this.getParam(node, 'scale', 3.0));
    const octaves = Math.max(1, Math.min(8, parseInt(this.getParam(node, 'octaves', 4))));
    const persistence = this.formatParam(this.getParam(node, 'persistence', 0.5));
    const lacunarity = this.formatParam(this.getParam(node, 'lacunarity', 2.0));
    const amplitude = this.formatParam(this.getParam(node, 'amplitude', 1.0));
    const offset = this.formatParam(this.getParam(node, 'offset', 0.0));
    const gain = this.formatParam(this.getParam(node, 'gain', 0.5));
    const warp = this.formatParam(this.getParam(node, 'warp', 0.0));
    
    let line;
    if (parseFloat(warp) > 0.001) {
      line = `let node_${nodeId} = vec3<f32>((fbmNoise(${uv} * ${scale} + vec2<f32>(fbmNoise(${uv} * ${scale} * 2.0, ${octaves}, ${persistence}, ${lacunarity}) * ${warp}), ${octaves}, ${persistence}, ${lacunarity}) * ${amplitude} + ${offset}) * ${gain});`;
    } else {
      line = `let node_${nodeId} = vec3<f32>((fbmNoise(${uv} * ${scale}, ${octaves}, ${persistence}, ${lacunarity}) * ${amplitude} + ${offset}) * ${gain});`;
    }
    
    return { line, outputType: "vec3" };
  }
  
  compileSimplexNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = this.formatParam(this.getParam(node, 'scale', 4.0));
    const amplitude = this.formatParam(this.getParam(node, 'amplitude', 1.0));
    const offset = this.formatParam(this.getParam(node, 'offset', 0.0));
    const ridge = this.getParam(node, 'ridge', false);
    const turbulence = this.getParam(node, 'turbulence', false);
    
    let noiseCall = `simplexNoise(${uv} * ${scale})`;
    
    if (ridge) {
      noiseCall = `(1.0 - abs(${noiseCall}))`;
    }
    
    if (turbulence) {
      noiseCall = `abs(${noiseCall})`;
    }
    
    const line = `let node_${nodeId} = vec3<f32>(${noiseCall} * ${amplitude} + ${offset});`;
    return { line, outputType: "vec3" };
  }
  
  compileVoronoiNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = this.formatParam(this.getParam(node, 'scale', 8.0));
    const randomness = this.formatParam(this.getParam(node, 'randomness', 1.0));
    const minkowskiP = this.formatParam(this.getParam(node, 'minkowskiP', 2.0));
    const smoothness = this.formatParam(this.getParam(node, 'smoothness', 0.0));
    const cellType = Math.max(0, Math.min(2, parseInt(this.getParam(node, 'cellType', 0))));
    const outputType = Math.max(0, Math.min(2, parseInt(this.getParam(node, 'outputType', 0))));
    
    const line = `let node_${nodeId} = vec3<f32>(voronoiNoise(${uv} * ${scale}, ${randomness}, ${minkowskiP}, ${smoothness}, ${cellType}, ${outputType}));`;
    return { line, outputType: "vec3" };
  }
  
  compileRidgedNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = this.formatParam(this.getParam(node, 'scale', 4.0));
    const octaves = Math.max(1, Math.min(8, parseInt(this.getParam(node, 'octaves', 6))));
    const lacunarity = this.formatParam(this.getParam(node, 'lacunarity', 2.0));
    const gain = this.formatParam(this.getParam(node, 'gain', 0.5));
    const amplitude = this.formatParam(this.getParam(node, 'amplitude', 1.0));
    const offset = this.formatParam(this.getParam(node, 'offset', 1.0));
    const threshold = this.formatParam(this.getParam(node, 'threshold', 0.0));
    
    const line = `let node_${nodeId} = vec3<f32>(ridgedNoise(${uv} * ${scale}, ${octaves}, ${lacunarity}, ${gain}, ${amplitude}, ${offset}, ${threshold}));`;
    return { line, outputType: "vec3" };
  }
  
  compileWarpNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = this.formatParam(this.getParam(node, 'scale', 3.0));
    const warpScale = this.formatParam(this.getParam(node, 'warpScale', 2.0));
    const warpStrength = this.formatParam(this.getParam(node, 'warpStrength', 0.1));
    const octaves = Math.max(1, Math.min(8, parseInt(this.getParam(node, 'octaves', 3))));
    const amplitude = this.formatParam(this.getParam(node, 'amplitude', 1.0));
    
    const line = `let node_${nodeId} = vec3<f32>(warpNoise(${uv} * ${scale}, ${warpScale}, ${warpStrength}, ${octaves}) * ${amplitude});`;
    return { line, outputType: "vec3" };
  }
  
  compileGenericNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = this.formatParam(this.getParam(node, 'scale', 5.0));
    
    console.warn(`Unknown noise type: ${node.kind}, using generic noise`);
    const line = `let node_${nodeId} = vec3<f32>(simplexNoise(${uv} * ${scale}));`;
    return { line, outputType: "vec3" };
  }
}

// WGSL Noise Functions - Add this to your shader header
export const NOISE_FUNCTIONS_WGSL = `
// Hash functions
fn hash12(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Value noise
fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  
  return mix(
    mix(hash12(i + vec2<f32>(0.0, 0.0)), hash12(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash12(i + vec2<f32>(0.0, 1.0)), hash12(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

// Simplex noise permutation
fn permute(x: vec3<f32>) -> vec3<f32> {
  return ((x * 34.0 + 1.0) * x) % 289.0;
}

// Simplex noise
fn simplexNoise(v: vec2<f32>) -> f32 {
  let C = vec4<f32>(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  
  var i = floor(v + dot(v, C.yy));
  let x0 = v - i + dot(i, C.xx);
  
  let i1 = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), x0.x > x0.y);
  
  var x12 = x0.xyxy + C.xxzz;
  x12 = x12 - vec4<f32>(i1.xy, 0.0, 0.0);
  
  i = i % 289.0;
  
  let p = permute(permute(i.y + vec3<f32>(0.0, i1.y, 1.0)) + i.x + vec3<f32>(0.0, i1.x, 1.0));
  
  var m = max(0.5 - vec3<f32>(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3<f32>(0.0));
  m = m * m;
  m = m * m;
  
  let x = 2.0 * fract(p * C.www) - 1.0;
  let h = abs(x) - 0.5;
  let ox = floor(x + 0.5);
  let a0 = x - ox;
  
  m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));
  
  let g = vec3<f32>(
    a0.x * x0.x + h.x * x0.y,
    a0.y * x12.x + h.y * x12.y,
    a0.z * x12.z + h.z * x12.w
  );
  
  return 130.0 * dot(m, g);
}

// FBM noise
fn fbmNoise(p: vec2<f32>, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var maxValue = 0.0;
  
  for (var i = 0; i < octaves; i = i + 1) {
    value += simplexNoise(p * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  
  return value / maxValue;
}

// Ridged noise
fn ridgedNoise(p: vec2<f32>, octaves: i32, lacunarity: f32, gain: f32, amplitude: f32, offset: f32, threshold: f32) -> f32 {
  var value = 0.0;
  var weight = 1.0;
  var frequency = 1.0;
  
  for (var i = 0; i < octaves; i = i + 1) {
    var n = abs(simplexNoise(p * frequency));
    n = offset - n;
    n = n * n;
    n *= weight;
    weight = clamp(n * gain, 0.0, 1.0);
    value += n * amplitude;
    frequency *= lacunarity;
    amplitude *= 0.5;
  }
  
  return max(value - threshold, 0.0);
}

// Voronoi noise
fn voronoiNoise(p: vec2<f32>, randomness: f32, minkowskiP: f32, smoothness: f32, cellType: i32, outputType: i32) -> f32 {
  let i = floor(p);
  let f = fract(p);
  
  var minDist = 1.0;
  var secondMinDist = 1.0;
  
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let neighbor = vec2<f32>(f32(x), f32(y));
      let point = hash22(i + neighbor) * randomness + neighbor;
      let diff = point - f;
      
      var dist: f32;
      if (minkowskiP == 1.0) {
        dist = abs(diff.x) + abs(diff.y);
      } else if (minkowskiP == 2.0) {
        dist = length(diff);
      } else {
        dist = pow(pow(abs(diff.x), minkowskiP) + pow(abs(diff.y), minkowskiP), 1.0 / minkowskiP);
      }
      
      if (dist < minDist) {
        secondMinDist = minDist;
        minDist = dist;
      } else if (dist < secondMinDist) {
        secondMinDist = dist;
      }
    }
  }
  
  var result: f32;
  if (outputType == 0) {
    result = minDist;
  } else if (outputType == 1) {
    result = secondMinDist - minDist;
  } else {
    result = (minDist + secondMinDist) * 0.5;
  }
  
  if (smoothness > 0.0) {
    result = mix(result, smoothstep(0.0, 1.0, result), smoothness);
  }
  
  return result;
}

// Warp noise
fn warpNoise(p: vec2<f32>, warpScale: f32, warpStrength: f32, octaves: i32) -> f32 {
  let q = vec2<f32>(
    fbmNoise(p, octaves, 0.5, 2.0),
    fbmNoise(p + vec2<f32>(5.2, 1.3), octaves, 0.5, 2.0)
  );
  
  let r = vec2<f32>(
    fbmNoise(p + q * warpStrength + vec2<f32>(1.7, 9.2), octaves, 0.5, 2.0),
    fbmNoise(p + q * warpStrength + vec2<f32>(8.3, 2.8), octaves, 0.5, 2.0)
  );
  
  return fbmNoise(p + r * warpStrength * warpScale, octaves, 0.5, 2.0);
}
`;

// Updated NodeDefs.js section - Add noise categories to your existing NodeDefs
export const NOISE_NODE_ADDITIONS = {
  // Add these to your existing NodeDefs object:
  Random: {
    label: "Random",
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
  },

  ValueNoise: {
    label: "Value Noise", 
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
  },

  FBMNoise: {
    label: "FBM Noise",
    cat: "Noise", 
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
  },

  SimplexNoise: {
    label: "Simplex Noise",
    cat: "Noise",
    inputs: 1,
    outputs: 1, 
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
  },

  VoronoiNoise: {
    label: "Voronoi Noise",
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"], 
    pinsOut: [{ label: "out", type: "vec3" }],
  },

  RidgedNoise: {
    label: "Ridged Noise",
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
  },

  WarpNoise: {
    label: "Warp Noise", 
    cat: "Noise",
    inputs: 1,
    outputs: 1,
    pinsIn: ["UV"],
    pinsOut: [{ label: "out", type: "vec3" }],
  }
};

// Integration note:
// 1. Add NOISE_NODE_ADDITIONS to your existing NodeDefs object
// 2. Include NOISE_FUNCTIONS_WGSL in your shader header generation
// 3. Make sure the Noise category appears in your menu (should be automatic)
// 4. Ensure NoiseNodes compiler is registered in NodeCompiler.js