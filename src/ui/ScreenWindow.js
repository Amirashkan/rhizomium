// src/ui/ScreenWindow.js
//
// One output window in a multi-screen rig: a real, borderless, fullscreen native
// WebviewWindow placed on a chosen display, running the receiver page for one
// screen.
//
// This is only the WINDOW. What the window SHOWS — the shader, the uniforms, the
// compute state — is broadcast once for the whole rig by TauriSecondMonitorViewer
// over a shared channel, because every screen renders the same composition. The
// only thing this file tells a window about itself is which screen it is, and it
// does that in the URL, so the receiver knows before its first message (see
// screenReceiverUrl / screenIdFromUrl).
//
// Display placement is the part a studio actually cares about: a rig is aimed at
// specific projectors, and "the second monitor" stops being a useful answer the
// moment there are three. A screen therefore names its display by index, and
// only falls back to "any display that is not the editor's, that no other screen
// has claimed" when it has not been told.
//
// All '@tauri-apps/api' access is via dynamic import() so importing this module
// stays safe on the raw web deployments, which serve the source un-bundled and
// cannot resolve bare specifiers.

import { DISPLAY_AUTO, MAIN_SCREEN_ID } from '../screens/ScreenModel.js';
import { screenReceiverUrl } from './secondMonitorFrameChannel.js';

/** How long to wait for Tauri to confirm the window before giving up. */
const CREATE_TIMEOUT_MS = 5000;
/** Safety net: reveal the window even if the receiver's first-paint show() never fires. */
const REVEAL_FALLBACK_MS = 1500;

/**
 * Read the display layout once, so a whole rig can be placed against one
 * consistent snapshot rather than re-querying per window.
 *
 * @param {object} windowApi the '@tauri-apps/api/window' module
 * @returns {Promise<{monitors: object[], editorIndex: number}>} the displays, and
 *   which of them the editor is on (-1 when that cannot be determined)
 */
export async function readDisplayLayout(windowApi) {
  try {
    const monitors = await windowApi.availableMonitors();
    if (!Array.isArray(monitors) || monitors.length === 0) {
      return { monitors: [], editorIndex: -1 };
    }
    let current = null;
    try { current = await windowApi.currentMonitor(); } catch { /* placement still works */ }
    const samePos = (a, b) =>
      a && b && a.position?.x === b.position?.x && a.position?.y === b.position?.y;
    return { monitors, editorIndex: monitors.findIndex((m) => samePos(m, current)) };
  } catch (err) {
    console.warn('[ScreenWindow] monitor query failed:', err?.message || err);
    return { monitors: [], editorIndex: -1 };
  }
}

/**
 * Choose the display for one screen.
 *
 * An explicit `displayIndex` is honoured whenever that display exists — including
 * the editor's own, which is what an artist asks for when they want to check an
 * output without a projector plugged in.
 *
 * Automatic placement walks the displays the editor is not on and takes the first
 * one no other screen has claimed. That is what makes "add three screens" land on
 * three different projectors instead of stacking three windows on one. When the
 * rig has more screens than the machine has spare displays, the extras return
 * null and open as ordinary movable windows rather than fighting over a display.
 *
 * @param {object[]} monitors displays, in the order the OS reports them
 * @param {number} editorIndex which display the editor is on, or -1
 * @param {number} displayIndex the screen's requested display, or DISPLAY_AUTO
 * @param {Set<number>} taken display indices already claimed by other screens
 * @returns {{monitor: object, index: number}|null} the placement, or null for none
 */
export function resolveScreenDisplay(monitors, editorIndex, displayIndex, taken = new Set()) {
  if (!Array.isArray(monitors) || monitors.length === 0) return null;
  if (Number.isFinite(displayIndex) && displayIndex >= 0) {
    const monitor = monitors[displayIndex];
    return monitor ? { monitor, index: displayIndex } : null;
  }
  for (let i = 0; i < monitors.length; i++) {
    if (i === editorIndex || taken.has(i)) continue;
    return { monitor: monitors[i], index: i };
  }
  return null;
}

/**
 * Window options placing a borderless window over a whole display, or a centred
 * movable one when there is no display to take.
 *
 * Monitor bounds come back in physical pixels and window options are in logical
 * pixels, so the scale factor has to be divided out or the window lands at the
 * wrong size on any display that is not at 100%.
 *
 * @param {object|null} monitor the display to cover, or null
 * @returns {object} partial WebviewWindow options
 */
export function windowPlacementOptions(monitor) {
  if (!monitor) return { width: 1280, height: 720, center: true };
  const s = monitor.scaleFactor || 1;
  return {
    x: Math.round((monitor.position?.x || 0) / s),
    y: Math.round((monitor.position?.y || 0) / s),
    width: Math.max(1, Math.round((monitor.size?.width || 1920) / s)),
    height: Math.max(1, Math.round((monitor.size?.height || 1080) / s)),
  };
}

/** Read a Tauri error event's payload as a message. */
function tauriErr(ev) {
  const p = ev && typeof ev === 'object' ? ev.payload : ev;
  if (p == null) return 'window error';
  return typeof p === 'string' ? p : JSON.stringify(p);
}

/**
 * Open one screen's output window.
 *
 * @param {object} opts
 * @param {object} opts.screen           the screen record (id, name, displayIndex)
 * @param {string} opts.pageUrl          the receiver page URL
 * @param {object[]} opts.monitors       displays from {@link readDisplayLayout}
 * @param {number} opts.editorIndex      the editor's display index
 * @param {Set<number>} [opts.taken]     display indices already claimed
 * @returns {Promise<{win: object, label: string, displayIndex: number,
 *   fullscreen: boolean, unlistenEditorClose: (()=>void)|null}>}
 */
export async function openScreenWindow({ screen, pageUrl, monitors, editorIndex, taken }) {
  const [{ WebviewWindow }, windowApi] = await Promise.all([
    import('@tauri-apps/api/webviewWindow'),
    import('@tauri-apps/api/window'),
  ]);

  const placement = resolveScreenDisplay(
    monitors, editorIndex, screen.displayIndex ?? DISPLAY_AUTO, taken,
  );
  const monitor = placement ? placement.monitor : null;
  const label = screenWindowLabel(screen.id);

  const options = {
    url: screenReceiverUrl(pageUrl, screen.id),
    // The title is what an OS window switcher shows. In a rig of several, saying
    // which screen this is beats three identical entries called "Output".
    title: screen.name ? `Rhizomium — ${screen.name}` : 'Rhizomium — Output',
    decorations: !monitor,     // borderless once it owns a display
    alwaysOnTop: !!monitor,
    skipTaskbar: !!monitor,
    focus: true,
    visible: false,                  // reveal only after the receiver's first paint
    backgroundColor: [0, 0, 0, 255], // black RGBA; secondary defence against a white flash
    ...windowPlacementOptions(monitor),
  };

  // Reuse-proof: drop a window lingering under our label from a prior session.
  try {
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) { try { await existing.close(); } catch { /* ignore */ } }
  } catch { /* getByLabel best-effort */ }

  const win = new WebviewWindow(label, options);
  await new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
    win.once('tauri://created', () => done(resolve));
    win.once('tauri://error', (ev) => done(reject, new Error(tauriErr(ev))));
    setTimeout(() => done(reject, new Error('window creation timed out')), CREATE_TIMEOUT_MS);
  });

  // Output windows are separate top-level windows, so closing the editor would
  // leave them orphaned (and keep the app alive). Close this one with the editor.
  let unlistenEditorClose = null;
  try {
    const mainWin = windowApi.getCurrentWindow?.();
    if (mainWin && typeof mainWin.onCloseRequested === 'function') {
      unlistenEditorClose = await mainWin.onCloseRequested(() => {
        try { win.close(); } catch { /* already gone */ }
      });
    }
  } catch { /* close-with-editor is best-effort */ }

  // True OS fullscreen on the target display. The borderless window already fills
  // the monitor, so a failure here is non-fatal.
  if (monitor) {
    try { await win.setFullscreen(true); } catch { /* borderless fill remains */ }
  }
  setTimeout(() => { win.show().catch(() => {}); }, REVEAL_FALLBACK_MS);

  return {
    win,
    label,
    displayIndex: placement ? placement.index : -1,
    fullscreen: !!monitor,
    unlistenEditorClose,
  };
}

/**
 * The Tauri window label for a screen.
 *
 * Labels must be unique per window and stable across a session. The main screen
 * keeps the label the single-output window has always used, so nothing about a
 * one-screen session changes.
 * @param {string} screenId
 * @returns {string}
 */
export function screenWindowLabel(screenId) {
  return screenId === MAIN_SCREEN_ID ? 'second-monitor' : `output-${screenId}`;
}
