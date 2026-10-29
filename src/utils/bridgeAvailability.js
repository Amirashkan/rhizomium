// src/utils/bridgeAvailability.js
//
// OSC in, NDI out and Live Input reach the outside world through the desktop
// app's own connection service (src-tauri/src/bridge): a webview cannot open
// UDP sockets or load NDI, the app can. The web editor has no such service, so
// every client asks here before it connects, and the UI uses the same message
// to say why the control is unavailable.
//
// The service is not running until something needs it: withBridge() starts it
// on first use (the `start_bridge` command) and then connects.

import { isTauri } from './isTauri.js';

export const BRIDGES_DESKTOP_ONLY_MESSAGE =
  'OSC, NDI and Live Input are only available in the Rhizomium desktop app.';

/** The connection service's loopback port (bridge::PORT in the app). */
export const BRIDGE_PORT = 8767;

/** @returns {boolean} true when this runtime has the connection service. */
export function bridgesAvailable() {
  return isTauri();
}

/**
 * WebSocket URL of one of the service's endpoints ('osc', 'video').
 *
 * Always loopback: the service runs inside the app, and the app's page host is
 * not a network host — `tauri.localhost` on Windows, `localhost` under the
 * `tauri:` scheme on macOS/Linux — so a URL built from `location.hostname`
 * would point at nothing (and at a host the desktop CSP does not allow).
 */
export function bridgeUrl(path) {
  return `ws://127.0.0.1:${BRIDGE_PORT}/${path}`;
}

let started = false;
let starting = null;

/**
 * Run `connect` once the connection service is up, starting it the first time.
 * Synchronous when it is already up; `fail` gets an Error saying why it could
 * not start (another program on its port, usually).
 */
export function withBridge(connect, fail) {
  const invoke = typeof window !== 'undefined' ? window.__TAURI_INTERNALS__?.invoke : undefined;
  if (started || typeof invoke !== 'function') {
    connect();
    return;
  }
  if (!starting) {
    starting = Promise.resolve(invoke('start_bridge')).then(
      () => {
        started = true;
        starting = null;
      },
      (error) => {
        starting = null;
        throw new Error(typeof error === 'string' ? error : error?.message || String(error));
      },
    );
  }
  starting.then(connect, fail);
}
