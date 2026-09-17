/**
 * PatchHandles.js - what is actually reachable in a patch, by name.
 *
 * Every performed action names a node and a parameter: a drive binds a signal
 * to `Warp.amount`, a param move ramps `Gradient.inputMix`. ActionExecutor
 * resolves that name against the graph on every write, and when the name is
 * not there the action is inert — the show runs, the log fills, and nothing
 * moves.
 *
 * That failure was invisible from both ends. The scenario is written by a
 * model that was told the scene NAMES and nothing about what is inside them,
 * so it named nodes from the editor's general vocabulary and hoped; the live
 * director was shown the signals, the sections and the log, but never the
 * patch, so when it was asked to bind something it had no vocabulary at all
 * and answered with prose in `why` and an empty `node`. Both produced a set
 * whose every handle pointed at nothing, which on stage is a still, dark
 * picture that nobody can see the cause of.
 *
 * So this file computes the vocabulary, exactly, from the graph — the same
 * move api/_lib/patchFacts.js makes for the patch reviewer, for the same
 * reason. A model that is shown the handles cannot invent one; a model that is
 * shown which of its existing drives resolve to nothing can repair them.
 *
 * Two rules keep it honest:
 *
 * **A handle is what resolveNode() would find.** Not the node's id, which is
 * generated and nobody writes by hand, and not its display name when that is
 * only the definition's label. It is the artist's own name for the node when
 * there is one, and the kind when there is not — in that order, because that
 * is the order the resolver tries. A handle reported here that the resolver
 * would miss is worse than no handle at all.
 *
 * **Only parameters a performer can actually move.** A drive maps a signal
 * from 0..1 onto a number; a select, a boolean, a colour or a file is not a
 * number and writing one from a fader does nothing good. Listing them would
 * be inviting the model to spend its plan on actions that cannot work.
 */

import { NodeDefs } from '../data/NodeDefs.js';
import { customNodeName, defaultNodeName } from '../core/nodeName.js';

/** Parameter types a fader can move. Everything else is not a number. */
const NUMERIC_TYPES = new Set(['float', 'f32', 'int', 'slider']);

/**
 * How many nodes to describe before summarising the rest.
 *
 * A performed patch is built to be reached into — twenty handles is already
 * more than a set uses. The cap is there for the patch that is not: a
 * sixty-node graph loaded from someone else's project, where listing every
 * node would crowd the prompt with arithmetic nodes nobody performs.
 */
export const MAX_HANDLES = 20;

/**
 * …and how many parameters per node.
 *
 * Eight covers every node in the registry but ProjectionMap, which has 361 and
 * is a mapping surface rather than something anyone performs. Taking the first
 * few in registry order was not enough on its own: on a Gradient that order
 * spends its places on geometry and drops `brightness` and `saturation`, which
 * are the two a performer reaches for first.
 */
export const MAX_PARAMS = 8;

/**
 * The handles in a patch, in the order a performer would reach for them.
 *
 * @param {object} patch a graph or a project patch — anything with `nodes`.
 * @param {object} [options]
 * @param {number} [options.maxNodes]
 * @param {number} [options.maxParams]
 * @returns {{nodes: Array, total: number, ambiguous: Array<string>}}
 */
export function patchHandles(patch, { maxNodes = MAX_HANDLES, maxParams = MAX_PARAMS } = {}) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  if (!nodes.length) return { nodes: [], total: 0, ambiguous: [] };

  /** handle (lowercased) -> how many nodes answer to it. */
  const seen = new Map();
  const described = [];

  for (const node of nodes) {
    const handle = handleFor(node);
    if (!handle) continue;

    const key = handle.toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);

    const params = performableParams(node, maxParams);
    // A node with nothing numeric on it is not a handle — it is scenery. The
    // Output node is the clearest case: named, reachable, and with nothing a
    // performer can turn.
    if (!params.length) continue;

    described.push({
      name: handle,
      kind: String(node.kind || ''),
      named: Boolean(customNodeName(node)),
      params,
    });
  }

  // The artist's own names first: a node someone bothered to name is a node
  // built to be performed, and it is also the unambiguous handle.
  described.sort((a, b) => (a.named === b.named ? 0 : a.named ? -1 : 1));

  const ambiguous = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key);

  return {
    nodes: described.slice(0, maxNodes),
    total: described.length,
    ambiguous,
  };
}

/**
 * The name a scenario has to write to reach this node.
 *
 * Mirrors ActionExecutor.resolveNode()'s order, minus the id: the artist's
 * name, then the kind. `defaultNodeName` is deliberately not offered as a
 * handle even though the resolver accepts it, because the two differ ("Gradient"
 * against "ComputeGradient") and offering both doubles the prompt to say the
 * same thing twice.
 */
export function handleFor(node) {
  return customNodeName(node) || String(node?.kind || '') || '';
}

/** The numeric parameters on one node, with where each one currently sits. */
function performableParams(node, limit) {
  const spec = NodeDefs[node?.kind]?.params;
  // A kind the registry does not have is not necessarily a node nothing can
  // turn — a patch saved by a newer build, a kind renamed since. Fall back to
  // whatever numbers the node is actually carrying, without ranges, rather
  // than reporting it as having no handles at all.
  if (!Array.isArray(spec)) return unregisteredParams(node, limit);

  const set = [];
  const rest = [];
  for (const param of spec) {
    if (!NUMERIC_TYPES.has(String(param?.type))) continue;

    const own = node?.params?.[param.name];
    const at = Number(own ?? param.default);
    const entry = { name: param.name };
    if (Number.isFinite(at)) entry.at = round(at);
    if (Number.isFinite(Number(param.min))) entry.min = Number(param.min);
    if (Number.isFinite(Number(param.max))) entry.max = Number(param.max);

    // A parameter the patch carries a value for is one somebody chose, which
    // on a node with more parameters than fit is the better guess at what the
    // look is actually built on.
    (own === undefined ? rest : set).push(entry);
  }

  return set.concat(rest).slice(0, limit);
}

/**
 * Which of these drives address something that is not there.
 *
 * The engine reports this to the director rather than only to the log: a
 * broken drive is the one thing in a performance the model can repair without
 * being asked, because it can see both what the set wanted and what the patch
 * has.
 *
 * @param {Array<{node: string, param: string, signal?: string}>} drives
 * @param {object} patch
 * @returns {Array<{signal: string, node: string, param: string, why: string}>}
 */
export function deadDrives(drives, patch) {
  const list = Array.isArray(drives) ? drives : [];
  if (!list.length) return [];

  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  const out = [];

  for (const drive of list) {
    const found = findNode(nodes, drive?.node);
    if (!found) {
      out.push({
        signal: String(drive?.signal || ''),
        node: String(drive?.node || ''),
        param: String(drive?.param || ''),
        why: drive?.node ? 'no node by that name' : 'no node was named',
      });
      continue;
    }

    const has = (NodeDefs[found.kind]?.params || [])
      .some((param) => param.name === drive?.param);
    if (!has) {
      out.push({
        signal: String(drive?.signal || ''),
        node: String(drive?.node || ''),
        param: String(drive?.param || ''),
        why: drive?.param ? `"${found.kind}" has no parameter by that name` : 'no parameter was named',
      });
    }
  }

  return out;
}

/** resolveNode()'s lookup, without an executor. Kept in step with it by tests. */
function findNode(nodes, reference) {
  if (!reference) return null;
  const key = String(reference);
  const wanted = key.toLowerCase();
  let byName = null;
  let byKind = null;

  for (const node of nodes) {
    if (String(node.id) === key) return node;
    if (!byName && customNodeName(node).toLowerCase() === wanted) byName = node;
    if (!byKind && (String(node.kind).toLowerCase() === wanted
      || defaultNodeName(node).toLowerCase() === wanted)) byKind = node;
  }

  return byName || byKind;
}

/**
 * The handles as prompt text.
 *
 * Written for the scenario call, which reads a brief rather than JSON. One
 * line per node, ranges included, because a drive's `min`/`max` are only worth
 * writing against a parameter whose own range is known — the commonest way a
 * live drive does nothing visible is being mapped into the top tenth of a
 * range it was already sitting in.
 */
export function handlesText(handles) {
  const found = handles?.nodes || [];
  if (!found.length) return '';

  const lines = found.map((node) => {
    const params = node.params
      .map((param) => {
        const range = param.min === undefined || param.max === undefined
          ? '' : ` ${param.min}..${param.max}`;
        const at = param.at === undefined ? '' : `, now ${param.at}`;
        return `${param.name}${range}${at}`;
      })
      .join('; ');
    return `  - "${node.name}" (${node.kind}): ${params}`;
  });

  if (handles.total > found.length) {
    lines.push(`  …and ${handles.total - found.length} more nodes.`);
  }

  return lines.join('\n');
}

/** The numeric params a node carries, for a kind the registry does not know. */
function unregisteredParams(node, limit) {
  const params = node?.params;
  if (!params || typeof params !== 'object') return [];

  const out = [];
  for (const [name, value] of Object.entries(params)) {
    const at = Number(value);
    // `typeof value` rather than Number() alone, so a numeric string from a
    // hand-edited file does not become a handle a fader cannot really move.
    if (typeof value !== 'number' || !Number.isFinite(at)) continue;
    out.push({ name, at: round(at) });
    if (out.length >= limit) break;
  }
  return out;
}

const round = (value) => Math.round(value * 1000) / 1000;

export default patchHandles;
