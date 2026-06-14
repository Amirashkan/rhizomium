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

    this.viewerWindow = null;   // handle to the opened viewer window
    this.screens = [];          // cached list of detected display descriptors
    this.screenDetails = null;  // live ScreenDetails handle (when permitted)
  }

  /** BroadcastChannel is required for the live viewer transport. */
  static isSupported() {
    return typeof window !== 'undefined' && 'BroadcastChannel' in window;
  }

  /** Whether the Window Management API (multi-monitor placement) is available. */
  static supportsWindowManagement() {
    return typeof window !== 'undefined' && 'getScreenDetails' in window;
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
      if (ExternalViewerManager.supportsWindowManagement()) {
        if (!this.screenDetails) {
          this.screenDetails = await window.getScreenDetails();
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
   * Open (or focus) the external viewer on the chosen display.
   *
   * @param {Object} opts
   * @param {string} [opts.monitor='auto']   'auto' | 'primary' | screen id | index
   * @param {boolean} [opts.fullscreen=true] request fullscreen in the viewer
   * @param {boolean} [opts.hideUI=true]     hide the viewer's chrome for clean output
   * @returns {Promise<Window>} the viewer window handle
   */
  async openViewer(opts = {}) {
    const { monitor = 'auto', fullscreen = true, hideUI = true } = opts;

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
    if (fullscreen) params.set('fullscreen', 'true');
    if (hideUI) params.set('hideui', 'true');
    const url = `${window.location.origin}${this.viewerPath}?${params.toString()}`;

    // Size/position the window to fill the chosen display.
    let features;
    if (screen && screen.bounds) {
      const { left, top, width, height } = screen.bounds;
      features = `left=${Math.round(left)},top=${Math.round(top)},` +
                 `width=${Math.round(width)},height=${Math.round(height)}`;
    } else {
      features = 'width=1920,height=1080';
    }

    const win = window.open(url, this.windowName, features);
    if (!win) {
      throw new Error('Pop-up blocked. Please allow pop-ups for this site, then try again.');
    }
    this.viewerWindow = win;

    // Best-effort: some browsers ignore left/top in the features string for
    // cross-screen placement, so nudge it into position after opening.
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
}

export default ExternalViewerManager;
