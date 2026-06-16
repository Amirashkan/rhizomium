// src/ui/secondMonitorFrameChannel.js
//
// Shared BroadcastChannel protocol between the editor (the frame source) and the
// second-monitor receiver page.
//
// In the Tauri/desktop build the output runs in a separate native
// WebviewWindow with its own JS context, so the editor cannot draw into it
// directly the way the browser popup path does. Instead the editor broadcasts
// mirrored frames over a same-origin BroadcastChannel and the receiver paints
// them. BroadcastChannel works between Tauri v2 windows of the same origin
// (well supported on the WebView2/Windows target this app prioritises).

export const SECOND_MONITOR_CHANNEL = 'rhizomium:second-monitor';

/** Message `type` values exchanged over {@link SECOND_MONITOR_CHANNEL}. */
export const SecondMonitorMessage = Object.freeze({
  FRAME: 'frame',   // editor → receiver: { bitmap: ImageBitmap, sw, sh }
  CLOSE: 'close',   // editor → receiver: shut the window down
  CLOSED: 'closed', // receiver → editor: the window closed (Esc / native close)
  READY: 'ready',   // receiver → editor: page loaded and now listening
});

/**
 * Open the shared BroadcastChannel.
 * @returns {BroadcastChannel|null} the channel, or null where unsupported.
 */
export function openSecondMonitorChannel() {
  if (typeof BroadcastChannel !== 'function') return null;
  try {
    return new BroadcastChannel(SECOND_MONITOR_CHANNEL);
  } catch (_) {
    return null;
  }
}
