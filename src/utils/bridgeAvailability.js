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
