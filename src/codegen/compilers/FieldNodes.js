// src/codegen/compilers/FieldNodes.js
// FIXED: Aspect-ratio aware shape functions

import { UnifiedParameterHandler } from '../../parameters/UnifiedParameterHandler.js';

export class FieldNodes {
  constructor() {
    this.uniformManager = null;
    this.paramHandler = new UnifiedParameterHandler();
    this.functionDefinitions = new Map();
  }

setUniformManager(manager) {
  this.uniformManager = manager;
  // Clear function cache when uniform manager changes
  this.functionDefinitions.clear();
  console.log('✅ Cleared FieldNodes function cache on uniform manager update');
}
  setExpressionSystem(expressionSystem) {
    this.paramHandler.setExpressionSystem(expressionSystem);
  }

  handles(kind) {
    return [
      'LinearGradient', 'RadialGradient', 'AngularGradient', 'ConicGradient',
      'ColorRamp', 'Checker', 'Stripe', 'Circle', 'Rectangle', 'Polygon',
      'Worley', 'CellNoise'
    ].includes(kind);
  }

  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    if (this.uniformManager) {
      this.uniformManager.analyzeNode(node);
    }
    
    const isShapeNode = ['Circle', 'Rectangle', 'Polygon'].includes(node.kind);
    
    if (isShapeNode) {
      return this.compileShapeFunction(node, getInput, nodeId);
    }
    
    switch (node.kind) {
            case 'Stripe':
        return this.compileStripe(node, getInput, nodeId);
      case 'Checker':
        return this.compileChecker(node, getInput, nodeId);

      case 'LinearGradient':
        return this.compileLinearGradient(node, getInput, nodeId);
      case 'RadialGradient':
        return this.compileRadialGradient(node, getInput, nodeId);
      case 'AngularGradient':
        return this.compileAngularGradient(node, getInput, nodeId);
      case 'ConicGradient':
        return this.compileConicGradient(node, getInput, nodeId);
      case 'ColorRamp':
        return this.compileColorRamp(node, getInput, nodeId);
      default:
        return null;
    }
  }

  compileShapeFunction(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const functionName = `shape_${node.kind.toLowerCase()}_${nodeId}`;
    
    if (!this.functionDefinitions.has(nodeId)) {
      let functionDef;
      
      switch (node.kind) {
        case 'Circle':
          functionDef = this.generateCircleFunction(node, nodeId, functionName);
          break;
        case 'Rectangle':
          functionDef = this.generateRectangleFunction(node, nodeId, functionName);
          break;
        case 'Polygon':
          functionDef = this.generatePolygonFunction(node, nodeId, functionName);
          break;
      }
      
      this.functionDefinitions.set(nodeId, functionDef);
    }
    
    const line = `
  let node_${nodeId} = ${functionName}(${uv});`;
    
    return {
      line,
      outputType: "f32",
      functionDef: this.functionDefinitions.get(nodeId),
      functionName
    };
  }

  /**
   * FIXED: Circle function now aspect-ratio aware
   */
  generateCircleFunction(node, nodeId, functionName) {
    const radius = this.getParam(node, 'radius', 0.25);
    console.log('Circle radius param for node', nodeId, ':', radius);
    const epsilon = this.getParam(node, 'epsilon', 0.02);
    
    return `fn ${functionName}(uv: vec2<f32>) -> f32 {
  // Aspect-corrected UV
  var aspectUV = uv;
  aspectUV.x *= res.aspect;
  let aspectCenter = vec2<f32>(0.5 * res.aspect, 0.5);
  
  let dist = length(aspectUV - aspectCenter) - ${radius};
  return 1.0 - smoothstep(-${epsilon}, ${epsilon}, dist);
}`;
  }

  /**
   * FIXED: Rectangle function now aspect-ratio aware
   */
generateRectangleFunction(node, nodeId, functionName) {
  const centerX = this.getParam(node, 'centerX', 0.5);
  const centerY = this.getParam(node, 'centerY', 0.5);
  const width = this.getParam(node, 'width', 0.5);
  const height = this.getParam(node, 'height', 0.5);
  const epsilon = this.getParam(node, 'epsilon', 0.02);
  
  return `fn ${functionName}(uv: vec2<f32>) -> f32 {
  var aspectUV = uv;
  aspectUV.x *= res.aspect;
  
  let center = vec2<f32>(0.5 * res.aspect, 0.5);
  
  let d = abs(aspectUV - center) - vec2<f32>(${width}, ${height}) * 0.5;
  let dist = length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-${epsilon}, ${epsilon}, dist);
}`;
}
  /**
   * FIXED: Polygon function now aspect-ratio aware
   */
  generatePolygonFunction(node, nodeId, functionName) {
    const sides = this.getParam(node, 'sides', 6);
    const radius = this.getParam(node, 'radius', 0.25);
    const epsilon = this.getParam(node, 'epsilon', 0.02);
    
    return `fn ${functionName}(uv: vec2<f32>) -> f32 {
  // Aspect-corrected UV
  var aspectUV = uv;
  aspectUV.x *= res.aspect;
  let aspectCenter = vec2<f32>(0.5 * res.aspect, 0.5);
  
  let p = aspectUV - aspectCenter;
  let a = atan2(p.y, p.x);
  let r = length(p);
  let n = ${sides};
  let an = 3.14159265 / n;
  let segment = floor(0.5 + a / (2.0 * an));
  let angle = a - 2.0 * an * segment;
  let dist = r * cos(angle) - ${radius};
  return 1.0 - smoothstep(-${epsilon}, ${epsilon}, dist);
}`;
  }

  getAllFunctionDefinitions() {
    return Array.from(this.functionDefinitions.values()).join('\n\n');
  }

clearFunctionCache() {
  this.functionDefinitions.clear();
  console.log('🧹 FieldNodes function cache cleared');
}

getParam(node, paramName, defaultValue) {
  const rawValue = node.params?.[paramName] ?? defaultValue;
  
  // Check if this is a dynamic expression containing 'time'
  if (typeof rawValue === 'string' && /time/.test(rawValue)) {
    // Convert the expression to shader code using u.time
    const shaderExpr = rawValue
      .replace(/\bsin\(/g, 'sin(')
      .replace(/\bcos\(/g, 'cos(')
      .replace(/\btime\b/g, 'u.time');
    
    return shaderExpr;  // Return shader code, not a uniform reference
  }
  
  const uniformName = this.uniformManager?.isDynamicParam(node.id, paramName)
    ? this.uniformManager.getUniformName(node.id, paramName)
    : null;
  
  if (uniformName) {
    const sanitizedKey = `${node.id}.${paramName}`.replace(/[^a-zA-Z0-9_]/g, '_');
    const fieldName = sanitizedKey.startsWith('_') ? sanitizedKey : `_${sanitizedKey}`;
    return `u_params.${fieldName}`;
  }
  
  // For static params, evaluate and return the value
  const result = this.paramHandler.toShaderCode(node.kind, paramName, rawValue, uniformName);
  
  if (typeof result === 'number') {
    return result === Math.floor(result) ? `${result}.0` : result.toString();
  }
  
  return result;
}

  compileLinearGradient(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const angle = this.getParam(node, 'angle', 0.0);
    const offset = this.getParam(node, 'offset', 0.0);
    const scale = this.getParam(node, 'scale', 1.0);
    const repeat = this.getParam(node, 'repeat', false);
    
    const line = `
  let dir_${nodeId} = vec2<f32>(cos(${angle}), sin(${angle}));
  let proj_${nodeId} = dot(${uv} - vec2<f32>(0.5), dir_${nodeId}) * ${scale} + ${offset};
  let node_${nodeId} = ${repeat ? `fract(proj_${nodeId})` : `proj_${nodeId}`};`;
    
    return { line, outputType: "f32" };
  }

  compileRadialGradient(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const radius = this.getParam(node, 'radius', 0.5);
    const repeat = this.getParam(node, 'repeat', false);
    
    const radiusStr = typeof radius === 'string' && /[+\-*/]/.test(radius) 
      ? `(${radius})` 
      : radius;
    
    const line = `
  let center_${nodeId} = vec2<f32>(${centerX}, ${centerY});
  let dist_${nodeId} = length(${uv} - center_${nodeId}) / ${radiusStr};
  let node_${nodeId} = ${repeat ? `fract(dist_${nodeId})` : `dist_${nodeId}`};`;
    
    return { line, outputType: "f32" };
  }

  compileAngularGradient(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const rotation = this.getParam(node, 'rotation', 0.0);
    const repeat = this.getParam(node, 'repeat', 1.0);
    
    const line = `
  let dir_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let angle_${nodeId} = atan2(dir_${nodeId}.y, dir_${nodeId}.x) + ${rotation};
  let node_${nodeId} = fract((angle_${nodeId} / 6.28318530718) * ${repeat});`;
    
    return { line, outputType: "f32" };
  }

  compileConicGradient(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const rotation = this.getParam(node, 'rotation', 0.0);
    const repeat = this.getParam(node, 'repeat', 1.0);
    
    const line = `
  let dir_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let angle_${nodeId} = atan2(dir_${nodeId}.y, dir_${nodeId}.x) + ${rotation};
  let normalized_${nodeId} = (angle_${nodeId} + 3.14159265359) / 6.28318530718;
  let node_${nodeId} = fract(normalized_${nodeId} * ${repeat});`;
    
    return { line, outputType: "f32" };
  }

  compileColorRamp(node, getInput, nodeId) {
    const input = getInput(0, "f32", "0.0");
    
    const stops = node.params?.stops || [
      { position: 0, color: [0, 0, 0, 1] },
      { position: 1, color: [1, 1, 1, 1] }
    ];
    
    const sortedStops = [...stops]
      .filter(s => s && s.color && Array.isArray(s.color) && typeof s.position === 'number')
      .sort((a, b) => a.position - b.position);
    
    if (sortedStops.length === 0) {
      return { line: `let node_${nodeId} = vec3<f32>(0.0);`, outputType: "vec3" };
    }
    
    if (sortedStops.length === 1) {
      const r = sortedStops[0].color[0].toFixed(6);
      const g = sortedStops[0].color[1].toFixed(6);
      const b = sortedStops[0].color[2].toFixed(6);
      return { line: `let node_${nodeId} = vec3<f32>(${r}, ${g}, ${b});`, outputType: "vec3" };
    }
    
    let line = `
  var ramp_t_${nodeId} = clamp(${input}, 0.0, 1.0);
  var node_${nodeId}: vec3<f32>;
`;
    
    for (let i = 0; i < sortedStops.length - 1; i++) {
      const s1 = sortedStops[i];
      const s2 = sortedStops[i + 1];
      
      const r1 = s1.color[0].toFixed(6);
      const g1 = s1.color[1].toFixed(6);
      const b1 = s1.color[2].toFixed(6);
      
      const r2 = s2.color[0].toFixed(6);
      const g2 = s2.color[1].toFixed(6);
      const b2 = s2.color[2].toFixed(6);
      
      const pos1 = s1.position.toFixed(6);
      const pos2 = s2.position.toFixed(6);
      const range = Math.max(s2.position - s1.position, 0.000001);
      
      const cond = i === 0 ? 'if' : 'else if';
      
      line += `  ${cond} (ramp_t_${nodeId} <= ${pos2}) {
    let t = (ramp_t_${nodeId} - ${pos1}) / ${range.toFixed(6)};
    node_${nodeId} = mix(vec3<f32>(${r1}, ${g1}, ${b1}), vec3<f32>(${r2}, ${g2}, ${b2}), t);
  }`;
    }
    
    const last = sortedStops[sortedStops.length - 1];
    const rL = last.color[0].toFixed(6);
    const gL = last.color[1].toFixed(6);
    const bL = last.color[2].toFixed(6);
    
    line += ` else {
    node_${nodeId} = vec3<f32>(${rL}, ${gL}, ${bL});
  }`;
    
    return { line, outputType: "vec3" };
  }
    compileStripe(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const freq = this.getParam(node, "frequency", 5.0);
    const angle = this.getParam(node, "angle", 0.0);
    const thickness = this.getParam(node, "thickness", 0.5);
    const smooth = this.getParam(node, "smoothness", 0.0);

    const fnName = `stripe_${nodeId}`;
const fn = `
fn ${fnName}(uv: vec2<f32>, scaleX: f32, scaleY: f32, smoothness: f32) -> f32 {
  let s = floor(uv.x * scaleX);
  let t = floor(uv.y * scaleY);
  let checker = abs(fract((s + t) * 0.5) * 2.0 - 1.0);
  return smoothstep(0.0, 1.0 - smoothness, checker);
}`;

    const line = `let node_${nodeId} = ${fnName}(${uv}, ${freq}, ${angle}, ${thickness}, ${smooth});`;

    this.functionDefinitions.set(nodeId, fn);
    return { line, outputType: "f32", functionDef: fn, functionName: fnName };
  }

compileChecker(node, getInput, nodeId) {
  const uv = getInput(0, "vec2", "in.uv");
  const scaleX = this.getParam(node, "scaleX", 8.0);
  const scaleY = this.getParam(node, "scaleY", 8.0);
  const smoothness = this.getParam(node, "smoothness", 0.0);

  const fnName = `checker_${nodeId}`;
const fn = `
fn ${fnName}(uv: vec2<f32>, scaleX: f32, scaleY: f32, smoothness: f32) -> f32 {
  let s = floor(uv.x * scaleX);
  let t = floor(uv.y * scaleY);
  let checker = abs(fract((s + t) * 0.5) * 2.0 - 1.0);
  return smoothstep(0.0, 1.0 - smoothness, checker);
}`;

  const line = `let node_${nodeId} = ${fnName}(${uv}, ${scaleX}, ${scaleY}, ${smoothness});`;

  this.functionDefinitions.set(nodeId, fn);
  return { line, outputType: "f32", functionDef: fn, functionName: fnName };
}


}