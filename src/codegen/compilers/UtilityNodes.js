// src/codegen/compilers/UtilityNodes.js
import { COLOR_FUNCTIONS_WGSL } from './ColorNodes.js';
import { unifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';

export class UtilityNodes {
  constructor() {
    this.uniformManager = null;
    this.requiresColorHelpers = false;
  }

  setUniformManager(manager) {
    this.uniformManager = manager;
  }

  resetHelperTracking() {
    this.requiresColorHelpers = false;
  }

  getHelperFunctions() {
    return this.requiresColorHelpers ? COLOR_FUNCTIONS_WGSL : '';
  }

  /**
   * Get parameter value with default fallback
   */
  getParam(node, name, defaultValue) {
    const value = node.params?.[name] ?? defaultValue;
    if (typeof value === 'boolean') return value;
    return value;
  }

  /**
   * Generate shader expression for parameter (handles =audioEnvelope, =time, etc.)
   *
   * USE UNIFIED AST SYSTEM - This ensures shader code matches CPU evaluation exactly.
   * No more string replacement hacks that cause preview/shader desync!
   */
  getShaderParam(node, name, defaultValue) {
    const value = this.getParam(node, name, defaultValue);

    // Handle expressions with = prefix (like "=audioEnvelope*5")
    if (typeof value === 'string' && value.startsWith('=')) {
      try {
        return unifiedExpressionSystem.generateShader(value);
      } catch (error) {
        console.warn('Failed to generate shader for expression:', value, error);
        return String(defaultValue);
      }
    }

    // Handle expressions without = prefix (like "time" or "audioEnvelope*2")
    if (typeof value === 'string' && (/\btime\b/.test(value) || /audioEnvelope/.test(value))) {
      try {
        return unifiedExpressionSystem.generateShader(value);
      } catch (error) {
        console.warn('Failed to generate shader for expression:', value, error);
        return String(defaultValue);
      }
    }

    // Return numeric value as string
    return String(value);
  }

  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    return [
      'OutputFinal', 'Expr', 'Remap', 'Posterize',
      'ColorToGrayscale', 'ColorInvert', 'ColorSaturate', 
      'ColorContrast', 'ColorBrightness', 'ColorMix',
      'HSVToRGB', 'RGBToHSV', 'Select', 'Compare'
    ].includes(kind);
  }
  
  /**
   * Compile utility nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'OutputFinal':
        return this.compileOutputFinal(node, getInput, nodeId);
      case 'Expr':
        return this.compileExpression(node, getInput, nodeId);
      case 'Remap':
        return this.compileRemap(node, getInput, nodeId);
      case 'Posterize':
        return this.compilePosterize(node, getInput, nodeId);
      case 'ColorToGrayscale':
        return this.compileColorToGrayscale(node, getInput, nodeId);
      case 'ColorInvert':
        return this.compileColorInvert(nodeId, getInput);
      case 'ColorSaturate':
        return this.compileColorSaturate(node, getInput, nodeId);
      case 'ColorContrast':
        return this.compileColorContrast(node, getInput, nodeId);
      case 'ColorBrightness':
        return this.compileColorBrightness(node, getInput, nodeId);
      case 'ColorMix':
        return this.compileColorMix(node, getInput, nodeId);
      case 'HSVToRGB':
        return this.compileHSVToRGB(nodeId, getInput);
      case 'RGBToHSV':
        return this.compileRGBToHSV(nodeId, getInput);
      case 'Select':
        return this.compileSelect(node, getInput, nodeId);
      case 'Compare':
        return this.compileCompare(node, getInput, nodeId);
      default:
        return null;
    }
  }
  
  compileOutputFinal(node, getInput, nodeId) {
    // Check if the Output node has any input connection
    const hasValidInput = node.inputs && node.inputs[0] !== null && node.inputs[0] !== undefined;

    if (!hasValidInput) {
      console.error('[OutputFinal] ❌ NO INPUT CONNECTED!');
      console.error('[OutputFinal] The Output node requires an input connection to display anything.');
      console.error('[OutputFinal] Please connect a node to the Output node\'s input.');
      console.error('[OutputFinal] Example: SimplexNoise → Output  or  ComputeColorAdjust → Output');
    }

    const color = getInput(0, "vec3", "vec3<f32>(0.0)");

    // Check if connected to a ComputeFieldMapper (3D visualization node)
    if (hasValidInput) {
      const inputNode = window.editor?.graph?.nodes?.find(n => n.id === node.inputs[0]);
      if (inputNode && inputNode.kind === 'ComputeFieldMapper') {
        console.warn('[OutputFinal] ⚠️  Connected to ComputeFieldMapper!');
        console.warn('[OutputFinal] This node outputs 3D geometry, not 2D shader data.');
        console.warn('[OutputFinal] Please disconnect and connect a different node for the 2D preview.');
        console.warn('[OutputFinal] The 3D visualization will appear in the 3D viewport (Ctrl+3).');
      }
    }

    return {
      line: `finalColor = ${color};`,
      outputType: "vec3"
    };
  }
  
  compileExpression(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    let expr = (node.expr || "a").toString();

    expr = expr.replace(/\ba\b/g, `(${a})`);
    expr = expr.replace(/\bb\b/g, `(${b})`);
    expr = expr.replace(/\bu_time\b/g, "g.time");
    expr = expr.replace(/\btime\b/g, "g.time");
    expr = expr.replace(/\baudioEnvelopeBass\b/g, "g.audioEnvelopeBass");
    expr = expr.replace(/\baudioEnvelopeMids\b/g, "g.audioEnvelopeMids");
    expr = expr.replace(/\baudioEnvelopeHighs\b/g, "g.audioEnvelopeHighs");
    expr = expr.replace(/\baudioEnvelopeFull\b/g, "g.audioEnvelopeFull");
    expr = expr.replace(/\baudioEnvelope\b/g, "g.audioEnvelope");
    expr = expr.replace(/\buv\b/g, "in.uv");
    expr = expr.replace(/\bpi\b/g, "3.14159265359");
    expr = expr.replace(/\bPI\b/g, "3.14159265359");

    return {
      line: `let node_${nodeId} = ${expr};`,
      outputType: "f32"
    };
  }
  
  compileRemap(node, getInput, nodeId) {
    const value = getInput(0, "f32", "0.0");
    const inMin = this.getShaderParam(node, 'inMin', 0.0);
    const inMax = this.getShaderParam(node, 'inMax', 1.0);
    const outMin = this.getShaderParam(node, 'outMin', 0.0);
    const outMax = this.getShaderParam(node, 'outMax', 1.0);
    const doClamp = this.getParam(node, 'clamp', false);

    const remapped = `(((${value}) - ${inMin}) / max(${inMax} - ${inMin}, 0.0001)) * (${outMax} - ${outMin}) + ${outMin}`;
    const final = doClamp ? `clamp(${remapped}, min(${outMin}, ${outMax}), max(${outMin}, ${outMax}))` : remapped;

    return {
      line: `let node_${nodeId} = ${final};`,
      outputType: "f32"
    };
  }
  
  compilePosterize(node, getInput, nodeId) {
    const value = getInput(0, "f32", "0.0");
    const steps = node.params?.steps ?? 8.0;
    
    return {
      line: `let node_${nodeId} = floor(${value} * ${steps}) / ${steps};`,
      outputType: "f32"
    };
  }
  
  compileColorToGrayscale(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    const method = node.params?.method || "luminance";
    
    let formula;
    switch (method) {
      case "luminance":
        formula = `dot(${color}, vec3<f32>(0.299, 0.587, 0.114))`;
        break;
      case "average":
        formula = `(${color}.x + ${color}.y + ${color}.z) / 3.0`;
        break;
      case "lightness":
        formula = `(max(max(${color}.x, ${color}.y), ${color}.z) + min(min(${color}.x, ${color}.y), ${color}.z)) / 2.0`;
        break;
      default:
        formula = `dot(${color}, vec3<f32>(0.299, 0.587, 0.114))`;
    }
    
    return {
      line: `let node_${nodeId} = ${formula};`,
      outputType: "f32"
    };
  }
  
  compileColorInvert(nodeId, getInput) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    return {
      line: `let node_${nodeId} = vec3<f32>(1.0) - (${color});`,
      outputType: "vec3"
    };
  }
  
  compileColorSaturate(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    const saturation = node.params?.saturation ?? 1.0;
    
    return {
      line: `
  let gray_${nodeId} = dot(${color}, vec3<f32>(0.299, 0.587, 0.114));
  let node_${nodeId} = mix(vec3<f32>(gray_${nodeId}), ${color}, ${saturation});`,
      outputType: "vec3"
    };
  }
  
  compileColorContrast(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.5)");
    const contrast = node.params?.contrast ?? 1.0;
    const pivot = node.params?.pivot ?? 0.5;
    
    return {
      line: `let node_${nodeId} = ((${color}) - ${pivot}) * ${contrast} + ${pivot};`,
      outputType: "vec3"
    };
  }
  
  compileColorBrightness(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0)");
    const brightness = this.getShaderParam(node, 'brightness', 0.0);

    return {
      line: `let node_${nodeId} = (${color}) + vec3<f32>(${brightness});`,
      outputType: "vec3"
    };
  }
  
  compileColorMix(node, getInput, nodeId) {
    const base = getInput(0, "vec3", "vec3<f32>(0.0)");
    const blend = getInput(1, "vec3", "vec3<f32>(0.0)");
    const factor = getInput(2, "f32", "0.5");
    const modeRaw = node.params?.mode ?? node.props?.mode ?? "mix";
    const normalizedMode = (() => {
      const formatted = modeRaw.toString().trim().toLowerCase();
      return formatted.length > 0 ? formatted : "mix";
    })();
    const factorExpr = `clamp(${factor}, 0.0, 1.0)`;
    
    let blendedExpr;
    switch (normalizedMode) {
      case "mix":
        blendedExpr = blend;
        break;
      case "multiply":
        this.requiresColorHelpers = true;
        blendedExpr = `blendMultiply(${base}, ${blend})`;
        break;
      case "screen":
        this.requiresColorHelpers = true;
        blendedExpr = `blendScreen(${base}, ${blend})`;
        break;
      case "overlay":
        this.requiresColorHelpers = true;
        blendedExpr = `blendOverlay(${base}, ${blend})`;
        break;
      case "add":
        this.requiresColorHelpers = true;
        blendedExpr = `blendAdd(${base}, ${blend})`;
        break;
      case "subtract":
        this.requiresColorHelpers = true;
        blendedExpr = `blendSubtract(${base}, ${blend})`;
        break;
      case "divide":
        this.requiresColorHelpers = true;
        blendedExpr = `blendDivide(${base}, ${blend})`;
        break;
      case "difference":
        this.requiresColorHelpers = true;
        blendedExpr = `blendDifference(${base}, ${blend})`;
        break;
      case "darken":
        this.requiresColorHelpers = true;
        blendedExpr = `blendDarken(${base}, ${blend})`;
        break;
      case "lighten":
        this.requiresColorHelpers = true;
        blendedExpr = `blendLighten(${base}, ${blend})`;
        break;
      default:
        blendedExpr = blend;
        break;
    }
    
    return {
      line: `
  let factor_${nodeId} = ${factorExpr};
  let blended_${nodeId} = ${blendedExpr};
  let node_${nodeId} = mix(${base}, blended_${nodeId}, factor_${nodeId});`,
      outputType: "vec3"
    };
  }
  
  compileHSVToRGB(nodeId, getInput) {
    const hsv = getInput(0, "vec3", "vec3<f32>(0.0, 0.0, 1.0)");
    return {
      line: `let node_${nodeId} = hsvToRgb(${hsv});`,
      outputType: "vec3"
    };
  }
  
  compileRGBToHSV(nodeId, getInput) {
    const rgb = getInput(0, "vec3", "vec3<f32>(1.0)");
    return {
      line: `let node_${nodeId} = rgbToHsv(${rgb});`,
      outputType: "vec3"
    };
  }
  
  compileSelect(node, getInput, nodeId) {
    const a = getInput(0, "vec3", "vec3<f32>(0.0)");
    const b = getInput(1, "vec3", "vec3<f32>(1.0)");
    const condition = getInput(2, "f32", "0.5");
    const threshold = node.params?.threshold ?? 0.5;
    
    return {
      line: `let node_${nodeId} = select(${a}, ${b}, ${condition} > ${threshold});`,
      outputType: "vec3"
    };
  }
  
  compileCompare(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    const operator = node.params?.operator || "greater";
    const epsilon = node.params?.epsilon ?? 0.001;
    
    let comparison;
    switch (operator) {
      case "equal":
        comparison = `abs(${a} - ${b}) < ${epsilon}`;
        break;
      case "notEqual":
        comparison = `abs(${a} - ${b}) >= ${epsilon}`;
        break;
      case "greater":
        comparison = `${a} > ${b}`;
        break;
      case "greaterEqual":
        comparison = `${a} >= ${b}`;
        break;
      case "less":
        comparison = `${a} < ${b}`;
        break;
      case "lessEqual":
        comparison = `${a} <= ${b}`;
        break;
      default:
        comparison = `${a} > ${b}`;
    }
    
    return {
      line: `let node_${nodeId} = select(0.0, 1.0, ${comparison});`,
      outputType: "f32"
    };
  }
}
