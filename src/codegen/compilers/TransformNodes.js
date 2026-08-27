// src/codegen/compilers/TransformNodes.js
//
// Context-aware UV transform compiler.
//
// Every transform node computes a modified UV coordinate.  When the optional
// "Texture" input pin (index 1) is connected to a compute node or a Texture2D
// node, the transformed UV is used to sample that texture and the node outputs
// a vec4 colour with the same channel-extraction pins as compute/texture nodes.
// When no texture is connected the node outputs a vec2 UV as before.
//
// Key optimisations are preserved:
//   - Static zero-rotation fast paths skip trigonometry entirely.
//   - Static non-zero rotation pre-calculates sin/cos on the CPU.
//   - Dynamic rotation (expressions / uniforms) uses GPU-side cos/sin.

import { unifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';
import { compilerParamRefMapping } from '../../utils/paramReferences.js';
import { resolveDiscreteParam } from '../../utils/discreteParams.js';
import { SHARED_SAMPLER } from '../../gpu/sharedSamplers.js';

export class TransformNodes {
  constructor() {
    this.uniformManager = null;
    // Graph being compiled, used to resolve node references in parameter expressions
    // without relying on the ambient window.editor.graph (absent in the external viewer).
    this.graph = null;
  }

  setUniformManager(uniformManager) {
    this.uniformManager = uniformManager;
  }

  setGraph(graph) {
    this.graph = graph;
  }

  handles(kind) {
    return [
      'Transform2D', 'Scale2D', 'Rotate2D', 'TileAndOffset',
      'Flip2D', 'UVToColor', 'PolarCoordinates', 'Twirl', 'Spherize',
    ].includes(kind);
  }

  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, '_');
    switch (node.kind) {
      case 'Transform2D':      return this.compileOptimizedTransform2D(node, getInput, nodeId);
      case 'Scale2D':          return this.compileScale2D(node, getInput, nodeId);
      case 'Rotate2D':         return this.compileOptimizedRotate2D(node, getInput, nodeId);
      case 'TileAndOffset':    return this.compileTileAndOffset(node, getInput, nodeId);
      case 'Flip2D':           return this.compileFlip2D(node, getInput, nodeId);
      case 'UVToColor':        return this.compileUVToColor(node, getInput, nodeId);
      case 'PolarCoordinates': return this.compilePolarCoordinates(node, getInput, nodeId);
      case 'Twirl':            return this.compileTwirl(node, getInput, nodeId);
      case 'Spherize':         return this.compileSpherize(node, getInput, nodeId);
      default:                 return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Parameter helpers
  // ---------------------------------------------------------------------------

  getParam(node, name, defaultValue) {
    const raw = node.params?.[name] ?? defaultValue;
    // A `select` or `boolean` control holding an expression is collapsed to a concrete option
    // here: every caller below branches on it in JavaScript (Flip2D's flipX becomes a literal
    // -1.0), so it can never be handed "=..." text. A numeric expression passes through
    // untouched — getShaderParam compiles that one into the WGSL instead.
    const value = resolveDiscreteParam(node, name, raw, defaultValue);
    if (typeof value === 'boolean') return value;
    return value;
  }

  isTimeExpression(value) {
    if (typeof value === 'string') {
      return value.includes('time') || value.includes('audioEnvelope') || value.startsWith('=');
    }
    return false;
  }

  getShaderParam(node, name, defaultValue) {
    const value = this.getParam(node, name, defaultValue);

    if (typeof value === 'string' && value.startsWith('=')) {
      // An identifier naming another parameter of this node (Scale Y = "=scaleX") binds to that
      // parameter's uniform instead of hitting the unknown-identifier guard and zeroing out.
      const mapping = compilerParamRefMapping(this, node, value, name);
      try { return unifiedExpressionSystem.generateShader(value, mapping, this.graph); } catch { return String(defaultValue); }
    }

    if (typeof value === 'string' && (/\btime\b/.test(value) || /audioEnvelope/.test(value))) {
      // An identifier naming another parameter of this node (Scale Y = "=scaleX") binds to that
      // parameter's uniform instead of hitting the unknown-identifier guard and zeroing out.
      const mapping = compilerParamRefMapping(this, node, value, name);
      try { return unifiedExpressionSystem.generateShader(value, mapping, this.graph); } catch { return String(defaultValue); }
    }

    if (this.uniformManager) {
      let numValue = typeof value === 'number' ? value : parseFloat(value);
      if (isNaN(numValue)) numValue = typeof defaultValue === 'number' ? defaultValue : parseFloat(defaultValue) || 0.0;
      if (!isFinite(numValue)) numValue = 0.0;

      const paramKey = `${node.id}.${name}`;
      this.uniformManager.uniformValues.set(paramKey, numValue);
      const sanitizedKey = paramKey.replace(/[^a-zA-Z0-9_]/g, '_');
      const fieldName = sanitizedKey.startsWith('_') ? sanitizedKey : `_${sanitizedKey}`;
      return `u_params.${fieldName}`;
    }

    if (typeof value === 'number') return value.toString();
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue.toString() : parsed.toString();
  }

  // ---------------------------------------------------------------------------
  // Context-aware output helpers
  // ---------------------------------------------------------------------------

  /**
   * Detect whether a texture is connected at pin 1.
   * Returns { texture, sampler } binding names for use in textureSample(), or null.
   */
  getTextureBinding(node) {
    const textureInputId = node.inputs?.[1];
    if (!textureInputId) return null;

    const graph = this.graph || window.editor?.graph || window.graph;
    const inputNode = graph?.nodes?.find(n => String(n.id) === String(textureInputId));
    if (!inputNode) return null;

    const sid = String(textureInputId).replace(/[^a-zA-Z0-9_]/g, '_');

    if (inputNode.kind && inputNode.kind.startsWith('Compute')) {
      return { texture: `compute_node_${sid}`, sampler: SHARED_SAMPLER };
    }
    // Text binds under the same `texture_<id>` / `sampler_<id>` pair as Texture2D, so a transform
    // can rotate/scale rasterised text the same way it does an image.
    if (inputNode.kind === 'Texture2D' || inputNode.kind === 'Text') {
      return { texture: `texture_${sid}`, sampler: SHARED_SAMPLER };
    }
    return null;
  }

  /** Standard RGBA + channel-extraction output pins (matches compute/texture nodes). */
  makeOutputPins(nodeId) {
    return [
      { expression: `node_${nodeId}_rgba`,                                    type: 'vec4' },
      { expression: `node_${nodeId}_rgba.xyz`,                                type: 'vec3' },
      { expression: `vec3<f32>(node_${nodeId}_rgba.r, 0.0, 0.0)`,            type: 'vec3' },
      { expression: `vec3<f32>(0.0, node_${nodeId}_rgba.g, 0.0)`,            type: 'vec3' },
      { expression: `vec3<f32>(0.0, 0.0, node_${nodeId}_rgba.b)`,            type: 'vec3' },
      { expression: `vec3<f32>(node_${nodeId}_rgba.a, node_${nodeId}_rgba.a, node_${nodeId}_rgba.a)`, type: 'vec3' },
    ];
  }

  /**
   * Finalise a transform node's output.
   *
   * @param {string} nodeId       - Sanitised node ID.
   * @param {string} preamble     - WGSL statements that define intermediate variables.
   * @param {string} transformedUV - WGSL expression for the final vec2 UV.
   * @param {object|null} texBinding - { texture, sampler } or null.
   */
  buildOutput(nodeId, preamble, transformedUV, texBinding) {
    const pre = preamble || '';
    if (texBinding) {
      // Texture-mode: sample the connected texture at the transformed UV.
      // Y is flipped to match WebGPU texture orientation (same as Texture2D/Compute nodes).
      const line = `${pre}
  let final_uv_${nodeId} = ${transformedUV};
  let sample_uv_${nodeId} = vec2<f32>(final_uv_${nodeId}.x, 1.0 - final_uv_${nodeId}.y);
  let node_${nodeId}_rgba = textureSample(${texBinding.texture}, ${texBinding.sampler}, sample_uv_${nodeId});
  let node_${nodeId} = node_${nodeId}_rgba;`;
      return { line, outputType: 'vec4', outputPins: this.makeOutputPins(nodeId) };
    }

    // UV-mode: pass the transformed UV downstream.
    const line = pre
      ? `${pre}\n  let node_${nodeId} = ${transformedUV};`
      : `let node_${nodeId} = ${transformedUV};`;
    return { line, outputType: 'vec2' };
  }

  // ---------------------------------------------------------------------------
  // Compile methods
  // ---------------------------------------------------------------------------

  compileOptimizedTransform2D(node, getInput, nodeId) {
    const uv          = getInput(0, 'vec2', 'in.uv');
    const texBinding  = this.getTextureBinding(node);

    const translateX  = this.getShaderParam(node, 'translateX', 0.0);
    const translateY  = this.getShaderParam(node, 'translateY', 0.0);
    const scaleX      = this.getShaderParam(node, 'scaleX',     1.0);
    const scaleY      = this.getShaderParam(node, 'scaleY',     1.0);
    const rotationDeg = this.getShaderParam(node, 'rotation',   0.0);
    const centerX     = this.getShaderParam(node, 'centerX',    0.5);
    const centerY     = this.getShaderParam(node, 'centerY',    0.5);

    const isUniformRef = typeof rotationDeg === 'string' && rotationDeg.includes('u_params.');
    let rotation;
    if (isUniformRef) {
      rotation = `(${rotationDeg} * ${Math.PI / 180})`;
    } else {
      const deg = parseFloat(rotationDeg);
      rotation = isNaN(deg) ? `(${rotationDeg} * ${Math.PI / 180})` : (deg * Math.PI / 180).toString();
    }

    const isStatic       = !this.isTimeExpression(node.params?.rotation);
    const rotValue       = parseFloat(rotation);
    const canPrecalculate = isStatic && !isUniformRef && !isNaN(rotValue);

    let preamble;
    const translateExpr = `vec2<f32>(${translateX}, ${translateY})`;
    const centerExpr    = `vec2<f32>(${centerX}, ${centerY})`;
    const scaleExpr     = `vec2<f32>(${scaleX}, ${scaleY})`;

    if (canPrecalculate && rotValue === 0.0) {
      // Fast path — no rotation
      preamble = `
  var uv_${nodeId} = ${uv};
  uv_${nodeId} = (uv_${nodeId} - ${centerExpr}) * ${scaleExpr} + ${centerExpr};`;
    } else if (canPrecalculate) {
      // Medium path — static rotation, sin/cos evaluated on CPU
      const cos_r = Math.cos(rotValue);
      const sin_r = Math.sin(rotValue);
      preamble = `
  var uv_${nodeId} = ${uv} - ${centerExpr};
  uv_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * ${cos_r} - uv_${nodeId}.y * ${sin_r},
    uv_${nodeId}.x * ${sin_r} + uv_${nodeId}.y * ${cos_r}
  ) * ${scaleExpr} + ${centerExpr};`;
    } else {
      // Slow path — dynamic rotation, sin/cos evaluated on GPU
      preamble = `
  var uv_${nodeId} = ${uv} - ${centerExpr};
  let rot_${nodeId} = ${rotation};
  let cos_${nodeId} = cos(rot_${nodeId});
  let sin_${nodeId} = sin(rot_${nodeId});
  uv_${nodeId} = vec2<f32>(
    uv_${nodeId}.x * cos_${nodeId} - uv_${nodeId}.y * sin_${nodeId},
    uv_${nodeId}.x * sin_${nodeId} + uv_${nodeId}.y * cos_${nodeId}
  ) * ${scaleExpr} + ${centerExpr};`;
    }

    return this.buildOutput(nodeId, preamble, `uv_${nodeId} + ${translateExpr}`, texBinding);
  }

  compileOptimizedRotate2D(node, getInput, nodeId) {
    const uv         = getInput(0, 'vec2', 'in.uv');
    const texBinding = this.getTextureBinding(node);

    const rotationDeg = this.getShaderParam(node, 'rotation', 0.0);
    const centerX     = this.getShaderParam(node, 'centerX',  0.5);
    const centerY     = this.getShaderParam(node, 'centerY',  0.5);

    const isUniformRef = typeof rotationDeg === 'string' && rotationDeg.includes('u_params.');
    let rotation;
    if (isUniformRef) {
      rotation = `(${rotationDeg} * ${Math.PI / 180})`;
    } else {
      const deg = parseFloat(rotationDeg);
      rotation = isNaN(deg) ? `(${rotationDeg} * ${Math.PI / 180})` : (deg * Math.PI / 180).toString();
    }

    const isStatic        = !this.isTimeExpression(node.params?.rotation);
    const rotValue        = parseFloat(rotation);
    const canPrecalculate = isStatic && !isUniformRef && !isNaN(rotValue);
    const centerExpr      = `vec2<f32>(${centerX}, ${centerY})`;

    if (canPrecalculate && rotValue === 0.0) {
      return this.buildOutput(nodeId, '', uv, texBinding);
    }

    let preamble, transformedUV;
    if (canPrecalculate) {
      const cos_r = Math.cos(rotValue);
      const sin_r = Math.sin(rotValue);
      preamble = `
  var uv_${nodeId} = ${uv} - ${centerExpr};`;
      transformedUV = `vec2<f32>(
    uv_${nodeId}.x * ${cos_r} - uv_${nodeId}.y * ${sin_r},
    uv_${nodeId}.x * ${sin_r} + uv_${nodeId}.y * ${cos_r}
  ) + ${centerExpr}`;
    } else {
      preamble = `
  var uv_${nodeId} = ${uv} - ${centerExpr};
  let rot_${nodeId} = ${rotation};
  let cos_${nodeId} = cos(rot_${nodeId});
  let sin_${nodeId} = sin(rot_${nodeId});`;
      transformedUV = `vec2<f32>(
    uv_${nodeId}.x * cos_${nodeId} - uv_${nodeId}.y * sin_${nodeId},
    uv_${nodeId}.x * sin_${nodeId} + uv_${nodeId}.y * cos_${nodeId}
  ) + ${centerExpr}`;
    }

    return this.buildOutput(nodeId, preamble, transformedUV, texBinding);
  }

  compileScale2D(node, getInput, nodeId) {
    const uv         = getInput(0, 'vec2', 'in.uv');
    const texBinding = this.getTextureBinding(node);

    const scaleX  = this.getShaderParam(node, 'scaleX',  1.0);
    const scaleY  = this.getShaderParam(node, 'scaleY',  1.0);
    const centerX = this.getShaderParam(node, 'centerX', 0.5);
    const centerY = this.getShaderParam(node, 'centerY', 0.5);

    const transformedUV = (scaleX === '1.0' && scaleY === '1.0')
      ? uv
      : `(${uv} - vec2<f32>(${centerX}, ${centerY})) * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${centerX}, ${centerY})`;

    return this.buildOutput(nodeId, '', transformedUV, texBinding);
  }

  compileTileAndOffset(node, getInput, nodeId) {
    const uv         = getInput(0, 'vec2', 'in.uv');
    const texBinding = this.getTextureBinding(node);

    const tilingX = this.getShaderParam(node, 'tilingX', 1.0);
    const tilingY = this.getShaderParam(node, 'tilingY', 1.0);
    const offsetX = this.getShaderParam(node, 'offsetX', 0.0);
    const offsetY = this.getShaderParam(node, 'offsetY', 0.0);

    const identity = tilingX === '1.0' && tilingY === '1.0' && offsetX === '0.0' && offsetY === '0.0';
    const transformedUV = identity
      ? uv
      : `fract(${uv} * vec2<f32>(${tilingX}, ${tilingY}) + vec2<f32>(${offsetX}, ${offsetY}))`;

    return this.buildOutput(nodeId, '', transformedUV, texBinding);
  }

  compileFlip2D(node, getInput, nodeId) {
    const uv         = getInput(0, 'vec2', 'in.uv');
    const texBinding = this.getTextureBinding(node);

    const flipX = this.getParam(node, 'flipX', false);
    const flipY = this.getParam(node, 'flipY', false);

    if (!flipX && !flipY) return this.buildOutput(nodeId, '', uv, texBinding);

    const scaleX  = flipX ? -1.0 : 1.0;
    const scaleY  = flipY ? -1.0 : 1.0;
    const offsetX = flipX ?  1.0 : 0.0;
    const offsetY = flipY ?  1.0 : 0.0;

    const transformedUV = `${uv} * vec2<f32>(${scaleX}, ${scaleY}) + vec2<f32>(${offsetX}, ${offsetY})`;
    return this.buildOutput(nodeId, '', transformedUV, texBinding);
  }

  compilePolarCoordinates(node, getInput, nodeId) {
    const uv         = getInput(0, 'vec2', 'in.uv');
    const texBinding = this.getTextureBinding(node);

    const centerX      = this.getShaderParam(node, 'centerX',      0.5);
    const centerY      = this.getShaderParam(node, 'centerY',      0.5);
    const radialScale  = this.getShaderParam(node, 'radialScale',  1.0);
    const angularScale = this.getShaderParam(node, 'angularScale', 1.0);

    const preamble = `
  let polar_d_${nodeId} = ${uv} - vec2<f32>(${centerX}, ${centerY});
  let polar_r_${nodeId} = length(polar_d_${nodeId}) * ${radialScale};
  let polar_a_${nodeId} = (atan2(polar_d_${nodeId}.y, polar_d_${nodeId}.x) / (2.0 * 3.14159265359) + 0.5) * ${angularScale};`;
    const transformedUV = `vec2<f32>(fract(polar_a_${nodeId}), clamp(polar_r_${nodeId}, 0.0, 1.0))`;

    return this.buildOutput(nodeId, preamble, transformedUV, texBinding);
  }

  compileTwirl(node, getInput, nodeId) {
    const inputResult = getInput(0, 'vec2', 'in.uv');
    const input       = (typeof inputResult === 'object' && inputResult !== null ? inputResult.code : inputResult) || 'in.uv';
    const texBinding  = this.getTextureBinding(node);

    const centerX  = this.getShaderParam(node, 'centerX',  0.5);
    const centerY  = this.getShaderParam(node, 'centerY',  0.5);
    const strength = this.getShaderParam(node, 'strength', 1.0);
    const radius   = this.getShaderParam(node, 'radius',   0.5);

    const preamble = `
  let p_${nodeId} = ${input} - vec2<f32>(${centerX}, ${centerY});
  let r_${nodeId} = length(p_${nodeId});
  let a_${nodeId} = atan2(p_${nodeId}.y, p_${nodeId}.x);
  let t_${nodeId} = smoothstep(${radius}, 0.0, r_${nodeId}) * ${strength};
  let twirled_${nodeId} = vec2<f32>(
    cos(a_${nodeId} + t_${nodeId}),
    sin(a_${nodeId} + t_${nodeId})
  ) * r_${nodeId};`;
    const transformedUV = `clamp(twirled_${nodeId} + vec2<f32>(${centerX}, ${centerY}), vec2<f32>(0.0), vec2<f32>(1.0))`;

    return this.buildOutput(nodeId, preamble, transformedUV, texBinding);
  }

  compileSpherize(node, getInput, nodeId) {
    const inputResult = getInput(0, 'vec2', 'in.uv');
    const input       = (typeof inputResult === 'object' && inputResult !== null ? inputResult.code : inputResult) || 'in.uv';
    const texBinding  = this.getTextureBinding(node);

    const centerX  = this.getShaderParam(node, 'centerX',  0.5);
    const centerY  = this.getShaderParam(node, 'centerY',  0.5);
    const strength = this.getShaderParam(node, 'strength', 0.5);
    const radius   = this.getShaderParam(node, 'radius',   0.5);

    const preamble = `
  var p_${nodeId} = ${input} - vec2<f32>(${centerX}, ${centerY});
  let r_${nodeId} = length(p_${nodeId});
  let factor_${nodeId} = clamp(r_${nodeId} / ${radius}, 0.0, 1.0);
  p_${nodeId} *= mix(1.0, 1.0 - ${strength}, factor_${nodeId} * factor_${nodeId});`;
    const transformedUV = `clamp(p_${nodeId} + vec2<f32>(${centerX}, ${centerY}), vec2<f32>(0.0), vec2<f32>(1.0))`;

    return this.buildOutput(nodeId, preamble, transformedUV, texBinding);
  }

  // UVToColor is a visualisation utility — texture input not applicable.
  compileUVToColor(node, getInput, nodeId) {
    const uv = getInput(0, 'vec2', 'in.uv');
    return {
      line: `let node_${nodeId} = vec3<f32>(${uv}.x, ${uv}.y, 0.0);`,
      outputType: 'vec3',
    };
  }
}
