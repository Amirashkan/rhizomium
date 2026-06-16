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
// the raw web deployments do not expose it.

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
  async open() {
    if (this.isActive) {
      try { this.viewerWindow.focus(); } catch (_) { /* ignore */ }
      return;
    }
    if (!this.sourceCanvas) {
      this.onStatus('No render canvas available to mirror', 'error');
      return;
    }

    const bounds = await this._resolveSecondScreenBounds();

    let features =
      'popup=yes,menubar=no,toolbar=no,location=no,status=no,scrollbars=no,resizable=yes';
    if (bounds) {
      features += `,left=${bounds.left},top=${bounds.top},width=${bounds.width},height=${bounds.height}`;
    } else {
      features += ',width=1280,height=720';
    }

    const win = window.open('about:blank', this.windowName, features);
    if (!win) {
      this.onStatus('Popup blocked — allow popups to use the second-monitor viewer', 'error');
      return;
    }
    this.viewerWindow = win;
    this._writeViewerDocument(win);

    this.outCanvas = win.document.getElementById('second-monitor-output');
    this.outCtx = this.outCanvas ? this.outCanvas.getContext('2d') : null;
    if (!this.outCtx) {
      this.onStatus('Failed to create second-monitor output surface', 'error');
      this.close();
      return;
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
    this.onStatus(
      bounds ? 'Second-monitor viewer opened on external display' : 'Second-monitor viewer opened',
    );

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
  <div id="second-monitor-hint">Second-monitor output · press Esc or close this window to stop</div>
  <script>
    setTimeout(function () {
      var h = document.getElementById('second-monitor-hint');
      if (h) h.style.opacity = '0';
    }, 4000);
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
   * editor window's rAF: the editor stays visible on the primary display, so its
   * rAF runs at full rate even when the popup has focus — keeping output smooth.
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
      const sw = src.width;
      const sh = src.height;

      this.outCtx.fillStyle = '#000';
      this.outCtx.fillRect(0, 0, cw, ch);

      if (sw > 0 && sh > 0 && cw > 0 && ch > 0) {
        // Letterbox: preserve the source aspect ratio, centred on black.
        const scale = Math.min(cw / sw, ch / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        const dx = (cw - dw) / 2;
        const dy = (ch - dh) / 2;
        try {
          this.outCtx.drawImage(src, dx, dy, dw, dh);
        } catch (_) {
          // A transient draw failure (e.g. canvas mid-resize) — skip this frame.
        }
      }

      this.rafId = requestAnimationFrame(draw);
    };
    this.rafId = requestAnimationFrame(draw);
  }

  _stopMirror() {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
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
