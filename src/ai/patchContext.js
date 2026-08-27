/**
 * patchContext.js - the patch, trimmed down to what a model needs to read it.
 *
 * A saved project carries a lot that is meaningless to a language model and
 * expensive to send: embedded texture data URLs, cached previews, MIDI and OSC
 * bindings, viewport state. What is left after taking those out is the graph
 * itself — which nodes, which parameters, which wires — and that is the whole
 * of what a review or a refactor reasons about.
 *
 * This is also a privacy boundary in a small way: whatever this function keeps
 * is what leaves the artist's machine.
 */

/**
 * Past this many nodes a patch stops fitting comfortably in one call, and the
 * answer gets worse rather than more thorough. Refuse rather than truncate:
 * a review of two-thirds of a patch, presented as a review, is misleading.
 */
export const MAX_NODES = 400;

export class PatchTooLargeError extends Error {
  constructor(count) {
    super(
      `This patch has ${count} nodes, more than the ${MAX_NODES} an AI call can read at once. ` +
        'Try it on a smaller patch.'
    );
    this.name = 'PatchTooLargeError';
    this.nodeCount = count;
  }
}

export class EmptyPatchError extends Error {
  constructor(message = 'There is nothing on the canvas yet.') {
    super(message);
    this.name = 'EmptyPatchError';
  }
}

/* -------------------------------------------------------------------------
 * Will a refactor of this patch finish?
 *
 * MAX_NODES is the limit on what a call can *read*. The refactor has a second
 * limit nobody was checking: it hands the whole patch back as JSON, so what it
 * has to *write* grows with the patch while the deadline does not — run.js
 * clamps every call at MODEL_DEADLINE_MS however large its budget. Measured
 * (see api/_lib/tokenCost.js and npm run ai:tokens), a 400-node patch is about
 * 20,600 tokens of answer, and decoding that plus its thinking room is roughly
 * twice the deadline.
 *
 * Left unchecked that is the worst failure the editor has: the gallery meters
 * the grant when it issues it, before the model is called at all, so the
 * artist waits nearly five minutes and is then charged an action for a 504.
 * Working it out first costs a JSON.stringify of a patch already in memory.
 *
 * The asymmetry is what makes refusing the right call rather than a cautious
 * one: a refusal that turns out to be wrong costs the artist a message telling
 * them to select part of the patch, and no allowance. Letting one through that
 * cannot finish costs them the action, the wait, and the answer.
 * ---------------------------------------------------------------------- */

/**
 * Mirrored from the backend, which owns these numbers.
 *
 * `ai.patch_refactor`'s `reasoningTokens` and `maxTokens` in
 * api/_lib/features.js, and `ASSUMED_TOKENS_PER_SECOND` and
 * `MODEL_DEADLINE_MS` in api/ai/run.js. tests/aiFeatureTokenCost.test.js
 * imports both sides and fails if any of them drift.
 */
export const REFACTOR_BUDGET = {
  /** Room the feature is given to think, which is decoded like any other token. */
  reserveTokens: 8000,
  /** The most it may write before the call comes back `incomplete`. */
  answerCeilingTokens: 32000,
  /** The pessimistic decode rate run.js sizes its deadline from. */
  pessimisticTokensPerSecond: 50,
  /**
   * What these models actually decode at — run.js describes its own figure as
   * roughly half of practice. Used only to decide what is impossible, never to
   * promise that something is quick.
   */
  realisticTokensPerSecond: 100,
  /** Where the call is stopped, whatever it is doing (MODEL_DEADLINE_MS). */
  deadlineSeconds: 285,
};

/**
 * What a refactor of this patch would have to write back.
 *
 * The answer is the patch itself, as JSON, in the schema features.js declares —
 * not the compact line format it arrived in — plus a summary and a change list.
 * Estimated at the same four bytes to a token as everything else here.
 */
export function estimateRefactorAnswerTokens(patch) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  const connections = Array.isArray(patch?.connections) ? patch.connections : [];

  // One change entry per ten nodes: a tidy-up that touched a tenth of the
  // graph. Sized generously rather than tightly — undercounting here is what
  // would let a call through that cannot finish.
  const changes = Math.ceil(nodes.length / 10) * 120;

  let bytes = 0;
  try {
    bytes = new TextEncoder().encode(JSON.stringify({ nodes, connections })).length;
  } catch {
    bytes = JSON.stringify({ nodes, connections }).length;
  }

  return Math.ceil(bytes / 4) + changes;
}

/**
 * Whether a refactor of this patch can finish, worked out before anything is
 * spent on it.
 *
 * @param {Object} patch - the trimmed patch, as buildPatchContext() returns it.
 * @returns {{verdict: 'fits'|'tight'|'too_large', reason: string|null,
 *   answerTokens: number, neededTokens: number, seconds: number,
 *   optimisticSeconds: number, message: string|null}}
 *
 *   `fits` — finishes even at the pessimistic rate. Say nothing.
 *   `tight` — finishes at the rate these models really decode, but not at the
 *     rate the deadline was sized from. Worth a word before the click; not
 *     worth refusing, because it is the band most loaded patches land in.
 *   `too_large` — cannot finish, either because the answer would not fit the
 *     budget or because writing it would outrun the deadline at any plausible
 *     speed. Refuse this one.
 */
export function refactorFit(patch) {
  const {
    reserveTokens,
    answerCeilingTokens,
    pessimisticTokensPerSecond,
    realisticTokensPerSecond,
    deadlineSeconds,
  } = REFACTOR_BUDGET;

  const answerTokens = estimateRefactorAnswerTokens(patch);
  const neededTokens = answerTokens + reserveTokens;
  const nodeCount = patch?.nodes?.length ?? 0;

  const seconds = Math.round(neededTokens / pessimisticTokensPerSecond);
  const optimisticSeconds = Math.round(neededTokens / realisticTokensPerSecond);

  const verdictFor = (verdict, reason, message) => ({
    verdict,
    reason,
    answerTokens,
    neededTokens,
    seconds,
    optimisticSeconds,
    message,
  });

  // Truncation, not timeout: the model would run out of room mid-patch and the
  // call would come back `incomplete`. Half a patch is not a patch.
  if (answerTokens > answerCeilingTokens) {
    return verdictFor(
      'too_large',
      'budget',
      `Rewriting these ${nodeCount} nodes would take about ${Math.round(answerTokens / 1000)}k tokens, ` +
        `more than the ${Math.round(answerCeilingTokens / 1000)}k a refactor can write in one answer. ` +
        'Select part of the patch and tidy it in pieces.'
    );
  }

  if (optimisticSeconds > deadlineSeconds) {
    return verdictFor(
      'too_large',
      'time',
      `A refactor of these ${nodeCount} nodes has to write about ${Math.round(answerTokens / 1000)}k tokens, ` +
        `which takes longer than the ${deadlineSeconds} seconds a call is given — so it would be stopped ` +
        'before it answered. Select part of the patch and tidy it in pieces. Nothing has been charged for this.'
    );
  }

  if (seconds > deadlineSeconds) {
    return verdictFor(
      'tight',
      'time',
      `This is a large refactor: about ${Math.round(answerTokens / 1000)}k tokens to write back, which may ` +
        `run past the ${deadlineSeconds}-second limit. Tidying a selection at a time is more reliable.`
    );
  }

  return verdictFor('fits', null, null);
}

/** A refactor that was worked out to be impossible before it was paid for. */
export class RefactorTooLargeError extends Error {
  constructor(fit) {
    super(fit.message);
    this.name = 'RefactorTooLargeError';
    this.fit = fit;
  }
}

/**
 * Build the model-facing view of the current project.
 *
 * @param {Object} projectData - what SaveLoadManager.exportProject() returns.
 * @param {Object} [options]
 * @param {Iterable<string|number>} [options.nodeIds] - when given, keep only
 *   these nodes and the wires that run between them. This is the panel's
 *   "selection only" scope: a review of one branch of a large patch, which
 *   both costs less and gets a more specific answer than the whole document.
 * @returns {{nodes: Array, connections: Array, nodeCount: number, scope: string}}
 */
export function buildPatchContext(projectData, { nodeIds } = {}) {
  let nodes = Array.isArray(projectData?.nodes) ? projectData.nodes : [];
  let connections = Array.isArray(projectData?.connections) ? projectData.connections : [];

  if (!nodes.length) throw new EmptyPatchError();

  const keep = nodeIds ? new Set([...nodeIds].map(String)) : null;
  if (keep) {
    nodes = nodes.filter((node) => keep.has(String(node?.id)));
    if (!nodes.length) {
      throw new EmptyPatchError('Nothing is selected, so there is nothing to send.');
    }
    // A wire with one end outside the selection would name a node the model
    // never sees, which reads as a broken patch rather than a partial one.
    connections = connections.filter(
      (conn) =>
        keep.has(String(conn?.from?.nodeId)) && keep.has(String(conn?.to?.nodeId))
    );
  }

  if (nodes.length > MAX_NODES) throw new PatchTooLargeError(nodes.length);

  return {
    nodes: nodes.map(trimNode),
    connections: connections.map((conn) => ({
      from: { nodeId: String(conn?.from?.nodeId ?? ''), pin: conn?.from?.pin ?? 0 },
      to: { nodeId: String(conn?.to?.nodeId ?? ''), pin: conn?.to?.pin ?? 0 },
    })),
    nodeCount: nodes.length,
    scope: keep ? 'selection' : 'patch',
  };
}

/**
 * What this patch costs to send, for the panel to show before anything is
 * spent.
 *
 * `approxTokens` is a heuristic — four characters to a token, the usual rule
 * of thumb for English-and-JSON — and is labelled as an estimate wherever it
 * is drawn. The exact count comes back with the answer in `usage`; this is
 * only meant to be the difference between "this will be fine" and "this is a
 * very large call".
 */
export function measurePatchContext(patch) {
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes : [];
  const connections = Array.isArray(patch?.connections) ? patch.connections : [];

  let bytes = 0;
  try {
    // TextEncoder gives the real wire size for non-ASCII node names, which
    // JSON.stringify().length does not.
    bytes = new TextEncoder().encode(JSON.stringify(patch ?? {})).length;
  } catch {
    bytes = JSON.stringify(patch ?? {}).length;
  }

  const kinds = new Set();
  for (const node of nodes) if (node?.kind) kinds.add(node.kind);

  return {
    nodeCount: nodes.length,
    connectionCount: connections.length,
    kindCount: kinds.size,
    bytes,
    approxTokens: Math.round(bytes / 4),
    /** Share of the per-call node budget this patch uses, 0..1+. */
    capacity: nodes.length / MAX_NODES,
  };
}

function trimNode(node) {
  const trimmed = {
    id: String(node.id),
    kind: node.kind,
    x: Math.round(node.position?.x ?? node.x ?? 0),
    y: Math.round(node.position?.y ?? node.y ?? 0),
  };

  // The artist's own name for a node says more about intent than anything
  // else in the document — worth every token it costs.
  if (node.name) trimmed.name = node.name;
  if (Number.isFinite(node.inputCount)) trimmed.inputCount = node.inputCount;

  const params = trimParams(node.params);
  if (params) trimmed.params = params;

  return trimmed;
}

/**
 * Keep parameter values, drop parameter payloads.
 *
 * A texture's data URL or a rasterized font can be megabytes and tells a model
 * nothing it can act on; the fact that the parameter is set does.
 */
function trimParams(params) {
  if (!params || typeof params !== 'object') return null;

  const trimmed = {};
  for (const [name, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;

    if (typeof value === 'string') {
      if (value.startsWith('data:')) {
        trimmed[name] = '<embedded data>';
      } else if (value.length > 2000) {
        // Custom GLSL bodies are worth sending; a novel is not.
        trimmed[name] = `${value.slice(0, 2000)}\n/* … truncated */`;
      } else {
        trimmed[name] = value;
      }
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      trimmed[name] = value;
      continue;
    }

    if (Array.isArray(value)) {
      // Colours and vectors are short; anything long is sample data.
      trimmed[name] = value.length <= 16 ? value : `<${value.length} values>`;
      continue;
    }

    if (typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length <= 8) trimmed[name] = value;
      else trimmed[name] = `<${keys.length} fields>`;
    }
  }

  return Object.keys(trimmed).length ? trimmed : null;
}
