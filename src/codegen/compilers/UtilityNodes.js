// src/codegen/compilers/UtilityNodes.js
export class UtilityNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    return ['OutputFinal'].includes(kind);
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
      default:
        return null;
    }
  }
  
  /**
   * Compile final output node
   */
  compileOutputFinal(node, getInput, nodeId) {
    const color = getInput(0, "vec3", "vec3<f32>(0.0,0.0,0.0)");
    const line = `finalColor = ${color};`;
    console.log(`OutputFinal line: ${line}`);
    
    return {
      line,
      outputType: "vec3"
    };
  }
}