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

/**
 * How long to wait for an answer before giving up on one.
 *
 * The backend stops itself first and answers with a reason (see
 * api/ai/run.js MODEL_DEADLINE_MS), which is the message worth showing; this
 * is the backstop for when that answer never arrives — a request lost on the
 * way out, a gateway that gave up on its own — and it is deliberately longer
 * than the backend's deadline so the honest error wins whenever there is one.
 *
 * Without it the editor waits forever on a request nothing will ever answer,
 * with a spinner and no way to tell the artist what happened.
 */
const REQUEST_TIMEOUT_MS = 305_000;

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
  const controller = new AbortController();
  const giveUp = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(aiEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ grant: grant.grant, feature, input }),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new AIRequestError(
        'The AI did not answer in time and the editor stopped waiting. Large patches take ' +
          'the longest — try it on a smaller one.',
        { code: 'timed_out', quotaSpent: true }
      );
    }

    // Everything else fetch refuses to explain, for the same reason it refuses
    // to explain any of them: the browser will not tell a page why a
    // cross-origin request failed. Worth knowing when reading a report of one —
    // a gateway that answers without CORS headers (a timeout at the edge, a
    // deployment that is not up) lands here too, and the console calls it a
    // CORS error even though the allow-list is fine.
    throw new AIRequestError(
      'Could not reach the AI service. Check your connection and try again.',
      { code: 'network', quotaSpent: true }
    );
  } finally {
    clearTimeout(giveUp);
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
