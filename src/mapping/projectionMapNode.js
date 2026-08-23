// src/mapping/projectionMapNode.js
//
// Keeps the ProjectionMap node in step with the mapping the panel edits.
//
// The MappingModel is authoritative: it is what the panel drags, what the
// project file carries, and what the compositor draws. The node is that state
// projected onto what the GPU reads — two homographies, an opacity and a feather
// per surface — so the shader path and the panel can never disagree about where
// a surface is.
//
// Writes go straight into the uniform buffer rather than through a recompile.
// Aligning a projector is a continuous drag, and rebuilding the shader on every
// mousemove would make it unusable; the node declares `alwaysUniform` precisely
// so these values are already in the buffer to be overwritten.

import { surfaceMatrices } from './MappingCompositor.js';
import { MAX_MAPPED_SURFACES, MAX_MASK_POINTS } from '../data/nodes/UtilityNodes.js';
import { makeNode, updateNodeIdCounter, NodeDefs } from '../data/NodeDefs.js';
import { getInputCount, setInputCount } from '../data/nodeInputs.js';

/** The identity mapping: the whole frame showing the whole flow. */
const IDENTITY_MAT3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * The graph's ProjectionMap node, or null.
 *
 * One node stands for the mapping as a whole, so the first is the one meant. A
 * second would be a graph with two mappings in it, which the panel has no way to
 * express — it edits one model.
 *
 * @param {object} graph
 * @returns {object|null}
 */
export function findProjectionMapNode(graph) {
  const nodes = graph?.nodes;
  if (!Array.isArray(nodes)) return null;
  return nodes.find((n) => n && n.kind === 'ProjectionMap') || null;
}

/**
 * The graph's ProjectionMap node, creating one if the graph has none.
 *
 * Dropping a flow onto a surface is the gesture that brings the node into
 * existence: asking someone to add it by hand first would make the drop fail for
 * a reason that is invisible from the mapping panel.
 *
 * @param {object} graph
 * @param {{x?: number, y?: number}} [at] where to place a newly created node
 * @returns {object|null} the node, or null when the graph cannot hold one
 */
export function ensureProjectionMapNode(graph, at = {}) {
  const existing = findProjectionMapNode(graph);
  if (existing) return existing;
  if (!graph || !Array.isArray(graph.nodes)) return null;

  try {
    // The id counter is shared and can be behind the graph — after a load, or a
    // graph built from ids this session did not mint. A node minted onto an id
    // that already exists would silently alias another node, so bring the
    // counter past everything in the graph first.
    updateNodeIdCounter(graph.nodes);
    const node = makeNode('ProjectionMap', at.x ?? 0, at.y ?? 0);
    graph.nodes.push(node);
    return node;
  } catch {
    return null;
  }
}

/**
 * The parameter values a single surface contributes.
 *
 * A surface whose quad has collapsed mid-drag falls back to the identity rather
 * than to garbage — it briefly shows unwarped instead of flickering black.
 *
 * @param {object} surface
 * @param {number} index which pin the surface is on
 * @returns {Object<string, number>} paramName -> value
 */
export function surfaceParamValues(surface, index) {
  const matrices = surfaceMatrices(surface);
  const m = matrices ? matrices.dstToUnit : IDENTITY_MAT3;
  const n = matrices ? matrices.unitToSrc : IDENTITY_MAT3;

  const values = {};
  for (let k = 0; k < 9; k++) {
    values[`s${index}m${k}`] = m[k];
    values[`s${index}n${k}`] = n[k];
  }
  // A hidden surface contributes nothing. Zero opacity rather than dropping the
  // pin keeps this a uniform write: removing the surface would change the
  // shader's structure and force a recompile mid-session.
  values[`s${index}opacity`] = surface.enabled ? surface.opacity : 0;
  values[`s${index}soft`] = surface.softEdge;

  const mask = Array.isArray(surface.mask) ? surface.mask : [];
  // Fewer than three points enclose no area; treat that as no mask rather than
  // masking the surface away entirely.
  const count = mask.length >= 3 ? Math.min(mask.length, MAX_MASK_POINTS) : 0;
  values[`s${index}kn`] = count;
  for (let k = 0; k < MAX_MASK_POINTS; k++) {
    values[`s${index}k${k}x`] = k < count ? mask[k].x : 0;
    values[`s${index}k${k}y`] = k < count ? mask[k].y : 0;
  }
  return values;
}

/**
 * Every parameter value the node should hold for a mapping.
 *
 * Surfaces beyond the model's are reset to a hidden identity, so a mapping that
 * loses a surface does not leave the last one's corners stuck on the projector.
 *
 * @param {import('./MappingModel.js').MappingModel} model
 * @returns {Object<string, number>}
 */
export function mappingParamValues(model) {
  const values = {};
  const surfaces = model?.surfaces || [];
  for (let i = 0; i < MAX_MAPPED_SURFACES; i++) {
    const surface = surfaces[i];
    if (surface) {
      Object.assign(values, surfaceParamValues(surface, i));
      continue;
    }
    for (let k = 0; k < 9; k++) {
      values[`s${i}m${k}`] = IDENTITY_MAT3[k];
      values[`s${i}n${k}`] = IDENTITY_MAT3[k];
    }
    values[`s${i}opacity`] = 0;
    values[`s${i}soft`] = 0;
    values[`s${i}kn`] = 0;
    for (let k = 0; k < MAX_MASK_POINTS; k++) {
      values[`s${i}k${k}x`] = 0;
      values[`s${i}k${k}y`] = 0;
    }
  }
  return values;
}

/**
 * Push the mapping's current geometry onto the node and into the uniform buffer.
 *
 * The uniform refresh is batched: a corner drag would otherwise re-upload the
 * buffer — and force a frame — once per parameter, over a hundred times per
 * mousemove.
 *
 * @param {import('./MappingModel.js').MappingModel} model
 * @param {object} node the ProjectionMap node
 * @param {object} [deps] injection seam for tests
 * @returns {boolean} whether anything was written
 */
export function syncMappingToNode(model, node, deps = {}) {
  if (!model || !node || node.kind !== 'ProjectionMap') return false;

  const uniformManager = deps.uniformManager
    ?? (typeof window !== 'undefined' ? window.nodeCompiler?.uniformManager : null);
  const renderer = deps.renderer
    ?? (typeof window !== 'undefined' ? window.gpuRenderer : null);

  const values = mappingParamValues(model);
  if (!node.params) node.params = {};

  let changed = false;
  for (const [name, value] of Object.entries(values)) {
    if (node.params[name] !== value) {
      node.params[name] = value;
      changed = true;
    }
    uniformManager?.uniformValues?.set(`${node.id}.${name}`, value);
  }

  if (!changed) return false;

  // One buffer upload for the whole mapping, then one frame if nothing else is
  // drawing — a stopped render loop still has to show the corner move.
  renderer?._updateParameterUniforms?.();
  if (typeof window !== 'undefined' && !window.renderLoop?.getState?.()?.running) {
    const simTime = window.renderLoop?.getState?.()?.simTime;
    renderer?.render?.(Number.isFinite(simTime) ? { timeSec: simTime } : {});
  }
  return true;
}

/**
 * The node currently feeding a surface's pin, or null when it has no flow of its
 * own (and so falls back to the composition).
 *
 * @param {object} node the ProjectionMap node
 * @param {number} index
 * @returns {string|null} the source node's id
 */
export function getSurfaceFlow(node, index) {
  if (!node || !Array.isArray(node.inputs)) return null;
  const sourceId = node.inputs[index];
  return (sourceId === null || sourceId === undefined) ? null : String(sourceId);
}

/**
 * The name a flow shows under, matching what is written on the node in the graph
 * rather than its internal kind — a user who dropped "Gradient" should not be
 * told the surface is showing "ComputeGradient".
 *
 * @param {object} sourceNode
 * @returns {string}
 */
export function flowLabel(sourceNode) {
  if (!sourceNode) return '';
  return sourceNode.name || NodeDefs[sourceNode.kind]?.label || sourceNode.kind || '';
}

/**
 * Give a surface its own flow.
 *
 * A connection lives in TWO places: `graph.connections`, which is what draws the
 * wire and what save/load and undo read, and the target's `inputs` array, which
 * is what the compiler reads. Writing only the second leaves a mapping that
 * renders correctly but has no wire on the canvas and no connection the rest of
 * the editor can see — so both are written here, the way ConnectionManager does
 * it for a dragged wire.
 *
 * The pin count is `node.inputCount`, not `inputs.length`: everything that
 * draws, hit-tests or validates a pin reads it from there, and a connection
 * landing past it is pruned as out of range.
 *
 * @param {object} graph the graph holding the connection list
 * @param {object} node the ProjectionMap node
 * @param {number} index surface to feed
 * @param {string|null} sourceId node to feed it from, or null to clear
 * @returns {boolean} whether the wiring changed
 */
export function assignSurfaceFlow(graph, node, index, sourceId) {
  if (!node || node.kind !== 'ProjectionMap') return false;
  if (!(index >= 0 && index < MAX_MAPPED_SURFACES)) return false;
  // A node feeding itself is a cycle the compiler cannot resolve.
  if (sourceId !== null && sourceId !== undefined && String(sourceId) === String(node.id)) {
    return false;
  }

  const next = sourceId === null || sourceId === undefined ? null : String(sourceId);
  if (!Array.isArray(node.inputs)) node.inputs = [];
  if (node.inputs[index] === next && getInputCount(node) > index) return false;

  // Grow (never shrink) so the pin exists to land on. Pins are positional, so
  // reaching surface 3 means surfaces 1 and 2 exist as pins even while empty.
  if (getInputCount(node) <= index) setInputCount(node, index + 1);

  if (graph && Array.isArray(graph.connections)) {
    graph.connections = graph.connections.filter(
      (c) => !(c && c.to && String(c.to.nodeId) === String(node.id) && c.to.pin === index),
    );
    if (next !== null) {
      graph.connections.push({
        from: { nodeId: next, pin: 0 },
        to: { nodeId: node.id, pin: index },
      });
    }
  }

  node.inputs[index] = next;
  return true;
}
