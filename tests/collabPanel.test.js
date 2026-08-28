// What the collab panel puts in front of an artist, per plan.
//
// The panel is drawn even when the feature is locked — hiding a paid feature
// means nobody ever finds out it exists — so what matters is that each refusal
// offers the RIGHT thing. Selling an upgrade to someone whose wifi dropped, or
// to a subscriber whose gallery has not switched the feature on, is worse than
// showing nothing at all.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { entitlements } from '../src/ai/entitlements.js';
import { CollabPanel } from '../src/ui/CollabPanel.js';

const COLLAB = 'collab.space';

const BASE = {
  authenticated: true,
  userId: 'u-1',
  tier: 'cloude',
  tierLabel: 'Cloude',
  features: ['ai.patch_review', COLLAB],
  catalog: [{ feature: 'ai.patch_review', surface: 'editor' }, { feature: COLLAB, surface: 'collab' }],
  upgradeUrl: 'https://art.tenderworld.org/pricing',
  degraded: false,
};

async function openWith(payload) {
  entitlements.entitlements = payload;
  // The panel refreshes entitlements when it opens; these tests are about what
  // it draws for a given answer, not about fetching one.
  vi.spyOn(entitlements, 'load').mockResolvedValue(payload);
  const panel = new CollabPanel();
  await panel.toggle();
  return panel;
}

describe('the collab panel', () => {
  let original;

  beforeEach(() => {
    original = entitlements.entitlements;
    document.body.replaceChildren();
  });

  afterEach(() => {
    entitlements.entitlements = original;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('offers the join form to a Cloude account', async () => {
    const panel = await openWith(BASE);
    const text = panel.body.textContent;
    expect(panel.body.querySelectorAll('input')).toHaveLength(3);
    expect(text).toMatch(/join room/i);
    // The destructive part is stated before anyone clicks, not after.
    expect(text).toMatch(/replaces your open canvas/i);
  });

  it('offers a free account the upgrade, and no join form', async () => {
    const panel = await openWith({ ...BASE, tier: 'free', tierLabel: 'Free', features: ['ai.patch_review'] });
    expect(panel.body.querySelectorAll('input')).toHaveLength(0);
    expect(panel.body.textContent).toMatch(/what cloude includes/i);
  });

  it('offers a signed-out visitor the sign-in, not the till', async () => {
    const panel = await openWith({
      ...BASE, authenticated: false, userId: null, tier: 'free', tierLabel: 'Free', features: [],
    });
    expect(panel.body.textContent).toMatch(/sign in to the gallery/i);
    expect(panel.body.textContent).not.toMatch(/what cloude includes/i);
  });

  it('offers a retry, not an upgrade, when the plan could not be checked', async () => {
    const panel = await openWith({ ...BASE, degraded: true });
    expect(panel.body.textContent).toMatch(/check again/i);
    expect(panel.body.textContent).not.toMatch(/includes|sign in/i);
  });

  it('sells nothing when the gallery has not published the feature', async () => {
    const panel = await openWith({
      ...BASE,
      features: ['ai.patch_review'],
      catalog: [{ feature: 'ai.patch_review', surface: 'editor' }],
    });
    expect(panel.body.textContent).toMatch(/nothing to buy/i);
    expect(panel.body.querySelector('.rz-collab-link')).toBeNull();
  });
});
