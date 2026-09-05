// src/utils/speedInsights.js
//
// Vercel Speed Insights — the web deployment, and only the web deployment.
//
// Speed Insights works by appending a <script> to the page and beaconing Web
// Vitals back to it. Both halves are Vercel-edge routes: the script is served
// from `/_vercel/speed-insights/script.js` and the samples go to
// `/_vercel/speed-insights/vitals`. Those paths exist on the Vercel deployment
// and nowhere else, which makes this a per-origin feature, not an app feature.
//
// Two rules follow, and breaking either is what brought the desktop app down:
//
//  1. IT MUST NOT RUN IN THE DESKTOP APP. Tauri serves every page from
//     `tauri://localhost` (`http://tauri.localhost` on Windows) out of the
//     bundled `dist/`, so `/_vercel/speed-insights/script.js` is a path the
//     asset protocol has nothing to answer with. Beyond the mechanics: the
//     desktop app is the offline one. It has no telemetry, and adding some by
//     way of a web analytics package is not how it would get any.
//
//  2. IT MUST NOT ADD A DEPENDENCY. The '@vercel/speed-insights' package used
//     to be imported here and was nothing but trouble for a plain, unbundled,
//     desktop-shipping app like this one:
//
//       - Its bare specifier has to resolve. Vite fails the whole module at
//         transform time when the package is not installed, so a stale
//         `node_modules` took the editor down with a 500 rather than quietly
//         skipping a metric — and `npm install` is not always available to the
//         person trying to start the app.
//       - The raw web deployments (rhizo_server.py, any plain static host)
//         serve `main.js` and this module to the browser UNBUNDLED, so a bare
//         specifier is unresolvable there at runtime too.
//       - Under a development NODE_ENV it swaps the same-origin script for
//         `https://va.vercel-scripts.com/...`, which `script-src 'self'` — the
//         policy every page ships, pinned by tests/editorCspEndpoints.test.js —
//         refuses outright.
//
//     For an app with no framework router, the package's entire contribution is
//     the <script> tag below; everything else in it is Next/Nuxt/SvelteKit route
//     bookkeeping. So append the tag directly. Same endpoint, same data, nothing
//     to install, and nothing that can fail before the origin check runs.
//
// So: check the origin first, then inject. Nothing here throws and nothing here
// is awaited by a caller — with the script blocked or the network down, the app
// is unchanged and the metric is simply not collected.

import { isTauri } from './isTauri.js';

/**
 * The Vercel edge route that serves the Web Vitals collector. Same-origin, so
 * `script-src 'self'` allows it; it beacons to `/_vercel/speed-insights/vitals`
 * on the same origin, which `connect-src 'self'` allows for the same reason.
 */
export const SPEED_INSIGHTS_SCRIPT = '/_vercel/speed-insights/script.js';

/**
 * Hosts that never have a Vercel edge behind them: a developer's machine, the
 * Python server, and — the reason this list matters as well as isTauri() —
 * Windows Tauri, which serves the app from `http://tauri.localhost` and so
 * looks like an ordinary http origin to every other check here.
 */
function isLocalHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

/**
 * Is this page one Speed Insights can actually report on?
 *
 * @param {{ isTauri?: boolean, location?: { protocol?: string, hostname?: string } }} [env]
 *   injectable for the tests; defaults to the live page.
 * @returns {boolean}
 */
export function speedInsightsApplies(env) {
  const inTauri = env ? env.isTauri : isTauri();
  const location = env ? env.location : globalThis.window?.location;

  if (!location) return false;
  if (inTauri) return false;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
  return !isLocalHost(location.hostname ?? '');
}

/**
 * Start Speed Insights, if this is a page it belongs on.
 *
 * @param {{ isTauri?: boolean, location?: object, document?: Document }} [env]
 *   injectable for the tests; defaults to the live page.
 * @returns {boolean} whether the script was injected. Nobody needs the answer
 *   at runtime — it is there so the tests can assert the decision.
 */
export function initSpeedInsights(env) {
  if (!speedInsightsApplies(env)) return false;

  const doc = env?.document ?? globalThis.document;
  if (!doc?.head) return false;

  // Called from three entry points (main.js, the viewer, the landing page) and
  // only ever one page at a time, but a second tag would mean double-counted
  // samples, so make it idempotent rather than assume.
  if (doc.head.querySelector(`script[src="${SPEED_INSIGHTS_SCRIPT}"]`)) return false;

  // The collector pushes into `window.si` before its own script has parsed and
  // flushes the queue on load; without the stub those early calls throw.
  const win = doc.defaultView ?? globalThis.window;
  if (win && !win.si) {
    win.si = function speedInsightsQueue(...params) {
      win.siq = win.siq || [];
      win.siq.push(params);
    };
  }

  // Deferred, and with no onerror handler: a content blocker, an ad blocker or
  // an offline tab means the script never runs, which means no metrics and
  // nothing else. That is the whole failure mode, and it needs no handling.
  const script = doc.createElement('script');
  script.src = SPEED_INSIGHTS_SCRIPT;
  script.defer = true;
  doc.head.appendChild(script);

  return true;
}
