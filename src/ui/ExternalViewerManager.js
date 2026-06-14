// src/ui/ExternalViewerManager.js
//
// Single source of truth for the external "second monitor" viewer window.
//
// Responsibilities:
//   - Detect connected displays (Window Management API, with graceful fallback).
//   - Open the viewer (viewer-live.html) on the chosen display, sized to fill it.
//   - Track / focus / close the viewer window.
//
// Streaming of shader data to the viewer is handled separately by
// LiveShaderStream (BroadcastChannel) in main.js — this class only deals with
// the *window placement and fullscreen* side so both the menu button and the
// Output Display window can share one reliable implementation.

const DEFAULT_VIEWER_PATH = '/viewer-live.html';

export class ExternalViewerManager {
  constructor(options = {}) {
    this.viewerPath = options.viewerPath || DEFAULT_VIEWER_PATH;
    this.windowName = options.windowName || 'RhizomiumExternalViewer';

    this.viewerWindow = null;   // handle to the opened viewer window (fallback mode)
    this.screens = [];          // cached list of detected display descriptors
    this.screenDetails = null;  // live ScreenDetails handle (when permitted)

    // Projection mode (preferred): mirror the live canvas fullscreen onto a
    // chosen display with no browser window. State for that lives here.
    this.outputCanvas = null;   // 2D mirror canvas that goes fullscreen
    this.outputCtx = null;
    this.sourceCanvas = null;   // the live gpu-canvas being mirrored
    this.projecting = false;
    this.mirrorRafId = null;
    this._fsHandler = null;
    this.onProjectionEnd = null; // optional callback when projection ends (e.g. Esc)
  }

  /** BroadcastChannel is required for the live viewer transport. */
  static isSupported() {
    return typeof window !== 'undefined' && 'BroadcastChannel' in window;
  }

  /** Whether the Window Management API (multi-monitor placement) is available. */
  static supportsWindowManagement() {
    if (typeof window === 'undefined') return false;
    // Standard location is window.getScreenDetails(); some builds exposed it on
    // window.screen — accept either.
    return typeof window.getScreenDetails === 'function' ||
      !!(window.screen && typeof window.screen.getScreenDetails === 'function');
  }

  /** Resolve the getScreenDetails() implementation, wherever it lives. */
  _getScreenDetailsFn() {
    if (typeof window.getScreenDetails === 'function') {
      return () => window.getScreenDetails();
    }
    if (window.screen && typeof window.screen.getScreenDetails === 'function') {
      return () => window.screen.getScreenDetails();
    }
    return null;
  }

  /**
   * Detect connected displays.
   *
   * Uses the Window Management API when available (this prompts for the
   * "window-management" permission on first use, so it should be called from
   * within a user gesture). Always falls back to a single-screen descriptor so
   * callers receive a usable list regardless of browser support.
   *
   * @returns {Promise<Array>} screens
   *   [{ id, index, label, bounds:{left,top,width,height}, isPrimary, isInternal, isCurrent }]
   */
  async detectScreens() {
    const screens = [];

    try {
      const getDetails = this._getScreenDetailsFn();
      if (getDetails) {
        if (!this.screenDetails) {
          this.screenDetails = await getDetails();
        }
        const details = this.screenDetails;
        details.screens.forEach((scr, index) => {
          screens.push(this._describeScreen(scr, index, scr === details.currentScreen));
        });
      }
    } catch (err) {
      // Permission denied or API unavailable — fall through to the basic fallback.
      console.warn('[ExternalViewerManager] getScreenDetails unavailable:', err?.message || err);
      this.screenDetails = null;
    }

    if (screens.length === 0) {
      // Only the current screen is knowable without the Window Management API.
      const s = window.screen || {};
      screens.push({
        id: 'screen-0',
        index: 0,
        label: `Display 1 (${s.width || 0}×${s.height || 0})`,
        bounds: {
          left: s.availLeft ?? 0,
          top: s.availTop ?? 0,
          width: s.availWidth ?? 1920,
          height: s.availHeight ?? 1080
        },
        isPrimary: true,
        isInternal: true,
        isCurrent: true
      });
    }

    this.screens = screens;
    return screens;
  }

  _describeScreen(scr, index, isCurrent) {
    const w = scr.width || scr.availWidth || 0;
    const h = scr.height || scr.availHeight || 0;

    const tags = [];
    if (scr.isPrimary) tags.push('Primary');
    if (scr.isInternal) tags.push('Built-in');
    if (isCurrent) tags.push('This editor');
    const tagStr = tags.length ? ` — ${tags.join(', ')}` : '';

    const name = (scr.label && scr.label.trim()) ? scr.label.trim() : `Display ${index + 1}`;

    return {
      id: `screen-${index}`,
      index,
      label: `${name} (${w}×${h})${tagStr}`,
      bounds: {
        left: scr.availLeft ?? scr.left ?? 0,
        top: scr.availTop ?? scr.top ?? 0,
        width: scr.availWidth ?? scr.width ?? 1920,
        height: scr.availHeight ?? scr.height ?? 1080
      },
      isPrimary: !!scr.isPrimary,
      isInternal: !!scr.isInternal,
      isCurrent: !!isCurrent
    };
  }

  /**
   * Resolve a monitor selection to a screen descriptor.
   * Accepts: 'auto' | 'primary' | a screen id ('screen-1') | a numeric index.
   * 'auto' prefers a real second display (external and not the editor's screen).
   */
  _resolveScreen(monitor) {
    if (!this.screens || this.screens.length === 0) return null;

    if (monitor === undefined || monitor === null || monitor === 'auto') {
      return (
        this.screens.find(s => !s.isCurrent && !s.isInternal) ||
        this.screens.find(s => !s.isCurrent) ||
        this.screens.find(s => !s.isPrimary) ||
        this.screens[0]
      );
    }
    if (monitor === 'primary') {
      return this.screens.find(s => s.isPrimary) || this.screens[0];
    }

    const byId = this.screens.find(s => s.id === monitor);
    if (byId) return byId;

    const idx = parseInt(monitor, 10);
    if (!Number.isNaN(idx) && this.screens[idx]) return this.screens[idx];

    return this.screens[0];
  }

  /** True if the viewer window is currently open. */
  isOpen() {
    return !!(this.viewerWindow && !this.viewerWindow.closed);
  }

  /** Bring the viewer window to the front (if open). */
  focus() {
    if (this.isOpen()) {
      try { this.viewerWindow.focus(); } catch (_) { /* ignore */ }
    }
  }

  /** Close the viewer window (if open). */
  close() {
    if (this.isOpen()) {
      try { this.viewerWindow.close(); } catch (_) { /* ignore */ }
    }
    this.viewerWindow = null;
  }

  /**
   * Open (or focus) the external viewer on the chosen display, as a borderless
   * popup (no browser toolbars) sized to fill that display. The editor stays in
   * the primary window. By default the viewer also *silently* attempts true
   * fullscreen (which removes even the OS title bar) but never prompts or
   * requires a click — if the browser blocks it, the filling popup remains.
   *
   * @param {Object} opts
   * @param {string} [opts.monitor='auto']            'auto' | 'primary' | screen id | index
   * @param {boolean} [opts.hideUI=true]              hide the viewer's own chrome for clean output
   * @param {('soft'|'prompt'|false)} [opts.fullscreenMode='soft']
   *        'soft'   = try fullscreen once, silently (no overlay, no click);
   *        'prompt' = try, and if blocked show a one-click overlay;
   *        false    = don't attempt fullscreen.
   * @returns {Promise<Window>} the viewer window handle
   */
  async openViewer(opts = {}) {
    const { monitor = 'auto', hideUI = true, fullscreenMode = 'soft' } = opts;

    // Avoid spawning duplicates — refocus an already-open viewer instead.
    if (this.isOpen()) {
      this.focus();
      return this.viewerWindow;
    }

    // Refresh screen info inside the current user gesture so the permission
    // prompt (if any) can appear and placement uses up-to-date bounds.
    if (!this.screens.length || ExternalViewerManager.supportsWindowManagement()) {
      try { await this.detectScreens(); } catch (_) { /* fallback handled in detectScreens */ }
    }

    const screen = this._resolveScreen(monitor);

    // Behaviour flags for the viewer page.
    const params = new URLSearchParams();
    if (hideUI) params.set('hideui', 'true');
    if (fullscreenMode === 'prompt') params.set('fullscreen', 'true');
    else if (fullscreenMode === 'soft') params.set('softfs', 'true');
    const url = `${window.location.origin}${this.viewerPath}?${params.toString()}`;

    // Open a borderless popup (no tabs/toolbar/address bar) filling the display.
    const chrome = 'popup=yes,toolbar=no,location=no,menubar=no,status=no,scrollbars=no';
    let features;
    if (screen && screen.bounds) {
      const { left, top, width, height } = screen.bounds;
      features = `${chrome},left=${Math.round(left)},top=${Math.round(top)},` +
                 `width=${Math.round(width)},height=${Math.round(height)}`;
    } else {
      features = `${chrome},width=1920,height=1080`;
    }

    const win = window.open(url, this.windowName, features);
    if (!win) {
      throw new Error('Pop-up blocked. Please allow pop-ups for this site, then try again.');
    }
    this.viewerWindow = win;

    // Best-effort: some browsers ignore left/top in the features string for
    // cross-screen placement, so nudge it into position + fill the display.
    if (screen && screen.bounds) {
      const { left, top, width, height } = screen.bounds;
      try {
        win.moveTo(Math.round(left), Math.round(top));
        win.resizeTo(Math.round(width), Math.round(height));
      } catch (_) { /* blocked / cross-origin — ignore */ }
    }

    try { win.focus(); } catch (_) { /* ignore */ }
    return win;
  }

  // -------------------------------------------------------------------------
  // Projection mode — fullscreen the live output onto a display with NO window
  // -------------------------------------------------------------------------
  // Uses the Window Management API's requestFullscreen({ screen }) so the
  // primary window can push a mirror of the live canvas fullscreen onto another
  // display. No browser chrome, no pop-up, no second renderer — the operator
  // keeps working in the primary window while the chosen monitor shows only the
  // visual. Chromium-only (which the app already requires for WebGPU).

  /** True while an output is being projected fullscreen onto a display. */
  isProjecting() {
    return !!this.projecting;
  }

  /** Lazily create the hidden mirror canvas + a one-time :fullscreen style. */
  _ensureOutputCanvas() {
    if (this.outputCanvas) return;

    if (!document.getElementById('external-output-canvas-style')) {
      const style = document.createElement('style');
      style.id = 'external-output-canvas-style';
      // When fullscreen, fill the target display; otherwise stay invisible so it
      // never disturbs the editor layout.
      style.textContent =
        '#external-output-canvas:fullscreen{width:100vw!important;height:100vh!important;opacity:1!important;background:#000;}';
      document.head.appendChild(style);
    }

    const c = document.createElement('canvas');
    c.id = 'external-output-canvas';
    c.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;background:#000;';
    document.body.appendChild(c);

    this.outputCanvas = c;
    this.outputCtx = c.getContext('2d', { alpha: false });
  }

  /**
   * Project the live canvas fullscreen onto the chosen display.
   * Must be called from within a user gesture.
   * @param {Object} opts { monitor, sourceCanvas }
   * @returns {Promise<boolean>}
   */
  async projectFullscreen(opts = {}) {
    const { monitor = 'auto', sourceCanvas } = opts;
    if (!sourceCanvas) throw new Error('No source canvas to project');

    // Resolve the target display (reuses a cached, already-permitted handle so
    // this doesn't prompt and burn the user gesture before requestFullscreen).
    if (!this.screens.length || !this.screenDetails) {
      try { await this.detectScreens(); } catch (_) { /* handled below */ }
    }
    if (ExternalViewerManager.supportsWindowManagement() && !this.screenDetails) {
      // API exists but the permission wasn't granted — bail so the caller can
      // ask the user to allow it (rather than fullscreen the wrong screen).
      throw new Error('Display permission required');
    }

    const descriptor = this._resolveScreen(monitor);
    const liveScreen =
      (this.screenDetails && this.screenDetails.screens[descriptor?.index ?? 0]) || null;

    this._ensureOutputCanvas();

    // Size the mirror buffer to the target display resolution for a crisp output.
    const targetW = Math.round(descriptor?.bounds?.width || window.screen.width || 1920);
    const targetH = Math.round(descriptor?.bounds?.height || window.screen.height || 1080);
    this.outputCanvas.width = targetW;
    this.outputCanvas.height = targetH;

    this.sourceCanvas = sourceCanvas;

    // Only target a specific screen when there is genuinely more than one.
    const useScreen = liveScreen && this.screenDetails.screens.length > 1
      ? { screen: liveScreen }
      : undefined;
    await this.outputCanvas.requestFullscreen(useScreen);

    this.projecting = true;
    this._startMirror();
    this._attachFullscreenWatcher();
    return true;
  }

  /** rAF loop copying the live canvas into the fullscreen mirror (aspect-fit). */
  _startMirror() {
    const draw = () => {
      if (!this.projecting) return;
      const src = this.sourceCanvas;
      const ctx = this.outputCtx;
      const cw = this.outputCanvas.width;
      const ch = this.outputCanvas.height;
      if (ctx && src && src.width > 0 && src.height > 0) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, cw, ch);
        // contain-fit so the visual keeps its aspect ratio (letterboxed).
        const scale = Math.min(cw / src.width, ch / src.height);
        const dw = src.width * scale;
        const dh = src.height * scale;
        const dx = (cw - dw) / 2;
        const dy = (ch - dh) / 2;
        try { ctx.drawImage(src, dx, dy, dw, dh); } catch (_) { /* frame not ready */ }
      }
      this.mirrorRafId = requestAnimationFrame(draw);
    };
    this.mirrorRafId = requestAnimationFrame(draw);
  }

  /** Watch for the user leaving fullscreen (Esc) so we can clean up + notify. */
  _attachFullscreenWatcher() {
    if (this._fsHandler) return;
    this._fsHandler = () => {
      if (this.projecting && document.fullscreenElement !== this.outputCanvas) {
        this.stopProjection();
        if (typeof this.onProjectionEnd === 'function') this.onProjectionEnd();
      }
    };
    document.addEventListener('fullscreenchange', this._fsHandler);
  }

  /** Stop projecting: end the mirror loop, exit fullscreen, hide the canvas. */
  stopProjection() {
    this.projecting = false;

    if (this.mirrorRafId) {
      cancelAnimationFrame(this.mirrorRafId);
      this.mirrorRafId = null;
    }
    if (this._fsHandler) {
      document.removeEventListener('fullscreenchange', this._fsHandler);
      this._fsHandler = null;
    }
    if (this.outputCanvas) {
      if (document.fullscreenElement === this.outputCanvas) {
        document.exitFullscreen().catch(() => {});
      }
      this.outputCanvas.style.opacity = '0';
      this.outputCanvas.style.width = '1px';
      this.outputCanvas.style.height = '1px';
    }
    this.sourceCanvas = null;
  }
}

export default ExternalViewerManager;
