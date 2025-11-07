// src/parameters/ParameterDefs.js

/**
 * Parameter capability flags - define what types of values a parameter can accept
 */
export const ParameterCapabilities = {
  STATIC_ONLY: 'static',      // Only literal values: 0.5, 1, true
  EXPRESSION: 'expression',    // Supports expressions: =time, =sin(time*2)
  SHADER_VAR: 'shader_var',    // Supports shader variables: time, uv (without =)
  ALL: 'all'                   // Supports all of the above
};

/**
 * Parameter type definitions
 */
export const ParameterTypes = {
  FLOAT: 'float',
  INT: 'int',
  BOOL: 'bool',
  VEC2: 'vec2',
  VEC3: 'vec3',
  COLOR: 'color',
  ANGLE: 'angle'
};

/**
 * Get parameter definition for a node type
 * @param {string} nodeKind - The node type (e.g., 'AngularGradient')
 * @param {string} paramName - The parameter name (e.g., 'rotation')
 * @returns {Object|null} Parameter definition or null if not found
 */
export function getParameterDefinition(nodeKind, paramName) {
  const nodeDef = ParameterDefinitions[nodeKind];
  if (!nodeDef) return null;
  
  return nodeDef[paramName] || null;
}

/**
 * Check if a parameter supports a specific capability
 */
export function hasCapability(nodeKind, paramName, capability) {
  const def = getParameterDefinition(nodeKind, paramName);
  if (!def) return false;
  
  if (def.capabilities === ParameterCapabilities.ALL) return true;
  
  return def.capabilities === capability;
}

/**
 * Parameter definitions for each node type
 * Format: { nodeKind: { paramName: { type, capabilities, default?, min?, max? } } }
 */
export const ParameterDefinitions = {
  
  // Gradient nodes - support all parameter types
  LinearGradient: {
    angle: {
      type: ParameterTypes.ANGLE,
      capabilities: ParameterCapabilities.ALL,
      default: 0
    },
    offset: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0
    },
    scale: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 1
    },
    repeat: {
      type: ParameterTypes.BOOL,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: false
    }
  },
  
  RadialGradient: {
    centerX: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    centerY: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    radius: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    falloff: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 1.0
    },
    invert: {
      type: ParameterTypes.BOOL,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: false
    }
  },
  
  AngularGradient: {
    centerX: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    centerY: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    rotation: {
      type: ParameterTypes.ANGLE,
      capabilities: ParameterCapabilities.ALL,
      default: 0
    },
    repeat: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 1
    }
  },
  
  ConicGradient: {
    centerX: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    centerY: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    startAngle: {
      type: ParameterTypes.ANGLE,
      capabilities: ParameterCapabilities.ALL,
      default: 0
    },
    endAngle: {
      type: ParameterTypes.ANGLE,
      capabilities: ParameterCapabilities.ALL,
      default: 360
    },
    smoothness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0
    }
  },
  
  Displacement: {
    strength: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.2
    },
    centered: {
      type: ParameterTypes.BOOL,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: true
    },
    wrap: {
      type: ParameterTypes.BOOL,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: false
    }
  },
  SDFSmoothUnion: {
    smoothness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.1,
      min: 0,
      max: 1
    }
  },
  SDFSmoothIntersection: {
    smoothness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.1,
      min: 0,
      max: 1
    }
  },
  SDFSmoothSubtraction: {
    smoothness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.1,
      min: 0,
      max: 1
    }
  },
  Kaleidoscope: {
    segments: {
      type: ParameterTypes.INT,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: 6,
      min: 2,
      max: 32
    },
    angle: {
      type: ParameterTypes.ANGLE,
      capabilities: ParameterCapabilities.ALL,
      default: 0.0
    },
    scale: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 1.0,
      min: 0.1,
      max: 4.0
    },
    mirror: {
      type: ParameterTypes.BOOL,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: true
    }
  },

  Checker: {
    scaleX: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 8.0
    },
    scaleY: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 8.0
    },
    smoothness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.0
    }
  },

  Stripe: {
    frequency: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 5.0
    },
    angle: {
      type: ParameterTypes.ANGLE,
      capabilities: ParameterCapabilities.ALL,
      default: 0.0
    },
    thickness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    smoothness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.0
    }
  },

  // Shape nodes - support all parameter types
  Circle: {
    centerX: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    centerY: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    radius: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.25
    },
    smoothness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.01
    },
    invert: {
      type: ParameterTypes.BOOL,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: false
    }
  },
  
  Rectangle: {
    centerX: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    centerY: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    width: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    height: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    roundness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.0
    },
    smoothness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.01
    },
    invert: {
      type: ParameterTypes.BOOL,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: false
    }
  },

  Polygon: {
    centerX: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    centerY: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.5
    },
    sides: {
      type: ParameterTypes.INT,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: 6
    },
    radius: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.25
    },
    rotation: {
      type: ParameterTypes.ANGLE,
      capabilities: ParameterCapabilities.ALL,
      default: 0.0
    },
    smoothness: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.ALL,
      default: 0.01
    },
    invert: {
      type: ParameterTypes.BOOL,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: false
    }
  },

  // Math nodes - typically static only (for now)
  Add: {
    // No special parameters - uses inputs
  },
  
  Multiply: {
    // No special parameters - uses inputs
  },
  
  // Constants
  ConstFloat: {
    value: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: 0
    }
  },
  
  ConstVec2: {
    x: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: 0
    },
    y: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: 0
    }
  },
  
  ConstVec3: {
    x: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: 0
    },
    y: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: 0
    },
    z: {
      type: ParameterTypes.FLOAT,
      capabilities: ParameterCapabilities.STATIC_ONLY,
      default: 0
    }
  }
};

/**
 * Get default capabilities if not defined for a node
 */
export function getDefaultCapabilities(nodeKind) {
  // Gradients and shapes support all capabilities by default
  const allCapabilitiesNodes = [
    'LinearGradient', 'RadialGradient', 'AngularGradient', 'ConicGradient',
    'Circle', 'Rectangle', 'Polygon'
  ];
  
  if (allCapabilitiesNodes.includes(nodeKind)) {
    return ParameterCapabilities.ALL;
  }
  
  // Everything else is static only by default
  return ParameterCapabilities.STATIC_ONLY;
}
