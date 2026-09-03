import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';

/**
 * AI debug mode — the switch that stops the tier system rationing development.
 *
 * Two halves, and the pair of them is the point:
 *
 *   - the editor answers its own grant requests, so testing a feature does not
 *     spend an allowance sized for artists, and
 *   - the backend accepts what it hands out ONLY where an operator set
 *     AI_DEBUG_MODE.
 *
 * The second half is why the first one is safe, so most of what is asserted
 * here is what happens when the flag is not set.
 */

const streamMock = vi.fn();

vi.mock('openai', () => ({
  default: class {
    constructor() {
      this.responses = { stream: streamMock };
    }
  },
}));

const {
  isAIDebugMode,
  setAIDebugMode,
  resetAIDebugMode,
  debugGrant,
  debugEntitlements,
  DEBUG_GRANT_PREFIX,
  AI_DEBUG_STORAGE_KEY,
} = await import('../src/ai/debugMode.js');
const { EntitlementsClient } = await import('../src/ai/entitlements.js');
const { default: handler } = await import('../api/ai/run.js');
const { DEBUG_GRANT_PREFIX: BACKEND_PREFIX, debugGrantsEnabled, resetClaimedGrants } =
  await import('../api/_lib/grant.js');

const SECRET = 'a'.repeat(64);
const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function signGrant({ feature = 'ai.patch_review', tier = 'free', ttl = 300 } = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ jti: randomUUID(), feature, tier, sub: 'u1', iat, exp: iat + ttl }));
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

function mockModelAnswer(answer) {
  streamMock.mockReturnValue({
    finalResponse: async () => ({
      status: 'completed',
      output_text: JSON.stringify(answer),
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  });
}

async function post(body) {
  const res = mockRes();
  await handler({ method: 'POST', body }, res);
  return res;
}

describe('AI debug mode — the editor half', () => {
  beforeEach(() => {
    resetAIDebugMode();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Turning the mode off sends the shared client after the real
    // entitlements. Nothing in this file wants a network call; this is what
    // fails it loudly if one is ever made through the default path.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
  });

  afterEach(() => {
    resetAIDebugMode();
    vi.restoreAllMocks();
  });

  it('is off unless something turns it on', () => {
    expect(isAIDebugMode()).toBe(false);
    expect(new EntitlementsClient({ fetch: vi.fn() }).current.debug).toBeUndefined();
  });

  it('spends no quota and asks no gallery for a grant', async () => {
    const fetchImpl = vi.fn();
    const client = new EntitlementsClient({ fetch: fetchImpl });

    setAIDebugMode(true);
    const grant = await client.requestGrant('ai.patch_refactor');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(grant.granted).toBe(true);
    expect(grant.debug).toBe(true);
    expect(grant.grant).toBe('debug:ai.patch_refactor');
    // Nothing was counted, so there is no number to show. A zero here would be
    // read as an exhausted allowance.
    expect(grant.used).toBeNull();
    expect(grant.limit).toBeNull();
  });

  it('unlocks every feature without a gallery, and says it is not an account', async () => {
    const fetchImpl = vi.fn();
    const client = new EntitlementsClient({ fetch: fetchImpl });

    setAIDebugMode(true);
    await client.load();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.tier).toBe('admin');
    expect(client.current.debug).toBe(true);
    // The dearest feature on the highest tier: if this is drawn as available,
    // nothing below it is locked.
    expect(client.can('ai.creative_director')).toBe(true);
    expect(client.editorCatalog().every((row) => row.allowed)).toBe(true);
    // Unmetered, so the panel draws no allowance bars rather than fake ones.
    expect(client.editorCatalog().every((row) => row.quota === null)).toBe(true);
  });

  it('goes back to the real answer when turned off', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authenticated: true, tier: 'free', features: ['ai.patch_review'], catalog: [] }),
    });
    const client = new EntitlementsClient({ fetch: fetchImpl });

    setAIDebugMode(true);
    // Loading while the mode is on must not leave an admin tier in the cache:
    // load() caches what it read, and this answer was invented rather than
    // read. Without that, turning the mode off left the panel unlocked.
    await client.load();
    expect(client.tier).toBe('admin');

    setAIDebugMode(false);
    await client.load();

    expect(fetchImpl).toHaveBeenCalled();
    expect(client.tier).toBe('free');
    expect(client.can('ai.creative_director')).toBe(false);
  });

  it('is remembered across a reload, and forgotten on request', () => {
    setAIDebugMode(true);
    expect(globalThis.localStorage.getItem(AI_DEBUG_STORAGE_KEY)).toBe('1');
    setAIDebugMode(false);
    expect(globalThis.localStorage.getItem(AI_DEBUG_STORAGE_KEY)).toBeNull();
  });

  it('turns on from ?aidebug=1 in the URL', () => {
    const before = globalThis.location.href;
    try {
      globalThis.history.replaceState({}, '', '/?aidebug=1');
      resetAIDebugMode();
      expect(isAIDebugMode()).toBe(true);
    } finally {
      globalThis.history.replaceState({}, '', before);
      resetAIDebugMode();
    }
  });

  it('reports itself off when storage cannot be read', () => {
    const storage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('blocked'); },
    });
    try {
      resetAIDebugMode();
      expect(isAIDebugMode()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    }
  });

  it('carries the feature inside the token, in the shape the backend reads', () => {
    // Drift here is the failure this pair of constants exists to prevent: the
    // editor would issue tokens the backend does not recognise, and every
    // debug run would 401 on a deployment that had opted in.
    expect(DEBUG_GRANT_PREFIX).toBe(BACKEND_PREFIX);
    expect(debugGrant('ai.node_generator').grant).toBe(`${DEBUG_GRANT_PREFIX}ai.node_generator`);
    expect(debugEntitlements().features).toContain('ai.creative_director');
  });
});

describe('AI debug mode — the backend half', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.TIER_GRANT_SECRET = SECRET;
    delete process.env.AI_DEBUG_MODE;
    delete process.env.AI_DEBUG_ALLOW_PRODUCTION;
    delete process.env.VERCEL_ENV;
    streamMock.mockReset();
    resetClaimedGrants();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.TIER_GRANT_SECRET;
    delete process.env.AI_DEBUG_MODE;
    delete process.env.AI_DEBUG_ALLOW_PRODUCTION;
    delete process.env.VERCEL_ENV;
    vi.restoreAllMocks();
  });

  it('refuses a debug grant on a deployment that did not ask for one', async () => {
    expect(debugGrantsEnabled()).toBe(false);

    const res = await post({ grant: 'debug:ai.patch_review', input: { patch: { nodes: [] } } });

    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('invalid_grant');
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('serves a debug grant where AI_DEBUG_MODE is set, without a gallery secret', async () => {
    process.env.AI_DEBUG_MODE = '1';
    delete process.env.TIER_GRANT_SECRET; // A dev backend has nothing signing grants.
    mockModelAnswer({ summary: 'ok', findings: [] });

    const res = await post({
      grant: 'debug:ai.patch_review',
      feature: 'ai.patch_review',
      input: { patch: { nodes: [], connections: [] } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.feature).toBe('ai.patch_review');
    // The one marker that says this answer cost nobody an action.
    expect(res.body.debug).toBe(true);
    expect(streamMock).toHaveBeenCalled();
  });

  it('runs a paid feature no allowance was spent on — which is the point', async () => {
    process.env.AI_DEBUG_MODE = '1';
    mockModelAnswer({ summary: 'ok', findings: [] });

    const res = await post({
      grant: 'debug:ai.patch_review',
      input: { patch: { nodes: [], connections: [] } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.tier).toBe('admin');
  });

  it('still takes the feature from the token, never from the body', async () => {
    process.env.AI_DEBUG_MODE = '1';

    const res = await post({
      grant: 'debug:ai.patch_review',
      feature: 'ai.creative_director',
      input: { patch: {} },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe('feature_mismatch');
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('refuses a debug token with no feature in it', async () => {
    process.env.AI_DEBUG_MODE = '1';

    const res = await post({ grant: 'debug:', input: {} });

    expect(res.statusCode).toBe(401);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('ignores AI_DEBUG_MODE on a production deployment', async () => {
    process.env.AI_DEBUG_MODE = '1';
    process.env.VERCEL_ENV = 'production';

    expect(debugGrantsEnabled()).toBe(false);
    const res = await post({ grant: 'debug:ai.patch_review', input: {} });

    expect(res.statusCode).toBe(401);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('allows it in production only when a second variable says so', async () => {
    process.env.AI_DEBUG_MODE = '1';
    process.env.VERCEL_ENV = 'production';
    process.env.AI_DEBUG_ALLOW_PRODUCTION = 'true';
    mockModelAnswer({ summary: 'ok', findings: [] });

    const res = await post({
      grant: 'debug:ai.patch_review',
      input: { patch: { nodes: [], connections: [] } },
    });

    expect(res.statusCode).toBe(200);
  });

  it('is on for a preview deployment, which is where it gets used', () => {
    process.env.AI_DEBUG_MODE = '1';
    process.env.VERCEL_ENV = 'preview';
    expect(debugGrantsEnabled()).toBe(true);
  });

  it('leaves the signed path exactly as it was', async () => {
    process.env.AI_DEBUG_MODE = '1';
    mockModelAnswer({ summary: 'ok', findings: [] });

    const signed = await post({
      grant: signGrant({ feature: 'ai.patch_review' }),
      input: { patch: { nodes: [], connections: [] } },
    });

    expect(signed.statusCode).toBe(200);
    expect(signed.body.tier).toBe('free');
    expect(signed.body.debug).toBeUndefined();

    // And a forged one is still forged, mode or no mode.
    const forged = await post({ grant: 'made.up', input: {} });
    expect(forged.statusCode).toBe(401);
  });

  it('does not treat an unknown feature as served just because it is debug', async () => {
    process.env.AI_DEBUG_MODE = '1';

    const res = await post({ grant: 'debug:render.server_side', input: {} });

    expect(res.statusCode).toBe(501);
    expect(streamMock).not.toHaveBeenCalled();
  });
});
