import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The admin tier — everything, unmetered, and nobody's to grant but the
 * gallery's.
 *
 * Two things are being held here. That the catalogue mirrors the gallery's
 * `lib/tiers.ts` correctly for a tier that is above every other one and sold to
 * nobody; and that the editor draws an admin account as an operator rather than
 * as a very expensive plan.
 */

vi.mock('../src/ai/aiClient.js', () => ({
  runFeature: vi.fn(),
  AIRequestError: class AIRequestError extends Error {},
  GrantError: class GrantError extends Error {},
}));

vi.mock('../src/ui/ModalManager.js', () => ({
  modalManager: {
    toast: vi.fn(),
    showModal: vi.fn(),
    createModal: (options) => options,
    confirm: async () => false,
  },
}));

vi.mock('../src/ai/applyResult.js', () => ({
  insertGeneratedNode: vi.fn(),
  replaceGraphWithPatch: vi.fn(),
  selectNodes: vi.fn(),
}));

vi.mock('../src/ui/accountSession.js', () => ({
  DESKTOP_ORIGIN_HINT: '',
  signInToGallery: vi.fn(),
}));

const {
  ADMIN_TIER,
  FEATURES,
  FEATURE_KEYS,
  TIERS,
  TIER_LABELS,
  editorFeatures,
  hasFeature,
  isSubscriptionTier,
  isTier,
  quotaFor,
  requiredTier,
  resolveTier,
  tierAtLeast,
  tierLabel,
} = await import('../src/ai/tiers.js');
const { EntitlementsClient } = await import('../src/ai/entitlements.js');
const { AIPanel } = await import('../src/ui/AIPanel.js');

/** The payload the gallery sends for an admin account, as the client sees it. */
function adminPayload() {
  return {
    authenticated: true,
    userId: 'u-admin',
    tier: ADMIN_TIER,
    tierLabel: 'Admin',
    tierExpiresAt: null,
    features: [...FEATURE_KEYS],
    catalog: editorFeatures().map((feature) => ({
      feature,
      label: FEATURES[feature].label,
      surface: 'editor',
      allowed: true,
      requiredTier: FEATURES[feature].tier,
      // Nothing counts an admin's usage, so the gallery sends no quota.
      quota: null,
      used: null,
      resetsAt: null,
    })),
  };
}

describe('the admin tier in the catalogue', () => {
  it('sits above Studio and is labelled as itself', () => {
    expect(tierAtLeast(ADMIN_TIER, 'cloude_plus')).toBe(true);
    expect(tierAtLeast('cloude_plus', ADMIN_TIER)).toBe(false);
    expect(TIER_LABELS[ADMIN_TIER]).toBe('Admin');
    expect(tierLabel(ADMIN_TIER)).toBe('Admin');
  });

  it('is a tier that can be in force, never one that can be set', () => {
    // The distinction the gallery's types now make, mirrored here: TIERS is
    // what an account can be sold and stored on, and the admin tier is not in
    // it. A path that could set this tier would be a path that hands it out.
    expect(TIERS).not.toContain(ADMIN_TIER);
    expect(isTier(ADMIN_TIER)).toBe(true);
    expect(isSubscriptionTier(ADMIN_TIER)).toBe(false);
    expect(isSubscriptionTier('cloude_plus')).toBe(true);
  });

  it('passes every tier gate', () => {
    const tierGated = FEATURE_KEYS.filter((feature) => !FEATURES[feature].addon);
    for (const feature of tierGated) {
      expect(hasFeature(ADMIN_TIER, feature)).toBe(true);
    }
  });

  it('does not conjure an add-on nobody can be served', () => {
    // Server-side rendering is gated on an add-on that is bundled with no plan
    // and cannot be served — there is no renderer behind it. Ranking above
    // Studio is not the same as making that exist.
    expect(hasFeature(ADMIN_TIER, 'render.server_side')).toBe(false);
    // One that is merely included from a paid tier does come with it.
    expect(hasFeature(ADMIN_TIER, 'gallery.pro_artist_panel')).toBe(true);
  });

  it('is unmetered rather than generous', () => {
    const metered = FEATURE_KEYS.filter((feature) => FEATURES[feature].metered);
    expect(metered.length).toBeGreaterThan(0);
    for (const feature of metered) {
      // Not a large number: a number would still be counted down, and would
      // still refuse on the day it ran out.
      expect(quotaFor(ADMIN_TIER, feature)).toBeNull();
    }
  });

  it('is never what an upsell asks an artist to buy', () => {
    // Nothing is sold at this tier, so naming it in an upsell would be an offer
    // nobody could take.
    for (const feature of FEATURE_KEYS) {
      expect(requiredTier(feature)).not.toBe(ADMIN_TIER);
      expect(FEATURES[feature].tier).not.toBe(ADMIN_TIER);
    }
  });

  it('comes from the account role, and nothing else', () => {
    expect(resolveTier({ role: 'admin', tier: 'free' })).toBe(ADMIN_TIER);
    // A tier column claiming it promotes nobody — this is the shape a browser
    // could put in a cached auth/check payload.
    expect(resolveTier({ role: 'user', tier: ADMIN_TIER })).toBe('free');
    // Only 'admin'. A moderator keeps whatever they are subscribed to.
    expect(resolveTier({ role: 'moderator', tier: 'cloude' })).toBe('cloude');
  });

  it('does not expire, and a ban still takes it', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    // An operator may also hold a subscription; its lapsing is not their role
    // lapsing.
    expect(resolveTier({ role: 'admin', tier: 'cloude', tier_expires_at: past })).toBe(ADMIN_TIER);
    // A ban closes every paid surface, whatever else the account is.
    expect(resolveTier({ role: 'admin', is_banned: true })).toBe('free');
    // And ordinary accounts are untouched by any of this.
    expect(resolveTier({ role: 'user', tier: 'cloude', tier_expires_at: past })).toBe('free');
    expect(resolveTier({ role: 'user', tier: 'cloude' })).toBe('cloude');
  });
});

describe('the client on an admin account', () => {
  it('reads the tier from the gallery and unlocks everything', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => adminPayload(),
    });
    const client = new EntitlementsClient({ fetch: fetchImpl });

    await client.load();

    expect(client.tier).toBe(ADMIN_TIER);
    expect(client.authenticated).toBe(true);
    expect(client.can('ai.creative_director')).toBe(true);
    expect(client.can('output.ndi')).toBe(true);
    expect(client.editorCatalog().every((row) => row.allowed)).toBe(true);
    // Nothing to count, so nothing to run out of.
    expect(client.featureState('ai.patch_review').remaining).toBeNull();
  });

  it("is the gallery's answer, not the browser's claim", async () => {
    // The client cannot promote itself: with the gallery unreachable it falls
    // back to free, exactly as it does for every other tier. What makes an
    // admin an admin is a payload the gallery sent and a grant it signed.
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const client = new EntitlementsClient({ fetch: fetchImpl });

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await client.load();

    expect(client.tier).toBe('free');
    expect(client.can('ai.creative_director')).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('the AI panel on an admin account', () => {
  let panel;

  beforeEach(() => {
    localStorage.clear();
    delete window.graph;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => adminPayload(),
    });
    panel = new AIPanel();
  });

  afterEach(() => {
    panel.hide();
    vi.restoreAllMocks();
  });

  it('says Admin, and says nothing is metered', async () => {
    await panel.show();

    const badge = panel.dock.querySelector('#ai-panel-tier');
    expect(badge.textContent).toBe('Admin');
    expect(badge.className).toContain('tier-admin');
    expect(badge.title).toContain('operator');

    const body = panel.dock.querySelector('#ai-panel-body');
    expect(body.textContent).toContain('Nothing is metered on the admin tier');
    // No allowance to have run out of, and nothing to upgrade to.
    expect(body.textContent).not.toContain('Actions left today');
    expect(body.textContent).not.toContain('Upgrade to');
    // An admin is signed in by definition; the sign-in prompt is for other people.
    expect(body.textContent).not.toContain('You are signed out');
  });
});
