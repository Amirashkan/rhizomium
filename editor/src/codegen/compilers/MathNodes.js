// src/codegen/compilers/MathNodes.js

export class MathNodes {
  /**
   * Check if this compiler handles the given node kind
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
      'OneMinus', 'Negate', 'Reciprocal',
      // Vector operations
      'Dot', 'Cross', 'Normalize', 'Length', 'Distance', 'Reflect', 'Refract'
    ];
    return mathNodes.includes(kind);
  }
  
  /**
   * Compile math nodes with type awareness
   */
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      // Arithmetic Operations
      case 'Add':
        return this.compileBinaryOp(nodeId, getInput, '+');
      case 'Subtract':
        return this.compileBinaryOp(nodeId, getInput, '-');
      case 'Multiply':
        return this.compileBinaryOp(nodeId, getInput, '*');
      case 'Divide':
        return this.compileDivide(nodeId, getInput);
      case 'Power':
        return this.compileBinaryMath(nodeId, getInput, 'pow');
        
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
        return this.compileBinaryMath(nodeId, getInput, 'atan2');
        
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
        return this.compileBinaryMath(nodeId, getInput, 'min');
      case 'Max':
        return this.compileBinaryMath(nodeId, getInput, 'max');
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
        
      // Vector Operations
      case 'Dot':
        return this.compileDot(nodeId, getInput);
      case 'Cross':
        return this.compileCross(nodeId, getInput);
      case 'Normalize':
        return this.compileNormalize(nodeId, getInput);
      case 'Length':
        return this.compileLength(nodeId, getInput);
      case 'Distance':
        return this.compileDistance(nodeId, getInput);
      case 'Reflect':
        return this.compileReflect(nodeId, getInput);
      case 'Refract':
        return this.compileRefract(nodeId, getInput);
        
      default:
        return null;
    }
  }
  
  /**
   * Get default value for a type
   */
  getDefaultForType(type) {
    switch (type) {
      case 'f32': return '0.0';
      case 'vec2': return 'vec2(0.0)';
      case 'vec3': return 'vec3(0.0)';
      case 'vec4': return 'vec4(0.0)';
      default: return '0.0';
    }
  }
  
  /**
   * Get appropriate one value for a type
   */
  getOneForType(type) {
    switch (type) {
      case 'f32': return '1.0';
      case 'vec2': return 'vec2(1.0)';
      case 'vec3': return 'vec3(1.0)';
      case 'vec4': return 'vec4(1.0)';
      default: return '1.0';
    }
  }
  
  /**
   * Get epsilon value for type (for safe division)
   */
  getEpsilonForType(type) {
    switch (type) {
      case 'f32': return '0.0001';
      case 'vec2': return 'vec2(0.0001)';
      case 'vec3': return 'vec3(0.0001)';
      case 'vec4': return 'vec4(0.0001)';
      default: return '0.0001';
    }
  }
  
  /**
   * Compile binary operations (type-aware)
   */
compileBinaryOp(nodeId, getInput, operator) {
  const aInfo = getInput(0, null, null);
  const bInfo = getInput(1, null, null);
  
  const aType = aInfo.type || 'f32';
  const bType = bInfo.type || 'f32';
  
  // If types don't match, convert both to the larger type
  let targetType = aType;
  if (aType !== bType) {
    const typeRank = { 'f32': 1, 'vec2': 2, 'vec3': 3, 'vec4': 4 };
    targetType = typeRank[aType] > typeRank[bType] ? aType : bType;
  }
  
  const a = aInfo.code || this.getDefaultForType(targetType);
  const b = bInfo.code || this.getDefaultForType(targetType);
  
  // Convert if needed
  const aConverted = aType === targetType ? a : this.convertToType(a, aType, targetType);
  const bConverted = bType === targetType ? b : this.convertToType(b, bType, targetType);
  
  return {
    line: `let node_${nodeId} = (${aConverted}) ${operator} (${bConverted});`,
    outputType: targetType
  };
}

convertToType(expr, fromType, toType) {
  if (fromType === toType) return expr;
  
  if (toType === 'vec2') return `vec2<f32>(${expr})`;
  if (toType === 'vec3') {
    if (fromType === 'vec2') return `vec3<f32>(${expr}, 0.0)`;
    return `vec3<f32>(${expr})`;
  }
  if (toType === 'vec4') {
    if (fromType === 'vec3') return `vec4<f32>(${expr}, 1.0)`;
    if (fromType === 'vec2') return `vec4<f32>(${expr}, 0.0, 1.0)`;
    return `vec4<f32>(${expr})`;
  }
  return expr;
}
  
  /**
   * Compile divide with safety check (type-aware)
   */
  compileDivide(nodeId, getInput) {
    const aInfo = getInput(0, null, null);
    const bInfo = getInput(1, null, null);
    
    const a = aInfo.code || this.getOneForType(aInfo.type || 'f32');
    const b = bInfo.code || this.getOneForType(bInfo.type || 'f32');
    
    const outputType = aInfo.type || bInfo.type || 'f32';
    const epsilon = this.getEpsilonForType(outputType);
    
    return {
      line: `let node_${nodeId} = (${a}) / max((${b}), ${epsilon});`,
      outputType: outputType
    };
  }
  
  /**
   * Compile unary math functions (type-aware)
   */
  compileUnaryMath(nodeId, getInput, funcName) {
    const inpInfo = getInput(0, null, null);
    const inp = inpInfo.code || this.getDefaultForType(inpInfo.type || 'f32');
    const outputType = inpInfo.type || 'f32';
    
    return {
      line: `let node_${nodeId} = ${funcName}(${inp});`,
      outputType: outputType
    };
  }
  
  /**
   * Compile sqrt with safety check (type-aware)
   */
  compileSqrt(nodeId, getInput) {
    const inpInfo = getInput(0, null, null);
    const inp = inpInfo.code || this.getDefaultForType(inpInfo.type || 'f32');
    const outputType = inpInfo.type || 'f32';
    const zero = this.getDefaultForType(outputType);
    
    return {
      line: `let node_${nodeId} = sqrt(max(${inp}, ${zero}));`,
      outputType: outputType
    };
  }
  
  /**
   * Compile binary math functions (type-aware)
   */
  compileBinaryMath(nodeId, getInput, funcName) {
    const aInfo = getInput(0, null, null);
    const bInfo = getInput(1, null, null);
    
    const a = aInfo.code || this.getDefaultForType(aInfo.type || 'f32');
    const b = bInfo.code || this.getDefaultForType(bInfo.type || 'f32');
    
    const outputType = aInfo.type || bInfo.type || 'f32';
    
    return {
      line: `let node_${nodeId} = ${funcName}(${a}, ${b});`,
      outputType: outputType
    };
  }
  
  /**
   * Compile clamp function (type-aware)
   */
  compileClamp(nodeId, getInput) {
    const valueInfo = getInput(0, null, null);
    const minInfo = getInput(1, null, null);
    const maxInfo = getInput(2, null, null);
    
    const outputType = valueInfo.type || 'f32';
    
    const value = valueInfo.code || this.getDefaultForType(outputType);
    const minVal = minInfo.code || this.getDefaultForType(outputType);
    const maxVal = maxInfo.code || this.getOneForType(outputType);
    
    return {
      line: `let node_${nodeId} = clamp(${value}, ${minVal}, ${maxVal});`,
      outputType: outputType
    };
  }
  
  /**
   * Compile smoothstep function (type-aware)
   */
  compileSmoothstep(nodeId, getInput) {
    const edge0Info = getInput(0, null, null);
    const edge1Info = getInput(1, null, null);
    const xInfo = getInput(2, null, null);
    
    const outputType = xInfo.type || 'f32';
    
    const edge0 = edge0Info.code || this.getDefaultForType(outputType);
    const edge1 = edge1Info.code || this.getOneForType(outputType);
    const x = xInfo.code || this.getDefaultForType(outputType);
    
    return {
      line: `let node_${nodeId} = smoothstep(${edge0}, ${edge1}, ${x});`,
      outputType: outputType
    };
  }
  
  /**
   * Compile step function (type-aware)
   */
  compileStep(nodeId, getInput) {
    const edgeInfo = getInput(0, null, null);
    const xInfo = getInput(1, null, null);
    
    const outputType = xInfo.type || 'f32';
    
    const edge = edgeInfo.code || '0.5';
    const x = xInfo.code || this.getDefaultForType(outputType);
    
    return {
      line: `let node_${nodeId} = step(${edge}, ${x});`,
      outputType: outputType
    };
  }
  
  /**
   * Compile mix/lerp function (type-aware)
   */
  compileMix(nodeId, getInput) {
    const aInfo = getInput(0, null, null);
    const bInfo = getInput(1, null, null);
    const tInfo = getInput(2, null, null);
    
    const outputType = aInfo.type || bInfo.type || 'f32';
    
    const a = aInfo.code || this.getDefaultForType(outputType);
    const b = bInfo.code || this.getOneForType(outputType);
    const t = tInfo.code || '0.5';
    
    return {
      line: `let node_${nodeId} = mix(${a}, ${b}, ${t});`,
      outputType: outputType
    };
  }
  
  /**
   * Compile inverse lerp function (always returns scalar)
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
   * Compile saturate function (type-aware)
   */
  compileSaturate(nodeId, getInput) {
    const vInfo = getInput(0, null, null);
    const outputType = vInfo.type || 'f32';
    
    const v = vInfo.code || this.getDefaultForType(outputType);
    const zero = this.getDefaultForType(outputType);
    const one = this.getOneForType(outputType);
    
    return {
      line: `let node_${nodeId} = clamp(${v}, ${zero}, ${one});`,
      outputType: outputType
    };
  }
  
  /**
   * Compile mod function (type-aware)
   */
  compileMod(nodeId, getInput) {
    const aInfo = getInput(0, null, null);
    const bInfo = getInput(1, null, null);
    
    const a = aInfo.code || this.getDefaultForType(aInfo.type || 'f32');
    const b = bInfo.code || this.getOneForType(bInfo.type || 'f32');
    
    const outputType = aInfo.type || bInfo.type || 'f32';
    const epsilon = this.getEpsilonForType(outputType);
    
    return {
      line: `let node_${nodeId} = ${a} - ${b} * floor(${a} / max(${b}, ${epsilon}));`,
      outputType: outputType
    };
  }
  
  /**
   * Compile OneMinus (type-aware)
   */
  compileOneMinus(nodeId, getInput) {
    const xInfo = getInput(0, null, null);
    const outputType = xInfo.type || 'f32';
    
    const x = xInfo.code || this.getDefaultForType(outputType);
    const one = this.getOneForType(outputType);
    
    return {
      line: `let node_${nodeId} = ${one} - (${x});`,
      outputType: outputType
    };
  }
  
  /**
   * Compile Negate (type-aware)
   */
  compileNegate(nodeId, getInput) {
    const xInfo = getInput(0, null, null);
    const x = xInfo.code || this.getDefaultForType(xInfo.type || 'f32');
    const outputType = xInfo.type || 'f32';
    
    return {
      line: `let node_${nodeId} = -(${x});`,
      outputType: outputType
    };
  }
  
  /**
   * Compile Reciprocal (type-aware)
   */
  compileReciprocal(nodeId, getInput) {
    const xInfo = getInput(0, null, null);
    const outputType = xInfo.type || 'f32';
    
    const x = xInfo.code || this.getOneForType(outputType);
    const one = this.getOneForType(outputType);
    const epsilon = this.getEpsilonForType(outputType);
    
    return {
      line: `let node_${nodeId} = ${one} / max(${x}, ${epsilon});`,
      outputType: outputType
    };
  }
  
  // === VECTOR OPERATIONS ===
  
  /**
   * Compile dot product (always returns scalar)
   */
  compileDot(nodeId, getInput) {
    const aInfo = getInput(0, null, null);
    const bInfo = getInput(1, null, null);
    
    // Default to vec3 if no type specified
    const inputType = aInfo.type || bInfo.type || 'vec3';
    
    const a = aInfo.code || this.getDefaultForType(inputType);
    const b = bInfo.code || this.getDefaultForType(inputType);
    
    return {
      line: `let node_${nodeId} = dot(${a}, ${b});`,
      outputType: 'f32'
    };
  }
  
  /**
   * Compile cross product (always vec3)
   */
  compileCross(nodeId, getInput) {
    const aInfo = getInput(0, 'vec3', null);
    const bInfo = getInput(1, 'vec3', null);
    
    const a = aInfo.code || 'vec3(1.0, 0.0, 0.0)';
    const b = bInfo.code || 'vec3(0.0, 1.0, 0.0)';
    
    return {
      line: `let node_${nodeId} = cross(${a}, ${b});`,
      outputType: 'vec3'
    };
  }
  
  /**
   * Compile normalize (type-aware)
   */
  compileNormalize(nodeId, getInput) {
    const vecInfo = getInput(0, null, null);
    const inputType = vecInfo.type || 'vec3';
    
    const vec = vecInfo.code || this.getDefaultForType(inputType);
    
    return {
      line: `let node_${nodeId} = normalize(${vec});`,
      outputType: inputType
    };
  }
  
  /**
   * Compile length (always returns scalar)
   */
  compileLength(nodeId, getInput) {
    const vecInfo = getInput(0, null, null);
    const inputType = vecInfo.type || 'vec3';
    
    const vec = vecInfo.code || this.getDefaultForType(inputType);
    
    return {
      line: `let node_${nodeId} = length(${vec});`,
      outputType: 'f32'
    };
  }
  
  /**
   * Compile distance (always returns scalar)
   */
  compileDistance(nodeId, getInput) {
    const aInfo = getInput(0, null, null);
    const bInfo = getInput(1, null, null);
    
    const inputType = aInfo.type || bInfo.type || 'vec3';
    
    const a = aInfo.code || this.getDefaultForType(inputType);
    const b = bInfo.code || this.getDefaultForType(inputType);
    
    return {
      line: `let node_${nodeId} = distance(${a}, ${b});`,
      outputType: 'f32'
    };
  }
  
  /**
   * Compile reflect (type-aware)
   */
  compileReflect(nodeId, getInput) {
    const iInfo = getInput(0, null, null);
    const nInfo = getInput(1, null, null);
    
    const inputType = iInfo.type || nInfo.type || 'vec3';
    
    const i = iInfo.code || this.getDefaultForType(inputType);
    const n = nInfo.code || this.getDefaultForType(inputType);
    
    return {
      line: `let node_${nodeId} = reflect(${i}, ${n});`,
      outputType: inputType
    };
  }
  
  /**
   * Compile refract (type-aware)
   */
  compileRefract(nodeId, getInput) {
    const iInfo = getInput(0, null, null);
    const nInfo = getInput(1, null, null);
    const etaInfo = getInput(2, 'f32', null);
    
    const inputType = iInfo.type || nInfo.type || 'vec3';
    
    const i = iInfo.code || this.getDefaultForType(inputType);
    const n = nInfo.code || this.getDefaultForType(inputType);
    const eta = etaInfo.code || '1.0';
    
    return {
      line: `let node_${nodeId} = refract(${i}, ${n}, ${eta});`,
      outputType: inputType
    };
  }}