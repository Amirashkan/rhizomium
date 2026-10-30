// src/output/NDIOutput.js

/**
 * NDIOutput - publishes the rendered output as an NDI source.
 *
 * A webview cannot speak NDI: the protocol announces itself over mDNS and moves
 * frames over raw sockets, none of which a page can open. So this class does
 * the half that can be done here — take every rendered frame, turn it into
 * RGBA, and hand it to the desktop app's connection service
 * (src-tauri/src/bridge/video.rs), which owns the NDI sender. The same service
 * receives NDI for Live Input nodes (src/input/LiveInput.js).
 *
 * The shape follows OSCManager: same initialize / disable / getStatus surface,
 * same reconnect backoff, same idea that "connected" means reaching the app's
 * service rather than reaching the network.
 *
 * ## Why frames come from the renderer's tap
 *
 * Reading #gpu-canvas from an animation frame of our own races the compositor,
 * which recycles the swapchain buffer once it has presented, so those reads
 * intermittently come back blank. GPURenderer.addFrameTap() captures
 * synchronously right after submit, which is the only moment the frame is
 * reliably still there. That is also why this uses addFrameTap rather than
 * setFrameTap: the second-monitor viewer owns the single setFrameTap slot, and
 * driving a projector and a vision mixer from one patch is a normal thing to
 * want at a show.
 */

import { bridgesAvailable, BRIDGES_DESKTOP_ONLY_MESSAGE, bridgeUrl, withBridge } from '../utils/bridgeAvailability.js';

/** What receivers see on the network unless the artist renames it. */
export const NDI_DEFAULT_SOURCE_NAME = 'Rhizomium';

/** Frames per second sent to NDI, unless configured otherwise. */
export const NDI_DEFAULT_FPS = 30;

/**
 * Stop sending while this many bytes are still queued on the socket.
 *
 * A frame is large — 1920×1080 RGBA is 8.3 MB — so a socket that stalls for
 * even a moment can bank hundreds of megabytes of stale video that will be
 * delivered late and in the wrong order relative to what is on screen. Dropping
 * the current frame instead keeps the output live, which is the whole point of
 * a live output. Two frames of slack at 1080p.
 */
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;

export function defaultBridgeUrl() {
  return bridgeUrl('video');
}

/**
 * Make a surface we can draw an ImageBitmap onto and read pixels back from.
 * OffscreenCanvas where it exists, a detached <canvas> otherwise.
 */
function createReadbackSurface(width, height) {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export class NDIOutput {
  constructor(options = {}) {
    this.url = options.url || defaultBridgeUrl();
    this.sourceName = options.sourceName || NDI_DEFAULT_SOURCE_NAME;
    this.targetFps = options.fps || NDI_DEFAULT_FPS;

    this.ws = null;
    this.isSupported = typeof WebSocket !== 'undefined';
    this.isEnabled = false;
    this.connected = false;

    // Reconnection backoff, matching OSCManager's shape.
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.reconnectTimer = null;

    // What the app told us: whether NDI works on this machine and, when it
    // does not, the reason and where to get the NDI Runtime.
    this.ndiAvailable = false;
    this.ndiError = null;
    this.ndiRuntimeUrl = null;

    // The renderer this is tapping, and how to stop.
    this.renderer = null;
    this._untap = null;

    // Readback surface, kept between frames and resized only when the output
    // does. Allocating one per frame would be a 60-per-second churn of the
    // largest buffer in the app.
    this._surface = null;
    this._context = null;
    this._surfaceWidth = 0;
    this._surfaceHeight = 0;

    // Throttle bookkeeping.
    this._lastSendTime = 0;

    this.framesSent = 0;
    this.framesDropped = 0;
    this.lastError = null;
  }

  /** Minimum milliseconds between frames, from the target rate. */
  get _minFrameInterval() {
    return 1000 / this.targetFps;
  }

  /**
   * Start publishing: connect to the app's NDI service and attach to the renderer.
   *
   * Named to match OSCManager.initialize(). Resolves once the welcome message
   * has arrived, so `ndiAvailable` already says whether NDI itself works.
   *
   * @param {object} renderer - a GPURenderer exposing addFrameTap
   */
  initialize(renderer) {
    if (!this.isSupported) {
      return Promise.reject(new Error('WebSocket is not supported in this browser'));
    }
    if (!bridgesAvailable()) {
      this.lastError = BRIDGES_DESKTOP_ONLY_MESSAGE;
      return Promise.reject(new Error(BRIDGES_DESKTOP_ONLY_MESSAGE));
    }
    this.isEnabled = true;
    this.renderer = renderer || this.renderer;
    return this.connect();
  }

  /**
   * Open the socket. Resolves on open, rejects if the first attempt fails —
   * later drops are handled by the reconnect timer rather than the promise.
   */
  connect() {
    if (this.ws) return Promise.resolve();

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      const open = () => {
        let socket;
        try {
          socket = new WebSocket(this.url);
        } catch (error) {
          this.lastError = error.message;
          settle(error);
          return;
        }
        socket.binaryType = 'arraybuffer';
        this.ws = socket;

        socket.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.lastError = null;
          this._attachTap();
          this._send({ type: 'set_source_name', name: this.sourceName });
          this._send({ type: 'set_frame_rate', fps: this.targetFps });
        };

        socket.onmessage = (event) => {
          this._handleMessage(event);
          // The welcome comes first and carries whether NDI works here.
          settle();
        };

        socket.onerror = () => {
          this.lastError = `Could not reach NDI in the app at ${this.url}`;
          settle(new Error(this.lastError));
        };

        socket.onclose = () => {
          this.connected = false;
          if (this.ws === socket) this.ws = null;
          this._detachTap();
          settle(new Error(this.lastError || `Could not reach NDI in the app at ${this.url}`));
          // Only reconnect while still wanted: disable() clears isEnabled first,
          // so a deliberate stop does not immediately dial back.
          if (this.isEnabled) this._scheduleReconnect();
        };
      };

      // The app starts its connection service on first use.
      withBridge(open, (error) => {
        this.lastError = error.message;
        settle(error);
      });
    });
  }

  /** Stop publishing and stay stopped. */
  disable() {
    this.isEnabled = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._detachTap();
    const socket = this.ws;
    this.ws = null;
    this.connected = false;
    if (socket) {
      try { socket.close(); } catch { /* already closing */ }
    }
    this._releaseSurface();
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.lastError = `Gave up reaching NDI in the app after ${this.reconnectAttempts} attempts`;
      return;
    }
    const delay = Math.min(
      this.reconnectDelay * (2 ** this.reconnectAttempts),
      this.maxReconnectDelay
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isEnabled) return;
      this.connect().catch(() => { /* onclose schedules the next try */ });
    }, delay);
  }

  _handleMessage(event) {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return; // the app only ever sends this socket JSON
    }
    if (!data || typeof data !== 'object') return;

    if (data.type === 'welcome' || data.type === 'status') {
      this.ndiAvailable = !!data.ndi_available;
      this.ndiError = data.ndi_error || null;
      this.ndiRuntimeUrl = data.ndi_runtime_url || null;
      if (typeof data.source_name === 'string') this.sourceName = data.source_name;
      return;
    }

    if (data.type === 'error') {
      // A rejected frame, e.g. a size NDI will not accept. Worth
      // surfacing: it means nothing is going out, which is otherwise silent.
      this.lastError = data.message || 'NDI output rejected a frame';
    }
  }

  _send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(payload));
      return true;
    } catch (error) {
      this.lastError = error.message;
      return false;
    }
  }

  _attachTap() {
    if (this._untap || !this.renderer) return;
    if (typeof this.renderer.addFrameTap !== 'function') {
      this.lastError = 'This renderer cannot supply frames for NDI output';
      return;
    }
    this._untap = this.renderer.addFrameTap((bitmap) => this._onFrame(bitmap));
  }

  _detachTap() {
    if (!this._untap) return;
    try { this._untap(); } catch { /* renderer already gone */ }
    this._untap = null;
  }

  _releaseSurface() {
    this._surface = null;
    this._context = null;
    this._surfaceWidth = 0;
    this._surfaceHeight = 0;
  }

  /**
   * Point the readback surface at this frame's size, rebuilding it on a resize.
   * @returns {boolean} whether there is a usable 2D context.
   */
  _ensureSurface(width, height) {
    if (this._context && this._surfaceWidth === width && this._surfaceHeight === height) {
      return true;
    }
    const surface = createReadbackSurface(width, height);
    if (!surface) return false;
    surface.width = width;
    surface.height = height;

    // willReadFrequently: every single frame is read straight back, which is
    // exactly the case the flag exists for — without it browsers keep the
    // surface on the GPU and each getImageData stalls on a readback.
    const context = surface.getContext('2d', { willReadFrequently: true });
    if (!context) return false;

    this._surface = surface;
    this._context = context;
    this._surfaceWidth = width;
    this._surfaceHeight = height;
    return true;
  }

  /**
   * Handle one tapped frame. Owns the bitmap and must close it — including on
   * every path that decides not to send.
   */
  _onFrame(bitmap) {
    try {
      if (!bitmap?.width || !bitmap?.height) return;
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      // Throttle to the target rate. The renderer taps every presented frame,
      // which can be well above what the source advertises.
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now - this._lastSendTime < this._minFrameInterval) return;

      // Never queue behind a socket that is already backed up: late video is
      // worse than missing video on a live output.
      if (this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        this.framesDropped += 1;
        return;
      }

      const { width, height } = bitmap;
      if (!this._ensureSurface(width, height)) {
        this.framesDropped += 1;
        return;
      }

      let pixels;
      try {
        this._context.drawImage(bitmap, 0, 0);
        pixels = this._context.getImageData(0, 0, width, height).data;
      } catch (error) {
        // A tainted or zero-sized surface. Count it rather than tearing the
        // connection down: the next frame usually works.
        this.framesDropped += 1;
        this.lastError = error.message;
        return;
      }

      const header = { type: 'frame', width, height, format: 'rgba' };
      if (!this._send(header)) {
        this.framesDropped += 1;
        return;
      }
      try {
        // Send the bytes themselves — .buffer would also ship any padding the
        // view does not cover.
        this.ws.send(pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength));
      } catch (error) {
        this.framesDropped += 1;
        this.lastError = error.message;
        return;
      }

      this._lastSendTime = now;
      this.framesSent += 1;
    } finally {
      try { bitmap?.close?.(); } catch { /* already closed */ }
    }
  }

  /** Rename the source receivers see. Takes effect immediately. */
  setSourceName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    this.sourceName = trimmed;
    this._send({ type: 'set_source_name', name: trimmed });
  }

  /** Change the rate frames are sent at. */
  setFrameRate(fps) {
    const rate = Number(fps);
    if (!Number.isFinite(rate) || rate < 1 || rate > 240) return;
    this.targetFps = rate;
    this._send({ type: 'set_frame_rate', fps: rate });
  }

  /** Everything a settings panel needs to describe the current state. */
  getStatus() {
    return {
      supported: this.isSupported,
      enabled: this.isEnabled,
      connected: this.connected,
      url: this.url,
      sourceName: this.sourceName,
      targetFps: this.targetFps,
      ndiAvailable: this.ndiAvailable,
      ndiError: this.ndiError,
      ndiRuntimeUrl: this.ndiRuntimeUrl,
      framesSent: this.framesSent,
      framesDropped: this.framesDropped,
      lastError: this.lastError,
    };
  }
}
