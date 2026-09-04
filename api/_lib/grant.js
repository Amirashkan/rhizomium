/**
 * grant.js - verify a tier grant issued by the gallery.
 *
 * This is the security boundary. The editor is a browser app: anyone can open
 * devtools, set their tier to `cloude_plus` and watch every button light up.
 * That has to be worthless, and it is worthless precisely because a model call
 * is never made without a grant that verifies here.
 *
 * The gallery signs grants with TIER_GRANT_SECRET; this backend holds the same
 * value and checks the signature locally. There is a /api/entitlements/verify
 * route on the gallery, but it sits on the hot path of every AI request — the
 * token is an HMAC so that no round trip is needed.
 *
 * Format: `<base64url(payload)>.<base64url(hmac-sha256)>`. Deliberately not a
 * JWT — there is no algorithm field to confuse, and the only accepted
 * algorithm is the one compiled in here. Must stay byte-compatible with
 * signGrant() in the gallery's lib/entitlements.ts.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Reasons a token is refused, for logging. Never sent to the caller as-is. */
export const GRANT_INVALID = {
  MISSING_SECRET: 'missing_secret',
  MALFORMED: 'malformed',
  BAD_SIGNATURE: 'bad_signature',
  EXPIRED: 'expired',
};

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function grantsConfigured() {
  return Boolean(process.env.TIER_GRANT_SECRET);
}

/**
 * The debug grant: a token nobody signed, accepted only where an operator
 * deliberately said so.
 *
 * Testing an AI feature costs an allowance meant for artists — two patch
 * reviews a day on the free tier — and a dev machine usually has no gallery to
 * ask in the first place. `src/ai/debugMode.js` answers both locally and sends
 * `debug:<feature>` instead of a signed grant. This is the half that decides
 * whether that is worth anything, and by default it is worth nothing.
 *
 * Two switches, because the failure mode is not a bug but a stray environment
 * variable: `AI_DEBUG_MODE` turns it on at all, and a deployment that reports
 * itself as production refuses even then unless `AI_DEBUG_ALLOW_PRODUCTION` is
 * also set. Wrong in the safe direction — the cost of getting this wrong is an
 * open door to somebody else's OpenAI key.
 *
 * The feature is read out of the token rather than the request body, so the
 * one invariant this file exists to hold — what runs is what the grant says —
 * holds on this path too.
 */
export const DEBUG_GRANT_PREFIX = 'debug:';

function envFlag(value) {
  const flag = String(value ?? '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'on' || flag === 'yes';
}

/**
 * Whether this deployment accepts debug grants.
 *
 * `VERCEL_ENV` is the honest answer where it exists — it says preview or
 * development on the deployments a dev actually points at, and production only
 * on the real one. `NODE_ENV` is the fallback for a self-hosted studio, where
 * a built bundle says production for reasons that have nothing to do with
 * whether artists are using it; that is what the second variable is for.
 */
export function debugGrantsEnabled() {
  if (!envFlag(process.env.AI_DEBUG_MODE)) return false;
  const deployment = process.env.VERCEL_ENV || process.env.NODE_ENV;
  if (deployment === 'production' && !envFlag(process.env.AI_DEBUG_ALLOW_PRODUCTION)) {
    console.error(
      'AI_DEBUG_MODE is set on a production deployment and is being ignored. ' +
        'Set AI_DEBUG_ALLOW_PRODUCTION as well if that is really what you want.'
    );
    return false;
  }
  return true;
}

/**
 * Read a debug grant, or return null — which is every case except a deployment
 * that opted in being handed a well-formed `debug:` token.
 *
 * The payload mirrors a real grant so the caller needs no second code path.
 * There is no `jti`: nothing was metered, so there is nothing to replay.
 */
export function readDebugGrant(token, { onInvalid } = {}) {
  if (!debugGrantsEnabled()) return null;

  const raw = String(token || '');
  if (!raw.startsWith(DEBUG_GRANT_PREFIX)) return null;

  const feature = raw.slice(DEBUG_GRANT_PREFIX.length).trim();
  if (!feature) {
    onInvalid?.(GRANT_INVALID.MALFORMED);
    return null;
  }

  return {
    feature,
    // The tier that means "everything, unmetered" — the same claim the editor
    // makes for this mode. src/ai/tiers.js holds what it is for.
    tier: 'admin',
    sub: 'ai-debug',
    jti: null,
    debug: true,
  };
}

/**
 * Verify a grant token. Returns the payload, or null when the token is not
 * one we issued, is tampered with, or has expired.
 *
 * Returning null for every failure is deliberate: the caller answers 401
 * either way, and telling an attacker which check failed is free information.
 * `onInvalid` receives the reason so the server can still log it.
 */
export function verifyGrant(token, { now = Date.now(), onInvalid } = {}) {
  const fail = (reason) => {
    onInvalid?.(reason);
    return null;
  };

  const secret = process.env.TIER_GRANT_SECRET;
  if (!secret) return fail(GRANT_INVALID.MISSING_SECRET);

  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return fail(GRANT_INVALID.MALFORMED);

  const [body, signature] = parts;
  const expected = Buffer.from(base64url(createHmac('sha256', secret).update(body).digest()));
  const received = Buffer.from(signature);

  // timingSafeEqual throws on a length mismatch, which is itself a mismatch.
  if (expected.length !== received.length) return fail(GRANT_INVALID.BAD_SIGNATURE);
  if (!timingSafeEqual(expected, received)) return fail(GRANT_INVALID.BAD_SIGNATURE);

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return fail(GRANT_INVALID.MALFORMED);
  }

  if (!payload || typeof payload !== 'object') return fail(GRANT_INVALID.MALFORMED);
  if (typeof payload.feature !== 'string') return fail(GRANT_INVALID.MALFORMED);
  if (typeof payload.exp !== 'number') return fail(GRANT_INVALID.MALFORMED);
  if (payload.exp <= Math.floor(now / 1000)) return fail(GRANT_INVALID.EXPIRED);

  return payload;
}

/**
 * Single-use enforcement for the expensive features.
 *
 * `jti` is in the payload so a backend that wants strict one-grant-one-call
 * can remember the ids it has seen. Worth it where one call is minutes of
 * model time; overkill for canvas assist, which fires as the artist types.
 *
 * This is an in-process set, so on serverless it only catches replays that
 * land on the same warm instance. That is the honest limit of remembering
 * anything in memory here, and it is still worth having: a replay loop hits
 * one instance far more often than not. A Redis or Postgres set is the upgrade
 * if replay ever becomes a real cost — see docs/internal/AI_TIER_INTEGRATION.md.
 */
const seenGrantIds = new Map();

/** Grants live five minutes; anything older than that can never be replayed. */
const REPLAY_WINDOW_MS = 10 * 60 * 1000;

export function claimGrantId(jti, { now = Date.now() } = {}) {
  if (!jti) return true; // Nothing to key on — the exp check is the backstop.

  for (const [id, seenAt] of seenGrantIds) {
    if (now - seenAt > REPLAY_WINDOW_MS) seenGrantIds.delete(id);
  }

  if (seenGrantIds.has(jti)) return false;
  seenGrantIds.set(jti, now);
  return true;
}

/** Test seam — the replay set is process-global by design. */
export function resetClaimedGrants() {
  seenGrantIds.clear();
}
