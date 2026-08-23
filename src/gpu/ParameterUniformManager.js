import { getExternalReading } from '../parameters/ExternalParameterControl.js';
import { NodeDefs } from '../data/NodeDefs.js';

/**
 * Manages dynamic parameter uniforms for shader compilation
 * Detects which parameters need uniforms vs. baked values
 */
export class ParameterUniformManager {
  constructor() {
    this.uniformParameters = new Map(); // nodeId -> Set of param names
    this.uniformValues = new Map();
    this.dynamicParams = new Set(); 
    this.uniformBuffer = null;
    this.uniformBindGroup = null;
    this.needsUpdate = true;
  }

  /**
   * Analyze a node to determine which parameters need uniforms
   */
// In ParameterUniformManager.js

analyzeNode(node) {

  // inside analyzeNode(node)
  for (const [paramName, paramValue] of Object.entries(node.params || {})) {
    let value = paramValue;
    if (typeof value === "number" && !isFinite(value)) value = 0.0;

    // prevent negative geometry params only
    const key = paramName.toLowerCase();
    if ((key.includes("radius") || key.includes("width") || key.includes("height")) && value < 0)
      value = Math.abs(value);
    if (typeof value === 'number' && Math.abs(value) < 1e-6) value = 0.0;

    // normalize negative radius-like params
    if (paramName.toLowerCase().includes('radius') && value < 0)
      value = Math.abs(value);

    node.params[paramName] = value; // write back normalized value

    // Check if this parameter needs a GPU uniform:
    // 1. Externally controlled parameters (MIDI, OSC) always need uniforms, so
    //    a new reading is a buffer write rather than a shader rebuild
    // 2. Compute node parameters need uniforms for external viewer streaming
    //    BUT exclude metadata params like 'resolution' which aren't shader uniforms
    const midiBinding = window.editor?.midiBinding;
    const oscBinding = window.editor?.oscBinding;
    const isExternallyControlled =
      (midiBinding && midiBinding.shouldUseUniform(node.id, paramName)) ||
      (oscBinding && oscBinding.shouldUseUniform(node.id, paramName));
    const isComputeNode = node.kind && node.kind.startsWith('Compute');
    // A node whose definition declares `alwaysUniform` keeps every parameter in
    // the uniform buffer regardless of how it is driven. ProjectionMap needs this:
    // its corner matrices change continuously while a projector is being aligned,
    // and a baked value would mean recompiling the shader on every mousemove.
    const alwaysUniform = !!NodeDefs[node.kind]?.alwaysUniform;

    // Exclude non-uniform parameters (metadata params that aren't sent to shaders)
    const nonUniformParams = ['resolution', 'mode']; // mode is baked into shader at compile time
    const isNonUniform = nonUniformParams.includes(paramName);

    if ((isExternallyControlled || isComputeNode || alwaysUniform) && !isNonUniform) {
      const paramKey = `${node.id}.${paramName}`;

      // Convert value to numeric, handling booleans properly
      let numericValue;
      if (typeof value === 'number') {
        numericValue = value;
      } else if (typeof value === 'boolean') {
        numericValue = value ? 1.0 : 0.0;
      } else {
        numericValue = parseFloat(value);
        if (!Number.isFinite(numericValue)) {
          // An externally controlled parameter holding an expression ("=midi + sin(time)") has no
          // number to parse: its uniform carries the controller's raw READING, which is what the
          // inlined `midi`/`osc` identifier reads. parseFloat gives NaN here, and the old `|| 0`
          // zeroed the controller on every recompile — the render snapped back as soon as anything
          // else in the patch changed. Fall back to the live reading, then to whatever the uniform
          // already held, before giving up on 0.
          numericValue = getExternalReading(node.id, paramName)
            ?? this.uniformValues.get(paramKey)
            ?? 0;
        }
      }

      // DEBUG: Log colorize parameter for ComputeNoise nodes (disabled to reduce console spam)
      // Uncomment only when debugging ComputeNoise colorize parameter issues
      // if (node.kind === 'ComputeNoise' && paramName === 'colorize') {
      //   console.log('[ParameterUniformManager] ComputeNoise colorize:', {
      //     nodeId: node.id,
      //     originalValue: paramValue,
      //     processedValue: value,
      //     typeOfValue: typeof value,
      //     numericValue: numericValue,
      //     paramKey: paramKey
      //   });
      // }

      this.uniformValues.set(paramKey, numericValue);
    }
  }

  Array.from(this.dynamicParams)
    .filter(key => key.startsWith(`${node.id}.`))
    .map(key => key.split('.')[1]);

}

  /**
   * Check if a parameter value is dynamic (needs uniform buffer)
   * Detects:
   * 1. Explicit expressions starting with =
   * 2. Time-dependent math expressions (sin(time), time*2, etc.)
   */
  isDynamicParameter(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    
    // Explicit expressions with =
    if (trimmed.startsWith('=')) return true;
    
    // Auto-detect time-dependent expressions
    return this.isTimeDependentExpression(trimmed);
  }

  /**
   * Check if an expression depends on time (without = prefix)
   */
  isTimeDependentExpression(expr) {
    if (expr.trim() === 'time') {
      return true;
    }
    
    // Or expressions containing time with operators/functions
    return /\btime\b/.test(expr) && this.isMathExpression(expr);
  }

  /**
   * Check if a string looks like a math expression
   */
  isMathExpression(value) {
    // Has function calls like sin(, cos(, etc.
    if (/\b(sin|cos|tan|sqrt|abs|pow|min|max|floor|ceil|round|clamp|lerp|smoothstep)\s*\(/.test(value)) {
      return true;
    }
    
    // Contains 'time' with operators
    if (value.includes('time') && /[+\-*/()]/.test(value)) {
      return true;
    }
    
    return false;
  }
/**
 * Evaluate an expression with optional context
 */
evaluateExpression(expr, context = {}) {
  if (window.expressionSystem) {
    try {
      // Add = prefix if not present for expression system
      const exprValue = expr.startsWith('=') ? expr : `=${expr}`;
      return window.expressionSystem.evaluateExpression(exprValue, context);
    } catch {
      return 0;
    }
  }
  return 0;
}
  /**
   * Evaluate a parameter using the expression system
   */
  evaluateParameter(value, node) {
    if (window.expressionSystem) {
      try {
        // Add = prefix if not present for expression system
        const exprValue = value.startsWith('=') ? value : `=${value}`;
        const result = window.expressionSystem.evaluateExpression(exprValue, {}, node);
        return result;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  /**
   * Check if a node has any dynamic parameters
   */
  hasDynamicParameters(nodeId) {
    return this.uniformParameters.has(nodeId);
  }

  /**
   * Check if a specific parameter is dynamic (includes MIDI parameters)
   */
  isDynamicParam(nodeId, paramName) {
    // Check if it's in uniformParameters (time-based expressions)
    const params = this.uniformParameters.get(nodeId);
    if (params && params.has(paramName)) {
      return true;
    }

    // Check if it's in uniformValues (MIDI-bound or other uniforms)
    const paramKey = `${nodeId}.${paramName}`;
    if (this.uniformValues.has(paramKey)) {
      return true;
    }

    return false;
  }

  /**
   * Get uniform name for a parameter (matches generateUniformStruct format)
   */
  getUniformName(nodeId, paramName) {
    const paramKey = `${nodeId}.${paramName}`;
    const sanitizedName = paramKey.replace(/[^a-zA-Z0-9_]/g, '_');
    const fieldName = sanitizedName.startsWith('_') ? sanitizedName : `_${sanitizedName}`;
    return `u_params.${fieldName}`;
  }
isDynamicExpression(value) {
  if (typeof value !== 'string') return false;
  
  // CRITICAL: Expressions containing 'time' are embedded in shader code directly
  // They don't need CPU-side uniforms because they use the GPU's g.time uniform
  if (/\btime\b/i.test(value)) {
    return false;  // NOT dynamic in the sense of needing a parameter uniform
  }
  
  // Check for other mathematical expressions that DO need parameter uniforms
  const dynamicPattern = /sin\(|cos\(|tan\(|abs\(|sqrt\(|pow\(|min\(|max\(|floor\(|ceil\(|round\(|fract\(|[+\-*/()]/;
  return dynamicPattern.test(value);
}
  /**
   * Update all uniform values (call each frame)
   */
updateValues(graph) {
  // Get current time
  const time = performance.now() / 1000;
  
  // Iterate through existing uniform values and update dynamic ones
  for (const [key] of this.uniformValues.entries()) {
    const [nodeId, paramName] = key.split('.');
    const node = graph.nodes.find(n => n.id == nodeId);
    
    if (node && node.params) {
      const paramValue = node.params[paramName];
      
      // Check if it's a dynamic expression
      if (this.isDynamicExpression(paramValue)) {
        try {
          // Re-evaluate with current time
          const evaluated = this.evaluateExpression(paramValue, { time });
          this.uniformValues.set(key, evaluated);
        } catch {
          // Keep existing value on error
        }
      }
    }
  }
}

  /**
   * Generate WGSL uniform struct declaration
   */
generateUniformStruct() {

  if (this.uniformValues.size === 0) {
    return '';
  }

  let structDef = 'struct ParamUniforms {\n';

  for (const [key] of this.uniformValues.entries()) {
    // key format is "nodeId.paramName" like "11.radius"
    // Sanitize and add underscore prefix for valid WGSL
    const sanitizedName = key.replace(/[^a-zA-Z0-9_]/g, '_');
    const fieldName = sanitizedName.startsWith('_') ? sanitizedName : `_${sanitizedName}`;

    structDef += `  ${fieldName}: f32,\n`;
  }

  structDef += '}\n\n';
  structDef += '@group(0) @binding(2) var<uniform> u_params: ParamUniforms;\n';

  return structDef;
}

  /**
   * Create GPU buffer for uniforms
   */
  createUniformBuffer(device) {
    if (this.uniformValues.size === 0) {
      this.uniformBuffer = null;
      return null;
    }

    const valueCount = this.uniformValues.size;
    const bufferSize = Math.max(16, Math.ceil(valueCount * 4 / 16) * 16);

    this.uniformBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'Parameter Uniforms'
    });

    this.updateBuffer(device);
    return this.uniformBuffer;
  }

  /**
   * Update GPU buffer with current values
   */
  updateBuffer(device) {
    if (!this.uniformBuffer || this.uniformValues.size === 0) return;

    const values = Array.from(this.uniformValues.values());
    const buffer = new Float32Array(values);

    device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      buffer.buffer,
      0,
      buffer.byteLength
    );

    this.needsUpdate = false;
  }

  /**
   * Get current value for a parameter
   */
  getValue(nodeId, paramName) {
    return this.uniformValues.get(`${nodeId}.${paramName}`) ?? 0;
  }

  /**
   * Clear all uniforms
   */
  clear() {
    this.uniformParameters.clear();
    this.uniformValues.clear();
    this.uniformBuffer = null;
    this.uniformBindGroup = null;
    this.needsUpdate = true;
  }

  /**
   * Get stats for debugging
   */
  getStats() {
    return {
      nodeCount: this.uniformParameters.size,
      paramCount: this.uniformValues.size,
      needsUpdate: this.needsUpdate
    };
  }
}
