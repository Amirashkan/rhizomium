/**
 * aiClient.js - run one AI feature, end to end.
 *
 * The sequence never varies, and the order matters:
 *
 *   1. Ask the gallery for a grant (spends quota, expires in five minutes).
 *   2. Send the grant to our own backend along with the request.
 *   3. The backend verifies the grant and only then calls the model.
 *
 * Step 1 is not optional and not cacheable — one grant authorises one call.
 * Everything that can go wrong at step 1 arrives as a GrantError carrying the
 * gallery's reason, so callers can tell an upsell from a spent allowance.
 */

import { entitlements, GrantError } from './entitlements.js';
import { isTauri } from '../utils/isTauri.js';

/**
 * The editor's own deployment, which is where the AI backend lives.
 *
 * Only the desktop app needs it spelled out; see aiEndpoint().
 */
export const STUDIO_ORIGIN = 'https://studio.tenderworld.org';

/**
 * Where to POST a feature run.
 *
 * On the web the backend ships with the page, so a relative path is the right
 * answer and follows preview deployments and local servers without being told.
 *
 * The desktop app is the exception. Its pages are bundled files served from
 * `tauri://localhost` (`http://tauri.localhost` on Windows), where there is no
 * `/api` at all — the relative path resolved to a missing asset, which is why
 * every AI feature failed in the desktop build the moment its grant succeeded.
 * There the deployment has to be named. `src-tauri/tauri.conf.json` lists this
 * origin in `connect-src`; the two have to move together.
 */
function aiEndpoint() {
  return isTauri() ? `${STUDIO_ORIGIN}/api/ai/run` : '/api/ai/run';
}

/** A model call that started but did not produce a usable answer. */
export class AIRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AIRequestError';
    this.code = details.code || 'request_failed';
    this.status = details.status ?? 0;
    this.detail = details.detail || null;
    /**
     * True when the quota was spent on this call. The grant is issued before
     * the model runs, so a backend failure still costs the artist an action —
     * saying so is more honest than a bare "try again".
     */
    this.quotaSpent = details.quotaSpent ?? true;
  }
}

/**
 * Run a feature and return its result.
 *
 * @param {string} feature - a feature key, e.g. 'ai.patch_review'.
 * @param {Object} input - the feature's payload (patch, prompt, description).
 * @returns {Promise<Object>} the backend's `result`, plus any `warnings`.
 * @throws {GrantError} when the gallery refuses (tier, quota, configuration).
 * @throws {AIRequestError} when the call itself fails.
 */
export async function runFeature(feature, input = {}) {
  // Step 1. Throws GrantError, which callers show as an upsell or a wait.
  const grant = await entitlements.requestGrant(feature);

  // Steps 2 and 3.
  let res;
  try {
    res = await fetch(aiEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ grant: grant.grant, feature, input }),
    });
  } catch {
    throw new AIRequestError(
      'Could not reach the AI service. Check your connection and try again.',
      { code: 'network', quotaSpent: true }
    );
  }

  let body = {};
  try {
    body = await res.json();
  } catch {
    // An error status with an unparseable body still tells us what happened.
  }

  if (!res.ok) {
    throw new AIRequestError(body.error || `The AI request failed (${res.status}).`, {
      code: body.code || 'request_failed',
      status: res.status,
      detail: body.detail || null,
      // A grant this backend refused (bad signature, replay) never reached the
      // model, but the gallery already counted it. Either way it is spent.
      quotaSpent: true,
    });
  }

  return {
    result: body.result,
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    usage: body.usage || null,
    label: body.label || feature,
    grant,
  };
}

export { GrantError };
