// src/core/tauriSplash.js
//
// The editor's half of the desktop launch sequence.
//
// In the desktop app the main window is the editor and it starts hidden, with
// a borderless splash window (splash.html) on screen in its place. Calling
// `app_ready` is what ends that: Rust shows the editor window and closes the
// splash (see src-tauri/src/lib.rs).
//
// Nothing here runs on the web. isTauri() gates it, and '@tauri-apps/api' is
// reached through dynamic import() because it is a bare specifier that the
// un-bundled deployments cannot resolve — the same rule the rest of the Tauri
// integration follows (AutosaveStore.js, tauriFileOpen.js).

import { isTauri } from "../utils/isTauri.js";

let signalled = false;

/**
 * Tell the desktop shell the editor has finished booting.
 *
 * Call this on every exit from the boot path, including the ones that failed:
 * an editor that could not get a GPU device still needs its window on screen
 * to show the reason. Safe to call repeatedly and safe to call in a browser,
 * where it does nothing.
 *
 * Never throws — a splash that will not close is a bad startup, but a startup
 * that fails *because* the splash would not close is a worse one. If this call
 * cannot get through, the timeout in lib.rs reveals the editor anyway.
 *
 * @returns {Promise<void>}
 */
export async function signalAppReady() {
  if (signalled || !isTauri()) return;
  signalled = true;

  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("app_ready");
  } catch (error) {
    console.warn("[tauriSplash] Could not dismiss the launch window:", error);
  }
}
