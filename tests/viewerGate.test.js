// The web viewer's gate: who gets to run a published patch.
//
// `viewer.web` is a Cloude entitlement, so the free tier and signed-out
// visitors are refused — and refused with the right remedy, because "sign in"
// and "upgrade" are not the same sentence and only one of them costs money.
//
// The case worth pinning hardest is the degraded one. outputGating.js allows
// when the gallery cannot be reached, deliberately; this gate refuses, equally
// deliberately (see the note at the top of viewerGate.js). A change that made
// them agree would be a silent giveaway of a paid feature, so the two
// directions are asserted here against each other.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { entitlements } from '../src/ai/entitlements.js';
import { checkWebViewer, refusalMessage, VIEWER_FEATURE } from '../src/viewer/viewerGate.js';
import { checkOutputFeature } from '../src/ai/outputGating.js';
import { FEATURES } from '../src/ai/tiers.js';

function setEntitlements(payload) {
  entitlements.entitlements = payload;
}

const PAID = {
  authenticated: true,
  userId: 'u-1',
  tier: 'cloude',
  tierLabel: 'Cloude',
  features: ['ai.patch_review', 'viewer.web'],
  catalog: [],
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

describe('viewer.web is a paid feature', () => {
  let originalEntitlements;

  beforeEach(() => {
    originalEntitlements = entitlements.entitlements;
  });

  afterEach(() => {
    entitlements.entitlements = originalEntitlements;
    vi.restoreAllMocks();
  });

  it('is catalogued as a Cloude feature, not a free one', () => {
    expect(FEATURES[VIEWER_FEATURE].tier).toBe('cloude');
    expect(FEATURES[VIEWER_FEATURE].metered).toBe(false);
  });

  it('lets a Cloude account through', () => {
    setEntitlements(PAID);
    const check = checkWebViewer();
    expect(check.allowed).toBe(true);
    expect(check.reason).toBe('allowed');
    expect(check.remedy).toBe('none');
  });

  it('refuses the free tier and points at the upgrade', () => {
    setEntitlements(FREE_SIGNED_IN);
    const check = checkWebViewer();
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('tier_required');
    expect(check.remedy).toBe('upgrade');
    expect(check.requiredTierLabel).toBe('Cloude');
    expect(check.upgradeUrl).toBe('https://art.tenderworld.org/pricing');
  });

  it('asks a signed-out visitor to sign in before it asks them to pay', () => {
    setEntitlements(FREE_SIGNED_OUT);
    const check = checkWebViewer();
    expect(check.allowed).toBe(false);
    expect(check.remedy).toBe('sign_in');
    expect(refusalMessage(check)).toMatch(/sign in/i);
  });

  it('honours a per-account override in the live features list', () => {
    // The gallery can grant a feature to an account below its tier; the client
    // reads the list rather than recomputing from the tier for exactly this.
    setEntitlements({ ...FREE_SIGNED_IN, features: ['viewer.web'] });
    expect(checkWebViewer().allowed).toBe(true);
  });
});

describe('when the gallery cannot be reached', () => {
  let originalEntitlements;

  beforeEach(() => {
    originalEntitlements = entitlements.entitlements;
    setEntitlements({ ...FREE_SIGNED_OUT, degraded: true, degradedReason: 'network' });
  });

  afterEach(() => {
    entitlements.entitlements = originalEntitlements;
  });

  it('refuses, rather than guessing in the visitor’s favour', () => {
    const check = checkWebViewer();
    expect(check.allowed).toBe(false);
    expect(check.reason).toBe('entitlements_unavailable');
  });

  it('offers a retry rather than telling a subscriber to upgrade', () => {
    const check = checkWebViewer();
    expect(check.remedy).toBe('retry');
    expect(refusalMessage(check)).not.toMatch(/upgrade|plan is/i);
  });

  it('still allows the live-output features, which fail the other way', () => {
    // The asymmetry is the point: a projector at a show must not go dark
    // because the venue has no wifi, while a web page has no such excuse.
    expect(checkOutputFeature('output.multiscreen').allowed).toBe(true);
    expect(checkWebViewer().allowed).toBe(false);
  });
});
