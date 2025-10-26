// src/codegen/compilers/FieldNodes.js
// FIXED: Aspect-ratio aware shape functions

import { UnifiedParameterHandler } from '../../parameters/UnifiedParameterHandler.js';

export class FieldNodes {
  constructor() {
    this.uniformManager = null;
    this.paramHandler = new UnifiedParameterHandler();
    this.functionDefinitions = new Map();
  }

  makeSafeIdentifier(id) {
    return /^[A-Za-z_]/.test(id) ? id : `n_${id}`;
  }

  setUniformManager(manager) {
    this.uniformManager = manager;
    // Clear function cache when uniform manager changes
    this.functionDefinitions.clear();
    console.log('Cleared FieldNodes function cache on uniform manager update');
  }
  setExpressionSystem(expressionSystem) {
    this.paramHandler.setExpressionSystem(expressionSystem);
  }

  handles(kind) {
    return [
      'LinearGradient', 'RadialGradient', 'AngularGradient', 'ConicGradient',
      'ColorRamp', 'Checker', 'Stripe', 'Displacement', 'Circle', 'Rectangle', 'Polygon',
      'Worley', 'CellNoise', 'Kaleidoscope'
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
      case 'Displacement':
        return this.compileDisplacement(node, getInput, nodeId);
        case 'Kaleidoscope':
  return this.compileKaleidoscope(node, getInput, nodeId);

      default:
        return null;
    }
  }
compileKaleidoscope(node, getInput, nodeId) {
  // upstream UV (defaults to in.uv if nothing is connected)
  const uv = getInput(0, "vec2", "in.uv");

  // Use FieldNodes.getParam so uniforms/expressions work correctly
  // segments can be int in UI; we’ll treat it as f32 in WGSL
  const segments   = this.getParam(node, "segments", 6.0);
  const rotation   = this.getParam(node, "angle", 0.0);
  const scale      = this.getParam(node, "scale", 1.0);
  const mirror     = node.params?.mirror ?? true;

  const fnName = `kaleidoscope_${nodeId}`;
  const fn = `
fn ${fnName}(uv: vec2<f32>, segments: f32, rotation: f32, zoom: f32, mirror: bool) -> vec2<f32> {
  // normalize to [-1,1]
  var p = uv * 2.0 - vec2<f32>(1.0, 1.0);

  // optional zoom (scale the radius domain)
  if (zoom != 1.0) {
    p /= zoom;
  }

  let r = length(p);
  let ang = atan2(p.y, p.x) + rotation;

  // stable segment angle (avoid mod on floats)
  let segAngle = 6.283185307179586 / segments;
  let k = floor(ang / segAngle);
  var a = ang - k * segAngle;   // ang % segAngle

  // mirror every other wedge
  if (mirror && a > segAngle * 0.5) {
    a = segAngle - a;
  }

  let x = r * cos(a);
  let y = r * sin(a);

  // back to [0,1]
  return vec2<f32>(x, y) * 0.5 + vec2<f32>(0.5, 0.5);
}`;

  // register function so it’s emitted once
  this.functionDefinitions.set(fnName, fn);

  // ensure segments is f32 in shader (FieldNodes.getParam can return a string expression already)
  const segExpr = typeof segments === 'string' ? `(${segments})` : segments;
  const rotExpr = typeof rotation === 'string' ? `(${rotation})` : rotation;
  const sclExpr = typeof scale === 'string' ? `(${scale})` : scale;

  const line = `let node_${nodeId} = ${fnName}(${uv}, f32(${segExpr}), ${rotExpr}, ${sclExpr}, ${mirror});`;

  return { line, outputType: "vec2", functionDef: fn, functionName: fnName };
}


  compileShapeFunction(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const functionName = `shape_${node.kind.toLowerCase()}_${nodeId}`;
    
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
    
    const scale = this.getParam(node, 'scale', 1.0);
    const safeId = this.makeSafeIdentifier(nodeId);

    return `fn ${functionName}(uv: vec2<f32>) -> f32 {
  // Domain + aspect: measure distances in aspect space (x in [0, u.aspect], y in [0, 1])
  let ${safeId}_uv01 = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  var ${safeId}_uvA = ${safeId}_uv01;
  ${safeId}_uvA.x *= u.aspect;

  let ${safeId}_ctr = vec2<f32>(0.5 * u.aspect, 0.5);
  // Zoom semantics: larger 'scale' => larger circle (scale radius, do NOT invert coords)
  let ${safeId}_r = clamp(${radius}, 0.0, 2.0) * max(${scale}, 0.0);
  let ${safeId}_eps = max(${epsilon}, 1e-4);

  let ${safeId}_dist = length(${safeId}_uvA - ${safeId}_ctr) - ${safeId}_r;
  return 1.0 - smoothstep(-${safeId}_eps, ${safeId}_eps, ${safeId}_dist);
}`;
  }

  /**
   * FIXED: Rectangle function now aspect-ratio aware
   */
generateRectangleFunction(node, nodeId, functionName) {
  const width = this.getParam(node, 'width', 0.5);
  const height = this.getParam(node, 'height', 0.5);
  const centerX = this.getParam(node, 'centerX', 0.5);
  const centerY = this.getParam(node, 'centerY', 0.5);
  const scale = this.getParam(node, 'scale', 1.0);
  const rotation = this.getParam(node, 'rotation', 0.0);
  const epsilon = this.getParam(node, 'epsilon', 0.02);
  const safeId = this.makeSafeIdentifier(nodeId);

  return `fn ${functionName}(uv: vec2<f32>) -> f32 {
  // Distances in aspect space
  let ${safeId}_uv01 = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
  var ${safeId}_uvA = ${safeId}_uv01;
  ${safeId}_uvA.x *= u.aspect;

  // center in aspect space
  let ${safeId}_ctr = vec2<f32>(
    clamp(${centerX}, 0.0, 1.0) * u.aspect,
    clamp(${centerY}, 0.0, 1.0)
  );
  // size in aspect space (no additional aspect scaling needed)
  var ${safeId}_half = clamp(
    vec2<f32>(${width}, ${height}),
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  ) * 0.5;
  // Zoom semantics: larger 'scale' => larger rect (scale half-size)
  let ${safeId}_s = max(${scale}, 0.0);
  ${safeId}_half *= ${safeId}_s;

  // rotate delta in aspect space (unique names; avoids clashes)
  var ${safeId}_dp = ${safeId}_uvA - ${safeId}_ctr;
  let ${safeId}_cr = cos(${rotation});
  let ${safeId}_sr = sin(${rotation});
  ${safeId}_dp = vec2<f32>(
    ${safeId}_cr * ${safeId}_dp.x - ${safeId}_sr * ${safeId}_dp.y,
    ${safeId}_sr * ${safeId}_dp.x + ${safeId}_cr * ${safeId}_dp.y
  );

  let ${safeId}_d = abs(${safeId}_dp) - ${safeId}_half;
  let ${safeId}_dist = length(max(${safeId}_d, vec2<f32>(0.0)))
                     + min(max(${safeId}_d.x, ${safeId}_d.y), 0.0);
  let ${safeId}_eps = max(${epsilon}, 1e-4);
  return 1.0 - smoothstep(-${safeId}_eps, ${safeId}_eps, ${safeId}_dist);
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
  aspectUV.x *= u.aspect;
  let aspectCenter = vec2<f32>(0.5 * u.aspect, 0.5);
  
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

  // Check if this is a dynamic expression containing 'time' or 'audioEnvelope'
  if (typeof rawValue === 'string' && (/time/.test(rawValue) || /audioEnvelope/.test(rawValue))) {
  // Convert the expression to shader code using g.time and g.audioEnvelope
    const shaderExpr = rawValue
      .replace(/\bsin\(/g, 'sin(')
      .replace(/\bcos\(/g, 'cos(')
      .replace(/\btime\b/g, 'g.time')
      .replace(/\baudioEnvelope\b/g, 'g.audioEnvelope');

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
  var uvAspect_${nodeId} = ${uv};
  uvAspect_${nodeId}.x *= u.aspect;
  let dir_${nodeId} = vec2<f32>(cos(${angle}), sin(${angle}));
  let proj_${nodeId} = dot(uvAspect_${nodeId} - vec2<f32>(0.5 * u.aspect, 0.5), dir_${nodeId}) * ${scale} + ${offset};
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
  var uvAspect_${nodeId} = ${uv};
  uvAspect_${nodeId}.x *= u.aspect;
  let center_${nodeId} = vec2<f32>(${centerX} * u.aspect, ${centerY});
  let dist_${nodeId} = length(uvAspect_${nodeId} - center_${nodeId}) / ${radiusStr};
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
  var uvAspect_${nodeId} = ${uv};
  uvAspect_${nodeId}.x *= u.aspect;
  let dir_${nodeId} = uvAspect_${nodeId} - vec2<f32>(${centerX} * u.aspect, ${centerY});
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
  var uvAspect_${nodeId} = ${uv};
  uvAspect_${nodeId}.x *= u.aspect;
  let dir_${nodeId} = uvAspect_${nodeId} - vec2<f32>(${centerX} * u.aspect, ${centerY});
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

  compileDisplacement(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const offset = getInput(1, "vec2", "vec2<f32>(0.0)");
    const strengthValue = this.getParam(node, "strength", 0.2);
    const centered = this.getParam(node, "centered", true);
    const wrap = this.getParam(node, "wrap", false);

    const strengthExpr = typeof strengthValue === "string"
      ? `(${strengthValue})`
      : strengthValue.toString();

    const displacementExpr = centered
      ? `(${offset} - vec2<f32>(0.5))`
      : offset;

    const displacedExpr = `${uv} + (${displacementExpr}) * ${strengthExpr}`;
    const finalExpr = wrap
      ? `fract(${displacedExpr})`
      : `clamp(${displacedExpr}, vec2<f32>(0.0), vec2<f32>(1.0))`;

    const line = `let node_${nodeId} = ${finalExpr};`;

    return { line, outputType: "vec2" };
  }


compileChecker(node, getInput, nodeId) {
  const uv = getInput(0, "vec2", "in.uv");

  // Proper parameter extraction via FieldNodes.getParam
  const scaleX = this.getParam(node, "scaleX", 8.0);
  const scaleY = this.getParam(node, "scaleY", 8.0);
  const smooth = this.getParam(node, "smoothness", 0.0);

  const fnName = `checker_${nodeId}`;
  const fn = `
fn ${fnName}(uv: vec2<f32>, scaleX: f32, scaleY: f32, smoothness: f32) -> f32 {
  // Apply aspect correction for square checkers
  var uvAspect = uv;
  uvAspect.x *= u.aspect;
  // scaled coordinates
  let uvScaled = uvAspect * vec2<f32>(scaleX, scaleY);
  // get fractional part
  let f = fract(uvScaled);
  // base pattern
  let base = step(0.5, f.x) + step(0.5, f.y);
  // checker alternates 0/1
  var c = abs(base - 1.0);
  // optional smooth edges
  if (smoothness > 0.0) {
    let edgeX = smoothstep(0.5 - smoothness, 0.5 + smoothness, f.x);
    let edgeY = smoothstep(0.5 - smoothness, 0.5 + smoothness, f.y);
    let mixXY = mix(edgeX, 1.0 - edgeX, step(0.5, f.y));
    c = mix(c, mixXY, smoothness);
  }
  return c;
}`;

  this.functionDefinitions.set(fnName, fn);

  // ensure params become WGSL-compatible expressions
  const sX = typeof scaleX === 'string' ? `(${scaleX})` : scaleX;
  const sY = typeof scaleY === 'string' ? `(${scaleY})` : scaleY;
  const sm = typeof smooth === 'string' ? `(${smooth})` : smooth;

  const line = `let node_${nodeId} = ${fnName}(${uv}, f32(${sX}), f32(${sY}), f32(${sm}));`;

  return { line, outputType: "f32", functionDef: fn, functionName: fnName };
}



compileStripe(node, getInput, nodeId) {
  const uv = getInput(0, "vec2", "in.uv");
  const freq = this.getParam(node, "frequency", 5.0);
  const angle = this.getParam(node, "angle", 0.0);
  const thickness = this.getParam(node, "thickness", 0.5);
  const smoothness = this.getParam(node, "smoothness", 0.0);

  const fnName = `stripe_${nodeId}`;
  const fn = `
fn ${fnName}(uv: vec2<f32>, freq: f32, angle: f32, thickness: f32, smoothness: f32) -> f32 {
  // Apply aspect correction for consistent stripe width
  var uvAspect = uv;
  uvAspect.x *= u.aspect;
  let dir = vec2<f32>(cos(angle), sin(angle));
  let t = dot(uvAspect, dir) * freq;
  let v = abs(fract(t) - 0.5) * 2.0;
  return 1.0 - smoothstep(thickness - smoothness, thickness + smoothness, v);
}`;

  const line = `let node_${nodeId} = ${fnName}(${uv}, ${freq}, ${angle}, ${thickness}, ${smoothness});`;

  this.functionDefinitions.set(fnName, fn);
  return { line, outputType: "f32", functionDef: fn, functionName: fnName };
}




}


