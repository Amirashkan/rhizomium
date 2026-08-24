// src/ui/accountSession.js
//
// The gallery account, from inside the editor. Tools → Account…
//
// The gallery (art.tenderworld.org) owns accounts and tiers; the editor is a
// client that asks it who you are (see src/ai/entitlements.js). On the web that
// needs almost nothing: the artist signs in on the gallery and the editor's
// credentialed fetches carry the session cookie, because studio.tenderworld.org
// and art.tenderworld.org are the same site.
//
// The desktop app is not the same site. Its pages are served from
// `tauri://localhost` (`http://tauri.localhost` on Windows), so the gallery's
// cookie is never sent on its requests — signing in inside the app succeeds and
// leaves the editor window anonymous. Sharing the cookie would mean making the
// gallery's session a third-party cookie for every visitor on the website, to
// serve one client, so it carries its own credential instead.
//
// Two flows, then, behind one `signInToGallery()`:
//
//   web      open the gallery's sign-in page, poll until the entitlements come
//            back authenticated. The cookie is the credential.
//
//   desktop  pair for a bearer token (`pairDesktop`), modelled on the OAuth
//            device flow: open a pairing, have the artist approve its code on
//            the gallery's /desktop page, poll for the token, store it. See
//            ../ai/desktopToken.js and the gallery's /api/desktop/pair/*.
//
// Signing out differs the same way. On the web it is the gallery's own page —
// the editor never had a route to the gallery's sign-out and guessing one would
// be a guess. On the desktop the credential is ours, so forgetting it is the
// sign-out, and it is immediate.

import { modalManager } from './ModalManager.js';
import { openExternal } from '../utils/openExternal.js';
import { isTauri } from '../utils/isTauri.js';
import { entitlements, GALLERY_ORIGIN } from '../ai/entitlements.js';
import { clearDesktopToken, getDesktopToken, setDesktopToken } from '../ai/desktopToken.js';
import { TIER_LABELS } from '../ai/tiers.js';

/** The gallery's sign-in page. */
const SIGN_IN_URL = `${GALLERY_ORIGIN}/login`;

/** One window, reused: a second click raises it rather than opening another. */
const WINDOW_LABEL = 'gallery-account';

/** How often to re-read the entitlements while the sign-in window is open. */
const POLL_INTERVAL_MS = 3000;

/** How long to keep polling. Long enough for an email round trip, not forever. */
const POLL_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * What a still-degraded or still-anonymous answer means in the desktop app.
 *
 * The desktop app does not fail the way the web one does. It is not waiting on
 * a cookie, so "sign in on the gallery and come back" is not advice that helps
 * here; what it needs is a pairing, and the thing that can be missing is the
 * gallery's end of it. A deployment without the /api/desktop/pair/* routes, or
 * without SUPABASE_SERVICE_ROLE_KEY set, refuses every pairing — and from the
 * inside that is indistinguishable from being signed out.
 *
 * So name it. An artist who has just approved a code and is still being told
 * they are signed out deserves to know it is the deployment and not them.
 */
export const DESKTOP_ORIGIN_HINT =
  'The desktop app signs in with its own credential rather than a browser ' +
  'session. If this keeps happening, the gallery deployment may not have the ' +
  'desktop pairing endpoints yet — that is a deployment setting, not ' +
  'something to fix here.';

/**
 * One line describing who the artist is, for a status bar or a dialog.
 *
 * @param {Object} [state] entitlements payload; defaults to the current one.
 */
export function accountSummary(state = entitlements.current) {
  const tier = state.tierLabel || TIER_LABELS[state.tier] || 'Free';

  if (state.authenticated) return `Signed in · ${tier}`;
  if (state.degraded) return 'Not signed in · gallery unreachable';
  return `Not signed in · ${tier} allowance`;
}

/** One window for everything account-shaped, so the two flows cannot diverge. */
function openGalleryWindow() {
  return openExternal(SIGN_IN_URL, {
    label: WINDOW_LABEL,
    title: 'Rhizomium — Account',
    width: 960,
    height: 800,
  });
}

/**
 * Open the gallery's account page and re-read the entitlements when the artist
 * is done with it.
 *
 * This is the route for everything the editor does not own — changing plan,
 * signing out, anything on the gallery's own pages. It does not wait for a
 * particular outcome, because there is not one to wait for.
 *
 * @returns {Promise<boolean>} whether the page opened.
 */
export async function openGalleryAccount() {
  const page = await openGalleryWindow();
  if (!page) return false;

  page.onClosed(() => {
    entitlements.refresh().catch(() => {});
  });
  return true;
}

/**
 * Open the gallery's sign-in page and wait for a session to appear.
 *
 * Resolves true as soon as the entitlements come back authenticated. Resolves
 * false when the artist closes the window without signing in, when the wait
 * times out, or when the page could not be opened at all.
 *
 * @param {Object} [options]
 * @param {(message: string) => void} [options.onStatus] progress, for a status bar.
 * @returns {Promise<boolean>}
 */
export async function signInToGallery({ onStatus } = {}) {
  // Already signed in — nothing to do but say so.
  await entitlements.load().catch(() => {});
  if (entitlements.authenticated) {
    onStatus?.('Already signed in.');
    return true;
  }

  // On the web the cookie is the credential and opening the sign-in page is
  // the whole flow. The desktop app cannot use that cookie at all — it is a
  // different site — so it pairs for a token instead.
  return isTauri() ? pairDesktop({ onStatus }) : signInWithCookie({ onStatus });
}

/** The web flow: sign in on the gallery, and the cookie does the rest. */
async function signInWithCookie({ onStatus }) {
  const page = await openGalleryWindow();
  if (!page) {
    onStatus?.('Could not open the sign-in page.');
    return false;
  }

  onStatus?.('Waiting for the gallery sign-in…');
  const signedIn = await waitForSession(page);

  if (signedIn) {
    // The window has done its job; leaving it up in front of the editor makes
    // the artist close a page that is already finished.
    await page.close();
    onStatus?.('Signed in.');
    return true;
  }

  onStatus?.('Still signed out.');
  return false;
}

/**
 * The desktop flow: pair with the gallery and collect a bearer token.
 *
 * Three steps, modelled on the OAuth device flow because the desktop app has
 * the same problem it solves — no callback URL of its own to be redirected to:
 *
 *   1. open a pairing and get an id (ours) and a short code (the artist's),
 *   2. open /desktop with that code so they can approve it while signed in,
 *   3. poll until the token appears, then store it.
 *
 * The approval is deliberately theirs to make. We prefill the code but the
 * gallery still waits for a click, because a prefilled code arriving by link
 * is exactly what a phishing attempt looks like.
 */
async function pairDesktop({ onStatus }) {
  onStatus?.('Starting sign-in…');

  let pairing;
  try {
    const res = await fetch(`${GALLERY_ORIGIN}/api/desktop/pair/start`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      onStatus?.(
        body.code === 'not_configured'
          ? 'The gallery is not set up for desktop sign-in yet.'
          : `Could not start sign-in (${res.status}).`
      );
      return false;
    }
    pairing = await res.json();
  } catch {
    // A CORS rejection and an offline machine are the same TypeError here, and
    // the origin is what tells them apart — it is the thing the gallery has to
    // be told to accept, and it differs between a dev run (localhost:5173) and
    // an installed one (tauri.localhost). Put it in the message so the answer
    // is on screen rather than in devtools.
    onStatus?.(
      `Could not reach the gallery from ${window.location.origin}. ` +
      'Either this machine is offline, or the gallery does not accept that origin yet.'
    );
    return false;
  }

  if (!pairing?.pairingId || !pairing?.userCode) {
    onStatus?.('The gallery did not return a pairing code.');
    return false;
  }

  const page = await openExternal(
    `${GALLERY_ORIGIN}/desktop?code=${encodeURIComponent(pairing.userCode)}`,
    { label: WINDOW_LABEL, title: 'Rhizomium — Connect', width: 720, height: 720 }
  );
  if (!page) {
    onStatus?.('Could not open the approval page.');
    return false;
  }

  onStatus?.(`Approve the code ${pairing.userCode} in the window that opened…`);
  const token = await waitForToken(pairing.pairingId, page);

  if (!token) {
    onStatus?.('Sign-in was not completed.');
    return false;
  }

  setDesktopToken(token);
  await entitlements.refresh().catch(() => {});
  await page.close();
  onStatus?.('Signed in.');
  return true;
}

/**
 * Poll for the token until it appears, the artist closes the window, or the
 * wait runs out.
 *
 * A closed window ends the wait but is checked once more first: approving and
 * immediately closing is the normal way to finish, and the poll that would
 * have collected the token may not have come round yet.
 */
function waitForToken(pairingId, page) {
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
      if (finished) return null;
      try {
        const res = await fetch(
          `${GALLERY_ORIGIN}/api/desktop/pair/poll?pairingId=${encodeURIComponent(pairingId)}`,
          { headers: { Accept: 'application/json' } }
        );
        if (!res.ok) return null;

        const body = await res.json();
        if (body.status === 'approved' && body.token) {
          finish(body.token);
          return body.token;
        }
        // 'expired' and 'unknown' are both dead ends: the code will never be
        // approved now, so stop rather than poll a pairing that cannot answer.
        if (body.status === 'expired' || body.status === 'unknown') finish(null);
      } catch {
        // Keep waiting. The artist may be mid-approval and one failed poll
        // says nothing about the next.
      }
      return null;
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

    page.onClosed(async () => {
      await check();
      finish(null);
    });

    timer = setTimeout(poll, POLL_INTERVAL_MS);
  });
}

/**
 * Poll the entitlements until they say we are signed in, the window closes, or
 * the wait runs out.
 *
 * The close is not a failure on its own: a sign-in can complete in the last
 * moment before the artist closes the window, so a close triggers one final
 * read rather than an immediate no.
 */
function waitForSession(page) {
  return new Promise((resolve) => {
    let finished = false;
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(result);
    };

    let timer = null;

    const check = async () => {
      if (finished) return false;
      try {
        const state = await entitlements.refresh();
        if (state.authenticated) {
          finish(true);
          return true;
        }
      } catch {
        // Offline, or the gallery is unhappy. Keep waiting: the artist may
        // still be typing a password, and the next poll can succeed.
      }
      return false;
    };

    const poll = async () => {
      if (await check()) return;
      if (finished) return;
      if (Date.now() >= deadline) {
        finish(false);
        return;
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    page.onClosed(async () => {
      // One last read, so a sign-in finished a second before the window closed
      // is not thrown away.
      if (await check()) return;
      finish(false);
    });

    timer = setTimeout(poll, POLL_INTERVAL_MS);
  });
}

/**
 * Sign out.
 *
 * On the desktop the credential is a token we hold, so forgetting it is the
 * whole sign-out and it takes effect at once. The token is left valid on the
 * gallery rather than revoked: revoking needs an endpoint that a stolen token
 * could also call, and "this machine forgets" is what the artist asked for.
 *
 * On the web there is nothing here to forget — the cookie is the gallery's,
 * and its own page is where it is dropped.
 *
 * @returns {Promise<boolean>} true when the editor signed itself out.
 */
export async function signOut() {
  if (!isTauri() || !getDesktopToken()) return false;

  clearDesktopToken();
  await entitlements.refresh().catch(() => {});
  return true;
}

/**
 * Tools → Account… — who you are, what that buys, and a way to change it.
 *
 * Deliberately thin: the gallery owns accounts, so this dialog reports and
 * hands over rather than reimplementing anything.
 */
export async function showAccountDialog() {
  // Draw with whatever is cached, then re-read: an artist opening this dialog
  // is usually opening it *because* they suspect the cached answer is stale.
  await entitlements.load().catch(() => {});

  const body = document.createElement('div');
  body.className = 'account-dialog';

  const status = document.createElement('p');
  status.className = 'account-status';
  body.appendChild(status);

  const detail = document.createElement('p');
  detail.className = 'account-detail';
  body.appendChild(detail);

  const paint = () => {
    const state = entitlements.current;
    status.textContent = accountSummary(state);

    if (state.authenticated) {
      detail.textContent =
        'Your plan and allowance are read from the gallery. Change them there; ' +
        'this dialog re-reads them when you come back.';
      return;
    }

    if (state.degraded) {
      detail.textContent = isTauri()
        ? `The gallery did not answer, so the editor is showing the free allowance. ${DESKTOP_ORIGIN_HINT}`
        : 'The gallery did not answer, so the editor is showing the free allowance.';
      return;
    }

    detail.textContent =
      'Signed-out visitors get a third of the free allowance. Signing in is ' +
      'free and raises it.';
  };

  paint();
  const unsubscribe = entitlements.onChange(paint);

  // Progress goes on the detail line, and pins there: signing in is a
  // multi-step conversation with another window — start a pairing, approve a
  // code, wait for it — and every step can fail in a way worth reading. This
  // dialog used to close on the click and report none of it, so a sign-in that
  // failed in its first millisecond was indistinguishable from one that never
  // started.
  let pinned = null;
  const say = (message) => {
    pinned = message;
    detail.textContent = message;
  };
  const repaint = () => {
    if (pinned) detail.textContent = pinned;
    else paint();
  };
  unsubscribe();
  const unsubscribeStatus = entitlements.onChange(repaint);

  const buttons = [
    {
      label: entitlements.authenticated ? 'Manage on the gallery' : 'Sign in',
      primary: true,
      onClick: () => {
        // Someone already signed in is not signing in again — they want the
        // gallery, and that window is theirs to close.
        if (entitlements.authenticated) {
          openGalleryAccount().catch((error) =>
            console.warn('[account] Could not open the gallery:', error)
          );
          return true;
        }

        // Stay open and narrate. The artist has another window to attend to
        // and will come back to this one.
        signInToGallery({ onStatus: say })
          .then((signedIn) => {
            if (!signedIn) return;
            pinned = null;
            paint();
          })
          .catch((error) => {
            console.warn('[account] Sign-in failed:', error);
            say('Sign-in failed. The console has the details.');
          });
        return false;
      },
    },
    {
      label: 'Re-check',
      onClick: () => {
        entitlements.refresh().catch(() => {});
        return false;
      },
    },
    { label: 'Close', onClick: () => true },
  ];

  // Only the desktop app holds a credential of its own, so it is the only one
  // with something to sign out of. Offering the button on the web would be
  // offering to forget a cookie we do not own.
  if (isTauri() && getDesktopToken()) {
    buttons.splice(1, 0, {
      label: 'Sign out',
      onClick: () => {
        signOut().catch((error) => console.warn('[account] Sign-out failed:', error));
        return false;
      },
    });
  }

  try {
    await modalManager.custom({ title: 'Account', body, buttons });
  } finally {
    unsubscribeStatus();
  }
}
