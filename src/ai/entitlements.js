/**
 * entitlements.js - what the current visitor is allowed to do, and permission
 * to spend one paid action.
 *
 * The gallery (art.tenderworld.org) holds the accounts and is the authority on
 * tiers. This module is the client half of that contract:
 *
 *   - `load()`   GET /api/entitlements — cached for the session, re-fetched on
 *                sign-in and sign-out. Drives what the UI draws.
 *   - `requestGrant()`  POST /api/entitlements/grant — called immediately
 *                before a paid action, never on load. Spends quota and returns
 *                a short-lived signed token for the AI backend.
 *
 * Nothing here is a security boundary. The browser can lie about its tier and
 * the buttons it draws; the gate is the gallery signing a grant and the AI
 * backend refusing to call a model without one that verifies. See
 * AI_TIER_INTEGRATION.md §Security.
 */

import { desktopAuthHeaders, clearDesktopToken, getDesktopToken } from './desktopToken.js';
import {
  FEATURES,
  FEATURE_KEYS,
  TIER_LABELS,
  hasFeature,
  quotaFor,
  requiredTier,
} from './tiers.js';

export const GALLERY_ORIGIN = 'https://art.tenderworld.org';

/** Where to send someone whose tier is too low. Overridden by the live payload. */
const DEFAULT_UPGRADE_URL = `${GALLERY_ORIGIN}/pricing`;

/**
 * A grant request that the gallery answered with something other than "yes".
 *
 * `code` is the gallery's own machine-readable reason, so callers can tell an
 * upsell (402 `tier_required`) from an exhausted allowance (429
 * `quota_exceeded`) from an operator problem (503) without parsing prose.
 * Showing one "something went wrong" for all three is the thing to avoid.
 */
export class GrantError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'GrantError';
    this.code = details.code || 'grant_failed';
    this.status = details.status ?? 0;
    this.feature = details.feature || null;
    this.tier = details.tier || null;
    this.tierLabel = details.tierLabel || null;
    this.requiredTier = details.requiredTier || null;
    this.requiredTierLabel = details.requiredTierLabel || null;
    this.resetsAt = details.resetsAt || null;
    this.used = details.used ?? null;
    this.limit = details.limit ?? null;
    this.upgradeUrl = details.upgradeUrl || DEFAULT_UPGRADE_URL;
    this.authenticated = details.authenticated ?? null;
  }

  /**
   * True when the remedy is signing in rather than paying: a signed-out
   * visitor gets a third of the free allowance, so the honest prompt on their
   * 429 is "sign in", which is free and raises it.
   */
  get remedyIsSignIn() {
    return this.code === 'quota_exceeded' && this.authenticated === false;
  }
}

/**
 * The entitlements we assume when the gallery cannot be reached.
 *
 * Free tier, signed out, every metered free feature listed with its vendored
 * allowance. Wrong in the safe direction: it shows an artist less than they
 * may be owed rather than handing out paid features, and the grant call is
 * still what decides — this only shapes the UI.
 */
function fallbackEntitlements(reason) {
  return {
    authenticated: false,
    userId: null,
    tier: 'free',
    tierLabel: TIER_LABELS.free,
    tierExpiresAt: null,
    features: FEATURE_KEYS.filter((key) => hasFeature('free', key)),
    catalog: FEATURE_KEYS.map((feature) => {
      const def = FEATURES[feature];
      const allowed = hasFeature('free', feature);
      return {
        feature,
        label: def.label,
        surface: def.surface,
        allowed,
        requiredTier: def.tier,
        quota: allowed ? quotaFor('free', feature) : null,
      };
    }),
    upgradeUrl: DEFAULT_UPGRADE_URL,
    // Not part of the gallery's payload — our own marker that these numbers
    // are assumed rather than read, so the UI can say so.
    degraded: true,
    degradedReason: reason || 'unreachable',
  };
}

export class EntitlementsClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || GALLERY_ORIGIN;
    this.fetchImpl = options.fetch || ((...args) => globalThis.fetch(...args));
    /** Resolved payload, or the fallback. Never null after the first load(). */
    this.entitlements = null;
    /** In-flight load, so N callers on boot make one request. */
    this.pending = null;
    this.listeners = new Set();
  }

  /** Subscribe to entitlement changes. Returns an unsubscribe function. */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitChange() {
    for (const listener of this.listeners) {
      try {
        listener(this.current);
      } catch (error) {
        console.warn('Entitlements listener failed:', error);
      }
    }
  }

  /**
   * The entitlements as last read. Falls back to free rather than returning
   * null, so callers never have to branch on "not loaded yet" to draw.
   */
  get current() {
    return this.entitlements || fallbackEntitlements('not_loaded');
  }

  get tier() {
    return this.current.tier;
  }

  get authenticated() {
    return Boolean(this.current.authenticated);
  }

  get upgradeUrl() {
    return this.current.upgradeUrl || DEFAULT_UPGRADE_URL;
  }

  /**
   * GET /api/entitlements, cached for the session.
   *
   * Answers for signed-out visitors too — the gallery never 401s here — so a
   * non-OK response means the gallery is unhappy, not that the visitor is
   * anonymous.
   */
  async load({ force = false } = {}) {
    if (!force && this.entitlements && !this.entitlements.degraded) {
      return this.entitlements;
    }
    if (!force && this.pending) return this.pending;

    this.pending = this.fetchEntitlements()
      .then((payload) => {
        this.entitlements = payload;
        this.emitChange();
        return payload;
      })
      .finally(() => {
        this.pending = null;
      });

    return this.pending;
  }

  async fetchEntitlements() {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/entitlements`, {
        method: 'GET',
        // The cookie carries the web session. The header carries the desktop
        // one, and is absent everywhere else — see desktopToken.js.
        credentials: 'include',
        headers: { Accept: 'application/json', ...desktopAuthHeaders() },
      });

      if (!res.ok) {
        console.warn(`Entitlements unavailable (${res.status}); assuming free tier.`);
        return fallbackEntitlements(`http_${res.status}`);
      }

      const payload = await res.json();
      const normalized = normalizeEntitlements(payload);

      // A desktop token the gallery no longer honours — revoked, or issued by
      // a deployment that has since been reset — comes back as a perfectly
      // ordinary anonymous answer, because the endpoint never 401s. Left
      // alone, the app would hold a dead credential and offer to "re-check"
      // forever. Drop it, so the next thing the artist does is offered a real
      // sign-in instead.
      if (getDesktopToken() && !normalized.authenticated) {
        console.warn('The stored desktop sign-in is no longer valid; forgetting it.');
        clearDesktopToken();
      }

      return normalized;
    } catch (error) {
      // Offline, CORS, or the editor running somewhere the gallery does not
      // trust. All three mean the same thing here: draw the free tier.
      console.warn('Entitlements request failed; assuming free tier.', error);
      return fallbackEntitlements('network');
    }
  }

  /** Re-read after a sign-in, a sign-out, or a return from the upgrade page. */
  async refresh() {
    return this.load({ force: true });
  }

  /** The catalog row for a feature, from the live payload when there is one. */
  featureState(feature) {
    const row = this.current.catalog?.find((entry) => entry.feature === feature);
    if (row) {
      const remaining =
        row.quota && typeof row.used === 'number'
          ? Math.max(0, row.quota.limit - row.used)
          : null;
      return { ...row, remaining };
    }

    // A feature the gallery did not mention — it is newer there than here, or
    // older here than there. Fall back to the vendored catalogue.
    const def = FEATURES[feature];
    if (!def) return null;
    return {
      feature,
      label: def.label,
      surface: def.surface,
      allowed: hasFeature(this.tier, feature),
      requiredTier: def.tier,
      quota: null,
      remaining: null,
    };
  }

  /**
   * Whether to draw this feature as available. Deliberately reads the live
   * `features` list rather than computing from the tier, so a per-account
   * override on the gallery is honoured here too.
   */
  can(feature) {
    const features = this.current.features;
    if (Array.isArray(features)) return features.includes(feature);
    return hasFeature(this.tier, feature);
  }

  /** The editor-surface catalog rows, for the AI panel. */
  editorCatalog() {
    return (this.current.catalog || []).filter((row) => row.surface === 'editor');
  }

  /**
   * POST /api/entitlements/grant — ask permission for one paid action and
   * spend the quota for it.
   *
   * Call this immediately before the action, never on load: a grant costs
   * quota and expires five minutes out. Resolves with the grant payload, or
   * throws a GrantError carrying the gallery's reason.
   */
  async requestGrant(feature) {
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/entitlements/grant`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...desktopAuthHeaders(),
        },
        body: JSON.stringify({ feature }),
      });
    } catch {
      throw new GrantError(
        'Could not reach the gallery to check your allowance. Check your connection and try again.',
        { code: 'network', feature, authenticated: this.authenticated }
      );
    }

    let body = {};
    try {
      body = await res.json();
    } catch {
      // Some proxies return an empty body on an error status; the status is
      // still the useful part.
    }

    if (res.ok && body.granted && body.grant) {
      // The counters just moved. Fold the gallery's own numbers back into the
      // cached catalog so the panel's "N left" is right without another GET.
      this.applyUsage(feature, body);
      return body;
    }

    throw new GrantError(body.error || grantFallbackMessage(res.status, feature), {
      code: body.code || codeForStatus(res.status),
      status: res.status,
      feature: body.feature || feature,
      tier: body.tier || this.tier,
      tierLabel: body.tierLabel || null,
      requiredTier: body.requiredTier || requiredTier(feature),
      requiredTierLabel: body.requiredTierLabel || null,
      resetsAt: body.resetsAt || null,
      used: body.used ?? null,
      limit: body.limit ?? null,
      upgradeUrl: body.upgradeUrl || this.upgradeUrl,
      authenticated: this.authenticated,
    });
  }

  /** Fold a grant's usage numbers back into the cached catalog row. */
  applyUsage(feature, grant) {
    const catalog = this.entitlements?.catalog;
    if (!Array.isArray(catalog)) return;

    const row = catalog.find((entry) => entry.feature === feature);
    if (!row) return;

    if (typeof grant.used === 'number') row.used = grant.used;
    if (typeof grant.limit === 'number' && row.quota) row.quota.limit = grant.limit;
    if (grant.resetsAt) row.resetsAt = grant.resetsAt;
    this.emitChange();
  }
}

function codeForStatus(status) {
  if (status === 402) return 'tier_required';
  if (status === 429) return 'quota_exceeded';
  if (status === 503) return 'not_configured';
  if (status === 400) return 'bad_request';
  return 'grant_failed';
}

function grantFallbackMessage(status, feature) {
  const label = FEATURES[feature]?.label || feature;
  if (status === 402) return `${label} needs a higher plan.`;
  if (status === 429) return `You have used your ${label} allowance for now.`;
  if (status === 503) {
    return 'AI features are not configured on the gallery right now. This is an operator problem, not yours.';
  }
  return `${label} could not be started (${status}).`;
}

/**
 * Trust the gallery's payload but not its completeness: an older gallery, or a
 * proxy that mangles a field, should not crash the panel.
 */
function normalizeEntitlements(payload) {
  const tier = payload?.tier || 'free';
  return {
    authenticated: Boolean(payload?.authenticated),
    userId: payload?.userId ?? null,
    tier,
    tierLabel: payload?.tierLabel || TIER_LABELS[tier] || TIER_LABELS.free,
    tierExpiresAt: payload?.tierExpiresAt ?? null,
    features: Array.isArray(payload?.features) ? payload.features : [],
    catalog: Array.isArray(payload?.catalog) ? payload.catalog : [],
    upgradeUrl: payload?.upgradeUrl || DEFAULT_UPGRADE_URL,
    degraded: false,
  };
}

/** The editor uses one client for the whole session. */
export const entitlements = new EntitlementsClient();
