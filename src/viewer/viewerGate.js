/**
 * viewerGate.js — the `viewer.web` gate.
 *
 * The web patch viewer is a Cloude entitlement: free accounts and signed-out
 * visitors get the rendered still the gallery already shows them, paid accounts
 * get the patch running live. This module is the one place that decides which.
 *
 * ## Why this one fails closed, when outputGating.js fails open
 *
 * Both gate unmetered flags, and both are licence checks rather than security
 * boundaries — the patch itself is public, and a determined visitor with
 * devtools can run this page's code however they like. What differs is the cost
 * of guessing wrong when the gallery cannot be reached:
 *
 *   - `output.ndi` / `output.multiscreen` drive a projector at a live show,
 *     from a desktop build that runs in venues with no network. Refusing
 *     wrongly means a paying artist's second screen goes dark in front of an
 *     audience, so those allow on a failed lookup (see outputGating.js).
 *   - The web viewer is a *web* surface. It only exists at a URL, it has just
 *     fetched (or is about to fetch) a patch over the network, and nobody is on
 *     stage waiting for it. A failed entitlements call here means the network
 *     is down or the visitor is not signed in — both of which are exactly the
 *     cases the gate is for.
 *
 * So this one takes the rule that holds everywhere else in the integration: not
 * knowing means falling back to the free tier. The refusal says which of the
 * two it is, because "sign in" and "upgrade" are different remedies and only
 * one of them costs money.
 */

import { entitlements } from '../ai/entitlements.js';
import { FEATURES, TIER_LABELS } from '../ai/tiers.js';

export const VIEWER_FEATURE = 'viewer.web';

/**
 * Decide whether to run a patch for this visitor.
 *
 * Reads whatever `entitlements` last loaded; call `entitlements.load()` first
 * so the answer is the live one rather than the not-loaded fallback.
 *
 * @returns {{
 *   allowed: boolean,
 *   reason: 'allowed'|'tier_required'|'entitlements_unavailable',
 *   remedy: 'none'|'sign_in'|'upgrade'|'retry',
 *   requiredTier: string,
 *   requiredTierLabel: string,
 *   tier: string,
 *   tierLabel: string,
 *   authenticated: boolean,
 *   upgradeUrl: string,
 * }}
 */
export function checkWebViewer() {
  const definition = FEATURES[VIEWER_FEATURE];
  const required = definition?.tier || 'cloude';
  const state = entitlements.current;

  const answer = {
    allowed: false,
    reason: 'tier_required',
    remedy: 'upgrade',
    requiredTier: required,
    requiredTierLabel: TIER_LABELS[required] || required,
    tier: state.tier,
    tierLabel: state.tierLabel || TIER_LABELS[state.tier] || TIER_LABELS.free,
    authenticated: Boolean(state.authenticated),
    upgradeUrl: entitlements.upgradeUrl,
  };

  if (state.degraded) {
    // No live answer. Refuse, and say so as a lookup failure rather than as a
    // verdict on the visitor's plan — telling a paying subscriber they need to
    // upgrade because their wifi dropped is a worse lie than "try again".
    return { ...answer, reason: 'entitlements_unavailable', remedy: 'retry' };
  }

  if (entitlements.can(VIEWER_FEATURE)) {
    return { ...answer, allowed: true, reason: 'allowed', remedy: 'none' };
  }

  // A signed-out visitor may already be paying — they just are not signed in
  // here. Point them at the door before the till.
  return { ...answer, remedy: state.authenticated ? 'upgrade' : 'sign_in' };
}

/** Load the live entitlements, then decide. */
export async function resolveWebViewerAccess({ force = false } = {}) {
  try {
    await entitlements.load({ force });
  } catch {
    // load() resolves with the degraded fallback rather than throwing, but a
    // caller should never lose the page to an entitlements failure either way.
  }
  return checkWebViewer();
}

/** One line explaining a refusal, in the visitor's terms. */
export function refusalMessage(check) {
  const label = FEATURES[VIEWER_FEATURE]?.label || 'The web viewer';

  if (check.reason === 'entitlements_unavailable') {
    return `${label} could not check your plan just now.`;
  }
  if (check.remedy === 'sign_in') {
    return `${label} is part of ${check.requiredTierLabel}. Sign in to the gallery to use it.`;
  }
  return `${label} is part of ${check.requiredTierLabel}. Your plan is ${check.tierLabel}.`;
}
