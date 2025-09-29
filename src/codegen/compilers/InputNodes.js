// src/codegen/compilers/InputNodes.js
export class InputNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    return [
      'UV', 'Time', 'ConstFloat', 'ConstVec2', 'ConstVec3', 'ConstVec4',
      'Mouse', 'Resolution', 'Pi'
    ].includes(kind);
  }
  
  /**
   * Compile input nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");
    
    switch (node.kind) {
      case 'UV':
        return {
          line: `let node_${nodeId} = in.uv;`,
          outputType: "vec2"
        };
        
      case 'Time':
        return {
          line: `let node_${nodeId} = u.time;`,
          outputType: "f32"
        };
        
      case 'ConstFloat':
        const floatValue = typeof node.value === "number" ? node.value : (node.params?.value ?? 0.0);
        return {
          line: `let node_${nodeId} = ${floatValue.toFixed(6)};`,
          outputType: "f32"
        };
        
      case 'ConstVec2':
        const x2 = parseFloat(node.params?.x) || 0;
        const y2 = parseFloat(node.params?.y) || 0;
        return {
          line: `let node_${nodeId} = vec2<f32>(${x2.toFixed(6)}, ${y2.toFixed(6)});`,
          outputType: "vec2"
        };
        
      case 'ConstVec3':
        const x3 = parseFloat(node.params?.x) || 0;
        const y3 = parseFloat(node.params?.y) || 0;
        const z3 = parseFloat(node.params?.z) || 0;
        return {
          line: `let node_${nodeId} = vec3<f32>(${x3.toFixed(6)}, ${y3.toFixed(6)}, ${z3.toFixed(6)});`,
          outputType: "vec3"
        };
        
      case 'ConstVec4':
        const x4 = parseFloat(node.params?.x) || 0;
        const y4 = parseFloat(node.params?.y) || 0;
        const z4 = parseFloat(node.params?.z) || 0;
        const w4 = parseFloat(node.params?.w) || 1;
        return {
          line: `let node_${nodeId} = vec4<f32>(${x4.toFixed(6)}, ${y4.toFixed(6)}, ${z4.toFixed(6)}, ${w4.toFixed(6)});`,
          outputType: "vec4"
        };
        
      case 'Mouse':
        return {
          line: `let node_${nodeId} = u.mouse;`,
          outputType: "vec2"
        };
        
      case 'Resolution':
        return {
          line: `let node_${nodeId} = u.resolution;`,
          outputType: "vec2"
        };
        
      case 'Pi':
        return {
          line: `let node_${nodeId} = 3.14159265359;`,
          outputType: "f32"
        };
        
      default:
        return null;
    }
  }
}