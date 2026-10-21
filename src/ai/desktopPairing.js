/**
 * desktopPairing.js - the client half of the gallery's pairing handshake.
 *
 * Modelled on the OAuth device flow, because a client without a session cookie
 * has the same problem it solves — no callback URL of its own to be redirected
 * to:
 *
 *   1. open a pairing and get an id (ours) and a short code (the artist's),
 *   2. the artist types that code on the gallery's /desktop page, signed in,
 *   3. poll until the token appears.
 *
 * No UI and no storage here. Two surfaces drive it: the desktop app's sign-in
 * window (src/ui/accountWindow.js) and a `npm run dev` browser, which opens the
 * gallery in a tab (src/ui/accountSession.js). Storing what comes back is
 * desktopToken.js's job.
 */

import { galleryApiUrl } from '../utils/galleryEndpoint.js';

/** The gallery page where a pairing code is approved. */
export const APPROVAL_PATH = '/desktop';

/** How often to ask whether the pairing has been approved. */
export const POLL_INTERVAL_MS = 3000;

/**
 * How long to keep asking. The gallery forgets a pairing after ten minutes, so
 * waiting longer would only be polling a code that can no longer be approved.
 */
export const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Open a pairing.
 *
 * @returns {Promise<{pairing: {pairingId: string, userCode: string}} | {error: string}>}
 *   the pairing, or a sentence saying why there is none.
 */
export async function startPairing() {
  let pairing;
  try {
    const res = await fetch(galleryApiUrl('/api/desktop/pair/start'), {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.code === 'not_configured') {
        return { error: 'The gallery is not set up for desktop sign-in yet.' };
      }
      if (body.code === 'rate_limited') {
        return { error: 'Too many sign-ins started from this machine. Try again in a little while.' };
      }
      return { error: `Could not start sign-in (${res.status}).` };
    }
    pairing = await res.json();
  } catch {
    // A CORS rejection and an offline machine are the same TypeError here, and
    // the origin is what tells them apart — it is the thing the gallery has to
    // be told to accept, and it differs between a dev run (localhost:5173) and
    // an installed one (tauri.localhost). Put it in the message so the answer
    // is on screen rather than in devtools.
    return {
      error:
        `Could not reach the gallery from ${window.location.origin}. ` +
        'Either this machine is offline, or the gallery does not accept that origin yet.',
    };
  }

  if (!pairing?.pairingId || !pairing?.userCode) {
    return { error: 'The gallery did not return a pairing code.' };
  }
  return { pairing };
}

/**
 * Poll for the token until it appears, the pairing dies, or the wait runs out.
 *
 * @param {string} pairingId
 * @param {Object} [options]
 * @param {import('../utils/openExternal.js').ExternalPage} [options.page] the
 *   window the approval is happening in, when we have one. Closing it ends the
 *   wait, but is checked once more first: approving and immediately closing is
 *   the normal way to finish, and the poll that would have collected the token
 *   may not have come round yet.
 * @returns {Promise<string|null>} the token, or null.
 */
export function waitForToken(pairingId, { page } = {}) {
  return new Promise((resolve) => {
    let finished = false;
    let timer = null;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    const finish = (value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(value);
    };

    const check = async () => {
      if (finished) return;
      try {
        const res = await fetch(
          galleryApiUrl(`/api/desktop/pair/poll?pairingId=${encodeURIComponent(pairingId)}`),
          { headers: { Accept: 'application/json' } }
        );
        if (!res.ok) return;

        const body = await res.json();
        if (body.status === 'approved' && body.token) {
          finish(body.token);
          return;
        }
        // 'expired' and 'unknown' are both dead ends: the code will never be
        // approved now, so stop rather than poll a pairing that cannot answer.
        if (body.status === 'expired' || body.status === 'unknown') finish(null);
      } catch {
        // Keep waiting. The artist may be mid-approval and one failed poll
        // says nothing about the next.
      }
    };

    const poll = async () => {
      await check();
      if (finished) return;
      if (Date.now() >= deadline) {
        finish(null);
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    page?.onClosed(async () => {
      await check();
      finish(null);
    });

    timer = setTimeout(poll, POLL_INTERVAL_MS);
  });
}
