// src/ui/TauriSecondMonitorViewer.js
//
// Second-monitor full-screen viewer — Tauri/desktop backend.
//
// In the desktop app `window.open()` is governed by the OS WebView and is
// blocked (it returns null), so the browser popup path in SecondMonitorViewer.js
// cannot be used. This backend instead opens a real, borderless, native
// WebviewWindow on the second display via the Tauri window API and drives it to
// true OS fullscreen — which, unlike the browser's gesture-gated
// requestFullscreen(), is reliable.
//
// A second WebviewWindow is a separate JS context, so the editor cannot draw
// into it directly. Instead the editor mirrors `#gpu-canvas` by broadcasting
// frames (ImageBitmap) over a same-origin BroadcastChannel; the receiver page
// (editor/second-monitor.html) paints them, letterboxed, from its own rAF — so
// the output keeps running at the second display's refresh rate even when the
// editor window is occluded or minimised.
//
// Frames are pulled from the renderer's frame tap (GPURenderer.setFrameTap),
// which captures each frame in lock-step with the GPU present. Capturing from
// our own animation frame instead raced the browser's compositor — it recycles
// the WebGPU swapchain buffer once a frame is presented — so those reads came
// back blank and the mirror flickered to black.
//
// All '@tauri-apps/api' access is via dynamic import() so that statically
// importing this module stays safe on the raw web deployments, which serve the
// source un-bundled and cannot resolve bare specifiers. This class is only ever
// constructed when isTauri() is true (see main.js).

import { isTauri } from '../utils/isTauri.js';
import {
  SecondMonitorMessage as MSG,
  openSecondMonitorChannel,
} from './secondMonitorFrameChannel.js';

const WINDOW_LABEL = 'second-monitor';

export class TauriSecondMonitorViewer {
  /**
   * @param {HTMLCanvasElement} sourceCanvas  the live GPU canvas to mirror
   * @param {Object} [options]
   * @param {string} [options.windowLabel]     Tauri window label (must be unique)
   * @param {Object} [options.renderer]        GPURenderer to tap for frames
   *                                           (falls back to window.gpuRenderer)
   * @param {(message: string, kind?: string) => void} [options.onStatus]
   * @param {(active: boolean) => void} [options.onActiveChange]
   */
  constructor(sourceCanvas, options = {}) {
    this.sourceCanvas = sourceCanvas;
    this.windowLabel = options.windowLabel || WINDOW_LABEL;
    this.renderer = options.renderer || null;
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    this.onActiveChange = typeof options.onActiveChange === 'function'
      ? options.onActiveChange
      : () => {};

    this._win = null;            // the native WebviewWindow (frame target)
    this._channel = null;        // BroadcastChannel to the receiver page
    this._onChannelMessage = null;
    this._frameTap = null;       // handler registered on the renderer's frame tap
    this._active = false;
  }

  /** True while the second-monitor window is open. */
  get isActive() {
    return this._active;
  }

  /** Whether second-display placement is available (always true under Tauri). */
  static supportsDisplayPlacement() {
    return isTauri();
  }

  /** Open if closed, close if open. @returns {Promise<boolean>} active state */
  async toggle() {
    if (this._active) {
      await this.close();
      return false;
    }
    await this.open();
    return this._active;
  }

  /** Open the native second-monitor window and start mirroring. */
  async open() {
    if (this._active) {
      try { await this._win?.setFocus(); } catch (_) { /* ignore */ }
      return;
    }
    if (!this.sourceCanvas) {
      this.onStatus('No render canvas available to mirror', 'error');
      return;
    }
    if (!isTauri()) {
      this.onStatus('Second-monitor viewer requires the desktop app', 'error');
      return;
    }

    try {
      const channel = openSecondMonitorChannel();
      if (!channel) throw new Error('BroadcastChannel is unavailable');
      this._channel = channel;
      this._onChannelMessage = (e) => this._handleChannelMessage(e);
      channel.addEventListener('message', this._onChannelMessage);

      await this._createWindow();
    } catch (err) {
      console.error('[TauriSecondMonitorViewer] open failed:', err);
      this.onStatus('Could not open second-monitor window: ' + (err?.message || err), 'error');
      this._teardown();
      return;
    }

    this._active = true;
    this._startTap();
    this.onActiveChange(true);
    this.onStatus('Second-monitor viewer opened');
  }

  /** Close the window and stop mirroring. */
  async close() {
    const wasActive = this._active;
    this._stopTap();

    try { this._channel?.postMessage({ type: MSG.CLOSE }); } catch (_) { /* ignore */ }

    const win = this._win;
    this._teardown();
    if (win) { try { await win.close(); } catch (_) { /* already gone */ } }

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

  /** Release channel/loop state without firing user callbacks. */
  _teardown() {
    this._stopTap();
    if (this._channel && this._onChannelMessage) {
      try { this._channel.removeEventListener('message', this._onChannelMessage); } catch (_) { /* ignore */ }
    }
    try { this._channel?.close(); } catch (_) { /* ignore */ }
    this._channel = null;
    this._onChannelMessage = null;
    this._win = null;
    this._active = false;
  }

  _handleChannelMessage(e) {
    const data = e?.data;
    if (!data) return;
    // The receiver closed itself (Esc or native close) — sync our state.
    if (data.type === MSG.CLOSED) this.close();
  }

  /**
   * Create the native WebviewWindow on a detected second display (borderless,
   * fullscreen, always-on-top). Falls back to a centred, decorated window the
   * user can move when only one display is present.
   */
  async _createWindow() {
    const [{ WebviewWindow }, windowApi] = await Promise.all([
      import('@tauri-apps/api/webviewWindow'),
      import('@tauri-apps/api/window'),
    ]);

    const target = await this._resolveSecondMonitor(windowApi);
    const options = {
      url: this._receiverUrl(),
      title: 'Rhizomium — Output',
      decorations: !target,     // borderless on a real 2nd monitor
      alwaysOnTop: !!target,
      skipTaskbar: !!target,
      focus: true,
      visible: true,
    };
    if (target) {
      // Monitor bounds are physical pixels; window options are logical pixels.
      const s = target.scaleFactor || 1;
      options.x = Math.round((target.position?.x || 0) / s);
      options.y = Math.round((target.position?.y || 0) / s);
      options.width = Math.max(1, Math.round((target.size?.width || 1920) / s));
      options.height = Math.max(1, Math.round((target.size?.height || 1080) / s));
    } else {
      options.width = 1280;
      options.height = 720;
      options.center = true;
    }

    // Reuse-proof: drop a window lingering under our label from a prior session.
    try {
      const existing = await WebviewWindow.getByLabel(this.windowLabel);
      if (existing) { try { await existing.close(); } catch (_) { /* ignore */ } }
    } catch (_) { /* getByLabel best-effort */ }

    const win = new WebviewWindow(this.windowLabel, options);
    await new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
      win.once('tauri://created', () => done(resolve));
      win.once('tauri://error', (ev) => done(reject, new Error(this._tauriErr(ev))));
      setTimeout(() => done(reject, new Error('window creation timed out')), 5000);
    });
    this._win = win;

    // True OS fullscreen on the target display. The borderless window already
    // fills the monitor, so a failure here is non-fatal.
    if (target) {
      try { await win.setFullscreen(true); } catch (_) { /* borderless fill remains */ }
    }
    return win;
  }

  /**
   * Pick a display that is not the editor's current one.
   * @returns {Promise<object|null>} a Tauri Monitor, or null when single-display.
   */
  async _resolveSecondMonitor(windowApi) {
    try {
      const monitors = await windowApi.availableMonitors();
      if (!Array.isArray(monitors) || monitors.length === 0) return null;
      let current = null;
      try { current = await windowApi.currentMonitor(); } catch (_) { /* ignore */ }
      const samePos = (a, b) =>
        a && b && a.position?.x === b.position?.x && a.position?.y === b.position?.y;
      return monitors.find((m) => !samePos(m, current)) || null;
    } catch (err) {
      console.warn('[TauriSecondMonitorViewer] monitor query failed:', err?.message || err);
      return null;
    }
  }

  /** Resolve the receiver page URL as a sibling of the current editor page. */
  _receiverUrl() {
    try {
      const { pathname } = window.location;
      const dir = pathname.endsWith('/') ? pathname : pathname.replace(/[^/]*$/, '');
      return dir + 'second-monitor.html';
    } catch (_) {
      return '/editor/second-monitor.html';
    }
  }

  _tauriErr(ev) {
    const p = ev && typeof ev === 'object' ? ev.payload : ev;
    if (p == null) return 'window error';
    return typeof p === 'string' ? p : JSON.stringify(p);
  }

  /**
   * Start mirroring by registering on the renderer's frame tap. The renderer
   * captures each frame in sync with the GPU present and hands us the bitmap; we
   * forward it over the channel. The receiver paints from its own rAF, so output
   * smoothness is decoupled from the editor's render cadence.
   */
  _startTap() {
    const renderer = this._resolveRenderer();
    if (!renderer || typeof renderer.setFrameTap !== 'function') return;
    this._frameTap = (bitmap) => this._onTappedFrame(bitmap);
    renderer.setFrameTap(this._frameTap);
  }

  _stopTap() {
    const renderer = this._resolveRenderer();
    if (this._frameTap && renderer && typeof renderer.setFrameTap === 'function') {
      try { renderer.setFrameTap(null); } catch (_) { /* ignore */ }
    }
    this._frameTap = null;
  }

  /** The GPURenderer to mirror — explicit option first, else the global one. */
  _resolveRenderer() {
    if (this.renderer) return this.renderer;
    this.renderer = (typeof window !== 'undefined' && window.gpuRenderer) || null;
    return this.renderer;
  }

  /**
   * Forward one captured frame to the receiver. We own the bitmap and must free
   * it. BroadcastChannel structured-clones it synchronously inside postMessage,
   * so the receiver gets an independent copy and we can close ours immediately.
   */
  _onTappedFrame(bitmap) {
    if (!bitmap) return;
    if (!this._active || !this._channel) { try { bitmap.close(); } catch (_) { /* ignore */ } return; }
    const src = this.sourceCanvas;
    const sw = (src && src.width) || bitmap.width;
    const sh = (src && src.height) || bitmap.height;
    try {
      this._channel.postMessage({ type: MSG.FRAME, bitmap, sw, sh });
    } catch (_) {
      // Channel closed mid-flight — nothing to deliver.
    } finally {
      try { bitmap.close(); } catch (_) { /* ignore */ }
    }
  }
}
