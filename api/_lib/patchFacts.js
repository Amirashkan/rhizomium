/**
 * patchFacts.js - what the wires say, worked out before the model sees them.
 *
 * A review of a loaded patch was timing out, and the input was never the
 * reason: the whole prompt is around 7,000 tokens, of which the patch is a
 * thousand. The time goes on reasoning tokens, and most of what the model was
 * reasoning about on a large graph was traversal — following every wire to
 * work out which branches reach the output and which pins have nothing in
 * them. That is arithmetic. It scales with the graph, it is what makes a
 * sixty-node patch cost minutes where the default graph costs seconds, and a
 * language model is both the slowest and the least reliable way to do it: on a
 * graph of any size it miscounts.
 *
 * So we do it here, exactly, in microseconds, and hand over the answer. The
 * model spends its budget on the part that needs judgement — whether an empty
 * pin is a mistake, whether a chain is worth collapsing — which is what it was
 * asked for.
 *
 * Everything below is a fact about the graph, never an opinion about it. An
 * unwired pin is reported as unwired, not as a bug; deciding that is the
 * model's job, and the prompt says so.
 */

import { NodeDefs } from '../../src/data/NodeDefs.js';

/** How many ids to name before summarising the rest. */
const MAX_LISTED = 12;

/**
 * The facts block for a patch, or '' when there is nothing worth saying.
 *
 * @param {Object} patch - the trimmed patch (see src/ai/patchContext.js).
 * @returns {string}
 */
export function patchFacts(patch) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  const connections = Array.isArray(patch?.connections) ? patch.connections : [];
  if (!nodes.length) return '';

  // A selection is a piece of a patch, and every fact below has to be read
  // that way or it says the opposite of the truth: a branch whose Output node
  // was not selected is not stranded, and a pin fed from outside the selection
  // is not empty. The crossing wires are what make the difference, so they are
  // folded into the traversal rather than described separately.
  const scoped = patch?.scope === 'selection';
  const boundary = Array.isArray(patch?.boundary) ? patch.boundary : [];
  const leaving = new Set(
    boundary.filter((edge) => edge?.direction === 'out').map((edge) => String(edge?.inside?.nodeId ?? ''))
  );
  const fedFromOutside = new Map();
  for (const edge of boundary) {
    if (edge?.direction !== 'in') continue;
    const id = String(edge?.inside?.nodeId ?? '');
    if (!id) continue;
    if (!fedFromOutside.has(id)) fedFromOutside.set(id, new Set());
    fedFromOutside.get(id).add(Number(edge?.inside?.pin ?? 0) || 0);
  }

  const lines = [];
  const outputs = nodes.filter((node) => NodeDefs[node?.kind]?.cat === 'Output');

  if (scoped) {
    const total = Number(patch?.patchNodeCount);
    lines.push(
      `- This is ${nodes.length} nodes selected out of a patch of ` +
        `${Number.isFinite(total) && total > 0 ? total : 'more'}. The rest of the patch is not shown ` +
        'to you and is not yours to change.'
    );
  }

  // Nodes that feed the unseen rest of the patch are as good as reaching an
  // output: something downstream renders them, and the model cannot see what.
  const sinks = [
    ...outputs.map((node) => String(node?.id ?? '')),
    ...leaving,
  ].filter(Boolean);

  if (!sinks.length) {
    lines.push(
      scoped
        ? '- Nothing in this selection is an Output node, and no wire leaves it, so nothing ' +
            'selected renders on its own.'
        : '- Nothing in this patch is in the Output category, so none of it renders.'
    );
  } else {
    const reaching = reachesOutput(nodes, connections, sinks);
    lines.push(
      scoped
        ? `- ${reaching.size} of ${nodes.length} selected nodes reach an Output node or a wire ` +
            'leaving the selection.'
        : `- ${reaching.size} of ${nodes.length} nodes reach an Output node.`
    );

    const stranded = nodes
      .map((node) => String(node?.id ?? ''))
      .filter((id) => id && !reaching.has(id));
    if (stranded.length) {
      lines.push(
        scoped
          ? `- Reach neither an Output node nor a wire out of the selection: ${list(stranded)}. ` +
              'They may still be read by something outside it, so do not remove them on this alone.'
          : `- Reach no Output node, so they render nothing: ${list(stranded)}.`
      );
    }

    if (outputs.length > 1) {
      lines.push(`- More than one Output node: ${list(outputs.map((node) => String(node.id)))}.`);
    }
  }

  if (boundary.length) {
    lines.push(
      `- ${boundary.length} ${boundary.length === 1 ? 'wire crosses' : 'wires cross'} the edge of the ` +
        'selection (listed above the facts). Those pins are wired, and the editor reconnects them ' +
        'by id and pin number after your answer is applied.'
    );
  }

  const unwired = unwiredInputs(nodes, connections, fedFromOutside);
  if (unwired.length) {
    lines.push(
      `- Input pins with nothing wired into them: ${list(unwired)}. Many of these are ` +
        'meant to be empty — the node reads its parameter instead — so this is a list to ' +
        'judge, not a list of faults.'
    );
  }

  const unknown = [...new Set(nodes.map((node) => node?.kind).filter((kind) => !NodeDefs[kind]))];
  if (unknown.length) {
    lines.push(
      `- Node kinds that are not in the registry above: ${list(unknown)}. They come from ` +
        'a version of the editor you were not given, so say what you can and no more.'
    );
  }

  const dangling = danglingWires(nodes, connections);
  if (dangling.length) {
    lines.push(`- Wires to or from something that is not there: ${list(dangling)}.`);
  }

  if (!lines.length) return '';

  return [
    '',
    '',
    'Worked out from the wires, exactly (do not work these out again):',
    ...lines,
  ].join('\n');
}

/**
 * Every node with a directed path to one of the sinks.
 *
 * A sink is an Output node, or — in a selection — a node whose signal leaves
 * the selection, since what it feeds is downstream and unseen.
 *
 * Walked backwards from the sinks over incoming wires, which visits each
 * wire once: the forward question — "does this node reach an output" — asked of
 * every node separately is the same walk repeated N times.
 */
function reachesOutput(nodes, connections, sinkIds) {
  const incoming = new Map();
  for (const conn of connections) {
    const from = String(conn?.from?.nodeId ?? '');
    const to = String(conn?.to?.nodeId ?? '');
    if (!from || !to) continue;
    if (!incoming.has(to)) incoming.set(to, []);
    incoming.get(to).push(from);
  }

  const reaching = new Set();
  const queue = [...new Set(sinkIds)];
  for (const id of queue) reaching.add(id);

  while (queue.length) {
    const id = queue.pop();
    for (const feeder of incoming.get(id) || []) {
      if (reaching.has(feeder)) continue;
      reaching.add(feeder);
      queue.push(feeder);
    }
  }

  return reaching;
}

/**
 * Input pins with no wire into them, as `id:pin(label)`.
 *
 * A node that takes a variable number of inputs carries its own count; the
 * registry's is the fixed one. Nodes the registry does not know are skipped
 * rather than guessed at.
 */
function unwiredInputs(nodes, connections, fedFromOutside = new Map()) {
  const wired = new Map();
  for (const conn of connections) {
    const to = String(conn?.to?.nodeId ?? '');
    if (!to) continue;
    if (!wired.has(to)) wired.set(to, new Set());
    wired.get(to).add(Number(conn?.to?.pin ?? 0));
  }

  // A pin fed from a node outside the selection is wired; it just happens to
  // be wired to something the model was not shown. Reporting it as empty is
  // how a selection review comes back full of faults that are not there.
  for (const [id, pins] of fedFromOutside) {
    if (!wired.has(id)) wired.set(id, new Set());
    for (const pin of pins) wired.get(id).add(pin);
  }

  const missing = [];
  for (const node of nodes) {
    const def = NodeDefs[node?.kind];
    if (!def) continue;

    const count = Number.isFinite(node?.inputCount) ? node.inputCount : def.inputs || 0;
    const taken = wired.get(String(node?.id ?? '')) || new Set();

    for (let pin = 0; pin < count; pin++) {
      if (taken.has(pin)) continue;
      const label = pinLabel(def, pin);
      missing.push(`${node.id}:${pin}${label ? `(${label})` : ''}`);
    }
  }

  return missing;
}

function pinLabel(def, pin) {
  const spec = (def.pinsIn || [])[pin];
  if (typeof spec === 'string') return spec;
  return spec?.label ? String(spec.label) : '';
}

/** Wires naming a node that is not in the patch, or a pin the node does not have. */
function danglingWires(nodes, connections) {
  const byId = new Map(nodes.map((node) => [String(node?.id ?? ''), node]));
  const broken = [];

  for (const conn of connections) {
    const from = String(conn?.from?.nodeId ?? '');
    const to = String(conn?.to?.nodeId ?? '');
    const wire = `${from}:${conn?.from?.pin ?? 0} -> ${to}:${conn?.to?.pin ?? 0}`;

    if (!byId.has(from) || !byId.has(to)) {
      broken.push(wire);
      continue;
    }

    const toDef = NodeDefs[byId.get(to)?.kind];
    if (!toDef) continue;
    const node = byId.get(to);
    const count = Number.isFinite(node?.inputCount) ? node.inputCount : toDef.inputs || 0;
    if (Number(conn?.to?.pin ?? 0) >= count) broken.push(wire);
  }

  return broken;
}

/** Ids, capped: a patch where everything is stranded should not print a wall. */
function list(items) {
  if (items.length <= MAX_LISTED) return items.join(', ');
  return `${items.slice(0, MAX_LISTED).join(', ')} and ${items.length - MAX_LISTED} more`;
}
