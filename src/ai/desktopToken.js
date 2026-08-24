/**
 * desktopToken.js - the desktop app's credential for the gallery.
 *
 * The web editor authenticates with the gallery's session cookie and needs
 * nothing here. The desktop app cannot: it is served from tauri://localhost
 * (http://tauri.localhost on Windows), a different site from the gallery, so a
 * cookie set there is never sent on its requests no matter how CORS is
 * configured. Signing in inside the app leaves the editor window anonymous.
 *
 * It carries a bearer token instead, issued by the gallery's pairing
 * handshake (see accountSession.js, and the gallery's /api/desktop/pair/*).
 * This module is only the store.
 *
 * ## Where it is kept, and why that is enough
 *
 * localStorage on the app's own origin. In the desktop app that is a real
 * per-installation store inside the WebView2 user data folder, not a browser
 * tab someone else can reach: the origin is the application's, no website
 * shares it, and it survives restarts, which is the whole requirement.
 *
 * Not the autosave file (Rust, app data dir) — that is a document store and a
 * credential is not a document. If the token ever needs OS-level protection,
 * the upgrade is a keychain via a Tauri command, and only this file changes.
 */

import { isTauri } from '../utils/isTauri.js';

const STORAGE_KEY = 'rhizomium.gallery.desktopToken';

/** Cached, so the common path does not touch storage on every request. */
let cached;

/**
 * The stored token, or null.
 *
 * Reads answer null rather than throwing when storage is unavailable — a
 * private-mode webview, a policy that blocks site data. The caller then
 * behaves exactly as a signed-out desktop app, which is the honest result.
 */
export function getDesktopToken() {
  if (!isTauri()) return null;
  if (cached !== undefined) return cached;

  try {
    cached = window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Store a token issued by the gallery. Passing null forgets the current one. */
export function setDesktopToken(token) {
  cached = token || null;

  try {
    if (cached) window.localStorage.setItem(STORAGE_KEY, cached);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // The token still works for this session from the cache above; it just
    // will not survive a restart. Worth a warning, not a failure.
    console.warn('[desktopToken] Could not persist the sign-in:', error);
  }
}

/** Forget the token — a sign-out, or a token the gallery no longer honours. */
export function clearDesktopToken() {
  setDesktopToken(null);
}

/**
 * The Authorization header for a gallery request, or an empty object.
 *
 * Spread into a headers literal so a call site reads the same whether or not
 * there is a token: on the web there never is, and the cookie does the work.
 */
export function desktopAuthHeaders() {
  const token = getDesktopToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Test seam: drop the memoised value so the next read hits storage again. */
export function resetDesktopTokenCache() {
  cached = undefined;
}
