// The collab space's gate: who gets to open a canvas to other people.
//
// `collab.space` is a Cloude entitlement, so the free tier and signed-out
// visitors are refused — and refused with the right remedy, because "sign in",
// "upgrade" and "nothing to buy yet" are three different sentences and only one
// of them costs money.
//
// Two directions are pinned here on purpose:
//
//   - Degraded refuses. outputGating.js allows when the gallery cannot be
//     reached, deliberately (a dark second screen at a live show); this gate
//     refuses, equally deliberately. A change that made them agree would be a
//     silent giveaway, so they are asserted against each other.
//   - An unpublished feature key is not an upsell. src/ai/tiers.js is a mirror
//     of the gallery's catalogue, so a paying subscriber sees `false` here
//     until the gallery ships the key. Telling them to upgrade would be a lie
//     about a plan they already bought.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { entitlements } from '../src/ai/entitlements.js';
import { checkCollabSpace, refusalMessage, COLLAB_FEATURE } from '../src/collab/collabGate.js';
import { checkOutputFeature } from '../src/ai/outputGating.js';
import { FEATURES } from '../src/ai/tiers.js';

const CATALOG = [
  { feature: 'ai.patch_review', surface: 'editor' },
  { feature: COLLAB_FEATURE, surface: 'collab' },
];

const PAID = {
  authenticated: true,
  userId: 'u-1',
  tier: 'cloude',
  tierLabel: 'Cloude',
  features: ['ai.patch_review', COLLAB_FEATURE],
  catalog: CATALOG,
  upgradeUrl: 'https://art.tenderworld.org/pricing',
  degraded: false,
};

const FREE_SIGNED_IN = {
  ...PAID,
  tier: 'free',
  tierLabel: 'Free',
  features: ['ai.patch_review'],
};

const FREE_SIGNED_OUT = { ...FREE_SIGNED_IN, authenticated: false, userId: null };

describe('collab.space is a paid feature', () => {
  let original;

  beforeEach(() => {
    original = entitlements.entitlements;
  });

  afterEach(() => {
    entitlements.entitlements = original;
    vi.restoreAllMocks();
  });

  it('is catalogued as an unmetered Cloude feature on its own surface', () => {
    expect(FEATURES[COLLAB_FEATURE].tier).toBe('cloude');
    expect(FEATURES[COLLAB_FEATURE].metered).toBe(false);
    // Not 'editor': the editor surface is what the AI panel draws cards from,
    // and the collab space is not an AI action.
    expect(FEATURES[COLLAB_FEATURE].surface).toBe('collab');
  });

  it('lets a Cloude account in', () => {
    entitlements.entitlements = PAID;
    const check = checkCollabSpace();
    expect(check.allowed).toBe(true);
    expect(check.reason).toBe('allowed');
    expect(check.remedy).toBe('none');
  });

  it('refuses a signed-in free account with an upgrade', () => {
    entitlements.entitlements = FREE_SIGNED_IN;
    const check = checkCollabSpace();
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('tier_required');
    expect(check.remedy).toBe('upgrade');
    expect(refusalMessage(check)).toContain('Cloude');
  });

  it('tells a signed-out visitor to sign in, not to pay', () => {
    entitlements.entitlements = FREE_SIGNED_OUT;
    const check = checkCollabSpace();
    expect(check.remedy).toBe('sign_in');
    expect(refusalMessage(check)).toMatch(/sign in/i);
  });

  it('refuses when the gallery cannot be reached, and says so as a lookup failure', () => {
    entitlements.entitlements = { ...PAID, degraded: true };
    const check = checkCollabSpace();
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('entitlements_unavailable');
    expect(check.remedy).toBe('retry');
    expect(refusalMessage(check)).not.toMatch(/upgrade|your plan is/i);
  });

  it('fails closed where the output flags fail open', () => {
    entitlements.entitlements = { ...PAID, degraded: true };
    // Same degraded payload, opposite verdicts. This is the trade documented in
    // both gates; if it ever stops holding, one of them changed by accident.
    expect(checkCollabSpace().allowed).toBe(false);
    expect(checkOutputFeature('output.multiscreen').allowed).toBe(true);
  });

  it('reports an unpublished key as unpublished rather than as an upsell', () => {
    entitlements.entitlements = {
      ...PAID,
      features: ['ai.patch_review'],
      catalog: [{ feature: 'ai.patch_review', surface: 'editor' }],
    };
    const check = checkCollabSpace();
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('feature_unpublished');
    expect(check.remedy).toBe('none');
    expect(refusalMessage(check)).toMatch(/nothing to buy/i);
  });

  it('does not mistake a degraded payload for an unpublished feature', () => {
    // The degraded fallback is built from the vendored catalogue, so the key is
    // always there — its absence would say nothing about the gallery.
    entitlements.entitlements = { ...FREE_SIGNED_IN, degraded: true, catalog: [] };
    expect(checkCollabSpace().reason).toBe('entitlements_unavailable');
  });
});
