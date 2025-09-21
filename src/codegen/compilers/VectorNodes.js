// src/codegen/compilers/VectorNodes.js
export class VectorNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    const vectorNodes = [
      'Dot', 'Cross', 'Normalize', 'Length', 'Distance',
      'Reflect', 'Refract', 'Split3', 'Combine3'
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
      case 'Split3':
        return this.compileSplit3(nodeId, getInput);
      case 'Combine3':
        return this.compileCombine3(nodeId, getInput);
      default:
        return null;
    }
  }
  
  /**
   * Compile dot product
   */
  compileDot(nodeId, getInput) {
    const a = getInput(0, "vec3", "vec3<f32>(1.0, 0.0, 0.0)");
    const b = getInput(1, "vec3", "vec3<f32>(0.0, 1.0, 0.0)");
    return {
      line: `let node_${nodeId} = dot(${a}, ${b});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile cross product
   */
  compileCross(nodeId, getInput) {
    const a = getInput(0, "vec3", "vec3<f32>(1.0, 0.0, 0.0)");
    const b = getInput(1, "vec3", "vec3<f32>(0.0, 1.0, 0.0)");
    return {
      line: `let node_${nodeId} = cross(${a}, ${b});`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile normalize
   */
  compileNormalize(nodeId, getInput) {
    const vec = getInput(0, "vec3", "vec3<f32>(1.0, 0.0, 0.0)");
    return {
      line: `let node_${nodeId} = normalize(${vec});`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile length
   */
  compileLength(nodeId, getInput) {
    const vec = getInput(0, "vec3", "vec3<f32>(0.0)");
    return {
      line: `let node_${nodeId} = length(${vec});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile distance
   */
  compileDistance(nodeId, getInput) {
    const a = getInput(0, "vec3", "vec3<f32>(0.0)");
    const b = getInput(1, "vec3", "vec3<f32>(0.0)");
    return {
      line: `let node_${nodeId} = distance(${a}, ${b});`,
      outputType: "f32"
    };
  }
  
  /**
   * Compile reflect
   */
  compileReflect(nodeId, getInput) {
    const incident = getInput(0, "vec3", "vec3<f32>(1.0, -1.0, 0.0)");
    const normal = getInput(1, "vec3", "vec3<f32>(0.0, 1.0, 0.0)");
    return {
      line: `let node_${nodeId} = reflect(${incident}, ${normal});`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile refract
   */
  compileRefract(nodeId, getInput) {
    const incident = getInput(0, "vec3", "vec3<f32>(1.0, -1.0, 0.0)");
    const normal = getInput(1, "vec3", "vec3<f32>(0.0, 1.0, 0.0)");
    const eta = getInput(2, "f32", "1.5");
    return {
      line: `let node_${nodeId} = refract(${incident}, ${normal}, ${eta});`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile split3 (splits vec3 into components)
   */
  compileSplit3(nodeId, getInput) {
    const vec = getInput(0, "vec3", "vec3<f32>(0.0)");
    // Note: Split3 needs special handling as it has multiple outputs
    return {
      line: `let node_${nodeId} = ${vec};`,
      outputType: "vec3"
    };
  }
  
  /**
   * Compile combine3 (combines scalars into vec3)
   */
  compileCombine3(nodeId, getInput) {
    const x = getInput(0, "f32", "0.0");
    const y = getInput(1, "f32", "0.0");
    const z = getInput(2, "f32", "0.0");
    return {
      line: `let node_${nodeId} = vec3<f32>(${x}, ${y}, ${z});`,
      outputType: "vec3"
    };
  }
}