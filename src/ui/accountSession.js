// src/ui/accountSession.js
//
// The gallery account, from inside the editor. Tools → Account…
//
// The gallery (art.tenderworld.org) owns accounts and tiers; the editor is a
// client that asks it who you are (see src/ai/entitlements.js). On the web that
// works without anything here: the artist signs in on the gallery in another
// tab and the editor's credentialed fetches carry the session cookie.
//
// The desktop app has no other tab. Its pages are served from
// `tauri://localhost` (`http://tauri.localhost` on Windows), which is a fresh
// cookie jar that has never visited the gallery, and `window.open()` — the one
// route the editor had to a sign-in page — is blocked in the OS webview. So the
// desktop build could only ever be signed out, and said so as "could not reach
// the gallery", which is not what was wrong.
//
// This module is the missing route:
//
//   1. Open the gallery's own sign-in page in a real webview window
//      (openExternal.js). Tauri's webviews share one cookie store, so the
//      session that lands there is a session the editor window can use.
//   2. Poll the entitlements endpoint while that window is open, and stop the
//      moment it answers `authenticated`.
//   3. Say plainly what happened — including the one failure that is neither
//      the artist's fault nor a network problem. See DESKTOP_ORIGIN_HINT.
//
// Signing out is the gallery's own page too: the editor never had a route to
// the gallery's sign-out and guessing one would be a guess. Whatever the artist
// does in that window, closing it re-reads the entitlements.

import { modalManager } from './ModalManager.js';
import { openExternal } from '../utils/openExternal.js';
import { isTauri } from '../utils/isTauri.js';
import { entitlements, GALLERY_ORIGIN } from '../ai/entitlements.js';
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
 * What a still-degraded payload means in the desktop app, specifically.
 *
 * The editor's requests to the gallery are cross-origin from
 * `tauri://localhost`, so the gallery has to name that origin in its CORS
 * allow-list for the browser to hand us the response — exactly as it already
 * does for studio.tenderworld.org. Until it does, every account call fails in
 * the same way an outage does, and the editor cannot tell the two apart from
 * the inside: a CORS rejection reaches JavaScript as an opaque network error.
 *
 * So say both. An artist who has just signed in and is still being told they
 * are not deserves to know this is the deployment's problem and not theirs.
 */
export const DESKTOP_ORIGIN_HINT =
  'The desktop app talks to the gallery from a different origin than the web ' +
  'editor does. If this keeps happening after signing in, the gallery has not ' +
  'been told to accept the desktop app yet — that is a deployment setting, not ' +
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

  const buttons = [
    {
      label: entitlements.authenticated ? 'Manage on the gallery' : 'Sign in',
      primary: true,
      onClick: () => {
        // Fire and forget: the dialog closes, the window opens, and the
        // entitlements refresh on their own when the artist is done. Someone
        // already signed in is not signing in again — they want the gallery.
        const open = entitlements.authenticated ? openGalleryAccount() : signInToGallery();
        open.catch((error) => console.warn('[account] Could not open the gallery:', error));
        return true;
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

  try {
    await modalManager.custom({ title: 'Account', body, buttons });
  } finally {
    unsubscribe();
  }
}
