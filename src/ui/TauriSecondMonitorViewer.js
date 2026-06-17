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
// A second WebviewWindow is a separate JS context with its OWN WebGPU device,
// so rather than copy pixels into it we let it re-render the shader itself. Over
// a same-origin BroadcastChannel this backend registers on the renderer's STATE
// tap (GPURenderer.setStateTap) and broadcasts only the compiled WGSL (on
// change) plus a per-frame snapshot of the uniform bytes — well under 1 KB. The
// receiver page (editor/second-monitor.html) re-renders from its own rAF at the
// second display's native refresh rate. The editor pays essentially nothing per
// frame, where the old approach (capturing #gpu-canvas with createImageBitmap
// and structured-cloning a multi-MB frame every present) dropped it to ~30fps.
//
// Graphs that bind textures or storage/compute buffers cannot be reproduced from
// a uniform snapshot alone; for those this backend reverts to the pixel FRAME
// tap (GPURenderer.setFrameTap) so the second monitor never shows broken output.
//
// All '@tauri-apps/api' access is via dynamic import() so that statically
// importing this module stays safe on the raw web deployments, which serve the
// source un-bundled and cannot resolve bare specifiers. This class is only ever
// constructed when isTauri() is true (see main.js).

import { isTauri } from '../utils/isTauri.js';
import {
  SecondMonitorMessage as MSG,
  SecondMonitorTier as TIER,
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
    this._stateTap = null;       // handler registered on the renderer's state tap
    this._frameTap = null;       // handler registered on the renderer's frame tap (fallback)
    this._mode = null;           // 'native' | 'fallback', decided per shader
    this._lastWgsl = undefined;  // last WGSL broadcast (undefined = none yet)
    this._forceFallback = false; // receiver can't render natively → pixels only
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
    if (data.type === MSG.CLOSED) { this.close(); return; }
    // The receiver cannot render natively (no WebGPU / device lost). Pin the
    // pixel path so it always has something to show.
    if (data.type === MSG.NEED_FALLBACK) {
      this._forceFallback = true;
      this._enterFallback();
      return;
    }
    // A (re)connecting receiver needs the current shader + tier to bootstrap.
    if (data.type === MSG.READY) {
      if (this._mode === 'native' && this._lastWgsl) {
        try { this._channel?.postMessage({ type: MSG.SHADER, wgsl: this._lastWgsl }); } catch (_) { /* ignore */ }
      }
      if (this._mode) {
        try { this._channel?.postMessage({ type: MSG.CAPS, tier: this._mode }); } catch (_) { /* ignore */ }
      }
    }
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
   * Start mirroring. Prefer the native STATE tap: broadcast tiny uniform bytes
   * and let the receiver re-render. The first snapshot picks native vs the pixel
   * fallback from the shader's bindings. Old renderers without a state tap use
   * the pixel frame tap directly.
   */
  _startTap() {
    const renderer = this._resolveRenderer();
    if (!renderer) return;
    this._lastWgsl = undefined;
    this._mode = null;
    if (typeof renderer.setStateTap === 'function') {
      this._stateTap = (snap) => this._onState(snap);
      renderer.setStateTap(this._stateTap);
    } else if (typeof renderer.setFrameTap === 'function') {
      this._enterFallback();
    }
  }

  _stopTap() {
    const renderer = this._resolveRenderer();
    if (renderer) {
      if (this._stateTap && typeof renderer.setStateTap === 'function') {
        try { renderer.setStateTap(null); } catch (_) { /* ignore */ }
      }
      if (this._frameTap && typeof renderer.setFrameTap === 'function') {
        try { renderer.setFrameTap(null); } catch (_) { /* ignore */ }
      }
    }
    this._stateTap = null;
    this._frameTap = null;
    this._mode = null;
    this._lastWgsl = undefined;
  }

  /**
   * One per-frame state snapshot from the renderer. On a shader change it (re)picks
   * native vs the pixel fallback and broadcasts the WGSL; in native mode it then
   * broadcasts the uniform bytes. The payload is well under 1 KB, so the
   * structured clone BroadcastChannel performs is negligible — unlike the multi-MB
   * frame copy the old pixel path did every frame.
   */
  _onState(snap) {
    if (!this._active || !this._channel || !snap) return;
    const wgsl = snap.wgsl || null;
    if (wgsl !== this._lastWgsl) {
      this._lastWgsl = wgsl;
      const renderer = this._resolveRenderer();
      const eligible = !this._forceFallback
        && !!renderer && typeof renderer.isNativeMirrorEligible === 'function'
        && renderer.isNativeMirrorEligible();
      if (eligible) this._enterNative(); else this._enterFallback();
      if (this._mode === 'native') {
        try { this._channel.postMessage({ type: MSG.SHADER, wgsl }); } catch (_) { /* ignore */ }
      }
    }
    if (this._mode === 'native') {
      try {
        this._channel.postMessage({
          type: MSG.UNIFORMS,
          aspect: snap.aspect || null,
          globals: snap.globals || null,
          params: snap.params || null,
        });
      } catch (_) { /* channel closed mid-flight */ }
    }
  }

  /** Switch to the native path: stop the pixel frame tap, advertise the tier. */
  _enterNative() {
    if (this._mode === 'native') return;
    this._mode = 'native';
    const renderer = this._resolveRenderer();
    if (this._frameTap && renderer && typeof renderer.setFrameTap === 'function') {
      try { renderer.setFrameTap(null); } catch (_) { /* ignore */ }
    }
    this._frameTap = null;
    try { this._channel?.postMessage({ type: MSG.CAPS, tier: TIER.NATIVE }); } catch (_) { /* ignore */ }
  }

  /** Switch to the pixel fallback: register the frame tap, advertise the tier. */
  _enterFallback() {
    if (this._mode === 'fallback') return;
    this._mode = 'fallback';
    const renderer = this._resolveRenderer();
    if (renderer && typeof renderer.setFrameTap === 'function') {
      this._frameTap = (bitmap) => this._onTappedFrame(bitmap);
      try { renderer.setFrameTap(this._frameTap); } catch (_) { /* ignore */ }
    }
    try { this._channel?.postMessage({ type: MSG.CAPS, tier: TIER.FALLBACK }); } catch (_) { /* ignore */ }
  }

  /**
   * Re-point the taps at a freshly created renderer (e.g. after a GPU device loss
   * recreated window.gpuRenderer). Called from main.js after device reinit.
   */
  reattach() {
    if (!this._active) return;
    this._stopTap();
    this.renderer = null; // force _resolveRenderer to pick up the new global
    this._startTap();
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
