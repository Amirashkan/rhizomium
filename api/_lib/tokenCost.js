/**
 * tokenCost.js - what each AI feature costs in tokens, at its smallest and its
 * largest.
 *
 * Every feature in features.js states a budget, and every budget was a guess
 * about a number nobody had put next to it: how much prompt a call actually
 * carries, and how much answer it is allowed to write. This file works both out
 * from the same code the backend runs — the real system prompt, the real
 * catalogue, the real message builder, the real answerBudget() — so the numbers
 * move when the prompts move.
 *
 * Two things it is not:
 *
 *   It is not a tokenizer. Counts are the four-characters-to-a-token rule of
 *   thumb the editor's panel already uses (src/ai/patchContext.js), which is
 *   within about ten percent for English prose and node-graph text and is
 *   nowhere near precise enough to bill anyone from. The exact numbers come
 *   back with every answer in `usage`, and run.js logs them; this is for
 *   knowing an order of magnitude before a call is made.
 *
 *   It is not a measurement of what a call will spend. The maximum output is a
 *   ceiling — `max_output_tokens`, the point at which the call is cut off — not
 *   a prediction. A review of a clean patch answers in a few hundred tokens and
 *   is billed for a few hundred. What the ceiling tells you is the worst an
 *   artist can be charged for, and the longest they can be made to wait.
 */

import { AI_FEATURES, answerBudget, buildUserMessage } from './features.js';

/**
 * The estimate, and the one place it is made.
 *
 * Bytes rather than characters, so a patch full of non-ASCII node names is not
 * quietly undercounted the way `String.length` would.
 */
export const BYTES_PER_TOKEN = 4;

export function estimateTokens(text) {
  if (!text) return 0;
  const bytes = new TextEncoder().encode(String(text)).length;
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

/**
 * Numbers that live in run.js and are mirrored here so this file can be read
 * without pulling in the OpenAI SDK.
 *
 * tests/aiFeatureTokenCost.test.js imports run.js and fails if any of them
 * drift, which is the only thing keeping the mirror honest.
 */
export const MIRRORED_FROM_RUN = {
  /** Room to think for a feature that did not say how much it needs. */
  defaultReasoningTokens: 6000,
  /** The pessimistic decode rate a call's deadline is derived from. */
  assumedTokensPerSecond: 50,
  /** What a feature runs on unless it names something cheaper. */
  defaultModel: 'gpt-5.6-terra',
  /** The latest a call may still be running before it is stopped (MODEL_DEADLINE_MS). */
  deadlineSeconds: 285,
  /** The largest request body the endpoint accepts, in bytes. */
  maxInputBytes: 512 * 1024,
};

/**
 * The most nodes one call may carry (src/ai/patchContext.js), which is what
 * makes "the largest patch" a number rather than a shrug.
 */
export const MAX_NODES = 400;

/**
 * The smallest patch the editor will send: one node, no wires.
 *
 * Anything smaller is the empty canvas, which the panel refuses before it asks
 * for a grant, so this is the real floor rather than a theoretical one.
 */
export function smallestPatch() {
  return {
    nodes: [{ id: 'a', kind: 'OutputFinal', x: 0, y: 0, params: {} }],
    connections: [],
  };
}

/**
 * A patch at the node limit, written the way a loaded canvas actually is:
 * every node named by the artist, a parameter moved off its default wherever
 * the kind has one, and wired into a chain that reaches the output.
 *
 * The names and the moved parameters are the point. A patch of bare ids and
 * default values would measure the format rather than the traffic — describePatch()
 * drops defaults precisely because artists leave most of them alone, and what
 * is left after that is names and the handful of values they turned.
 */
export function largestPatch(nodeCount = MAX_NODES) {
  const nodes = [];
  const connections = [];

  // Two inputs each, so the chain also carries the wire count of a real graph
  // rather than the one-in-one-out minimum.
  const kinds = ['SDFSmoothUnion', 'SDFSmoothIntersection', 'SDFSmoothSubtraction'];

  for (let i = 0; i < nodeCount - 1; i += 1) {
    nodes.push({
      id: `n${i}`,
      kind: kinds[i % kinds.length],
      x: (i % 20) * 220,
      y: Math.floor(i / 20) * 140,
      name: `layer ${i} — drifting blend`,
      params: { smoothness: 0.1 + ((i % 9) + 1) / 100 },
    });
    if (i > 0) {
      connections.push({ from: { nodeId: `n${i - 1}`, pin: 0 }, to: { nodeId: `n${i}`, pin: 0 } });
    }
  }

  nodes.push({ id: 'out', kind: 'OutputFinal', x: 4400, y: 0, params: {} });
  connections.push({ from: { nodeId: `n${nodeCount - 2}`, pin: 0 }, to: { nodeId: 'out', pin: 0 } });

  return { nodes, connections };
}

/** A prompt of a few words, which is what most typed briefs actually are. */
const SHORT_PROMPT = 'a slow plasma in deep blues';

/**
 * A long typed brief. Nothing caps the textarea in the panel, so this is a
 * realistic ceiling rather than an enforced one — roughly two thousand
 * characters, about as much as anyone types into a box two rows tall.
 */
const LONG_PROMPT = [
  'A piece for a forty minute set in a small room, projected behind the players.',
  'It should start almost still — a dark field with something moving slowly under it —',
  'and take about ten minutes to become something an audience notices as rhythmic.',
  'The low end of the audio should drive the scale of whatever is moving, not its colour.',
  'Colour should stay in deep blues and greens for the first half and only warm up',
  'once the set does. Avoid anything that reads as a screensaver: no perfect symmetry,',
  'no clean loops, nothing that repeats on an obvious period.',
].join(' ').repeat(4);

/**
 * The smallest and largest call each feature can be given.
 *
 * Both ends are what the editor permits, not what the API would accept: the
 * patch features are bounded by MAX_NODES above, and the prompted ones by what
 * a person will type.
 */
export function sampleInputs(feature) {
  switch (feature) {
    case 'ai.patch_review':
    case 'ai.patch_refactor':
    case 'ai.canvas_assist':
      return { min: { patch: smallestPatch() }, max: { patch: largestPatch() } };

    case 'ai.patch_generator':
      return { min: { prompt: SHORT_PROMPT }, max: { prompt: LONG_PROMPT } };

    case 'ai.node_generator':
      return { min: { description: 'mix two colours by a curve' }, max: { description: LONG_PROMPT } };

    case 'ai.creative_director':
      return {
        min: { patch: smallestPatch(), brief: '' },
        max: { patch: largestPatch(), brief: LONG_PROMPT },
      };

    default:
      return { min: {}, max: {} };
  }
}

/**
 * The floor of what a feature can answer: the smallest document its schema
 * admits.
 *
 * Every schema here is `required`-complete, so the minimum is every required
 * property present and empty — an empty findings list, an empty summary. It is
 * not an answer anyone wants, but it is the least the model can hand back
 * while still satisfying Structured Outputs, and it is the honest lower bound
 * on the answer half of the bill.
 */
export function minimalAnswer(schema) {
  if (!schema || typeof schema !== 'object') return null;

  switch (schema.type) {
    case 'object': {
      const out = {};
      for (const name of schema.required || []) {
        out[name] = minimalAnswer(schema.properties?.[name]);
      }
      return out;
    }
    case 'array':
      return [];
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'string':
      return Array.isArray(schema.enum) && schema.enum.length ? schema.enum[0] : '';
    default:
      return null;
  }
}

export function minimalAnswerTokens(schema) {
  return estimateTokens(JSON.stringify(minimalAnswer(schema)));
}

/**
 * One feature, measured at both ends.
 *
 * @param {string} feature - a key of AI_FEATURES.
 * @returns {Object} the breakdown, in tokens, with the model and effort that
 *   decide what those tokens cost and how long they take.
 */
export function featureTokenRange(feature) {
  const config = AI_FEATURES[feature];
  if (!config) throw new Error(`No such feature: ${feature}`);

  const { min: minInput, max: maxInput } = sampleInputs(feature);

  // The system prompt is identical for every call to a feature and sits at the
  // front of the request, where OpenAI's prefix caching finds it. It is counted
  // in full here — a cold call does pay for it — and reported separately so the
  // share that is cacheable is visible.
  const system = estimateTokens(config.system());
  const userMin = estimateTokens(buildUserMessage(feature, minInput));
  const userMax = estimateTokens(buildUserMessage(feature, maxInput));

  const reasoningRoom = config.reasoningTokens ?? MIRRORED_FROM_RUN.defaultReasoningTokens;

  // What run.js will actually put in max_output_tokens for each end. Only the
  // refactor moves with the input; every other feature's ceiling is flat.
  const answerMin = answerBudget(config, minInput);
  const answerMax = answerBudget(config, maxInput);

  const outputMin = minimalAnswerTokens(config.format.schema);
  const outputMax = answerMax + reasoningRoom;

  return {
    feature,
    label: config.label,
    model: config.model || MIRRORED_FROM_RUN.defaultModel,
    effort: config.effort,
    singleUse: Boolean(config.singleUse),
    scalesWithPatch: Boolean(config.scaleWithPatch),

    /** Prompt tokens, system included. The system half is mostly cache after the first call. */
    input: { min: system + userMin, max: system + userMax, system, userMin, userMax },

    /**
     * Answer tokens. `min` is the smallest document the schema admits, with
     * reasoning off; `max` is the ceiling the call is cut off at, reasoning
     * room included, because reasoning is billed as output.
     */
    output: {
      min: outputMin,
      max: outputMax,
      /** What run.js allows the answer on the largest call, and on the smallest. */
      answerCeiling: answerMax,
      answerCeilingMin: answerMin,
      reasoningRoom,
    },

    /** Both halves together: the least and the most one call can be billed for. */
    billed: { min: system + userMin + outputMin, max: system + userMax + outputMax },

    /**
     * How long the ceiling implies at the pessimistic decode rate run.js sizes
     * its deadline from. Worth reading next to FUNCTION_BUDGET_SECONDS: a
     * feature whose ceiling implies more seconds than the function has is one
     * whose worst case gets stopped rather than answered.
     */
    ceilingSeconds: Math.round(outputMax / MIRRORED_FROM_RUN.assumedTokensPerSecond),
  };
}

export function allFeatureTokenRanges() {
  return Object.keys(AI_FEATURES).map(featureTokenRange);
}

/**
 * The absolute ceiling on prompt tokens, whatever the patch looks like: the
 * endpoint refuses a body over MAX_INPUT_BYTES, and every byte of it could in
 * principle be prompt.
 *
 * Nothing the editor sends comes close — a 400-node patch is a few percent of
 * it — which is the point of reporting it separately from the ranges above.
 */
export function hardInputCeilingTokens() {
  return Math.ceil(MIRRORED_FROM_RUN.maxInputBytes / BYTES_PER_TOKEN);
}

/** Column widths chosen once, so the table lines up in a terminal. */
const COLUMNS = [
  ['Feature', 22, (r) => r.label],
  ['Model', 14, (r) => r.model.replace(/^gpt-/, '')],
  ['Effort', 7, (r) => r.effort],
  ['In min', 8, (r) => fmt(r.input.min)],
  ['In max', 8, (r) => fmt(r.input.max)],
  ['Out min', 8, (r) => fmt(r.output.min)],
  ['Out max', 8, (r) => fmt(r.output.max)],
  ['Total min', 10, (r) => fmt(r.billed.min)],
  ['Total max', 10, (r) => fmt(r.billed.max)],
  ['Ceil. s', 8, (r) => `${r.ceilingSeconds}s`],
];

function fmt(n) {
  return n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/**
 * The whole table as text, for the test and for scripts/ai-token-report.mjs.
 *
 * @param {Array} ranges - from allFeatureTokenRanges().
 * @param {number} [budgetSeconds] - the function's time limit, when known, so
 *   a ceiling that cannot finish inside it is marked rather than left to be
 *   worked out by eye.
 */
export function formatTokenReport(ranges, budgetSeconds = null) {
  const lines = [];

  lines.push(
    `Estimated at ${BYTES_PER_TOKEN} bytes to a token. ` +
      `Input maxima are a ${MAX_NODES}-node patch or a long typed brief; ` +
      'output maxima are the ceiling a call is cut off at, reasoning room included.'
  );
  lines.push('');
  lines.push(COLUMNS.map(([head, width]) => head.padEnd(width)).join(''));
  lines.push(COLUMNS.map(([, width]) => '-'.repeat(width - 1).padEnd(width)).join(''));

  for (const range of ranges) {
    lines.push(COLUMNS.map(([, width, read]) => String(read(range)).padEnd(width)).join(''));
  }

  const system = ranges[0]?.input.system ?? 0;
  lines.push('');
  lines.push(
    `Shared system prompt: ~${system} tokens per feature, near-identical across them ` +
      '(the node registry is most of it) and served from the prefix cache after the first call.'
  );
  lines.push(`Hard prompt ceiling from the ${MIRRORED_FROM_RUN.maxInputBytes / 1024}KB body cap: ~${fmt(hardInputCeilingTokens())} tokens.`);

  if (budgetSeconds) {
    const overrunning = ranges.filter((r) => r.ceilingSeconds > budgetSeconds);
    if (overrunning.length) {
      lines.push('');
      lines.push(
        `At ${MIRRORED_FROM_RUN.assumedTokensPerSecond} tokens/second these ceilings imply longer than ` +
          `the ${budgetSeconds}s a call is given, so their worst case is stopped rather than answered: ` +
          overrunning.map((r) => `${r.label} (${r.ceilingSeconds}s)`).join(', ') + '.'
      );
    }
  }

  return lines.join('\n');
}
