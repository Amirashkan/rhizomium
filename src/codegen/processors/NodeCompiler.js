// src/codegen/processors/NodeCompiler.js
import { TypeConverter } from './TypeConverter.js';
import { InputNodes } from '../compilers/InputNodes.js';
import { MathNodes } from '../compilers/MathNodes.js';
import { VectorNodes } from '../compilers/VectorNodes.js';
import { NoiseNodes } from '../compilers/NoiseNodes.js';
import { TextureNodes } from '../compilers/TextureNodes.js';
import { UtilityNodes } from '../compilers/UtilityNodes.js';

/**
 * Utility function to sanitize node IDs
 * @param {string} id 
 * @returns {string}
 */
function sanitize(id) {
  return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
}

export class NodeCompiler {
  constructor() {
    this.typeConverter = new TypeConverter();
    this.compilers = {
      input: new InputNodes(),
      math: new MathNodes(),
      vector: new VectorNodes(),
      noise: new NoiseNodes(),
      texture: new TextureNodes(),
      utility: new UtilityNodes()
    };
  }
  
  /**
   * Compile all nodes to shader lines
   * @param {Array} orderedNodes 
   * @returns {Object} { lines, types, expressions }
   */
  compileNodes(orderedNodes) {
    const lines = [];
    
    for (const node of orderedNodes) {
      const result = this.compileNode(node);
      if (result.line) {
        lines.push(result.line);
      }
      
      // Store the result for other nodes to reference
      if (node.kind !== "OutputFinal") {
        this.typeConverter.setNodeOutput(
          node.id,
          `node_${sanitize(node.id)}`,
          result.outputType
        );
      }
    }
    
    return {
      lines,
      types: this.typeConverter.types,
      expressions: this.typeConverter.expressions
    };
  }
  
  /**
   * Compile a single node
   * @param {Object} node 
   * @returns {Object} { line, outputType }
   */
  compileNode(node) {
    const nodeId = sanitize(node.id);
    const kind = node.kind;
    
    console.log(`Processing node ${nodeId}: kind="${kind}"`);
    
    // Helper function to get input with type conversion
    const getInput = (index, targetType, defaultValue = null) => {
      const inputId = node.inputs?.[index];
      if (inputId) {
        return this.typeConverter.convertTo(inputId, targetType);
      }
      return defaultValue;
    };
    
    // Delegate to appropriate compiler based on node type
    let result = null;
    
    if (this.compilers.input.handles(kind)) {
      result = this.compilers.input.compile(node, getInput);
    } else if (this.compilers.math.handles(kind)) {
      result = this.compilers.math.compile(node, getInput);
    } else if (this.compilers.vector.handles(kind)) {
      result = this.compilers.vector.compile(node, getInput);
    } else if (this.compilers.noise.handles(kind)) {
      result = this.compilers.noise.compile(node, getInput);
    } else if (this.compilers.texture.handles(kind)) {
      result = this.compilers.texture.compile(node, getInput);
    } else if (this.compilers.utility.handles(kind)) {
      result = this.compilers.utility.compile(node, getInput);
    } else {
      // Unknown node type
      console.log(`UNKNOWN NODE TYPE: "${kind}"`);
      result = {
        line: `let node_${nodeId} = vec3<f32>(0.0);`,
        outputType: "vec3"
      };
    }
    
    if (result && result.line) {
      console.log(`Generated line for ${kind}: ${result.line}`);
    }
    
    return result || { line: "", outputType: "vec3" };
  }
}