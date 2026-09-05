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
//     asset protocol has nothing to answer with, and under `tauri dev` the
//     library asks for `https://va.vercel-scripts.com/...` instead, which
//     `script-src 'self'` refuses outright — the same policy every page ships
//     and tests/editorCspEndpoints.test.js pins. Beyond the mechanics: the
//     desktop app is the offline one. It has no telemetry, and adding some by
//     way of a web analytics package is not how it would get any.
//
//  2. THE PACKAGE MUST BE REACHED THROUGH DYNAMIC import(). '@vercel/speed-
//     insights' is a bare specifier, and the raw web deployments (the Python
//     server in rhizo_server.py, any plain static host) serve `main.js` and
//     this module to the browser UNBUNDLED — editor/index.html loads
//     `../main.js` as a module script. A static bare import there is not a
//     degraded feature, it is an unresolvable specifier that fails the whole
//     module graph and leaves the editor a blank page. Every other third-party
//     import in this tree is dynamic for exactly this reason; see the same
//     note in openExternal.js, isTauri.js, AutosaveStore.js and ScreenWindow.js.
//
// So: check the origin first, then load. Nothing here throws and nothing here
// is awaited by a caller — with the package missing, the network down or the
// script blocked, the app is unchanged and the metric is simply not collected.

import { isTauri } from './isTauri.js';

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
 * @returns {Promise<boolean>} whether the package was loaded and injected.
 *   Nobody needs the answer at runtime — it is there so the tests can await
 *   the decision rather than race it.
 */
export async function initSpeedInsights() {
  if (!speedInsightsApplies()) return false;

  try {
    const { injectSpeedInsights } = await import('@vercel/speed-insights');
    injectSpeedInsights();
    return true;
  } catch {
    // Unresolvable on an unbundled host, blocked by a content blocker, offline:
    // all of them mean no metrics, none of them mean a broken editor.
    return false;
  }
}
