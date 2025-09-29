// src/codegen/compilers/MathNodes.js
export class MathNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    const mathNodes = [
      // Arithmetic
      'Add', 'Subtract', 'Multiply', 'Divide', 'Power',
      // Trigonometry
      'Sin', 'Cos', 'Tan', 'Asin', 'Acos', 'Atan', 'Atan2',
      // Math functions
      'Floor', 'Ceil', 'Round', 'Fract', 'Abs', 'Sqrt', 'Sign', 'Mod',
      'Exp', 'Exp2', 'Log', 'Log2',
      // Range/Comparison
      'Min', 'Max', 'Clamp',
      // Interpolation
      'Smoothstep', 'Step', 'Mix', 'Lerp', 'InverseLerp', 'Saturate',
      // Utilities
      'OneMinus', 'Negate', 'Reciprocal'
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
      // Arithmetic Operations
      case 'Add':
        return this.compileBinaryOp(nodeId, getInput, '+', '0.0', '0.0');
      case 'Subtract':
        return this.compileBinaryOp(nodeId, getInput, '-', '0.0', '0.0');
      case 'Multiply':
        return this.compileBinaryOp(nodeId, getInput, '*', '1.0', '1.0');
      case 'Divide':
        return this.compileDivide(nodeId, getInput);
      case 'Power':
        return this.compileBinaryMath(nodeId, getInput, 'pow', '1.0', '2.0');
        
      // Trigonometric Functions
      case 'Sin':
        return this.compileUnaryMath(nodeId, getInput, 'sin');
      case 'Cos':
        return this.compileUnaryMath(nodeId, getInput, 'cos');
      case 'Tan':
        return this.compileUnaryMath(nodeId, getInput, 'tan');
      case 'Asin':
        return this.compileUnaryMath(nodeId, getInput, 'asin');
      case 'Acos':
        return this.compileUnaryMath(nodeId, getInput, 'acos');
      case 'Atan':
        return this.compileUnaryMath(nodeId, getInput, 'atan');
      case 'Atan2':
        return this.compileBinaryMath(nodeId, getInput, 'atan2', '0.0', '1.0');
        
      // Mathematical Functions
      case 'Floor':
        return this.compileUnaryMath(nodeId, getInput, 'floor');
      case 'Ceil':
        return this.compileUnaryMath(nodeId, getInput, 'ceil');
      case 'Round':
        return this.compileUnaryMath(nodeId, getInput, 'round');
      case 'Fract':
        return this.compileUnaryMath(nodeId, getInput, 'fract');
      case 'Abs':
        return this.compileUnaryMath(nodeId, getInput, 'abs');
      case 'Sqrt':
        return this.compileSqrt(nodeId, getInput);
      case 'Sign':
        return this.compileUnaryMath(nodeId, getInput, 'sign');
      case 'Mod':
        return this.compileMod(nodeId, getInput);
      case 'Exp':
        return this.compileUnaryMath(nodeId, getInput, 'exp');
      case 'Exp2':
        return this.compileUnaryMath(nodeId, getInput, 'exp2');
      case 'Log':
        return this.compileUnaryMath(nodeId, getInput, 'log');
      case 'Log2':
        return this.compileUnaryMath(nodeId, getInput, 'log2');
        
      // Range and Comparison Functions
      case 'Min':
        return this.compileBinaryMath(nodeId, getInput, 'min', '0.0', '0.0');
      case 'Max':
        return this.compileBinaryMath(nodeId, getInput, 'max', '0.0', '0.0');
      case 'Clamp':
        return this.compileClamp(nodeId, getInput);
        
      // Interpolation Functions
      case 'Smoothstep':
        return this.compileSmoothstep(nodeId, getInput);
      case 'Step':
        return this.compileStep(nodeId, getInput);
      case 'Mix':
      case 'Lerp':
        return this.compileMix(nodeId, getInput);
      case 'InverseLerp':
        return this.compileInverseLerp(nodeId, getInput);
      case 'Saturate':
        return this.compileSaturate(nodeId, getInput);
        
      // Utility Operations
      case 'OneMinus':
        return this.compileOneMinus(nodeId, getInput);
      case 'Negate':
        return this.compileNegate(nodeId, getInput);
      case 'Reciprocal':
        return this.compileReciprocal(nodeId, getInput);
        
      default:
        return null;
    }
  }
  
  /**
   * Compile binary operations
   */
  compileBinaryOp(nodeId, getInput, operator, default1, default2) {
    const a = getInput(0, "f32", default1);
    const b = getInput(1, "f32", default2);
    return {
      line: `let node_${nodeId} = (${a}) ${operator} (${b});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile divide with safety check
   */
  compileDivide(nodeId, getInput) {
    const a = getInput(0, "f32", "1.0");
    const b = getInput(1, "f32", "1.0");
    return {
      line: `let node_${nodeId} = (${a}) / max((${b}), 0.0001);`,
      outputType: "f32"
    };
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
   * Compile mix/lerp function
   */
  compileMix(nodeId, getInput) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "1.0");
    const t = getInput(2, "f32", "0.5");
    return {
      line: `let node_${nodeId} = mix(${a}, ${b}, ${t});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile inverse lerp function
   */
  compileInverseLerp(nodeId, getInput) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "1.0");
    const value = getInput(2, "f32", "0.5");
    return {
      line: `let node_${nodeId} = clamp((${value} - ${a}) / max(${b} - ${a}, 0.0001), 0.0, 1.0);`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile saturate function (clamp 0-1)
   */
  compileSaturate(nodeId, getInput) {
    const v = getInput(0, "f32", "0.0");
    return {
      line: `let node_${nodeId} = clamp(${v}, 0.0, 1.0);`,
      outputType: "f32"
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
   * Compile OneMinus (1.0 - x)
   */
  compileOneMinus(nodeId, getInput) {
    const x = getInput(0, "f32", "0.0");
    return {
      line: `let node_${nodeId} = 1.0 - (${x});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile Negate (-x)
   */
  compileNegate(nodeId, getInput) {
    const x = getInput(0, "f32", "0.0");
    return {
      line: `let node_${nodeId} = -(${x});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile Reciprocal (1.0 / x)
   */
  compileReciprocal(nodeId, getInput) {
    const x = getInput(0, "f32", "1.0");
    return {
      line: `let node_${nodeId} = 1.0 / max(${x}, 0.0001);`,
      outputType: "f32"
    };
  }
}