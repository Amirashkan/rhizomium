import { describe, it, expect, vi } from 'vitest';

/**
 * What every AI feature costs, at its smallest call and its largest.
 *
 * The budgets in api/_lib/features.js are the only thing standing between an
 * artist's metered action and an unbounded bill, and until now none of them had
 * a number next to it: nobody could say what a review of a loaded patch carries,
 * or what the worst case of a refactor is allowed to spend. api/_lib/tokenCost.js
 * works both ends out from the real prompts; these tests hold the answers to
 * bounds worth failing over, and print the table so a change to a prompt shows
 * up as a number rather than as a surprise on the bill.
 *
 * The counts are estimates — four bytes to a token, the same rule the editor's
 * panel shows — so every bound here is generous enough that the estimate's
 * error cannot be what trips it. Exact numbers come back in `usage` on every
 * answer and run.js logs them.
 */

// run.js is imported only for its constants; nothing here calls the model.
vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.responses = { stream: vi.fn() };
    }
  },
}));

const {
  allFeatureTokenRanges,
  featureTokenRange,
  formatTokenReport,
  formatScenarioReport,
  namedScenarios,
  measureScenario,
  cachedPrefixTokens,
  refactorAnswerTokens,
  refactorNodeCeiling,
  estimateTokens,
  minimalAnswer,
  largestPatch,
  smallestPatch,
  typicalPatch,
  syntheticPatch,
  hardInputCeilingTokens,
  CACHE_BLOCK_TOKENS,
  MIRRORED_FROM_RUN,
  MAX_NODES,
} = await import('../api/_lib/tokenCost.js');

const { AI_FEATURES } = await import('../api/_lib/features.js');
const { refactorFit, REFACTOR_BUDGET } = await import('../src/ai/patchContext.js');
const {
  MAX_INPUT_BYTES,
  DEFAULT_MODEL,
  DEFAULT_REASONING_TOKENS,
  ASSUMED_TOKENS_PER_SECOND,
  MODEL_DEADLINE_MS,
} = await import('../api/ai/run.js');

const DEADLINE_SECONDS = MODEL_DEADLINE_MS / 1000;
const ranges = allFeatureTokenRanges();
const byFeature = Object.fromEntries(ranges.map((range) => [range.feature, range]));

describe('the token cost of every AI feature', () => {
  it('reports the range for each feature', () => {
    // Printed rather than asserted: this is the number the budgets in
    // features.js were guesses at, and the point of the file is to be read.
    console.log(`\n${formatTokenReport(ranges, DEADLINE_SECONDS)}\n`);
    expect(ranges).toHaveLength(Object.keys(AI_FEATURES).length);
  });

  it.each(ranges.map((range) => [range.label, range]))(
    '%s: the smallest call is smaller than the largest',
    (_label, range) => {
      expect(range.input.min).toBeLessThan(range.input.max);
      expect(range.output.min).toBeLessThan(range.output.max);
      expect(range.billed.min).toBeLessThan(range.billed.max);
    }
  );

  it.each(ranges.map((range) => [range.label, range]))(
    '%s: has room for the smallest answer its schema admits',
    (_label, range) => {
      // A ceiling under this would mean the feature cannot return a valid
      // document at all — the call comes back `incomplete` and the artist's
      // action is spent on nothing.
      expect(range.output.min).toBeLessThan(range.output.answerCeilingMin);
    }
  );

  it.each(ranges.map((range) => [range.label, range]))(
    '%s: says how much room to think it needs',
    (_label, range) => {
      // Falling back to run.js's floor is how a feature ends up with a budget
      // nobody chose. Every feature in features.js names its own.
      const config = AI_FEATURES[range.feature];
      expect(config.reasoningTokens).toBeTypeOf('number');
      expect(range.output.reasoningRoom).toBe(config.reasoningTokens);
    }
  );

  it('carries the same shared prompt for every feature', () => {
    // The node registry, the capability notes and the format legend are the
    // bulk of it, identical across features, which is what makes prefix
    // caching worth having. If these ever diverge by much, one feature has
    // grown its own preamble.
    //
    // The spread is ~700 tokens today and the two performer features own it.
    // The live performer's share is the larger and the newer: it is told what
    // the "listening" block means and, more to the point, that a "free" pulse
    // means there are no bars to plan in. That paragraph is the difference
    // between a model that co-performs and one that confidently times a move
    // over sixteen bars of a drone — and it is useless to the six features
    // that never see a performance, which is exactly why it lives here rather
    // than in sharedContext().
    //
    // The bound was 400 before that landed. Raising it is a decision, not a
    // formality: every token here is paid on each of a live director's calls,
    // and a set asks a lot of them. Anything that grows this further wants to
    // justify itself the same way or move into sharedContext().
    const system = ranges.map((range) => range.input.system);
    const spread = Math.max(...system) - Math.min(...system);
    expect(spread).toBeLessThan(750);
  });

  it('keeps the shared prompt under 9,000 tokens', () => {
    // Paid in full on a cold call, and on every call for a feature nobody has
    // run recently. Two things make it up today: the registry at ~5,400 tokens
    // and EDITOR_CAPABILITIES at ~1,200, which is what the features know about
    // expressions, audio, 3D and compute nodes — none of which is visible in
    // the registry's pin lists. This is the line at which adding to either
    // stops being free.
    for (const range of ranges) {
      expect(range.input.system).toBeLessThan(9000);
    }
  });

  it('never lets one call be billed for more than 64,000 tokens', () => {
    // The worst case anyone can be charged for in a single action: the largest
    // prompt the editor will send plus the ceiling on the answer. The refactor
    // is the largest at ~56k; this is the ceiling over all of them.
    for (const range of ranges) {
      expect(range.billed.max).toBeLessThan(64000);
    }
  });

  it('keeps the largest patch it will send far under the body cap', () => {
    const bytes = Buffer.byteLength(JSON.stringify({ patch: largestPatch() }));
    expect(bytes).toBeLessThan(MAX_INPUT_BYTES);
    // A 400-node patch is a small fraction of what the endpoint would accept,
    // which is why MAX_NODES, not the byte cap, is what bounds these ranges.
    expect(bytes).toBeLessThan(MAX_INPUT_BYTES / 2);
    expect(hardInputCeilingTokens()).toBeGreaterThan(Math.max(...ranges.map((r) => r.input.max)) * 4);
  });
});

describe('what each feature is allowed to write', () => {
  it('sizes the refactor from the patch it was given', () => {
    const refactor = byFeature['ai.patch_refactor'];
    // The one feature that scales: a one-node patch gets the floor, a
    // four-hundred-node one gets the declared ceiling.
    expect(refactor.scalesWithPatch).toBe(true);
    expect(refactor.output.answerCeilingMin).toBe(3000);
    expect(refactor.output.answerCeiling).toBe(AI_FEATURES['ai.patch_refactor'].maxTokens);
  });

  it('gives every other feature the same ceiling whatever it is sent', () => {
    for (const range of ranges) {
      if (range.scalesWithPatch) continue;
      expect(range.output.answerCeilingMin).toBe(range.output.answerCeiling);
    }
  });

  it('runs canvas assist on the cheap tier and everything else on the default', () => {
    // Cost per token, not count: the feature that fires while an artist works
    // is the one place the cost-efficient model is the right trade.
    expect(byFeature['ai.canvas_assist'].model).toBe('gpt-5.6-luna');
    for (const range of ranges) {
      if (range.feature === 'ai.canvas_assist') continue;
      expect(range.model).toBe(DEFAULT_MODEL);
    }
  });

  it('names the three features whose worst case outruns the deadline', () => {
    /**
     * A ceiling in tokens is also a ceiling in seconds: run.js assumes 50
     * tokens a second when it derives a call's deadline, and stops the call
     * there. These three are allowed to write more than that deadline can
     * cover, so their largest possible answer would be cut off — the refactor
     * of a 400-node patch is 40,000 tokens, or 800 pessimistic seconds against
     * a 285-second deadline.
     *
     * It is not today's bug: the rate is deliberately about half of what these
     * models decode at, and no real refactor writes its whole ceiling. It is
     * pinned so that a fourth one arriving, or one of these growing, is
     * something someone chose rather than something that shows up as a 504.
     */
    const outrunning = ranges
      .filter((range) => range.ceilingSeconds > DEADLINE_SECONDS)
      .map((range) => range.feature)
      .sort();

    expect(outrunning).toEqual([
      'ai.creative_director',
      'ai.patch_generator',
      'ai.patch_refactor',
    ]);
  });

  it('keeps every other feature answerable inside the deadline', () => {
    for (const range of ranges) {
      if (range.ceilingSeconds > DEADLINE_SECONDS) continue;
      expect(range.ceilingSeconds * ASSUMED_TOKENS_PER_SECOND).toBe(range.output.max);
    }
  });
});

describe('the three calls worth knowing by heart', () => {
  const scenarios = namedScenarios();
  const [cold, warm, worst] = scenarios;

  it('reports all three', () => {
    console.log(`\n${formatScenarioReport(scenarios, DEADLINE_SECONDS)}\n`);
    expect(scenarios.map((s) => s.name)).toEqual(['Cold', 'Warm minimal', 'Worst-case refactor']);
  });

  it('cold: pays full price for every token of the prompt', () => {
    // Nothing cached, so the whole registry is billed at the input rate. This
    // is the first call after a deploy, and the most an ordinary request costs.
    expect(cold.warm).toBe(false);
    expect(cold.prompt.cached).toBe(0);
    expect(cold.prompt.fresh).toBe(cold.prompt.total);
  });

  it('warm minimal: pays for a few hundred tokens of prompt, not six thousand', () => {
    // The point of keeping the registry at the front of the prompt: on a warm
    // call almost the whole of it comes back from cache, and what is fresh is
    // the patch and the ask.
    expect(warm.prompt.cached).toBeGreaterThan(5000);
    expect(warm.prompt.fresh).toBeLessThan(500);
    // And it is the cheapest of the three by some distance.
    expect(warm.billedCeiling).toBeLessThan(cold.billedCeiling);
    expect(warm.billedCeiling).toBeLessThan(worst.billedCeiling / 4);
  });

  it('warm and cold differ by exactly the cacheable prefix', () => {
    const input = { patch: typicalPatch() };
    const spec = { name: 'x', feature: 'ai.patch_review', input, note: '' };
    const asCold = measureScenario({ ...spec, warm: false });
    const asWarm = measureScenario({ ...spec, warm: true });

    expect(asCold.prompt.total).toBe(asWarm.prompt.total);
    expect(asCold.prompt.fresh - asWarm.prompt.fresh).toBe(cachedPrefixTokens(asCold.prompt.system));
  });

  it('worst-case refactor: the answer it must write fits the budget it is given', () => {
    // The invariant that actually protects the feature. The refactor hands
    // back its whole input as JSON, so if a 400-node patch needed more than
    // maxTokens the call would come back `incomplete` every time and the
    // artist's action would be spent on nothing.
    expect(worst.output.expected).toBeGreaterThan(0);
    expect(worst.output.expected).toBeLessThan(worst.output.answerCeiling);
    expect(worst.output.headroom).toBeGreaterThan(5000);
  });

  it('worst-case refactor: has more to write than its deadline allows', () => {
    /**
     * Pinned because it is the sharper version of the ceiling finding above:
     * it is not only that the refactor *may* write 40,000 tokens, it is that a
     * 400-node patch *must* write around 20,000, and decoding that plus its
     * thinking room is roughly twice the 285s deadline at the rate run.js
     * assumes. The editor accepts patches up to 400 nodes; this call is
     * accepted knowing it will be stopped.
     *
     * Left as a measurement rather than a failure because the assumed rate is
     * deliberately about half of real decode speed. Change the deadline, the
     * budget, or MAX_NODES and this test says so.
     */
    expect(worst.expectedSeconds).toBeGreaterThan(DEADLINE_SECONDS);
  });

  it('finds where a refactor stops fitting its deadline', () => {
    const ceiling = refactorNodeCeiling();

    // Somewhere well inside the node limit, which is the whole point: the
    // limit that governs a refactor is time, not MAX_NODES.
    expect(ceiling.nodes).toBeGreaterThan(50);
    expect(ceiling.nodes).toBeLessThan(MAX_NODES);
    expect(ceiling.seconds).toBeLessThanOrEqual(DEADLINE_SECONDS);

    // And it is a boundary, not a guess: one node past it does not fit.
    const room = MIRRORED_FROM_RUN.assumedTokensPerSecond * DEADLINE_SECONDS;
    const past = refactorAnswerTokens(syntheticPatch(ceiling.nodes + 1))
      + AI_FEATURES['ai.patch_refactor'].reasoningTokens;
    expect(past).toBeGreaterThan(room);
  });

  it('grows the refactor answer with the patch it is given', () => {
    expect(refactorAnswerTokens(largestPatch())).toBeGreaterThan(
      refactorAnswerTokens(typicalPatch()) * 5
    );
    // A one-node patch is a rounding error against the 8,000 it is given to
    // think with, which is why small refactors are never the problem.
    expect(refactorAnswerTokens(smallestPatch())).toBeLessThan(
      REFACTOR_BUDGET.reserveTokens / 10
    );
  });
});

describe('the pre-flight check in front of a refactor', () => {
  /**
   * The failure this exists to prevent: the gallery meters a grant when it
   * issues it, so a refactor that cannot finish costs the artist an action and
   * a nearly five-minute wait before the deadline turns it into a 504. Working
   * it out first costs a JSON.stringify.
   */
  it('lets an ordinary patch through without a word', () => {
    const fit = refactorFit(typicalPatch());
    expect(fit.verdict).toBe('fits');
    expect(fit.message).toBeNull();
  });

  it('warns on a large one rather than refusing it', () => {
    // The band most loaded patches land in: too big for the pessimistic rate
    // the deadline was sized from, fine at the rate these models really run.
    const fit = refactorFit(syntheticPatch(200));
    expect(fit.verdict).toBe('tight');
    expect(fit.message).toMatch(/large refactor/i);
  });

  it('refuses one that cannot finish at any plausible speed', () => {
    const fit = refactorFit(largestPatch());
    expect(fit.verdict).toBe('too_large');
    expect(fit.reason).toBe('time');
    // The message has to say what to do instead, and that this cost nothing.
    expect(fit.message).toMatch(/select part of the patch/i);
    expect(fit.message).toMatch(/nothing has been charged/i);
  });

  it('refuses one whose answer would not fit the budget at all', () => {
    // Not a timeout: a patch of shader bodies is small in nodes and huge in
    // answer, because the refactor has to write every one of them back. This
    // is the case that would come back `answer_truncated` — a spent action for
    // half a patch.
    const shaderHeavy = {
      nodes: Array.from({ length: 60 }, (_, i) => ({
        id: `c${i}`,
        kind: 'CustomGLSL',
        x: i * 220,
        y: 0,
        params: { code: '// a long custom body\n'.repeat(120) },
      })),
      connections: [],
    };

    const fit = refactorFit(shaderHeavy);
    expect(fit.verdict).toBe('too_large');
    expect(fit.reason).toBe('budget');
    expect(fit.answerTokens).toBeGreaterThan(REFACTOR_BUDGET.answerCeilingTokens);
  });

  it('agrees with the report about what a refactor has to write', () => {
    // One estimator, used by both. A guard that measured differently from the
    // report would be worse than no report.
    const patch = syntheticPatch(150);
    expect(refactorFit(patch).answerTokens).toBe(refactorAnswerTokens(patch));
  });

  it('mirrors the budgets the backend actually enforces', () => {
    const config = AI_FEATURES['ai.patch_refactor'];
    expect(REFACTOR_BUDGET.reserveTokens).toBe(config.reasoningTokens);
    expect(REFACTOR_BUDGET.answerCeilingTokens).toBe(config.maxTokens);
    expect(REFACTOR_BUDGET.pessimisticTokensPerSecond).toBe(ASSUMED_TOKENS_PER_SECOND);
    expect(REFACTOR_BUDGET.deadlineSeconds).toBe(DEADLINE_SECONDS);
    // run.js calls its own rate "roughly half" of real decode speed. If that
    // stops being what the client assumes, the refusal line moves silently.
    expect(REFACTOR_BUDGET.realisticTokensPerSecond).toBe(ASSUMED_TOKENS_PER_SECOND * 2);
  });

  it('leaves the refusal line inside the node limit, where it can bite', () => {
    // If the two crossings ever rose above MAX_NODES the check would be dead
    // code: every patch the editor allows would sail past it.
    const possible = refactorNodeCeiling({
      tokensPerSecond: REFACTOR_BUDGET.realisticTokensPerSecond,
    });
    expect(possible.nodes).toBeLessThan(MAX_NODES);
    expect(refactorNodeCeiling().nodes).toBeLessThan(possible.nodes);
  });
});

describe('the prefix cache, as far as it can be modelled', () => {
  it('grants the cache in whole blocks, so the tail is always fresh', () => {
    expect(cachedPrefixTokens(5919)).toBe(5888);
    expect(5919 - cachedPrefixTokens(5919)).toBeLessThan(CACHE_BLOCK_TOKENS);
  });

  it('caches nothing under the minimum', () => {
    expect(cachedPrefixTokens(1023)).toBe(0);
    expect(cachedPrefixTokens(1024)).toBe(1024);
  });

  it('leaves the prompt the same size either way', () => {
    // Cached tokens are billed cheaper, not billed at zero, and they still
    // count in `input_tokens`. A warm call is not a smaller call.
    const scenarios = namedScenarios();
    for (const scenario of scenarios) {
      expect(scenario.prompt.cached + scenario.prompt.fresh).toBe(scenario.prompt.total);
    }
  });
});

describe('the estimator behind the numbers', () => {
  it('counts four bytes to a token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  it('counts bytes rather than characters, so accented names are not undercounted', () => {
    expect(estimateTokens('é'.repeat(4))).toBe(2);
  });

  it('builds the smallest document a schema admits', () => {
    const minimal = minimalAnswer(AI_FEATURES['ai.patch_review'].format.schema);
    expect(minimal).toEqual({ summary: '', findings: [] });
  });

  it('measures the patch the editor would actually send', () => {
    expect(largestPatch().nodes).toHaveLength(MAX_NODES);
    expect(smallestPatch().nodes).toHaveLength(1);
  });

  it('mirrors run.js rather than inventing its own constants', () => {
    // tokenCost.js keeps its own copies so it can be read without the OpenAI
    // SDK. This is what stops the copies drifting.
    expect(MIRRORED_FROM_RUN.defaultReasoningTokens).toBe(DEFAULT_REASONING_TOKENS);
    expect(MIRRORED_FROM_RUN.assumedTokensPerSecond).toBe(ASSUMED_TOKENS_PER_SECOND);
    expect(MIRRORED_FROM_RUN.defaultModel).toBe(DEFAULT_MODEL);
    expect(MIRRORED_FROM_RUN.maxInputBytes).toBe(MAX_INPUT_BYTES);
    expect(MIRRORED_FROM_RUN.deadlineSeconds).toBe(DEADLINE_SECONDS);
  });

  it('refuses a feature it does not know', () => {
    expect(() => featureTokenRange('ai.nonexistent')).toThrow(/No such feature/);
  });
});
