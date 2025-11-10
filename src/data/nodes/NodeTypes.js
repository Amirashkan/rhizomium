// src/data/nodes/NodeTypes.js

/**
 * Type definitions and validation helpers for nodes
 */

/**
 * Valid node categories
 */
export const NodeCategories = {
  INPUT: 'Input',
  OUTPUT: 'Output',
  MATH: 'Math',
  VECTOR: 'Vector',
  PATTERN: 'Pattern',
  NOISE: 'Noise',
  TRANSFORM: 'Transform',
  COLOR: 'Color',
  UTILITY: 'Utility',
  BLEND: 'Blend',
  TEXTURE: 'Texture',
  COMPUTE: 'Compute',
};

/**
 * Valid data types for pins
 */
export const DataTypes = {
  F32: 'f32',
  VEC2: 'vec2',
  VEC3: 'vec3',
  VEC4: 'vec4',
  BOOL: 'bool',
  INT: 'int',
};

/**
 * Valid parameter types
 */
export const ParameterTypes = {
  FLOAT: 'float',
  INT: 'int',
  BOOL: 'bool',
  STRING: 'string',
  EXPRESSION: 'expression',
  FILE: 'file',
  SELECT: 'select',
};

/**
 * Create a parameter definition
 */
export function createParam(name, type, options = {}) {
  const param = {
    name,
    type,
    label: options.label || name,
  };

  if (options.default !== undefined) {
    param.default = options.default;
  }

  if (type === ParameterTypes.FILE && options.accept) {
    param.accept = options.accept;
  }

  if (type === ParameterTypes.SELECT && options.options) {
    param.options = options.options;
  }

  return param;
}

/**
 * Create a pin definition
 */
export function createPin(label, type) {
  return { label, type };
}

/**
 * Create a node definition
 */
export function createNodeDef(options) {
  const {
    label,
    category,
    inputs = 0,
    pinsIn = [],
    pinsOut = [],
    params = [],
  } = options;

  return {
    label,
    cat: category,
    inputs,
    pinsIn,
    pinsOut,
    params,
  };
}

/**
 * Validate that a pin array matches the input count
 */
export function validatePinCount(pinsIn, inputCount) {
  if (pinsIn.length !== inputCount) {
    throw new Error(
      `Pin count mismatch: expected ${inputCount} inputs, got ${pinsIn.length} pins`
    );
  }
}

/**
 * Validate a parameter definition
 */
export function validateParameter(param) {
  try {
    if (!param.name || !param.type) {
      throw new Error('Parameter must have name and type');
    }

    if (!Object.values(ParameterTypes).includes(param.type)) {
      throw new Error(`Invalid parameter type: ${param.type}`);
    }

    if (param.type === ParameterTypes.SELECT && !param.options) {
      throw new Error('Select parameter must have options array');
    }

    return true;
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'parameter-validation',
      paramName: param?.name,
      paramType: param?.type
    });
    throw error; // Re-throw so calling code knows validation failed
  }
}

/**
 * Validate a pin definition
 */
export function validatePin(pin) {
  if (!pin.label || !pin.type) {
    throw new Error('Pin must have label and type');
  }

  if (!Object.values(DataTypes).includes(pin.type)) {
    throw new Error(`Invalid pin type: ${pin.type}`);
  }

  return true;
}