// src/codegen/compilers/FieldNodes.js
import { UnifiedParameterHandler } from '../../parameters/UnifiedParameterHandler.js';

export class FieldNodes {
  constructor() {
    this.uniformManager = null;
    this.paramHandler = new UnifiedParameterHandler();
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

  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    // Analyze node for dynamic parameters
    if (this.uniformManager) {
      this.uniformManager.analyzeNode(node);
    }
    
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
      case 'Circle':
        return this.compileCircle(node, getInput, nodeId);
      case 'Rectangle':
        return this.compileRectangle(node, getInput, nodeId);
      default:
        return null;
    }
  }

  /**
   * Get parameter value - uses unified parameter handler
   */
// In FieldNodes.js - remove the normalization I suggested
getParam(node, paramName, defaultValue) {
  const rawValue = node.params?.[paramName] ?? defaultValue;
  
  const uniformName = this.uniformManager?.isDynamicParam(node.id, paramName)
    ? this.uniformManager.getUniformName(node.id, paramName)
    : null;
  
  if (uniformName) {
    return `params.${uniformName}`;
  }
  
  const result = this.paramHandler.toShaderCode(node.kind, paramName, rawValue, uniformName);
  
  // Ensure numbers are formatted as WGSL floats
  if (typeof result === 'number') {
    return result === Math.floor(result) ? `${result}.0` : result.toString();
  }
  
  return result;
}

  // Gradient compile methods - these stay the same, just use getParam()
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
  
  // Wrap radius in parentheses if it's a complex expression
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

  compileCircle(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const radius = this.getParam(node, 'radius', 0.25);
    const epsilon = this.getParam(node, 'epsilon', 0.02);
    
    const line = `
  let dist_${nodeId} = length(${uv} - vec2<f32>(0.5)) - ${radius};
  let node_${nodeId} = 1.0 - smoothstep(-${epsilon}, ${epsilon}, dist_${nodeId});`;
    
    return { line, outputType: "f32" };
  }

compileRectangle(node, getInput, nodeId) {
  const uv = getInput(0, "vec2", "in.uv");
  const centerX = this.getParam(node, 'centerX', 0.5);
  const centerY = this.getParam(node, 'centerY', 0.5);
  const width = this.getParam(node, 'width', 0.5);
  const height = this.getParam(node, 'height', 0.5);
  const epsilon = this.getParam(node, 'epsilon', 0.02);
  
  console.log('Rectangle params:', { centerX, centerY, width, height, epsilon });
  
  const line = `
  let d_${nodeId} = abs(${uv} - vec2<f32>(${centerX}, ${centerY})) - vec2<f32>(${width}, ${height}) * 0.5;
  let dist_${nodeId} = length(max(d_${nodeId}, vec2<f32>(0.0))) + min(max(d_${nodeId}.x, d_${nodeId}.y), 0.0);
  let node_${nodeId} = 1.0 - smoothstep(-${epsilon}, ${epsilon}, dist_${nodeId});`;
  
  console.log('Rectangle generated line:', line);
  
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
  
  // Multi-stop gradient with proper interpolation
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
  
  // Beyond last stop
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