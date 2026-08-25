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

describe('a model call that runs past the deadline', () => {
  beforeEach(() => {
    process.env.TIER_GRANT_SECRET = SECRET;
    process.env.OPENAI_API_KEY = 'sk-test';
    streamMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
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
