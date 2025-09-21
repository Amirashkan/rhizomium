// src/codegen/compilers/InputNodes.js
export class InputNodes {
  /**
   * Check if this compiler handles the given node kind
   * @param {string} kind 
   * @returns {boolean}
   */
  handles(kind) {
    return ['UV', 'Time', 'ConstFloat', 'ConstVec3', 'Expr'].includes(kind);
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
        const floatValue = typeof node.value === "number" ? node.value : (node.props?.value ?? 0.0);
        return {
          line: `let node_${nodeId} = ${floatValue.toFixed(6)};`,
          outputType: "f32"
        };
        
      case 'ConstVec3':
        const x = parseFloat(node.props?.x) || 0;
        const y = parseFloat(node.props?.y) || 0;
        const z = parseFloat(node.props?.z) || 0;
        return {
          line: `let node_${nodeId} = vec3<f32>(${x.toFixed(6)}, ${y.toFixed(6)}, ${z.toFixed(6)});`,
          outputType: "vec3"
        };
        
      case 'Expr':
        return this.compileExpression(node, getInput, nodeId);
        
      default:
        return null;
    }
  }
  
  /**
   * Compile expression nodes
   * @param {Object} node 
   * @param {Function} getInput 
   * @param {string} nodeId 
   * @returns {Object}
   */
  compileExpression(node, getInput, nodeId) {
    const a = getInput(0, "f32", "0.0");
    const b = getInput(1, "f32", "0.0");
    let expr = (node.expr || "a").toString();
    
    console.log("Original expression:", expr);
    
    // Replace variables with connected inputs FIRST
    expr = expr.replace(/\ba\b/g, `(${a})`);
    expr = expr.replace(/\bb\b/g, `(${b})`);
    
    // Replace time and UV references
    expr = expr.replace(/\bu_time\b/g, "u.time");
    expr = expr.replace(/\buv\b/g, "in.uv");
    
    // Replace constants
    expr = expr.replace(/\bpi\b/g, "3.14159265359");
    expr = expr.replace(/\bPI\b/g, "3.14159265359");
    
    console.log("Final WGSL expression:", expr);
    
    return {
      line: `let node_${nodeId} = ${expr};`,
      outputType: "f32"
    };
  }
}