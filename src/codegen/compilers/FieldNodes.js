// src/codegen/compilers/FieldNodes.js
// FIXED: Aspect-ratio aware shape functions

import { UnifiedParameterHandler } from '../../parameters/UnifiedParameterHandler.js';
import { unifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';
import { compilerParamRefMapping } from '../../utils/paramReferences.js';
import {
  buildScalarRefMapping,
  resolveScalarRef,
  toScalar,
  suffixToComponent,
  componentCount,
} from '../processors/scalarRef.js';

/**
 * A Rectangle's two extents need a unit, and the two useful answers disagree, so the node
 * says which one it means:
 *
 *   "Proportional" (default) Both extents are measured against the frame's HEIGHT - the same
 *                  y-units Circle and Polygon measure their radius in. Width : Height is the
 *                  shape's true on-screen ratio, so 0.5 x 0.5 is a SQUARE at every render
 *                  resolution and every aspect ratio. That is what a Rectangle's two numbers
 *                  have to mean: the shape you type is the shape you get. To span a wide
 *                  frame edge-to-edge, give Width the frame's aspect (1.78 on 16:9) - the
 *                  half-extents have no ceiling.
 *   "Frame"        Width is a fraction of the frame's WIDTH, Height a fraction of its HEIGHT,
 *                  so 1.0 x 1.0 fills the composition at any ratio. The cost is that the shape
 *                  inherits the composition's proportions - equal values draw a 16:9 rectangle
 *                  on a 16:9 output - which is why it is no longer the default.
 *
 * The option list itself lives with the node definition (src/data/nodes/PatternNodes.js); all
 * the compiler needs is to recognise the one mode that changes the generated code.
 *
 * Anything else - absent, empty, misspelled, a project saved before the mode existed - is
 * Proportional, so the shape a patch was authored with is the shape it keeps.
 */
export function rectangleIsProportional(node) {
  const raw = node?.params?.sizeMode ?? node?.props?.sizeMode;
  return !(typeof raw === 'string' && raw.trim().toLowerCase() === 'frame');
}

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

  // Scalar coercion of node references in scalar shape params lives in ../processors/scalarRef.js
  // (shared with the scalar input nodes). Thin wrappers keep this.graph/this.typeConverter implicit
  // at the call sites.
  _resolveScalarRef(name) {
    return resolveScalarRef(name, this.graph, this.typeConverter);
  }

  _buildScalarRefMapping(expression) {
    return buildScalarRefMapping(expression, this.graph, this.typeConverter);
  }

  _toScalar(expr, type) {
    return toScalar(expr, type);
  }

  _suffixToComponent(suffix) {
    return suffixToComponent(suffix);
  }

  _componentCount(type) {
    return componentCount(type);
  }

  makeSafeIdentifier(id) {
    return /^[A-Za-z_]/.test(id) ? id : `n_${id}`;
  }

  /**
   * Coerce a shape parameter to an f32 WGSL expression. Bound parameters resolve to
   * string expressions whose type isn't guaranteed to be f32 (a bound boolean or int
   * reference would otherwise produce a WGSL type error when passed to the shape
   * functions, which declare every parameter as f32). Wrapping with f32(...) makes
   * booleans/ints coerce; numeric (already-f32) values pass through unchanged.
   */
  _coerceScalarParam(value) {
    return typeof value === 'string' ? `f32(${value})` : value;
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
      'Displacement', 'Circle', 'Rectangle', 'Polygon'
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

        const centerXExpr = this._coerceScalarParam(centerX);
        const centerYExpr = this._coerceScalarParam(centerY);
        const radiusExpr = this._coerceScalarParam(radius);
        const smoothnessExpr = this._coerceScalarParam(smoothness);

        paramExprs = `, ${centerXExpr}, ${centerYExpr}, ${radiusExpr}, ${smoothnessExpr}`;
        break;
      }
      case 'Rectangle': {
        functionDef = this.generateRectangleFunction(node, nodeId, functionName);
        const width = this.getParam(node, 'width', 0.5);
        const height = this.getParam(node, 'height', 0.5);
        const centerX = this.getParam(node, 'centerX', 0.5);
        const centerY = this.getParam(node, 'centerY', 0.5);
        const roundness = this.getParam(node, 'roundness', 0.0);
        // FIXED: Node definition has no 'scale' or 'rotation' parameters, use defaults
        const scale = 1.0;
        const rotation = 0.0;
        // FIXED: Use 'epsilon' to match ParameterDefs, fallback to 'smoothness' for compatibility
        const smoothness = this.getParam(node, 'epsilon', this.getParam(node, 'smoothness', 0.01));

        const widthExpr = this._coerceScalarParam(width);
        const heightExpr = this._coerceScalarParam(height);
        const centerXExpr = this._coerceScalarParam(centerX);
        const centerYExpr = this._coerceScalarParam(centerY);
        const roundnessExpr = this._coerceScalarParam(roundness);
        const scaleExpr = scale;
        const rotationExpr = rotation;
        const smoothnessExpr = this._coerceScalarParam(smoothness);

        paramExprs = `, ${widthExpr}, ${heightExpr}, ${centerXExpr}, ${centerYExpr}, ${roundnessExpr}, ${scaleExpr}, ${rotationExpr}, ${smoothnessExpr}`;
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

        const centerXExpr = this._coerceScalarParam(centerX);
        const centerYExpr = this._coerceScalarParam(centerY);
        const sidesExpr = this._coerceScalarParam(sides);
        const radiusExpr = this._coerceScalarParam(radius);
        const rotationExpr = this._coerceScalarParam(rotation);
        const smoothnessExpr = this._coerceScalarParam(smoothness);

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

  // The two size modes disagree about exactly one thing: the unit Width is measured in.
  // Everything downstream - rotation, roundness, smoothness - operates on the half-extents
  // once they are in aspect space, so all of it is shared between the modes.
  const widthUnit = rectangleIsProportional(node)
    ? `  // "Proportional" (default): Width shares Height's unit, the frame's HEIGHT - the same
  // y-units Circle and Polygon measure their radius in. Width : Height is therefore the shape's
  // true on-screen ratio: 0.5 x 0.5 is a square at every resolution and every aspect ratio, and
  // a Rectangle of width and height 2r exactly circumscribes a Circle of radius r. Nothing is
  // scaled into x here - aspect space already measures both axes in frame-heights, which is
  // precisely what makes the two numbers describe the shape instead of the frame.`
    : `  // "Frame": Width is a fraction of the frame's WIDTH (Height is always a fraction of its
  // HEIGHT), so 1.0 x 1.0 fills the composition at any ratio and 0.5 x 0.5 covers its middle
  // quarter. The trade-off is that the shape inherits the composition's proportions - on a
  // 16:9 output equal values draw a 16:9 rectangle, never a square - which is why this is the
  // opt-in mode. Carrying the x half-extent into aspect space, where the frame spans
  // [0, aspect], keeps the distance field isotropic either way - rotation stays a true
  // rotation and 'smoothness' is the same thickness on every edge.
  ${safeId}_half.x *= u.aspect;`;

  return `fn ${functionName}(uv: vec2<f32>, width: f32, height: f32, centerX: f32, centerY: f32, roundness: f32, scale: f32, rotation: f32, smoothness: f32) -> f32 {
  // Distances in aspect space
  // FIXED: Don't clamp UV - allows transformed coordinates from Transform2D nodes
  var ${safeId}_uvA = uv;
  ${safeId}_uvA.x *= u.aspect;

  // center in aspect space (use parameters, not clamped to allow transforms)
  let ${safeId}_ctr = vec2<f32>(
    centerX * u.aspect,
    centerY
  );
  // Half-size. Only the floor matters here: a negative extent would turn the box inside out.
  // There is deliberately no ceiling - a rectangle larger than the frame is a legitimate
  // result (a mask that grows past the edge, an extent animated through the frame), and the
  // old clamp to 1.0 silently ignored anything the panel let you type above it.
  var ${safeId}_half = max(vec2<f32>(width, height), vec2<f32>(0.0)) * 0.5;
${widthUnit}
  // Zoom semantics: larger 'scale' => larger rect (scale half-size)
  let ${safeId}_s = max(scale, 0.0);
  ${safeId}_half *= ${safeId}_s;

  // Corner radius, as a fraction of the shortest half-extent so 1.0 is the roundest the
  // rectangle can get (a stadium / circle) and cannot invert the shape.
  let ${safeId}_r = clamp(roundness, 0.0, 1.0)
                  * min(${safeId}_half.x, ${safeId}_half.y);

  // rotate delta in aspect space (unique names; avoids clashes)
  var ${safeId}_dp = ${safeId}_uvA - ${safeId}_ctr;
  let ${safeId}_cr = cos(rotation);
  let ${safeId}_sr = sin(rotation);
  ${safeId}_dp = vec2<f32>(
    ${safeId}_cr * ${safeId}_dp.x - ${safeId}_sr * ${safeId}_dp.y,
    ${safeId}_sr * ${safeId}_dp.x + ${safeId}_cr * ${safeId}_dp.y
  );

  // Rounded-box SDF: shrink the box by the corner radius, then grow the distance back by it.
  let ${safeId}_d = abs(${safeId}_dp) - ${safeId}_half + vec2<f32>(${safeId}_r);
  let ${safeId}_dist = length(max(${safeId}_d, vec2<f32>(0.0)))
                     + min(max(${safeId}_d.x, ${safeId}_d.y), 0.0)
                     - ${safeId}_r;
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
    // An identifier naming another parameter of this node binds to that parameter (see
    // utils/paramReferences.js); node references keep precedence over parameter names.
    const paramRefs = compilerParamRefMapping(this, node, rawValue, paramName);
    try {
      const result = unifiedExpressionSystem.generateShader(rawValue, { ...paramRefs, ...scalarMapping }, this.graph);
      return result === '0.0' ? this._defaultLiteral(defaultValue) : result;
    } catch {
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


