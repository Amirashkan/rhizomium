// src/codegen/compilers/VectorNodes.js
export class VectorNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    const vectorNodes = [
      // Vector Math
      'Dot', 'Cross', 'Normalize', 'Length', 'Distance', 'Reflect', 'Refract',
      // Component Operations
      'Split2', 'Split3', 'Split4', 'Combine2', 'Combine3', 'Combine4',
      // Vector Arithmetic
      'VectorAdd', 'VectorSubtract', 'VectorMultiply', 'VectorDivide', 'VectorScale',
      // Swizzle
      'Swizzle'
    ];
    return vectorNodes.includes(kind);
  }
  
  /**
   * Compile vector nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      // Vector Math Operations
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
        
      // Component Operations
      case 'Split2':
        return this.compileSplit2(nodeId, getInput);
      case 'Split3':
        return this.compileSplit3(nodeId, getInput);
      case 'Split4':
        return this.compileSplit4(nodeId, getInput);
      case 'Combine2':
        return this.combineCombine2(nodeId, getInput);
      case 'Combine3':
        return this.compileCombine3(nodeId, getInput);
      case 'Combine4':
        return this.compileCombine4(nodeId, getInput);
        
      // Vector Arithmetic
      case 'VectorAdd':
        return this.compileVectorBinary(nodeId, getInput, '+', 'vec3');
      case 'VectorSubtract':
        return this.compileVectorBinary(nodeId, getInput, '-', 'vec3');
      case 'VectorMultiply':
        return this.compileVectorBinary(nodeId, getInput, '*', 'vec3');
      case 'VectorDivide':
        return this.compileVectorDivide(nodeId, getInput);
      case 'VectorScale':
        return this.compileVectorScale(nodeId, getInput);
        
      // Swizzle
      case 'Swizzle':
        return this.compileSwizzle(node, getInput, nodeId);
        
      default:
        return null;
    }
  }
  
  // Vector Math Operations
  compileDot(nodeId, getInput) {
    const a = getInput(0, "vec3", "vec3<f32>(1.0, 0.0, 0.0)");
    const b = getInput(1, "vec3", "vec3<f32>(0.0, 1.0, 0.0)");
    return {
      line: `let node_${nodeId} = dot(${a}, ${b});`,
      outputType: "f32"
    };
  }
  
  compileCross(nodeId, getInput) {
    const a = getInput(0, "vec3", "vec3<f32>(1.0, 0.0, 0.0)");
    const b = getInput(1, "vec3", "vec3<f32>(0.0, 1.0, 0.0)");
    return {
      line: `let node_${nodeId} = cross(${a}, ${b});`,
      outputType: "vec3"
    };
  }
  
  compileNormalize(nodeId, getInput) {
    const vec = getInput(0, "vec3", "vec3<f32>(1.0, 0.0, 0.0)");
    return {
      line: `let node_${nodeId} = normalize(${vec});`,
      outputType: "vec3"
    };
  }
  
  compileLength(nodeId, getInput) {
    const vec = getInput(0, "vec3", "vec3<f32>(0.0)");
    return {
      line: `let node_${nodeId} = length(${vec});`,
      outputType: "f32"
    };
  }
  
  compileDistance(nodeId, getInput) {
    const a = getInput(0, "vec3", "vec3<f32>(0.0)");
    const b = getInput(1, "vec3", "vec3<f32>(0.0)");
    return {
      line: `let node_${nodeId} = distance(${a}, ${b});`,
      outputType: "f32"
    };
  }
  
  compileReflect(nodeId, getInput) {
    const incident = getInput(0, "vec3", "vec3<f32>(1.0, -1.0, 0.0)");
    const normal = getInput(1, "vec3", "vec3<f32>(0.0, 1.0, 0.0)");
    return {
      line: `let node_${nodeId} = reflect(${incident}, ${normal});`,
      outputType: "vec3"
    };
  }
  
  compileRefract(nodeId, getInput) {
    const incident = getInput(0, "vec3", "vec3<f32>(1.0, -1.0, 0.0)");
    const normal = getInput(1, "vec3", "vec3<f32>(0.0, 1.0, 0.0)");
    const eta = getInput(2, "f32", "1.5");
    return {
      line: `let node_${nodeId} = refract(${incident}, ${normal}, ${eta});`,
      outputType: "vec3"
    };
  }
  
  // Component Operations
  compileSplit2(nodeId, getInput) {
    const vec = getInput(0, "vec2", "vec2<f32>(0.0)");
    return {
      line: `let node_${nodeId} = ${vec};`,
      outputType: "vec2"
    };
  }
  
  compileSplit3(nodeId, getInput) {
    const vec = getInput(0, "vec3", "vec3<f32>(0.0)");
    return {
      line: `let node_${nodeId} = ${vec};`,
      outputType: "vec3"
    };
  }
  
  compileSplit4(nodeId, getInput) {
    const vec = getInput(0, "vec4", "vec4<f32>(0.0)");
    return {
      line: `let node_${nodeId} = ${vec};`,
      outputType: "vec4"
    };
  }
  
  combineCombine2(nodeId, getInput) {
    const x = getInput(0, "f32", "0.0");
    const y = getInput(1, "f32", "0.0");
    return {
      line: `let node_${nodeId} = vec2<f32>(${x}, ${y});`,
      outputType: "vec2"
    };
  }
  
  compileCombine3(nodeId, getInput) {
    const x = getInput(0, "f32", "0.0");
    const y = getInput(1, "f32", "0.0");
    const z = getInput(2, "f32", "0.0");
    return {
      line: `let node_${nodeId} = vec3<f32>(${x}, ${y}, ${z});`,
      outputType: "vec3"
    };
  }
  
  compileCombine4(nodeId, getInput) {
    const x = getInput(0, "f32", "0.0");
    const y = getInput(1, "f32", "0.0");
    const z = getInput(2, "f32", "0.0");
    const w = getInput(3, "f32", "1.0");
    return {
      line: `let node_${nodeId} = vec4<f32>(${x}, ${y}, ${z}, ${w});`,
      outputType: "vec4"
    };
  }
  
  // Vector Arithmetic
  compileVectorBinary(nodeId, getInput, operator, type) {
    const a = getInput(0, type, `${type}<f32>(0.0)`);
    const b = getInput(1, type, `${type}<f32>(0.0)`);
    return {
      line: `let node_${nodeId} = (${a}) ${operator} (${b});`,
      outputType: type
    };
  }
  
  compileVectorDivide(nodeId, getInput) {
    const a = getInput(0, "vec3", "vec3<f32>(1.0)");
    const b = getInput(1, "vec3", "vec3<f32>(1.0)");
    return {
      line: `let node_${nodeId} = (${a}) / max((${b}), vec3<f32>(0.0001));`,
      outputType: "vec3"
    };
  }
  
  compileVectorScale(nodeId, getInput) {
    const vec = getInput(0, "vec3", "vec3<f32>(1.0)");
    const scale = getInput(1, "f32", "1.0");
    return {
      line: `let node_${nodeId} = (${vec}) * (${scale});`,
      outputType: "vec3"
    };
  }
  
  compileSwizzle(node, getInput, nodeId) {
    const vec = getInput(0, "vec3", "vec3<f32>(0.0)");
    const pattern = node.params?.pattern || "xyz";
    return {
      line: `let node_${nodeId} = (${vec}).${pattern};`,
      outputType: "vec3"
    };
  }
}