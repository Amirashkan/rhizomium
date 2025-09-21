// src/data/nodes/NodeFactory.js
let _nextId = 1;

/**
 * Creates a new node instance based on the provided kind and position
 * @param {string} kind - The node type/kind
 * @param {number} x - X position (default: 0)
 * @param {number} y - Y position (default: 0)
 * @returns {Object} The created node instance
 */
export function makeNode(kind, x = 0, y = 0) {
  const def = getNodeDefinition(kind);
  if (!def) {
    throw new Error(`Unknown node kind: ${kind}`);
  }

  const node = {
    id: String(_nextId++),
    kind,
    x,
    y,
    w: 180,
    h: Math.max(60, 40 + (def.inputs || 0) * 18),
    inputs: new Array(def.inputs).fill(null),
    params: {},
    expr: def.params?.find((p) => p.name === "expr") ? "a" : undefined,
    value: def.params?.find((p) => p.name === "value")?.default ?? undefined,
  };

  // Initialize all parameter defaults
  if (def.params) {
    initializeNodeParameters(node, def.params);
  }

  return node;
}

/**
 * Initializes node parameters with their default values
 * @param {Object} node - The node to initialize
 * @param {Array} paramDefs - Parameter definitions
 */
function initializeNodeParameters(node, paramDefs) {
  for (const param of paramDefs) {
    switch (param.name) {
      case "value":
        node.value = param.default;
        break;
      case "x":
        node.x = param.default;
        break;
      case "y":
        node.y = param.default;
        break;
      case "expr":
        node.expr = param.default;
        break;
      default:
        if (!node.props) node.props = {};
        node.props[param.name] = param.default;
        break;
    }
  }
}

/**
 * Gets the definition for a specific node kind
 * @param {string} kind - The node kind
 * @returns {Object|null} The node definition or null if not found
 */
function getNodeDefinition(kind) {
  // This will be implemented in the main NodeDefs file
  const { NodeDefs } = import('./NodeDefs');
  return NodeDefs[kind] || null;
}