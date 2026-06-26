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
import { GradientNodes } from '../compilers/GradientNodes.js';
import { ComputeNodes } from '../compilers/ComputeNodes.js';
import { UnifiedExpressionSystem } from '../../utils/UnifiedExpressionSystem.js';

export class NodeCompiler {
  constructor() {
    this.typeConverter = new TypeConverter();
    this.uniformManager = new ParameterUniformManager();
    this.shaderExpressionSystem = new UnifiedExpressionSystem();
    this.compilers = {
      input: new InputNodes(),
      math: new MathNodes(),
      vector: new VectorNodes(),
      noise: new NoiseNodes(),
      texture: new TextureNodes(),
      gradient: new GradientNodes(),
      utility: new UtilityNodes(),
      transform: new TransformNodes(),
      blend: new BlendNodes(),
      field: new FieldNodes(),
      compute: new ComputeNodes(),
    };
    
    // Give compilers access to uniform manager
    Object.values(this.compilers).forEach(compiler => {
      if (compiler.setUniformManager) {
        compiler.setUniformManager(this.uniformManager);
      }
    });
    
    // Give compilers access to expression system when available
    if (window.expressionSystem) {
      Object.values(this.compilers).forEach(compiler => {
        if (compiler.setExpressionSystem) {
          compiler.setExpressionSystem(window.expressionSystem);
        }
      });
    }
  }

  sanitize(id) {
    return String(id).replace(/[^a-zA-Z0-9_]/g, "_");
  }

  /**
   * Register a parameter as a uniform and return the uniform reference
   * This is the key function that converts baked parameters to uniforms!
   * @param {object} node - The node object
   * @param {string} paramName - The parameter name
   * @param {*} defaultValue - Default value if parameter doesn't exist
   * @returns {string} - WGSL uniform reference like "u_params._4_scale"
   */
  registerParameterAsUniform(node, paramName, defaultValue = 0.0) {
    const paramValue = node.params?.[paramName];
    let value = paramValue !== undefined && paramValue !== null ? paramValue : defaultValue;

    // Parse string values to numbers
    if (typeof value === 'string') {
      // Check if it's an expression (starts with =)
      if (value.trim().startsWith('=')) {
        // Handle expressions separately - they don't become uniforms
        return null;
      }
      const parsed = parseFloat(value);
      value = isNaN(parsed) ? defaultValue : parsed;
    }

    // Convert to number
    if (typeof value !== 'number') {
      value = defaultValue;
    }

    // Ensure finite value
    if (!isFinite(value)) {
      value = 0.0;
    }

    // Register with uniform manager
    const paramKey = `${node.id}.${paramName}`;
    this.uniformManager.uniformValues.set(paramKey, value);

    // Generate uniform reference
    const sanitizedName = paramKey.replace(/[^a-zA-Z0-9_]/g, '_');
    const fieldName = sanitizedName.startsWith('_') ? sanitizedName : `_${sanitizedName}`;
    return `u_params.${fieldName}`;
  }

  /**
   * Resolves a parameter value that might be a node reference or expression
   * Supports: =node_X, =node_X_x, =node_X_y, =sin(time), etc.
   * @param {*} paramValue - The parameter value (could be a number, string, or expression)
   * @param {string} defaultValue - Default value if not a node reference
   * @returns {string} - WGSL code to use for this parameter
   */
  resolveParameterValue(paramValue, defaultValue = '0.0') {
    // If it's a number, return it as-is
    if (typeof paramValue === 'number') {
      return paramValue.toFixed(6);
    }

    // If it's not a string, return default
    if (typeof paramValue !== 'string') {
      return defaultValue;
    }

    // Check if it's an expression (starts with =)
    if (!paramValue.trim().startsWith('=')) {
      // Try to parse as number
      const parsed = parseFloat(paramValue);
      return isNaN(parsed) ? defaultValue : parsed.toFixed(6);
    }

    // It's an expression - extract the part after =
    const expression = paramValue.trim().slice(1).trim();
    const fallback = typeof defaultValue === 'number' ? defaultValue.toFixed(6) : defaultValue;

    // Check if it's a simple node reference pattern: node_X or node_X_component
    if (/^node_\w*$/.test(expression)) {
      const resolved = this.resolveNodeReference(expression);
      // Unknown or incomplete reference (e.g. "=node_" while the user is still
      // typing) - fall back to the default instead of emitting invalid WGSL
      return resolved !== null ? resolved : fallback;
    }

    // For complex expressions (e.g., sin(time), node_5 * 2, etc.), use the expression system.
    // Validate every node reference first: an unresolved identifier like "node_"
    // would otherwise be emitted verbatim and break the whole shader module.
    try {
      const variableMapping = {};
      const refs = expression.match(/\bnode_\w*/g) || [];
      for (const ref of new Set(refs)) {
        const resolved = this.resolveNodeReference(ref);
        if (resolved === null) {
          return fallback;
        }
        variableMapping[ref] = resolved;
      }

      const shaderCode = this.shaderExpressionSystem.generateShader(expression, variableMapping);
      return shaderCode;
    } catch (error) {

      return fallback;
    }
  }

  /**
   * Resolve a "node_X" / "node_X_x" reference to the WGSL expression of an
   * already-compiled node, or null if it doesn't name a known node.
   * @param {string} ref - Full reference text, e.g. "node_5" or "node_5_x"
   * @returns {string|null}
   */
  resolveNodeReference(ref) {
    const refText = ref.slice('node_'.length);
    if (!refText) return null;

    // Direct reference: node_5
    if (this.typeConverter.expressions.has(refText)) {
      return this.typeConverter.expressions.get(refText);
    }

    // Component access: node_5_x → node_5.x
    const compMatch = refText.match(/^(\w+)_(x|y|z|w)$/);
    if (compMatch) {
      const [, baseId, component] = compMatch;
      if (this.typeConverter.expressions.has(baseId)) {
        const expr = this.typeConverter.expressions.get(baseId);
        const type = this.typeConverter.types.get(baseId);
        // Scalars have no components to access
        return type === 'f32' ? expr : `${expr}.${component}`;
      }
    }

    return null;
  }

  compileNodes(orderedNodes, graph = null) {
    // Hand the graph being compiled to child compilers so they can resolve node
    // references (e.g. a parameter expression referencing a Mouse/Time node) against
    // it, instead of relying on the ambient window.editor.graph which is unavailable
    // in the external viewer / studio context.
    this.currentGraph = graph;
    Object.values(this.compilers).forEach((compiler) => {
      if (compiler.setGraph) {
        compiler.setGraph(graph);
      }
      // Hand compilers the TypeConverter so they can resolve the type of a node referenced
      // by a parameter expression (e.g. a vec2 node referenced into a scalar param) and coerce
      // it, rather than emitting a type-mismatched call.
      if (compiler.setTypeConverter) {
        compiler.setTypeConverter(this.typeConverter);
      }
    });

    this.uniformManager.clear();
    // Clear stale type/expression/pin data so nodes excluded from this pass
    // cannot be referenced by downstream nodes via the previous run's outputPins.
    this.typeConverter.clear();

    if (this.compilers.utility?.resetHelperTracking) {
      this.compilers.utility.resetHelperTracking();
    }

    // Reset noise function tracking before compilation
    if (this.compilers.noise?.resetTracking) {
      this.compilers.noise.resetTracking();
    }

    const lines = [];
    let usesNoise = false;
    
    for (const node of orderedNodes) {
      if (this.compilers.noise.handles(node.kind)) {
        usesNoise = true;
      }

      const result = this.compileNode(node);
      if (result.line) {
        lines.push(result.line);
      }

      if (node.kind !== "OutputFinal" && result.outputType !== "skip") {
        // Skip registering nodes with outputType "skip" (e.g., ComputeFieldMapper)
        // These nodes don't produce shader variables

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

    return {
      lines,
      types: this.typeConverter.types,
      expressions: this.typeConverter.expressions,
      uniformStruct: this.uniformManager.generateUniformStruct(),
      uniformManager: this.uniformManager,
      usesNoise,
    };
  }

  compileNode(node) {
    const nodeId = this.sanitize(node.id);
    const kind = node.kind;

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

    // Helper to resolve parameter values (including node references)
    // UPDATED: Now registers parameters as uniforms for performance!
    const getParam = (paramName, defaultValue = '0.0') => {
      const paramValue = node.params?.[paramName];

      // Check if it's an expression or node reference
      if (typeof paramValue === 'string' && paramValue.trim().startsWith('=')) {
        // Handle expressions (like =sin(time) or =node_X) - use resolveParameterValue
        return this.resolveParameterValue(paramValue, defaultValue);
      }

      // Regular numeric parameters: register as uniform
      const uniformRef = this.registerParameterAsUniform(node, paramName, typeof defaultValue === 'number' ? defaultValue : parseFloat(defaultValue) || 0.0);

      // If registration succeeded, return uniform reference
      // Otherwise fall back to baked value (for edge cases)
      return uniformRef || this.resolveParameterValue(paramValue, defaultValue);
    };

    // BYPASS: a bypassed node passes its first input straight through, skipping its own
    // processing. OutputFinal is a sink and is never bypassed here. Compute nodes are bypassed at
    // the texture level in ComputeExecutor (their output texture is aliased to the input), so they
    // keep their normal texture-sampling codegen. A node with no connected input passes the
    // default (vec3(0)) — effectively muting it.
    if (node.bypassed && kind !== 'OutputFinal' && !this.compilers.compute.handles(kind)) {
      const passthrough = getInput(0, null, 'vec3<f32>(0.0)');
      const code = (passthrough && typeof passthrough === 'object') ? passthrough.code : passthrough;
      const type = (passthrough && typeof passthrough === 'object') ? passthrough.type : 'vec3';
      return {
        line: `let node_${nodeId} = ${code};`,
        outputType: type || 'vec3',
      };
    }

    // Delegate to appropriate compiler
    let result = null;

    if (this.compilers.input.handles(kind)) {
      result = this.compilers.input.compile(node, getInput, getParam);
    } else if (this.compilers.math.handles(kind)) {
      result = this.compilers.math.compile(node, getInput, getParam);
    } else if (this.compilers.vector.handles(kind)) {
      result = this.compilers.vector.compile(node, getInput, getParam);
    } else if (this.compilers.noise.handles(kind)) {
      result = this.compilers.noise.compile(node, getInput, getParam);
    } else if (this.compilers.texture.handles(kind)) {
      result = this.compilers.texture.compile(node, getInput, getParam);
    } else if (this.compilers.compute.handles(kind)) {
      result = this.compilers.compute.compile(node, getInput, getParam);
    } else if (this.compilers.utility.handles(kind)) {
      result = this.compilers.utility.compile(node, getInput, getParam);
    } else if (this.compilers.transform.handles(kind)) {
      result = this.compilers.transform.compile(node, getInput, getParam);
    } else if (this.compilers.field.handles(kind)) {
      result = this.compilers.field.compile(node, getInput, getParam);
    } else if (this.compilers.blend.handles(kind)) {
      result = this.compilers.blend.compile(node, getInput, getParam);
    } else if (kind === 'ComputeFieldMapper') {
      // ComputeFieldMapper is a 3D visualization node, not a shader node
      // It outputs 3D geometry to the viewport, not 2D shader data
      // Skip it in shader compilation - it will be handled by FieldMapperIntegration
      result = {
        line: `// ComputeFieldMapper node_${nodeId} (3D visualization - outputs to viewport)`,
        outputType: "skip"
      };
    } else {
      result = {
        line: `let node_${nodeId} = vec3<f32>(0.0);`,
        outputType: "vec3"
      };
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
