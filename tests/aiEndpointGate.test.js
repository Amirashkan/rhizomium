import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';

/**
 * POST /api/ai/run — the ordering that makes the tier system real.
 *
 * The model is mocked throughout: the point of these tests is what happens
 * *before* a model call, and specifically that nothing reaches it without a
 * grant the gallery signed for that exact feature.
 */

const streamMock = vi.fn();

vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.responses = { stream: streamMock };
    }
  },
}));

const { default: handler } = await import('../api/ai/run.js');
const { resetClaimedGrants } = await import('../api/_lib/grant.js');

const SECRET = 'a'.repeat(64);
const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signGrant({ feature = 'ai.patch_review', tier = 'free', sub = 'u1', ttl = 300 } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ jti: randomUUID(), feature, tier, sub, iat, exp: iat + ttl }));
  return `${body}.${b64url(createHmac('sha256', SECRET).update(body).digest())}`;
}

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.end = () => res;
  return res;
}

/** A model answer that returns `input` as the feature's structured output. */
function mockModelAnswer(input) {
  streamMock.mockReturnValue({
    finalResponse: async () => ({
      status: 'completed',
      output_text: JSON.stringify(input),
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(input) }] }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 4000 },
        output_tokens_details: { reasoning_tokens: 900 },
      },
    }),
  });
}

/** A call that fails inside the SDK, the way an APIError arrives. */
function mockModelFailure(error) {
  streamMock.mockReturnValue({ finalResponse: async () => { throw error; } });
}

async function post(body) {
  const res = mockRes();
  await handler({ method: 'POST', body }, res);
  return res;
}

describe('POST /api/ai/run', () => {
  beforeEach(() => {
    process.env.TIER_GRANT_SECRET = SECRET;
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_REASONING;
    streamMock.mockReset();
    resetClaimedGrants();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.TIER_GRANT_SECRET;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_REASONING;
    vi.restoreAllMocks();
  });

  describe('refuses before the model is reached', () => {
    it('rejects anything but POST', async () => {
      const res = mockRes();
      await handler({ method: 'GET' }, res);
      expect(res.statusCode).toBe(405);
      expect(streamMock).not.toHaveBeenCalled();
    });

    it('rejects a request with no grant', async () => {
      const res = await post({ input: {} });
      expect(res.statusCode).toBe(401);
      expect(res.body.code).toBe('invalid_grant');
      expect(streamMock).not.toHaveBeenCalled();
    });

    it('rejects a forged grant', async () => {
      const res = await post({ grant: 'made.up' });
      expect(res.statusCode).toBe(401);
      expect(streamMock).not.toHaveBeenCalled();
    });

    it('rejects an expired grant', async () => {
      const res = await post({ grant: signGrant({ ttl: -1 }), input: {} });
      expect(res.statusCode).toBe(401);
      expect(streamMock).not.toHaveBeenCalled();
    });

    it('refuses a cheap grant used for an expensive feature', async () => {
      // The whole point: one grant for the cheapest free feature must not
      // authorise the most expensive cloude_plus one.
      const res = await post({
        grant: signGrant({ feature: 'ai.patch_review' }),
        feature: 'ai.creative_director',
        input: { patch: {} },
      });

      expect(res.statusCode).toBe(403);
      expect(res.body.code).toBe('feature_mismatch');
      expect(streamMock).not.toHaveBeenCalled();
    });

    it('refuses a valid grant for a feature this backend does not serve', async () => {
      const res = await post({
        grant: signGrant({ feature: 'render.server_side', tier: 'cloude_plus' }),
        input: {},
      });

      expect(res.statusCode).toBe(501);
      expect(streamMock).not.toHaveBeenCalled();
    });

    it('refuses an oversized patch', async () => {
      const res = await post({
        grant: signGrant(),
        input: { patch: { padding: 'x'.repeat(600 * 1024) } },
      });

      expect(res.statusCode).toBe(413);
      expect(streamMock).not.toHaveBeenCalled();
    });

    it('refuses a generator request with nothing to generate from', async () => {
      const res = await post({
        grant: signGrant({ feature: 'ai.patch_generator', tier: 'cloude' }),
        input: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.body.code).toBe('bad_input');
      expect(streamMock).not.toHaveBeenCalled();
    });

    it('refuses everything when the shared secret is not configured', async () => {
      delete process.env.TIER_GRANT_SECRET;
      const res = await post({ grant: signGrant() });

      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('not_configured');
      expect(streamMock).not.toHaveBeenCalled();
    });

    it('refuses when the model key is missing, rather than failing mid-call', async () => {
      delete process.env.OPENAI_API_KEY;
      const res = await post({ grant: signGrant() });

      expect(res.statusCode).toBe(503);
      expect(streamMock).not.toHaveBeenCalled();
    });
  });

  describe('with a valid grant', () => {
    it('runs the feature named in the grant and returns its result', async () => {
      mockModelAnswer({ summary: 'Fine.', findings: [] });

      const res = await post({
        grant: signGrant({ feature: 'ai.patch_review' }),
        feature: 'ai.patch_review',
        input: { patch: { nodes: [] } },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.feature).toBe('ai.patch_review');
      expect(res.body.result.summary).toBe('Fine.');
      expect(streamMock).toHaveBeenCalledTimes(1);
    });

    it('asks for the feature\'s own schema, and keeps the prompt cacheable', async () => {
      mockModelAnswer({ summary: '', findings: [] });
      await post({ grant: signGrant(), input: { patch: {} } });

      const request = streamMock.mock.calls[0][0];
      expect(request.model).toBe('gpt-5.5');
      expect(request.text.format.type).toBe('json_schema');
      expect(request.text.format.name).toBe('patch_review');
      expect(request.text.format.strict).toBe(true);
      expect(request.reasoning).toEqual({ effort: 'high' });

      // The catalogue must sit in `instructions`, the stable prefix OpenAI
      // caches, rather than being folded into the user turn with the patch.
      expect(request.instructions).toContain('Rhizomium');
      expect(request.input).toEqual([{ role: 'user', content: expect.any(String) }]);

      // An artist's patch is not ours to leave on someone else's server.
      expect(request.store).toBe(false);
    });

    it('lets the operator name the model, and clamps effort to what every model takes', async () => {
      process.env.OPENAI_MODEL = 'gpt-5.4';
      mockModelAnswer({ reading: '', directions: [] });

      await post({
        grant: signGrant({ feature: 'ai.creative_director', tier: 'cloude_plus' }),
        input: { patch: {}, brief: 'go' },
      });

      const request = streamMock.mock.calls[0][0];
      expect(request.model).toBe('gpt-5.4');
      // The feature asks for `xhigh`; not every model accepts it, and a
      // rejected effort value would fail the call outright.
      expect(request.reasoning).toEqual({ effort: 'high' });
    });

    it('keys the cache by feature, so a warm prefix is found rather than hoped for', async () => {
      mockModelAnswer({ summary: '', findings: [] });
      await post({ grant: signGrant(), input: { patch: {} } });

      expect(streamMock.mock.calls[0][0].prompt_cache_key).toBe('patch_review');
    });

    it('drops reasoning for a model that has none, rather than failing every call', async () => {
      // An operator naming a model without a reasoning mode should get a
      // working editor, not a 400 on every button.
      process.env.OPENAI_REASONING = 'off';
      mockModelAnswer({ summary: '', findings: [] });

      await post({ grant: signGrant(), input: { patch: {} } });

      const request = streamMock.mock.calls[0][0];
      expect(request.reasoning).toBeUndefined();
      // Nothing is thinking out loud, so the answer is the whole budget.
      expect(request.max_output_tokens).toBe(16000);
    });

    it('leaves room for reasoning on top of the answer budget', async () => {
      mockModelAnswer({ summary: '', findings: [] });
      await post({ grant: signGrant(), input: { patch: {} } });

      // Reasoning is spent out of max_output_tokens, so the 16000-token answer
      // budget patch review declares cannot be the whole allowance.
      expect(streamMock.mock.calls[0][0].max_output_tokens).toBeGreaterThan(16000);
    });

    it('never lets the body choose the prompt', async () => {
      mockModelAnswer({ summary: '', findings: [] });

      // No `feature` in the body at all — the grant is the only authority.
      await post({ grant: signGrant({ feature: 'ai.patch_review' }), input: { patch: {} } });

      expect(streamMock.mock.calls[0][0].text.format.name).toBe('patch_review');
    });

    it('reports usage, including what the cached prefix saved', async () => {
      mockModelAnswer({ summary: '', findings: [] });
      const res = await post({ grant: signGrant(), input: { patch: {} } });

      expect(res.body.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 4000,
        reasoningTokens: 900,
      });
    });

    it('validates a generated patch before handing it back', async () => {
      mockModelAnswer({
        title: 'Test',
        notes: '',
        patch: {
          nodes: [
            { id: '1', kind: 'UV', x: 0, y: 0, params: {} },
            { id: '2', kind: 'OutputFinal', x: 220, y: 0, params: {} },
          ],
          connections: [{ from: { nodeId: '1', pin: 0 }, to: { nodeId: '2', pin: 0 } }],
        },
      });

      const res = await post({
        grant: signGrant({ feature: 'ai.patch_generator', tier: 'cloude' }),
        input: { prompt: 'something' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.result.patch.nodes).toHaveLength(2);
    });

    it('refuses to hand over a patch that would not open', async () => {
      mockModelAnswer({
        title: 'Broken',
        notes: '',
        patch: { nodes: [{ id: '1', kind: 'NotAThing', x: 0, y: 0, params: {} }], connections: [] },
      });

      const res = await post({
        grant: signGrant({ feature: 'ai.patch_generator', tier: 'cloude' }),
        input: { prompt: 'something' },
      });

      expect(res.statusCode).toBe(502);
      expect(res.body.code).toBe('unusable_answer');
    });

    it('reports a refusal as its own thing, not a server error', async () => {
      streamMock.mockReturnValue({
        finalResponse: async () => ({
          status: 'completed',
          output_text: '',
          output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
          usage: {},
        }),
      });

      const res = await post({ grant: signGrant(), input: { patch: {} } });
      expect(res.statusCode).toBe(422);
      expect(res.body.code).toBe('refused');
      expect(res.body.detail).toBe('no');
    });

    it('treats an answer cut short as a failed call, not a partial result', async () => {
      // Half a patch is not a patch. The budget is ours to raise, so this is
      // reported as our failure rather than handed over as a result.
      streamMock.mockReturnValue({
        finalResponse: async () => ({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output_text: '{"summary": "it was going we',
          output: [],
          usage: {},
        }),
      });

      const res = await post({
        grant: signGrant({ feature: 'ai.patch_generator', tier: 'cloude' }),
        input: { prompt: 'something' },
      });

      expect(res.statusCode).toBe(502);
      expect(res.body.code).toBe('answer_truncated');
    });

    it('does not try to parse an answer that is not JSON', async () => {
      streamMock.mockReturnValue({
        finalResponse: async () => ({
          status: 'completed',
          output_text: 'Sure! Here is your review:',
          output: [],
          usage: {},
        }),
      });

      const res = await post({ grant: signGrant(), input: { patch: {} } });
      expect(res.statusCode).toBe(502);
      expect(res.body.code).toBe('no_answer');
    });

    it('names an unpaid model bill as an operator problem, not a busy service', async () => {
      // The trap: OpenAI reports an exhausted account as a 429, the same
      // status as a rate limit. Telling an artist to try again in a moment
      // would be wrong for as long as the bill goes unpaid.
      const error = new Error('429 You exceeded your current quota, please check your plan and billing details.');
      error.status = 429;
      error.code = 'insufficient_quota';
      error.error = {
        message: 'You exceeded your current quota, please check your plan and billing details.',
        type: 'insufficient_quota',
        code: 'insufficient_quota',
      };
      mockModelFailure(error);

      const res = await post({ grant: signGrant(), input: { patch: {} } });

      // Not "busy, try again": retrying cannot fix an unpaid bill.
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('not_configured');
    });

    it('separates a request we built wrongly from a billing problem', async () => {
      const error = new Error('400 Invalid schema for response_format');
      error.status = 400;
      error.error = { message: "Invalid schema for response_format 'patch_review'.", type: 'invalid_request_error' };
      mockModelFailure(error);

      const res = await post({ grant: signGrant(), input: { patch: {} } });

      expect(res.statusCode).toBe(502);
      expect(res.body.code).toBe('bad_model_request');
    });

    it('names a model this deployment cannot use as a configuration problem', async () => {
      const error = new Error('404 The model `gpt-9` does not exist');
      error.status = 404;
      error.error = { message: 'The model `gpt-9` does not exist or you do not have access to it.' };
      mockModelFailure(error);

      const res = await post({ grant: signGrant(), input: { patch: {} } });

      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('not_configured');
    });

    it('turns a model rate limit into a retryable answer', async () => {
      const error = new Error('429 Rate limit reached for requests');
      error.status = 429;
      error.code = 'rate_limit_exceeded';
      mockModelFailure(error);

      const res = await post({ grant: signGrant(), input: { patch: {} } });
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('model_busy');
      expect(res.headers['Retry-After']).toBeDefined();
    });

    it('never lets a model answer be cached by a proxy', async () => {
      mockModelAnswer({ summary: '', findings: [] });
      const res = await post({ grant: signGrant(), input: { patch: {} } });

      expect(res.headers['Cache-Control']).toBe('private, no-store');
    });

    it('spends an expensive grant exactly once', async () => {
      mockModelAnswer({ reading: '', directions: [] });
      const grant = signGrant({ feature: 'ai.creative_director', tier: 'cloude_plus' });

      const first = await post({ grant, input: { patch: {}, brief: 'go' } });
      const second = await post({ grant, input: { patch: {}, brief: 'go' } });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(409);
      expect(second.body.code).toBe('grant_replayed');
      expect(streamMock).toHaveBeenCalledTimes(1);
    });

    it('lets a cheap grant be used without replay tracking getting in the way', async () => {
      mockModelAnswer({ suggestions: [] });
      const grant = signGrant({ feature: 'ai.canvas_assist' });

      const first = await post({ grant, input: { patch: {} } });
      const second = await post({ grant, input: { patch: {} } });

      // Canvas assist fires as the artist works; the gallery already metered it.
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
    });
  });
});
