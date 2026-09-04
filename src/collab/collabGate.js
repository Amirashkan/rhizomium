/**
 * collabGate.js — the `collab.space` gate.
 *
 * The collab space is a Cloude entitlement: the free tier and signed-out
 * visitors keep the single-artist canvas they already have, paid accounts can
 * open that canvas to other people. This module is the one place that decides
 * which.
 *
 * ## This one fails closed
 *
 * It follows viewerGate.js rather than outputGating.js, for the same reason
 * viewerGate does. A collab session only exists over the network: it has to
 * reach a room relay, and every other participant has to reach it too. A failed
 * entitlements lookup here therefore means the network is down or the visitor
 * is not signed in — both of which are exactly the cases the gate is for, and
 * neither of which leaves a paying artist stranded in front of an audience the
 * way a dark second screen would. So: not knowing means falling back to free.
 *
 * Nothing here is a security boundary. The browser can lie about its tier, and
 * a determined visitor with devtools can call CollabSession directly. The
 * enforceable boundary is the room relay, which is the one thing that can
 * actually refuse to carry someone's edits — see docs/collab-space.md for what
 * it checks today and what it cannot check yet.
 *
 * ## The unpublished-key case, which is not an upsell
 *
 * `src/ai/tiers.js` is a mirror of the gallery's `lib/tiers.ts`, and
 * `entitlements.can()` reads the live `features` array rather than computing
 * from the tier — so until the gallery publishes `collab.space`, a paying
 * Cloude subscriber gets a `false` here. Telling that subscriber to upgrade
 * would be a lie about their plan and an upsell for something they already
 * bought, so this gate detects the case (a live payload whose catalogue has
 * never heard of the key) and reports it as `feature_unpublished` with no
 * remedy to sell. See docs/internal/AI_TIER_INTEGRATION.md §6.
 */

import { entitlements } from '../ai/entitlements.js';
import { FEATURES, TIER_LABELS } from '../ai/tiers.js';

export const COLLAB_FEATURE = 'collab.space';

/**
 * True when the live payload does not carry this feature key at all — neither
 * as something granted nor as something locked in the catalogue.
 *
 * A degraded payload is excluded: the fallback is built from the *vendored*
 * catalogue, so the key is always present there and its absence would say
 * nothing about the gallery.
 */
function unpublished(state) {
  if (state.degraded) return false;
  if (Array.isArray(state.features) && state.features.includes(COLLAB_FEATURE)) return false;
  const catalog = state.catalog;
  if (!Array.isArray(catalog) || catalog.length === 0) return false;
  return !catalog.some((row) => row?.feature === COLLAB_FEATURE);
}

/**
 * Decide whether this visitor may open or join a collab session.
 *
 * Reads whatever `entitlements` last loaded; call `entitlements.load()` first
 * (or use `resolveCollabAccess`) so the answer is the live one rather than the
 * not-loaded fallback.
 *
 * @returns {{
 *   allowed: boolean,
 *   reason: 'allowed'|'tier_required'|'entitlements_unavailable'|'feature_unpublished',
 *   remedy: 'none'|'sign_in'|'upgrade'|'retry',
 *   requiredTier: string,
 *   requiredTierLabel: string,
 *   tier: string,
 *   tierLabel: string,
 *   authenticated: boolean,
 *   upgradeUrl: string,
 * }}
 */
export function checkCollabSpace() {
  const definition = FEATURES[COLLAB_FEATURE];
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
    // No live answer. Refuse, but as a lookup failure rather than as a verdict
    // on this visitor's plan — telling a subscriber to upgrade because their
    // wifi dropped is a worse lie than "try again".
    return { ...answer, reason: 'entitlements_unavailable', remedy: 'retry' };
  }

  if (entitlements.can(COLLAB_FEATURE)) {
    return { ...answer, allowed: true, reason: 'allowed', remedy: 'none' };
  }

  if (unpublished(state)) {
    return { ...answer, reason: 'feature_unpublished', remedy: 'none' };
  }

  // A signed-out visitor may already be paying — they just are not signed in
  // here. Point them at the door before the till.
  return { ...answer, remedy: state.authenticated ? 'upgrade' : 'sign_in' };
}

/** Load the live entitlements, then decide. */
export async function resolveCollabAccess({ force = false } = {}) {
  try {
    await entitlements.load({ force });
  } catch {
    // load() resolves with the degraded fallback rather than throwing, but the
    // panel should never be lost to an entitlements failure either way.
  }
  return checkCollabSpace();
}

/** One line explaining a refusal, in the artist's terms. */
export function refusalMessage(check) {
  const label = FEATURES[COLLAB_FEATURE]?.label || 'The collab space';

  if (check.reason === 'entitlements_unavailable') {
    return `${label} could not check your plan just now.`;
  }
  if (check.reason === 'feature_unpublished') {
    return `${label} is not switched on for accounts yet. Nothing to buy — it is coming.`;
  }
  if (check.remedy === 'sign_in') {
    return `${label} is part of ${check.requiredTierLabel}. Sign in to the gallery to use it.`;
  }
  return `${label} is part of ${check.requiredTierLabel}. Your plan is ${check.tierLabel}.`;
}
