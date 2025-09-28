// src/codegen/compilers/MathNodes.js
export class MathNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    const mathNodes = [
      'Multiply', 'Add', 'Subtract', 'Divide',
      'Sin', 'Cos', 'Tan', 'Floor', 'Fract', 'Abs', 'Sqrt',
      'Pow', 'Min', 'Max', 'Clamp', 'Smoothstep', 'Step',
      'Mix', 'Sign', 'Mod', 'Saturate', 'CircleField'
    ];
    return mathNodes.includes(kind);
  }
  
  /**
   * Compile math nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      // Vector math operations
      case 'Multiply':
        return this.compileBinaryVectorOp(nodeId, getInput, '*', 'vec3<f32>(1.0)');
      case 'Add':
        return this.compileBinaryVectorOp(nodeId, getInput, '+', 'vec3<f32>(0.0)');
      case 'Subtract':
        return this.compileBinaryVectorOp(nodeId, getInput, '-', 'vec3<f32>(0.0)');
      case 'Divide':
        return this.compileDivide(nodeId, getInput);
        
      // Single value math functions
      case 'Sin':
        return this.compileUnaryMath(nodeId, getInput, 'sin');
      case 'Cos':
        return this.compileUnaryMath(nodeId, getInput, 'cos');
      case 'Tan':
        return this.compileUnaryMath(nodeId, getInput, 'tan');
      case 'Floor':
        return this.compileUnaryMath(nodeId, getInput, 'floor');
      case 'Fract':
        return this.compileUnaryMath(nodeId, getInput, 'fract');
      case 'Abs':
        return this.compileUnaryMath(nodeId, getInput, 'abs');
      case 'Sqrt':
        return this.compileSqrt(nodeId, getInput);
        
      // Binary math functions
      case 'Pow':
        return this.compileBinaryMath(nodeId, getInput, 'pow', '1.0', '2.0');
      case 'Min':
        return this.compileBinaryMath(nodeId, getInput, 'min', '0.0', '0.0');
      case 'Max':
        return this.compileBinaryMath(nodeId, getInput, 'max', '0.0', '0.0');
        
      // Special functions
      case 'Clamp':
        return this.compileClamp(nodeId, getInput);
      case 'Smoothstep':
        return this.compileSmoothstep(nodeId, getInput);
      case 'Step':
        return this.compileStep(nodeId, getInput);
      case 'Mix':
        return this.compileMix(nodeId, getInput);
      case 'Sign':
        return this.compileUnaryMath(nodeId, getInput, 'sign');
      case 'Mod':
        return this.compileMod(nodeId, getInput);
      case 'Saturate':
        return this.compileSaturate(nodeId, getInput);
      case 'CircleField':
        return this.compileCircleField(node, getInput, nodeId);
        
      default:
        return null;
    }
  }
  
  /**
   * Compile binary vector operations
   */
  compileBinaryVectorOp(nodeId, getInput, operator, defaultValue) {
    const A = getInput(0, "vec3", defaultValue);
    const B = getInput(1, "vec3", defaultValue);
    const line = `let node_${nodeId} = (${A}) ${operator} (${B});`;
    console.log(`${operator} line: ${line}`);
    return { line, outputType: "vec3" };
  }
  
  /**
   * Compile divide with safety check
   */
  compileDivide(nodeId, getInput) {
    const A = getInput(0, "vec3", "vec3<f32>(1.0)");
    const B = getInput(1, "vec3", "vec3<f32>(1.0)");
    const line = `let node_${nodeId} = (${A}) / max((${B}), vec3<f32>(0.0001));`;
    console.log(`Divide line: ${line}`);
    return { line, outputType: "vec3" };
  }
  
  /**
   * Compile unary math functions
   */
  compileUnaryMath(nodeId, getInput, funcName) {
    const inp = getInput(0, "f32", "0.0");
    return {
      line: `let node_${nodeId} = ${funcName}(${inp});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile sqrt with safety check
   */
  compileSqrt(nodeId, getInput) {
    const inp = getInput(0, "f32", "0.0");
    return {
      line: `let node_${nodeId} = sqrt(max(${inp}, 0.0));`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile binary math functions
   */
  compileBinaryMath(nodeId, getInput, funcName, default1, default2) {
    const a = getInput(0, "f32", default1);
    const b = getInput(1, "f32", default2);
    return {
      line: `let node_${nodeId} = ${funcName}(${a}, ${b});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile clamp function
   */
  compileClamp(nodeId, getInput) {
    const value = getInput(0, "f32", "0.0");
    const minVal = getInput(1, "f32", "0.0");
    const maxVal = getInput(2, "f32", "1.0");
    return {
      line: `let node_${nodeId} = clamp(${value}, ${minVal}, ${maxVal});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile smoothstep function
   */
  compileSmoothstep(nodeId, getInput) {
    const edge0 = getInput(0, "f32", "0.0");
    const edge1 = getInput(1, "f32", "1.0");
    const x = getInput(2, "f32", "0.5");
    return {
      line: `let node_${nodeId} = smoothstep(${edge0}, ${edge1}, ${x});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile step function
   */
  compileStep(nodeId, getInput) {
    const edge = getInput(0, "f32", "0.5");
    const x = getInput(1, "f32", "0.0");
    return {
      line: `let node_${nodeId} = step(${edge}, ${x});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile mix function
   */
  compileMix(nodeId, getInput) {
    const a = getInput(0, "vec3", "vec3<f32>(0.0)");
    const b = getInput(1, "vec3", "vec3<f32>(1.0)");
    const t = getInput(2, "f32", "0.5");
    return {
      line: `let node_${nodeId} = mix(${a}, ${b}, ${t});`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile mod function
   */
  compileMod(nodeId, getInput) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "1.0");
    return {
      line: `let node_${nodeId} = ${a} - ${b} * floor(${a} / max(${b}, 0.0001));`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile saturate function
   */
  compileSaturate(nodeId, getInput) {
    const v = getInput(0, "vec3", "vec3<f32>(0.0)");
    return {
      line: `let node_${nodeId} = clamp(${v}, vec3<f32>(0.0), vec3<f32>(1.0));`,
      outputType: "vec3"
    };
  }
  
  /**
   * Check if expression is incomplete (to avoid compilation errors)
   */
  isIncompleteExpression(expression) {
    const incompletePatterns = [
      /[+\-*/]$/, // Ends with operator
      /[+\-*/]\s*$/, // Ends with operator and whitespace
      /\($/, // Ends with opening parenthesis
      /,\s*$/, // Ends with comma
      /^\s*$/, // Empty or whitespace only
    ];
    
    return incompletePatterns.some(pattern => pattern.test(expression.trim()));
  }
  
  /**
   * Safely evaluate expression parameter
   */
  safeEvaluateParameter(paramValue, defaultValue, node) {
    if (typeof paramValue !== 'string' || !paramValue.startsWith('=')) {
      return parseFloat(paramValue) || defaultValue;
    }
    
    try {
      const expression = paramValue.slice(1).trim();
      
      // Check for incomplete expressions
      if (this.isIncompleteExpression(expression)) {
        console.log('Incomplete expression detected, using default:', expression);
        return defaultValue;
      }
      
      // Evaluate complete expression
      if (window.editor?.paramPanel?.expressionSystem) {
        const result = window.editor.paramPanel.expressionSystem.evaluateExpression(paramValue, {}, node);
        console.log('Expression evaluated:', { paramValue, result });
        return result;
      } else {
        console.warn('Expression system not available');
        return defaultValue;
      }
    } catch (error) {
      console.warn('Expression evaluation failed during compilation:', error);
      return defaultValue;
    }
  }
  
  /**
   * Compile circle field with expression support and validation
   */
compileCircleField(node, getInput, nodeId) {
    // Get UV input (falls back to in.uv if no input connected)
    const uv = getInput(0, "vec2", "in.uv");
    
    // Since CircleField now has no inputs, get parameters directly
    const radiusParam = node.params?.radius ?? 0.25;
    const epsilonParam = node.params?.epsilon ?? 0.02;
    
    // Safely evaluate parameters with validation
    const R = this.safeEvaluateParameter(radiusParam, 0.25, node);
    const E = this.safeEvaluateParameter(epsilonParam, 0.02, node);
    
    console.log('CircleField compiling with:', { 
      radiusParam, 
      evaluatedRadius: R, 
      epsilonParam, 
      evaluatedEpsilon: E,
      uvInput: uv  // Add this for debugging
    });
    
    // Ensure values are valid numbers for WGSL
    const safeR = (typeof R === 'number' && isFinite(R)) ? R.toFixed(6) : '0.25';
    const safeE = (typeof E === 'number' && isFinite(E)) ? E.toFixed(6) : '0.02';
    
    return {
      line: `let node_${nodeId} = 1.0 - smoothstep((${safeR}) - max(${safeE}, 0.0001), (${safeR}) + max(${safeE}, 0.0001), distance(${uv}, vec2<f32>(0.5, 0.5)));`,
      outputType: "f32"
    };
}
}