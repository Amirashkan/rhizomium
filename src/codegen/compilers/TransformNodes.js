// src/codegen/compilers/TransformNodes.js - OPTIMIZED VERSION
// Key optimizations: GPU-side trigonometry, reduced calculations, batched transforms

import { unifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';

export class TransformNodes {
  constructor() {
    this.uniformManager = null;
  }

  /**
   * Set the uniform manager for registering parameters as GPU uniforms
   * @param {ParameterUniformManager} uniformManager
   */
  setUniformManager(uniformManager) {
    this.uniformManager = uniformManager;
  }

  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind
   * @returns {boolean}
   */
handles(kind) {
  return ['Transform2D','Scale2D','Rotate2D','TileAndOffset',
          'Flip2D','Twirl','Spherize','UVToColor'].includes(kind);
}


  /**
   * Compile transform nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput) {
    
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'Transform2D':

        return this.compileOptimizedTransform2D(node, getInput, nodeId);
      case 'Scale2D':
        return this.compileScale2D(node, getInput, nodeId);
      case 'Rotate2D':
        return this.compileOptimizedRotate2D(node, getInput, nodeId);
      case 'TileAndOffset':
        return this.compileTileAndOffset(node, getInput, nodeId);
      case 'Flip2D':
        return this.compileFlip2D(node, getInput, nodeId);
      case 'UVToColor':
        return this.compileUVToColor(node, getInput, nodeId);
        case 'Twirl':
  return this.compileTwirl(node, getInput, nodeId);
case 'Spherize':
  return this.compileSpherize(node, getInput, nodeId);

      default:
        return null;
    }
  }

  /**
   * Get parameter value with proper type conversion and expression detection
   */
  getParam(node, name, defaultValue) {
    const value = node.params?.[name] ?? defaultValue;
    if (typeof value === 'boolean') return value;
    
    return value; // Return raw value, we'll handle expressions in shader generation
  }

  /**
   * OPTIMIZED: Check if a parameter is a time-based or audio expression
   */
  isTimeExpression(value) {
    if (typeof value === 'string') {
      return value.includes('time') || value.includes('audioEnvelope') || value.startsWith('=');
    }
    return false;
  }

  /**
   * OPTIMIZED: Generate shader expression for parameter
   * PERFORMANCE FIX: Now registers parameters as uniforms!
   * USE UNIFIED AST SYSTEM - ensures shader matches CPU evaluation exactly
   */
getShaderParam(node, name, defaultValue) {
  const value = this.getParam(node, name, defaultValue);

  // Handle expressions with = prefix (like "=audioEnvelope*5")
  if (typeof value === 'string' && value.startsWith('=')) {
    try {
      return unifiedExpressionSystem.generateShader(value);
    } catch (error) {

      return String(defaultValue);
    }
  }

  // Handle expressions without = prefix (like "time" or "audioEnvelope*2")
  if (typeof value === 'string' && (/\btime\b/.test(value) || /audioEnvelope/.test(value))) {
    try {
      return unifiedExpressionSystem.generateShader(value);
    } catch (error) {

      return String(defaultValue);
    }
  }

  // PERFORMANCE FIX: Register numeric parameters as uniforms!
  if (this.uniformManager) {
    let numValue = typeof value === 'number' ? value : parseFloat(value);

    if (isNaN(numValue)) {
      numValue = typeof defaultValue === 'number' ? defaultValue : parseFloat(defaultValue) || 0.0;
    }

    if (!isFinite(numValue)) {
      numValue = 0.0;
    }

    // Register with uniform manager
    const paramKey = `${node.id}.${name}`;
    this.uniformManager.uniformValues.set(paramKey, numValue);

    // Generate uniform reference
    const sanitizedKey = paramKey.replace(/[^a-zA-Z0-9_]/g, '_');
    const fieldName = sanitizedKey.startsWith('_') ? sanitizedKey : `_${sanitizedKey}`;
    return `u_params.${fieldName}`;
  }

  // Fallback
  if (typeof value === 'number') {
    return value.toString();
  }

  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue.toString() : parsed.toString();
}

  /**
   * OPTIMIZED: Compile full 2D transformation with GPU-side calculations
   */
  compileOptimizedTransform2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");

    const translateX = this.getShaderParam(node, 'translateX', 0.0);
    const translateY = this.getShaderParam(node, 'translateY', 0.0);
    const scaleX = this.getShaderParam(node, 'scaleX', 1.0);
    const scaleY = this.getShaderParam(node, 'scaleY', 1.0);
    const rotationDeg = this.getShaderParam(node, 'rotation', 0.0);
    const centerX = this.getShaderParam(node, 'centerX', 0.5);
    const centerY = this.getShaderParam(node, 'centerY', 0.5);

    // Convert rotation from degrees to radians
    let rotation;
    const isUniformRef = typeof rotationDeg === 'string' && rotationDeg.includes('u_params.');
    if (isUniformRef) {
      // If it's a uniform reference, add conversion in shader
      rotation = `(${rotationDeg} * ${Math.PI / 180})`;
    } else {
      const rotDegValue = parseFloat(rotationDeg);
      if (!isNaN(rotDegValue)) {
        // Static numeric value - convert now
        rotation = (rotDegValue * Math.PI / 180).toString();
      } else {
        // Expression - add conversion wrapper
        rotation = `(${rotationDeg} * ${Math.PI / 180})`;
      }
    }

    // OPTIMIZATION: Check if rotation is static AND numeric (not a uniform reference)
    const isStaticRotation = !this.isTimeExpression(node.params?.rotation);
    const rotationValue = parseFloat(rotation);
    const canPreCalculate = isStaticRotation && !isUniformRef && !isNaN(rotationValue);

    let line;
    if (canPreCalculate && rotationValue === 0.0) {
      // FAST PATH: No rotation, just scale and translate
      line = `
  // Transform2D node_${nodeId} (optimized - no rotation)
  var uv_${nodeId} = ${uv};
  uv_${nodeId} = (uv_${nodeId} - vec2<f32>(${centerX}, ${centerY})) * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${centerX}, ${centerY});
  let node_${nodeId} = uv_${nodeId} + vec2<f32>(${translateX}, ${translateY});`;
    } else if (canPreCalculate) {
      // MEDIUM PATH: Static rotation, pre-calculate trig
      const cos_r = Math.cos(rotationValue);
      const sin_r = Math.sin(rotationValue);

      line = `
  // Transform2D node_${nodeId} (optimized - static rotation)
  var uv_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  uv_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * ${cos_r} - uv_${nodeId}.y * ${sin_r},
    uv_${nodeId}.x * ${sin_r} + uv_${nodeId}.y * ${cos_r}
  ) * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${centerX}, ${centerY});
  let node_${nodeId} = uv_${nodeId} + vec2<f32>(${translateX}, ${translateY});`;
    } else {
      // SLOW PATH: Dynamic rotation or uniform, calculate on GPU
      line = `
  // Transform2D node_${nodeId} (dynamic rotation)
  var uv_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let rot_${nodeId} = ${rotation};
  let cos_${nodeId} = cos(rot_${nodeId});
  let sin_${nodeId} = sin(rot_${nodeId});
  uv_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * cos_${nodeId} - uv_${nodeId}.y * sin_${nodeId},
    uv_${nodeId}.x * sin_${nodeId} + uv_${nodeId}.y * cos_${nodeId}
  ) * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${centerX}, ${centerY});
  let node_${nodeId} = uv_${nodeId} + vec2<f32>(${translateX}, ${translateY});`;
    }

    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * OPTIMIZED: Compile 2D rotation with GPU-side calculations
   */
  compileOptimizedRotate2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");

    const rotationDeg = this.getShaderParam(node, 'rotation', 0.0);
    const centerX = this.getShaderParam(node, 'centerX', 0.5);
    const centerY = this.getShaderParam(node, 'centerY', 0.5);

    // Convert rotation from degrees to radians
    let rotation;
    const isUniformRef = typeof rotationDeg === 'string' && rotationDeg.includes('u_params.');
    if (isUniformRef) {
      // If it's a uniform reference, add conversion in shader
      rotation = `(${rotationDeg} * ${Math.PI / 180})`;
    } else {
      const rotDegValue = parseFloat(rotationDeg);
      if (!isNaN(rotDegValue)) {
        // Static numeric value - convert now
        rotation = (rotDegValue * Math.PI / 180).toString();
      } else {
        // Expression - add conversion wrapper
        rotation = `(${rotationDeg} * ${Math.PI / 180})`;
      }
    }

    // OPTIMIZATION: Check if rotation is static AND numeric (not a uniform reference)
    const isStaticRotation = !this.isTimeExpression(node.params?.rotation);
    const rotationValue = parseFloat(rotation);
    const canPreCalculate = isStaticRotation && !isUniformRef && !isNaN(rotationValue);

    let line;
    if (canPreCalculate && rotationValue === 0.0) {
      // FAST PATH: No rotation
      line = `let node_${nodeId} = ${uv};`;
    } else if (canPreCalculate) {
      // MEDIUM PATH: Static rotation
      const cos_r = Math.cos(rotationValue);
      const sin_r = Math.sin(rotationValue);

      line = `
  // Rotate2D node_${nodeId} (static)
  var uv_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let node_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * ${cos_r} - uv_${nodeId}.y * ${sin_r},
    uv_${nodeId}.x * ${sin_r} + uv_${nodeId}.y * ${cos_r}
  ) + vec2<f32>(${centerX}, ${centerY});`;
    } else {
      // SLOW PATH: Dynamic rotation or uniform
      line = `
  // Rotate2D node_${nodeId} (dynamic)
  var uv_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let rot_${nodeId} = ${rotation};
  let cos_${nodeId} = cos(rot_${nodeId});
  let sin_${nodeId} = sin(rot_${nodeId});
  let node_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * cos_${nodeId} - uv_${nodeId}.y * sin_${nodeId},
    uv_${nodeId}.x * sin_${nodeId} + uv_${nodeId}.y * cos_${nodeId}
  ) + vec2<f32>(${centerX}, ${centerY});`;
    }

    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * OPTIMIZED: Compile 2D scale transformation
   */
  compileScale2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const scaleX = this.getShaderParam(node, 'scaleX', 1.0);
    const scaleY = this.getShaderParam(node, 'scaleY', 1.0);
    const centerX = this.getShaderParam(node, 'centerX', 0.5);
    const centerY = this.getShaderParam(node, 'centerY', 0.5);

    // OPTIMIZATION: Check if it's just identity scaling
    if (scaleX === '1.0' && scaleY === '1.0') {
      return {
        line: `let node_${nodeId} = ${uv};`,
        outputType: "vec2"
      };
    }

    const line = `let node_${nodeId} = (${uv} - vec2<f32>(${centerX}, ${centerY})) * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${centerX}, ${centerY});`;

    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * OPTIMIZED: Compile tile and offset transformation
   */
  compileTileAndOffset(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const tilingX = this.getShaderParam(node, 'tilingX', 1.0);
    const tilingY = this.getShaderParam(node, 'tilingY', 1.0);
    const offsetX = this.getShaderParam(node, 'offsetX', 0.0);
    const offsetY = this.getShaderParam(node, 'offsetY', 0.0);

    // OPTIMIZATION: Check if it's identity transform
    if (tilingX === '1.0' && tilingY === '1.0' && offsetX === '0.0' && offsetY === '0.0') {
      return {
        line: `let node_${nodeId} = ${uv};`,
        outputType: "vec2"
      };
    }

 const line = `
let node_${nodeId} = fract(${uv} * vec2<f32>(${tilingX}, ${tilingY}) + vec2<f32>(${offsetX}, ${offsetY}));
`;


    return {
      line,
      outputType: "vec2"
    };
  }

  /**
   * Compile UV to color conversion
   */
  compileUVToColor(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const line = `let node_${nodeId} = vec3<f32>(${uv}.x, ${uv}.y, 0.0);`;
    return {
      line,
      outputType: "vec3"
    };
  }

  /**
   * OPTIMIZED: Compile 2D flip transformation
   */
  compileFlip2D(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    
    const flipX = this.getParam(node, 'flipX', false);
    const flipY = this.getParam(node, 'flipY', false);

    // OPTIMIZATION: Check if no flipping
    if (!flipX && !flipY) {
      return {
        line: `let node_${nodeId} = ${uv};`,
        outputType: "vec2"
      };
    }

    const scaleX = flipX ? -1.0 : 1.0;
    const scaleY = flipY ? -1.0 : 1.0;
    const offsetX = flipX ? 1.0 : 0.0;
    const offsetY = flipY ? 1.0 : 0.0;

    const line = `let node_${nodeId} = ${uv} * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${offsetX}, ${offsetY});`;

    return {
      line,
      outputType: "vec2"
    };
  }
compileTwirl(node, getInput, nodeId) {
  const inputResult = getInput(0, "vec2", "in.uv");
  const input = (typeof inputResult === 'object' && inputResult !== null ? inputResult.code : inputResult) || "in.uv";
  const centerX = this.getShaderParam(node, "centerX", 0.5);
  const centerY = this.getShaderParam(node, "centerY", 0.5);
  const strength = this.getShaderParam(node, "strength", 1.0);
  const radius = this.getShaderParam(node, "radius", 0.5);

  const line = `
let p_${nodeId} = ${input} - vec2<f32>(${centerX}, ${centerY});
let r_${nodeId} = length(p_${nodeId});
let a_${nodeId} = atan2(p_${nodeId}.y, p_${nodeId}.x);
let t_${nodeId} = smoothstep(${radius}, 0.0, r_${nodeId}) * ${strength};
let twirled_${nodeId} = vec2<f32>(
  cos(a_${nodeId} + t_${nodeId}),
  sin(a_${nodeId} + t_${nodeId})
) * r_${nodeId};
let node_${nodeId} = clamp(twirled_${nodeId} + vec2<f32>(${centerX}, ${centerY}),
                           vec2<f32>(0.0), vec2<f32>(1.0));`;

  return { line, outputType: "vec2" };
}

compileSpherize(node, getInput, nodeId) {
  const inputResult = getInput(0, "vec2", "in.uv");
  const input = (typeof inputResult === 'object' && inputResult !== null ? inputResult.code : inputResult) || "in.uv";
  const centerX = this.getShaderParam(node, "centerX", 0.5);
  const centerY = this.getShaderParam(node, "centerY", 0.5);
  const strength = this.getShaderParam(node, "strength", 0.5);
  const radius = this.getShaderParam(node, "radius", 0.5);

const line = `
var p_${nodeId} = ${input} - vec2<f32>(${centerX}, ${centerY});
let r_${nodeId} = length(p_${nodeId});
let factor_${nodeId} = clamp(r_${nodeId} / ${radius}, 0.0, 1.0);
p_${nodeId} *= mix(1.0, 1.0 - ${strength}, factor_${nodeId} * factor_${nodeId});
let node_${nodeId} = clamp(p_${nodeId} + vec2<f32>(${centerX}, ${centerY}),
                           vec2<f32>(0.0), vec2<f32>(1.0));`;

  return { line, outputType: "vec2" };
}


}
