import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';

/**
 * A model call that runs longer than the platform will wait.
 *
 * This is what a patch review of a real, loaded patch did: the default graph
 * came back in seconds, a canvas full of nodes did not come back at all. The
 * platform killed the invocation at its limit and answered 504 from outside
 * the handler — with none of the CORS headers the handler sets — so the
 * browser refused to read it and reported the failure as
 *
 *   No 'Access-Control-Allow-Origin' header is present on the requested resource
 *
 * which is not what went wrong. These tests pin the two halves of the fix: the
 * backend stops itself before the platform does and answers with a reason, and
 * the editor stops waiting rather than spinning forever.
 */

const streamMock = vi.fn();

vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.responses = { stream: streamMock };
    }
  },
}));

/** The gallery half of a run, which these tests are not about. */
vi.mock('../src/ai/entitlements.js', () => ({
  entitlements: { requestGrant: async () => ({ grant: 'signed.grant', feature: 'ai.patch_review' }) },
  GrantError: class GrantError extends Error {},
}));

const { default: handler, FUNCTION_BUDGET_SECONDS, MODEL_DEADLINE_MS } = await import(
  '../api/ai/run.js'
);
const { runFeature, AIRequestError } = await import('../src/ai/aiClient.js');
const { featureConfig } = await import('../api/_lib/features.js');

const SECRET = 'a'.repeat(64);
const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signGrant(feature = 'ai.patch_review') {
  const iat = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify({ jti: randomUUID(), feature, tier: 'free', sub: 'u1', iat, exp: iat + 300 })
  );
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

const reviewRequest = () => ({
  method: 'POST',
  headers: { origin: 'http://localhost:5173', host: 'studio.tenderworld.org' },
  body: {
    grant: signGrant(),
    feature: 'ai.patch_review',
    input: { patch: { nodes: [{ id: 'n1', kind: 'OutputFinal', x: 0, y: 0 }], connections: [] } },
  },
});

describe('the function budget', () => {
  it('is the same number the platform is told to allow', () => {
    // vitest runs from the repo root, which is where vercel.json lives.
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'));
    expect(vercel.functions['api/**/*.js'].maxDuration).toBe(FUNCTION_BUDGET_SECONDS);
  });

  it('leaves the handler room to answer before the platform kills it', () => {
    expect(MODEL_DEADLINE_MS).toBeLessThan(FUNCTION_BUDGET_SECONDS * 1000);
  });
});

/** A patch of `count` nodes, the last of which renders. */
function patchOf(count) {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    kind: i === count - 1 ? 'OutputFinal' : 'ComputeNoise',
    x: i * 220,
    y: 0,
    params: {},
  }));
  const connections = nodes.slice(1).map((node, i) => ({
    from: { nodeId: `n${i}`, pin: 0 },
    to: { nodeId: node.id, pin: 0 },
  }));
  return { nodes, connections };
}

describe('what a call is allowed to write', () => {
  beforeEach(() => {
    process.env.TIER_GRANT_SECRET = SECRET;
    process.env.OPENAI_API_KEY = 'sk-test';
    streamMock.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // The refactor hands the patch back, so its answer has to pass the
    // validator before any of this is reached.
    streamMock.mockImplementation(() => ({
      finalResponse: async () => ({
        status: 'completed',
        output_text: JSON.stringify({
          summary: 'Tidied.',
          changes: [],
          patch: { nodes: [{ id: 'n1', kind: 'OutputFinal', x: 0, y: 0, params: {} }], connections: [] },
        }),
        output: [],
        usage: {},
      }),
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TIER_GRANT_SECRET;
    delete process.env.OPENAI_API_KEY;
  });

  const refactor = (nodes) => ({
    method: 'POST',
    headers: { origin: 'http://localhost:5173', host: 'studio.tenderworld.org' },
    body: {
      grant: signGrant('ai.patch_refactor'),
      feature: 'ai.patch_refactor',
      input: { patch: patchOf(nodes) },
    },
  });

  /**
   * The refactor returns everything it was given, so its budget is the one
   * that has to follow the input — and a budget is also permission to spend
   * time, which is why a ten-node tidy must not be allowed a four-hundred-node
   * one's allowance.
   */
  it('sizes the refactor to the patch it was actually given', async () => {
    await handler(refactor(6), mockRes());
    const small = streamMock.mock.calls[0][0].max_output_tokens;

    streamMock.mockClear();
    await handler(refactor(200), mockRes());
    const large = streamMock.mock.calls[0][0].max_output_tokens;

    expect(small).toBeLessThan(large / 3);
  });

  it('never asks for more than the ceiling the feature sets, whatever the patch', async () => {
    await handler(refactor(400), mockRes());

    const asked = streamMock.mock.calls[0][0].max_output_tokens;
    const config = featureConfig('ai.patch_refactor');
    expect(asked).toBe(config.maxTokens + config.reasoningTokens);
  });
});

describe('a model call that runs past the deadline', () => {
  beforeEach(() => {
    process.env.TIER_GRANT_SECRET = SECRET;
    process.env.OPENAI_API_KEY = 'sk-test';
    streamMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.TIER_GRANT_SECRET;
    delete process.env.OPENAI_API_KEY;
  });

  /** A model that never answers, and gives up only when the signal fires. */
  function modelThatNeverAnswers() {
    streamMock.mockImplementation((_params, options) => ({
      finalResponse: () =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const aborted = new Error('Request was aborted.');
            aborted.name = 'APIUserAbortError';
            reject(aborted);
          });
        }),
    }));
  }

  it('is stopped, and answered as a timeout rather than left to the platform', async () => {
    modelThatNeverAnswers();

    const res = mockRes();
    const pending = handler(reviewRequest(), res);
    await vi.advanceTimersByTimeAsync(MODEL_DEADLINE_MS + 10);
    await pending;

    expect(res.statusCode).toBe(504);
    expect(res.body.code).toBe('timed_out');
    // The advice has to be actionable: this is the one failure an artist can do
    // something about themselves.
    expect(res.body.error).toMatch(/smaller/i);
  });

  it('holds a review to a deadline of its own, short of the platform ceiling', async () => {
    // Every feature waits in proportion to what it was allowed to write. A
    // review is allowed nine thousand tokens; it has no business sitting there
    // for as long as the largest possible refactor.
    modelThatNeverAnswers();

    const res = mockRes();
    const pending = handler(reviewRequest(), res);
    await vi.advanceTimersByTimeAsync(MODEL_DEADLINE_MS);
    await pending;

    const seconds = Number(res.body.error.match(/after (\d+) seconds/)[1]);
    expect(seconds).toBeLessThan(MODEL_DEADLINE_MS / 1000);
  });

  it('answers the timeout with the CORS headers, so the caller can read it', async () => {
    modelThatNeverAnswers();

    const res = mockRes();
    const pending = handler(reviewRequest(), res);
    await vi.advanceTimersByTimeAsync(MODEL_DEADLINE_MS + 10);
    await pending;

    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });

  it('does not leave the deadline timer pending after an answer', async () => {
    streamMock.mockImplementation(() => ({
      finalResponse: async () => ({
        status: 'completed',
        output_text: JSON.stringify({ summary: 'Fine.', findings: [] }),
        output: [],
        usage: {},
      }),
    }));

    const res = mockRes();
    await handler(reviewRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the editor waiting on an answer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('gives up rather than spinning forever, and says why', async () => {
    // A request nothing will ever answer: the backend's own 504 lost on the
    // way back, or a gateway that dropped it. The browser aborts on our signal
    // and refuses, as it does, to say more than that.
    vi.stubGlobal('fetch', (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
    );

    const run = runFeature('ai.patch_review', { patch: { nodes: [], connections: [] } }).catch(
      (error) => error
    );
    await vi.advanceTimersByTimeAsync(310_000);
    const error = await run;

    expect(error).toBeInstanceOf(AIRequestError);
    expect(error.code).toBe('timed_out');
    expect(error.message).toMatch(/smaller/i);
    // The call was made and the gallery metered it before it went out.
    expect(error.quotaSpent).toBe(true);
  });

  it('keeps a real answer, and does not leave its timer running', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { summary: 'Fine.', findings: [] }, warnings: [] }),
    }));

    const answer = await runFeature('ai.patch_review', { patch: { nodes: [], connections: [] } });

    expect(answer.result.summary).toBe('Fine.');
    expect(vi.getTimerCount()).toBe(0);
  });
});
