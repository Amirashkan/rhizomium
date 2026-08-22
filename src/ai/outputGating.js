/**
 * outputGating.js - the gate for the unmetered Cloude Plus output features.
 *
 * `output.ndi` and `output.multiscreen` are flags, not metered calls: there is
 * no quota and no grant to ask for, so a check against the live entitlements
 * is the whole gate. Nothing here is a security boundary — these features run
 * entirely on the artist's own machine, so the check is a licence check, not
 * a lock.
 *
 * ## Why a failed lookup allows rather than refuses
 *
 * Everywhere else in this integration, not knowing means falling back to the
 * free tier — wrong in the safe direction, because guessing wrong the other
 * way gives away paid model calls. These two features are the exception, and
 * deliberately so:
 *
 *   - They cost the operator nothing. No model call, no server render.
 *   - They are used live. Multi-screen output drives the projector at a show,
 *     and the desktop build runs in venues with no network at all.
 *
 * So the two failure modes are not symmetric. Allowing wrongly means someone
 * sees a feature they have not paid for, offline, until the network returns.
 * Refusing wrongly means a paying artist's second screen goes dark in front of
 * an audience. Only a confident, live "no" refuses here.
 */

import { entitlements } from './entitlements.js';
import { FEATURES, TIER_LABELS } from './tiers.js';

/**
 * Whether to let an unmetered output feature run.
 *
 * @param {string} feature - 'output.ndi' or 'output.multiscreen'.
 * @returns {{allowed: boolean, reason: string, requiredTier: string, requiredTierLabel: string, upgradeUrl: string}}
 */
export function checkOutputFeature(feature) {
  const definition = FEATURES[feature];
  const required = definition?.tier || 'cloude_plus';
  const answer = {
    allowed: true,
    reason: 'allowed',
    requiredTier: required,
    requiredTierLabel: TIER_LABELS[required] || required,
    upgradeUrl: entitlements.upgradeUrl,
  };

  const state = entitlements.current;

  // No live answer — see the note above. Allow, and say why in the reason so a
  // caller that wants to log it can.
  if (state.degraded) {
    return { ...answer, reason: 'entitlements_unavailable' };
  }

  if (entitlements.can(feature)) return answer;

  return { ...answer, allowed: false, reason: 'tier_required' };
}

/**
 * Gate an action, showing an upsell when it is refused.
 *
 * @returns {boolean} true when the caller should go ahead.
 */
export function requireOutputFeature(feature, { onRefused } = {}) {
  const check = checkOutputFeature(feature);
  if (check.allowed) return true;

  const label = FEATURES[feature]?.label || feature;
  onRefused?.(
    `${label} needs ${check.requiredTierLabel}.`,
    check
  );
  return false;
}
