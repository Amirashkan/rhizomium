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
  estimateTokens,
  minimalAnswer,
  largestPatch,
  smallestPatch,
  hardInputCeilingTokens,
  MIRRORED_FROM_RUN,
  MAX_NODES,
} = await import('../api/_lib/tokenCost.js');

const { AI_FEATURES } = await import('../api/_lib/features.js');
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
    // The node registry and the format legend are the bulk of it, identical
    // across features, which is what makes prefix caching worth having. If
    // these ever diverge by much, one feature has grown its own preamble.
    const system = ranges.map((range) => range.input.system);
    const spread = Math.max(...system) - Math.min(...system);
    expect(spread).toBeLessThan(200);
  });

  it('keeps the shared prompt under 8,000 tokens', () => {
    // Paid in full on a cold call, and on every call for a feature nobody has
    // run recently. The registry is ~5,200 tokens of it today; this is the
    // line at which adding to the catalogue stops being free.
    for (const range of ranges) {
      expect(range.input.system).toBeLessThan(8000);
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
