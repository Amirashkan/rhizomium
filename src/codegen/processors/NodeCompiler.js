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

export class NodeCompiler {
  constructor() {
    this.typeConverter = new TypeConverter();
    this.uniformManager = new ParameterUniformManager();
    
    this.compilers = {
      input: new InputNodes(),
      math: new MathNodes(),
      vector: new VectorNodes(),
      noise: new NoiseNodes(),
      texture: new TextureNodes(),
      utility: new UtilityNodes(),
      transform: new TransformNodes(),
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
        this.typeConverter.setNodeOutput(
          node.id,
          `node_${this.sanitize(node.id)}`,
          result.outputType
        );
      }
    }
    
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
    
    const getInput = (index, targetType, defaultValue = null) => {
      const inputId = node.inputs?.[index];
      if (inputId) {
        return this.typeConverter.convertTo(inputId, targetType);
      }
      return defaultValue;
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
}