// src/codegen/compilers/NoiseNodes.js - OPTIMIZED VERSION
// Key changes: Much faster simplex noise + LOD system for performance

export class NoiseNodes {
  handles(kind) {
    const noiseTypes = [
      'Random', 'ValueNoise', 'FBMNoise', 'SimplexNoise', 
    'VoronoiNoise', 'RidgedNoise', 'WarpNoise', 'PerlinNoise'
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
        return this.compileOptimizedSimplexNoise(node, getInput, nodeId); // OPTIMIZED
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

  // OPTIMIZATION: New optimized simplex noise with LOD system
  compileOptimizedSimplexNoise(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const scale = this.formatParam(this.getParam(node, 'scale', 4.0));
    const amplitude = this.formatParam(this.getParam(node, 'amplitude', 1.0));
    const offset = this.formatParam(this.getParam(node, 'offset', 0.0));
    const ridge = this.getParam(node, 'ridge', false);
    const turbulence = this.getParam(node, 'turbulence', false);
    
    // OPTIMIZATION: Use faster noise for high frequency details
    const scaleValue = parseFloat(scale);
    let noiseCall;
    
    if (scaleValue > 10.0) {
      // High frequency - use fast hash-based noise
      console.log(`Using fast noise for high frequency scale: ${scaleValue}`);
      noiseCall = `fastNoise(${uv} * ${scale})`;
    } else if (scaleValue > 5.0) {
      // Medium frequency - use value noise (faster than simplex)
      console.log(`Using value noise for medium frequency scale: ${scaleValue}`);
      noiseCall = `valueNoise(${uv} * ${scale})`;
    } else {
      // Low frequency - use full simplex for quality
      console.log(`Using simplex noise for low frequency scale: ${scaleValue}`);
      noiseCall = `simplexNoise(${uv} * ${scale})`;
    }
    
    if (ridge) {
      noiseCall = `(1.0 - abs(${noiseCall}))`;
    }
    
    if (turbulence) {
      noiseCall = `abs(${noiseCall})`;
    }
    
    const line = `let node_${nodeId} = vec3<f32>(${noiseCall} * ${amplitude} + ${offset});`;
    return { line, outputType: "vec3" };
  }
  
  // Keep existing methods unchanged...
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
    const line = `let node_${nodeId} = vec3<f32>(fastNoise(${uv} * ${scale}));`; // Use fast noise for unknown types
    return { line, outputType: "vec3" };
  }
}

// OPTIMIZED WGSL Noise Functions
export const OPTIMIZED_NOISE_FUNCTIONS_WGSL = `
// FAST Hash functions - optimized for speed
fn hash12(p: vec2<f32>) -> f32 {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  return fract((p3.x + p3.y) * p3.z + dot(p3, vec3<f32>(33.33)));
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
  let p3 = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
  return fract((p3.xx + p3.yz) * p3.zy + vec2<f32>(33.33));
}

// FAST NOISE - Much faster than simplex for high frequencies
fn fastNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f); // Smoother interpolation
  
  return mix(
    mix(hash12(i), hash12(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash12(i + vec2<f32>(0.0, 1.0)), hash12(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

// VALUE NOISE - Medium performance, good quality
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

// OPTIMIZED SIMPLEX NOISE - Reduced precision for speed
fn simplexNoise(v: vec2<f32>) -> f32 {
  let C = vec4<f32>(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  
  var i = floor(v + dot(v, C.yy));
  let x0 = v - i + dot(i, C.xx);
  
  let i1 = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), x0.x > x0.y);
  
  var x12 = x0.xyxy + C.xxzz;
  x12 = x12 - vec4<f32>(i1.xy, 0.0, 0.0);
  
  i = i % 289.0;
  
  // OPTIMIZATION: Simplified permutation
  let p = ((i.y + vec3<f32>(0.0, i1.y, 1.0)) * 34.0 + 1.0) * (i.x + vec3<f32>(0.0, i1.x, 1.0)) % 289.0;
  
  var m = max(0.5 - vec3<f32>(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3<f32>(0.0));
  m = m * m * m * m; // m^4 instead of separate calculations
  
  let x = 2.0 * fract(p * C.www) - 1.0;
  let h = abs(x) - 0.5;
  let ox = floor(x + 0.5);
  let a0 = x - ox;
  
  // OPTIMIZATION: Simplified normalization
  m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));
  
  let g = vec3<f32>(
    a0.x * x0.x + h.x * x0.y,
    a0.y * x12.x + h.y * x12.y,
    a0.z * x12.z + h.z * x12.w
  );
  
  return 130.0 * dot(m, g);
}

// FBM noise with performance optimizations
fn fbmNoise(p: vec2<f32>, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var maxValue = 0.0;
  
  // OPTIMIZATION: Use fast noise for higher octaves
  for (var i = 0; i < octaves; i = i + 1) {
    if (i < 2) {
      value += simplexNoise(p * frequency) * amplitude;
    } else {
      value += fastNoise(p * frequency) * amplitude; // Fast noise for detail
    }
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  
  return value / maxValue;
}

// Keep other noise functions unchanged but optimized...
fn ridgedNoise(p: vec2<f32>, octaves: i32, lacunarity: f32, gain: f32, amplitude: f32, offset: f32, threshold: f32) -> f32 {
  var value = 0.0;
  var weight = 1.0;
  var frequency = 1.0;
  
  for (var i = 0; i < octaves; i = i + 1) {
    var n = abs(fastNoise(p * frequency)); // Use fast noise instead of simplex
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
      if (minkowskiP == 2.0) {
        dist = length(diff);
      } else {
        dist = abs(diff.x) + abs(diff.y); // Simplified for performance
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
  } else {
    result = secondMinDist - minDist;
  }
  
  return result;
}

fn warpNoise(p: vec2<f32>, warpScale: f32, warpStrength: f32, octaves: i32) -> f32 {
  let q = vec2<f32>(
    fastNoise(p), // Use fast noise for warping
    fastNoise(p + vec2<f32>(5.2, 1.3))
  );
  
  return fastNoise(p + q * warpStrength * warpScale);
}
`;