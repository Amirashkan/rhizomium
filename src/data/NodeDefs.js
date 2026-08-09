// src/data/NodeDefs.js
import { InputNodes } from './nodes/InputNodes.js';
import { OutputNodes } from './nodes/OutputNodes.js';
import { MathNodes } from './nodes/MathNodes.js';
import { VectorNodes } from './nodes/VectorNodes.js';
import { PatternNodes } from './nodes/PatternNodes.js';
import { NoiseNodes } from './nodes/NoiseNodes.js';
import { TransformNodes } from './nodes/TransformNodes.js';
import { ColorNodes } from './nodes/ColorNodes.js';
import { UtilityNodes } from './nodes/UtilityNodes.js';
import { BlendNodes } from './nodes/BlendNodes.js';
import { TextureNodes } from './nodes/TextureNodes.js';
import { TextNodes } from './nodes/TextNodes.js';
import { ComputeNodes } from './nodes/ComputeNodes.js';

let _nextId = 1;

/**
 * Reset the node ID counter (used when loading graphs)
 */
export function resetNodeIdCounter(startFrom = 1) {
  _nextId = startFrom;

}

/**
 * Update the node ID counter to be higher than all existing node IDs
 */
export function updateNodeIdCounter(existingNodes) {
  if (!existingNodes || !Array.isArray(existingNodes)) {
    return;
  }

  let maxId = 0;
  for (const node of existingNodes) {
    if (node && node.id) {
      // Try to parse the ID as a number
      const numId = parseInt(node.id, 10);
      if (!isNaN(numId) && numId > maxId) {
        maxId = numId;
      }
    }
  }

  if (maxId > 0) {
    _nextId = maxId + 1;

  }
}

/**
 * Central registry of all node definitions organized by category
 *
 * Categories (12 total):
 * - Input: Constants and runtime data sources
 * - Output: Final rendering output
 * - Math: Scalar and vector mathematical operations
 * - Vector: Vector construction/deconstruction (Split, Combine, Swizzle)
 * - Pattern: Gradients, shapes, and procedural patterns
 * - Noise: Procedural noise functions (Perlin, Simplex, Voronoi, etc.)
 * - Transform: UV coordinate transformations and distortions
 * - Color: Color manipulation and conversion
 * - Utility: Data manipulation (Remap, Select, Compare, Expression)
 * - Blend: SDF blending operations
 * - Texture: Texture sampling (2D, Cube)
 * - Compute: GPU-accelerated compute shaders
 */
export const NodeDefs = {
  ...InputNodes,
  ...OutputNodes,
  ...MathNodes,
  ...VectorNodes,
  ...PatternNodes,
  ...NoiseNodes,
  ...TransformNodes,
  ...ColorNodes,
  ...UtilityNodes,
  ...BlendNodes,
  ...TextureNodes,
  ...TextNodes,
  ...ComputeNodes,
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

  const defaults = defaultsFromDef(def);
  for (const [name, value] of Object.entries(defaults)) {
    applyNodeParameterValue(node, name, value);
  }
}

/**
 * Deep-copy a parameter default so a node never shares structure with the definition it came
 * from. The colour-stop editor mutates its array in place, and a shared reference would rewrite
 * the definition's default for every node created afterwards.
 */
function cloneParamDefault(value) {
  return value !== null && typeof value === 'object'
    ? JSON.parse(JSON.stringify(value))
    : value;
}

function defaultsFromDef(def) {
  const defaults = {};
  if (!def || !Array.isArray(def.params)) return defaults;

  for (const param of def.params) {
    if (!param || typeof param.name !== 'string') continue;
    // Parameters that declare no default (file pickers, momentary action buttons) carry no value
    // to seed or to restore — skip them rather than writing `undefined` over whatever is there.
    if (param.default === undefined) continue;
    defaults[param.name] = cloneParamDefault(param.default);
  }

  return defaults;
}

/**
 * The parameter values a freshly created node of `kind` carries, keyed by parameter name.
 * This is the same set makeNode seeds, so it doubles as the target state for "reset to defaults".
 */
export function defaultParameterValues(kind) {
  return defaultsFromDef(NodeDefs[kind]);
}

/**
 * Write one parameter value into every slot the rest of the app reads it from: node.params for
 * every parameter, node.props for backward compatibility, and the dedicated node.value /
 * node.expr / node.code fields those three names are mirrored onto.
 *
 * NOTE: params named 'x' and 'y' (e.g. ConstVec2/3/4 components) are intentionally NOT mapped to
 * node.x / node.y — those fields are the node's canvas position. The component values live in
 * node.params / node.props, which is what the codegen and preview computer read. Writing them
 * onto node.x/node.y would teleport every Vec node to the param defaults (0,0).
 */
export function applyNodeParameterValue(node, name, value) {
  if (!node || typeof name !== 'string') return;

  if (!node.params) node.params = {};
  node.params[name] = value;

  switch (name) {
    case 'value':
      node.value = value;
      break;
    case 'expr':
      node.expr = value;
      break;
    case 'code':
      node.code = value;
      break;
    default:
      if (!node.props) node.props = {};
      node.props[name] = value;
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

/**
 * Input-pin indices flagged as control pins (pinsIn[i].control === true) for a node kind.
 *
 * Control pins carry CPU-only signals (e.g. the Feedback nodes' Reset pulse) rather than a texture.
 * The GPU texture pipeline must skip them so a scalar source wired into one (a Trigger, say) isn't
 * mistaken for a fragment input to auto-bridge into a texture.
 *
 * @param {string} kind
 * @returns {Set<number>} indices into pinsIn that are control pins (empty for most nodes)
 */
export function controlInputPinIndices(kind) {
  const pins = NodeDefs[kind]?.pinsIn;
  const indices = new Set();
  if (Array.isArray(pins)) {
    pins.forEach((pin, i) => {
      if (pin && typeof pin === 'object' && pin.control) indices.add(i);
    });
  }
  return indices;
}
