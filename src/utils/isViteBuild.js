// src/utils/isViteBuild.js
//
// Detect whether the app is running as the "Vite version" (the bundled build
// used by `npm run dev` and the Tauri desktop app) as opposed to the raw web
// deployments.
//
// How it works:
//   Vite injects `import.meta.env` (an object with MODE/DEV/PROD/…) into every
//   module it processes. The two non-Vite ways this editor is served — the
//   Python dev server (`rhizo_server.py`) and the static Vercel host
//   (`vercel.json` has buildCommand: null, outputDirectory: ".") — ship the raw
//   source files untouched, so in those environments `import.meta.env` is
//   `undefined`. That makes its mere presence a reliable signal for the Vite
//   build.
//
// Use this to gate features that should only exist in the Vite/desktop build
// (e.g. the second-monitor full-screen viewer).

let _cached = null;

/**
 * @returns {boolean} true when served/built through Vite (dev server or Tauri),
 *   false on the raw Python-server / Vercel web deployments.
 */
export function isViteBuild() {
  if (_cached !== null) return _cached;
  try {
    _cached = typeof import.meta !== 'undefined' && !!import.meta.env;
  } catch (_) {
    // `import.meta` is always valid inside an ES module, but guard anyway so a
    // hostile transform can never turn this into a hard error.
    _cached = false;
  }
  return _cached;
}
