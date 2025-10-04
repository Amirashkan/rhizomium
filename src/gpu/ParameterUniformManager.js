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
  console.log(`Analyzing node ${node.id}`);
  
  for (const [paramName, paramValue] of Object.entries(node.params || {})) {
    console.log(`Analyzing ${node.id}.${paramName} = ${paramValue}`);
    
    // Skip expressions containing 'time' - they'll be embedded as shader code
    if (typeof paramValue === 'string' && /\btime\b/i.test(paramValue)) {
      console.log(`  ⏱️ Contains 'time' - will be shader code, not uniform`);
      continue;  // Skip this parameter
    }
    
    if (this.isDynamicExpression(paramValue)) {
      console.log(`  ✅ Is dynamic!`);
      this.dynamicParams.add(`${node.id}.${paramName}`);
      
      const value = this.evaluateExpression(paramValue);
      const key = `${node.id}.${paramName}`;
      this.uniformValues.set(key, value);
      console.log(`📊 Evaluated ${node.id} param: ${paramValue} = ${value}`);
    }
  }
  
  const nodeKey = `${node.id}`;
  const dynamicParamsForNode = Array.from(this.dynamicParams)
    .filter(key => key.startsWith(`${node.id}.`))
    .map(key => key.split('.')[1]);
    
  if (dynamicParamsForNode.length > 0) {
    console.log(`Node ${node.id} has ${dynamicParamsForNode.length} dynamic params:`, dynamicParamsForNode);
  }
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
    } catch (error) {
      console.warn('Failed to evaluate expression:', error);
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
        console.log(`📊 Evaluated ${node.id} param: ${value} = ${result}`);
        return result;
      } catch (error) {
        console.warn('Failed to evaluate parameter:', error);
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
   * Check if a specific parameter is dynamic
   */
  isDynamicParam(nodeId, paramName) {
    const params = this.uniformParameters.get(nodeId);
    return params ? params.has(paramName) : false;
  }

  /**
   * Get uniform name for a parameter
   */
  getUniformName(nodeId, paramName) {
    return `param_${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}_${paramName}`;
  }
isDynamicExpression(value) {
  if (typeof value !== 'string') return false;
  
  // CRITICAL: Expressions containing 'time' are embedded in shader code directly
  // They don't need CPU-side uniforms because they use the GPU's u.time uniform
  if (/\btime\b/i.test(value)) {
    console.log(`⏱️ Expression "${value}" contains 'time' - will be embedded as shader code, NOT a uniform`);
    return false;  // NOT dynamic in the sense of needing a parameter uniform
  }
  
  // Check for other mathematical expressions that DO need parameter uniforms
  const dynamicPattern = /sin\(|cos\(|tan\(|abs\(|sqrt\(|pow\(|min\(|max\(|floor\(|ceil\(|round\(|fract\(|[+\-*\/()]/;
  return dynamicPattern.test(value);
}
  /**
   * Update all uniform values (call each frame)
   */
updateValues(graph) {
  // Get current time
  const time = performance.now() / 1000;
  
  // Iterate through existing uniform values and update dynamic ones
  for (const [key, currentValue] of this.uniformValues.entries()) {
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
        } catch (error) {
          // Keep existing value on error
          console.warn(`Failed to update ${key}:`, error);
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
  
  for (const [key, value] of this.uniformValues.entries()) {
    // key format is "nodeId.paramName" like "11.radius"
    // Sanitize and add underscore prefix for valid WGSL
    const sanitizedName = key.replace(/[^a-zA-Z0-9_]/g, '_');
    const fieldName = sanitizedName.startsWith('_') ? sanitizedName : `_${sanitizedName}`;
    
    structDef += `  ${fieldName}: f32,\n`;
    console.log('🔧 Generated uniform struct field:', fieldName);  // ✅ Inside the loop
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