/**
 * patchLayout.js - where a generated patch's nodes actually sit.
 *
 * A model writes coordinates as an afterthought. Asked for twenty nodes it
 * returns twenty of them at (0, 0), or three columns of numbers that look
 * spread out until you notice a node is 180 wide and 250 tall with its preview
 * band open. Either way the artist opens the patch and finds one node with
 * nineteen hidden underneath it, and the first thing they have to do with a
 * generated patch is drag it apart.
 *
 * So the coordinates are checked here rather than trusted. A patch whose nodes
 * already stand clear of each other is left exactly as it came — a good layout
 * is worth keeping, and the refactor feature is explicitly asked for one. A
 * patch whose nodes collide is laid out from its own wiring instead: columns
 * by signal depth, left to right, which is what the prompt asked for and what
 * the artist can read.
 *
 * Pure, and pure on purpose: it runs in the API route (before a patch is
 * handed back) and in the editor (before one is written to the canvas), so it
 * knows nothing about `window`.
 */

import { NodeDefs } from '../data/NodeDefs.js';
import {
  HEADER_H,
  ROW_H,
  ROW_GRID_TOP_GAP,
  PREVIEW_TOP_GAP,
  BOTTOM_PAD,
} from '../core/pinLayout.js';

/** Every node card is this wide (createBaseNode in NodeDefs.js). */
export const NODE_W = 180;

/**
 * The preview band a visual node opens with. Editor.previewSizes.large, which
 * is the size a node with no explicit per-node setting gets — and a generated
 * patch has none, so this is the height its nodes will actually stand at.
 */
const PREVIEW_BAND = 128;

/** Clear canvas left between one column of nodes and the next when laying a patch out. */
export const COL_GAP = 90;

/** Clear canvas left between one node and the node below it when laying a patch out. */
export const ROW_GAP = 40;

/**
 * The least room two nodes can have between them before the patch counts as
 * needing a new layout.
 *
 * Deliberately far smaller than the gaps above: a tight layout is the model's
 * business, and a patch laid out 40px apart along a chain is a patch someone
 * can read. This is the line where nodes are touching or buried, which no
 * artist asked for and nobody can drag apart quickly.
 */
const MIN_GAP = 16;

/**
 * Whether a node opens with its preview band showing, and so stands ~130px
 * taller than its pins alone would make it.
 *
 * Mirrors Editor.defaultNodePreviewEnabled for a node with no per-node preview
 * setting: compute nodes and visual nodes show a thumbnail, scalar sources
 * (Const, Time, a Math result) do not. Kept as a pure kind test so it can run
 * server-side, where there is no preview manager to ask.
 */
export function showsPreviewBand(kind) {
  if (!kind || kind === 'AudioValue') return false;
  if (kind.toLowerCase().startsWith('compute')) return true;
  if (kind === 'Trigger' || kind === 'Hold' || kind === 'Count' || kind === 'Wave') return false;

  const def = NodeDefs[kind];
  const out = def?.pinsOut?.[0];
  const hasInputs = (def?.inputs > 0) || (Array.isArray(def?.pinsIn) && def.pinsIn.length > 0);

  // A sink with no output of its own (OutputFinal) previews what feeds it.
  if (!out) return hasInputs;

  if (typeof out === 'object') {
    const type = out.type;
    if (type === 'vec2' || type === 'vec3' || type === 'vec4' || type === 'dynamic') return true;
    // A scalar output is still a per-pixel field when it derives from an input.
    return hasInputs || (Array.isArray(def.pinsOut) && def.pinsOut.length > 1);
  }

  return true;
}

/**
 * How tall a node stands on the canvas, from the same anatomy the renderer
 * uses (pinLayout.js): header, optional preview band, one row per socket, and
 * one more row for the +/- chips of a node whose pin count is adjustable.
 */
export function nodeHeight(node) {
  const def = NodeDefs[node?.kind];
  const inputs = Number.isFinite(node?.inputCount) ? node.inputCount : (def?.inputs || 0);
  const outputs = def?.pinsOut?.length || 0;
  const rows = Math.max(inputs, outputs, 1) + (def?.dynamicInputs ? 1 : 0);
  const preview = showsPreviewBand(node?.kind) ? PREVIEW_TOP_GAP + PREVIEW_BAND : 0;

  return HEADER_H + preview + ROW_GRID_TOP_GAP + rows * ROW_H + BOTTOM_PAD;
}

/** The rectangle a node occupies, grown by `margin` of clear space on every side. */
function claimedBox(node, margin = MIN_GAP / 2) {
  const x = Number(node?.x) || 0;
  const y = Number(node?.y) || 0;
  return {
    left: x - margin,
    right: x + NODE_W + margin,
    top: y - margin,
    bottom: y + nodeHeight(node) + margin,
  };
}

function boxesCollide(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Whether any two nodes in a list stand on top of each other — or close enough
 * to it that nothing but a new layout will separate them.
 *
 * @param {Array<Object>} nodes - nodes with x, y and kind.
 */
export function hasOverlappingNodes(nodes) {
  const boxes = (nodes || []).map(claimedBox);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxesCollide(boxes[i], boxes[j])) return true;
    }
  }
  return false;
}

/**
 * How far each node sits from the start of the signal: the longest path to it,
 * so a node never lands left of something feeding it.
 *
 * Relaxed iteratively rather than sorted topologically, because a patch can
 * contain a feedback loop and a cycle must not hang the layout: after one pass
 * per node nothing more can change in an acyclic graph, and a cyclic one stops
 * there with the depths it has reached.
 */
function signalDepths(nodes, connections) {
  const depth = new Map(nodes.map((node) => [String(node.id), 0]));
  const edges = (connections || [])
    .map((conn) => [String(conn?.from?.nodeId), String(conn?.to?.nodeId)])
    .filter(([from, to]) => depth.has(from) && depth.has(to) && from !== to);

  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (const [from, to] of edges) {
      const wanted = depth.get(from) + 1;
      if (wanted > depth.get(to)) {
        depth.set(to, wanted);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return depth;
}

/**
 * Lay a patch out from its wiring: one column per step of signal depth, nodes
 * stacked down each column with room to breathe, each column centred on the
 * same axis so the patch reads as one piece.
 *
 * The order within a column follows the y the model asked for, so whatever it
 * meant by "this branch above that one" survives.
 *
 * @returns {Array<Object>} the same nodes, with new x and y.
 */
function layoutFromGraph(nodes, connections) {
  const depth = signalDepths(nodes, connections);

  const columns = new Map();
  nodes.forEach((node, index) => {
    const column = depth.get(String(node.id)) || 0;
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push({ node, index });
  });

  const placed = new Map();
  for (const [column, members] of columns) {
    members.sort((a, b) => (Number(a.node.y) || 0) - (Number(b.node.y) || 0) || a.index - b.index);

    const heights = members.map(({ node }) => nodeHeight(node));
    const total = heights.reduce((sum, h) => sum + h, 0) + ROW_GAP * (members.length - 1);

    let y = -total / 2;
    members.forEach(({ node }, row) => {
      placed.set(node, { x: column * (NODE_W + COL_GAP), y: Math.round(y) });
      y += heights[row] + ROW_GAP;
    });
  }

  return nodes.map((node) => {
    const at = placed.get(node);
    return at ? { ...node, x: at.x, y: at.y } : node;
  });
}

/**
 * Give every node in a patch room of its own.
 *
 * A patch that already has it is returned untouched — including the object
 * itself, so a caller can tell nothing happened. Otherwise the whole patch is
 * laid out from its wiring, because coordinates that put two nodes in the same
 * place are not coordinates worth half-keeping.
 *
 * @param {{nodes: Array<Object>, connections: Array<Object>}} patch
 * @returns {{nodes: Array<Object>, connections: Array<Object>}}
 */
export function spaceOutPatch(patch) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  if (nodes.length < 2 || !hasOverlappingNodes(nodes)) return patch;

  return { ...patch, nodes: layoutFromGraph(nodes, patch?.connections) };
}

/**
 * The nearest free spot to (x, y) for a node of `kind`, given what is already
 * on the canvas.
 *
 * For a node dropped in one at a time rather than as part of a patch: without
 * this, generating three nodes in a row puts all three at the centre of the
 * view, the third on top of the first two.
 *
 * Searches outwards a column and a row at a time, so a node lands beside what
 * is already there rather than an arbitrary distance from it.
 *
 * @param {number} x - where the node would go if nothing were in the way.
 * @param {number} y
 * @param {{kind: string, inputCount?: number}} node - what is being placed;
 *   its kind and pin count are what its height is measured from.
 * @param {Array<Object>} existing - nodes already on the canvas.
 * @returns {{x: number, y: number}}
 */
export function freeSpotNear(x, y, node, existing) {
  // Placing one node is not a last resort the way relaying a whole patch out
  // is, so it asks for the full gap rather than the bare minimum: a node
  // dropped 16px from its neighbour is technically clear and still a mess.
  const taken = (existing || []).map((other) => claimedBox(other, COL_GAP / 2));
  const stepX = NODE_W + COL_GAP;
  const stepY = nodeHeight(node) + ROW_GAP;

  const isFree = (at) =>
    !taken.some((box) => boxesCollide(box, claimedBox({ ...node, ...at }, COL_GAP / 2)));

  const start = { x: Math.round(x), y: Math.round(y) };
  if (isFree(start)) return start;

  // Rings of candidates around the starting point, nearest ring first.
  for (let ring = 1; ring <= 40; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const at = { x: start.x + dx * stepX, y: start.y + dy * stepY };
        if (isFree(at)) return at;
      }
    }
  }

  return start;
}
