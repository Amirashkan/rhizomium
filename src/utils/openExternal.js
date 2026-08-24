// src/utils/openExternal.js
//
// Open a page that is not part of the editor — the gallery's sign-in page, the
// pricing page, the publish page the upload endpoint hands back.
//
// On the web that is `window.open()`. In the desktop app it is not:
// `window.open()` is governed by the OS WebView and is blocked outright — it
// returns null and nothing appears. TauriSecondMonitorViewer.js works around
// the same block for the second display; this module is the general case.
//
// The consequence for the account was that every link out of the editor died
// silently in the desktop build. An artist who clicked "sign in" saw nothing
// happen, and there was no other route to a session.
//
// So in Tauri the page opens as a real WebviewWindow. Two properties of that
// window matter, and are the reason an account can work in the desktop app at
// all:
//
//   - Tauri's webviews share one cookie store, so a sign-in completed in this
//     window is a session the editor window's own fetches can use.
//   - The window is deliberately NOT listed in
//     src-tauri/capabilities/default.json, so the remote page it loads gets no
//     Tauri commands at all. It is a browser tab, not part of the application.
//
// '@tauri-apps/api' is reached through dynamic import() because it is a bare
// specifier the un-bundled deployments cannot resolve — the same rule the rest
// of the Tauri integration follows (AutosaveStore.js, tauriSplash.js).

import { isTauri } from './isTauri.js';

/** Labels have to be unique per window; anonymous opens get a fresh one. */
let anonymousCount = 0;

/**
 * The URL each label was last opened with.
 *
 * Tauri 2.11 has no `navigate()` — a webview window shows the URL it was
 * created with for as long as it lives. So a label that is already open can
 * only be *reused* when it is already showing the page being asked for;
 * reusing it for a different one focuses a window showing the wrong thing,
 * which is what happened to the pairing page when a sign-in window from
 * earlier in the session was still up under the same label.
 */
const openedUrls = new Map();

/** How long to wait for the webview to report itself created. */
const CREATE_TIMEOUT_MS = 5000;

/**
 * A handle on an opened page, or null when it could not be opened.
 *
 * `onClosed` is the part callers actually need: the sign-in flow has to know
 * when the artist is done with the gallery, and neither surface tells us that
 * any other way.
 *
 * @typedef {Object} ExternalPage
 * @property {() => Promise<void>} close
 * @property {(callback: () => void) => void} onClosed
 */

/**
 * Open `url` outside the editor.
 *
 * @param {string} url
 * @param {Object} [options]
 * @param {string} [options.label]  Tauri window label. Reusing one focuses the
 *   window already open when it is showing this same URL, and replaces it when
 *   it is showing a different one — a webview cannot be renavigated.
 * @param {string} [options.title]
 * @param {number} [options.width]
 * @param {number} [options.height]
 * @returns {Promise<ExternalPage|null>} null when the page could not be opened
 *   — a popup blocker on the web, a webview that refused in the desktop app.
 */
export async function openExternal(url, options = {}) {
  return isTauri() ? openInTauri(url, options) : openInBrowser(url);
}

function openInBrowser(url) {
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) return null;

  return {
    async close() {
      // 'noopener' means we may not be allowed to; then the artist closes it.
      try {
        opened.close();
      } catch {
        /* not ours to close */
      }
    },
    onClosed(callback) {
      // There is no close event across a tab boundary, so poll. Cheap, and it
      // stops the moment the tab goes.
      const timer = setInterval(() => {
        let closed = false;
        try {
          closed = opened.closed;
        } catch {
          // Cross-origin after 'noopener' — treat as gone rather than poll on.
          closed = true;
        }
        if (!closed) return;
        clearInterval(timer);
        callback();
      }, 1000);
    },
  };
}

async function openInTauri(url, options) {
  const label = options.label || `external-${++anonymousCount}`;

  try {
    const [{ WebviewWindow }, windowApi] = await Promise.all([
      import('@tauri-apps/api/webviewWindow'),
      import('@tauri-apps/api/window'),
    ]);

    // A second click on the same link should raise the window the artist
    // already has open, not deal them another copy of it — but only when it is
    // the same link. A window cannot be renavigated (see openedUrls), so one
    // showing a different page has to be replaced rather than focused.
    try {
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        if (openedUrls.get(label) === url) {
          await existing.setFocus();
          return tauriPage(existing);
        }
        await existing.close();
        openedUrls.delete(label);
      }
    } catch {
      /* getByLabel is best-effort; fall through and create one */
    }

    const created = new WebviewWindow(label, {
      url,
      title: options.title || 'Rhizomium',
      width: options.width || 1024,
      height: options.height || 768,
      center: true,
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => {
        if (settled) return;
        settled = true;
        fn(arg);
      };
      created.once('tauri://created', () => done(resolve));
      created.once('tauri://error', (event) =>
        done(reject, new Error(String(event?.payload ?? 'window creation failed'))),
      );
      setTimeout(() => done(reject, new Error('window creation timed out')), CREATE_TIMEOUT_MS);
    });

    openedUrls.set(label, url);

    // A top-level window outlives the editor's own, which on Windows leaves the
    // application running with no editor in it. Close it with the editor, the
    // same way the second-monitor output window is closed.
    closeWithEditor(created, windowApi);

    return tauriPage(created);
  } catch (error) {
    console.warn('[openExternal] Could not open', url, error);
    return null;
  }
}

function closeWithEditor(win, windowApi) {
  try {
    const editorWindow = windowApi.getCurrentWindow?.();
    editorWindow?.onCloseRequested?.(() => {
      win.close().catch(() => {});
    });
  } catch (error) {
    console.warn('[openExternal] Could not tie the window to the editor:', error);
  }
}

function tauriPage(win) {
  return {
    async close() {
      try {
        await win.close();
      } catch (error) {
        // Already gone, most likely — the artist closed it themselves.
        console.warn('[openExternal] Could not close the window:', error);
      }
    },
    onClosed(callback) {
      let done = false;
      const fire = () => {
        if (done) return;
        done = true;
        callback();
      };
      // Both events, because which one arrives depends on how the window went:
      // the title-bar X raises close-requested, a programmatic close does not.
      Promise.resolve(win.once('tauri://destroyed', fire)).catch(() => {});
      Promise.resolve(win.once('tauri://close-requested', fire)).catch(() => {});
    },
  };
}
