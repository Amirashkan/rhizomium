/**
 * debugMode.js - the developer switch that takes the tier system out of the
 * way while the AI features are being worked on.
 *
 * Every AI action in the editor costs an allowance: `requestGrant()` spends
 * quota before the call and the backend refuses without the grant it returns.
 * That is right for artists and wrong for whoever is testing the features —
 * two patch reviews a day is not a debugging loop, and a signed-out dev server
 * gets less than that.
 *
 * Debug mode short-circuits the editor's half of that contract:
 *
 *   - every editor feature draws as available, on a Studio tier,
 *   - `requestGrant()` answers locally instead of calling the gallery, so
 *     nothing is spent and there is no 402 or 429 to hit,
 *   - the grant it hands back is the sentinel token `debug:<feature>`.
 *
 * What it does NOT do is make the backend accept that token. `/api/ai/run`
 * takes debug grants only when the operator sets `AI_DEBUG_MODE` on the
 * deployment (api/_lib/grant.js), which is off everywhere by default and
 * refused outright in production unless a second variable says otherwise. The
 * gate is still the gate: a browser turning this on against the real backend
 * gets a 401, exactly as it would with any other unsigned token.
 *
 * It is also not free. A debug run is a real model call on somebody's API key
 * — it skips the accounting, not the bill.
 *
 * Turning it on:
 *
 *   - open the editor with `?aidebug=1` (remembered afterwards; `?aidebug=0`
 *     forgets it again), or
 *   - `aiDebugMode.on()` in the console, `aiDebugMode.off()`, `.status()`.
 */

import { FEATURES, FEATURE_KEYS, TIER_LABELS } from './tiers.js';

/** Where the switch is remembered between reloads. */
export const AI_DEBUG_STORAGE_KEY = 'glsl-node-editor.ai.debug-mode';

/** The query parameter that flips it, so a bookmark can carry the mode. */
export const AI_DEBUG_QUERY_PARAM = 'aidebug';

/**
 * The grant token debug mode issues, in place of the gallery's signed one.
 *
 * The feature travels *inside* the token rather than being read from the
 * request body, so the backend keeps its one real invariant — what runs is
 * decided by the grant — even on this path. `api/_lib/grant.js` has the
 * matching constant, and tests/aiDebugMode.test.js fails if the two drift.
 */
export const DEBUG_GRANT_PREFIX = 'debug:';

/** The tier debug mode reports. The highest one, so nothing draws as locked. */
const DEBUG_TIER = 'cloude_plus';

/**
 * The in-session answer, once something has set it explicitly. `null` means
 * "not set here", and the URL and storage decide instead.
 */
let override = null;

const listeners = new Set();

function readStored() {
  try {
    return globalThis.localStorage?.getItem(AI_DEBUG_STORAGE_KEY) === '1';
  } catch {
    // Private mode, a sandboxed frame, or storage switched off. Not on, then.
    return false;
  }
}

function persist(on) {
  try {
    if (on) globalThis.localStorage?.setItem(AI_DEBUG_STORAGE_KEY, '1');
    else globalThis.localStorage?.removeItem(AI_DEBUG_STORAGE_KEY);
  } catch {
    // Nothing to do about it; the session still has `override`.
  }
}

/** The query parameter, as a tri-state: on, off, or absent. */
function urlFlag() {
  const search = globalThis.location?.search;
  if (!search) return null;

  let value;
  try {
    value = new URLSearchParams(search).get(AI_DEBUG_QUERY_PARAM);
  } catch {
    return null;
  }
  if (value === null) return null;

  // `?aidebug` on its own is the natural way to write "on", and reads as an
  // empty value.
  if (value === '' || value === '1' || value === 'true' || value === 'on') return true;
  return false;
}

/**
 * Whether debug mode is on right now.
 *
 * Read at the moment of use rather than cached at import, so flipping it in
 * the console takes effect on the next render without a reload.
 */
export function isAIDebugMode() {
  if (override !== null) return override;

  const fromUrl = urlFlag();
  if (fromUrl !== null) {
    // A URL that says either thing is also an instruction about later loads:
    // an artist who lands on a link with it should not be stuck in the mode
    // once they navigate away, and a dev who set it should not have to keep
    // the parameter on every URL.
    override = fromUrl;
    persist(fromUrl);
    return fromUrl;
  }

  return readStored();
}

/** Turn it on or off for this session and remember the choice. */
export function setAIDebugMode(on) {
  const next = Boolean(on);
  override = next;
  persist(next);
  for (const listener of listeners) {
    try {
      listener(next);
    } catch (error) {
      console.warn('AI debug mode listener failed:', error);
    }
  }
  return next;
}

/** Subscribe to the switch moving. Returns an unsubscribe function. */
export function onAIDebugModeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: forget the session override and the stored flag. */
export function resetAIDebugMode() {
  override = null;
  persist(false);
}

/**
 * The grant `requestGrant()` returns instead of calling the gallery.
 *
 * Shaped like the gallery's answer — `granted`, `grant`, and the usage fields
 * the panel folds back into its catalog — so no caller has to know which of
 * the two it got. `used` and `limit` are null rather than numbers because
 * there is no allowance being counted, and the panel draws "unlimited" from
 * exactly that.
 */
export function debugGrant(feature) {
  return {
    granted: true,
    debug: true,
    grant: `${DEBUG_GRANT_PREFIX}${feature}`,
    feature,
    tier: DEBUG_TIER,
    tierLabel: TIER_LABELS[DEBUG_TIER],
    used: null,
    limit: null,
    resetsAt: null,
  };
}

/**
 * The entitlements payload debug mode reports: every feature allowed, nothing
 * metered, marked `debug` so the panel can say out loud that these numbers are
 * not an account's.
 */
export function debugEntitlements() {
  return {
    authenticated: false,
    userId: null,
    tier: DEBUG_TIER,
    tierLabel: TIER_LABELS[DEBUG_TIER],
    tierExpiresAt: null,
    features: [...FEATURE_KEYS],
    catalog: FEATURE_KEYS.map((feature) => {
      const def = FEATURES[feature];
      return {
        feature,
        label: def.label,
        surface: def.surface,
        allowed: true,
        requiredTier: def.tier,
        // No quota object at all: a metered feature with nothing left to count
        // is the one honest way to say "not being counted here".
        quota: null,
        used: null,
        resetsAt: null,
      };
    }),
    upgradeUrl: null,
    degraded: false,
    debug: true,
  };
}

// Reachable from devtools without importing anything, because that is where
// this switch gets used. Guarded so the module stays importable from Node,
// where api/_lib/tokenCost.js and the tests pull the AI stack in.
if (typeof globalThis.window !== 'undefined') {
  globalThis.window.aiDebugMode = {
    on: () => setAIDebugMode(true),
    off: () => setAIDebugMode(false),
    status: () => isAIDebugMode(),
  };
}
