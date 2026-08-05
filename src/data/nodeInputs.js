// Expandable node inputs — the single source of truth for "how many input pins does THIS node
// have, and what are they called".
//
// Most nodes have a fixed pin list baked into their definition (`def.inputs` / `def.pinsIn`). A few
// combine an arbitrary number of upstream signals — Mix, Switch, Custom GLSL, Expression — and are
// marked expandable with a `dynamicInputs` spec:
//
//     Switch: {
//       inputs: 4,                     // the pins the definition names
//       pinsIn: ["A", "B", "C", "D"],
//       dynamicInputs: { min: 2, max: 8, labelStyle: "upperLetter" },
//       ...
//     }
//
// The live count then lives on the node INSTANCE as `node.inputCount`, so two Switch nodes in the
// same graph can have different pin counts. It rides along with the node through save/load, undo and
// duplication (all of which copy whole node objects), and falls back to `def.inputs` when absent —
// so every project saved before this existed keeps its original pin count.
//
// Everything that draws, hit-tests, validates or compiles an input pin must read the count and the
// labels from here rather than from the definition, or the pins drift apart from the wires.

import { NodeDefs } from './NodeDefs.js';

/** Hard ceiling on generated labels: A–Z is plenty, and no spec should ask for more than a handful. */
const UPPER_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function defOf(nodeOrKind) {
  if (!nodeOrKind) return null;
  const kind = typeof nodeOrKind === 'string' ? nodeOrKind : nodeOrKind.kind;
  return NodeDefs[kind] || null;
}

/**
 * The expandable-input spec for a node (or node kind), or null when its pins are fixed.
 * Presence of a spec is what puts the "+" chip on the node.
 *
 * @param {Object|string} nodeOrKind
 * @returns {{min: number, max: number, labelStyle?: string, labelPrefix?: string}|null}
 */
export function getDynamicInputSpec(nodeOrKind) {
  const spec = defOf(nodeOrKind)?.dynamicInputs;
  if (!spec) return null;

  const declared = defOf(nodeOrKind)?.inputs || 0;
  const min = Number.isFinite(spec.min) ? Math.max(0, spec.min) : declared;
  const max = Number.isFinite(spec.max) ? Math.max(min, spec.max) : declared;
  return { ...spec, min, max };
}

/**
 * How many input pins this node actually shows. `node.inputCount` when it carries one (clamped to
 * the spec so a hand-edited or stale project file can't produce pins the compiler won't wire), else
 * the definition's fixed count.
 *
 * @param {Object} node
 * @returns {number}
 */
export function getInputCount(node) {
  const def = defOf(node);
  const declared = def?.inputs || 0;
  const spec = getDynamicInputSpec(node);
  if (!spec) return declared;

  const stored = Number(node?.inputCount);
  if (!Number.isFinite(stored)) return declared;
  return Math.max(spec.min, Math.min(spec.max, Math.floor(stored)));
}

/**
 * Display label for input pin `i`. Pins the definition names use that name; pins added past the end
 * of `pinsIn` get a generated one that continues the definition's own naming
 * ("Input A, Input B" → "Input C"; "A, B, C, D" → "E"; "Input 0…3" → "Input 4"; "a, b" → "c").
 *
 * @param {Object} node
 * @param {number} i
 * @returns {string}
 */
export function getInputLabel(node, i) {
  const def = defOf(node);
  const entry = def?.pinsIn?.[i];
  if (entry) return typeof entry === 'string' ? entry : entry.label || '';

  const spec = getDynamicInputSpec(node);
  if (!spec) return '';

  const prefix = spec.labelPrefix || '';
  switch (spec.labelStyle) {
    case 'upperLetter':
      return `${prefix}${UPPER_LETTERS[i] || String(i)}`;
    case 'lowerLetter':
      return `${prefix}${(UPPER_LETTERS[i] || String(i)).toLowerCase()}`;
    case 'index1':
      return `${prefix}${i + 1}`;
    case 'index0':
    default:
      return `${prefix}${i}`;
  }
}

/** Whether the node can grow by one pin (it is expandable and below its max). */
export function canAddInput(node) {
  const spec = getDynamicInputSpec(node);
  return !!spec && getInputCount(node) < spec.max;
}

/** Whether the node can shed a pin (it is expandable and above its min). */
export function canRemoveInput(node) {
  const spec = getDynamicInputSpec(node);
  return !!spec && getInputCount(node) > spec.min;
}

/**
 * Grow the node by one input pin. The `inputs` array grows with it so the new pin starts empty
 * rather than inheriting a stale id.
 *
 * @param {Object} node
 * @returns {number} index of the new pin, or -1 when the node can't grow
 */
export function addNodeInput(node) {
  if (!canAddInput(node)) return -1;

  const index = getInputCount(node);
  node.inputCount = index + 1;
  if (!Array.isArray(node.inputs)) node.inputs = [];
  while (node.inputs.length < node.inputCount) node.inputs.push(null);
  return index;
}

/**
 * Shrink the node by one input pin. Only updates the node — the caller is responsible for tearing
 * down any connection landing on the removed pin FIRST (see Editor.removeNodeInput), because the
 * wire lives in `graph.connections`, which this module deliberately knows nothing about.
 *
 * @param {Object} node
 * @returns {number} index of the removed pin, or -1 when the node can't shrink
 */
export function removeNodeInput(node) {
  if (!canRemoveInput(node)) return -1;

  const index = getInputCount(node) - 1;
  node.inputCount = index;
  if (Array.isArray(node.inputs) && node.inputs.length > index) {
    node.inputs.length = index;
  }
  return index;
}

/**
 * Set a node's pin count outright, clamped to its spec. Used by undo/redo to restore an exact
 * previous count without replaying individual add/remove steps.
 *
 * @param {Object} node
 * @param {number} count
 */
export function setInputCount(node, count) {
  const spec = getDynamicInputSpec(node);
  if (!spec || !node) return;

  const next = Math.max(spec.min, Math.min(spec.max, Math.floor(Number(count) || 0)));
  node.inputCount = next;
  if (!Array.isArray(node.inputs)) node.inputs = [];
  while (node.inputs.length < next) node.inputs.push(null);
  if (node.inputs.length > next) node.inputs.length = next;
}
