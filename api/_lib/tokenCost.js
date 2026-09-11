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
import { estimateRefactorAnswerTokens, refactorFit, REFACTOR_BUDGET } from '../../src/ai/patchContext.js';

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
export function syntheticPatch(nodeCount = MAX_NODES) {
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

/** The patch at the node limit: the largest one call will ever carry. */
export function largestPatch() {
  return syntheticPatch(MAX_NODES);
}

/**
 * A patch the size of a working canvas rather than either extreme.
 *
 * Forty nodes is a loaded-but-ordinary piece, and it is what the scenarios
 * below use where the point is what a normal call costs rather than what the
 * limits are.
 */
export const TYPICAL_NODES = 40;

export function typicalPatch() {
  return syntheticPatch(TYPICAL_NODES);
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
        // The timing block only travels for this feature, and only when the
        // editor has something to say — so the maximum carries it and the
        // minimum does not, which is also the honest span of the two calls.
        max: { patch: largestPatch(), brief: LONG_PROMPT, timing: busiestTiming() },
      };

    case 'ai.performer_scenario':
      return {
        min: { brief: 'a short ambient set' },
        // The rig is what makes this call large: every scene, preset and
        // parameter the artist has is named so the model cannot invent one.
        max: { brief: LONG_PROMPT, ...busiestRig() },
      };

    case 'ai.performer_live':
      return {
        min: { state: smallestPerformanceState(), steer: '', freedom: 0 },
        max: { state: busiestPerformanceState(), steer: LONG_PROMPT, freedom: 1 },
      };

    default:
      return { min: {}, max: {} };
  }
}

/** The most rig the panel will ever send: its lists are capped at these sizes. */
function busiestRig() {
  return {
    bpm: 128,
    scenes: Array.from({ length: 40 }, (_, i) => ({
      id: `scene_${i}`, name: `Scene ${i}`, notes: 'what this one is for, in a line',
    })),
    presets: Array.from({ length: 40 }, (_, i) => ({ id: `preset_${i}`, name: `Preset ${i}` })),
    parameters: Array.from({ length: 60 }, (_, i) => `node_${i}.amount`),
    oscAddresses: Array.from({ length: 40 }, (_, i) => `/live/channel${i}`),
    audioChannels: ['level', 'low', 'mid', 'high', 'kick', 'snare', 'hat'],
  };
}

/**
 * The live call's state, at both ends.
 *
 * This is the one feature whose prompt is JSON rather than prose, and its size
 * is set by the scenario rather than by the patch: the sections list travels in
 * full on every ask so the model can name one.
 */
function smallestPerformanceState() {
  return {
    scenario: { name: 'set', notes: '', sections: [{ id: 'a', name: 'A' }], cues: [], allowed: {} },
    now: { bar: 0, bpm: 120, sectionId: 'a' },
    signals: {},
    driving: [],
    recent: [],
  };
}

function busiestPerformanceState() {
  return {
    scenario: {
      name: 'A long set with a long name',
      notes: LONG_PROMPT,
      sections: Array.from({ length: 128 }, (_, i) => ({
        id: `section_${i}`,
        name: `Section ${i}`,
        intensity: 0.5,
        mood: 'dark, wide, barely moving',
        notes: 'what this section is for',
        look: `scene_${i}`,
      })),
      cues: Array.from({ length: 64 }, (_, i) => `cue_${i}`),
      allowed: {
        sceneChanges: true, presets: true, parameterMoves: true,
        graphEdits: true, sectionChanges: true,
      },
    },
    now: {
      state: 'running', sectionId: 'section_9', sectionName: 'Section 9',
      sectionBars: 12.5, bar: 96, phrase: 12, bpm: 128, beatsPerBar: 4,
      energy: 0.8, intensity: 0.9,
    },
    signals: Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [
        `signal_${i}`, { value: 0.5, rise: 0.1, peak: 0.9, average: 0.4 },
      ])
    ),
    driving: Array.from({ length: 32 }, (_, i) => ({
      signal: `signal_${i}`, node: `node_${i}`, param: 'amount', min: 0, max: 1,
    })),
    recent: Array.from({ length: 12 }, (_, i) => ({
      at: 90 + i, level: 'action', message: 'Warp.amount → 0.62 over 8 bars',
    })),
  };
}

/**
 * The most timing context the editor will ever send: a tempo, a length, and
 * the forty tracks describeTiming() lists before it starts eliding.
 */
function busiestTiming() {
  return {
    durationSeconds: 240,
    loop: true,
    bpm: 128,
    beatsPerBar: 4,
    tracks: Array.from({ length: 40 }, (_, index) => ({
      nodeId: `node_${index}`,
      param: 'amount',
      keyframes: 8,
    })),
  };
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

/* -------------------------------------------------------------------------
 * Cold, warm, and the worst case.
 *
 * The ranges above are the envelope. These are three calls inside it, worked
 * out in full, because the envelope does not answer the questions anyone
 * actually has: what does the first call after a deploy cost, what does an
 * ordinary one cost once the cache is warm, and does the largest refactor the
 * editor permits even fit in the budget it is given.
 * ---------------------------------------------------------------------- */

/**
 * Prefix caching, as far as it can be modelled from outside.
 *
 * OpenAI caches long identical prefixes automatically and reports the hit as
 * `usage.input_tokens_details.cached_tokens`. Two properties of it matter here:
 * a prompt under CACHE_MINIMUM_TOKENS is never cached at all, and the hit is
 * granted in blocks of CACHE_BLOCK_TOKENS rather than to the token, so the tail
 * of the prefix is paid for every time.
 *
 * Cached tokens are still counted in `input_tokens` — they are billed at a
 * discount, not billed at zero — so what changes between a cold call and a warm
 * one is the *price* of the prompt, not its size. That is why the scenarios
 * below report the split rather than a total.
 */
export const CACHE_BLOCK_TOKENS = 128;
export const CACHE_MINIMUM_TOKENS = 1024;

/**
 * How much of a prompt's stable prefix a warm call can expect to have cached.
 *
 * @param {number} prefixTokens - the deterministic head of the prompt, which
 *   for every feature here is its system instructions.
 * @returns {number} tokens served from cache, rounded down to a whole block.
 */
export function cachedPrefixTokens(prefixTokens) {
  if (prefixTokens < CACHE_MINIMUM_TOKENS) return 0;
  return Math.floor(prefixTokens / CACHE_BLOCK_TOKENS) * CACHE_BLOCK_TOKENS;
}

/**
 * What the refactor has to write back for a given patch.
 *
 * The one feature whose answer is as large as its input: it returns the whole
 * patch, as JSON, in the schema features.js declares — not the compact line
 * format the patch arrived in. So the question its budget has to answer is not
 * "is 32,000 tokens generous" but "does this particular patch fit in it", and
 * that is measurable rather than a matter of opinion.
 *
 * This is the editor's own estimator, not a second one: the same function the
 * panel calls to decide whether to run a refactor at all
 * (src/ai/patchContext.js). A report that measured this differently from the
 * check that acts on it would be worse than no report.
 */
export const refactorAnswerTokens = estimateRefactorAnswerTokens;

/**
 * One call, costed end to end.
 *
 * @param {Object} spec
 * @param {string} spec.name - short label for the scenario.
 * @param {string} spec.feature - a key of AI_FEATURES.
 * @param {Object} spec.input - the request payload.
 * @param {boolean} spec.warm - whether the prefix cache is hot for this feature.
 * @param {string} spec.note - what this scenario is, in a sentence.
 * @param {number} [spec.expectedAnswer] - tokens the answer is actually
 *   expected to need, where that is knowable (the refactor). Omitted elsewhere,
 *   because what a review will write is not predictable — only its ceiling is.
 */
export function measureScenario({ name, feature, input, warm, note, expectedAnswer = null }) {
  const config = AI_FEATURES[feature];
  if (!config) throw new Error(`No such feature: ${feature}`);

  const system = estimateTokens(config.system());
  const user = estimateTokens(buildUserMessage(feature, input));
  const promptTotal = system + user;
  const cached = warm ? cachedPrefixTokens(system) : 0;

  const reasoningRoom = config.reasoningTokens ?? MIRRORED_FROM_RUN.defaultReasoningTokens;
  const answerCeiling = answerBudget(config, input);
  const outputCeiling = answerCeiling + reasoningRoom;

  return {
    name,
    note,
    feature,
    label: config.label,
    model: config.model || MIRRORED_FROM_RUN.defaultModel,
    warm: Boolean(warm),
    prompt: {
      total: promptTotal,
      system,
      user,
      /** Served from cache, and so billed at the cached rate. */
      cached,
      /** Paid for at the full input rate on this call. */
      fresh: promptTotal - cached,
    },
    output: {
      /** The smallest document the schema admits — the floor, not a forecast. */
      floor: minimalAnswerTokens(config.format.schema),
      /** What the answer actually needs, where that can be worked out. */
      expected: expectedAnswer,
      answerCeiling,
      reasoningRoom,
      ceiling: outputCeiling,
      /** Room left over once the answer is written, when it is known. */
      headroom: expectedAnswer === null ? null : answerCeiling - expectedAnswer,
    },
    /** Prompt plus the output ceiling: the most this call can be billed for. */
    billedCeiling: promptTotal + outputCeiling,
    ceilingSeconds: Math.round(outputCeiling / MIRRORED_FROM_RUN.assumedTokensPerSecond),

    /**
     * Seconds the answer this call actually has to write implies, where that
     * is knowable — thinking room included, since reasoning is decoded too.
     *
     * This is the number that decides whether a call comes back. The ceiling
     * seconds above are the worst case nobody reaches; this is the work in
     * front of it.
     */
    expectedSeconds:
      expectedAnswer === null
        ? null
        : Math.round((expectedAnswer + reasoningRoom) / MIRRORED_FROM_RUN.assumedTokensPerSecond),

    /**
     * What the editor's pre-flight check makes of this call, for the one
     * feature that has one. `too_large` here means the call never happens:
     * refactorFit() stops it in front of the grant, so no allowance is spent.
     */
    fit: feature === 'ai.patch_refactor' ? refactorFit(input.patch) : null,
  };
}

/**
 * The largest patch a refactor can be given and still finish.
 *
 * The refactor writes its whole input back out, so the answer grows with the
 * patch while the deadline does not — `deadlineFor()` in run.js clamps at
 * MODEL_DEADLINE_MS however large the budget gets. Somewhere below the
 * 400-node limit those two lines cross, and past that point the call is being
 * accepted knowing it will be stopped.
 *
 * Measured rather than solved: build the patch, measure what it would have to
 * write, ask whether that fits. The default rate is the pessimistic one run.js
 * sizes its own deadline from, so the answer is the conservative end — at the
 * speed these models really decode, the crossing is higher.
 *
 * @returns {{nodes: number, tokens: number, seconds: number}} the largest patch
 *   that fits, and what it costs.
 */
export function refactorNodeCeiling({
  tokensPerSecond = MIRRORED_FROM_RUN.assumedTokensPerSecond,
  deadlineSeconds = MIRRORED_FROM_RUN.deadlineSeconds,
} = {}) {
  const config = AI_FEATURES['ai.patch_refactor'];
  const affordable = tokensPerSecond * deadlineSeconds;

  let fits = { nodes: 0, tokens: 0, seconds: 0 };

  for (let nodes = 2; nodes <= MAX_NODES; nodes += 1) {
    const patch = syntheticPatch(nodes);
    const needed = refactorAnswerTokens(patch) + config.reasoningTokens;
    if (needed > affordable) break;
    fits = { nodes, tokens: needed, seconds: Math.round(needed / tokensPerSecond) };
  }

  return fits;
}

/**
 * The three calls worth knowing by heart.
 *
 * They bracket everything the editor does: the most expensive way to make an
 * ordinary request, the cheapest, and the largest single thing anyone can ask
 * for.
 */
export function namedScenarios() {
  const worstRefactorPatch = largestPatch();

  return [
    measureScenario({
      name: 'Cold',
      feature: 'ai.patch_review',
      input: { patch: typicalPatch() },
      warm: false,
      note:
        `A review of a ${TYPICAL_NODES}-node patch as the first call of its kind — after a deploy, ` +
        'or when nobody has run this feature recently enough to leave the prefix warm. ' +
        'Every token of the registry is paid for at the full input rate.',
    }),
    measureScenario({
      name: 'Warm minimal',
      feature: 'ai.canvas_assist',
      input: { patch: smallestPatch() },
      warm: true,
      note:
        'The cheapest real call the editor can make: canvas assist, one node on the canvas, ' +
        'prefix hot from the calls before it. Nothing here is smaller.',
    }),
    measureScenario({
      name: 'Worst-case refactor',
      feature: 'ai.patch_refactor',
      input: { patch: worstRefactorPatch },
      warm: true,
      expectedAnswer: refactorAnswerTokens(worstRefactorPatch),
      note:
        `A refactor of a patch at the ${MAX_NODES}-node limit: the largest single thing anyone ` +
        'can ask for, and the only feature that has to write its whole input back out.',
    }),
  ];
}

/** The scenarios as text, under the range table. */
export function formatScenarioReport(scenarios, deadlineSeconds = null) {
  const lines = ['Three calls, costed end to end', ''];

  for (const scenario of scenarios) {
    lines.push(`${scenario.name} — ${scenario.label} on ${scenario.model.replace(/^gpt-/, '')}`);
    lines.push(`  ${scenario.note}`);
    lines.push(
      `  Prompt   ${fmt(scenario.prompt.total)} tokens ` +
        `(${fmt(scenario.prompt.fresh)} fresh, ${fmt(scenario.prompt.cached)} cached)`
    );

    const answer = scenario.output.expected !== null
      ? `must write ~${fmt(scenario.output.expected)}, ceiling ${fmt(scenario.output.answerCeiling)} ` +
        `(${fmt(scenario.output.headroom)} spare)`
      : `floor ${fmt(scenario.output.floor)}, ceiling ${fmt(scenario.output.answerCeiling)}`;
    lines.push(`  Answer   ${answer}`);
    lines.push(
      `  Thinking up to ${fmt(scenario.output.reasoningRoom)}, so at most ` +
        `${fmt(scenario.billedCeiling)} tokens billed and ${scenario.ceilingSeconds}s spent` +
        (deadlineSeconds && scenario.ceilingSeconds > deadlineSeconds
          ? ` — past the ${deadlineSeconds}s deadline`
          : '')
    );

    // Only the refactor knows what it has to write. Where that is known, it is
    // the number that decides whether the call comes back at all.
    if (scenario.expectedSeconds !== null) {
      lines.push(
        `  Decoding the ~${fmt(scenario.output.expected)} it must write, plus thinking, is ` +
          `~${scenario.expectedSeconds}s of work` +
          (deadlineSeconds && scenario.expectedSeconds > deadlineSeconds
            ? ` against a ${deadlineSeconds}s deadline: this call cannot finish.`
            : '.')
      );
    }

    if (scenario.fit) {
      lines.push(
        `  Pre-flight ${scenario.fit.verdict}` +
          (scenario.fit.verdict === 'too_large'
            ? ': refused in front of the grant, so none of the above is ever spent.'
            : scenario.fit.verdict === 'tight'
              ? ': allowed, with a warning that it may run long.'
              : ': allowed.')
      );
    }

    lines.push('');
  }

  // Where the two lines cross, which is what the editor's pre-flight check
  // acts on: comfortable below the first, refused above the second.
  const comfortable = refactorNodeCeiling();
  const possible = refactorNodeCeiling({
    tokensPerSecond: REFACTOR_BUDGET.realisticTokensPerSecond,
  });

  lines.push(
    `Refactor, by patch size: up to ~${comfortable.nodes} nodes it fits even at the pessimistic ` +
      `${MIRRORED_FROM_RUN.assumedTokensPerSecond} tokens/second (~${fmt(comfortable.tokens)} to write). ` +
      `From there to ~${possible.nodes} it is accepted with a warning — it needs the rate these models ` +
      `really decode at. Past ~${possible.nodes}, refactorFit() refuses it before a grant is asked for, ` +
      'so nothing is charged and nobody waits for a 504.'
  );

  return lines.join('\n').trimEnd();
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
