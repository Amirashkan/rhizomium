// src/osc/OSCManager.js

import { decodeMessages, oscArgToNumber, OSCDecodeError } from './OSCDecoder.js';

/**
 * OSCManager - receives OSC over a WebSocket bridge and emits events.
 *
 * This is the OSC counterpart to MIDIManager. The shape is deliberately the
 * same (initialize / disable / getStatus / value lookups / events on the shared
 * event system) so the binding layer and settings panel read alike, but the
 * transport is not: Web MIDI hands us devices, while OSC arrives as UDP that no
 * browser can listen for. A bridge (osc_bridge_server.py) owns the UDP socket
 * and forwards each datagram over a WebSocket, so "connecting" here means
 * reaching the bridge, and "devices" become the OSC addresses seen so far.
 */

/** Default bridge port, one past the frame-stream server on 8766. */
export const OSC_BRIDGE_PORT = 8767;

/** Default UDP port the bridge listens on — the usual OSC convention. */
export const OSC_DEFAULT_UDP_PORT = 9000;

/**
 * Cap on remembered addresses. A misconfigured sender can spray unique
 * addresses (per-note, per-index) forever, and this map outlives any single
 * message, so it needs a ceiling to stay bounded.
 */
const MAX_TRACKED_ADDRESSES = 512;

export function defaultBridgeUrl() {
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return `ws://127.0.0.1:${OSC_BRIDGE_PORT}/ws`;
  }
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.hostname}:${OSC_BRIDGE_PORT}/ws`;
}

export class OSCManager {
  constructor(eventSystem, options = {}) {
    this.eventSystem = eventSystem;
    this.url = options.url || defaultBridgeUrl();

    this.ws = null;
    this.isSupported = typeof WebSocket !== 'undefined';
    this.isEnabled = false;
    this.connected = false;

    // Reconnection backoff, matching AudioEnvelopeClient's shape.
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.reconnectTimer = null;

    // Latest value per address: address -> { args, types, value, count, lastSeen }
    this.addresses = new Map();

    // What the bridge told us about itself on connect.
    this.bridgeInfo = null;

    // Message-rate bookkeeping for the settings panel.
    this.messageCount = 0;
    this._rateWindowStart = 0;
    this._rateWindowCount = 0;
    this.messageRate = 0;

    this.lastError = null;
  }

  /**
   * Connect to the bridge.
   *
   * Named to match MIDIManager.initialize() so the settings panels stay
   * interchangeable; unlike MIDI there is no permission prompt, so the promise
   * resolves as soon as the socket opens.
   */
  initialize() {
    if (!this.isSupported) {
      return Promise.reject(new Error('WebSocket is not supported in this browser'));
    }

    this.isEnabled = true;
    return this.connect();
  }

  /**
   * Open the socket. Resolves on open, rejects if the first attempt fails —
   * later drops are handled by the reconnect timer rather than the promise.
   */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return Promise.resolve(true);
    }

    this._clearReconnectTimer();

    return new Promise((resolve, reject) => {
      let settled = false;

      let socket;
      try {
        socket = new WebSocket(this.url);
      } catch (error) {
        this.lastError = error.message;
        this._emit('OSC_ERROR', { message: error.message, url: this.url });
        reject(error);
        return;
      }

      this.ws = socket;
      // Datagrams arrive as raw OSC, so ask for buffers rather than Blobs.
      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        this.connected = true;
        this.isEnabled = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.lastError = null;

        this._emit('OSC_CONNECTED', { url: this.url });

        if (!settled) {
          settled = true;
          resolve(true);
        }
      };

      socket.onmessage = (event) => this._handleTransportMessage(event.data);

      socket.onerror = () => {
        // The error event carries no useful detail in browsers; the close that
        // follows is what tells us whether to retry.
        this.lastError = `Could not reach the OSC bridge at ${this.url}`;
        this._emit('OSC_ERROR', { message: this.lastError, url: this.url });
      };

      socket.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        if (this.ws === socket) this.ws = null;

        const willRetry = this.isEnabled && this.reconnectAttempts < this.maxReconnectAttempts;
        this._emit('OSC_DISCONNECTED', { url: this.url, willRetry });

        if (!settled) {
          settled = true;
          reject(new Error(this.lastError || `Could not reach the OSC bridge at ${this.url}`));
        }

        if (this.isEnabled) this._scheduleReconnect();
        else if (wasConnected) this._clearReconnectTimer();
      };
    });
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isEnabled) return;
      // A failed retry rejects this promise; the close handler queues the next
      // attempt, so nothing is lost by ignoring it here.
      this.connect().catch(() => {});
    }, delay);
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Handle one WebSocket payload.
   *
   * Binary payloads are raw OSC packets forwarded straight off the UDP socket.
   * Text payloads are the bridge's own JSON control messages — and, so that a
   * different bridge can be dropped in without shipping raw datagrams, a JSON
   * rendering of an OSC message is accepted too.
   */
  _handleTransportMessage(payload) {
    if (typeof payload === 'string') {
      this._handleJSONMessage(payload);
      return;
    }

    try {
      for (const message of decodeMessages(payload)) {
        this._dispatchMessage(message.address, message.args, message.types);
      }
    } catch (error) {
      // One malformed datagram must not take down the stream: report it and
      // keep listening.
      const detail = error instanceof OSCDecodeError ? error.message : String(error);
      this.lastError = `Malformed OSC packet: ${detail}`;
      this._emit('OSC_ERROR', { message: this.lastError, url: this.url });
    }
  }

  _handleJSONMessage(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return;
    }

    if (!data || typeof data !== 'object') return;

    if (data.type === 'welcome') {
      this.bridgeInfo = {
        udpHost: data.udp_host ?? null,
        udpPort: data.udp_port ?? null,
        version: data.server_version ?? null,
      };
      this._emit('OSC_BRIDGE_INFO', this.bridgeInfo);
      return;
    }

    if (typeof data.address === 'string') {
      const args = Array.isArray(data.args) ? data.args : [];
      this._dispatchMessage(data.address, args, data.types ?? '');
    }
  }

  _dispatchMessage(address, args, types) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    let entry = this.addresses.get(address);
    if (!entry) {
      if (this.addresses.size >= MAX_TRACKED_ADDRESSES) {
        // Drop the least recently seen address to make room; bindings hold
        // their own copy of the address, so they survive this.
        let oldestKey = null;
        let oldestSeen = Infinity;
        for (const [key, value] of this.addresses) {
          if (value.lastSeen < oldestSeen) {
            oldestSeen = value.lastSeen;
            oldestKey = key;
          }
        }
        if (oldestKey !== null) this.addresses.delete(oldestKey);
      }
      entry = { address, args: [], types: '', value: 0, count: 0, lastSeen: 0 };
      this.addresses.set(address, entry);
      this._emit('OSC_ADDRESSES_CHANGED', { addresses: this.getAddresses() });
    }

    entry.args = args;
    entry.types = types;
    entry.value = args.length > 0 ? oscArgToNumber(args[0]) : 0;
    entry.count++;
    entry.lastSeen = now;

    this.messageCount++;
    this._updateRate(now);

    this._emit('OSC_MESSAGE', {
      address,
      args,
      types,
      value: entry.value,
      timestamp: now,
    });
  }

  _updateRate(now) {
    if (this._rateWindowStart === 0) {
      this._rateWindowStart = now;
      this._rateWindowCount = 0;
    }

    this._rateWindowCount++;
    const elapsed = now - this._rateWindowStart;
    if (elapsed >= 1000) {
      this.messageRate = (this._rateWindowCount * 1000) / elapsed;
      this._rateWindowStart = now;
      this._rateWindowCount = 0;
    }
  }

  _emit(name, data) {
    this.eventSystem?.emit?.(name, data);
  }

  /** Point at a different bridge, reconnecting if we were already connected. */
  setUrl(url) {
    if (!url || url === this.url) return;
    this.url = url;
    this.addresses.clear();
    this.bridgeInfo = null;

    if (this.isEnabled) {
      this.reconnectAttempts = 0;
      this._closeSocket();
      this.connect().catch(() => {});
    }
  }

  /** Latest value at an address, as a number. */
  getValue(address, argIndex = 0) {
    const entry = this.addresses.get(address);
    if (!entry) return 0;
    if (argIndex === 0) return entry.value;
    return argIndex < entry.args.length ? oscArgToNumber(entry.args[argIndex]) : 0;
  }

  /** Latest raw arguments at an address. */
  getArgs(address) {
    return this.addresses.get(address)?.args ?? [];
  }

  /** Every address seen since connecting, most recently active first. */
  getAddresses() {
    return Array.from(this.addresses.values())
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((entry) => ({
        address: entry.address,
        types: entry.types,
        args: entry.args,
        value: entry.value,
        count: entry.count,
        lastSeen: entry.lastSeen,
      }));
  }

  isConnected() {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  getStatus() {
    return {
      supported: this.isSupported,
      enabled: this.isEnabled,
      connected: this.isConnected(),
      url: this.url,
      addressCount: this.addresses.size,
      messageCount: this.messageCount,
      messageRate: this.messageRate,
      bridge: this.bridgeInfo,
      lastError: this.lastError,
    };
  }

  _closeSocket() {
    if (!this.ws) return;
    const socket = this.ws;
    this.ws = null;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Already closing — nothing to do.
    }
  }

  /** Disconnect and stop retrying, mirroring MIDIManager.disable(). */
  disable() {
    this.isEnabled = false;
    this.connected = false;
    this._clearReconnectTimer();
    this._closeSocket();
    this.addresses.clear();
    this.bridgeInfo = null;
    this._emit('OSC_DISCONNECTED', { url: this.url, willRetry: false });
  }

  destroy() {
    this.disable();
  }
}

export default OSCManager;
