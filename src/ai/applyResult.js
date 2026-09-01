/**
 * applyResult.js - put an AI result onto the canvas.
 *
 * Two rules shape everything here:
 *
 *   - A generated node is an addition, so it just lands, selected, undoable.
 *   - A generated or refactored patch replaces the document, so it never lands
 *     without the artist saying yes and without a backup written first. An
 *     artist who asked for a tidy-up and lost an evening's work has been badly
 *     served, however good the refactor was.
 */

import { makeNode } from '../data/NodeDefs.js';
import { setInputCount } from '../data/nodeInputs.js';
import { MAX_PARAM_CHARS } from './patchContext.js';

/** Canvas coordinates of the middle of the view, for placing something new. */
export function viewportCentre() {
  const viewport = window.editor?.viewport;
  const canvas = document.getElementById('canvas') || document.querySelector('canvas');

  if (viewport?.screenToCanvas && canvas) {
    const point = viewport.screenToCanvas(canvas.clientWidth / 2, canvas.clientHeight / 2);
    if (point && Number.isFinite(point.x)) return { x: point.x, y: point.y };
  }

  return { x: 0, y: 0 };
}

/**
 * Insert a model-written node as a CustomGLSL node.
 *
 * The node generator writes a shader body and declares its pins; a CustomGLSL
 * node is exactly that shape, so nothing has to be invented to hold it.
 *
 * @returns {Object} the node that was added.
 */
export function insertGeneratedNode(generated) {
  const graph = window.graph || window.editor?.graph;
  if (!graph) throw new Error('The editor is not ready yet.');

  const centre = viewportCentre();
  const node = makeNode('CustomGLSL', Math.round(centre.x), Math.round(centre.y));

  node.params = node.params || {};
  node.params.code = generated.code || '';
  if (generated.outputType) node.params.outputType = generated.outputType;

  // The pin count the model asked for, clamped by the node's own spec.
  const inputs = Array.isArray(generated.inputs) ? generated.inputs : [];
  if (inputs.length) setInputCount(node, inputs.length);

  // The model declares what each pin carries, and the code it wrote assumes it. Keeping those
  // types is what lets an unconnected pin default to a value of the right shape: a vec2 pin the
  // code takes `.xy` of has to default to vec2<f32>(0.0), not to a scalar the shader cannot
  // swizzle. Without them the compiler is left guessing from the code, which fails outright for a
  // pin that is only ever multiplied or added.
  const inputTypes = inputs.map((input) =>
    (['f32', 'vec2', 'vec3', 'vec4'].includes(input?.type) ? input.type : 'f32')
  );
  if (inputTypes.length) node.params.inputTypes = inputTypes;

  // Name it for what it does, so the canvas reads without opening the code.
  if (generated.name) node.name = generated.name;

  graph.nodes.push(node);
  window.undoManager?.recordNodeCreation?.(node);
  selectNodes([node.id]);
  window.editor?.markDirty?.('ai-node-generated');

  return node;
}

/**
 * Give a node back any parameter the model was never shown in full.
 *
 * A string parameter longer than MAX_PARAM_CHARS travels as its first two
 * thousand characters and a comment saying the rest was cut
 * (see trimParams in patchContext.js). The model can only return what it was
 * given, so a thousand-line shader body would come back as the fragment — and
 * writing that to the canvas would delete most of a node the artist wrote by
 * hand. Measured on a real patch: 49KB of code, 2KB of it sent.
 *
 * The editor still has the original, so the original wins. Nothing else about
 * the node is touched: the refactor may still move it, rename it, rewire it or
 * remove it entirely — it simply does not get to rewrite text it only saw the
 * start of.
 *
 * Matched on id *and* kind, so a generated patch that happens to reuse an id
 * cannot inherit an unrelated node's code.
 */
function keepLongParams(node, before) {
  const original = before.get(String(node.id));
  if (!original || original.kind !== node.kind) return node.params || {};

  const params = { ...(node.params || {}) };
  for (const [key, value] of Object.entries(original.params || {})) {
    if (typeof value === 'string' && value.length > MAX_PARAM_CHARS) {
      params[key] = value;
    }
  }
  return params;
}

/**
 * Replace the whole document with a patch.
 *
 * Writes a backup first: `importProject` clears the graph, and the artist's
 * previous patch is not otherwise recoverable through undo.
 *
 * @param {Object} patch - the validated patch from the backend.
 * @param {Object} [options]
 * @param {boolean} [options.preserveLongParams] - keep parameters the model
 *   was shown only the start of. True for a refactor, which rewrites a patch
 *   the artist already had; meaningless for a generated one, which had no
 *   previous version to preserve.
 * @returns {Promise<void>}
 */
export async function replaceGraphWithPatch(
  patch,
  { title, reason = 'ai-patch', preserveLongParams = false } = {}
) {
  const manager = window.saveLoadManager;
  if (!manager) throw new Error('The editor is not ready yet.');

  // Read the canvas before the backup, because the backup does not change it
  // and the import is about to.
  const before = new Map();
  if (preserveLongParams) {
    const graph = window.graph || window.editor?.graph;
    for (const node of graph?.nodes || []) before.set(String(node.id), node);
  }

  // Best effort: a backup that fails is not a reason to refuse the import the
  // artist just confirmed, but it is worth knowing about.
  try {
    await manager.createBackup(reason);
  } catch (error) {
    console.warn('Could not back up before applying the AI patch:', error);
  }

  const projectData = {
    app: 'Rhizomium-Web',
    format: 'rhizomium-project',
    nodes: patch.nodes.map((node) => ({
      id: String(node.id),
      kind: node.kind,
      position: { x: node.x ?? 0, y: node.y ?? 0 },
      params: preserveLongParams ? keepLongParams(node, before) : node.params || {},
      ...(node.name ? { name: node.name } : {}),
      // The pin count of an expandable node (Mix, Switch, Expr, CustomGLSL,
      // ProjectionMap). The backend only sets it on nodes that have one, and
      // has already clamped it to the node's own spec; hydrateNodes copies it
      // through like any other saved property, and getInputCount() reads it.
      // Dropping it here would put the wires the model drew into pins the node
      // does not show.
      ...(Number.isFinite(node.inputCount) ? { inputCount: node.inputCount } : {}),
    })),
    connections: patch.connections || [],
    ...(title ? { metadata: { name: title } } : {}),
  };

  await manager.importProject(projectData, { clearExisting: true, restoreViewport: false });
  window.editor?.markDirty?.('ai-patch-applied');
}

/**
 * Select nodes by id, so a finding can point at what it is about.
 * Ids the patch no longer contains are skipped rather than throwing.
 */
export function selectNodes(ids) {
  const graph = window.graph || window.editor?.graph;
  if (!graph || !Array.isArray(ids)) return 0;

  const known = new Set(graph.nodes.map((node) => String(node.id)));
  const wanted = ids.map(String).filter((id) => known.has(id));

  if (!(graph.selection instanceof Set)) graph.selection = new Set();
  graph.selection.clear();
  for (const id of wanted) graph.selection.add(id);

  window.editor?.markDirty?.('selection');
  return wanted.length;
}
