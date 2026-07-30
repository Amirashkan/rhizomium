// The running Rhizomium version, for anything that has to identify this build
// to the outside world (currently the `generator` field of a published patch).
//
// `__APP_VERSION__` is substituted from package.json at build time by the Vite
// config. The `typeof` guard matters: the raw, un-bundled deployments (Python
// server, static host) never run that substitution, and a bare identifier would
// throw a ReferenceError there. See the same constraint in isTauri.js.

/** @type {string|null} Semver of this build, or null when it cannot be known. */
export const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null;
