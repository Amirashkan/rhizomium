// src/codegen/compilers/NoiseNodes.js - FIXED & OPTIMIZED VERSION

import { unifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';
import { compilerParamRefMapping } from '../../utils/paramReferences.js';
import { resolveDiscreteParam } from '../../utils/discreteParams.js';

export class NoiseNodes {
  constructor() {
    // Track which noise functions are actually used during compilation
    this.usedFunctions = new Set();
    // Graph being compiled, used to resolve node references in parameter expressions
    // without relying on the ambient window.editor.graph (absent in the external viewer).
    this.graph = null;
  }

  setGraph(graph) {
    this.graph = graph;
  }

  handles(kind) {
    const noiseTypes = [
      'Random', 'ValueNoise', 'FBMNoise', 'SimplexNoise',
      'VoronoiNoise', 'RidgedNoise', 'WarpNoise', 'PerlinNoise',
      'Worley', 'CellNoise'
    ];
    return noiseTypes.includes(kind);
  }

  /**
   * Reset tracking before each compilation
   */
  resetTracking() {
    this.usedFunctions.clear();
  }

  /**
   * Mark a noise function as used
   */
  markFunctionUsed(functionName) {
    this.usedFunctions.add(functionName);
  }

  /**
   * Get only the helper functions that are actually used
   */
  getHelperFunctions() {
    if (this.usedFunctions.size === 0) {
      return '';
    }

    // Define dependencies for each function
    const dependencies = {
      'hash12': [],
      'hash22': [],
      'fastNoise': ['hash12'],
      'valueNoise': ['hash12'],
      'perlinNoise': ['hash22'],
      'simplexNoise': [],
      'fbmNoise': ['simplexNoise', 'fastNoise'],
      'ridgedNoise': ['fastNoise'],
      'voronoiNoise': ['hash22'],
      'warpNoise': ['fastNoise'],
      'worleyNoise': ['hash22'],
      'cellNoise': ['hash22', 'hash12'],
    };

    // Collect all needed functions including dependencies
    const neededFunctions = new Set();
    const addWithDependencies = (funcName) => {
      if (neededFunctions.has(funcName)) return;
      neededFunctions.add(funcName);
      const deps = dependencies[funcName] || [];
      deps.forEach(dep => addWithDependencies(dep));
    };

    // Start with used functions
    this.usedFunctions.forEach(func => addWithDependencies(func));

    // Build the output in the correct order
    const orderedFunctions = [
      'hash12', 'hash22', 'fastNoise', 'valueNoise', 'perlinNoise',
      'simplexNoise', 'fbmNoise', 'ridgedNoise', 'voronoiNoise', 'warpNoise',
      'worleyNoise', 'cellNoise'
    ];

    const parts = [];

    // Add header comment if any functions are included
    if (neededFunctions.size > 0) {
      parts.push('// ============================================================================');
      parts.push('// NOISE HELPER FUNCTIONS (selectively included)');
      parts.push('// ============================================================================\n');
    }

    for (const funcName of orderedFunctions) {
      if (neededFunctions.has(funcName)) {
        parts.push(NOISE_FUNCTION_DEFINITIONS[funcName]);
      }
    }

    return parts.join('\n');
  }
  
  compile(node, getInput, getParam) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");

    switch (node.kind) {
      case 'Random':
        return this.compileRandom(node, getInput, getParam, nodeId);
      case 'ValueNoise':
        return this.compileValueNoise(node, getInput, getParam, nodeId);
      case 'FBMNoise':
        return this.compileFBMNoise(node, getInput, getParam, nodeId);
      case 'SimplexNoise':
        return this.compileOptimizedSimplexNoise(node, getInput, getParam, nodeId);
      case 'PerlinNoise':
        return this.compilePerlinNoise(node, getInput, getParam, nodeId);
      case 'VoronoiNoise':
        return this.compileVoronoiNoise(node, getInput, getParam, nodeId);
      case 'RidgedNoise':
        return this.compileRidgedNoise(node, getInput, getParam, nodeId);
      case 'WarpNoise':
        return this.compileWarpNoise(node, getInput, getParam, nodeId);
      case 'Worley':
        return this.compileWorley(node, getInput, getParam, nodeId);
      case 'CellNoise':
        return this.compileCellNoise(node, getInput, getParam, nodeId);
      default:
        return this.compileGenericNoise(node, getInput, getParam, nodeId);
    }
  }
  
  getParam(node, paramName, defaultValue) {
    const rawValue = node.params?.[paramName] ?? defaultValue;

    // A `select`/`boolean` control is baked into the generated code rather than delivered as a
    // uniform, so an expression in one is evaluated on the CPU and collapsed to a concrete option
    // here. Returns rawValue unchanged for every other parameter, leaving numeric expressions to
    // the shader generation below.
    const discrete = resolveDiscreteParam(node, paramName, rawValue, defaultValue);
    if (discrete !== rawValue) return discrete;

    // An identifier naming another parameter of this node binds to that parameter (see
    // utils/paramReferences.js); without it the shader generator zeroes the whole expression.
    const paramRefs = compilerParamRefMapping(this, node, rawValue, paramName);

    // USE UNIFIED AST SYSTEM for dynamic expressions
    // This ensures shader code matches CPU evaluation exactly
    if (typeof rawValue === 'string' && (/time|audioEnvelope/.test(rawValue))) {
      try {
        return unifiedExpressionSystem.generateShader(rawValue, paramRefs, this.graph);
      } catch {

        return String(defaultValue);
      }
    }

    // Handle regular expressions starting with =
    if (typeof rawValue === 'string' && rawValue.trim().startsWith('=')) {
      try {
        return unifiedExpressionSystem.generateShader(rawValue, paramRefs, this.graph);
      } catch {

        const numericValue = parseFloat(rawValue.substring(1));
        return isNaN(numericValue) ? defaultValue : numericValue;
      }
    }

    if (typeof rawValue === 'number') return rawValue;
    if (typeof rawValue === 'string') {
      const parsed = parseFloat(rawValue);
      return isNaN(parsed) ? defaultValue : parsed;
    }

    return rawValue ?? defaultValue;
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

  // OPTIMIZED: Simplex noise with LOD system
  // PERFORMANCE: Now uses uniforms instead of baked parameters!
  compileOptimizedSimplexNoise(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('simplexNoise');

    const uv = getInput(0, "vec2", "in.uv");
    const scale = getParam('scale', 4.0);
    const amplitude = getParam('amplitude', 1.0);
    const offset = getParam('offset', 0.0);
    const ridge = node.params?.ridge ?? false;
    const turbulence = node.params?.turbulence ?? false;

    // Apply aspect ratio correction
    const uvAspect = `uvAspect_${nodeId}`;
    const aspectCorrection = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;`;

    const base = `simplexNoise(${uvAspect} * ${scale})`;
    let processed = base;

    if (ridge) {
      processed = `clamp(1.0 - abs(${base}), 0.0, 1.0)`;
    } else if (turbulence) {
      processed = `clamp(abs(${base}), 0.0, 1.0)`;
    } else {
      processed = `(${base} * 0.5 + 0.5)`;
    }

    const line = `${aspectCorrection}
  let node_${nodeId} = vec3<f32>(${processed} * ${amplitude} + ${offset});`;
    return { line, outputType: "vec3" };
  }

  // FIXED: Added Perlin Noise compiler
  // PERFORMANCE: Now uses uniforms instead of baked parameters!
  compilePerlinNoise(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('simplexNoise');

    const uv = getInput(0, "vec2", "in.uv");
    const scale = getParam('scale', 5.0);
    const amplitude = getParam('amplitude', 1.0);
    const offset = getParam('offset', 0.0);

    // Apply aspect ratio correction
    const uvAspect = `uvAspect_${nodeId}`;
    const baseNoise = `simplexNoise(${uvAspect} * ${scale})`;
    const line = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;
  let node_${nodeId} = vec3<f32>((${baseNoise} * 0.5 + 0.5) * ${amplitude} + ${offset});`;
    return { line, outputType: "vec3" };
  }
  
  compileRandom(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('hash12');

    const uv = getInput(0, "vec2", "in.uv");
    const seed = getParam('seed', 1.0);
    const scale = getParam('scale', 1.0);

    // Random = per-pixel white noise (TV static). We must hash distinct values for
    // neighbouring pixels, so multiply the UV by the render resolution before hashing.
    // Hashing the raw [0,1] UV (the old behaviour) fed nearly-identical inputs to
    // hash12 for adjacent pixels and produced a smooth low-frequency gradient that did
    // not look random at all. `scale` now controls the size of the noise cells: 1.0 is
    // one cell per pixel, larger values make coarser blocks.
    const coord = `randCoord_${nodeId}`;
    const line = `
  let ${coord} = floor(${uv} * g.resolution / max(${scale}, 1.0));
  let node_${nodeId} = vec3<f32>(hash12(${coord} + vec2<f32>(${seed})));`;
    return { line, outputType: "vec3" };
  }
  
  compileValueNoise(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('valueNoise');

    const uv = getInput(0, "vec2", "in.uv");
    const scale = getParam('scale', 5.0);
    const amplitude = getParam('amplitude', 1.0);
    const offset = getParam('offset', 0.0);
    const power = getParam('power', 1.0);

    // Apply aspect ratio correction
    const uvAspect = `uvAspect_${nodeId}`;
    const line = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;
  let node_${nodeId} = vec3<f32>(pow(valueNoise(${uvAspect} * ${scale}) * ${amplitude} + ${offset}, ${power}));`;
    return { line, outputType: "vec3" };
  }
  
  compileFBMNoise(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('fbmNoise');

    const uv = getInput(0, "vec2", "in.uv");
    const scale = getParam('scale', 3.0);
    const octaves = Math.max(1, Math.min(8, parseInt(node.params?.octaves ?? 4)));
    const persistence = getParam('persistence', 0.5);
    const lacunarity = getParam('lacunarity', 2.0);
    const amplitude = getParam('amplitude', 1.0);
    const offset = getParam('offset', 0.0);
    const gain = getParam('gain', 0.5);
    const warp = getParam('warp', 0.0);

    // Apply aspect ratio correction
    const uvAspect = `uvAspect_${nodeId}`;

    // Check if warp is a uniform reference or a baked value
    const warpValue = typeof warp === 'string' && warp.includes('u_params') ? warp : parseFloat(warp);
    const useWarp = typeof warpValue === 'number' ? warpValue > 0.001 : true; // If it's a uniform, always generate warp code

    let line;
    if (useWarp) {
      line = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;
  let node_${nodeId} = vec3<f32>(((fbmNoise(${uvAspect} * ${scale} + vec2<f32>(fbmNoise(${uvAspect} * ${scale} * 2.0, ${octaves}, ${persistence}, ${lacunarity}) * ${warp}), ${octaves}, ${persistence}, ${lacunarity}) * 0.5 + 0.5) * ${amplitude} + ${offset}) * ${gain});`;
    } else {
      line = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;
  let node_${nodeId} = vec3<f32>(((fbmNoise(${uvAspect} * ${scale}, ${octaves}, ${persistence}, ${lacunarity}) * 0.5 + 0.5) * ${amplitude} + ${offset}) * ${gain});`;
    }

    return { line, outputType: "vec3" };
  }
  
  // FIXED: Voronoi now properly outputs multiple values
  // PERFORMANCE: Now uses uniforms instead of baked parameters!
  compileVoronoiNoise(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('voronoiNoise');

    const uv = getInput(0, "vec2", "in.uv");
    const scale = getParam('scale', 8.0);
    const randomness = getParam('randomness', 1.0);
    const minkowskiP = getParam('minkowskiP', 2.0);
    const smoothness = getParam('smoothness', 0.0);

    // Integer parameters - parse them
    const cellTypeValue = node.params?.cellType ?? 0;
    const cellType = Math.max(0, Math.min(2, parseInt(cellTypeValue)));
    const outputTypeValue = node.params?.outputType ?? 0;
    const outputType = Math.max(0, Math.min(2, parseInt(outputTypeValue)));

    // Apply aspect ratio correction
    const uvAspect = `uvAspect_${nodeId}`;
    const line = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;
  let voronoi_result_${nodeId} = voronoiNoise(${uvAspect} * ${scale}, ${randomness}, ${minkowskiP}, ${smoothness}, ${cellType}, ${outputType});
  let node_${nodeId} = voronoi_result_${nodeId}.x;`;

    const outputPins = [
      { expression: `voronoi_result_${nodeId}.x`, type: "f32" },
      { expression: `voronoi_result_${nodeId}.y`, type: "f32" },
      { expression: `voronoi_result_${nodeId}.zw`, type: "vec2" },
    ];

    return { line, outputType: "f32", outputPins };
  }
  
  compileRidgedNoise(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('ridgedNoise');

    const uv = getInput(0, "vec2", "in.uv");
    const scale = getParam('scale', 4.0);
    const octaves = Math.max(1, Math.min(8, parseInt(node.params?.octaves ?? 6)));
    const lacunarity = getParam('lacunarity', 2.0);
    const gain = getParam('gain', 0.5);
    const amplitude = getParam('amplitude', 1.0);
    const offset = getParam('offset', 1.0);
    const threshold = getParam('threshold', 0.0);

    // Apply aspect ratio correction
    const uvAspect = `uvAspect_${nodeId}`;
    const line = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;
  let node_${nodeId} = vec3<f32>(ridgedNoise(${uvAspect} * ${scale}, ${octaves}, ${lacunarity}, ${gain}, ${amplitude}, ${offset}, ${threshold}));`;
    return { line, outputType: "vec3" };
  }
  
  compileWarpNoise(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('warpNoise');

    const uv = getInput(0, "vec2", "in.uv");
    const scale = getParam('scale', 3.0);
    const warpScale = getParam('warpScale', 2.0);
    const warpStrength = getParam('warpStrength', 0.1);
    const octaves = Math.max(1, Math.min(8, parseInt(node.params?.octaves ?? 3)));
    const amplitude = getParam('amplitude', 1.0);

    // Apply aspect ratio correction
    const uvAspect = `uvAspect_${nodeId}`;
    const line = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;
  let node_${nodeId} = vec3<f32>(warpNoise(${uvAspect} * ${scale}, ${warpScale}, ${warpStrength}, ${octaves}) * ${amplitude});`;
    return { line, outputType: "vec3" };
  }

  // Worley (cellular) noise. Outputs F1 (distance to nearest feature point),
  // F2 (distance to second nearest) and Combined (F2 - F1, the classic cell edges).
  compileWorley(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('worleyNoise');

    const uv = getInput(0, "vec2", "in.uv");
    const scale = getParam('scale', 8.0);
    const jitter = getParam('jitter', 1.0);
    const minkowskiP = getParam('minkowskiP', 2.0);

    // distanceMetric is a select; map it to the int the WGSL function expects.
    const metricMap = { euclidean: 0, manhattan: 1, chebyshev: 2, minkowski: 3 };
    const metric = metricMap[node.params?.distanceMetric] ?? 0;

    const uvAspect = `uvAspect_${nodeId}`;
    const result = `worley_${nodeId}`;
    const line = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;
  let ${result} = worleyNoise(${uvAspect} * ${scale}, ${jitter}, ${metric}, ${minkowskiP});
  let node_${nodeId} = vec3<f32>(${result}.x);`;

    const outputPins = [
      { expression: `${result}.x`, type: "f32" },
      { expression: `${result}.y`, type: "f32" },
      { expression: `(${result}.y - ${result}.x)`, type: "f32" },
    ];

    return { line, outputType: "f32", outputPins };
  }

  // Cell noise. Each Voronoi cell is filled with a flat random value. Outputs the
  // cell value plus the cell id (its integer grid coordinate) for further indexing.
  compileCellNoise(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('cellNoise');

    const uv = getInput(0, "vec2", "in.uv");
    const scale = getParam('scale', 8.0);
    const randomness = getParam('randomness', 1.0);

    const uvAspect = `uvAspect_${nodeId}`;
    const result = `cell_${nodeId}`;
    const line = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;
  let ${result} = cellNoise(${uvAspect} * ${scale}, ${randomness});
  let node_${nodeId} = vec3<f32>(${result}.x);`;

    const outputPins = [
      { expression: `${result}.x`, type: "f32" },
      { expression: `${result}.yz`, type: "vec2" },
    ];

    return { line, outputType: "f32", outputPins };
  }

  compileGenericNoise(node, getInput, getParam, nodeId) {
    this.markFunctionUsed('fastNoise');

    const uv = getInput(0, "vec2", "in.uv");
    const scale = getParam('scale', 5.0);

    // Apply aspect ratio correction
    const uvAspect = `uvAspect_${nodeId}`;
    const line = `
  var ${uvAspect} = ${uv};
  ${uvAspect}.x *= u.aspect;
  let node_${nodeId} = vec3<f32>(fastNoise(${uvAspect} * ${scale}));`;
    return { line, outputType: "vec3" };
  }
}

// FIXED & OPTIMIZED WGSL Noise Functions - Split into individual definitions for selective inclusion
export const NOISE_FUNCTION_DEFINITIONS = {
  // Hash without Sine (Dave Hoskins). The `p3 += dot(p3, p3.yzx + 33.33)` step
  // is what decorrelates neighbouring inputs; without it the result is close to
  // a linear function of p, and every lattice-interpolated noise built on it
  // (value, fast, ridged, warp, worley) comes out as smooth bands rather than
  // noise. Adding a constant inside the final fract, as this used to, does not
  // mix anything. Measured over a 64x64 integer lattice, neighbour correlation
  // goes from 0.63 (x) / -0.45 (y) to 0.03 / -0.03. This matches the form the
  // compute-path shaders in ComputeNodes.js already use.
  hash12: `// Hash function: vec2 -> f32
fn hash12(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`,

  hash22: `// Hash function: vec2 -> vec2
fn hash22(p: vec2<f32>) -> vec2<f32> {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}`,

  fastNoise: `// Fast Noise - Optimized for high frequencies
fn fastNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(hash12(i), hash12(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash12(i + vec2<f32>(0.0, 1.0)), hash12(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}`,

  valueNoise: `// Value Noise - Balanced performance and quality
fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(hash12(i + vec2<f32>(0.0, 0.0)), hash12(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash12(i + vec2<f32>(0.0, 1.0)), hash12(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}`,

  perlinNoise: `// Perlin Noise - Classic gradient noise
fn perlinNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);

  // Quintic interpolation
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  // Gradient vectors (normalized)
  let g00 = normalize(hash22(i + vec2<f32>(0.0, 0.0)) * 2.0 - 1.0);
  let g10 = normalize(hash22(i + vec2<f32>(1.0, 0.0)) * 2.0 - 1.0);
  let g01 = normalize(hash22(i + vec2<f32>(0.0, 1.0)) * 2.0 - 1.0);
  let g11 = normalize(hash22(i + vec2<f32>(1.0, 1.0)) * 2.0 - 1.0);

  // Distance vectors
  let d00 = f - vec2<f32>(0.0, 0.0);
  let d10 = f - vec2<f32>(1.0, 0.0);
  let d01 = f - vec2<f32>(0.0, 1.0);
  let d11 = f - vec2<f32>(1.0, 1.0);

  // Dot products
  let n00 = dot(g00, d00);
  let n10 = dot(g10, d10);
  let n01 = dot(g01, d01);
  let n11 = dot(g11, d11);

  // Bilinear interpolation
  return mix(
    mix(n00, n10, u.x),
    mix(n01, n11, u.x),
    u.y
  );
}`,

  simplexNoise: `// Simplex Noise - Optimized version
fn simplexNoise(v: vec2<f32>) -> f32 {
  let C = vec4<f32>(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);

  var i = floor(v + dot(v, C.yy));
  let x0 = v - i + dot(i, C.xx);

  let i1 = select(vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), x0.x > x0.y);

  var x12 = x0.xyxy + C.xxzz;
  x12 = x12 - vec4<f32>(i1.xy, 0.0, 0.0);

  // FIXED: Use proper modulo for WGSL
  i = i - floor(i / 289.0) * 289.0;

  // Simplified permutation
  let p = ((i.y + vec3<f32>(0.0, i1.y, 1.0)) * 34.0 + 1.0) * (i.x + vec3<f32>(0.0, i1.x, 1.0));
  let p_mod = p - floor(p / 289.0) * 289.0;

  var m = max(0.5 - vec3<f32>(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3<f32>(0.0));
  m = m * m * m * m;

  let x = 2.0 * fract(p_mod * C.www) - 1.0;
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
}`,

  fbmNoise: `// FBM Noise - Fractal Brownian Motion with LOD
fn fbmNoise(p: vec2<f32>, octaves: i32, persistence: f32, lacunarity: f32) -> f32 {
  var value = 0.0;
  var amplitude = 1.0;
  var frequency = 1.0;
  var maxValue = 0.0;

  // Use simplex for first 2 octaves, fast noise for details
  for (var i = 0; i < octaves; i = i + 1) {
    if (i < 2) {
      value += simplexNoise(p * frequency) * amplitude;
    } else {
      value += fastNoise(p * frequency) * amplitude;
    }
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }

  return value / maxValue;
}`,

  ridgedNoise: `// Ridged Noise - For terrain/mountain effects
fn ridgedNoise(p: vec2<f32>, octaves: i32, lacunarity: f32, gain: f32, amplitude: f32, offset: f32, threshold: f32) -> f32 {
  var value = 0.0;
  var weight = 1.0;
  var frequency = 1.0;
  var amp = amplitude;

  for (var i = 0; i < octaves; i = i + 1) {
    var n = abs(fastNoise(p * frequency));
    n = offset - n;
    n = n * n;
    n *= weight;
    weight = clamp(n * gain, 0.0, 1.0);
    value += n * amp;
    frequency *= lacunarity;
    amp *= 0.5;
  }

  return max(value - threshold, 0.0);
}`,

  voronoiNoise: `// Voronoi Noise - FIXED to return vec4
fn voronoiNoise(p: vec2<f32>, randomness: f32, minkowskiP: f32, smoothness: f32, cellType: i32, outputType: i32) -> vec4<f32> {
  let i = floor(p);
  let f = fract(p);

  var minDist = 1.0;
  var secondMinDist = 1.0;
  var closestPoint = vec2<f32>(0.0);

  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let neighbor = vec2<f32>(f32(x), f32(y));
      let point = hash22(i + neighbor) * randomness + neighbor;
      let diff = point - f;

      var dist: f32;
      if (minkowskiP == 2.0) {
        dist = length(diff);
      } else if (minkowskiP == 1.0) {
        dist = abs(diff.x) + abs(diff.y);
      } else {
        dist = pow(pow(abs(diff.x), minkowskiP) + pow(abs(diff.y), minkowskiP), 1.0 / minkowskiP);
      }

      if (dist < minDist) {
        secondMinDist = minDist;
        minDist = dist;
        closestPoint = point;
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
    result = secondMinDist;
  }

  // Apply smoothness if needed
  if (smoothness > 0.0) {
    result = mix(result, smoothstep(0.0, 1.0, result), smoothness);
  }

  // Return F1, F2, and cell coordinates
  return vec4<f32>(minDist, secondMinDist, closestPoint);
}`,

  warpNoise: `// Warp Noise - Domain warping effect
fn warpNoise(p: vec2<f32>, warpScale: f32, warpStrength: f32, octaves: i32) -> f32 {
  let q = vec2<f32>(
    fastNoise(p),
    fastNoise(p + vec2<f32>(5.2, 1.3))
  );

  let r = vec2<f32>(
    fastNoise(p + q * warpScale),
    fastNoise(p + q * warpScale + vec2<f32>(8.3, 2.8))
  );

  return fastNoise(p + r * warpStrength);
}`,

  worleyNoise: `// Worley (cellular) Noise - returns F1 and F2 distances
fn worleyNoise(p: vec2<f32>, jitter: f32, distMetric: i32, minkowskiP: f32) -> vec2<f32> {
  let i = floor(p);
  let f = fract(p);

  var f1 = 1e9;
  var f2 = 1e9;

  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let neighbor = vec2<f32>(f32(x), f32(y));
      let point = neighbor + hash22(i + neighbor) * jitter;
      let diff = point - f;

      var dist: f32;
      if (distMetric == 1) {
        dist = abs(diff.x) + abs(diff.y);                 // manhattan
      } else if (distMetric == 2) {
        dist = max(abs(diff.x), abs(diff.y));             // chebyshev
      } else if (distMetric == 3) {
        dist = pow(pow(abs(diff.x), minkowskiP) + pow(abs(diff.y), minkowskiP), 1.0 / minkowskiP); // minkowski
      } else {
        dist = length(diff);                              // euclidean
      }

      if (dist < f1) {
        f2 = f1;
        f1 = dist;
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }

  return vec2<f32>(f1, f2);
}`,

  cellNoise: `// Cell Noise - flat random value per Voronoi cell, plus the cell id
fn cellNoise(p: vec2<f32>, randomness: f32) -> vec3<f32> {
  let i = floor(p);
  let f = fract(p);

  var minDist = 1e9;
  var cellId = vec2<f32>(0.0);

  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let neighbor = vec2<f32>(f32(x), f32(y));
      let point = neighbor + hash22(i + neighbor) * randomness;
      let diff = point - f;
      let dist = dot(diff, diff);

      if (dist < minDist) {
        minDist = dist;
        cellId = i + neighbor;
      }
    }
  }

  return vec3<f32>(hash12(cellId), cellId.x, cellId.y);
}`
};

// Keep the old constant for backward compatibility (deprecated)
export const OPTIMIZED_NOISE_FUNCTIONS_WGSL = Object.values(NOISE_FUNCTION_DEFINITIONS).join('\n\n');
