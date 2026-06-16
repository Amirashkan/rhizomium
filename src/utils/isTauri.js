// src/utils/isTauri.js
//
// Browser-safe Tauri runtime detection.
//
// Checks the globals Tauri injects into every webview it creates, WITHOUT
// importing '@tauri-apps/api' — that is a bare module specifier the raw,
// un-bundled web deployments (Python server, static Vercel host) cannot
// resolve, so importing it here would break the editor there. Only the
// Vite/desktop build ever runs inside Tauri, where these globals exist.
//
// Use this to gate the Tauri-native second-monitor path (a real OS window on
// the second display) versus the browser popup path.

/**
 * @returns {boolean} true when running inside the Tauri desktop WebView.
 */
export function isTauri() {
  return (
    typeof window !== 'undefined' &&
    !!(window.__TAURI_INTERNALS__ || window.__TAURI__ || window.isTauri)
  );
}
