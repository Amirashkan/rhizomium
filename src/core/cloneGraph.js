// Copying a piece of a graph — the shared half of duplicate (Cmd/Ctrl+D, the right-click menu) and
// copy/paste (Cmd/Ctrl+C / Cmd/Ctrl+V).
//
// A wire is stored twice, and both halves have to be recreated for a copy to behave like the
// original:
//
//   graph.connections  — [{ from: { nodeId, pin }, to: { nodeId, pin } }], what the renderer draws
//   node.inputs[pin]   — the id of the node feeding that pin, what everything else reads
//
// `inputs` is the half that matters functionally: codegen resolves operands through it
// (NodeCompiler, the compilers under src/codegen), GraphProcessor walks it to order and prune the
// graph, ComputeExecutor binds textures from it, and the renderer fills a pin dot from it. Writing
// only `graph.connections` produces a copy that LOOKS wired and compiles as if it were not — the
// bug this module exists to prevent. ConnectionManager keeps the two in step for wires the artist
// drags; these helpers do the same for wires a copy inherits.

import { makeNode } from "../data/NodeDefs.js";
import { setInputCount } from "../data/nodeInputs.js";

/**
 * A fresh node with the same kind, position offset, parameters and shape as `sourceNode`.
 *
 * Everything the artist can change about a node instance has to ride along, or the copy is a
 * different node wearing the same label. That includes the pin count of an expandable node
 * (Mix/Switch/CustomGLSL/Expression): a 5-input Switch cloned back down to 4 pins silently drops
 * the wire on the fifth.
 *
 * @param {Object} sourceNode
 * @param {number} [offsetX]
 * @param {number} [offsetY]
 * @returns {Object} the clone, with a fresh id and empty inputs
 */
export function cloneNode(sourceNode, offsetX = 20, offsetY = 20) {
  const newNode = makeNode(
    sourceNode.kind,
    (Number.isFinite(sourceNode.x) ? sourceNode.x : 0) + offsetX,
    (Number.isFinite(sourceNode.y) ? sourceNode.y : 0) + offsetY
  );

  // Deep copy params to avoid shared references
  if (sourceNode.params) {
    newNode.params = JSON.parse(JSON.stringify(sourceNode.params));
  }

  if (sourceNode.value !== undefined) {
    newNode.value = sourceNode.value;
  }
  if (sourceNode.expr !== undefined) {
    newNode.expr = sourceNode.expr;
  }
  if (sourceNode.props) {
    newNode.props = JSON.parse(JSON.stringify(sourceNode.props));
  }

  // Expanded input pins are part of the node's shape, so a copy has to carry them — otherwise
  // duplicating a 5-input Mix silently produces a 2-input one and drops the extra wires.
  if (sourceNode.inputCount !== undefined) {
    setInputCount(newNode, sourceNode.inputCount);
  }

  // Same for a custom title: duplicating "bloom mask" and getting an anonymous "Remap" back loses
  // what the artist wrote. The copies stay distinguishable by the #id beside the name.
  if (sourceNode.name) {
    newNode.name = sourceNode.name;
  }

  return newNode;
}

/**
 * Point a clone's input pin at another clone, mirroring the wire into `node.inputs`.
 *
 * The array is grown as needed: an expandable node restored through `setInputCount` already has the
 * right length, but a node whose `inputs` was trimmed or absent must not swallow the wire.
 *
 * @param {Object} node - the clone receiving the wire
 * @param {number} pin - input pin index
 * @param {string} sourceNodeId - id of the clone feeding the pin
 */
function wireInput(node, pin, sourceNodeId) {
  const index = Number(pin);
  if (!Number.isInteger(index) || index < 0) return;

  if (!Array.isArray(node.inputs)) node.inputs = [];
  while (node.inputs.length <= index) node.inputs.push(null);
  node.inputs[index] = sourceNodeId;
}

/**
 * Recreate the wires that ran between the copied nodes, remapped onto their clones.
 *
 * Wires with an endpoint outside the copied set are skipped: the clone keeps that pin empty rather
 * than reaching back to the node it was copied from. Both halves of every recreated wire are
 * written — the returned connection objects for the caller to append to `graph.connections`, and
 * `inputs` on the clones themselves.
 *
 * @param {Array<Object>} connections - source connections to consider (the whole graph's, or a
 *   clipboard snapshot); anything not fully inside `mapOldToNew` is ignored
 * @param {Map<string, string>} mapOldToNew - source node id -> clone id
 * @param {Array<Object>} clones - the clone objects, so their `inputs` can be updated
 * @returns {Array<Object>} the new connection objects, in source order
 */
export function cloneConnections(connections, mapOldToNew, clones) {
  const cloneById = new Map(clones.map((clone) => [clone.id, clone]));
  const newConns = [];

  for (const c of connections || []) {
    const fromNew = mapOldToNew.get(c?.from?.nodeId);
    const toNew = mapOldToNew.get(c?.to?.nodeId);
    if (!fromNew || !toNew) continue;

    newConns.push({
      from: { nodeId: fromNew, pin: c.from.pin },
      to: { nodeId: toNew, pin: c.to.pin },
    });

    const target = cloneById.get(toNew);
    if (target) wireInput(target, c.to.pin, fromNew);
  }

  return newConns;
}
