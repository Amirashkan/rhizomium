// The session protocol, driven over a fake socket.
//
// Two behaviours here are the difference between a shared canvas and a canvas
// that fights itself, and neither is visible in a screenshot:
//
//   - A peer must not echo an edit it has just applied. Apply, then diff
//     against a stale baseline, and the applied op goes back out as if it were
//     local — two peers then bounce one node between them forever.
//   - A joiner must adopt the room's canvas rather than merge with it. There is
//     no honest merge of two unrelated patches (see CollabSession.js), so this
//     asserts adoption, including the destructive part.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Graph } from '../src/data/Graph.js';
import { makeNode } from '../src/data/NodeDefs.js';
import { CollabSession, STATES, peerColor } from '../src/collab/CollabSession.js';
import { snapshotGraph } from '../src/collab/ops.js';

/** Just enough WebSocket to drive the session, and nothing that talks. */
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.last = this;
  }

  send(raw) {
    this.sent.push(JSON.parse(raw));
  }

  close() {
    this.readyState = 3;
    this.onclose?.({});
  }

  open() {
    this.readyState = 1;
    this.onopen?.({});
  }

  deliver(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  /** Messages of one kind, in order. */
  ofKind(kind) {
    return this.sent.filter((m) => m.t === kind);
  }
}

function makeSession(graph) {
  const session = new CollabSession({
    url: 'ws://127.0.0.1:8767/room',
    getGraph: () => graph,
    socketFactory: FakeSocket,
  });
  session.join('basalt-101', { name: 'Ada' });
  FakeSocket.last.open();
  return { session, socket: FakeSocket.last };
}

describe('joining a room', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('says hello with the room and the artist’s name', () => {
    const { socket } = makeSession(new Graph());
    expect(socket.ofKind('hello')[0]).toMatchObject({
      room: 'basalt-101',
      identity: { name: 'Ada' },
    });
  });

  it('the first peer in keeps its own canvas and goes live', () => {
    const graph = new Graph();
    graph.add(makeNode('ConstFloat', 10, 10));
    const { session, socket } = makeSession(graph);

    socket.deliver({ t: 'welcome', peerId: 'p1', founder: true, peers: [{ peerId: 'p1', name: 'Ada' }] });

    expect(session.state).toBe(STATES.LIVE);
    expect(socket.ofKind('snapshot.request')).toHaveLength(0);
    // Its own canvas is the room's, so there is nothing to send yet.
    expect(session.flush()).toBe(0);
    session.leave();
  });

  it('a later peer asks for the canvas and adopts it, losing what it had open', () => {
    const mine = new Graph();
    mine.add(makeNode('ConstFloat', 0, 0));
    const { session, socket } = makeSession(mine);

    socket.deliver({ t: 'welcome', peerId: 'p2', founder: false, peers: [] });
    expect(session.state).toBe(STATES.SYNCING);
    expect(socket.ofKind('snapshot.request')).toHaveLength(1);

    const theirs = new Graph();
    const node = makeNode('ConstFloat', 400, 400);
    node.id = 'room-1';
    theirs.add(node);

    socket.deliver({ t: 'snapshot', snapshot: snapshotGraph(theirs) });

    expect(session.state).toBe(STATES.LIVE);
    expect(mine.nodes.map((n) => n.id)).toEqual(['room-1']);
    session.leave();
  });
});

describe('when the room does not answer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a joiner promoted to founder stops waiting and starts applying ops', () => {
    const graph = new Graph();
    const { session, socket } = makeSession(graph);

    socket.deliver({ t: 'welcome', peerId: 'p2', founder: false, peers: [] });
    // The peer it was going to ask left, so the relay promotes this one.
    socket.deliver({ t: 'welcome', peerId: 'p2', founder: true, peers: [{ peerId: 'p2', name: 'Ada' }] });

    expect(session.state).toBe(STATES.LIVE);
    // The waiting flag has to have been cleared, or every op below is ignored
    // for the life of the session.
    socket.deliver({
      t: 'ops',
      from: 'p9',
      ops: [{ op: 'node.add', id: 'r1', kind: 'ConstFloat', x: 0, y: 0, fields: {}, by: 'p9', at: 1 }],
    });
    expect(graph.getNode('r1')).toBeTruthy();
    session.leave();
  });

  it('retries once, then carries on with the local canvas rather than hanging', () => {
    const graph = new Graph();
    graph.add(makeNode('ConstFloat', 0, 0));
    const { session, socket } = makeSession(graph);
    const errors = [];
    session.on('error', (e) => errors.push(e.message));

    socket.deliver({ t: 'welcome', peerId: 'p2', founder: false, peers: [] });
    expect(session.state).toBe(STATES.SYNCING);

    vi.advanceTimersByTime(5000);
    expect(socket.ofKind('snapshot.request')).toHaveLength(2);
    expect(session.state).toBe(STATES.SYNCING);

    vi.advanceTimersByTime(5000);
    expect(session.state).toBe(STATES.LIVE);
    expect(errors.join(' ')).toMatch(/carrying on with yours/i);
    // Its own canvas is now the baseline, so it does not immediately re-send it.
    expect(session.flush()).toBe(0);
    session.leave();
  });
});

describe('a live session', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function live(graph) {
    const { session, socket } = makeSession(graph);
    socket.deliver({ t: 'welcome', peerId: 'p1', founder: true, peers: [{ peerId: 'p1', name: 'Ada' }] });
    return { session, socket };
  }

  it('sends what changed locally and nothing else', () => {
    const graph = new Graph();
    const { session, socket } = live(graph);

    graph.add(makeNode('ConstFloat', 20, 30));
    expect(session.flush()).toBe(1);
    expect(socket.ofKind('ops')[0].ops[0]).toMatchObject({ op: 'node.add', kind: 'ConstFloat' });

    // Nothing moved since; an idle canvas is silent.
    expect(session.flush()).toBe(0);
    expect(socket.ofKind('ops')).toHaveLength(1);
    session.leave();
  });

  it('does not spend clock time on an idle canvas', () => {
    const { session } = live(new Graph());
    const before = session.lamport.at;
    session.flush();
    session.flush();
    expect(session.lamport.at).toBe(before);
    session.leave();
  });

  it('applies a remote edit and does not echo it back', () => {
    const graph = new Graph();
    const { session, socket } = live(graph);

    socket.deliver({
      t: 'ops',
      from: 'p9',
      ops: [{ op: 'node.add', id: 'remote-1', kind: 'ConstFloat', x: 60, y: 70, fields: {}, by: 'p9', at: 4 }],
    });

    expect(graph.getNode('remote-1')).toBeTruthy();
    // The baseline moved with the applied op, so the next diff has nothing to
    // say about it. Without that, this peer sends the edit straight back.
    expect(session.flush()).toBe(0);
    expect(socket.ofKind('ops')).toHaveLength(0);
    session.leave();
  });

  it('takes a remote clock into account so its own next edit reads as newer', () => {
    const graph = new Graph();
    const { session, socket } = live(graph);

    socket.deliver({
      t: 'ops',
      from: 'p9',
      ops: [{ op: 'node.add', id: 'remote-1', kind: 'ConstFloat', x: 0, y: 0, fields: {}, by: 'p9', at: 40 }],
    });

    graph.getNode('remote-1').x = 500;
    session.flush();
    expect(socket.ofKind('ops')[0].ops[0].at).toBeGreaterThan(40);
    session.leave();
  });

  it('answers a snapshot request with the canvas, addressed to the asker', () => {
    const graph = new Graph();
    graph.add(makeNode('ConstFloat', 1, 2));
    const { session, socket } = live(graph);

    socket.deliver({ t: 'snapshot.request', from: 'p7' });

    const answer = socket.ofKind('snapshot')[0];
    expect(answer.to).toBe('p7');
    expect(Object.keys(answer.snapshot.nodes)).toHaveLength(1);
    session.leave();
  });

  it('reports the roster, and gives every peer a stable colour', () => {
    const { session, socket } = live(new Graph());
    const seen = [];
    session.on('peers', (roster) => seen.push(roster.map((p) => p.name)));

    socket.deliver({ t: 'peers', peers: [{ peerId: 'p1', name: 'Ada' }, { peerId: 'p2', name: 'Bo' }] });

    expect(seen.at(-1)).toEqual(['Ada', 'Bo']);
    expect(peerColor('p2')).toBe(peerColor('p2'));
    expect(peerColor('p2')).not.toBe(peerColor('p1'));
    session.leave();
  });

  it('drops a peer’s cursor when the peer leaves', () => {
    const { session, socket } = live(new Graph());
    socket.deliver({ t: 'peers', peers: [{ peerId: 'p1', name: 'Ada' }, { peerId: 'p2', name: 'Bo' }] });
    socket.deliver({ t: 'cursor', from: 'p2', x: 10, y: 20 });
    expect(session.cursorList()).toHaveLength(1);

    socket.deliver({ t: 'peers', peers: [{ peerId: 'p1', name: 'Ada' }] });
    expect(session.cursorList()).toHaveLength(0);
    session.leave();
  });

  it('leaves cleanly: says bye, stops the diff loop, empties the room', () => {
    const graph = new Graph();
    const { session, socket } = live(graph);
    session.leave();

    expect(socket.ofKind('bye')).toHaveLength(1);
    expect(session.state).toBe(STATES.CLOSED);
    expect(session.diffTimer).toBeNull();

    // A flush after leaving must not resurrect the socket traffic.
    graph.add(makeNode('ConstFloat', 0, 0));
    expect(session.flush()).toBe(0);
  });
});

describe('when the relay goes away', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries with a backoff rather than hammering the port', () => {
    const graph = new Graph();
    const { session, socket } = makeSession(graph);
    socket.deliver({ t: 'welcome', peerId: 'p1', founder: true, peers: [] });

    socket.close();
    expect(session.state).toBe(STATES.RECONNECTING);
    expect(session.reconnectAttempts).toBe(1);

    // Nothing is sent in the gap, and the loop is not left running.
    expect(session.diffTimer).toBeNull();

    vi.advanceTimersByTime(1000);
    expect(FakeSocket.last).not.toBe(socket);

    session.leave();
  });

  it('stops trying after a deliberate leave', () => {
    const { session, socket } = makeSession(new Graph());
    socket.deliver({ t: 'welcome', peerId: 'p1', founder: true, peers: [] });
    session.leave();

    const closed = FakeSocket.last;
    vi.advanceTimersByTime(60000);
    expect(FakeSocket.last).toBe(closed);
    expect(session.state).toBe(STATES.CLOSED);
  });
});

describe('showing a pass at the door', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A session whose hello waits on a grant, as the panel's does. */
  function makeGuardedSession(getGrant) {
    const session = new CollabSession({
      url: 'ws://relay.example/room',
      getGraph: () => new Graph(),
      socketFactory: FakeSocket,
      getGrant,
    });
    session.join('basalt-101', { name: 'Ada' });
    FakeSocket.last.open();
    return { session, socket: FakeSocket.last };
  }

  it('waits for the grant before saying hello, then carries it', async () => {
    const { session, socket } = makeGuardedSession(async () => 'tok-1');

    // Nothing has gone out yet: the gallery has not answered.
    expect(socket.ofKind('hello')).toHaveLength(0);

    await vi.waitFor(() => expect(socket.ofKind('hello')).toHaveLength(1));
    expect(socket.ofKind('hello')[0]).toMatchObject({ room: 'basalt-101', grant: 'tok-1' });
    session.leave();
  });

  it('says hello without one rather than not at all, and lets the relay decide', async () => {
    // The loopback case: no gallery to ask, and a relay that will not ask either.
    const { session, socket } = makeGuardedSession(async () => null);

    await vi.waitFor(() => expect(socket.ofKind('hello')).toHaveLength(1));
    expect(socket.ofKind('hello')[0].grant).toBeUndefined();
    session.leave();
  });

  it('asks for a new grant on the reconnect, because the relay spent the last one', async () => {
    let issued = 0;
    const { session, socket } = makeGuardedSession(async () => `tok-${++issued}`);
    await vi.waitFor(() => expect(socket.ofKind('hello')).toHaveLength(1));

    socket.close();
    vi.advanceTimersByTime(1000);
    const second = FakeSocket.last;
    expect(second).not.toBe(socket);
    second.open();

    await vi.waitFor(() => expect(second.ofKind('hello')).toHaveLength(1));
    expect(second.ofKind('hello')[0].grant).toBe('tok-2');
    session.leave();
  });

  it('does not say hello on a socket that died while the gallery was thinking', async () => {
    let release;
    const { session, socket } = makeGuardedSession(() => new Promise((r) => { release = r; }));
    await Promise.resolve(); // let the session get as far as asking

    socket.close();
    release('tok-late');
    await Promise.resolve();
    await Promise.resolve();

    expect(socket.ofKind('hello')).toHaveLength(0);
    session.leave();
  });
});

describe('when the relay says no', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Retrying a refusal spends a minute arriving at the same sentence, and hides
  // that sentence behind "Reconnecting…" while it does — which is how a
  // configuration problem gets reported as a flaky network.
  for (const code of ['grant_required', 'grant_invalid', 'bad_token', 'room_full', 'no_room']) {
    it(`stops on ${code} and keeps the reason on screen`, () => {
      const { session, socket } = makeSession(new Graph());

      socket.deliver({ t: 'error', code, message: 'The relay explained itself.' });
      socket.close();

      expect(session.state).toBe(STATES.FAILED);
      expect(session.lastError).toBe('The relay explained itself.');
      expect(session.refused).toBe(code);

      const dead = FakeSocket.last;
      vi.advanceTimersByTime(60000);
      expect(FakeSocket.last).toBe(dead);
    });
  }

  it('still retries a refusal that is not about this peer', () => {
    const { session, socket } = makeSession(new Graph());

    socket.deliver({ t: 'error', code: 'shutting_down', message: 'Relay restarting.' });
    socket.close();

    expect(session.state).toBe(STATES.RECONNECTING);
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.last).not.toBe(socket);
    session.leave();
  });

  it('forgets the refusal when the artist tries again', () => {
    const { session, socket } = makeSession(new Graph());
    socket.deliver({ t: 'error', code: 'room_full', message: 'That room is full.' });
    socket.close();
    expect(session.refused).toBe('room_full');

    session.join('basalt-101', { name: 'Ada' });
    expect(session.refused).toBeNull();
    session.leave();
  });
});
