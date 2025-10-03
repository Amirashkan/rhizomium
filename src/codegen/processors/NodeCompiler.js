import { ParameterUniformManager } from '../../gpu/ParameterUniformManager.js';
import { InputNodes } from '../compilers/InputNodes.js';
import { MathNodes } from '../compilers/MathNodes.js';
import { VectorNodes } from '../compilers/VectorNodes.js';
import { NoiseNodes } from '../compilers/NoiseNodes.js';
import { TextureNodes } from '../compilers/TextureNodes.js';
import { UtilityNodes } from '../compilers/UtilityNodes.js';
import { TransformNodes } from '../compilers/TransformNodes.js';
import { FieldNodes } from '../compilers/FieldNodes.js';
import { TypeConverter } from './TypeConverter.js';
import { BlendNodes } from '../compilers/BlendNodes.js';

export class NodeCompiler {
  constructor() {
    this.typeConverter = new TypeConverter();
    this.uniformManager = new ParameterUniformManager();
    this.blendNodes = new BlendNodes();
    this.compilers = {
      input: new InputNodes(),
      math: new MathNodes(),
      vector: new VectorNodes(),
      noise: new NoiseNodes(),
      texture: new TextureNodes(),
      utility: new UtilityNodes(),
      transform: new TransformNodes(),
      blend: new BlendNodes(),
      field: new FieldNodes(),
    };
    
    // Give compilers access to uniform manager
    Object.values(this.compilers).forEach(compiler => {
      if (compiler.setUniformManager) {
        compiler.setUniformManager(this.uniformManager);
      }
    });
    
    // Give FieldNodes access to expression system
    if (this.compilers.field.setExpressionSystem && window.expressionSystem) {
      this.compilers.field.setExpressionSystem(window.expressionSystem);
    }
  }

  sanitize(id) {
    return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
  }

  compileNodes(orderedNodes) {
    this.uniformManager.clear();
    
    const lines = [];
    
    for (const node of orderedNodes) {
      const result = this.compileNode(node);
      if (result.line) {
        lines.push(result.line);
      }
      
      if (node.kind !== "OutputFinal") {
        // NEW: Check if node has multiple output pins
        if (result.outputPins && Array.isArray(result.outputPins)) {
          this.typeConverter.setNodeOutputPins(
            node.id,
            result.outputPins
          );
        } else {
          // Legacy: single output
          this.typeConverter.setNodeOutput(
            node.id,
            `node_${this.sanitize(node.id)}`,
            result.outputType
          );
        }
      }
    }
    
    // ADD LOGGING HERE:
    console.log('=== UNIFORM STRUCT ===');
    console.log(this.uniformManager.generateUniformStruct());
    console.log('=====================');
    
    return {
      lines,
      types: this.typeConverter.types,
      expressions: this.typeConverter.expressions,
      uniformStruct: this.uniformManager.generateUniformStruct(),
      uniformManager: this.uniformManager
    };
  }

  compileNode(node) {
    const nodeId = this.sanitize(node.id);
    const kind = node.kind;
    
    console.log(`Processing node ${nodeId}: kind="${kind}"`);
    
    /**
     * Enhanced getInput function that supports both traditional and type-aware modes
     * FIXED: Now tracks which output pin is connected for multi-output nodes
     * @param {number} index - Input index
     * @param {string|null} targetType - Desired type, or null for type-aware mode
     * @param {string|null} defaultValue - Default value if no input connected
     * @returns {string|Object} - String for traditional mode, {code, type} for type-aware mode
     */
    const getInput = (index, targetType, defaultValue = null) => {
      const inputId = node.inputs?.[index];
      
      if (!inputId) {
        // No input connected - return default
        if (targetType === null || targetType === undefined) {
          // Type-aware mode: return object with code and inferred type
          return {
            code: defaultValue,
            type: this.inferTypeFromDefault(defaultValue)
          };
        } else {
          // Traditional mode: return string
          return defaultValue;
        }
      }
      
      // Input is connected
      // NEW: Find the connection to get which output pin was used
      let nodeIdWithPin = inputId;
      
      if (window.editor?.graph?.connections) {
        const connection = window.editor.graph.connections.find(
          c => c.to.nodeId === node.id && c.to.pin === index
        );
        
        if (connection && connection.from.pin !== undefined && connection.from.pin !== 0) {
          // Append pin index for multi-output nodes (pin 0 is default, no need to append)
          nodeIdWithPin = `${inputId}:${connection.from.pin}`;
          console.log(`Multi-output detected: Using ${nodeIdWithPin} for channel extraction`);
        }
      }
      
      const result = this.typeConverter.convertTo(nodeIdWithPin, targetType);
      
      // Check if result is an object (type-aware mode) or string (traditional mode)
      if (typeof result === 'object' && result !== null && result.code !== undefined) {
        // Type-aware mode: return the object as-is
        return result;
      } else {
        // Traditional mode: return the string
        return result;
      }
    };
    
    // Delegate to appropriate compiler
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
    } else if (this.compilers.transform.handles(kind)) {
      result = this.compilers.transform.compile(node, getInput);
    } else if (this.compilers.field.handles(kind)) {
      result = this.compilers.field.compile(node, getInput);
    } else if (this.compilers.blend.handles(kind)) {
      result = this.compilers.blend.compile(node, getInput);
    } else {
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
  
  /**
   * Infer WGSL type from a default value string
   * @param {string} defaultValue 
   * @returns {string}
   */
  inferTypeFromDefault(defaultValue) {
    if (!defaultValue) return 'f32';
    
    const val = String(defaultValue);
    
    if (val.includes('vec4')) return 'vec4';
    if (val.includes('vec3')) return 'vec3';
    if (val.includes('vec2')) return 'vec2';
    
    // Check for number patterns
    if (/^\d+\.?\d*$/.test(val)) return 'f32';
    
    return 'f32'; // Default to scalar
  }
}