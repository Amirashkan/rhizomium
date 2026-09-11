import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntitlementsClient, GrantError } from '../src/ai/entitlements.js';
import {
  FEATURES,
  TIER_LABELS,
  gateFor,
  hasFeature,
  holdsAddon,
  tierAtLeast,
  quotaFor,
  resolveTier,
  editorFeatures,
} from '../src/ai/tiers.js';

/**
 * The vendored catalogue and the client that reads the gallery through it.
 *
 * The catalogue tests exist to catch drift from the gallery's lib/tiers.ts: a
 * mirrored file that quietly disagrees is the failure mode this integration is
 * most exposed to.
 */

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const LIVE_ENTITLEMENTS = {
  authenticated: true,
  userId: 'u-1',
  tier: 'cloude',
  tierLabel: 'Cloude',
  tierExpiresAt: null,
  features: ['ai.patch_review', 'ai.patch_refactor', 'ai.canvas_assist', 'ai.patch_generator'],
  catalog: [
    {
      feature: 'ai.patch_generator',
      label: 'Patch generator',
      surface: 'editor',
      allowed: true,
      requiredTier: 'cloude',
      quota: { limit: 100, windowSeconds: 86400 },
      used: 12,
      resetsAt: '2026-08-23T00:00:00.000Z',
    },
    {
      feature: 'ai.creative_director',
      label: 'AI creative director',
      surface: 'editor',
      allowed: false,
      requiredTier: 'cloude_plus',
      quota: null,
    },
    {
      feature: 'viewer.web',
      label: 'Web viewer',
      surface: 'gallery',
      allowed: true,
      requiredTier: 'cloude',
      quota: null,
    },
  ],
  upgradeUrl: 'https://art.tenderworld.org/pricing',
};

describe('vendored tier catalogue', () => {
  it('locks the generative features behind Cloude', () => {
    expect(hasFeature('free', 'ai.patch_review')).toBe(true);
    expect(hasFeature('free', 'ai.patch_generator')).toBe(false);
    expect(hasFeature('cloude', 'ai.patch_generator')).toBe(true);
    expect(hasFeature('cloude', 'ai.creative_director')).toBe(false);
    expect(hasFeature('cloude_plus', 'ai.creative_director')).toBe(true);
  });

  it('keeps patch refactor behind a subscription', () => {
    // It writes a whole patch back, which makes it the dearest call the editor
    // makes and the only one that overwrites the artist's document. Drawing it
    // as free is how the editor takes a 402 in front of someone.
    expect(hasFeature('free', 'ai.patch_refactor')).toBe(false);
    expect(hasFeature('cloude', 'ai.patch_refactor')).toBe(true);
  });

  it('labels cloude_plus as Studio without moving the key', () => {
    // The key is in stored grants; only the label changed.
    expect(TIER_LABELS.cloude_plus).toBe('Studio');
    expect(FEATURES['ai.creative_director'].tier).toBe('cloude_plus');
  });

  it('orders the tiers', () => {
    expect(tierAtLeast('cloude_plus', 'free')).toBe(true);
    expect(tierAtLeast('free', 'cloude')).toBe(false);
    // An unknown tier must not compare as "at least" anything.
    expect(tierAtLeast('nonsense', 'free')).toBe(false);
  });

  it('treats an unknown feature key as not granted', () => {
    expect(hasFeature('cloude_plus', 'ai.not_a_feature')).toBe(false);
  });

  it('returns no quota for unmetered features and a zero backstop off-tier', () => {
    expect(quotaFor('cloude_plus', 'output.ndi')).toBeNull();
    expect(quotaFor('cloude', 'ai.patch_review')).toEqual({ limit: 5, windowSeconds: 86400 });
    // Not sold at this tier: the tier check refuses first, this is the backstop.
    expect(quotaFor('free', 'ai.patch_generator').limit).toBe(0);
  });

  it('expires a lapsed subscription back to free', () => {
    const past = '2020-01-01T00:00:00.000Z';
    expect(resolveTier({ tier: 'cloude', tier_expires_at: past })).toBe('free');
    expect(resolveTier({ tier: 'cloude', tier_expires_at: null })).toBe('cloude');
    expect(resolveTier({ tier: 'cloude', is_banned: true })).toBe('free');
    expect(resolveTier(null)).toBe('free');
  });

  it('separates editor features from gallery-only ones', () => {
    const editor = editorFeatures();
    expect(editor).toContain('ai.patch_review');
    expect(editor).not.toContain('viewer.web');
    expect(editor).not.toContain('gallery.pro_artist_panel');
  });

  it('gates the add-on features on the add-on, not the tier', () => {
    // The panel is included from Cloude, so subscribers keep it...
    expect(hasFeature('cloude', 'gallery.pro_artist_panel')).toBe(true);
    expect(hasFeature('free', 'gallery.pro_artist_panel')).toBe(false);
    expect(holdsAddon('free', 'addon.pro_artist_panel', ['addon.pro_artist_panel'])).toBe(true);

    // ...while rendering is bundled with nothing and cannot be served, so it
    // is refused on every tier, held or not. Availability beats entitlement.
    for (const tier of ['free', 'cloude', 'cloude_plus']) {
      expect(hasFeature(tier, 'render.server_side')).toBe(false);
      expect(hasFeature(tier, 'render.server_side', ['addon.server_side_rendering'])).toBe(false);
    }
  });

  it('reports which of the three refusals applies', () => {
    expect(gateFor('ai.patch_refactor')).toEqual({ kind: 'tier', tier: 'cloude' });
    expect(gateFor('gallery.pro_artist_panel')).toMatchObject({
      kind: 'addon',
      addon: 'addon.pro_artist_panel',
      includedFrom: 'cloude',
    });
    // Nothing to buy: an upsell here would sell a plan that refuses too.
    const ssr = gateFor('render.server_side');
    expect(ssr.kind).toBe('unavailable');
    expect(ssr.reason).toBeTruthy();
  });

  it('draws no allowance for an add-on feature', () => {
    // Its allowance follows the add-on, and there is no add-on allowance yet.
    // A plan's number here would be a promise nothing can keep.
    expect(quotaFor('cloude_plus', 'render.server_side').limit).toBe(0);
  });

  it('marks the AI features as metered and the output flags as not', () => {
    expect(FEATURES['ai.patch_review'].metered).toBe(true);
    expect(FEATURES['output.ndi'].metered).toBe(false);
    expect(FEATURES['output.multiscreen'].metered).toBe(false);
  });
});

describe('EntitlementsClient', () => {
  let fetchMock;
  let client;

  beforeEach(() => {
    fetchMock = vi.fn();
    client = new EntitlementsClient({ fetch: fetchMock });
  });

  it('sends credentials so the gallery session cookie travels', async () => {
    fetchMock.mockResolvedValue(jsonResponse(LIVE_ENTITLEMENTS));
    await client.load();

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://art.tenderworld.org/api/entitlements');
    expect(options.credentials).toBe('include');
  });

  it('caches for the session and re-reads only when forced', async () => {
    fetchMock.mockResolvedValue(jsonResponse(LIVE_ENTITLEMENTS));

    await client.load();
    await client.load();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await client.refresh();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('makes one request when several callers load at once', async () => {
    fetchMock.mockResolvedValue(jsonResponse(LIVE_ENTITLEMENTS));
    await Promise.all([client.load(), client.load(), client.load()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the free tier when the gallery is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const state = await client.load();

    expect(state.tier).toBe('free');
    expect(state.degraded).toBe(true);
    expect(client.can('ai.patch_review')).toBe(true);
    // Wrong in the safe direction: never hand out a paid feature on a guess.
    expect(client.can('ai.patch_generator')).toBe(false);
  });

  it('falls back to the free tier on a non-OK response too', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    const state = await client.load();
    expect(state.tier).toBe('free');
    expect(state.degraded).toBe(true);
  });

  it('reads allowance from the live catalog', async () => {
    fetchMock.mockResolvedValue(jsonResponse(LIVE_ENTITLEMENTS));
    await client.load();

    const row = client.featureState('ai.patch_generator');
    expect(row.remaining).toBe(88);
    expect(client.editorCatalog().map((r) => r.feature)).not.toContain('viewer.web');
  });

  it('returns the grant and folds the new usage back into the catalog', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(LIVE_ENTITLEMENTS))
      .mockResolvedValueOnce(
        jsonResponse({ granted: true, grant: 'body.sig', feature: 'ai.patch_generator', used: 13, limit: 100 })
      );

    await client.load();
    const grant = await client.requestGrant('ai.patch_generator');

    expect(grant.grant).toBe('body.sig');
    expect(fetchMock.mock.calls[1][1].credentials).toBe('include');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ feature: 'ai.patch_generator' });
    // The panel's "N left" is right without another round trip.
    expect(client.featureState('ai.patch_generator').remaining).toBe(87);
  });

  // The live performer spends minutes of set, not button presses. A gallery
  // that has not learned about units ignores the field and charges one per
  // call, which is what makes sending it safe before the server side lands.
  it('carries units for a feature metered against a clock', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(LIVE_ENTITLEMENTS))
      .mockResolvedValueOnce(
        jsonResponse({ granted: true, grant: 'body.sig', feature: 'ai.patch_generator', used: 13, limit: 100 })
      );

    await client.load();
    await client.requestGrant('ai.patch_generator', { units: 4 });

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      feature: 'ai.patch_generator',
      units: 4,
    });
  });

  it('leaves units off a call that spends the usual single action', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(LIVE_ENTITLEMENTS))
      .mockResolvedValueOnce(
        jsonResponse({ granted: true, grant: 'body.sig', feature: 'ai.patch_generator', used: 13, limit: 100 })
      );

    await client.load();
    await client.requestGrant('ai.patch_generator', { units: 1 });

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ feature: 'ai.patch_generator' });
  });

  it('reports a 402 as an upsell, not an error', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(LIVE_ENTITLEMENTS))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'Patch generator needs Cloude.',
            code: 'tier_required',
            requiredTier: 'cloude',
            requiredTierLabel: 'Cloude',
            upgradeUrl: 'https://art.tenderworld.org/pricing',
          },
          402
        )
      );

    await client.load();
    await expect(client.requestGrant('ai.patch_generator')).rejects.toMatchObject({
      name: 'GrantError',
      code: 'tier_required',
      requiredTierLabel: 'Cloude',
      upgradeUrl: 'https://art.tenderworld.org/pricing',
    });
  });

  it('reports a 429 as a spent allowance, with when it resets', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(LIVE_ENTITLEMENTS))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: 'You have used your Patch generator allowance for now.',
            code: 'quota_exceeded',
            used: 100,
            limit: 100,
            resetsAt: '2026-08-23T00:00:00.000Z',
          },
          429
        )
      );

    await client.load();
    const error = await client.requestGrant('ai.patch_generator').catch((e) => e);

    expect(error.code).toBe('quota_exceeded');
    expect(error.resetsAt).toBe('2026-08-23T00:00:00.000Z');
    // Signed in, so the remedy is waiting, not signing in.
    expect(error.remedyIsSignIn).toBe(false);
  });

  it('tells a signed-out visitor to sign in rather than to pay', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ...LIVE_ENTITLEMENTS, authenticated: false, tier: 'free' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'quota_exceeded', error: 'spent' }, 429));

    await client.load();
    const error = await client.requestGrant('ai.patch_review').catch((e) => e);

    expect(error.remedyIsSignIn).toBe(true);
  });

  it('surfaces a 503 as an operator problem', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(LIVE_ENTITLEMENTS))
      .mockResolvedValueOnce(jsonResponse({}, 503));

    await client.load();
    const error = await client.requestGrant('ai.patch_review').catch((e) => e);

    expect(error).toBeInstanceOf(GrantError);
    expect(error.code).toBe('not_configured');
  });

  it('surfaces a 500 as the gallery falling over, not as a refusal', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(LIVE_ENTITLEMENTS))
      .mockResolvedValueOnce(jsonResponse({}, 500));

    await client.load();
    const error = await client.requestGrant('ai.patch_review').catch((e) => e);

    expect(error).toBeInstanceOf(GrantError);
    // Not 'grant_failed': that reads as "the gallery considered it and said
    // no", and the panel words a considered no as the artist's problem.
    expect(error.code).toBe('server_error');
    expect(error.status).toBe(500);
    expect(error.message).toMatch(/not yours/);
  });

  it('keeps 503 apart from the other 5xx', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(LIVE_ENTITLEMENTS))
      .mockResolvedValueOnce(jsonResponse({}, 503));

    await client.load();
    const error = await client.requestGrant('ai.patch_review').catch((e) => e);
    expect(error.code).toBe('not_configured');
  });

  it("still prefers the gallery's own code and message on a 5xx", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(LIVE_ENTITLEMENTS))
      .mockResolvedValueOnce(jsonResponse({ code: 'grant_store_unavailable', error: 'the quota store is down' }, 500));

    await client.load();
    const error = await client.requestGrant('ai.patch_review').catch((e) => e);

    expect(error.code).toBe('grant_store_unavailable');
    expect(error.message).toBe('the quota store is down');
  });

  it('does not treat a network failure as a refusal', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(LIVE_ENTITLEMENTS))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await client.load();
    const error = await client.requestGrant('ai.patch_review').catch((e) => e);
    expect(error.code).toBe('network');
  });
});
