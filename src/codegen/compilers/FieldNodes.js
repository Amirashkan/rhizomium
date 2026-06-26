// src/codegen/compilers/FieldNodes.js
// FIXED: Aspect-ratio aware shape functions

import { UnifiedParameterHandler } from '../../parameters/UnifiedParameterHandler.js';
import { unifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';

export class FieldNodes {
  constructor() {
    this.uniformManager = null;
    this.paramHandler = new UnifiedParameterHandler();
    this.functionDefinitions = new Map();
    // Graph currently being compiled. Used to resolve node references in parameter
    // expressions (e.g. a Mouse node referenced by a Circle's radius) without relying
    // on the ambient window.editor.graph, which is absent in the external viewer.
    this.graph = null;
  }

  setGraph(graph) {
    this.graph = graph;
  }

  setTypeConverter(typeConverter) {
    this.typeConverter = typeConverter;
  }

  /**
   * Format a parameter default as a WGSL float literal, used when an expression
   * cannot be resolved (e.g. an incomplete reference typed by the user).
   */
  _defaultLiteral(defaultValue) {
    const n = typeof defaultValue === 'number' ? defaultValue : parseFloat(defaultValue);
    if (!Number.isFinite(n)) return '0.0';
    return Number.isInteger(n) ? `${n}.0` : `${n}`;
  }

  /**
   * Reduce a WGSL expression of the given type to a scalar (f32). Shape parameters are
   * scalars, so a vector reference must be coerced rather than passed straight in (which
   * produces a "type mismatch ... expected 'f32'" shader error). Mirrors
   * TypeConverter.toF32 so a referenced node behaves like a wired one.
   */
  _toScalar(expr, type) {
    switch (type) {
      case 'vec2': return `((${expr}).x + (${expr}).y) * 0.5`;
      case 'vec3': return `((${expr}).x + (${expr}).y + (${expr}).z) / 3.0`;
      case 'vec4': return `dot((${expr}).xyz, vec3<f32>(0.299, 0.587, 0.114))`;
      default: return expr; // f32 / unknown
    }
  }

  /**
   * Resolve a single `node_<id>` / `node_<id>_<comp>` identifier to a scalar WGSL expression,
   * or null if it cannot be resolved (incomplete/unknown id -> caller falls back to default),
   * or undefined if the identifier is not a node reference at all (e.g. `time`, `PI`).
   *
   * Handles three sources, in order:
   *   1. Mouse/Time/RandomTime input nodes  -> their GPU global (Mouse reduced to one channel).
   *   2. A node already compiled in this pass -> its variable, with component access or scalar
   *      coercion based on the type recorded by the TypeConverter.
   *   3. Anything else (id not in the graph, or present but not compiled) -> null.
   */
  _resolveScalarRef(name) {
    // Lenient suffix capture so a half-typed component (e.g. "node_28_") still resolves
    // instead of falling through to the generator's vec4 default.
    const match = /^node_(\d+)(?:_(.*))?$/.exec(name);
    if (!match) return undefined; // not a node reference
    const id = match[1];
    const suffix = match[2];

    const nodes = this.graph?.nodes || [];
    const node = nodes.find((n) => String(n.id) === id);

    // 1. Live input nodes -> GPU globals.
    const kind = node?.kind?.toLowerCase();
    if (kind === 'time') return 'g.time';
    if (kind === 'randomtime') {
      const speed = Number(node.params?.speed);
      const speedLiteral = Number.isFinite(speed)
        ? (Number.isInteger(speed) ? `${speed}.0` : `${speed}`)
        : '1.0';
      return `fract(sin(g.time * ${speedLiteral} * 12.9898) * 43758.5453)`;
    }
    if (kind === 'mouse') {
      const rgbaToXyzw = { r: 'x', g: 'y', b: 'z', a: 'w' };
      let channel = 'x';
      if (suffix && /^[xyzw]$/.test(suffix)) channel = suffix;
      else if (suffix && /^[rgba]$/.test(suffix)) channel = rgbaToXyzw[suffix];
      return `g.mouse.${channel}`;
    }

    // 2. Regular node already compiled in this pass.
    if (this.typeConverter?.expressions?.has(id)) {
      const expr = this.typeConverter.expressions.get(id);
      const type = this.typeConverter.types.get(id);
      if (suffix && /^[xyzw]$/.test(suffix)) {
        return type === 'f32' ? expr : `(${expr}).${suffix}`;
      }
      return this._toScalar(expr, type);
    }

    // 3. Unknown id (still being typed) or referenced node not compiled in this pass.
    return null;
  }

  /**
   * Build a variable mapping for every `node_<id>` reference in the expression, scalar-coerced
   * for shape parameters. Returns null if any reference cannot be resolved, signalling the
   * caller to fall back to the parameter default instead of emitting invalid WGSL.
   */
  _buildScalarRefMapping(expression) {
    const mapping = {};
    let identifiers;
    try {
      identifiers = unifiedExpressionSystem.extractIdentifiers(expression);
    } catch {
      return mapping;
    }
    for (const name of identifiers) {
      const resolved = this._resolveScalarRef(name);
      if (resolved === undefined) continue; // not a node reference (time/PI/etc.)
      if (resolved === null) return null;    // incomplete/unknown -> fall back to default
      mapping[name] = resolved;
    }
    return mapping;
  }

  makeSafeIdentifier(id) {
    return /^[A-Za-z_]/.test(id) ? id : `n_${id}`;
  }

  setUniformManager(manager) {
    this.uniformManager = manager;
    // Clear function cache when uniform manager changes
    this.functionDefinitions.clear();

  }
  setExpressionSystem(expressionSystem) {
    this.paramHandler.setExpressionSystem(expressionSystem);
  }

  /**
   * Convert angle parameter from degrees to radians
   * Handles both static values and dynamic expressions
   */
  convertDegToRad(angleDeg) {
    const isUniformRef = typeof angleDeg === 'string' && angleDeg.includes('u_params.');
    if (isUniformRef) {
      // If it's a uniform reference, add conversion in shader
      return `(${angleDeg} * ${Math.PI / 180})`;
    }

    const degValue = parseFloat(angleDeg);
    if (!isNaN(degValue)) {
      // Static numeric value - convert now
      return (degValue * Math.PI / 180).toString();
    }

    // Expression - add conversion wrapper
    return `(${angleDeg} * ${Math.PI / 180})`;
  }

  handles(kind) {
    return [
      'ConicGradient',
      'ColorRamp', 'Displacement', 'Circle', 'Rectangle', 'Polygon',
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
      case 'ConicGradient':
        return this.compileConicGradient(node, getInput, nodeId);
      case 'ColorRamp':
        return this.compileColorRamp(node, getInput, nodeId);
      case 'Displacement':
        return this.compileDisplacement(node, getInput, nodeId);

      default:
        return null;
    }
  }
  compileShapeFunction(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const functionName = `shape_${node.kind.toLowerCase()}_${nodeId}`;

    let functionDef;
    let paramExprs = '';

    switch (node.kind) {
      case 'Circle': {
        functionDef = this.generateCircleFunction(node, nodeId, functionName);
        const centerX = this.getParam(node, 'centerX', 0.5);
        const centerY = this.getParam(node, 'centerY', 0.5);
        const radius = this.getParam(node, 'radius', 0.25);
        // FIXED: Use 'epsilon' to match ParameterDefs, fallback to 'smoothness' for compatibility
        const smoothness = this.getParam(node, 'epsilon', this.getParam(node, 'smoothness', 0.01));

        const centerXExpr = typeof centerX === 'string' ? `(${centerX})` : centerX;
        const centerYExpr = typeof centerY === 'string' ? `(${centerY})` : centerY;
        const radiusExpr = typeof radius === 'string' ? `(${radius})` : radius;
        const smoothnessExpr = typeof smoothness === 'string' ? `(${smoothness})` : smoothness;

        paramExprs = `, ${centerXExpr}, ${centerYExpr}, ${radiusExpr}, ${smoothnessExpr}`;
        break;
      }
      case 'Rectangle': {
        functionDef = this.generateRectangleFunction(node, nodeId, functionName);
        const width = this.getParam(node, 'width', 0.5);
        const height = this.getParam(node, 'height', 0.5);
        const centerX = this.getParam(node, 'centerX', 0.5);
        const centerY = this.getParam(node, 'centerY', 0.5);
        // FIXED: Node definition has no 'scale' or 'rotation' parameters, use defaults
        const scale = 1.0;
        const rotation = 0.0;
        // FIXED: Use 'epsilon' to match ParameterDefs, fallback to 'smoothness' for compatibility
        const smoothness = this.getParam(node, 'epsilon', this.getParam(node, 'smoothness', 0.01));

        const widthExpr = typeof width === 'string' ? `(${width})` : width;
        const heightExpr = typeof height === 'string' ? `(${height})` : height;
        const centerXExpr = typeof centerX === 'string' ? `(${centerX})` : centerX;
        const centerYExpr = typeof centerY === 'string' ? `(${centerY})` : centerY;
        const scaleExpr = scale;
        const rotationExpr = rotation;
        const smoothnessExpr = typeof smoothness === 'string' ? `(${smoothness})` : smoothness;

        paramExprs = `, ${widthExpr}, ${heightExpr}, ${centerXExpr}, ${centerYExpr}, ${scaleExpr}, ${rotationExpr}, ${smoothnessExpr}`;
        break;
      }
      case 'Polygon': {
        functionDef = this.generatePolygonFunction(node, nodeId, functionName);
        const centerX = this.getParam(node, 'centerX', 0.5);
        const centerY = this.getParam(node, 'centerY', 0.5);
        const sides = this.getParam(node, 'sides', 6);
        const radius = this.getParam(node, 'radius', 0.25);
        const rotationDeg = this.getParam(node, 'rotation', 0.0);
        const rotation = this.convertDegToRad(rotationDeg);  // Convert degrees to radians
        // FIXED: Use 'epsilon' to match ParameterDefs, fallback to 'smoothness' for compatibility
        const smoothness = this.getParam(node, 'epsilon', this.getParam(node, 'smoothness', 0.01));

        const centerXExpr = typeof centerX === 'string' ? `(${centerX})` : centerX;
        const centerYExpr = typeof centerY === 'string' ? `(${centerY})` : centerY;
        const sidesExpr = typeof sides === 'string' ? `(${sides})` : sides;
        const radiusExpr = typeof radius === 'string' ? `(${radius})` : radius;
        const rotationExpr = typeof rotation === 'string' ? `(${rotation})` : rotation;
        const smoothnessExpr = typeof smoothness === 'string' ? `(${smoothness})` : smoothness;

        paramExprs = `, ${centerXExpr}, ${centerYExpr}, ${sidesExpr}, ${radiusExpr}, ${rotationExpr}, ${smoothnessExpr}`;
        break;
      }
    }

    this.functionDefinitions.set(nodeId, functionDef);

    const line = `
  let node_${nodeId} = ${functionName}(${uv}${paramExprs});`;

    return {
      line,
      outputType: "f32",
      functionDef: this.functionDefinitions.get(nodeId),
      functionName
    };
  }

  /**
   * FIXED: Circle function now aspect-ratio aware and accepts parameters
   */
  generateCircleFunction(node, nodeId, functionName) {
    const safeId = this.makeSafeIdentifier(nodeId);

    return `fn ${functionName}(uv: vec2<f32>, centerX: f32, centerY: f32, radius: f32, smoothness: f32) -> f32 {
  // Domain + aspect: measure distances in aspect space
  // FIXED: Don't clamp UV - allows transformed coordinates from Transform2D nodes
  var ${safeId}_uvA = uv;
  ${safeId}_uvA.x *= u.aspect;

  // FIXED: Use centerX and centerY parameters instead of hardcoded 0.5, 0.5
  let ${safeId}_ctr = vec2<f32>(centerX * u.aspect, centerY);
  let ${safeId}_r = clamp(radius, 0.0, 2.0);
  let ${safeId}_eps = max(smoothness, 1e-4);

  let ${safeId}_dist = length(${safeId}_uvA - ${safeId}_ctr) - ${safeId}_r;
  return 1.0 - smoothstep(-${safeId}_eps, ${safeId}_eps, ${safeId}_dist);
}`;
  }

  /**
   * FIXED: Rectangle function now aspect-ratio aware and accepts parameters
   */
generateRectangleFunction(node, nodeId, functionName) {
  const safeId = this.makeSafeIdentifier(nodeId);

  return `fn ${functionName}(uv: vec2<f32>, width: f32, height: f32, centerX: f32, centerY: f32, scale: f32, rotation: f32, smoothness: f32) -> f32 {
  // Distances in aspect space
  // FIXED: Don't clamp UV - allows transformed coordinates from Transform2D nodes
  var ${safeId}_uvA = uv;
  ${safeId}_uvA.x *= u.aspect;

  // center in aspect space (use parameters, not clamped to allow transforms)
  let ${safeId}_ctr = vec2<f32>(
    centerX * u.aspect,
    centerY
  );
  // size in aspect space (no additional aspect scaling needed)
  var ${safeId}_half = clamp(
    vec2<f32>(width, height),
    vec2<f32>(0.0),
    vec2<f32>(1.0)
  ) * 0.5;
  // Zoom semantics: larger 'scale' => larger rect (scale half-size)
  let ${safeId}_s = max(scale, 0.0);
  ${safeId}_half *= ${safeId}_s;

  // rotate delta in aspect space (unique names; avoids clashes)
  var ${safeId}_dp = ${safeId}_uvA - ${safeId}_ctr;
  let ${safeId}_cr = cos(rotation);
  let ${safeId}_sr = sin(rotation);
  ${safeId}_dp = vec2<f32>(
    ${safeId}_cr * ${safeId}_dp.x - ${safeId}_sr * ${safeId}_dp.y,
    ${safeId}_sr * ${safeId}_dp.x + ${safeId}_cr * ${safeId}_dp.y
  );

  let ${safeId}_d = abs(${safeId}_dp) - ${safeId}_half;
  let ${safeId}_dist = length(max(${safeId}_d, vec2<f32>(0.0)))
                     + min(max(${safeId}_d.x, ${safeId}_d.y), 0.0);
  let ${safeId}_eps = max(smoothness, 1e-4);
  return 1.0 - smoothstep(-${safeId}_eps, ${safeId}_eps, ${safeId}_dist);
}`;
}
  /**
   * FIXED: Polygon function now aspect-ratio aware and accepts parameters
   */
  generatePolygonFunction(node, nodeId, functionName) {
    return `fn ${functionName}(uv: vec2<f32>, centerX: f32, centerY: f32, sides: f32, radius: f32, rotation: f32, smoothness: f32) -> f32 {
  // Aspect-corrected UV
  var aspectUV = uv;
  aspectUV.x *= u.aspect;

  // FIXED: Use centerX and centerY parameters instead of hardcoded 0.5, 0.5
  let aspectCenter = vec2<f32>(centerX * u.aspect, centerY);

  let p = aspectUV - aspectCenter;
  // FIXED: Apply rotation parameter
  let a = atan2(p.y, p.x) + rotation;
  let r = length(p);
  let n = sides;
  let an = 3.14159265 / n;
  let segment = floor(0.5 + a / (2.0 * an));
  let angle = a - 2.0 * an * segment;
  let dist = r * cos(angle) - radius;
  // FIXED: Use smoothness parameter
  return 1.0 - smoothstep(-smoothness, smoothness, dist);
}`;
  }

  getAllFunctionDefinitions() {
    return Array.from(this.functionDefinitions.values()).join('\n\n');
  }

clearFunctionCache() {
  this.functionDefinitions.clear();

}

getParam(node, paramName, defaultValue) {
  const rawValue = node.params?.[paramName] ?? defaultValue;

  // Handle expressions: with = prefix (like "=node_14" or "=time*2") or bare
  // dynamic expressions referencing time/audio.
  const isExpr = typeof rawValue === 'string' &&
    (rawValue.startsWith('=') || /time|audioEnvelope/.test(rawValue));
  if (isExpr) {
    // Shape parameters are scalars (f32). Resolve every node_<id> reference to a scalar
    // WGSL expression up front: input nodes -> their GPU global (Mouse reduced to one
    // channel), regular nodes -> their variable with component access or scalar coercion
    // based on the recorded type. A reference that names no real node yet (mid-typing,
    // e.g. "=node_2" on the way to "=node_28") returns null, so we fall back to the static
    // default instead of emitting invalid WGSL that floods the console with shader errors.
    const scalarMapping = this._buildScalarRefMapping(rawValue);
    if (scalarMapping === null) {
      return this._defaultLiteral(defaultValue);
    }
    try {
      const result = unifiedExpressionSystem.generateShader(rawValue, scalarMapping, this.graph);
      return result === '0.0' ? this._defaultLiteral(defaultValue) : result;
    } catch (error) {
      return this._defaultLiteral(defaultValue);
    }
  }

  // PERFORMANCE FIX: Register ALL numeric parameters as uniforms!
  if (this.uniformManager) {
    let value = rawValue;

    // Parse string values to numbers
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      value = isNaN(parsed) ? (typeof defaultValue === 'number' ? defaultValue : 0.0) : parsed;
    }

    // Convert to number
    if (typeof value !== 'number') {
      value = typeof defaultValue === 'number' ? defaultValue : 0.0;
    }

    // Ensure finite value
    if (!isFinite(value)) {
      value = 0.0;
    }

    // Register with uniform manager
    const paramKey = `${node.id}.${paramName}`;
    this.uniformManager.uniformValues.set(paramKey, value);

    // Generate uniform reference
    const sanitizedKey = paramKey.replace(/[^a-zA-Z0-9_]/g, '_');
    const fieldName = sanitizedKey.startsWith('_') ? sanitizedKey : `_${sanitizedKey}`;
    return `u_params.${fieldName}`;
  }

  // Fallback: For static params without uniform manager
  const result = this.paramHandler.toShaderCode(node.kind, paramName, rawValue, null);

  if (typeof result === 'number') {
    return result === Math.floor(result) ? `${result}.0` : result.toString();
  }

  return result;
}

  compileConicGradient(node, getInput, nodeId) {
    const uv = getInput(0, "vec2", "in.uv");
    const centerX = this.getParam(node, 'centerX', 0.5);
    const centerY = this.getParam(node, 'centerY', 0.5);
    const rotationDeg = this.getParam(node, 'rotation', 0.0);
    const rotation = this.convertDegToRad(rotationDeg);  // Convert degrees to radians
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






}


