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

import { makeNode, NodeDefs } from '../data/NodeDefs.js';
import { setInputCount, getInputCount } from '../data/nodeInputs.js';
import { MAX_PARAM_CHARS } from './patchContext.js';

/**
 * Parameters that also live in a field of their own on a saved node, mirrored
 * from `params` on the way back in (MIRRORED_PARAMS in core/graphHydration.js).
 * hydrateNodes only copies `params.code` into `node.code` when `node.code` is
 * absent, so a spliced node that keeps its old top-level `code` keeps the old
 * code — whatever the refactor wrote into its params.
 */
const MIRRORED_PARAMS = ['value', 'expr', 'code'];

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
 * Whether this parameter value reached the model as a stand-in for itself.
 *
 * trimParams() in patchContext.js sends a placeholder for anything too big to
 * be worth its tokens: a texture's data URL becomes "<embedded data>", a long
 * shader body its first MAX_PARAM_CHARS characters, a long array or a wide
 * object a count. Those are the values a refactor can only hand back as it
 * received them — and writing one back to the canvas is how an artist's
 * texture becomes the literal string "<embedded data>".
 *
 * Asked of the *original* value, which is the one that knows.
 */
function wasSentAsPlaceholder(value) {
  if (typeof value === 'string') return value.startsWith('data:') || value.length > MAX_PARAM_CHARS;
  if (Array.isArray(value)) return value.length > 16;
  if (value && typeof value === 'object') return Object.keys(value).length > 8;
  return false;
}

/**
 * Give a node back any parameter the model was never shown in full.
 *
 * A string parameter longer than MAX_PARAM_CHARS travels as its first two
 * thousand characters and a comment saying the rest was cut, and a texture as
 * the words "<embedded data>" (see trimParams in patchContext.js). The model
 * can only return what it was given, so a thousand-line shader body would come
 * back as the fragment — and writing that to the canvas would delete most of a
 * node the artist wrote by hand. Measured on a real patch: 49KB of code, 2KB
 * of it sent.
 *
 * The editor still has the original, so the original wins. Nothing else about
 * the node is touched: the refactor may still move it, rename it, rewire it or
 * remove it entirely — it simply does not get to rewrite what it only saw a
 * stand-in for.
 *
 * Matched on id *and* kind, so a generated patch that happens to reuse an id
 * cannot inherit an unrelated node's code.
 */
function keepLongParams(node, before) {
  const original = before.get(String(node.id));
  if (!original || original.kind !== node.kind) return node.params || {};

  const params = { ...(node.params || {}) };
  for (const [key, value] of Object.entries(original.params || {})) {
    if (wasSentAsPlaceholder(value)) params[key] = value;
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

/* -------------------------------------------------------------------------
 * A refactor of part of a patch.
 *
 * The whole-patch path above is a replacement: the answer is the document, so
 * importing it over the canvas is the right thing. A selection-scoped run is
 * not that, and until this existed it went down the same path — which meant
 * choosing "Selection" and running a refactor deleted every node the artist
 * had not selected. The two scopes did the same thing to the canvas, and the
 * narrower one did more damage.
 *
 * So a scoped answer is spliced instead: the selected nodes are replaced by
 * what came back, everything else is left exactly as it was, and the wires
 * that ran across the edge of the selection are reconnected by id and pin.
 *
 * It works on the saved form of the project rather than on the live graph —
 * exportProject() out, importProject() back in — so an untouched node keeps
 * every property it had, textures and bindings included, rather than being
 * rebuilt from the handful of fields a patch context carries.
 * ---------------------------------------------------------------------- */

/** An id nothing in `taken` uses, derived from the one asked for. */
function freeId(wanted, taken) {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * How many input pins a node of this kind and pin count shows, or null for a
 * kind the registry does not know.
 *
 * Null rather than zero: getInputCount() answers 0 for an unknown kind, and
 * treating that as "this node has no pins" would drop every wire into a node
 * from a newer version of the editor — which is exactly the node whose wires
 * are least safe to guess about.
 */
function inputCapacity(kind, inputCount) {
  if (!NodeDefs[kind]) return null;
  return getInputCount({ kind, ...(Number.isFinite(inputCount) ? { inputCount } : {}) });
}

/**
 * Fold one refactored node into the record the project already held for it.
 *
 * The model saw a trimmed node: id, kind, position, name, pin count and the
 * parameters that fit. Everything else on a saved node — a texture binding, a
 * cached size, a property some node kind grew last month — it never saw and
 * cannot have an opinion about, so it survives untouched.
 *
 * When the kind changed, none of that applies any more and the node is built
 * from the answer alone.
 */
function foldNode(returned, original, id) {
  const params =
    original && original.kind === returned.kind
      ? { ...(original.params || {}), ...(returned.params || {}) }
      : { ...(returned.params || {}) };

  // A parameter the model saw a stand-in for comes back as that stand-in; the
  // artist's own value wins. Same rule as keepLongParams(), which the
  // whole-patch path applies.
  for (const [key, value] of Object.entries(original?.params || {})) {
    if (wasSentAsPlaceholder(value)) params[key] = value;
  }

  const base = original && original.kind === returned.kind ? { ...original } : {};
  // Rebuilt from the connections below, and stale entries would wire pins the
  // refactor unwired.
  delete base.inputs;
  delete base.outputs;

  const node = {
    ...base,
    // The id the splice settled on, which is the model's own except when it
    // clashed with a node outside the selection.
    id: String(id),
    kind: returned.kind,
    position: { x: returned.x ?? original?.position?.x ?? 0, y: returned.y ?? original?.position?.y ?? 0 },
    params,
  };

  // A rename lands. A *missing* name does not clear the artist's own: the
  // prompt asks the model to improve names, so an answer that omits one has
  // almost certainly left that node alone rather than meant "remove its name".
  if (returned.name) node.name = returned.name;

  if (Number.isFinite(returned.inputCount)) node.inputCount = returned.inputCount;

  // The mirrored fields have to follow their parameter or the old value wins
  // on the way back in.
  for (const name of MIRRORED_PARAMS) {
    if (params[name] !== undefined) node[name] = params[name];
  }

  return node;
}

/**
 * Work out what splicing this answer into the canvas would do, without doing it.
 *
 * Pure, so the panel can put the real numbers in front of the artist before
 * they say yes: a dialog that says "6 nodes rewritten, 94 untouched, one wire
 * to the rest of the patch cannot be reconnected" is a different decision from
 * "apply this".
 *
 * @param {Object} patch - the validated patch from the backend.
 * @param {Object} options
 * @param {Object} options.projectData - the project as exportProject() gives it.
 * @param {Iterable<string|number>} options.nodeIds - what was sent, which is
 *   what the answer replaces. Read from the run rather than from the live
 *   selection: the artist may have clicked elsewhere while the call ran.
 * @returns {{projectData: Object, replaced: number, added: number, removed: Array<string>,
 *   untouched: number, renamed: Array<{from: string, to: string}>,
 *   reconnected: number, droppedWires: Array<string>}}
 */
export function planSelectionSplice(patch, { projectData, nodeIds }) {
  const scoped = new Set([...(nodeIds || [])].map(String));
  const originalNodes = Array.isArray(projectData?.nodes) ? projectData.nodes : [];
  const originalConnections = Array.isArray(projectData?.connections) ? projectData.connections : [];
  const returnedNodes = Array.isArray(patch?.nodes) ? patch.nodes : [];

  const originalById = new Map(originalNodes.map((node) => [String(node?.id), node]));
  const outsideIds = new Set(
    originalNodes.map((node) => String(node?.id)).filter((id) => !scoped.has(id))
  );

  // Ids the answer may not take: everything outside the selection keeps its
  // own. A node the model invented that collides with one is renamed, and the
  // wires it drew follow the new name.
  const taken = new Set(outsideIds);
  const rename = new Map();
  const kept = [];

  for (const returned of returnedNodes) {
    const id = String(returned?.id ?? '');
    if (!id) continue;

    if (scoped.has(id)) {
      taken.add(id);
      kept.push({ returned, id, original: originalById.get(id) || null, isNew: false });
      continue;
    }

    // An id from outside the selection: the model was told not to return one,
    // and returning it would silently overwrite a node it never saw. Treat it
    // as a node it wants to add, under an id of its own.
    const id2 = freeId(outsideIds.has(id) ? `${id}_ai` : id, taken);
    taken.add(id2);
    if (id2 !== id) rename.set(id, id2);
    kept.push({ returned, id: id2, original: null, isNew: true });
  }

  const survivors = new Set(kept.map((entry) => entry.id));
  const removed = [...scoped].filter((id) => originalById.has(id) && !survivors.has(id));

  // Nodes in canvas order, with the selection swapped out in place: a refactor
  // that reorders the list would shuffle the draw order of everything else.
  const nodes = [];
  for (const node of originalNodes) {
    const id = String(node?.id);
    if (!scoped.has(id)) {
      nodes.push(node);
      continue;
    }
    const entry = kept.find((candidate) => candidate.id === id);
    if (entry) nodes.push(foldNode(entry.returned, entry.original, entry.id));
  }
  for (const entry of kept) {
    if (entry.isNew) nodes.push(foldNode(entry.returned, null, entry.id));
  }

  const finalById = new Map(nodes.map((node) => [String(node?.id), node]));
  const capacityOf = (id) => {
    const node = finalById.get(id);
    return node ? inputCapacity(node.kind, node.inputCount) : 0;
  };

  const connections = [];
  const droppedWires = [];
  let reconnected = 0;

  // 1. The rest of the patch, untouched.
  for (const conn of originalConnections) {
    const from = String(conn?.from?.nodeId ?? '');
    const to = String(conn?.to?.nodeId ?? '');
    if (scoped.has(from) || scoped.has(to)) continue;
    connections.push(conn);
  }

  // 2. The wires that crossed the edge. These are the point of the whole
  //    exercise: without them the selection comes back as an island. A wire is
  //    kept when its end inside the selection survived and still has the pin —
  //    a refactor that narrowed a Mix from four inputs to two is entitled to,
  //    and the wire into the pin it removed has to go, said out loud.
  for (const conn of originalConnections) {
    const from = String(conn?.from?.nodeId ?? '');
    const to = String(conn?.to?.nodeId ?? '');
    const fromIn = scoped.has(from);
    const toIn = scoped.has(to);
    if (fromIn === toIn) continue;

    const insideId = fromIn ? from : to;
    const wire = `${from}:${conn?.from?.pin ?? 0} → ${to}:${conn?.to?.pin ?? 0}`;

    if (!survivors.has(insideId)) {
      droppedWires.push(`${wire} (${insideId} was removed)`);
      continue;
    }
    const capacity = capacityOf(to);
    if (capacity !== null && Number(conn?.to?.pin ?? 0) >= capacity) {
      droppedWires.push(`${wire} (${to} no longer has that pin)`);
      continue;
    }
    connections.push(conn);
    reconnected += 1;
  }

  // 3. The selection's own wiring, as the refactor drew it. Only between nodes
  //    the answer owns: a wire naming a node outside the selection is one the
  //    model was told not to draw, and honouring it would rewire a part of the
  //    patch it was never shown.
  const seen = new Set(connections.map((conn) => `${conn.to.nodeId}:${conn.to.pin}`));
  for (const conn of Array.isArray(patch?.connections) ? patch.connections : []) {
    const from = rename.get(String(conn?.from?.nodeId ?? '')) ?? String(conn?.from?.nodeId ?? '');
    const to = rename.get(String(conn?.to?.nodeId ?? '')) ?? String(conn?.to?.nodeId ?? '');
    const pin = Number(conn?.to?.pin ?? 0) || 0;

    if (!survivors.has(from) || !survivors.has(to)) continue;
    const capacity = capacityOf(to);
    if (capacity !== null && pin >= capacity) continue;
    // An input pin takes one wire. The boundary wires were placed first
    // because they are the artist's, not the model's: a refactor that wires
    // something into a pin the rest of the patch already feeds does not get to
    // cut that connection.
    const slot = `${to}:${pin}`;
    if (seen.has(slot)) continue;
    seen.add(slot);

    connections.push({
      from: { nodeId: from, pin: Number(conn?.from?.pin ?? 0) || 0 },
      to: { nodeId: to, pin },
    });
  }

  return {
    projectData: { ...projectData, nodes, connections },
    /** What the refactor now owns on the canvas, for the selection afterwards. */
    survivorIds: [...survivors],
    replaced: kept.filter((entry) => !entry.isNew).length,
    added: kept.filter((entry) => entry.isNew).length,
    removed,
    untouched: outsideIds.size,
    renamed: [...rename].map(([from, to]) => ({ from, to })),
    reconnected,
    droppedWires,
  };
}

/**
 * Splice a refactored selection into the canvas, leaving the rest of it alone.
 *
 * A backup first, for the same reason the whole-patch path writes one: this
 * rewrites part of the artist's document, and the import that lands it is not
 * a single undo step.
 *
 * @param {Object} patch - the validated patch from the backend.
 * @param {Object} options
 * @param {Iterable<string|number>} options.nodeIds - the ids that were sent.
 * @param {string} [options.reason] - backup label.
 * @returns {Promise<Object>} the plan that was applied, for the report.
 */
export async function spliceSelectionPatch(patch, { nodeIds, reason = 'ai-refactor-selection' } = {}) {
  const manager = window.saveLoadManager;
  if (!manager?.exportProject) throw new Error('The editor is not ready yet.');

  const plan = planSelectionSplice(patch, { projectData: manager.exportProject(), nodeIds });

  try {
    await manager.createBackup(reason);
  } catch (error) {
    console.warn('Could not back up before splicing the AI refactor:', error);
  }

  await manager.importProject(plan.projectData, { clearExisting: true, restoreViewport: false });
  window.editor?.markDirty?.('ai-refactor-applied');

  // The refactor is easier to read when what it touched is what is selected —
  // and it leaves the scope pointing at the same part of the patch, so a
  // second pass tidies the same thing rather than whatever was left highlighted.
  selectNodes(plan.survivorIds);

  return plan;
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
