// src/parameters/UnifiedParameterHandler.js
import { 
  ParameterCapabilities, 
  getParameterDefinition, 
  hasCapability,
  getDefaultCapabilities 
} from './ParameterDefs.js';

/**
 * Unified parameter handler - converts parameter values to shader code
 * based on their capabilities
 */
export class UnifiedParameterHandler {
  constructor() {
    this.expressionSystem = null;
  }

  /**
   * Set the expression system for evaluating expressions
   */
  setExpressionSystem(expressionSystem) {
    this.expressionSystem = expressionSystem;
  }

  /**
   * Determine if a parameter value should use a uniform buffer
   * (i.e., it's a dynamic expression that changes over time)
   */
  isDynamic(nodeKind, paramName, value) {
    const def = getParameterDefinition(nodeKind, paramName);
    
    // If parameter doesn't support expressions, it can't be dynamic
    if (def && !this.supportsExpressions(def.capabilities)) {
      return false;
    }
    
    // Check if it's an expression (starts with =)
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed.startsWith('=')) return false;
    
    // Check if the expression contains time-dependent variables
    const expr = trimmed.slice(1);
    return this.isTimeDependentExpression(expr);
  }

  /**
   * Check if an expression depends on time
   */
  isTimeDependentExpression(expr) {
    // Simple check: does it contain 'time'?
    // Could be more sophisticated later
    return expr.includes('time');
  }

  /**
   * Check if capabilities support expressions
   */
  supportsExpressions(capabilities) {
    return capabilities === ParameterCapabilities.ALL || 
           capabilities === ParameterCapabilities.EXPRESSION;
  }

  /**
   * Check if capabilities support shader variables
   */
  supportsShaderVars(capabilities) {
    return capabilities === ParameterCapabilities.ALL || 
           capabilities === ParameterCapabilities.SHADER_VAR;
  }

  /**
   * Convert a parameter value to shader code
   * @param {string} nodeKind - Node type
   * @param {string} paramName - Parameter name
   * @param {*} value - Parameter value
   * @param {string|null} uniformName - Uniform name if this uses a uniform buffer
   * @returns {string|number|boolean} Shader code representation
   */
toShaderCode(nodeKind, paramName, value, uniformName = null) {
  const def = getParameterDefinition(nodeKind, paramName);
  const capabilities = def?.capabilities || getDefaultCapabilities(nodeKind);

  // 1. If using uniform buffer (dynamic expression)
  if (uniformName) {
    return `params.${uniformName}`;
  }

  // 2. Handle expressions starting with =
  if (typeof value === 'string' && value.trim().startsWith('=')) {
    if (this.supportsExpressions(capabilities)) {
      return this.evaluateExpression(value);
    }
  }

  // 3. Check if it's a math expression (contains functions/operators with time)
  if (typeof value === 'string' && this.isMathExpression(value)) {
      if (/[+\-*/]$/.test(value)) {
    return def?.default ?? 0;  // Return default while typing
    
  }
    // Return as-is for shader code (don't evaluate!)
    return value.replace(/\btime\b/g, 'u.time');
  }

  // 4. Handle shader variables
  if (this.supportsShaderVars(capabilities)) {
    const shaderVar = this.toShaderVariable(value);
    if (shaderVar) return shaderVar;
  }

  // 5. Parse as literal
  return this.parseLiteral(value, def?.default);
}

// Add helper method
isMathExpression(value) {
  return /\b(sin|cos|tan|sqrt|abs|pow|min|max|floor|ceil|round|time)\s*\(/.test(value) ||
         (value.includes('time') && /[+\-*/]/.test(value));
}

  /**
   * Evaluate an expression at compile time
   */
  evaluateExpression(value) {
    if (!this.expressionSystem) {
      console.warn('Expression system not available');
      return 0;
    }

    try {
      return this.expressionSystem.evaluateExpression(value, {}, null);
    } catch (error) {
      console.warn('Expression evaluation failed:', error);
      return 0;
    }
  }

  /**
   * Convert string to shader variable if it matches known variables
   */
  toShaderVariable(value) {
    if (typeof value !== 'string') return null;
    
    const val = value.trim().toLowerCase();
    
    switch (val) {
      case 'time':
        return 'u.time';
      case 'uv':
        return 'in.uv';
      default:
        return null;
    }
  }

  /**
   * Parse a literal value (number, boolean, string number)
   */
  parseLiteral(value, defaultValue = 0) {
    // Already a number or boolean
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value;
    
    // String that looks like a number
    if (typeof value === 'string') {
      const trimmed = value.trim();
      
      // Boolean strings
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
      
      // Number string
      const num = parseFloat(trimmed);
      if (!isNaN(num)) return num;
    }
    
    return defaultValue;
  }

  /**
   * Get parameter definition for UI purposes
   */
  getDefinition(nodeKind, paramName) {
    return getParameterDefinition(nodeKind, paramName);
  }

  /**
   * Check if a parameter supports a specific capability
   */
  hasCapability(nodeKind, paramName, capability) {
    return hasCapability(nodeKind, paramName, capability);
  }
}