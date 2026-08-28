// src/output/NDIOutput.js

/**
 * NDIOutput - publishes the rendered output as an NDI source.
 *
 * A browser cannot speak NDI: the protocol announces itself over mDNS and moves
 * frames over raw sockets, none of which a page can open. So this class does
 * the half that can be done here — take every rendered frame, turn it into
 * RGBA, and hand it to ndi_bridge_server.py, which owns the NDI sender.
 *
 * The shape follows OSCManager, the project's other bridge client: same
 * initialize / disable / getStatus surface, same reconnect backoff, same idea
 * that "connected" means reaching the bridge rather than reaching the network.
 * The direction is the only real difference — OSC reads from its bridge, this
 * one writes to it.
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

/** Default bridge port, one past the OSC bridge on 8767. */
export const NDI_BRIDGE_PORT = 8768;

/** What receivers see on the network unless the artist renames it. */
export const NDI_DEFAULT_SOURCE_NAME = 'Rhizomium';

/** Frames per second sent to the bridge, unless configured otherwise. */
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
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return `ws://127.0.0.1:${NDI_BRIDGE_PORT}/ws`;
  }
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.hostname}:${NDI_BRIDGE_PORT}/ws`;
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

    // What the bridge told us about itself: whether NDI works on this machine
    // and, when it does not, the reason to show the artist.
    this.ndiAvailable = false;
    this.ndiError = null;

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
   * Start publishing: connect to the bridge and attach to the renderer.
   *
   * Named to match OSCManager.initialize(). Resolves once the socket is open —
   * which says the bridge is reachable, not that NDI itself works. Whether it
   * does arrives in the welcome message and lands in `ndiAvailable`.
   *
   * @param {object} renderer - a GPURenderer exposing addFrameTap
   */
  initialize(renderer) {
    if (!this.isSupported) {
      return Promise.reject(new Error('WebSocket is not supported in this browser'));
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
      let socket;
      try {
        socket = new WebSocket(this.url);
      } catch (error) {
        this.lastError = error.message;
        reject(error);
        return;
      }
      socket.binaryType = 'arraybuffer';
      this.ws = socket;

      socket.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.lastError = null;
        this._attachTap();
        // Ask for the name the artist configured; the bridge may have been
        // started by hand with a different one.
        this._send({ type: 'set_source_name', name: this.sourceName });
        this._send({ type: 'set_frame_rate', fps: this.targetFps });
        settled = true;
        resolve();
      };

      socket.onmessage = (event) => this._handleMessage(event);

      socket.onerror = () => {
        this.lastError = `Could not reach the NDI bridge at ${this.url}`;
        if (!settled) {
          settled = true;
          reject(new Error(this.lastError));
        }
      };

      socket.onclose = () => {
        this.connected = false;
        this.ws = null;
        this._detachTap();
        // Only reconnect while still wanted: disable() clears isEnabled first,
        // so a deliberate stop does not immediately dial back.
        if (this.isEnabled) this._scheduleReconnect();
      };
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
      this.lastError = `Gave up reaching the NDI bridge after ${this.reconnectAttempts} attempts`;
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
      return; // the bridge only ever sends us JSON
    }
    if (!data || typeof data !== 'object') return;

    if (data.type === 'welcome' || data.type === 'status') {
      this.ndiAvailable = !!data.ndi_available;
      this.ndiError = data.ndi_error || null;
      if (typeof data.source_name === 'string') this.sourceName = data.source_name;
      return;
    }

    if (data.type === 'error') {
      // A rejected frame, e.g. a size the bridge will not accept. Worth
      // surfacing: it means nothing is going out, which is otherwise silent.
      this.lastError = data.message || 'The NDI bridge rejected a frame';
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

  /** Rename the source receivers see. Takes effect on the bridge immediately. */
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
      framesSent: this.framesSent,
      framesDropped: this.framesDropped,
      lastError: this.lastError,
    };
  }
}
