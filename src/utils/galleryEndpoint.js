// src/utils/galleryEndpoint.js
//
// Where the gallery's API is, from wherever the editor happens to be running.
//
// The gallery (art.tenderworld.org) owns accounts, cloud files and published
// works, and the editor is always a client of it from some *other* origin:
// https://studio.tenderworld.org on the web, `tauri://localhost`
// (`http://tauri.localhost` on Windows) in the desktop app, and
// http://localhost:5173 while either is being developed. Every call is
// therefore cross-origin, and only reaches the gallery if the gallery's own
// CORS configuration names that origin.
//
// The deployed origins are the gallery's to accept, and it does. The Vite dev
// server is the one we cannot ask it to: a developer's loopback port is not
// something a production gallery should be handing its answers to, and at
// least one route (`/api/rhizo-upload`) answers no cross-origin caller at all
// — a publish from `npm run dev` or `tauri dev` failed its preflight before
// the upload was ever sent.
//
// So in dev the call does not leave our origin. `vite.config.js` proxies
// `/gallery-api/*` to the gallery server-side, which puts the hop outside the
// browser and takes CORS out of the picture entirely, exactly as the existing
// `/api` proxy does for the studio backend. Everywhere else this resolves to
// the gallery's real origin and nothing changes.
//
// Credentials are unaffected by the choice and are the caller's business: the
// web session is a cookie the browser attaches, the desktop one is the bearer
// token in src/ai/desktopToken.js. Note that a *cookie* cannot survive the dev
// proxy — the browser has no gallery cookie to send from localhost in the
// first place — so a dev run authenticates with the desktop token or not at
// all, which is what `tauri dev` does anyway.

/** The gallery itself. Absolute, and the right answer for anything a person
 *  navigates to (sign-in, the publish page, an upgrade link). */
export const GALLERY_ORIGIN = 'https://art.tenderworld.org';

/** The dev-only path prefix that vite.config.js forwards to the gallery. */
export const GALLERY_PROXY_PREFIX = '/gallery-api';

/**
 * The Vite dev server's port. `strictPort: true` in vite.config.js means it is
 * this port or nothing, which is what makes matching on it safe — the raw
 * Python server (port 5000) and any other local host are left alone, because
 * they have no proxy to forward through.
 */
export const DEV_SERVER_PORT = 5173;

const DEV_SERVER_ORIGIN = new RegExp(
  `^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]):${DEV_SERVER_PORT}$`
);

/** @returns {boolean} true when this page is being served by `npm run dev`. */
export function isDevServerOrigin(origin) {
  return typeof origin === 'string' && DEV_SERVER_ORIGIN.test(origin);
}

function currentOrigin() {
  return typeof window !== 'undefined' ? window.location?.origin : undefined;
}

/**
 * The base to build gallery API URLs on: the dev proxy prefix when the page
 * came from the Vite dev server, the gallery's own origin otherwise.
 *
 * @param {string} [origin] the page's origin; defaults to the live one.
 */
export function galleryApiBase(origin = currentOrigin()) {
  return isDevServerOrigin(origin) ? GALLERY_PROXY_PREFIX : GALLERY_ORIGIN;
}

/**
 * A gallery API URL.
 *
 * @param {string} path an absolute path on the gallery, e.g. '/api/entitlements'.
 * @param {string} [origin] the page's origin; defaults to the live one.
 */
export function galleryApiUrl(path, origin = currentOrigin()) {
  return `${galleryApiBase(origin)}${path}`;
}
