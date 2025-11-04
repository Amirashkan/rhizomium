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
      'Mouse', 'Resolution', 'Pi', 'RandomTime'
    ].includes(kind);
  }
  
  /**
   * Compile input nodes
   * @param {Object} node
   * @param {Function} getInput
   * @param {Function} getParam - Resolves parameter values (including node references)
   * @returns {Object} { line, outputType }
   */
  compile(node, getInput, getParam = null) {
    const nodeId = node.id.replace(/[^a-zA-Z0-9_]/g, "_");

    // Fallback for when getParam is not provided (backwards compatibility)
    const resolveParam = getParam || ((paramName, defaultValue) => {
      const value = node.params?.[paramName];
      if (typeof value === 'number') return value.toFixed(6);
      const parsed = parseFloat(value);
      return isNaN(parsed) ? defaultValue : parsed.toFixed(6);
    });

    switch (node.kind) {
      case 'UV':
        return {
          line: `let node_${nodeId} = in.uv;`,
          outputType: "vec2"
        };

      case 'Time':
        return {
          line: `let node_${nodeId} = g.time;`,
          outputType: "f32"
        };

      case 'ConstFloat': {
        const value = resolveParam('value', '0.0');
        return {
          line: `let node_${nodeId} = ${value};`,
          outputType: "f32"
        };
      }

      case 'ConstVec2': {
        const x = resolveParam('x', '0.0');
        const y = resolveParam('y', '0.0');
        return {
          line: `let node_${nodeId} = vec2<f32>(${x}, ${y});`,
          outputType: "vec2"
        };
      }

      case 'ConstVec3': {
        const x = resolveParam('x', '0.0');
        const y = resolveParam('y', '0.0');
        const z = resolveParam('z', '0.0');
        return {
          line: `let node_${nodeId} = vec3<f32>(${x}, ${y}, ${z});`,
          outputType: "vec3"
        };
      }

      case 'ConstVec4': {
        const x = resolveParam('x', '0.0');
        const y = resolveParam('y', '0.0');
        const z = resolveParam('z', '0.0');
        const w = resolveParam('w', '1.0');
        return {
          line: `let node_${nodeId} = vec4<f32>(${x}, ${y}, ${z}, ${w});`,
          outputType: "vec4"
        };
      }
        
      case 'Mouse':
        return {
          line: `let node_${nodeId} = vec2<f32>(0.0, 0.0);`,
          outputType: "vec2"
        };
        
      case 'Resolution':
        return {
          line: `let node_${nodeId} = g.resolution;`,
          outputType: "vec2"
        };
        
      case 'Pi':
        return {
          line: `let node_${nodeId} = 3.14159265359;`,
          outputType: "f32"
        };

      case 'RandomTime': {
        const speed = resolveParam('speed', '1.0');
        return {
          line: `let node_${nodeId} = fract(sin(g.time * ${speed} * 12.9898) * 43758.5453);`,
          outputType: "f32"
        };
      }

      default:
        return null;
    }
  }
}
