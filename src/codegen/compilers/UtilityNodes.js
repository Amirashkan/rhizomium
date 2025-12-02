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
      'HSVToRGB', 'RGBToHSV', 'Select', 'Compare', 'Switch', 'CustomGLSL'
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
      case 'Switch':
        return this.compileSwitch(node, getInput, nodeId);
      case 'CustomGLSL':
        try {
          return this.compileCustomGLSL(node, getInput, nodeId);
        } catch (error) {
          console.error('Error compiling CustomGLSL node:', error);
          // Return a safe fallback
          return {
            line: `let node_${nodeId} = 0.0;`,
            outputType: 'f32'
          };
        }
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

  compileSwitch(node, getInput, nodeId) {
    const outputType = node.params?.outputType || "f32";
    const selectParam = Math.max(0, Math.min(3, Math.floor(node.params?.select || 0)));
    
    // Get default values based on output type
    const getDefaultForType = (type) => {
      switch (type) {
        case 'vec2': return 'vec2<f32>(0.0)';
        case 'vec3': return 'vec3<f32>(0.0)';
        case 'vec4': return 'vec4<f32>(0.0)';
        default: return '0.0';
      }
    };
    
    const defaultValue = getDefaultForType(outputType);
    
    // Get all inputs
    const a = getInput(0, outputType, defaultValue);
    const b = getInput(1, outputType, defaultValue);
    const c = getInput(2, outputType, defaultValue);
    const d = getInput(3, outputType, defaultValue);
    
    // Select which input to output based on parameter
    let selectedInput;
    switch (selectParam) {
      case 0: selectedInput = a; break;
      case 1: selectedInput = b; break;
      case 2: selectedInput = c; break;
      case 3: selectedInput = d; break;
      default: selectedInput = a; break;
    }
    
    return {
      line: `let node_${nodeId} = ${selectedInput};`,
      outputType: outputType
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
    
    // Debug logging
    if (window.DEBUG_CUSTOM_GLSL) {
      console.log(`[CustomGLSL] Compiling node ${sanitizedNodeId}:`, {
        nodeId: node.id,
        sanitizedNodeId,
        codeLength: code.length,
        codePreview: code.substring(0, 100)
      });
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
      
      // Check for function calls that require vector types
      // Functions that typically use vec2: distance, length, normalize, etc.
      // Check if input is used in functions that require vec2
      // Also check for arithmetic operations with vec2 literals
      if (components.size === 0) {
        // Check for distance(vec2, vec2) - very common pattern
        const distancePattern = new RegExp(`\\bdistance\\s*\\([^)]*\\b${inputName}\\b`, 'g');
        if (distancePattern.test(code)) {
          return 'vec2'; // distance requires vec2 arguments
        }
        
        // Check for length(vec2) - common pattern
        // Also check for length(input - vec2(...)) or length(vec2(...) - input)
        const lengthPattern = new RegExp(`\\blength\\s*\\([^)]*\\b${inputName}\\b`, 'g');
        if (lengthPattern.test(code)) {
          // Check if input is used in arithmetic with vec2
          const vec2ArithPattern = new RegExp(`\\b${inputName}\\s*[-+*/]\\s*vec2\\s*<`, 'g');
          const vec2ArithPattern2 = new RegExp(`vec2\\s*<[^>]+>\\s*[-+*/]\\s*\\b${inputName}\\b`, 'g');
          if (vec2ArithPattern.test(code) || vec2ArithPattern2.test(code)) {
            return 'vec2'; // Definitely vec2 if used in arithmetic with vec2
          }
          // If used in length() without component access, likely vec2
          return 'vec2';
        }
        
        // Check for normalize(vec2)
        const normalizePattern = new RegExp(`\\bnormalize\\s*\\([^)]*\\b${inputName}\\b`, 'g');
        if (normalizePattern.test(code)) {
          return 'vec2'; // normalize with vec2 is common
        }
        
        // Check for arithmetic operations with vec2 literals (e.g., input0 - vec2<f32>(5.0, 5.0))
        // This is a strong indicator that input0 should be vec2
        // Pattern: input0 - vec2<...> or vec2<...> - input0
        const vec2ArithPattern = new RegExp(`\\b${inputName}\\s*[-+*/]\\s*vec2\\s*<`, 'g');
        const vec2ArithPattern2 = new RegExp(`vec2\\s*<[^>]+>\\s*[-+*/]\\s*\\b${inputName}\\b`, 'g');
        // Also check for patterns like length(input0 - vec2(...)) or distance(input0, vec2(...))
        // This is more specific - if input0 is used in length() with vec2 arithmetic, it must be vec2
        const vec2InLengthPattern = new RegExp(`length\\s*\\([^)]*\\b${inputName}\\b[^)]*[-+*/]\\s*vec2\\s*<`, 'g');
        const vec2InLengthPattern2 = new RegExp(`length\\s*\\([^)]*vec2\\s*<[^)]*[-+*/]\\s*\\b${inputName}\\b`, 'g');
        // Check for distance(input0, vec2(...)) or distance(vec2(...), input0)
        const vec2InDistancePattern = new RegExp(`distance\\s*\\([^,)]*\\b${inputName}\\b[^,)]*,\\s*vec2\\s*<`, 'g');
        const vec2InDistancePattern2 = new RegExp(`distance\\s*\\([^,)]*vec2\\s*<[^,)]*,\\s*\\b${inputName}\\b`, 'g');
        if (vec2ArithPattern.test(code) || vec2ArithPattern2.test(code) || 
            vec2InLengthPattern.test(code) || vec2InLengthPattern2.test(code) ||
            vec2InDistancePattern.test(code) || vec2InDistancePattern2.test(code)) {
          return 'vec2'; // If used in arithmetic with vec2, it must be vec2
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
    
    // Replace built-in variables with their shader equivalents
    code = code.replace(/\bu_time\b/g, "g.time");
    code = code.replace(/\btime\b/g, "g.time");
    code = code.replace(/\baudioEnvelopeBass\b/g, "g.audioEnvelopeBass");
    code = code.replace(/\baudioEnvelopeMids\b/g, "g.audioEnvelopeMids");
    code = code.replace(/\baudioEnvelopeHighs\b/g, "g.audioEnvelopeHighs");
    code = code.replace(/\baudioEnvelopeFull\b/g, "g.audioEnvelopeFull");
    code = code.replace(/\baudioEnvelope\b/g, "g.audioEnvelope");
    code = code.replace(/\buv\b/g, "in.uv");
    code = code.replace(/\bpi\b/g, "3.14159265359");
    code = code.replace(/\bPI\b/g, "3.14159265359");
    code = code.replace(/\bE\b/g, "2.71828182846");

    // Get output type from parameter
    const outputType = node.params?.outputType || "f32";
    const validOutputType = ['f32', 'vec2', 'vec3', 'vec4'].includes(outputType) ? outputType : 'f32';

    // Split code into lines, but preserve multi-line expressions
    // First, remove comments
    const linesWithoutComments = code.split('\n')
      .map(line => {
        // Remove inline comments (// ...)
        const commentIndex = line.indexOf('//');
        if (commentIndex >= 0) {
          return line.substring(0, commentIndex).trim();
        }
        return line.trim();
      })
      .filter(line => line.length > 0);
    
    // Now reconstruct multi-line expressions
    // Track parentheses/braces/brackets to know when we're in a multi-line expression
    let reconstructedLines = [];
    let currentExpression = '';
    let parenDepth = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    
    for (let i = 0; i < linesWithoutComments.length; i++) {
      const line = linesWithoutComments[i];
      const trimmedLine = line.trim();
      
      // Count parentheses, braces, and brackets in this line
      let lineParenDepth = 0;
      let lineBraceDepth = 0;
      let lineBracketDepth = 0;
      
      for (const char of line) {
        if (char === '(') lineParenDepth++;
        if (char === ')') lineParenDepth--;
        if (char === '{') lineBraceDepth++;
        if (char === '}') lineBraceDepth--;
        if (char === '<') lineBracketDepth++;
        if (char === '>') lineBracketDepth--;
      }
      
      // Update global depths
      parenDepth += lineParenDepth;
      braceDepth += lineBraceDepth;
      bracketDepth += lineBracketDepth;
      
      // Add to current expression
      if (currentExpression) {
        // Add space between lines, but preserve structure
        currentExpression += ' ' + line;
      } else {
        currentExpression = line;
      }
      
      // Check if this is a complete expression
      // It's complete if:
      // 1. All parentheses/braces/brackets are closed (depth = 0), AND
      // 2. The line doesn't end with a comma (which indicates continuation), AND
      // 3. Either the line ends with semicolon OR it's a complete expression
      // BUT: Don't split if we're inside a for/if/while/loop block (braceDepth > 0)
      // unless we've closed all braces
      const endsWithComma = trimmedLine.endsWith(',');
      const endsWithSemicolon = trimmedLine.endsWith(';');
      // Only consider complete if all braces are closed (we're not inside a block)
      const isComplete = parenDepth === 0 && braceDepth === 0 && bracketDepth === 0 && !endsWithComma;
      
      if (isComplete) {
        // Remove trailing semicolon if present (we'll add it when needed)
        const cleaned = currentExpression.trim().replace(/;+$/, '');
        reconstructedLines.push(cleaned);
        currentExpression = '';
        // Reset depths
        parenDepth = 0;
        braceDepth = 0;
        bracketDepth = 0;
      }
    }
    
    // If there's a remaining expression (unclosed), add it anyway
    if (currentExpression) {
      const cleaned = currentExpression.trim().replace(/;+$/, '');
      reconstructedLines.push(cleaned);
    }
    
    const codeLines = reconstructedLines;
    
    let compiledCode;
    
    if (codeLines.length > 1) {
      // Multi-line code - process intermediate lines and final expression
      // The last non-comment line should be the return value
      const lastLine = codeLines[codeLines.length - 1];
      const otherLines = codeLines.slice(0, -1);
      
      // Check if code contains statements (var, for, if, etc.) that need block scope
      const hasStatements = codeLines.some(line => 
        /^\s*(var|for|if|while|loop|switch|break|continue|return|discard)\b/.test(line)
      );
      
      if (hasStatements) {
        // Code contains statements - need to use a block scope
        // Process statements and expressions, replacing variable references
        const varMap = new Map(); // Map original var names to sanitized names
        
        // First pass: identify all variable declarations (let and var)
        // Also check which variables are assigned to later (need to be var, not let)
        const assignedVars = new Set();
        otherLines.forEach((line) => {
          // Check for assignment statements (variable = ...)
          const assignmentMatch = line.match(/^(\w+)\s*=\s*(.+);?$/);
          if (assignmentMatch) {
            assignedVars.add(assignmentMatch[1]);
          }
        });
        
        otherLines.forEach((line, idx) => {
          const letMatch = line.match(/let\s+(\w+)\s*=\s*(.+);?$/);
          const varMatch = line.match(/var\s+(\w+)\s*[=:]\s*(.+);?$/);
          if (letMatch) {
            const varName = letMatch[1];
            // If this variable is assigned to later, we need to track it as a var, not let
            if (assignedVars.has(varName)) {
              // This will be converted to var in the second pass
              varMap.set(varName, varName); // Keep original name for var
            } else {
              const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
              varMap.set(varName, sanitizedVarName);
            }
          } else if (varMatch) {
            const varName = varMatch[1];
            // Keep var declarations as-is (they're mutable), but track the name
            // Don't sanitize var names - they need to stay as-is for the block scope
            varMap.set(varName, varName);
          }
        });
        
        // Second pass: process each line
        const processedLines = [];
        otherLines.forEach((line, idx) => {
          // Trim the line for checking
          const trimmedLine = line.trim();
          
          // Check if it's a statement (var, for, if, etc.)
          const isStatement = /^(var|for|if|while|loop|switch|break|continue|return|discard)\b/.test(trimmedLine);
          
          if (isStatement) {
            // It's a statement - keep as-is but replace variable references
            // For statements with braces (for, if, while, etc.), the entire statement
            // including its body should be on one line (reconstructed by line reconstruction)
            let processedLine = line;
            const sortedVars = Array.from(varMap.entries()).reverse();
            for (const [original, sanitized] of sortedVars) {
              // Only replace if it's not the declaration itself
              // Check for var/let declarations more carefully - match the exact pattern
              const declarationPattern = new RegExp(`\\b(var|let)\\s+${original}\\b`);
              const isDeclaration = declarationPattern.test(line);
              
              if (!isDeclaration) {
                // Replace variable references, but be careful with word boundaries
                // For statements with braces, we need to replace references inside the body too
                processedLine = processedLine.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
              }
            }
            processedLines.push(processedLine);
          } else {
            // Check if it's an assignment statement (variable = expression;)
            // This is different from a let declaration - assignments modify existing variables
            const assignmentMatch = line.match(/^(\w+)\s*=\s*(.+);?$/);
            if (assignmentMatch) {
              const varName = assignmentMatch[1];
              let varValue = assignmentMatch[2];
              
              // Replace variable references in the value
              const sortedVars = Array.from(varMap.entries()).reverse();
              for (const [original, sanitized] of sortedVars) {
                // Replace references to other variables, but keep the target variable name as-is
                if (original !== varName) {
                  varValue = varValue.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
                }
              }
              
              // Keep assignment as-is (it modifies an existing variable)
              processedLines.push(`${varName} = ${varValue};`);
            } else {
              // It's a let declaration or expression
              const letMatch = line.match(/let\s+(\w+)\s*=\s*(.+);?$/);
              if (letMatch) {
                const varName = letMatch[1];
                let varValue = letMatch[2];
                
                // If this variable is assigned to later, convert let to var
                if (assignedVars.has(varName)) {
                  // Convert to var - keep original name
                  const sortedVars = Array.from(varMap.entries()).reverse();
                  for (const [original, sanitized] of sortedVars) {
                    if (original !== varName) {
                      varValue = varValue.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
                    }
                  }
                  processedLines.push(`var ${varName} = ${varValue};`);
                } else {
                  // Regular let declaration - sanitize the name
                  const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
                  
                  // Replace variable references in the value
                  const sortedVars = Array.from(varMap.entries()).reverse();
                  for (const [original, sanitized] of sortedVars) {
                    if (original !== varName) {
                      varValue = varValue.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
                    }
                  }
                  
                  processedLines.push(`let ${sanitizedVarName} = ${varValue};`);
                  varMap.set(varName, sanitizedVarName);
                }
              } else {
                // Pure expression - create a temp variable
                let expression = line;
                const sortedVars = Array.from(varMap.entries()).reverse();
                for (const [original, sanitized] of sortedVars) {
                  expression = expression.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
                }
                const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
                processedLines.push(`let ${sanitizedVarName} = ${expression};`);
                // Note: we don't add to varMap for pure expressions
              }
            }
          }
        });
        
        // Process the last line
        let finalExpression = lastLine;
        const sortedVars = Array.from(varMap.entries()).reverse();
        for (const [original, sanitized] of sortedVars) {
          finalExpression = finalExpression.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
        }
        
        // Remove "let" or "var" from final expression if present
        const finalLetMatch = finalExpression.match(/let\s+\w+\s*=\s*(.+);?$/);
        const finalVarMatch = finalExpression.match(/var\s+\w+\s*[=:]\s*(.+);?$/);
        if (finalLetMatch) {
          finalExpression = finalLetMatch[1];
        } else if (finalVarMatch) {
          finalExpression = finalVarMatch[1];
        }
        
        // Wrap in a block - but node_X needs to be accessible outside
        // Use var so we can assign it inside the block
        // Get default value for the output type
        const getDefaultForOutputType = (type) => {
          switch (type) {
            case 'vec2': return 'vec2<f32>(0.0)';
            case 'vec3': return 'vec3<f32>(0.0)';
            case 'vec4': return 'vec4<f32>(0.0)';
            default: return '0.0';
          }
        };
        const defaultValue = getDefaultForOutputType(validOutputType);
        // Ensure all statements end with semicolons (except blocks)
        const formattedLines = processedLines.map(line => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.endsWith(';') && !trimmed.endsWith('}') && !trimmed.endsWith('{')) {
            return line + ';';
          }
          return line;
        });
        // Build block content: all processed lines, then assign final expression to node_X
        // Make sure final expression is properly formatted
        const finalAssignment = `node_${sanitizedNodeId} = ${finalExpression};`;
        const blockContentLines = [...formattedLines, finalAssignment];
        // Join with newlines and proper indentation
        const blockContent = blockContentLines.join('\n  ');
        // The entire block (var declaration + block) should be a single line in the lines array
        // The newlines inside will be preserved when inserted into the shader
        compiledCode = `var node_${sanitizedNodeId}: ${validOutputType} = ${defaultValue};
{
  ${blockContent}
}`;
      } else {
        // No statements - just expressions and let declarations
        // Process intermediate lines - they should be let declarations
        const intermediateDeclarations = [];
        const varMap = new Map(); // Map original var names to sanitized names
        
        // First pass: identify all variable declarations and create the map
        otherLines.forEach((line, idx) => {
          const letMatch = line.match(/let\s+(\w+)\s*=\s*(.+);?$/);
          if (letMatch) {
            const varName = letMatch[1];
            const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
            varMap.set(varName, sanitizedVarName);
          }
        });
        
        // Second pass: process each line, replacing variable references with sanitized names
        otherLines.forEach((line, idx) => {
          const letMatch = line.match(/let\s+(\w+)\s*=\s*(.+);?$/);
          if (letMatch) {
            const varName = letMatch[1];
            let varValue = letMatch[2];
            const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
            
            // Replace any variable references in the value with their sanitized names
            const sortedVars = Array.from(varMap.entries()).reverse();
            for (const [original, sanitized] of sortedVars) {
              if (original !== varName) {
                varValue = varValue.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
              }
            }
            
            intermediateDeclarations.push(`let ${sanitizedVarName} = ${varValue};`);
          } else {
            // Not a let declaration - treat as expression and create a temp variable
            let expression = line;
            const sortedVars = Array.from(varMap.entries()).reverse();
            for (const [original, sanitized] of sortedVars) {
              expression = expression.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
            }
            const sanitizedVarName = `temp_${sanitizedNodeId}_${idx}`;
            intermediateDeclarations.push(`let ${sanitizedVarName} = ${expression};`);
          }
        });
        
        // Process the last line - replace any variable references with sanitized names
        let finalExpression = lastLine;
        const sortedVars = Array.from(varMap.entries()).reverse();
        for (const [original, sanitized] of sortedVars) {
          finalExpression = finalExpression.replace(new RegExp(`\\b${original}\\b`, 'g'), sanitized);
        }
        
        // Remove any "let" declaration from final expression if present
        const finalMatch = finalExpression.match(/let\s+\w+\s*=\s*(.+);?$/);
        if (finalMatch) {
          finalExpression = finalMatch[1];
        }
        
        // Combine all declarations - node_X must be at top level, not in a block
        compiledCode = intermediateDeclarations.join('\n') + `\nlet node_${sanitizedNodeId} = ${finalExpression};`;
      }
    } else if (codeLines.length === 1) {
      // Single line - just assign
      compiledCode = `let node_${sanitizedNodeId} = ${codeLines[0]};`;
    } else {
      // Empty code - use default
      compiledCode = `let node_${sanitizedNodeId} = 0.0;`;
    }
    
    // Ensure we always return a valid result
    if (!compiledCode || !compiledCode.trim()) {
      compiledCode = `let node_${sanitizedNodeId} = 0.0;`;
    }
    
    // Double-check that the line contains the variable declaration
    if (!compiledCode.includes(`node_${sanitizedNodeId}`)) {
      console.warn(`[CustomGLSL] Node ${sanitizedNodeId} did not generate proper variable declaration. Generated code:`, compiledCode);
      compiledCode = `let node_${sanitizedNodeId} = 0.0;`;
    }
    
    // Debug logging
    if (window.DEBUG_CUSTOM_GLSL) {
      console.log(`[CustomGLSL] Node ${sanitizedNodeId} compiled:`, {
        line: compiledCode.substring(0, 200),
        outputType: validOutputType
      });
    }
    
    return {
      line: compiledCode,
      outputType: validOutputType
    };
  }
}
