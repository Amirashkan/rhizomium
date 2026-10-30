// src/input/LiveInput.js

/**
 * LiveInput - frames from outside the editor (TouchDesigner, OBS, Resolume, a camera rig) as
 * textures.
 *
 * A webview cannot receive NDI, and other applications have no way to hand it their frames, so
 * the desktop app does the receiving (src-tauri/src/bridge/video.rs — the same place NDI output
 * goes out) and this class is its client: it subscribes to the sources Live Input nodes name,
 * decodes each frame it is sent and copies it into that node's GPU texture through
 * TextureManager.setLiveFrame. From the shader's side a Live Input node is an
 * ordinary `texture_2d<f32>`, exactly like a Texture 2D holding a video.
 *
 * The shape follows NDIOutput: one socket, reconnect backoff, and "connected" meaning the app's
 * service is reachable — whether a named source exists is reported per node.
 *
 * Nodes bind themselves: the codegen calls `bind(nodeId, source)` every compile, so a node dropped
 * into the patch, renamed, or loaded from a saved project starts receiving with no panel to open.
 * The connection is only made once the first node binds, so a patch without one never touches the
 * network.
 */

import { bridgesAvailable, bridgeUrl, withBridge } from '../utils/bridgeAvailability.js';

/** How often to look for bound nodes whose node has gone (deleted, or a different patch loaded). */
const SWEEP_INTERVAL_MS = 2000;

export function defaultVideoInUrl() {
  return bridgeUrl('video');
}

/** Normalise a node's Source parameter: trimmed text, or '' for "nothing chosen". */
export function normalizeSourceName(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, 128);
}

/**
 * Decode one frame from the app into something copyExternalImageToTexture accepts.
 * Raw RGBA goes through ImageData; JPEG/PNG through the browser's image decoder.
 */
async function decodeFrame(header, bytes) {
  if (header.format === 'rgba') {
    const { width, height } = header;
    if (!(width > 0 && height > 0) || bytes.byteLength !== width * height * 4) return null;
    const image = new ImageData(new Uint8ClampedArray(bytes), width, height);
    return createImageBitmap(image);
  }
  if (header.format === 'jpeg' || header.format === 'png') {
    const blob = new Blob([bytes], { type: `image/${header.format}` });
    return createImageBitmap(blob);
  }
  return null;
}

export class LiveInput {
  constructor(options = {}) {
    this.url = options.url || defaultVideoInUrl();
    this.textureManager = options.textureManager || null;
    this.decode = options.decode || decodeFrame;

    this.ws = null;
    this.isSupported = typeof WebSocket !== 'undefined';
    this.connected = false;

    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 15000;
    this.reconnectTimer = null;

    // nodeId -> source name the node asked for
    this.bindings = new Map();

    // source -> per-source state: latest frame time, the bitmap shown on thumbnails, decode gate
    this.sources = new Map();

    // What the app told us: whether NDI works here, and why not.
    this.ndiAvailable = false;
    this.ndiError = null;
    this.ndiRuntimeUrl = null;
    this.available = []; // [{ name, kind, short_name? }]

    // The header announcing the next binary message.
    this._pendingHeader = null;
    // Waiting for the app to start its connection service.
    this._starting = false;
    this._sweepTimer = null;

    this.framesReceived = 0;
    this.framesDropped = 0;
    this.lastError = null;
  }

  _textureManager() {
    return this.textureManager || (typeof window !== 'undefined' ? window.textureManager : null);
  }

  /**
   * Point a Live Input node at a source. Idempotent, and cheap enough to call every compile.
   * An empty name unbinds the node.
   */
  bind(nodeId, source) {
    const id = String(nodeId);
    const name = normalizeSourceName(source);
    const previous = this.bindings.get(id);
    if (previous === name) {
      if (name) this._ensureConnected();
      return;
    }

    if (previous !== undefined) this._unbind(id);
    if (!name) return;

    this.bindings.set(id, name);
    if (!this.sources.has(name)) {
      this.sources.set(name, { lastFrameAt: 0, frames: 0, bitmap: null, decoding: false, queued: null });
      this._send({ type: 'subscribe', source: name });
    }
    this._ensureConnected();
    this._ensureSweep();
  }

  /** Stop feeding a node. Its texture stays until TextureManager.removeTexture frees it. */
  unbind(nodeId) {
    this._unbind(String(nodeId));
  }

  _unbind(id) {
    const name = this.bindings.get(id);
    this.bindings.delete(id);
    this._textureManager()?.releaseLiveInput?.(id);
    if (name === undefined) return;

    const stillWanted = [...this.bindings.values()].includes(name);
    if (!stillWanted) {
      const state = this.sources.get(name);
      try { state?.bitmap?.close?.(); } catch { /* already closed */ }
      this.sources.delete(name);
      this._send({ type: 'unsubscribe', source: name });
    }
    if (this.bindings.size === 0) this.disconnect();
  }

  /** The source a node is bound to, for status display. */
  sourceFor(nodeId) {
    return this.bindings.get(String(nodeId)) || '';
  }

  /**
   * What a node's thumbnail or panel should say about it.
   * @returns {{state: 'idle'|'desktop-only'|'connecting'|'waiting'|'live', source: string, bitmap: ImageBitmap|null, message: string}}
   */
  statusFor(nodeId) {
    const source = this.sourceFor(nodeId);
    if (!source) return { state: 'idle', source, bitmap: null, message: 'Type a source name' };
    if (!bridgesAvailable()) {
      return { state: 'desktop-only', source, bitmap: null, message: 'Live Input works in the desktop app only' };
    }
    if (!this.connected) {
      return {
        state: 'connecting', source, bitmap: null,
        message: this.lastError || 'Connecting…',
      };
    }
    const state = this.sources.get(source);
    if (!state?.frames) {
      // A pushed stream needs no NDI, so this is only worth saying while the
      // source is not one: "waiting" with the reason NDI cannot find it.
      const message = this.ndiAvailable || !this.ndiError
        ? `Waiting for "${source}"`
        : `Waiting for "${source}" — ${this.ndiError}`;
      return { state: 'waiting', source, bitmap: null, message };
    }
    return { state: 'live', source, bitmap: state.bitmap, message: source };
  }

  _ensureSweep() {
    if (this._sweepTimer || typeof setInterval !== 'function') return;
    this._sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  /**
   * Drop bindings whose node no longer exists. Deleting a node frees its texture through
   * Editor → TextureManager.removeTexture, but replacing the whole graph (opening a project) does
   * not delete node by node, and a binding left behind would keep a source subscribed forever.
   */
  sweep(graph = (typeof window !== 'undefined' ? window.editor?.graph : null)) {
    const nodes = graph?.nodes;
    if (!Array.isArray(nodes)) return;
    const live = new Set(nodes.filter((n) => n?.kind === 'LiveInput').map((n) => String(n.id)));
    for (const id of [...this.bindings.keys()]) {
      if (!live.has(id)) this._unbind(id);
    }
  }

  _ensureConnected() {
    if (!this.isSupported || !bridgesAvailable() || this.ws || this.reconnectTimer) return;
    this.connect();
  }

  connect() {
    if (this.ws || this._starting || !this.isSupported || !bridgesAvailable()) return;
    // The app starts its connection service on first use.
    this._starting = true;
    withBridge(
      () => {
        this._starting = false;
        this._open();
      },
      (error) => {
        this._starting = false;
        this.lastError = error.message;
        if (this.bindings.size > 0) this._scheduleReconnect();
      },
    );
  }

  _open() {
    if (this.ws || this.bindings.size === 0) return;
    let socket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      this.lastError = error.message;
      this._scheduleReconnect();
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.ws = socket;

    socket.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this.lastError = null;
      // The app keeps no memory of us across a reconnect.
      for (const name of this.sources.keys()) this._send({ type: 'subscribe', source: name });
    };

    socket.onmessage = (event) => this._handleMessage(event);

    socket.onerror = () => {
      this.lastError = `Could not reach Live Input in the app at ${this.url}`;
    };

    socket.onclose = () => {
      this.connected = false;
      this.ws = null;
      this._pendingHeader = null;
      if (this.bindings.size > 0) this._scheduleReconnect();
    };
  }

  /** Close the socket and stop retrying. Bindings made later reconnect on their own. */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this._sweepTimer && this.bindings.size === 0) {
      clearInterval(this._sweepTimer);
      this._sweepTimer = null;
    }
    const socket = this.ws;
    this.ws = null;
    this.connected = false;
    this._pendingHeader = null;
    if (socket) {
      try { socket.close(); } catch { /* already closing */ }
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    // Unlike NDI output this never gives up: a node in the patch is a standing request. The delay
    // caps low enough that recovering feels immediate.
    const delay = Math.min(this.reconnectDelay * (2 ** this.reconnectAttempts), this.maxReconnectDelay);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.bindings.size > 0) this.connect();
    }, delay);
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

  _handleMessage(event) {
    if (typeof event.data !== 'string') {
      const header = this._pendingHeader;
      this._pendingHeader = null;
      if (header) this._acceptFrame(header, event.data);
      return;
    }

    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;

    if (data.type === 'frame') {
      this._pendingHeader = data;
      return;
    }
    if (data.type === 'welcome' || data.type === 'sources') {
      this.ndiAvailable = !!data.ndi_available;
      this.ndiError = data.ndi_error || null;
      this.ndiRuntimeUrl = data.ndi_runtime_url || null;
      if (Array.isArray(data.sources)) this.available = data.sources;
    }
  }

  /**
   * Decode a frame and hand it to every node bound to its source. One decode at a time per
   * source: a frame that arrives while the previous one is still decoding replaces any other
   * waiting frame, so a slow decode skips frames instead of falling further and further behind.
   */
  _acceptFrame(header, bytes) {
    const state = this.sources.get(header.source);
    if (!state) return; // unsubscribed while it was in flight
    this.framesReceived += 1;

    if (state.decoding) {
      if (state.queued) this.framesDropped += 1;
      state.queued = { header, bytes };
      return;
    }
    this._decodeInto(header.source, state, header, bytes);
  }

  async _decodeInto(source, state, header, bytes) {
    state.decoding = true;
    try {
      let bitmap = null;
      try {
        bitmap = await this.decode(header, bytes);
      } catch (error) {
        this.lastError = error.message;
      }
      if (!bitmap) {
        this.framesDropped += 1;
      } else if (this.sources.get(source) !== state) {
        try { bitmap.close?.(); } catch { /* ignore */ }
      } else {
        this._deliver(source, state, bitmap);
      }
    } finally {
      state.decoding = false;
      const next = state.queued;
      state.queued = null;
      if (next && this.sources.get(source) === state) {
        this._decodeInto(source, state, next.header, next.bytes);
      }
    }
  }

  _deliver(source, state, bitmap) {
    const textureManager = this._textureManager();
    for (const [nodeId, name] of this.bindings) {
      if (name === source) textureManager?.setLiveFrame?.(nodeId, bitmap);
    }
    // Keep the newest bitmap for thumbnails; the GPU copies above have already taken their pixels.
    const previous = state.bitmap;
    state.bitmap = bitmap;
    state.frames += 1;
    state.lastFrameAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (previous && previous !== bitmap) {
      try { previous.close?.(); } catch { /* already closed */ }
    }
  }

  getStatus() {
    return {
      supported: this.isSupported,
      connected: this.connected,
      url: this.url,
      ndiAvailable: this.ndiAvailable,
      ndiError: this.ndiError,
      ndiRuntimeUrl: this.ndiRuntimeUrl,
      sources: this.available,
      bound: Object.fromEntries(this.bindings),
      framesReceived: this.framesReceived,
      framesDropped: this.framesDropped,
      lastError: this.lastError,
    };
  }
}

let _shared = null;

/** The editor-wide client. Created on first use so a patch without Live Input opens no socket. */
export function getLiveInput() {
  if (!_shared) {
    _shared = new LiveInput();
    if (typeof window !== 'undefined') window.liveInput = _shared;
  }
  return _shared;
}
