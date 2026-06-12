// src/codegen/processors/TypeConverter.js
export class TypeConverter {
  constructor() {
    this.types = new Map(); // nodeId -> 'f32' | 'vec2' | 'vec3' | 'vec4'
    this.expressions = new Map(); // nodeId -> expression string
    this.outputPins = new Map(); // nodeId -> array of {expression, type} for each output pin
  }

  /**
   * Clear all accumulated state. Must be called at the start of each compilation
   * so stale outputPins entries from previous runs cannot be referenced by nodes
   * that were not compiled in the current pass.
   */
  clear() {
    this.types.clear();
    this.expressions.clear();
    this.outputPins.clear();
  }
  
  /**
   * Set the type and expression for a node (legacy single-output)
   * @param {string} nodeId 
   * @param {string} expression 
   * @param {string} type 
   */
  setNodeOutput(nodeId, expression, type) {
    this.expressions.set(nodeId, expression);
    this.types.set(nodeId, type);
  }
  
  /**
   * NEW: Set multiple output pins for a node with channel extraction
   * @param {string} nodeId 
   * @param {Array} pins - Array of {expression, type} for each output pin
   */
  setNodeOutputPins(nodeId, pins) {
    this.outputPins.set(nodeId, pins);
    // Also set default (first pin) for backward compatibility
    if (pins.length > 0) {
      this.expressions.set(nodeId, pins[0].expression);
      this.types.set(nodeId, pins[0].type);
    }
  }
  
  /**
   * Get an expression with type conversion
   * @param {string} nodeId - Can be "nodeId" or "nodeId:pinIndex"
   * @param {string} targetType - If null, returns object with code and type
   * @returns {string|Object} Converted expression or { code: string, type: string }
   */
  convertTo(nodeId, targetType) {
    // Check if nodeId contains pin index (format: "nodeId:pinIndex")
    let actualNodeId = nodeId;
    let pinIndex = 0;
    
    if (typeof nodeId === 'string' && nodeId.includes(':')) {
      const parts = nodeId.split(':');
      actualNodeId = parts[0];
      pinIndex = parseInt(parts[1]) || 0;
    }
    
    // Try to get specific output pin
    const outputPins = this.outputPins.get(actualNodeId);
    let expression, currentType;
    
    if (outputPins && outputPins[pinIndex]) {
      expression = outputPins[pinIndex].expression;
      currentType = outputPins[pinIndex].type;
    } else {
      // Fall back to legacy single-output
      expression = this.expressions.get(actualNodeId) || "vec3<f32>(0.0)";
      currentType = this.types.get(actualNodeId);
      
      // If type not found, we can't safely assume - this indicates a registration issue
      // But we'll try to handle it gracefully by attempting conversion anyway
      if (!currentType) {
        // Don't default to vec3 - this causes incorrect conversions
        // Instead, we'll try to convert assuming unknown type
        currentType = null;
      }
    }
    
    // If targetType is null, return both code and type
    if (targetType === null || targetType === undefined) {
      return {
        code: expression,
        type: currentType || "f32"
      };
    }
    
    // If we don't know the current type, we need to be careful
    // The expression is just a variable name like "node_15", so we can't infer from it
    // In this case, we should try the conversion anyway - if the type was registered,
    // it will work. If not, we'll get a compilation error which is better than wrong code.
    // However, if targetType matches what we'd expect, we can try a safe conversion.
    if (!currentType) {
      // For now, try to convert - if the type was actually registered but lookup failed,
      // the conversion might still work. Otherwise, we'll get a compile error.
      // Default to assuming it might need conversion from a common type
      // Try vec2 -> vec3 first (common case for CustomGLSL nodes)
      if (targetType === "vec3") {
        // Try vec2 conversion - if it's actually vec2, this will work
        return this.performConversion(expression, "vec2", targetType);
      }
      // For other targets, try f32 -> targetType
      return this.performConversion(expression, "f32", targetType);
    }
    
    // Return converted expression string
    return this.performConversion(expression, currentType, targetType);
  }
  
  /**
   * Perform type conversion between WGSL types
   * @param {string} expression 
   * @param {string} fromType 
   * @param {string} toType 
   * @returns {string} Converted expression
   */
  performConversion(expression, fromType, toType) {
    if (fromType === toType) {
      return expression;
    }
    
    switch (toType) {
      case "vec4":
        return this.toVec4(expression, fromType);
      case "vec3":
        return this.toVec3(expression, fromType);
      case "vec2":
        return this.toVec2(expression, fromType);
      case "f32":
        return this.toF32(expression, fromType);
      default:
        return expression;
    }
  }
  
  /**
   * Convert to vec4
   * @param {string} expr 
   * @param {string} fromType 
   * @returns {string}
   */
  toVec4(expr, fromType) {
    switch (fromType) {
      case "vec4": return expr;
      case "vec3": return `vec4<f32>(${expr}, 1.0)`;
      case "vec2": return `vec4<f32>(${expr}.x, ${expr}.y, 0.0, 1.0)`;
      case "f32": return `vec4<f32>(${expr})`;
      default: return `vec4<f32>(${expr}, 1.0)`;
    }
  }
  
  /**
   * Convert to vec3
   * @param {string} expr 
   * @param {string} fromType 
   * @returns {string}
   */
  toVec3(expr, fromType) {
    switch (fromType) {
      case "vec3": return expr;
      case "vec4": return `vec3<f32>(${expr}.x, ${expr}.y, ${expr}.z)`; // Extract RGB
      case "vec2": return `vec3<f32>(${expr}.x, ${expr}.y, 0.0)`;
      case "f32": return `vec3<f32>(${expr})`;
      default: return expr;
    }
  }
  
  /**
   * Convert to vec2
   * @param {string} expr 
   * @param {string} fromType 
   * @returns {string}
   */
  toVec2(expr, fromType) {
    switch (fromType) {
      case "vec2": return expr;
      case "vec4": return `vec2<f32>(${expr}.x, ${expr}.y)`;
      case "vec3": return `vec2<f32>(${expr}.x, ${expr}.y)`;
      case "f32": return `vec2<f32>(${expr})`;
      default: return `vec2<f32>(0.0)`;
    }
  }
  
  /**
   * Convert to f32
   * @param {string} expr 
   * @param {string} fromType 
   * @returns {string}
   */
  toF32(expr, fromType) {
    switch (fromType) {
      case "f32": return expr;
      case "vec4": return `dot(vec3<f32>(${expr}.x, ${expr}.y, ${expr}.z), vec3<f32>(0.299, 0.587, 0.114))`; // RGB luminance
      case "vec2": return `(${expr}.x + ${expr}.y) * 0.5`;
      case "vec3": return `(${expr}.x + ${expr}.y + ${expr}.z) / 3.0`;
      default: return expr;
    }
  }
}