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

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      this.messages = { stream: streamMock };
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

/** A model answer that returns `input` through the feature's tool. */
function mockModelAnswer(toolName, input) {
  streamMock.mockReturnValue({
    finalMessage: async () => ({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: toolName, input }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 4000 },
    }),
  });
}

async function post(body) {
  const res = mockRes();
  await handler({ method: 'POST', body }, res);
  return res;
}

describe('POST /api/ai/run', () => {
  beforeEach(() => {
    process.env.TIER_GRANT_SECRET = SECRET;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    streamMock.mockReset();
    resetClaimedGrants();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.TIER_GRANT_SECRET;
    delete process.env.ANTHROPIC_API_KEY;
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
      delete process.env.ANTHROPIC_API_KEY;
      const res = await post({ grant: signGrant() });

      expect(res.statusCode).toBe(503);
      expect(streamMock).not.toHaveBeenCalled();
    });
  });

  describe('with a valid grant', () => {
    it('runs the feature named in the grant and returns its result', async () => {
      mockModelAnswer('report_review', { summary: 'Fine.', findings: [] });

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

    it('forces the feature\'s own tool and caches the catalogue prefix', async () => {
      mockModelAnswer('report_review', { summary: '', findings: [] });
      await post({ grant: signGrant(), input: { patch: {} } });

      const request = streamMock.mock.calls[0][0];
      expect(request.model).toBe('claude-opus-5');
      expect(request.tool_choice).toEqual({ type: 'tool', name: 'report_review' });
      expect(request.thinking).toEqual({ type: 'adaptive' });
      expect(request.system[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('never lets the body choose the prompt', async () => {
      mockModelAnswer('report_review', { summary: '', findings: [] });

      // No `feature` in the body at all — the grant is the only authority.
      await post({ grant: signGrant({ feature: 'ai.patch_review' }), input: { patch: {} } });

      expect(streamMock.mock.calls[0][0].tools[0].name).toBe('report_review');
    });

    it('validates a generated patch before handing it back', async () => {
      mockModelAnswer('emit_patch', {
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
      mockModelAnswer('emit_patch', {
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
        finalMessage: async () => ({
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'cyber', explanation: 'no' },
          content: [],
          usage: {},
        }),
      });

      const res = await post({ grant: signGrant(), input: { patch: {} } });
      expect(res.statusCode).toBe(422);
      expect(res.body.code).toBe('refused');
    });

    it('turns a model rate limit into a retryable answer', async () => {
      const error = new Error('rate limited');
      error.status = 429;
      streamMock.mockReturnValue({ finalMessage: async () => { throw error; } });

      const res = await post({ grant: signGrant(), input: { patch: {} } });
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe('model_busy');
      expect(res.headers['Retry-After']).toBeDefined();
    });

    it('never lets a model answer be cached by a proxy', async () => {
      mockModelAnswer('report_review', { summary: '', findings: [] });
      const res = await post({ grant: signGrant(), input: { patch: {} } });

      expect(res.headers['Cache-Control']).toBe('private, no-store');
    });

    it('spends an expensive grant exactly once', async () => {
      mockModelAnswer('direct', { reading: '', directions: [] });
      const grant = signGrant({ feature: 'ai.creative_director', tier: 'cloude_plus' });

      const first = await post({ grant, input: { patch: {}, brief: 'go' } });
      const second = await post({ grant, input: { patch: {}, brief: 'go' } });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(409);
      expect(second.body.code).toBe('grant_replayed');
      expect(streamMock).toHaveBeenCalledTimes(1);
    });

    it('lets a cheap grant be used without replay tracking getting in the way', async () => {
      mockModelAnswer('suggest', { suggestions: [] });
      const grant = signGrant({ feature: 'ai.canvas_assist' });

      const first = await post({ grant, input: { patch: {} } });
      const second = await post({ grant, input: { patch: {} } });

      // Canvas assist fires as the artist works; the gallery already metered it.
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
    });
  });
});
