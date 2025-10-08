// src/data/NodeDefs.js
import { InputNodes } from './nodes/InputNodes.js';
import { OutputNodes } from './nodes/OutputNodes.js';
import { FieldNodes } from './nodes/FieldNodes.js';
import { MathNodes } from './nodes/MathNodes.js';
import { UtilityNodes } from './nodes/UtilityNodes.js';
import { TransformNodes } from './nodes/TransformNodes.js';
import { BlendNodes } from './nodes/BlendNodes.js';

let _nextId = 1;

/**
 * Central registry of all node definitions organized by category
 * 
 * Categories:
 * - Input: Constants, runtime data, and textures (13 nodes)
 * - Math: Scalar and vector mathematical operations (43 nodes)
 * - Field: Procedural patterns and noise generation (20 nodes)
 * - Transform: UV coordinate manipulation (11 nodes)
 * - Utility: Data manipulation and component operations (19 nodes)
 * - Blend: Distance field combination operations (7 nodes)
 * - Output: Final rendering (1 node)
 */
export const NodeDefs = {
  ...OutputNodes,
  ...InputNodes,
  ...FieldNodes,
  ...MathNodes,
  ...UtilityNodes,
  ...BlendNodes,
  ...TransformNodes,
};

/**
 * Get all available node categories
 */
export function getNodeCategories() {
  const categories = new Set();
  Object.values(NodeDefs).forEach(def => categories.add(def.cat));
  return Array.from(categories).sort();
}

/**
 * Get all nodes in a specific category
 */
export function getNodesByCategory(category) {
  return Object.entries(NodeDefs)
    .filter(([_, def]) => def.cat === category)
    .reduce((acc, [key, def]) => ({ ...acc, [key]: def }), {});
}

/**
 * Create a new node instance from a node definition
 */
export function makeNode(kind, x = 0, y = 0) {
  const def = NodeDefs[kind];
  if (!def) {
    throw new Error(`Unknown node kind: ${kind}`);
  }

  const node = createBaseNode(kind, x, y, def);
  initializeNodeParameters(node, def);
  
  return node;
}

/**
 * Create the base node structure
 */
function createBaseNode(kind, x, y, def) {
  return {
    id: String(_nextId++),
    kind,
    x,
    y,
    w: 180,
    h: Math.max(60, 40 + (def.inputs || 0) * 18),
    inputs: new Array(def.inputs).fill(null),
    params: {},
  };
}

/**
 * Initialize node parameters with their default values
 */
function initializeNodeParameters(node, def) {
  if (!def.params) return;
 
  if (!node.params) {
    node.params = {};
  }

  for (const param of def.params) {
        // Initialize with default value
    node.params[param.name] = param.default;
    if (param.type === 'colorstops') {
      // Deep clone the default array of objects
      node.params[param.name] = JSON.parse(JSON.stringify(param.default));
    } else if (param.type === 'select') {
      node.params[param.name] = param.default;
    } else {
      switch (param.name) {
        case 'value':
          node.value = param.default;
          break;
        case 'expr':
          node.expr = param.default;
          break;
        default:
          node.params[param.name] = param.default;
      }
    }
  }

  for (const param of def.params) {
    switch (param.name) {
      
      case 'value':
        node.value = param.default;
        break;
      case 'x':
        node.x = param.default;
        break;
      case 'y':
        node.y = param.default;
        break;
      case 'expr':
        node.expr = param.default;
        break;
      default:
        if (!node.props) node.props = {};
        node.props[param.name] = param.default;
    }
  }
}

/**
 * Validate a node definition
 */
export function validateNodeDef(nodeDef) {
  const required = ['label', 'cat', 'inputs', 'pinsIn', 'pinsOut', 'params'];
  const missing = required.filter(field => !(field in nodeDef));
  
  if (missing.length > 0) {
    throw new Error(`Node definition missing required fields: ${missing.join(', ')}`);
  }
  
  if (nodeDef.pinsIn.length !== nodeDef.inputs) {
    throw new Error(`Node definition input count mismatch: pinsIn.length (${nodeDef.pinsIn.length}) !== inputs (${nodeDef.inputs})`);
  }
  
  return true;
}

/**
 * Get node definition by kind
 */
export function getNodeDef(kind) {
  return NodeDefs[kind] || null;
}
