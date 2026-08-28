/**
 * CollabSession.js — one artist's connection to a shared canvas.
 *
 * The session owns four things and deliberately nothing else:
 *
 *   1. the socket to the room relay, and its reconnect policy;
 *   2. the roster — who else is in the room, and where their pointer is;
 *   3. the outbound half — snapshot, diff, send (see ops.js for why a diff);
 *   4. the inbound half — apply other people's ops to this graph.
 *
 * It does not draw anything (src/ui/CollabPanel.js does), it does not decide
 * who is allowed in (src/collab/collabGate.js does), and it does not know what
 * a node is beyond what ops.js tells it. Keeping those apart is what makes the
 * protocol testable without a canvas and the panel testable without a socket.
 *
 * ## Adoption, not merging
 *
 * Joining a room means adopting the room's canvas: the first thing a joiner
 * does is ask for a snapshot and apply it over whatever it had open. There is
 * no merge of two unrelated patches, because there is no honest way to merge
 * two unrelated patches — the nodes have different ids and the same wire means
 * different things on each side. The panel is responsible for saying so before
 * it calls `join()`, because the artist is about to lose an unsaved canvas.
 *
 * ## What a reconnect does
 *
 * Not "replay what you missed" — this session holds no journal and the relay
 * holds no history. A reconnecting peer re-adopts the room's snapshot and
 * rebases on it. Edits made while the socket was down are lost, on purpose: a
 * best-effort replay of an unknown gap is how two canvases quietly stop
 * matching, and a quiet mismatch is worse than a visible loss.
 *
 * ## Showing a pass at the door
 *
 * A relay run with `--grant-secret` admits only peers carrying a grant the
 * gallery signed (collab_room_server.py). When `getGrant` is supplied, this
 * session asks for one before every hello — every hello, including the
 * reconnect's, because the relay spends a grant when it admits a peer and a
 * reused one is refused as a replay. See src/collab/collabGrant.js.
 *
 * Not supplying `getGrant` is a valid way to run: a loopback relay asks for
 * nothing, and the tests drive the protocol without a gallery. So the hello
 * goes out either way and the relay decides — with one exception. A refusal
 * the relay marks fatal (a bad pass, a full room, a wrong token) is not
 * retried: reconnecting six times over a minute cannot change any of those
 * answers, and burying the one sentence that explains the problem under
 * "Reconnecting…" is how an artist ends up reporting the wrong bug.
 */

import {
  OPS_VERSION,
  LamportClock,
  OpClock,
  applyOps,
  diffSnapshots,
  snapshotGraph,
  trackLocalOps,
} from './ops.js';

/** How often the outbound half looks for local changes. */
const DIFF_INTERVAL_MS = 150;

/** Pointer updates are presence, not state — cheap to send, cheap to miss. */
const CURSOR_INTERVAL_MS = 60;

/** How long a joiner waits for the room's canvas before giving up on it. */
const SNAPSHOT_TIMEOUT_MS = 5000;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 16000;
const MAX_RECONNECT_ATTEMPTS = 6;

/**
 * Relay refusals that reconnecting cannot fix.
 *
 * Each of these is a decision about this peer rather than a hiccup on the wire:
 * the room is full, the token is wrong, the pass was missing or not accepted.
 * Retrying spends a minute to arrive at the same sentence, so the session stops
 * and keeps the sentence instead. Anything not listed here — a relay restart, a
 * dropped socket — is still worth another try.
 */
const FATAL_REFUSALS = new Set([
  'bad_token',
  'grant_required',
  'grant_invalid',
  'no_room',
  'room_full',
]);

/** Connection states, in the order a healthy session passes through them. */
export const STATES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  SYNCING: 'syncing',
  LIVE: 'live',
  RECONNECTING: 'reconnecting',
  CLOSED: 'closed',
  FAILED: 'failed',
};

/**
 * A stable colour per peer, so the same artist is the same colour on every
 * screen in the room without anyone having to agree on one.
 */
export function peerColor(peerId) {
  let hash = 0;
  for (let i = 0; i < String(peerId).length; i += 1) {
    hash = (hash * 31 + String(peerId).charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 70% 58%)`;
}

export class CollabSession {
  /**
   * @param {object} options
   * @param {string} options.url       - room relay, e.g. ws://127.0.0.1:8767/room
   * @param {() => object} options.getGraph - returns the live graph
   * @param {() => void} [options.onGraphChanged] - called after remote ops land
   * @param {typeof WebSocket} [options.socketFactory] - injected for tests
   * @param {() => Promise<string|null>} [options.getGrant] - a fresh admission
   *   grant for each hello. Omit it for a relay that does not ask for one.
   */
  constructor({ url, getGraph, onGraphChanged, socketFactory, getGrant } = {}) {
    this.url = url;
    this.getGraph = getGraph;
    this.onGraphChanged = onGraphChanged;
    this.getGrant = getGrant || null;
    this.socketFactory = socketFactory || (typeof WebSocket !== 'undefined' ? WebSocket : null);

    this.room = null;
    this.identity = null;
    this.peerId = null;

    this.state = STATES.IDLE;
    this.lastError = null;

    this.ws = null;
    this.peers = new Map();
    this.cursors = new Map();

    this.lamport = null;
    this.opClock = new OpClock();
    this.lastSent = { nodes: {}, wires: {} };

    this.diffTimer = null;
    this.cursorTimer = null;
    this.snapshotTimer = null;
    this.snapshotRetried = false;
    this.pendingCursor = null;

    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.wantsConnection = false;
    this.awaitingSnapshot = false;
    /** Set when the relay refused for a reason retrying cannot change. */
    this.refused = null;

    this.listeners = new Map();
  }

  // ------------------------------------------------------------------
  // Events: 'state', 'peers', 'cursors', 'error'
  // ------------------------------------------------------------------

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    for (const handler of this.listeners.get(event) || []) {
      try {
        handler(payload);
      } catch (error) {
        // A listener that throws is the panel's problem, not the room's: one
        // bad redraw must not take the socket down with it.
        console.warn('[collab] listener failed', error);
      }
    }
  }

  setState(state, error = null) {
    this.state = state;
    this.lastError = error;
    this.emit('state', { state, error });
  }

  get roster() {
    return [...this.peers.values()];
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  /**
   * Join `room` as `identity` ({name}).
   *
   * Resolves once the socket is open — not once the canvas is in sync, which
   * is a later state the caller watches for through the 'state' event.
   */
  join(room, identity) {
    this.room = room;
    this.identity = identity;
    this.wantsConnection = true;
    this.reconnectAttempts = 0;
    // A second attempt is judged on its own: the artist may have signed in, or
    // the room may have emptied, since the last refusal.
    this.refused = null;
    return this.connect();
  }

  connect() {
    if (!this.socketFactory) {
      const error = new Error('No WebSocket implementation available');
      this.setState(STATES.FAILED, error.message);
      return Promise.reject(error);
    }
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return Promise.resolve(true);
    }

    this.clearReconnectTimer();
    this.setState(this.reconnectAttempts > 0 ? STATES.RECONNECTING : STATES.CONNECTING);

    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      try {
        socket = new this.socketFactory(this.url);
      } catch (error) {
        this.setState(STATES.FAILED, error.message);
        reject(error);
        return;
      }

      this.ws = socket;

      socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.snapshotRetried = false;
        this.sayHello(socket);
        if (!settled) { settled = true; resolve(true); }
      };

      socket.onmessage = (event) => this.receive(event.data);

      socket.onerror = () => {
        // Browsers give the error event no useful detail; the close that
        // follows is what says whether to retry.
        this.lastError = `Could not reach the collab relay at ${this.url}`;
        this.emit('error', { message: this.lastError });
      };

      socket.onclose = () => {
        if (this.ws === socket) this.ws = null;
        this.stopDiffLoop();
        this.peers.clear();
        this.cursors.clear();
        this.emit('peers', this.roster);

        if (this.refused) {
          // onRelayError already set FAILED with the relay's own sentence.
          // Overwriting it here with "Left the room" would throw away the only
          // explanation the artist is going to get.
        } else if (!this.wantsConnection) {
          this.setState(STATES.CLOSED);
        } else if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          this.scheduleReconnect();
        } else {
          this.setState(STATES.FAILED, this.lastError || 'The collab relay stopped responding.');
        }

        if (!settled) {
          settled = true;
          reject(new Error(this.lastError || `Could not reach the collab relay at ${this.url}`));
        }
      };
    });
  }

  scheduleReconnect() {
    this.reconnectAttempts += 1;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_MS);
    this.setState(STATES.RECONNECTING, `Reconnecting in ${Math.round(delay / 1000)}s…`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // The close handler already decided whether to try again.
      });
    }, delay);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Leave the room. Idempotent. */
  leave() {
    this.wantsConnection = false;
    this.refused = null;
    this.clearReconnectTimer();
    this.stopDiffLoop();
    if (this.ws && this.ws.readyState === 1) {
      this.send({ t: 'bye' });
      this.ws.close();
    }
    this.ws = null;
    this.peers.clear();
    this.cursors.clear();
    this.emit('peers', this.roster);
    this.setState(STATES.CLOSED);
  }

  // ------------------------------------------------------------------
  // Transport
  // ------------------------------------------------------------------

  /**
   * Introduce this peer to the relay, with a pass when one can be had.
   *
   * Synchronous when there is no `getGrant`, because that is the shape the
   * protocol has always had and a relay that asks for nothing should not wait
   * on a promise to find out. With one, the hello waits for the gallery — and
   * checks on the way back that this is still the socket it was called for,
   * since a slow grant and a dropped connection race.
   *
   * @returns {Promise<boolean>} whether the hello went out.
   */
  sayHello(socket) {
    const hello = { t: 'hello', room: this.room, identity: this.identity };

    if (!this.getGrant) {
      this.send(hello);
      this.setState(STATES.SYNCING);
      return Promise.resolve(true);
    }

    return Promise.resolve()
      .then(() => this.getGrant())
      .catch(() => null) // A grant source that throws is a source with no grant.
      .then((grant) => {
        if (this.ws !== socket || socket.readyState !== 1) return false;
        this.send(grant ? { ...hello, grant } : hello);
        this.setState(STATES.SYNCING);
        return true;
      });
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    try {
      this.ws.send(JSON.stringify({ v: OPS_VERSION, ...message }));
      return true;
    } catch (error) {
      this.emit('error', { message: error.message });
      return false;
    }
  }

  receive(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      // A relay that speaks nonsense is a bug worth seeing, not a reason to
      // drop a live session.
      this.emit('error', { message: 'The relay sent something this build cannot read.' });
      return;
    }

    switch (message.t) {
      case 'welcome':
        this.onWelcome(message);
        break;
      case 'peers':
        this.onPeers(message.peers);
        break;
      case 'ops':
        this.onOps(message);
        break;
      case 'cursor':
        this.onCursor(message);
        break;
      case 'snapshot.request':
        this.onSnapshotRequest(message);
        break;
      case 'snapshot':
        this.onSnapshot(message);
        break;
      case 'error':
        this.onRelayError(message);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------
  // Protocol
  // ------------------------------------------------------------------

  /**
   * The relay said no. Decide whether that is worth retrying.
   *
   * A fatal refusal stops the session where it stands: `wantsConnection` goes
   * false so the close that follows does not schedule a reconnect, and the
   * state carries the relay's own words, which are more specific than anything
   * this file could invent about someone else's configuration.
   */
  onRelayError(message) {
    const text = message.message || 'The relay refused that.';
    this.emit('error', { message: text, code: message.code || null });

    if (!FATAL_REFUSALS.has(message.code)) return;

    this.refused = message.code;
    this.wantsConnection = false;
    this.clearReconnectTimer();
    this.setState(STATES.FAILED, text);
  }

  onWelcome(message) {
    this.peerId = message.peerId;
    this.lamport = new LamportClock(this.peerId, message.at || 0);
    this.onPeers(message.peers);

    if (message.founder) {
      // Nobody to adopt from: this peer's canvas *is* the room's canvas. The
      // relay also sends this when a room empties under a peer that was still
      // waiting for a snapshot, so the waiting flag has to be cleared here —
      // leaving it set would make this peer ignore every op that follows.
      this.goLiveWithLocalCanvas();
      return;
    }

    this.requestSnapshot();
  }

  /**
   * Ask the room for its canvas, and do not wait forever.
   *
   * The peer that was asked can leave between the request and the answer. One
   * retry covers that; after that this peer goes live on its own canvas rather
   * than sitting in 'syncing' with a dead room — a session that never starts
   * and never says why is the worst of the three outcomes.
   */
  requestSnapshot() {
    this.awaitingSnapshot = true;
    this.setState(STATES.SYNCING);
    this.send({ t: 'snapshot.request' });

    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => {
      if (!this.awaitingSnapshot) return;
      if (!this.snapshotRetried) {
        this.snapshotRetried = true;
        this.requestSnapshot();
        return;
      }
      this.emit('error', { message: 'Nobody in the room sent their canvas. Carrying on with yours.' });
      this.goLiveWithLocalCanvas();
    }, SNAPSHOT_TIMEOUT_MS);
  }

  /** Take the local canvas as the room's, and start sending changes. */
  goLiveWithLocalCanvas() {
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.awaitingSnapshot = false;
    this.lastSent = snapshotGraph(this.getGraph?.());
    this.opClock = new OpClock();
    this.setState(STATES.LIVE);
    this.startDiffLoop();
  }

  onPeers(peers) {
    this.peers.clear();
    for (const peer of peers || []) {
      this.peers.set(peer.peerId, { ...peer, color: peerColor(peer.peerId) });
    }
    for (const id of [...this.cursors.keys()]) {
      if (!this.peers.has(id)) this.cursors.delete(id);
    }
    this.emit('peers', this.roster);
    this.emit('cursors', this.cursorList());
  }

  /** Someone joined and wants the room's canvas. Any live peer can answer. */
  onSnapshotRequest(message) {
    if (this.state !== STATES.LIVE) return;
    this.send({ t: 'snapshot', to: message.from, snapshot: snapshotGraph(this.getGraph?.()) });
  }

  onSnapshot(message) {
    const graph = this.getGraph?.();
    if (!graph || !message.snapshot) return;

    // Adopt wholesale: diff what we have against what the room has, and apply
    // the difference with no clock, because nothing here is a concurrent edit
    // — it is the room's truth arriving.
    const ops = diffSnapshots(snapshotGraph(graph), message.snapshot, { by: 'room', at: 0 });
    applyOps(graph, ops, null);

    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = null;
    this.awaitingSnapshot = false;
    this.snapshotRetried = false;
    this.lastSent = snapshotGraph(graph);
    this.opClock = new OpClock();
    this.onGraphChanged?.();
    this.setState(STATES.LIVE);
    this.startDiffLoop();
  }

  onOps(message) {
    const graph = this.getGraph?.();
    if (!graph || !Array.isArray(message.ops) || message.ops.length === 0) return;
    if (this.awaitingSnapshot) return; // rebasing; the snapshot carries these

    for (const op of message.ops) this.lamport?.observe(op.at);

    const result = applyOps(graph, message.ops, this.opClock);
    if (!result.changed) return;

    // Fold the applied ops into our own baseline, or the next diff would read
    // them as local edits and echo them straight back into the room.
    this.lastSent = snapshotGraph(graph);
    this.onGraphChanged?.();
  }

  onCursor(message) {
    if (!message.from || message.from === this.peerId) return;
    this.cursors.set(message.from, { peerId: message.from, x: message.x, y: message.y, at: Date.now() });
    this.emit('cursors', this.cursorList());
  }

  cursorList() {
    return [...this.cursors.values()].map((cursor) => ({
      ...cursor,
      name: this.peers.get(cursor.peerId)?.name || 'Someone',
      color: peerColor(cursor.peerId),
    }));
  }

  // ------------------------------------------------------------------
  // Outbound half
  // ------------------------------------------------------------------

  startDiffLoop(interval = DIFF_INTERVAL_MS) {
    if (this.diffTimer) return;
    this.diffTimer = setInterval(() => this.flush(), interval);
  }

  stopDiffLoop() {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    if (this.diffTimer) {
      clearInterval(this.diffTimer);
      this.diffTimer = null;
    }
    if (this.cursorTimer) {
      clearInterval(this.cursorTimer);
      this.cursorTimer = null;
    }
  }

  /**
   * Send whatever changed locally since the last flush.
   *
   * Public because the tests drive it directly, and because an explicit flush
   * after a big apply (a paste, an AI refactor) gets the room in step without
   * waiting out the interval.
   */
  flush() {
    if (this.state !== STATES.LIVE || !this.lamport) return 0;
    const graph = this.getGraph?.();
    if (!graph) return 0;

    const next = snapshotGraph(graph);
    const stamp = this.lamport.tick();
    const ops = diffSnapshots(this.lastSent, next, stamp);
    if (ops.length === 0) {
      // Nothing changed, so the tick was spent for nothing — take it back, or
      // an idle canvas would race the clock away from everyone else's.
      this.lamport.at -= 1;
      return 0;
    }

    trackLocalOps(ops, this.opClock);
    this.lastSent = next;
    this.send({ t: 'ops', ops });
    return ops.length;
  }

  /** Report this artist's pointer, in canvas coordinates. Throttled. */
  moveCursor(x, y) {
    this.pendingCursor = { x, y };
    if (this.cursorTimer) return;
    this.cursorTimer = setInterval(() => {
      if (!this.pendingCursor || this.state !== STATES.LIVE) return;
      this.send({ t: 'cursor', ...this.pendingCursor });
      this.pendingCursor = null;
    }, CURSOR_INTERVAL_MS);
  }
}
