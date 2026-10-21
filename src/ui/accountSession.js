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
//   desktop  pair for a bearer token, modelled on the OAuth device flow: open a
//            pairing, have the artist approve its code on the gallery's
//            /desktop page, poll for the token, store it. In the app this runs
//            in a sign-in window of its own (`signInInWindow`) that sends the
//            artist to their browser to approve; a `npm run dev` browser does
//            it from a gallery tab (`pairInBrowser`). See
//            ../ai/desktopPairing.js, ../ai/desktopToken.js and the gallery's
//            /api/desktop/pair/*.
//
// Signing out differs the same way. On the web it is the gallery's own page —
// the editor never had a route to the gallery's sign-out and guessing one would
// be a guess. On the desktop the credential is ours, so forgetting it is the
// sign-out, and it is immediate.

import { modalManager } from './ModalManager.js';
import { openExternal, openGalleryInBrowser } from '../utils/openExternal.js';
import { isTauri } from '../utils/isTauri.js';
import { entitlements, GALLERY_ORIGIN } from '../ai/entitlements.js';
import { APPROVAL_PATH, startPairing, waitForToken } from '../ai/desktopPairing.js';
import {
  clearDesktopToken,
  getDesktopToken,
  resetDesktopTokenCache,
  setDesktopToken,
  usesBearerToken,
} from '../ai/desktopToken.js';
import { TIER_LABELS } from '../ai/tiers.js';

/** The gallery's sign-in page. */
const SIGN_IN_URL = `${GALLERY_ORIGIN}/login`;

/** One window, reused: a second click raises it rather than opening another. */
const WINDOW_LABEL = 'gallery-account';

/**
 * The desktop sign-in window (editor/account.html). Its own label, because it
 * is the one window here that is ours: src-tauri/capabilities/account.json
 * names it, so it may close itself and ask for the browser.
 */
const ACCOUNT_WINDOW_LABEL = 'account';

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
  // Not a webview window in the app: the account there is a token, and a
  // webview pointed at the gallery has no session and would only ask the
  // artist to sign in all over again. Their browser has one. There is no close
  // to wait for across that boundary, so re-read when they come back.
  if (isTauri()) {
    if (!(await openGalleryInBrowser(APPROVAL_PATH))) return false;
    window.addEventListener('focus', () => entitlements.refresh().catch(() => {}), { once: true });
    return true;
  }

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

  // On a deployed web build the cookie is the credential and opening the
  // sign-in page is the whole flow. The desktop app cannot use that cookie at
  // all — it is a different site — so it pairs for a token instead, in a
  // window of its own; and so does a `npm run dev` browser, which reaches the
  // gallery through a server-side proxy no cookie rides along with. See
  // usesBearerToken().
  if (isTauri()) return signInInWindow({ onStatus });
  return usesBearerToken() ? pairInBrowser({ onStatus }) : signInWithCookie({ onStatus });
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
 * The desktop flow: the app's own sign-in window.
 *
 * It used to open the gallery's /desktop page in a webview window and wait
 * there, and the artist could not finish in it. The webview had none of the
 * browser's sessions, so it asked them to sign in again; the magic link the
 * gallery emails opened in their browser instead of in it; and signing in
 * landed on /gallery, with no address bar to get back to the page that takes
 * the code. Every route ended with the app still signed out.
 *
 * editor/account.html is ours instead. It runs the pairing itself, shows the
 * code, and sends the artist to /desktop in their own browser, where they are
 * most likely signed in already. All the editor does is wait for it to close
 * and re-read the account, which works because the window stores the token on
 * the app's own origin, where desktopToken.js reads it.
 */
async function signInInWindow({ onStatus }) {
  const before = getDesktopToken();

  const page = await openExternal(accountPageUrl(), {
    label: ACCOUNT_WINDOW_LABEL,
    title: 'Sign in to Rhizomium',
    width: 520,
    height: 600,
  });
  if (!page) {
    onStatus?.('Could not open the sign-in window.');
    return false;
  }

  onStatus?.('Finish signing in in the Sign in to Rhizomium window…');
  await new Promise((resolve) => page.onClosed(resolve));

  // The window wrote the token from another webview; drop ours so the read
  // below sees it rather than what was cached before the window opened.
  resetDesktopTokenCache();
  const token = getDesktopToken();
  await entitlements.refresh().catch(() => {});

  if (!token || token === before) {
    onStatus?.('Sign-in was not completed.');
    return false;
  }
  onStatus?.('Signed in.');
  return true;
}

/**
 * The sign-in window's page, as a sibling of the editor page this is running
 * in — the same resolution TauriSecondMonitorViewer uses for its receiver, so
 * it holds under `tauri dev` (served by Vite) and in a packaged build alike.
 */
function accountPageUrl() {
  try {
    const { pathname } = window.location;
    const dir = pathname.endsWith('/') ? pathname : pathname.replace(/[^/]*$/, '');
    return `${dir}account.html`;
  } catch {
    return '/editor/account.html';
  }
}

/**
 * A `npm run dev` browser: pair the same way, approving in a gallery tab.
 *
 * A real browser tab has the artist's sessions and receives their magic links,
 * so none of what broke the desktop webview applies, and the code can stay a
 * line in whatever status surface asked.
 */
async function pairInBrowser({ onStatus }) {
  onStatus?.('Starting sign-in…');

  const started = await startPairing();
  if (started.error) {
    onStatus?.(started.error);
    return false;
  }
  const { pairing } = started;

  const page = await openExternal(`${GALLERY_ORIGIN}${APPROVAL_PATH}`, {
    label: WINDOW_LABEL,
    title: 'Rhizomium — Connect',
    width: 720,
    height: 720,
  });
  if (!page) {
    onStatus?.('Could not open the approval page.');
    return false;
  }

  onStatus?.(`Enter the code ${pairing.userCode} on the gallery page that opened, and approve it…`);
  const token = await waitForToken(pairing.pairingId, { page });

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
  if (!usesBearerToken() || !getDesktopToken()) return false;

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

  // Only a client holding a token of its own has something to sign out of.
  // Offering the button on a deployed web build would be offering to forget a
  // cookie we do not own.
  if (usesBearerToken() && getDesktopToken()) {
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
