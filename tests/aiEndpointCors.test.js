import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * CORS on POST /api/ai/run.
 *
 * The desktop app and a local dev server both call this endpoint from another
 * origin with a JSON body, which makes every call preflighted. When the
 * preflight came back without an `Access-Control-Allow-Origin` header the
 * browser refused to send the POST at all, and every AI feature failed the
 * moment its grant succeeded. These tests pin the header on to every way out
 * of the handler, not just the happy one.
 */

vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.responses = { stream: vi.fn() };
    }
  },
}));

const { default: handler } = await import('../api/ai/run.js');
const { isAllowedOrigin, DESKTOP_ORIGINS } = await import('../api/_lib/cors.js');

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (key, value) => { res.headers[key] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.end = () => res;
  return res;
}

async function call(req) {
  const res = mockRes();
  await handler({ headers: {}, ...req }, res);
  return res;
}

const preflight = (origin) =>
  call({
    method: 'OPTIONS',
    headers: {
      origin,
      host: 'studio.tenderworld.org',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });

describe('isAllowedOrigin', () => {
  it('allows every origin the desktop app can be served from', () => {
    for (const origin of DESKTOP_ORIGINS) {
      expect(isAllowedOrigin(origin, 'studio.tenderworld.org')).toBe(true);
    }
  });

  it('allows a dev server on this machine, on any port', () => {
    expect(isAllowedOrigin('http://localhost:5173', 'studio.tenderworld.org')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:3000', 'studio.tenderworld.org')).toBe(true);
    expect(isAllowedOrigin('http://localhost:8000', 'studio.tenderworld.org')).toBe(true);
  });

  it('allows the deployment answering the request, whatever domain that is', () => {
    expect(isAllowedOrigin('https://studio.tenderworld.org', 'studio.tenderworld.org')).toBe(true);
    expect(isAllowedOrigin('https://preview-abc.vercel.app', 'preview-abc.vercel.app')).toBe(true);
  });

  it('refuses an unrelated site, including one that only looks local', () => {
    expect(isAllowedOrigin('https://evil.example', 'studio.tenderworld.org')).toBe(false);
    expect(isAllowedOrigin('https://localhost.evil.example', 'studio.tenderworld.org')).toBe(false);
    expect(isAllowedOrigin('https://studio.tenderworld.org.evil.example', 'studio.tenderworld.org'))
      .toBe(false);
    expect(isAllowedOrigin(undefined, 'studio.tenderworld.org')).toBe(false);
    expect(isAllowedOrigin('not a url', 'studio.tenderworld.org')).toBe(false);
  });

  it('takes extra origins from the environment, ignoring blanks and trailing slashes', () => {
    process.env.AI_ALLOWED_ORIGINS = 'https://studio.example.com/, , https://other.example';
    expect(isAllowedOrigin('https://studio.example.com', 'studio.tenderworld.org')).toBe(true);
    expect(isAllowedOrigin('https://other.example', 'studio.tenderworld.org')).toBe(true);
    expect(isAllowedOrigin('https://third.example', 'studio.tenderworld.org')).toBe(false);
  });
});

describe('POST /api/ai/run - CORS', () => {
  beforeEach(() => {
    delete process.env.AI_ALLOWED_ORIGINS;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.AI_ALLOWED_ORIGINS;
    delete process.env.TIER_GRANT_SECRET;
    delete process.env.OPENAI_API_KEY;
    vi.restoreAllMocks();
  });

  it('answers the desktop app’s preflight with permission to POST', async () => {
    const res = await preflight('tauri://localhost');

    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('tauri://localhost');
    expect(res.headers['Access-Control-Allow-Methods']).toContain('POST');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('content-type');
    expect(res.headers['Access-Control-Max-Age']).toBeTruthy();
  });

  it('answers a dev server’s preflight, which is the localhost:5173 failure', async () => {
    const res = await preflight('http://localhost:5173');
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
  });

  it('names no origin for a site that is not allowed', async () => {
    const res = await preflight('https://evil.example');

    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('varies on Origin whether or not the origin was allowed', async () => {
    expect((await preflight('tauri://localhost')).headers.Vary).toBe('Origin');
    expect((await preflight('https://evil.example')).headers.Vary).toBe('Origin');
  });

  it('carries the header on a refusal too, so the browser can read the reason', async () => {
    // No TIER_GRANT_SECRET: the operator-misconfiguration path, which returns
    // long before any grant is looked at.
    const res = await call({
      method: 'POST',
      headers: { origin: 'tauri://localhost', host: 'studio.tenderworld.org' },
      body: {},
    });

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('not_configured');
    expect(res.headers['Access-Control-Allow-Origin']).toBe('tauri://localhost');
  });

  it('carries the header on a rejected grant', async () => {
    process.env.TIER_GRANT_SECRET = 'a'.repeat(64);
    process.env.OPENAI_API_KEY = 'sk-test';

    const res = await call({
      method: 'POST',
      headers: { origin: 'http://tauri.localhost', host: 'studio.tenderworld.org' },
      body: { grant: 'nonsense', feature: 'ai.patch_review', input: {} },
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://tauri.localhost');
  });

  it('still refuses a method the endpoint does not serve', async () => {
    const res = await call({
      method: 'GET',
      headers: { origin: 'tauri://localhost', host: 'studio.tenderworld.org' },
    });

    expect(res.statusCode).toBe(405);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('tauri://localhost');
  });
});
