/**
 * nodeCatalog.js - the real node registry, as prompt text and as a validator.
 *
 * The backend imports the editor's own NodeDefs rather than keeping a second
 * list. Two things fall out of that:
 *
 *   1. The model is told exactly which node kinds exist, with their pins and
 *      parameters, so it has no reason to invent one.
 *   2. Anything it emits anyway is caught here, before the patch reaches an
 *      artist's canvas. A generated patch referencing a node kind that does
 *      not exist is a broken document, and the artist did not ask for one.
 *
 * The catalogue text is deterministic — same bytes every request — so it sits
 * behind a cache breakpoint in the system prompt and is billed once per window
 * rather than once per call.
 */

import { NodeDefs } from '../../src/data/NodeDefs.js';
// An option is either the value itself or a `{ value, label }` pair — the editor's dropdown takes
// both, so anything reading a definition has to as well, or the pair renders as "[object Object]"
// and no value ever validates.
import { optionValues } from '../../src/utils/discreteParams.js';

/** Kinds a generated patch may not contain, whatever the model says. */
const UNSUPPORTED_IN_GENERATED_PATCHES = new Set([
  // Both need a file the artist chose; a model cannot supply one, and a node
  // pointing at nothing renders black with no explanation.
  'Texture2D',
  'TextureCube',
]);

/**
 * How much of a parameter's own description travels.
 *
 * Long enough for the sentence the node file actually wrote — the longest in
 * the registry today is 88 characters — and short enough that one verbose node
 * cannot push the catalogue past the shared prompt's budget on its own.
 */
const MAX_PARAM_DESCRIPTION = 90;

/** The same, for the node's one-line description. */
const MAX_NODE_DESCRIPTION = 140;

/**
 * Parameters a model must never be shown as something it can set.
 *
 * `file` and `font` hold something the artist chose from their own disk, and
 * `button` is an action rather than a value. Listing them invites a generated
 * patch that points at a file nobody has, which renders black with no
 * explanation — the same reason Texture2D is refused outright below.
 *
 * They are only hidden from the *catalogue*: sanitizeParams() still carries
 * one through when a patch already has it, so a refactor of a patch with a
 * loaded font does not delete the font.
 */
const UNSETTABLE_PARAM_TYPES = new Set(['file', 'font', 'button']);

/**
 * Parameters the editor reads but the node file does not declare.
 *
 * `inputTypes` on a CustomGLSL node is the shape of each pin, written by the
 * node generator and read by the compiler (UtilityNodes.js). Without it a
 * generated shader body that swizzles a vec2 pin gets a scalar and fails to
 * compile, so a patch generator that can write CustomGLSL code has to be able
 * to write these too.
 */
const UNDECLARED_PARAMS = {
  CustomGLSL: new Set(['inputTypes']),
};

/** One sentence, cut at a word boundary rather than mid-word. */
function shorten(text, limit) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Parameters worth showing the model: everything the node declares except the
 * ones it keeps for itself (ProjectionMap's corner coordinates, which the
 * artist drags, are 362 of the registry's 738 parameters) and the ones nothing
 * a model writes could fill in.
 */
function visibleParams(def) {
  return (def.params || []).filter(
    (param) => param && !param.hidden && !UNSETTABLE_PARAM_TYPES.has(param.type)
  );
}

function describeParam(param) {
  const bits = [`${param.name}:${param.type}`];
  const options = optionValues(param);
  if (options.length) {
    bits.push(`(${options.join('|')})`);
  } else if (param.default !== undefined && param.type !== 'glsl') {
    const value = typeof param.default === 'object' ? JSON.stringify(param.default) : String(param.default);
    if (value.length <= 24) bits.push(`=${value}`);
  }

  // The range the editor's own control is clamped to. A generated patch that
  // sets a parameter outside it is a patch whose slider is pinned at one end,
  // and the artist has no way of knowing why.
  if (Number.isFinite(param.min) && Number.isFinite(param.max)) {
    bits.push(`[${param.min}..${param.max}]`);
  }

  // What the node file says this parameter is for. The name alone carries a
  // lot ("scale", "speed") and nothing at all for the ones that matter most
  // — "depth" on ComputeParticles is the pseudo-3D control, which no model
  // would guess from four letters.
  const note = param.description || (param.displayName !== param.name ? param.displayName : '');
  if (note) bits.push(`{${shorten(note, MAX_PARAM_DESCRIPTION)}}`);

  return bits.join('');
}

/**
 * Pins are written either as a bare label or as `{ label, type }` depending on
 * the node file. Normalize both to `label:type`.
 */
function describePin(pin) {
  if (typeof pin === 'string') return pin;
  if (!pin || typeof pin !== 'object') return '';
  return pin.type ? `${pin.label}:${pin.type}` : String(pin.label ?? '');
}

function describeNode(kind, def) {
  const parts = [`${kind} [${def.cat}]`];

  // The name on the canvas, when it is not just the kind again. This is the
  // single cheapest thing in the catalogue and one of the most useful: nothing
  // in "ComputeFieldMapper" says "3D Field Visualizer", so a model asked for
  // something in 3D had no way of finding the node that does it.
  if (def.label && def.label !== kind) parts.push(JSON.stringify(def.label));

  const pinsIn = (def.pinsIn || []).map(describePin).filter(Boolean).join(',');
  parts.push(`in(${def.inputs || 0}${pinsIn ? `: ${pinsIn}` : ''})`);

  const out = (def.pinsOut || []).map(describePin).filter(Boolean).join(',');
  if (out) parts.push(`out(${out})`);

  if (def.dynamicInputs) {
    parts.push(`dynamic-in(${def.dynamicInputs.min}-${def.dynamicInputs.max})`);
  }

  const params = visibleParams(def).map(describeParam).join(' ');
  if (params) parts.push(`params: ${params}`);

  const line = parts.join(' ');
  return def.description ? `${line}\n  ${shorten(def.description, MAX_NODE_DESCRIPTION)}` : line;
}

/**
 * The whole registry as one block of prompt text, grouped by category.
 * Deterministic: categories and kinds are both sorted.
 *
 * Built once per process. The registry cannot change under a running
 * deployment, and rebuilding it per request risked the one thing the prefix
 * cache cannot survive: a byte that moves between calls.
 */
let catalogText = null;
export function nodeCatalogText() {
  if (catalogText === null) catalogText = buildCatalogText();
  return catalogText;
}

function buildCatalogText() {
  const byCategory = new Map();
  for (const kind of Object.keys(NodeDefs).sort()) {
    const def = NodeDefs[kind];
    if (!byCategory.has(def.cat)) byCategory.set(def.cat, []);
    byCategory.get(def.cat).push(describeNode(kind, def));
  }

  const sections = [...byCategory.keys()].sort().map((cat) => {
    return `## ${cat}\n${byCategory.get(cat).join('\n')}`;
  });

  return `# Node registry (${Object.keys(NodeDefs).length} kinds)\n\n${sections.join('\n\n')}`;
}

export function isKnownKind(kind) {
  return Object.prototype.hasOwnProperty.call(NodeDefs, kind);
}

export function nodeDef(kind) {
  return NodeDefs[kind] || null;
}

/**
 * Whether a parameter is sitting at the value the registry gives it.
 *
 * The catalogue above already tells the model every default, so a patch that
 * repeats them is paying twice for the same fact — on a parameter-heavy patch
 * that is most of the payload. Anything the artist actually moved still travels.
 *
 * Compared as JSON so that colours and vectors, which arrive as arrays, are
 * compared by value rather than by identity.
 */
export function isDefaultParamValue(kind, name, value) {
  const def = NodeDefs[kind];
  if (!def) return false;

  const spec = (def.params || []).find((param) => param.name === name);
  if (!spec || spec.default === undefined) return false;

  return JSON.stringify(spec.default) === JSON.stringify(value);
}

/**
 * Check a model-authored patch against the registry.
 *
 * Returns `{ patch, warnings }` with the patch normalized, or throws when it
 * is broken in a way that cannot be repaired — an unknown node kind, or no
 * output node, which would leave the artist with a canvas that renders
 * nothing and no reason why.
 *
 * Connections to pins that do not exist are dropped with a warning rather than
 * refused: a patch that is right apart from one stray wire is still worth
 * handing over, and the warning says what was lost.
 */
export function validateGeneratedPatch(patch) {
  const warnings = [];

  if (!patch || typeof patch !== 'object') {
    throw new Error('The model did not return a patch.');
  }

  const nodes = Array.isArray(patch.nodes) ? patch.nodes : [];
  if (!nodes.length) throw new Error('The model returned a patch with no nodes.');

  const seenIds = new Set();
  const cleanNodes = nodes.map((node, index) => {
    const kind = node?.kind;
    if (!isKnownKind(kind)) {
      throw new Error(`The model used a node kind that does not exist: "${kind}".`);
    }
    if (UNSUPPORTED_IN_GENERATED_PATCHES.has(kind)) {
      throw new Error(`"${kind}" needs a file you choose, so it cannot be generated.`);
    }

    let id = String(node.id ?? index + 1);
    if (seenIds.has(id)) {
      const unique = `${id}_${index}`;
      warnings.push(`Duplicate node id "${id}" renamed to "${unique}".`);
      id = unique;
    }
    seenIds.add(id);

    const def = NodeDefs[kind];
    const name = typeof node.name === 'string' ? node.name.trim() : '';
    const pins = requestedInputCount(def, node);

    return {
      id,
      kind,
      x: Number.isFinite(node.x) ? node.x : index * 220,
      y: Number.isFinite(node.y) ? node.y : 0,
      // Carried through rather than dropped: applyResult writes this back to
      // the canvas, so a node that loses its name here loses it on the
      // artist's screen — and naming nodes is something the refactor is asked
      // to do.
      ...(name ? { name } : {}),
      // Only on the nodes that have a choice about it. A Mix with five inputs
      // and an Expression over six signals are ordinary things to ask for, and
      // until this travelled every such node came back at the pin count its
      // definition happens to declare — with the wires past that dropped.
      ...(pins === null ? {} : { inputCount: pins }),
      params: sanitizeParams(def, node.params, kind),
    };
  });

  const hasOutput = cleanNodes.some((node) => NodeDefs[node.kind].cat === 'Output');
  if (!hasOutput) {
    throw new Error('The model returned a patch with no output node, so it would render nothing.');
  }

  const byId = new Map(cleanNodes.map((node) => [node.id, node]));
  const connections = Array.isArray(patch.connections) ? patch.connections : [];
  const cleanConnections = [];

  for (const conn of connections) {
    const fromId = String(conn?.from?.nodeId ?? '');
    const toId = String(conn?.to?.nodeId ?? '');
    const fromNode = byId.get(fromId);
    const toNode = byId.get(toId);

    if (!fromNode || !toNode) {
      warnings.push(`Dropped a connection between unknown nodes (${fromId} → ${toId}).`);
      continue;
    }

    const fromPin = Number(conn.from.pin ?? 0) || 0;
    const toPin = Number(conn.to.pin ?? 0) || 0;

    const outCount = NodeDefs[fromNode.kind].pinsOut?.length || 1;
    const inCount = inputCapacityFor(toNode);

    if (fromPin < 0 || fromPin >= outCount) {
      warnings.push(`Dropped a connection from ${fromNode.kind}: it has no output pin ${fromPin}.`);
      continue;
    }
    if (toPin < 0 || toPin >= inCount) {
      warnings.push(`Dropped a connection into ${toNode.kind}: it has no input pin ${toPin}.`);
      continue;
    }

    cleanConnections.push({
      from: { nodeId: fromId, pin: fromPin },
      to: { nodeId: toId, pin: toPin },
    });
  }

  growInputCounts(cleanNodes, cleanConnections);

  return { patch: { nodes: cleanNodes, connections: cleanConnections }, warnings };
}

/**
 * The pin count a model asked a dynamic-input node for, clamped to what that
 * node allows — or null for a node whose pins are fixed, which is every node
 * the property means nothing on.
 *
 * Read from the node itself and from `params`, because a model that has been
 * told a node's pin count is adjustable puts it in whichever of the two it
 * thinks of first, and both mean the same thing here.
 */
function requestedInputCount(def, node) {
  const spec = def.dynamicInputs;
  if (!spec) return null;

  const requested = Number(node?.inputCount ?? node?.params?.inputCount);
  if (!Number.isFinite(requested)) return null;

  return Math.min(spec.max, Math.max(spec.min, Math.floor(requested)));
}

/**
 * The highest input pin a node can be wired to.
 *
 * Permissive for a dynamic-input node: its pin count is not settled until the
 * wires are known — a wire into pin 4 of a Mix is a request for five pins, not
 * a mistake — so the check here only catches a wire to a pin the node could
 * never have, and growInputCounts() below settles the count afterwards.
 */
function inputCapacityFor(node) {
  const def = NodeDefs[node.kind];
  if (def.dynamicInputs) return def.dynamicInputs.max;
  return def.inputs || 0;
}

/**
 * Give every dynamic-input node enough pins for the wires that reached it.
 *
 * Without this a patch could be internally inconsistent in a way nothing
 * reported: the wire into pin 4 survived validation, and then the node opened
 * on the canvas with the two pins its definition declares and the wire went
 * nowhere. The node's own request wins where it is larger, so a Mix asked for
 * six inputs with three wired keeps three empty pins for the artist to fill.
 *
 * @param {Array<Object>} nodes - the cleaned nodes, mutated in place.
 * @param {Array<Object>} connections - the cleaned connections.
 */
function growInputCounts(nodes, connections) {
  const highestPin = new Map();
  for (const conn of connections) {
    const id = conn.to.nodeId;
    highestPin.set(id, Math.max(highestPin.get(id) ?? -1, conn.to.pin));
  }

  for (const node of nodes) {
    const spec = NodeDefs[node.kind].dynamicInputs;
    if (!spec) continue;

    const wired = (highestPin.get(node.id) ?? -1) + 1;
    if (wired <= (node.inputCount ?? NodeDefs[node.kind].inputs ?? 0)) continue;

    node.inputCount = Math.min(spec.max, Math.max(spec.min, wired));
  }
}

/**
 * Keep only parameters the node actually declares.
 *
 * A stray key would ride along into the saved document and mean nothing to
 * anything that reads it later — with the exception of UNDECLARED_PARAMS,
 * which the editor reads without the node file declaring them.
 */
function sanitizeParams(def, params, kind) {
  if (!params || typeof params !== 'object') return {};

  const declared = new Map((def.params || []).map((param) => [param.name, param]));
  const undeclared = UNDECLARED_PARAMS[kind];
  const clean = {};

  for (const [name, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;

    const spec = declared.get(name);
    if (!spec) {
      if (undeclared?.has(name)) clean[name] = value;
      continue;
    }

    // A select whose value is not one of its options, expression or not: a
    // select is compiled as a branch, not evaluated per frame, so "=…" is as
    // meaningless here as any other word the compiler has no case for.
    // Dropping it leaves the node at its default, which renders something.
    if (spec.type === 'select' && Array.isArray(spec.options)
        && !optionValues(spec).includes(value)) {
      continue;
    }
    clean[name] = value;
  }

  return clean;
}
