/**
 * cors.js - who may call the AI backend from another origin.
 *
 * On the web the editor and `/api/ai/run` ship in the same deployment, so the
 * request is same-origin and CORS never enters into it. Two callers are not:
 *
 *   - The desktop app. Its pages are bundled files served from
 *     `tauri://localhost` (`http://tauri.localhost` on Windows) and it names
 *     the deployment outright (see aiClient.js aiEndpoint).
 *   - A local dev server. `npm run dev` and `tauri dev` serve the editor from
 *     http://localhost:5173 while the backend still only exists on the
 *     deployment.
 *
 * Both send a JSON body, which makes every call a preflighted one: the browser
 * asks OPTIONS first and refuses to send the POST at all unless the answer
 * names its origin. The handler used to answer that preflight with a bare 204
 * and no headers, so both callers failed with "No 'Access-Control-Allow-Origin'
 * header is present" before the request was ever made.
 *
 * This is not the security boundary and is not trying to be one. The gate is
 * the signed grant the handler verifies (see grant.js); a caller who cannot
 * get the gallery to sign one gets nothing here no matter what origin it
 * claims. What the allow-list buys is that a page on some unrelated site
 * cannot read this deployment's answers with a visitor's browser.
 */

/**
 * The desktop app's origins.
 *
 * Tauri v2 serves the bundle from `tauri://localhost` on macOS and Linux; the
 * Windows WebView2 has no custom scheme and uses `http://tauri.localhost`.
 * The app ships for Windows today, but the other two cost nothing to accept
 * and save the next platform a debugging session.
 */
export const DESKTOP_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
];

/**
 * A dev server on this machine, on any port: 5173 for Vite, whatever
 * `python3 -m http.server` or `vercel dev` was given.
 *
 * A page has to already be running on the developer's own loopback interface
 * to match, and it still needs a grant the gallery signed. That is a fair
 * trade for the editor being debuggable against a real backend.
 */
const LOCAL_DEV = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

/** Methods and headers the AI endpoint actually uses. */
const ALLOW_METHODS = 'POST, OPTIONS';
const DEFAULT_ALLOW_HEADERS = 'Content-Type, Accept';

/** A day. Preflights are cached, so a refused origin is not a hot path. */
const MAX_AGE = '86400';

/**
 * Extra origins for a deployment that is not ours.
 *
 * Someone self-hosting the studio points their desktop build at their own
 * domain; `AI_ALLOWED_ORIGINS` (comma-separated) lets them say so without a
 * fork. Blank entries are ignored, trailing slashes trimmed — an origin never
 * has a path, and `https://example.com/` would silently never match.
 */
function configuredOrigins() {
  return (process.env.AI_ALLOWED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * Is this origin allowed to read our answer?
 *
 * @param {string|undefined} origin - the request's `Origin` header.
 * @param {string|undefined} host - the request's `Host`, so a same-origin call
 *   is recognised on whatever domain this deployment happens to answer (a
 *   Vercel preview URL as much as studio.tenderworld.org).
 * @returns {boolean}
 */
export function isAllowedOrigin(origin, host) {
  if (!origin) return false;

  if (DESKTOP_ORIGINS.includes(origin)) return true;
  if (LOCAL_DEV.test(origin)) return true;
  if (configuredOrigins().includes(origin)) return true;

  // Same-origin. The browser would not apply CORS to it, but a request that
  // reaches us through a proxy or a rewrite can arrive looking cross-origin.
  if (host) {
    try {
      if (new URL(origin).host === host) return true;
    } catch {
      // A malformed Origin is not one of ours.
    }
  }

  return false;
}

/**
 * Add the CORS headers this request has earned, if any.
 *
 * Call it first thing in the handler, before any response: every path out —
 * the 503 for a missing key, the 401 for a bad grant, the 200 with a patch —
 * has to carry the headers, or the browser discards a perfectly good answer
 * and reports it as a CORS failure instead.
 *
 * `Vary: Origin` goes on unconditionally: the response genuinely differs by
 * origin, and a cache that missed that would serve one caller's headers to
 * another.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {boolean} true when the origin was allowed and headers were set.
 */
export function applyCors(req, res) {
  res.setHeader('Vary', 'Origin');

  const headers = req?.headers || {};
  const origin = headers.origin;

  if (!isAllowedOrigin(origin, headers.host)) {
    if (origin) {
      console.warn(`Refused a cross-origin AI request from ${origin}.`);
    }
    return false;
  }

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
  // Echo what was asked for when the browser says: it keeps a header the
  // client adds later from failing a preflight this file has to be edited to
  // fix. The request itself is still checked by the handler.
  res.setHeader(
    'Access-Control-Allow-Headers',
    headers['access-control-request-headers'] || DEFAULT_ALLOW_HEADERS
  );
  res.setHeader('Access-Control-Max-Age', MAX_AGE);
  // No `Allow-Credentials`: the AI call carries no cookies. Its authority is
  // the grant in the body, which is exactly the point of the design.
  return true;
}
