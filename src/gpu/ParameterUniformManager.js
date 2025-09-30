/**
 * Manages dynamic parameter uniforms for shader compilation
 * Detects which parameters need uniforms vs. baked values
 */
export class ParameterUniformManager {
  constructor() {
    this.uniformParameters = new Map(); // nodeId -> Set of param names
    this.uniformValues = new Map(); // nodeId.paramName -> current value
    this.uniformBuffer = null;
    this.uniformBindGroup = null;
    this.needsUpdate = true;
  }

  /**
   * Analyze a node to determine which parameters need uniforms
   */
analyzeNode(node) {
  if (!node.params) return;

  const dynamicParams = new Set();

  Object.entries(node.params).forEach(([paramName, value]) => {
    console.log(`Analyzing ${node.id}.${paramName} = ${value}`);
    if (this.isDynamicParameter(value)) {
      console.log(`  ✅ Is dynamic!`);
      dynamicParams.add(paramName);
      this.uniformValues.set(`${node.id}.${paramName}`, this.evaluateParameter(value, node));
    }
  });

  if (dynamicParams.size > 0) {
    this.uniformParameters.set(node.id, dynamicParams);
    console.log(`Node ${node.id} has ${dynamicParams.size} dynamic params:`, Array.from(dynamicParams));
  }
}

  /**
   * Check if a parameter value is dynamic (expression)
   */
isDynamicParameter(value) {
  return typeof value === 'string' && value.trim().startsWith('=');
}

  /**
   * Evaluate a parameter using the expression system
   */
evaluateParameter(value, node) {
  if (window.expressionSystem) {
    try {
      const result = window.expressionSystem.evaluateExpression(value, {}, node);
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

  /**
   * Update all uniform values (call each frame)
   */
  updateValues(graph) {
    let hasChanges = false;

    graph.nodes.forEach(node => {
      if (!node.params) return;

      Object.entries(node.params).forEach(([paramName, value]) => {
        if (this.isDynamicParameter(value)) {
          const key = `${node.id}.${paramName}`;
          const newValue = this.evaluateParameter(value, node);
          
          if (this.uniformValues.get(key) !== newValue) {
            this.uniformValues.set(key, newValue);
            hasChanges = true;
          }
        }
      });
    });

    if (hasChanges) {
      this.needsUpdate = true;
    }

    return hasChanges;
  }

  /**
   * Generate WGSL uniform struct declaration
   */
generateUniformStruct() {
  if (this.uniformValues.size === 0) {
    return '';
  }

  const entries = Array.from(this.uniformValues.keys()).map(key => {
    const [nodeId, paramName] = key.split('.');
    const uniformName = this.getUniformName(nodeId, paramName);
    return `  ${uniformName}: f32,`;
  });

  // Don't include @binding here - let generateShader add it with correct number
  return `
struct DynamicParams {
${entries.join('\n')}
}

@group(0) var<uniform> params: DynamicParams;
`;
}

  /**
   * Create GPU buffer for uniforms
   */
  createUniformBuffer(device) {
    if (this.uniformValues.size === 0) {
      this.uniformBuffer = null;
      return null;
    }

    // Each f32 is 4 bytes, align to 16 bytes
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