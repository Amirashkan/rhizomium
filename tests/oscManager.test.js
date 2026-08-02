// Tests for OSCManager — the WebSocket side of the OSC receiver.
//
// The bridge is stood in for by a fake socket, so these cover what the editor
// does with what arrives: decode it, remember it, announce it, and survive a
// bad packet or a dropped connection.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OSCManager, defaultBridgeUrl, OSC_BRIDGE_PORT } from '../src/osc/OSCManager.js';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.binaryType = 'blob';
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  // --- test drivers ---
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  receive(data) {
    this.onmessage?.({ data });
  }

  fail() {
    this.onerror?.({});
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }
}
FakeWebSocket.instances = [];

function makeEventSystem() {
  const handlers = new Map();
  const seen = [];
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    emit(type, data) {
      seen.push({ type, data });
      (handlers.get(type) || []).forEach((fn) => fn(data));
    },
    seen,
    of(type) {
      return seen.filter((e) => e.type === type).map((e) => e.data);
    },
  };
}

// Minimal OSC message builder: address, ",f", one float.
function floatMessage(address, value) {
  const encoder = new TextEncoder();
  const addr = encoder.encode(address);
  const addrLen = (addr.length + 4) & ~3;
  const out = new Uint8Array(addrLen + 4 + 4);
  out.set(addr, 0);
  out.set(encoder.encode(',f'), addrLen);
  new DataView(out.buffer).setFloat32(addrLen + 4, value, false);
  return out.buffer;
}

let originalWebSocket;

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.useRealTimers();
});

/** Connect a manager and hand back the socket the bridge would be holding. */
async function connected(events, options) {
  const manager = new OSCManager(events, options);
  const pending = manager.initialize();
  FakeWebSocket.instances.at(-1).open();
  await pending;
  return { manager, socket: FakeWebSocket.instances.at(-1) };
}

describe('OSCManager connection', () => {
  it('connects and reports itself connected', async () => {
    const events = makeEventSystem();
    const { manager } = await connected(events);

    expect(manager.isConnected()).toBe(true);
    expect(events.of('OSC_CONNECTED')).toHaveLength(1);
    expect(manager.getStatus()).toMatchObject({ connected: true, enabled: true });
  });

  it('asks for arraybuffers, since datagrams arrive as raw OSC', async () => {
    const { socket } = await connected(makeEventSystem());
    expect(socket.binaryType).toBe('arraybuffer');
  });

  it('rejects the first attempt when the bridge is not running', async () => {
    const events = makeEventSystem();
    const manager = new OSCManager(events);
    const pending = manager.initialize();

    FakeWebSocket.instances.at(-1).fail();

    await expect(pending).rejects.toThrow(/Could not reach the OSC bridge/);
    expect(events.of('OSC_ERROR')).toHaveLength(1);
  });

  it('retries after an unexpected drop', async () => {
    vi.useFakeTimers();
    const events = makeEventSystem();
    const { socket } = await connected(events);

    expect(FakeWebSocket.instances).toHaveLength(1);
    socket.close();

    expect(events.of('OSC_DISCONNECTED')[0]).toMatchObject({ willRetry: true });

    await vi.advanceTimersByTimeAsync(1100);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('stops retrying once disabled', async () => {
    vi.useFakeTimers();
    const { manager } = await connected(makeEventSystem());

    manager.disable();
    await vi.advanceTimersByTimeAsync(60000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(manager.isConnected()).toBe(false);
  });

  it('derives a bridge URL on the editor host', () => {
    expect(defaultBridgeUrl()).toContain(`:${OSC_BRIDGE_PORT}/ws`);
  });
});

describe('OSCManager message handling', () => {
  it('decodes a binary packet into an OSC_MESSAGE event', async () => {
    const events = makeEventSystem();
    const { socket } = await connected(events);

    socket.receive(floatMessage('/1/fader1', 0.75));

    expect(events.of('OSC_MESSAGE')).toHaveLength(1);
    expect(events.of('OSC_MESSAGE')[0]).toMatchObject({
      address: '/1/fader1',
      args: [0.75],
      value: 0.75,
    });
  });

  it('remembers the latest value per address', async () => {
    const { manager, socket } = await connected(makeEventSystem());

    socket.receive(floatMessage('/a', 0.25));
    socket.receive(floatMessage('/a', 0.9));
    socket.receive(floatMessage('/b', 0.1));

    // float32 on the wire, so compare with tolerance rather than exactly.
    expect(manager.getValue('/a')).toBeCloseTo(0.9, 6);
    expect(manager.getValue('/b')).toBeCloseTo(0.1, 6);
    expect(manager.getValue('/never-seen')).toBe(0);
    expect(manager.getStatus().addressCount).toBe(2);
  });

  it('announces an address the first time it is seen, not on every message', async () => {
    const events = makeEventSystem();
    const { socket } = await connected(events);

    socket.receive(floatMessage('/a', 0.1));
    socket.receive(floatMessage('/a', 0.2));

    expect(events.of('OSC_ADDRESSES_CHANGED')).toHaveLength(1);
  });

  it('lists addresses most recently active first', async () => {
    const { manager, socket } = await connected(makeEventSystem());

    socket.receive(floatMessage('/first', 1));
    socket.receive(floatMessage('/second', 1));

    expect(manager.getAddresses().map((a) => a.address)).toEqual(['/second', '/first']);
  });

  it('survives a malformed packet and keeps listening', async () => {
    const events = makeEventSystem();
    const { manager, socket } = await connected(events);

    // One bad datagram must not take down the stream.
    expect(() => socket.receive(new Uint8Array([1, 2, 3]).buffer)).not.toThrow();
    expect(events.of('OSC_ERROR')[0].message).toMatch(/Malformed OSC packet/);

    socket.receive(floatMessage('/after', 0.5));
    expect(manager.getValue('/after')).toBe(0.5);
  });

  it('accepts a JSON-framed message, so another bridge can be dropped in', async () => {
    const { manager, socket } = await connected(makeEventSystem());

    socket.receive(JSON.stringify({ address: '/json/fader', args: [0.4] }));

    expect(manager.getValue('/json/fader')).toBeCloseTo(0.4, 6);
  });

  it('records the bridge welcome so the panel can show the UDP port', async () => {
    const events = makeEventSystem();
    const { manager, socket } = await connected(events);

    socket.receive(JSON.stringify({
      type: 'welcome',
      server_version: '1.0.0',
      udp_host: '0.0.0.0',
      udp_port: 9000,
    }));

    expect(manager.getStatus().bridge).toMatchObject({ udpPort: 9000, udpHost: '0.0.0.0' });
    expect(events.of('OSC_BRIDGE_INFO')).toHaveLength(1);
  });

  it('ignores unparseable text without disturbing the stream', async () => {
    const { manager, socket } = await connected(makeEventSystem());

    expect(() => socket.receive('not json')).not.toThrow();
    expect(manager.getStatus().addressCount).toBe(0);
  });

  it('reads a chosen argument index off a multi-argument message', async () => {
    const { manager, socket } = await connected(makeEventSystem());

    socket.receive(JSON.stringify({ address: '/xy', args: [0.3, 0.7] }));

    expect(manager.getValue('/xy', 0)).toBe(0.3);
    expect(manager.getValue('/xy', 1)).toBe(0.7);
    expect(manager.getValue('/xy', 5)).toBe(0);
  });

  it('bounds the address map so a spraying sender cannot grow it forever', async () => {
    const { manager, socket } = await connected(makeEventSystem());

    for (let i = 0; i < 600; i++) {
      socket.receive(JSON.stringify({ address: `/note/${i}`, args: [1] }));
    }

    expect(manager.getStatus().addressCount).toBeLessThanOrEqual(512);
    // The most recent addresses are the ones kept.
    expect(manager.getValue('/note/599')).toBe(1);
  });
});

describe('OSCManager teardown', () => {
  it('clears remembered state on disable', async () => {
    const { manager, socket } = await connected(makeEventSystem());
    socket.receive(floatMessage('/a', 1));

    manager.disable();

    expect(manager.getStatus().addressCount).toBe(0);
    expect(manager.getValue('/a')).toBe(0);
  });

  it('reconnects to a new bridge URL', async () => {
    const { manager } = await connected(makeEventSystem());

    manager.setUrl('ws://elsewhere:9999/ws');

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances.at(-1).url).toBe('ws://elsewhere:9999/ws');
  });
});
