// src/utils/bridgeAvailability.js
//
// The local bridges — OSC in (osc_bridge_server.py), NDI out
// (ndi_bridge_server.py) and Video In (video_in_bridge_server.py) — are a
// desktop-app feature. The web editor never opens a socket to them, so every
// bridge client asks here before it connects, and the UI uses the same message
// to say why the control is unavailable.

import { isTauri } from './isTauri.js';

export const BRIDGES_DESKTOP_ONLY_MESSAGE =
  'Bridges (OSC, NDI, Video In) are only available in the Rhizomium desktop app.';

/** @returns {boolean} true when this runtime may connect to a local bridge. */
export function bridgesAvailable() {
  return isTauri();
}

/**
 * Default WebSocket URL for a local bridge on `port`.
 *
 * Always loopback: the bridges run on the same machine as the desktop app,
 * and the app's page host is not a network host — `tauri.localhost` on
 * Windows, `localhost` under the `tauri:` scheme on macOS/Linux — so building
 * the URL from `location.hostname` points the socket at nothing (and at a
 * host the desktop CSP does not allow).
 */
export function bridgeUrl(port) {
  return `ws://127.0.0.1:${port}/ws`;
}
