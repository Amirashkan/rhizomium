// src/codegen/processors/TypeConverter.js
export class TypeConverter {
  constructor() {
    this.types = new Map(); // nodeId -> 'f32' | 'vec2' | 'vec3' | 'vec4'
    this.expressions = new Map(); // nodeId -> expression string
    this.outputPins = new Map(); // nodeId -> array of {expression, type} for each output pin
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
      currentType = this.types.get(actualNodeId) || "vec3";
    }
    
    // If targetType is null, return both code and type
    if (targetType === null || targetType === undefined) {
      return {
        code: expression,
        type: currentType
      };
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
      case "vec4": return `${expr}.w`; // Extract alpha
      case "vec2": return `(${expr}.x + ${expr}.y) * 0.5`;
      case "vec3": return `(${expr}.x + ${expr}.y + ${expr}.z) / 3.0`;
      default: return expr;
    }
  }
}