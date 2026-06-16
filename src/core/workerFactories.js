// src/core/workerFactories.js
//
// Centralised Web Worker construction.
//
// Each worker is created with the native `new Worker(new URL('...', import.meta.url), ...)`
// form using a STRING LITERAL path. This is important for two reasons:
//
//   1. Web build (raw ES modules, no bundler): the URL resolves natively against
//      this module's location, i.e. /workers/<name>.js, exactly as before.
//   2. Tauri build (Vite/Rollup): Vite can only statically detect and bundle a
//      worker — together with its own import graph — when it sees this exact
//      literal shape. A dynamic path (e.g. a variable) would be left unbundled
//      and break in the packaged app.
//
// Paths are relative to this file (src/core/), so '../../workers/...' -> /workers/...
const FACTORIES = {
  previewComputer: () =>
    new Worker(new URL('../../workers/preview-computer-worker.js', import.meta.url), { type: 'module' }),
  parameterExpression: () =>
    new Worker(new URL('../../workers/parameter-expression-worker.js', import.meta.url), { type: 'module' }),
  saveLoad: () =>
    new Worker(new URL('../../workers/save-load-worker.js', import.meta.url), { type: 'classic' }),
  undoManager: () =>
    new Worker(new URL('../../workers/undo-manager-worker.js', import.meta.url), { type: 'classic' }),
};

/** Returns true if a worker is registered under this name. */
export function hasWorker(name) {
  return Object.prototype.hasOwnProperty.call(FACTORIES, name);
}

/** Constructs (and returns) the Worker registered under `name`. */
export function createWorker(name) {
  const factory = FACTORIES[name];
  if (!factory) {
    throw new Error(`Unknown worker: ${name}`);
  }
  return factory();
}
