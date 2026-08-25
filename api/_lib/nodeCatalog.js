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

/** Kinds a generated patch may not contain, whatever the model says. */
const UNSUPPORTED_IN_GENERATED_PATCHES = new Set([
  // Both need a file the artist chose; a model cannot supply one, and a node
  // pointing at nothing renders black with no explanation.
  'Texture2D',
  'TextureCube',
]);

function describeParam(param) {
  const bits = [`${param.name}:${param.type}`];
  if (Array.isArray(param.options) && param.options.length) {
    bits.push(`(${param.options.join('|')})`);
  } else if (param.default !== undefined && param.type !== 'glsl') {
    const value = typeof param.default === 'object' ? JSON.stringify(param.default) : String(param.default);
    if (value.length <= 24) bits.push(`=${value}`);
  }
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

  const pinsIn = (def.pinsIn || []).map(describePin).filter(Boolean).join(',');
  parts.push(`in(${def.inputs || 0}${pinsIn ? `: ${pinsIn}` : ''})`);

  const out = (def.pinsOut || []).map(describePin).filter(Boolean).join(',');
  if (out) parts.push(`out(${out})`);

  if (def.dynamicInputs) {
    parts.push(`dynamic-in(${def.dynamicInputs.min}-${def.dynamicInputs.max})`);
  }

  const params = (def.params || []).map(describeParam).join(' ');
  if (params) parts.push(`params: ${params}`);

  return parts.join(' ');
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
    return {
      id,
      kind,
      x: Number.isFinite(node.x) ? node.x : index * 220,
      y: Number.isFinite(node.y) ? node.y : 0,
      params: sanitizeParams(def, node.params),
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
    const inCount = inputCountFor(toNode);

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

  return { patch: { nodes: cleanNodes, connections: cleanConnections }, warnings };
}

/** A node's input count, honouring dynamic-input nodes like CustomGLSL. */
function inputCountFor(node) {
  const def = NodeDefs[node.kind];
  if (def.dynamicInputs) {
    // Dynamic-input nodes carry their pin count on the node itself. A model
    // rarely sets one, and the permissive default (max) is the right fallback
    // here: this check exists to catch a wire to pin 40, not to police pin 5.
    const requested = Number(node.inputCount ?? node.params?.inputCount);
    if (Number.isFinite(requested)) {
      return Math.min(def.dynamicInputs.max, Math.max(def.dynamicInputs.min, requested));
    }
    return def.dynamicInputs.max;
  }
  return def.inputs || 0;
}

/**
 * Keep only parameters the node actually declares.
 *
 * A stray key would ride along into the saved document and mean nothing to
 * anything that reads it later.
 */
function sanitizeParams(def, params) {
  if (!params || typeof params !== 'object') return {};

  const declared = new Map((def.params || []).map((param) => [param.name, param]));
  const clean = {};

  for (const [name, value] of Object.entries(params)) {
    const spec = declared.get(name);
    if (!spec) continue;
    if (value === null || value === undefined) continue;

    if (spec.type === 'select' && Array.isArray(spec.options) && !spec.options.includes(value)) {
      continue;
    }
    clean[name] = value;
  }

  return clean;
}
