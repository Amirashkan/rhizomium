// src/accessibility/graphEdits.js
//
// Wiring edits for the keyboard paths — the patch outline and the Connect / Disconnect Pins
// dialogs. Both go through ConnectionManager, the code a mouse drag runs, so a wire made without a
// mouse records its undo step, refreshes the previews and recompiles exactly like one dragged by
// hand. These helpers only add what the keyboard needs on top: a result to describe out loud.

import { describeNode, nodeLabel } from "./graphDescription.js";

function nodeById(editor, nodeId) {
  return editor?.graph?.nodes?.find((n) => n?.id === nodeId) || null;
}

function center(node) {
  return { x: (node.x || 0) + (node.w || 0) / 2, y: (node.y || 0) + (node.h || 0) / 2 };
}

/**
 * Wire `output` ({ nodeId, pin }) into `input` ({ nodeId, pin }).
 *
 * @returns {{ ok: boolean, message: string, replaced?: object }} `message` is the sentence to
 *          announce either way
 */
export function connectPorts(editor, output, input) {
  const outNode = nodeById(editor, output?.nodeId);
  const inNode = nodeById(editor, input?.nodeId);
  const connections = editor?.connections;
  if (!outNode || !inNode || !connections) {
    return { ok: false, message: "Those ports are no longer in the patch." };
  }
  if (outNode === inNode) {
    return { ok: false, message: "A node cannot be connected to itself." };
  }

  const graph = editor.graph;
  const before = describeNode(graph, inNode).inputs[input.pin];
  if (!before) return { ok: false, message: "That input does not exist." };
  const outPin = describeNode(graph, outNode).outputs[output.pin];
  if (!outPin) return { ok: false, message: "That output does not exist." };
  if (before.from?.nodeId === outNode.id && before.from?.pin === output.pin) {
    return { ok: true, message: `${nodeLabel(outNode)} ${outPin.label} already feeds ${nodeLabel(inNode)} input ${before.label}.` };
  }

  connections.startWireDrag(outNode.id, output.pin, center(outNode), false);
  const ok = connections.endWireDrag(center(inNode), { nodeId: inNode.id, pin: input.pin });
  if (!ok) return { ok: false, message: "Could not connect those ports." };

  let message = `Connected ${nodeLabel(outNode)} ${outPin.label} to ${nodeLabel(inNode)} input ${before.label}.`;
  if (before.from && before.from.nodeId !== outNode.id) {
    message += ` It replaces the wire from ${before.from.label}.`;
  }
  return { ok: true, message, replaced: before.from || null };
}

/**
 * Remove whatever feeds one input.
 *
 * @returns {{ ok: boolean, message: string }}
 */
export function disconnectInput(editor, nodeId, pin) {
  const node = nodeById(editor, nodeId);
  const connections = editor?.connections;
  if (!node || !connections) return { ok: false, message: "That input is no longer in the patch." };

  const desc = describeNode(editor.graph, node).inputs[pin];
  if (!desc?.from) return { ok: false, message: "That input is not connected." };

  const hadInput = node.inputs?.[pin] !== null && node.inputs?.[pin] !== undefined;
  const removed = connections.removeConnection(node.id, pin);
  // A wire that only ever lived in node.inputs (an older patch) is cleared by removeConnection
  // without it registering a change, so the shader would keep compiling the stale input.
  if (!removed && hadInput && !node.inputs?.[pin]) editor.onChange?.("Connection Deletion");
  editor.markDirty?.("keyboard-disconnect", "full", { full: true, useThrottling: false });
  editor.draw?.();

  return { ok: true, message: `Disconnected ${nodeLabel(node)} input ${desc.label} from ${desc.from.label}.` };
}

/**
 * Remove several input wires as one undo step.
 *
 * @param {Array<{nodeId, pin}>} inputs
 * @returns {number} how many were removed
 */
export function disconnectInputs(editor, inputs) {
  const undo = editor?.undoManager || (typeof window !== "undefined" ? window.undoManager : null);
  undo?.beginTransaction?.("disconnect wires");
  let removed = 0;
  try {
    for (const { nodeId, pin } of inputs) {
      if (disconnectInput(editor, nodeId, pin).ok) removed += 1;
    }
  } finally {
    undo?.commitTransaction?.();
  }
  return removed;
}
