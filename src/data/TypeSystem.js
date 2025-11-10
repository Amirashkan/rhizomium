// src/data/TypeSystem.js

/**
 * Type system for node graph with type validation and propagation
 * Handles type compatibility, automatic conversion, and type inference
 */

/**
 * Base types in the system
 */
export const BaseTypes = {
  // Scalar types
  FLOAT: 'float',
  INT: 'int',
  BOOL: 'bool',

  // Vector types
  VEC2: 'vec2',
  VEC3: 'vec3',
  VEC4: 'vec4',

  // Color (alias for vec4)
  COLOR: 'color',
  RGB: 'rgb', // vec3
  RGBA: 'rgba', // vec4

  // Texture types
  TEXTURE: 'texture',
  TEXTURE_2D: 'texture2d',
  TEXTURE_3D: 'texture3d',

  // UV coordinates
  UV: 'uv',

  // Field types
  FIELD: 'field',
  VALUE: 'value',

  // Special types
  ANY: 'any',
  UNKNOWN: 'unknown'
};

/**
 * Type compatibility rules
 * Each type maps to an array of types it can accept
 */
const compatibilityRules = {
  // Scalars can accept other scalars with conversion
  [BaseTypes.FLOAT]: [
    BaseTypes.FLOAT,
    BaseTypes.INT,
    BaseTypes.VALUE,
    BaseTypes.ANY
  ],
  [BaseTypes.INT]: [
    BaseTypes.INT,
    BaseTypes.FLOAT,  // with truncation
    BaseTypes.VALUE,
    BaseTypes.ANY
  ],
  [BaseTypes.BOOL]: [
    BaseTypes.BOOL,
    BaseTypes.INT,    // 0/1
    BaseTypes.FLOAT,  // 0.0/1.0
    BaseTypes.ANY
  ],

  // Vectors
  [BaseTypes.VEC2]: [
    BaseTypes.VEC2,
    BaseTypes.UV,
    BaseTypes.ANY
  ],
  [BaseTypes.VEC3]: [
    BaseTypes.VEC3,
    BaseTypes.RGB,
    BaseTypes.ANY
  ],
  [BaseTypes.VEC4]: [
    BaseTypes.VEC4,
    BaseTypes.COLOR,
    BaseTypes.RGBA,
    BaseTypes.ANY
  ],

  // Color types
  [BaseTypes.COLOR]: [
    BaseTypes.COLOR,
    BaseTypes.VEC4,
    BaseTypes.RGBA,
    BaseTypes.ANY
  ],
  [BaseTypes.RGB]: [
    BaseTypes.RGB,
    BaseTypes.VEC3,
    BaseTypes.ANY
  ],
  [BaseTypes.RGBA]: [
    BaseTypes.RGBA,
    BaseTypes.VEC4,
    BaseTypes.COLOR,
    BaseTypes.ANY
  ],

  // Textures
  // UPDATED: Now accepts fragment shader outputs (float, vec3, etc.)
  // These are automatically rendered to textures via auto-bridging
  [BaseTypes.TEXTURE]: [
    BaseTypes.TEXTURE,
    BaseTypes.TEXTURE_2D,
    BaseTypes.TEXTURE_3D,
    BaseTypes.FLOAT,
    BaseTypes.VEC2,
    BaseTypes.VEC3,
    BaseTypes.VEC4,
    BaseTypes.RGB,
    BaseTypes.RGBA,
    BaseTypes.COLOR,
    BaseTypes.FIELD,
    BaseTypes.VALUE,
    BaseTypes.ANY
  ],
  [BaseTypes.TEXTURE_2D]: [
    BaseTypes.TEXTURE_2D,
    BaseTypes.TEXTURE,
    BaseTypes.ANY
  ],
  [BaseTypes.TEXTURE_3D]: [
    BaseTypes.TEXTURE_3D,
    BaseTypes.TEXTURE,
    BaseTypes.ANY
  ],

  // UV coordinates
  [BaseTypes.UV]: [
    BaseTypes.UV,
    BaseTypes.VEC2,
    BaseTypes.ANY
  ],

  // Field types
  [BaseTypes.FIELD]: [
    BaseTypes.FIELD,
    BaseTypes.VALUE,
    BaseTypes.FLOAT,
    BaseTypes.ANY
  ],
  [BaseTypes.VALUE]: [
    BaseTypes.VALUE,
    BaseTypes.FIELD,
    BaseTypes.FLOAT,
    BaseTypes.ANY
  ],

  // Special types
  [BaseTypes.ANY]: Object.values(BaseTypes),
  [BaseTypes.UNKNOWN]: [BaseTypes.UNKNOWN, BaseTypes.ANY]
};

/**
 * Pin name to type mapping
 * Maps common pin names to their expected types
 */
const pinNameTypeMap = {
  // Texture pins
  'Texture': BaseTypes.TEXTURE,
  'Input': BaseTypes.TEXTURE,
  'Output': BaseTypes.TEXTURE,

  // Color pins
  'Color': BaseTypes.COLOR,
  'RGB': BaseTypes.RGB,
  'RGBA': BaseTypes.RGBA,
  'R': BaseTypes.FLOAT,
  'G': BaseTypes.FLOAT,
  'B': BaseTypes.FLOAT,
  'A': BaseTypes.FLOAT,

  // UV pins
  'UV': BaseTypes.UV,
  'TexCoord': BaseTypes.UV,

  // Value pins
  'Value': BaseTypes.VALUE,
  'Field': BaseTypes.FIELD,

  // Vector pins
  'Position': BaseTypes.VEC3,
  'Normal': BaseTypes.VEC3,
  'Velocity': BaseTypes.VEC3,
  'Force': BaseTypes.VEC3,

  // Special pins
  'Force Field': BaseTypes.TEXTURE,
  'Velocity Field': BaseTypes.TEXTURE,
  'Pressure': BaseTypes.TEXTURE
};

/**
 * Type system class for managing type validation and propagation
 */
export class TypeSystem {
  constructor() {
    this.nodeTypes = new Map(); // nodeId -> { inputs: Map, outputs: Map }
  }

  /**
   * Infer type from pin name
   */
  inferTypeFromPinName(pinName) {
    // Check exact match
    if (pinNameTypeMap[pinName]) {
      return pinNameTypeMap[pinName];
    }

    // Check partial matches
    const lowerName = pinName.toLowerCase();

    if (lowerName.includes('texture') || lowerName.includes('tex')) {
      return BaseTypes.TEXTURE;
    }
    if (lowerName.includes('color') || lowerName.includes('col')) {
      return BaseTypes.COLOR;
    }
    if (lowerName.includes('uv') || lowerName.includes('coord')) {
      return BaseTypes.UV;
    }
    if (lowerName.includes('value') || lowerName.includes('val')) {
      return BaseTypes.VALUE;
    }
    if (lowerName.includes('field')) {
      return BaseTypes.FIELD;
    }
    if (lowerName.includes('rgb')) {
      return BaseTypes.RGB;
    }
    if (lowerName.includes('velocity') || lowerName.includes('position') || lowerName.includes('normal')) {
      return BaseTypes.VEC3;
    }

    return BaseTypes.UNKNOWN;
  }

  /**
   * Register node types from node definition
   */
  registerNode(nodeId, nodeDefinition) {
    const inputs = new Map();
    const outputs = new Map();

    // Register input pins
    if (nodeDefinition.pinsIn) {
      for (const pinName of nodeDefinition.pinsIn) {
        inputs.set(pinName, this.inferTypeFromPinName(pinName));
      }
    }

    // Register output pins
    if (nodeDefinition.pinsOut) {
      for (const pinName of nodeDefinition.pinsOut) {
        outputs.set(pinName, this.inferTypeFromPinName(pinName));
      }
    }

    this.nodeTypes.set(nodeId, { inputs, outputs });
  }

  /**
   * Unregister a node
   */
  unregisterNode(nodeId) {
    this.nodeTypes.delete(nodeId);
  }

  /**
   * Get input pin type
   */
  getInputType(nodeId, pinName) {
    const node = this.nodeTypes.get(nodeId);
    if (!node) return BaseTypes.UNKNOWN;
    return node.inputs.get(pinName) || BaseTypes.UNKNOWN;
  }

  /**
   * Get output pin type
   */
  getOutputType(nodeId, pinName) {
    const node = this.nodeTypes.get(nodeId);
    if (!node) return BaseTypes.UNKNOWN;
    return node.outputs.get(pinName) || BaseTypes.UNKNOWN;
  }

  /**
   * Check if two types are compatible
   */
  isCompatible(sourceType, targetType) {
    // Same type is always compatible
    if (sourceType === targetType) {
      return true;
    }

    // Check compatibility rules
    const rules = compatibilityRules[targetType];
    if (!rules) {
      return sourceType === BaseTypes.ANY || targetType === BaseTypes.ANY;
    }

    return rules.includes(sourceType);
  }

  /**
   * Validate a connection between two pins
   */
  validateConnection(fromNodeId, fromPin, toNodeId, toPin) {
    const sourceType = this.getOutputType(fromNodeId, fromPin);
    const targetType = this.getInputType(toNodeId, toPin);

    if (sourceType === BaseTypes.UNKNOWN || targetType === BaseTypes.UNKNOWN) {
      return {
        valid: true, // Allow unknown types (lenient mode)
        warning: 'Unknown type in connection',
        sourceType,
        targetType
      };
    }

    const compatible = this.isCompatible(sourceType, targetType);

    return {
      valid: compatible,
      sourceType,
      targetType,
      error: compatible ? null : `Type mismatch: Cannot connect ${sourceType} to ${targetType}`
    };
  }

  /**
   * Get conversion code between two types (if needed)
   */
  getConversionCode(fromType, toType, varName) {
    // No conversion needed
    if (fromType === toType) {
      return varName;
    }

    // Scalar conversions
    if (fromType === BaseTypes.INT && toType === BaseTypes.FLOAT) {
      return `f32(${varName})`;
    }
    if (fromType === BaseTypes.FLOAT && toType === BaseTypes.INT) {
      return `i32(${varName})`;
    }
    if ((fromType === BaseTypes.FLOAT || fromType === BaseTypes.INT) && toType === BaseTypes.BOOL) {
      return `${varName} != 0`;
    }

    // Vector to color
    if (fromType === BaseTypes.VEC3 && toType === BaseTypes.RGB) {
      return varName; // Same representation
    }
    if (fromType === BaseTypes.VEC4 && toType === BaseTypes.COLOR) {
      return varName; // Same representation
    }

    // UV to vec2
    if (fromType === BaseTypes.UV && toType === BaseTypes.VEC2) {
      return varName;
    }
    if (fromType === BaseTypes.VEC2 && toType === BaseTypes.UV) {
      return varName;
    }

    // Field/Value conversions
    if (fromType === BaseTypes.FIELD && toType === BaseTypes.VALUE) {
      return varName;
    }
    if (fromType === BaseTypes.VALUE && toType === BaseTypes.FLOAT) {
      return varName;
    }

    // Default: no conversion
    return varName;
  }

  /**
   * Propagate types through the graph
   * Updates output types based on input types
   */
  propagateTypes(graph) {
    const changes = new Map(); // nodeId -> { pin: type }

    // Get execution order to propagate in dependency order
    const executionOrder = graph.getExecutionOrder();

    for (const nodeId of executionOrder) {
      const connections = graph.getConnectionsTo(nodeId);

      for (const conn of connections) {
        const sourceType = this.getOutputType(conn.fromNode, conn.fromPin);
        const currentTargetType = this.getInputType(conn.toNode, conn.toPin);

        // Update type if unknown or if source provides more specific type
        if (currentTargetType === BaseTypes.UNKNOWN ||
            (sourceType !== BaseTypes.UNKNOWN && currentTargetType === BaseTypes.ANY)) {

          if (!changes.has(nodeId)) {
            changes.set(nodeId, new Map());
          }
          changes.get(nodeId).set(conn.toPin, sourceType);
        }
      }
    }

    // Apply changes
    for (const [nodeId, pinTypes] of changes.entries()) {
      const node = this.nodeTypes.get(nodeId);
      if (node) {
        for (const [pin, type] of pinTypes.entries()) {
          node.inputs.set(pin, type);
        }
      }
    }

    return changes.size > 0;
  }

  /**
   * Get all type mismatches in the graph
   */
  validateGraph(graph) {
    const errors = [];
    const warnings = [];

    for (const conn of graph.connections) {
      const result = this.validateConnection(
        conn.fromNode,
        conn.fromPin,
        conn.toNode,
        conn.toPin
      );

      if (!result.valid) {
        errors.push({
          connection: conn,
          error: result.error,
          sourceType: result.sourceType,
          targetType: result.targetType
        });
      } else if (result.warning) {
        warnings.push({
          connection: conn,
          warning: result.warning,
          sourceType: result.sourceType,
          targetType: result.targetType
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get string representation of a type
   */
  getTypeString(type) {
    return type || BaseTypes.UNKNOWN;
  }

  /**
   * Clear all registered types
   */
  clear() {
    this.nodeTypes.clear();
  }

  /**
   * Get all registered nodes
   */
  getRegisteredNodes() {
    return Array.from(this.nodeTypes.keys());
  }

  /**
   * Get type information for a node
   */
  getNodeTypeInfo(nodeId) {
    const node = this.nodeTypes.get(nodeId);
    if (!node) return null;

    return {
      inputs: Array.from(node.inputs.entries()).map(([pin, type]) => ({ pin, type })),
      outputs: Array.from(node.outputs.entries()).map(([pin, type]) => ({ pin, type }))
    };
  }
}

/**
 * Global type system instance
 */
export const globalTypeSystem = new TypeSystem();
