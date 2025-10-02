// src/codegen/compilers/FieldNodes.js
// REFACTORED: Function-based shape compilation for reusability

import { UnifiedParameterHandler } from '../../parameters/UnifiedParameterHandler.js';

export class FieldNodes {
  constructor() {
    this.uniformManager = null;
    this.paramHandler = new UnifiedParameterHandler();
    this.functionDefinitions = new Map(); // Track generated functions
  }

  setUniformManager(manager) {
    this.uniformManager = manager;
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

  /**
   * Main compile method - now returns both inline code AND function definition
   * Shape nodes return { line, outputType, functionDef, functionCall }
   * Non-shape nodes return { line, outputType }
   */
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    if (this.uniformManager) {
      this.uniformManager.analyzeNode(node);
    }
    
    // Determine if this is a shape node (returns distance field)
    const isShapeNode = ['Circle', 'Rectangle', 'Polygon'].includes(node.kind);
    
    if (isShapeNode) {
      return this.compileShapeFunction(node, getInput, nodeId);
    }
    
    // Gradients and other field nodes compile inline as before
    switch (node.kind) {
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

  /**
   * NEW: Compile shape nodes as reusable functions
   */
  compileShapeFunction(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const functionName = `shape_${node.kind.toLowerCase()}_${nodeId}`;
    
    // Check if function already generated
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
    
    // Return both the function call (for inline use) and the function definition
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
   * Generate Circle shape function
   */
  generateCircleFunction(node, nodeId, functionName) {
    const radius = this.getParam(node, 'radius', 0.25);
    const epsilon = this.getParam(node, 'epsilon', 0.02);
    
    return `fn ${functionName}(uv: vec2<f32>) -> f32 {
  let dist = length(uv - vec2<f32>(0.5)) - ${radius};
  return 1.0 - smoothstep(-${epsilon}, ${epsilon}, dist);
}`;
  }

  /**
   * Generate Rectangle shape function
   */
  generateRectangleFunction(node, nodeId, functionName) {
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const width = this.getParam(node, 'width', 0.5);
    const height = this.getParam(node, 'height', 0.5);
    const epsilon = this.getParam(node, 'epsilon', 0.02);
    
    return `fn ${functionName}(uv: vec2<f32>) -> f32 {
  let d = abs(uv - vec2<f32>(${centerX}, ${centerY})) - vec2<f32>(${width}, ${height}) * 0.5;
  let dist = length(max(d, vec2<f32>(0.0))) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-${epsilon}, ${epsilon}, dist);
}`;
  }

  /**
   * Generate Polygon shape function
   */
  generatePolygonFunction(node, nodeId, functionName) {
    const sides = this.getParam(node, 'sides', 6);
    const radius = this.getParam(node, 'radius', 0.25);
    const epsilon = this.getParam(node, 'epsilon', 0.02);
    
    return `fn ${functionName}(uv: vec2<f32>) -> f32 {
  let p = uv - vec2<f32>(0.5);
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

  /**
   * Get all function definitions for insertion into shader
   */
  getAllFunctionDefinitions() {
    return Array.from(this.functionDefinitions.values()).join('\n\n');
  }

  /**
   * Clear function cache (call between compilations)
   */
  clearFunctionCache() {
    this.functionDefinitions.clear();
  }

  getParam(node, paramName, defaultValue) {
    const rawValue = node.params?.[paramName] ?? defaultValue;
    
    const uniformName = this.uniformManager?.isDynamicParam(node.id, paramName)
      ? this.uniformManager.getUniformName(node.id, paramName)
      : null;
    
    if (uniformName) {
      return `params.${uniformName}`;
    }
    
    const result = this.paramHandler.toShaderCode(node.kind, paramName, rawValue, uniformName);
    
    if (typeof result === 'number') {
      return result === Math.floor(result) ? `${result}.0` : result.toString();
    }
    
    return result;
  }

  // Gradient compile methods remain unchanged
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
}