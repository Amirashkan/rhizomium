// src/ui/SecondMonitorViewer.js
//
// Second-monitor full-screen viewer.
//
// Opens a borderless popup window on a second display and mirrors the live
// `#gpu-canvas` into it, letterboxed and centred on black, at the monitor's
// refresh rate. This is the pristine "performance output" surface: just the
// visual, no editor chrome.
//
// Display targeting uses the Window Management API (`getScreenDetails()`) when
// the browser grants it, so the popup is placed on and sized to a real second
// display. When that API is unavailable (or permission is denied) it falls back
// to a centred popup the user can drag onto their second monitor.
//
// This feature is wired up only in the Vite/desktop build (see isViteBuild.js);
// the raw web deployments do not expose it. The Tauri desktop app uses a
// separate native-window backend (see TauriSecondMonitorViewer.js), because its
// WebView blocks window.open(); this popup backend serves the browser dev build.

import { letterboxRect } from './letterbox.js';

export class SecondMonitorViewer {
  /**
   * @param {HTMLCanvasElement} sourceCanvas  the live GPU canvas to mirror
   * @param {Object} [options]
   * @param {string} [options.windowName]      window.open name (one viewer at a time)
   * @param {(message: string, kind?: string) => void} [options.onStatus]
   * @param {(active: boolean) => void} [options.onActiveChange]
   */
  constructor(sourceCanvas, options = {}) {
    this.sourceCanvas = sourceCanvas;
    this.windowName = options.windowName || 'RhizomiumSecondMonitor';
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    this.onActiveChange = typeof options.onActiveChange === 'function'
      ? options.onActiveChange
      : () => {};

    this.viewerWindow = null;   // the opened popup
    this.outCanvas = null;      // the 2D mirror canvas inside the popup
    this.outCtx = null;
    this.rafId = null;          // mirror loop (driven by the editor window)
    this._pollId = null;        // detects the popup being closed by the user
    this._targetScreen = null;  // ScreenDetailed object, for fullscreen targeting
    this._onPopupResize = null;
    this._onPopupKeyDown = null;
  }

  /** True while the viewer popup is open. */
  get isActive() {
    return !!(this.viewerWindow && !this.viewerWindow.closed);
  }

  /** Whether multi-display placement is available in this browser. */
  static supportsDisplayPlacement() {
    return typeof window !== 'undefined' && (
      typeof window.getScreenDetails === 'function' ||
      !!(window.screen && typeof window.screen.getScreenDetails === 'function')
    );
  }

  /** Open the viewer if closed, close it if open. @returns {Promise<boolean>} active state */
  async toggle() {
    if (this.isActive) {
      this.close();
      return false;
    }
    await this.open();
    return this.isActive;
  }

  /**
   * Open the viewer on a second display (or a fallback popup) and start mirroring.
   * Must be called from a user gesture so the popup is not blocked.
   */
  open() {
    if (this.isActive) {
      try { this.viewerWindow.focus(); } catch (_) { /* ignore */ }
      return Promise.resolve();
    }
    if (!this.sourceCanvas) {
      this.onStatus('No render canvas available to mirror', 'error');
      return Promise.resolve();
    }

    // Open the popup synchronously so it stays tied to the click's user
    // activation. Any `await` before window.open() — e.g. the Window Management
    // permission prompt in getScreenDetails() — spends the gesture, and the
    // browser then blocks the popup. Placement onto a second display is async,
    // so it happens *after* the window exists (see _placeOnSecondScreen).
    const features =
      'popup=yes,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes,width=1280,height=720';
    const win = window.open('about:blank', this.windowName, features);
    if (!win) {
      this.onStatus('Popup blocked — allow popups to use the second-monitor viewer', 'error');
      return Promise.resolve();
    }
    this.viewerWindow = win;
    this._writeViewerDocument(win);

    this.outCanvas = win.document.getElementById('second-monitor-output');
    this.outCtx = this.outCanvas ? this.outCanvas.getContext('2d') : null;
    if (!this.outCtx) {
      this.onStatus('Failed to create second-monitor output surface', 'error');
      this.close();
      return Promise.resolve();
    }

    this._resizeOutput();
    this._onPopupResize = () => this._resizeOutput();
    win.addEventListener('resize', this._onPopupResize);

    this._onPopupKeyDown = (e) => {
      if (e.key === 'Escape') this.close();
    };
    win.addEventListener('keydown', this._onPopupKeyDown);

    this._startMirror();
    this._watchForClose();
    this.onActiveChange(true);
    this.onStatus('Second-monitor viewer opened');

    // Move/resize onto a real second display when the browser allows it.
    return this._placeOnSecondScreen();
  }

  /**
   * Move/resize the open popup onto a detected external display via the Window
   * Management API, then attempt true fullscreen. Best-effort: if no second
   * display is found (or permission is denied) the popup stays where the browser
   * put it and the user can drag it across.
   */
  async _placeOnSecondScreen() {
    const bounds = await this._resolveSecondScreenBounds();
    if (!bounds || !this.isActive) return;

    const win = this.viewerWindow;
    try {
      if (typeof win.moveTo === 'function') win.moveTo(bounds.left, bounds.top);
      if (typeof win.resizeTo === 'function') win.resizeTo(bounds.width, bounds.height);
    } catch (_) {
      /* placement is best-effort */
    }
    this._resizeOutput();
    this.onStatus('Second-monitor viewer moved to external display');

    // Best-effort true fullscreen (removes the OS title bar). The filling popup
    // already covers the display if the browser blocks programmatic fullscreen,
    // so failures are silent.
    this._tryFullscreen();
  }


  /** Close the viewer and stop mirroring. */
  close() {
    this._stopMirror();
    this._stopWatch();

    const win = this.viewerWindow;
    if (win) {
      try {
        if (this._onPopupResize) win.removeEventListener('resize', this._onPopupResize);
        if (this._onPopupKeyDown) win.removeEventListener('keydown', this._onPopupKeyDown);
      } catch (_) { /* window may already be gone */ }
      try { if (!win.closed) win.close(); } catch (_) { /* ignore */ }
    }

    const wasActive = !!this.viewerWindow;
    this.viewerWindow = null;
    this.outCanvas = null;
    this.outCtx = null;
    this._onPopupResize = null;
    this._onPopupKeyDown = null;
    this._targetScreen = null;

    if (wasActive) {
      this.onActiveChange(false);
      this.onStatus('Second-monitor viewer closed');
    }
  }

  /** Tear down completely (alias of close for symmetry with other managers). */
  destroy() {
    this.close();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Resolve the bounds of a sensible second display via the Window Management
   * API. Prefers an external display that is not the editor's current screen.
   * @returns {Promise<{left:number,top:number,width:number,height:number}|null>}
   */
  async _resolveSecondScreenBounds() {
    const getDetails = typeof window.getScreenDetails === 'function'
      ? () => window.getScreenDetails()
      : (window.screen && typeof window.screen.getScreenDetails === 'function')
        ? () => window.screen.getScreenDetails()
        : null;
    if (!getDetails) return null;

    try {
      const details = await getDetails();
      const screens = details.screens || [];
      const current = details.currentScreen;
      const target =
        screens.find((s) => s !== current && !s.isInternal) ||
        screens.find((s) => s !== current) ||
        null;
      if (!target) return null;

      this._targetScreen = target;
      return {
        left: target.availLeft ?? target.left ?? 0,
        top: target.availTop ?? target.top ?? 0,
        width: target.availWidth ?? target.width ?? 1920,
        height: target.availHeight ?? target.height ?? 1080,
      };
    } catch (err) {
      // Permission denied or API unavailable — fall back to a draggable popup.
      console.warn('[SecondMonitorViewer] getScreenDetails unavailable:', err?.message || err);
      this._targetScreen = null;
      return null;
    }
  }

  /** Write the minimal black, chrome-free viewer page into the popup. */
  _writeViewerDocument(win) {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Rhizomium — Output</title>
  <style>
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
    body { cursor: none; }
    #second-monitor-output { display: block; width: 100vw; height: 100vh; background: #000; }
    #second-monitor-hint {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
      font: 13px system-ui, -apple-system, sans-serif; color: rgba(255, 255, 255, 0.55);
      background: rgba(0, 0, 0, 0.45); padding: 6px 12px; border-radius: 6px;
      pointer-events: none; transition: opacity 0.5s ease; z-index: 2;
    }
  </style>
</head>
<body>
  <canvas id="second-monitor-output"></canvas>
  <div id="second-monitor-hint">Second-monitor output · Esc to close · F or double-click for fullscreen</div>
  <script>
    (function () {
      var h = document.getElementById('second-monitor-hint');
      setTimeout(function () { if (h) h.style.opacity = '0'; }, 4000);
      // Toggle fullscreen from inside the popup so the request carries this
      // window's own user activation — the reliable path. (The opener's
      // best-effort attempt can lose activation across the screen-detection
      // await, so the OS title bar may otherwise remain.)
      function toggleFullscreen() {
        try {
          if (document.fullscreenElement) {
            if (document.exitFullscreen) document.exitFullscreen();
          } else if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
          }
        } catch (e) { /* ignore */ }
      }
      window.addEventListener('keydown', function (e) {
        if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFullscreen(); }
      });
      window.addEventListener('dblclick', toggleFullscreen);
    })();
  </script>
</body>
</html>`;
    const doc = win.document;
    doc.open();
    doc.write(html);
    doc.close();
  }

  /** Size the popup's backing canvas to its device pixels for crisp output. */
  _resizeOutput() {
    if (!this.viewerWindow || !this.outCanvas) return;
    const w = this.viewerWindow.innerWidth || 1280;
    const h = this.viewerWindow.innerHeight || 720;
    const dpr = this.viewerWindow.devicePixelRatio || 1;
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (this.outCanvas.width !== bw) this.outCanvas.width = bw;
    if (this.outCanvas.height !== bh) this.outCanvas.height = bh;
    this.outCanvas.style.width = w + 'px';
    this.outCanvas.style.height = h + 'px';
  }

  /**
   * Mirror the source canvas into the popup every animation frame. Driven by the
   * popup's own rAF (see _raf): the popup lives on the second display, so its rAF
   * runs at that display's refresh rate and keeps firing even when the editor
   * window is occluded or minimised — so the performance output never freezes.
   */
  _startMirror() {
    if (this.rafId != null) return;
    const draw = () => {
      if (!this.isActive || !this.outCtx) {
        this.rafId = null;
        return;
      }
      const src = this.sourceCanvas;
      const cw = this.outCanvas.width;
      const ch = this.outCanvas.height;

      this.outCtx.fillStyle = '#000';
      this.outCtx.fillRect(0, 0, cw, ch);

      // Letterbox: preserve the source aspect ratio, centred on black.
      const { dx, dy, dw, dh } = letterboxRect(src.width, src.height, cw, ch);
      if (dw > 0 && dh > 0) {
        try {
          this.outCtx.drawImage(src, dx, dy, dw, dh);
        } catch (_) {
          // A transient draw failure (e.g. canvas mid-resize) — skip this frame.
        }
      }

      this.rafId = this._raf(draw);
    };
    this.rafId = this._raf(draw);
  }

  _stopMirror() {
    if (this.rafId != null) {
      this._cancelRaf(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Schedule a frame on the popup when it exposes rAF (the common case in real
   * browsers), so mirroring is paced by the second display and survives the
   * editor window being hidden; fall back to the editor window's rAF otherwise
   * (e.g. in tests, or before the popup is fully wired).
   */
  _raf(cb) {
    const w = this.viewerWindow;
    try {
      if (w && typeof w.requestAnimationFrame === 'function') return w.requestAnimationFrame(cb);
    } catch (_) { /* window gone — fall back */ }
    return requestAnimationFrame(cb);
  }

  _cancelRaf(id) {
    const w = this.viewerWindow;
    try {
      if (w && typeof w.cancelAnimationFrame === 'function') { w.cancelAnimationFrame(id); return; }
    } catch (_) { /* window gone — fall back */ }
    try { cancelAnimationFrame(id); } catch (_) { /* ignore */ }
  }

  /** Detect the popup being closed by the user (no event fires reliably). */
  _watchForClose() {
    this._stopWatch();
    this._pollId = setInterval(() => {
      if (!this.isActive) this.close();
    }, 500);
  }

  _stopWatch() {
    if (this._pollId != null) {
      clearInterval(this._pollId);
      this._pollId = null;
    }
  }

  /** Best-effort native fullscreen on the target display; failures are silent. */
  _tryFullscreen() {
    try {
      const el = this.viewerWindow?.document?.documentElement;
      if (!el || typeof el.requestFullscreen !== 'function') return;
      const opts = this._targetScreen ? { screen: this._targetScreen } : undefined;
      const result = el.requestFullscreen(opts);
      if (result && typeof result.catch === 'function') {
        result.catch(() => { /* filling popup remains */ });
      }
    } catch (_) {
      /* filling popup remains */
    }
  }
}
