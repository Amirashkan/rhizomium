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
      'HSVToRGB', 'RGBToHSV', 'Select', 'Compare', 'CustomGLSL'
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
      case 'CustomGLSL':
        return this.compileCustomGLSL(node, getInput, nodeId);
      default:
        return null;
    }
  }
  
  compileOutputFinal(node, getInput, nodeId) {
    // Check if the Output node has any input connection
    const hasValidInput = node.inputs && node.inputs[0] !== null && node.inputs[0] !== undefined;

    if (!hasValidInput) {




    }

    const color = getInput(0, "vec3", "vec3<f32>(0.0)");

    // Check if connected to a ComputeFieldMapper (3D visualization node)
    if (hasValidInput) {
      const inputNode = window.editor?.graph?.nodes?.find(n => n.id === node.inputs[0]);
      if (inputNode && inputNode.kind === 'ComputeFieldMapper') {



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

  compileCustomGLSL(node, getInput, nodeId) {
    // Ensure nodeId is sanitized (in case it wasn't passed correctly)
    const sanitizedNodeId = nodeId || node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    // Get custom code from node first to analyze what types are needed
    let code = node.params?.code || node.code || "input0";
    if (typeof code !== 'string') {
      code = String(code);
    }
    
    // If code is empty or only whitespace/comments, provide a default
    if (!code.trim() || code.trim().split('\n').every(line => line.trim().startsWith('//') || !line.trim())) {
      code = "0.0";
    }

    // Analyze code to determine expected input types based on usage
    const inferInputType = (inputIndex) => {
      const inputName = `input${inputIndex}`;
      // Match patterns like input0.x, input0.y, (input0).x, input0.r, etc.
      // Look for input name followed by optional parentheses/whitespace, then dot, then component
      const inputPattern = new RegExp(`\\b${inputName}\\b[^\\s]*\\.([xyzwrgba])\\b`, 'g');
      let match;
      const components = new Set();
      
      while ((match = inputPattern.exec(code)) !== null) {
        if (match[1]) {
          components.add(match[1]);
        }
      }
      
      if (components.size === 0) {
        return null; // No type hints, use default
      }

      // Determine type based on components accessed
      if (components.has('x') || components.has('y') || components.has('z') || components.has('w')) {
        if (components.has('w')) return 'vec4';
        if (components.has('z')) return 'vec3';
        if (components.has('y')) return 'vec2';
        if (components.has('x')) return 'vec2'; // If only x, assume vec2 (common for UV)
      }
      
      if (components.has('r') || components.has('g') || components.has('b') || components.has('a')) {
        if (components.has('a')) return 'vec4';
        if (components.has('b')) return 'vec3';
        return 'vec3'; // RGB
      }

      return null;
    };

    // Determine expected types for each input
    const input0Type = inferInputType(0);
    const input1Type = inferInputType(1);
    const input2Type = inferInputType(2);
    const input3Type = inferInputType(3);

    // Get appropriate defaults based on inferred types
    const getDefaultForType = (type) => {
      switch (type) {
        case 'vec2': return 'vec2<f32>(0.0)';
        case 'vec3': return 'vec3<f32>(0.0)';
        case 'vec4': return 'vec4<f32>(0.0)';
        default: return '0.0';
      }
    };

    // Get inputs with appropriate defaults
    // When type is inferred, pass null as targetType to let getInput handle conversion
    // but provide the correct default value
    const input0Default = getDefaultForType(input0Type);
    const input1Default = getDefaultForType(input1Type);
    const input2Default = getDefaultForType(input2Type);
    const input3Default = getDefaultForType(input3Type);
    
    const input0 = getInput(0, input0Type || null, input0Default);
    const input1 = getInput(1, input1Type || null, input1Default);
    const input2 = getInput(2, input2Type || null, input2Default);
    const input3 = getInput(3, input3Type || null, input3Default);

    // Extract code strings from type-aware results
    const input0Code = typeof input0 === 'object' && input0?.code !== undefined ? input0.code : input0;
    const input1Code = typeof input1 === 'object' && input1?.code !== undefined ? input1.code : input1;
    const input2Code = typeof input2 === 'object' && input2?.code !== undefined ? input2.code : input2;
    const input3Code = typeof input3 === 'object' && input3?.code !== undefined ? input3.code : input3;

    // Replace input placeholders with actual input values
    // Use word boundaries to avoid partial matches
    code = code.replace(/\binput0\b/g, `(${input0Code})`);
    code = code.replace(/\binput1\b/g, `(${input1Code})`);
    code = code.replace(/\binput2\b/g, `(${input2Code})`);
    code = code.replace(/\binput3\b/g, `(${input3Code})`);

    // Get output type from parameter
    const outputType = node.params?.outputType || "f32";

    // Split code into lines and process
    const lines = code.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // Remove comment-only lines for compilation (but keep them in the code for user reference)
    const codeLines = lines.filter(line => !line.startsWith('//'));
    
    let compiledCode;
    
    if (codeLines.length > 1) {
      // Multi-line code - wrap in a block
      // The last non-comment line should be the return value
      const lastLine = codeLines[codeLines.length - 1];
      const otherLines = codeLines.slice(0, -1);
      
      compiledCode = `{
  ${otherLines.join('\n  ')}
  let node_${sanitizedNodeId} = ${lastLine};
}`;
    } else if (codeLines.length === 1) {
      // Single line - just assign
      compiledCode = `let node_${sanitizedNodeId} = ${codeLines[0]};`;
    } else {
      // Empty code - use default
      compiledCode = `let node_${sanitizedNodeId} = 0.0;`;
    }

    // Ensure outputType is a valid type string
    const validOutputType = ['f32', 'vec2', 'vec3', 'vec4'].includes(outputType) ? outputType : 'f32';
    
    // Ensure we always return a valid result
    if (!compiledCode || !compiledCode.trim()) {
      compiledCode = `let node_${sanitizedNodeId} = 0.0;`;
    }
    
    return {
      line: compiledCode,
      outputType: validOutputType
    };
  }
}
