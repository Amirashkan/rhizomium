// NDIOutput is the editor half of the NDI path: it takes frames off the
// renderer's tap and writes them to the local bridge, which owns the actual NDI
// sender. What matters here is the behaviour that only shows up under load at a
// live show — the throttle, the backpressure drop, and the rule that every
// tapped bitmap is closed on every path, including the ones that send nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NDIOutput,
  NDI_BRIDGE_PORT,
  NDI_DEFAULT_SOURCE_NAME,
  defaultBridgeUrl,
} from '../src/output/NDIOutput.js';

/** A WebSocket stand-in that records what was sent and lets tests drive events. */
class FakeSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeSocket.OPEN;
    this.bufferedAmount = 0;
    this.sent = [];
    this.closed = false;
    FakeSocket.instances.push(this);
  }

  send(payload) { this.sent.push(payload); }
  close() { this.closed = true; this.onclose?.(); }

  /** Everything sent as parsed JSON, ignoring the binary frames. */
  jsonSent() {
    return this.sent
      .filter((p) => typeof p === 'string')
      .map((p) => JSON.parse(p));
  }

  binarySent() {
    return this.sent.filter((p) => typeof p !== 'string');
  }
}

function fakeBitmap(width = 4, height = 2) {
  return { width, height, closed: false, close() { this.closed = true; } };
}

/**
 * A renderer stand-in exposing the tap. Returns the registered callback so a
 * test can push frames through exactly as the renderer would.
 */
function fakeRenderer() {
  const renderer = {
    tap: null,
    untapped: false,
    addFrameTap(callback) {
      renderer.tap = callback;
      return () => { renderer.untapped = true; renderer.tap = null; };
    },
  };
  return renderer;
}

/** Stub the 2D readback so getImageData yields a known, size-correct buffer. */
function stubReadback() {
  const context = {
    drawImage: vi.fn(),
    getImageData: vi.fn((_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })),
  };
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() { return context; }
  });
  return context;
}

/** Connect an output to a fake bridge and hand back the pieces a test needs. */
async function connected(options = {}) {
  const output = new NDIOutput(options);
  const renderer = fakeRenderer();
  const promise = output.initialize(renderer);
  const socket = FakeSocket.instances.at(-1);
  socket.onopen();
  await promise;
  return { output, renderer, socket };
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('performance', { now: () => Date.now() });
  stubReadback();
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('NDIOutput bridge address', () => {
  it('defaults to the loopback bridge one port past the OSC bridge', () => {
    expect(NDI_BRIDGE_PORT).toBe(8768);
    expect(defaultBridgeUrl()).toContain(`:${NDI_BRIDGE_PORT}/ws`);
  });
});

describe('NDIOutput connection', () => {
  it('announces the source name and frame rate as soon as it connects', async () => {
    const { socket } = await connected({ sourceName: 'Stage Left', fps: 25 });

    // The bridge may have been started by hand with different settings; the
    // editor's are the ones the artist chose, so it says so on connect.
    expect(socket.jsonSent()).toEqual([
      { type: 'set_source_name', name: 'Stage Left' },
      { type: 'set_frame_rate', fps: 25 },
    ]);
  });

  it('attaches to the renderer tap on connect and detaches on disable', async () => {
    const { output, renderer } = await connected();
    expect(typeof renderer.tap).toBe('function');

    output.disable();
    expect(renderer.untapped).toBe(true);
  });

  it('takes the bridge\'s word on whether NDI actually works', async () => {
    const { output, socket } = await connected();
    expect(output.getStatus().ndiAvailable).toBe(false);

    socket.onmessage({ data: JSON.stringify({
      type: 'welcome', ndi_available: false,
      ndi_error: 'The cyndilib Python binding is not installed.',
      source_name: NDI_DEFAULT_SOURCE_NAME,
    }) });

    // Reaching the bridge is not the same as being able to publish, and the
    // difference is what the artist has to be told.
    const status = output.getStatus();
    expect(status.connected).toBe(true);
    expect(status.ndiAvailable).toBe(false);
    expect(status.ndiError).toContain('cyndilib');
  });

  it('ignores a malformed message rather than throwing on the socket', async () => {
    const { socket } = await connected();
    expect(() => socket.onmessage({ data: 'not json' })).not.toThrow();
  });

  it('does not reconnect after a deliberate disable', async () => {
    vi.useFakeTimers();
    const { output } = await connected();
    output.disable();

    vi.advanceTimersByTime(60000);
    // One socket, from the original connect: a stop must stay stopped.
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('schedules a reconnect when the bridge drops while still enabled', async () => {
    vi.useFakeTimers();
    const { output, socket } = await connected();

    socket.onclose();
    expect(output.connected).toBe(false);
    expect(output.reconnectTimer).not.toBeNull();
  });
});

describe('NDIOutput frame publishing', () => {
  it('sends a header describing the frame, then its pixels', async () => {
    const { renderer, socket } = await connected();

    renderer.tap(fakeBitmap(4, 2));

    const headers = socket.jsonSent().filter((m) => m.type === 'frame');
    expect(headers).toEqual([{ type: 'frame', width: 4, height: 2, format: 'rgba' }]);

    // The payload must be exactly width × height × RGBA, which is what the
    // bridge validates before publishing it.
    const [payload] = socket.binarySent();
    expect(payload.byteLength).toBe(4 * 2 * 4);
  });

  it('closes every bitmap it is handed, sent or not', async () => {
    const { output, renderer } = await connected({ fps: 1 });

    const first = fakeBitmap();
    renderer.tap(first);
    expect(first.closed).toBe(true);

    // The second is inside the throttle window and is never sent - it still
    // has to be closed, or the renderer leaks a frame per tick.
    const second = fakeBitmap();
    renderer.tap(second);
    expect(second.closed).toBe(true);
    expect(output.framesSent).toBe(1);
  });

  it('throttles to the target rate', async () => {
    let clock = 1000;
    vi.stubGlobal('performance', { now: () => clock });
    const { output, renderer, socket } = await connected({ fps: 10 });

    renderer.tap(fakeBitmap());
    clock += 50;                       // inside the 100ms window
    renderer.tap(fakeBitmap());
    clock += 60;                       // now past it
    renderer.tap(fakeBitmap());

    expect(output.framesSent).toBe(2);
    expect(socket.binarySent()).toHaveLength(2);
  });

  it('drops the frame rather than queueing behind a backed-up socket', async () => {
    const { output, renderer, socket } = await connected();
    socket.bufferedAmount = 64 * 1024 * 1024;

    const bitmap = fakeBitmap();
    renderer.tap(bitmap);

    // Late video is worse than missing video on a live output.
    expect(output.framesSent).toBe(0);
    expect(output.framesDropped).toBe(1);
    expect(socket.binarySent()).toHaveLength(0);
    expect(bitmap.closed).toBe(true);
  });

  it('counts a readback failure and keeps going', async () => {
    const context = stubReadback();
    context.getImageData.mockImplementation(() => { throw new Error('tainted canvas'); });

    const { output, renderer } = await connected();
    const bitmap = fakeBitmap();
    expect(() => renderer.tap(bitmap)).not.toThrow();

    expect(output.framesDropped).toBe(1);
    expect(output.getStatus().lastError).toContain('tainted');
    expect(bitmap.closed).toBe(true);
  });

  it('sends nothing once disabled, even if a tapped frame arrives late', async () => {
    const { output, renderer } = await connected();
    const tap = renderer.tap;
    output.disable();

    const bitmap = fakeBitmap();
    expect(() => tap(bitmap)).not.toThrow();
    expect(output.framesSent).toBe(0);
    expect(bitmap.closed).toBe(true);
  });

  it('rebuilds the readback surface when the output resolution changes', async () => {
    // Drive the clock so the two frames sit either side of the throttle window
    // rather than landing in the same millisecond.
    let clock = 1000;
    vi.stubGlobal('performance', { now: () => clock });
    const { renderer, socket } = await connected({ fps: 30 });

    renderer.tap(fakeBitmap(4, 2));
    clock += 100;
    renderer.tap(fakeBitmap(8, 4));

    const headers = socket.jsonSent().filter((m) => m.type === 'frame');
    expect(headers.map((h) => [h.width, h.height])).toEqual([[4, 2], [8, 4]]);
    expect(socket.binarySent().map((b) => b.byteLength)).toEqual([32, 128]);
  });
});

describe('NDIOutput settings', () => {
  it('renames the source on the bridge', async () => {
    const { output, socket } = await connected();
    output.setSourceName('  Front of House  ');

    expect(output.sourceName).toBe('Front of House');
    expect(socket.jsonSent().at(-1)).toEqual({
      type: 'set_source_name', name: 'Front of House',
    });
  });

  it('refuses an empty name rather than publishing an unnamed source', async () => {
    const { output, socket } = await connected({ sourceName: 'Keep Me' });
    const before = socket.sent.length;

    output.setSourceName('   ');

    expect(output.sourceName).toBe('Keep Me');
    expect(socket.sent).toHaveLength(before);
  });

  it('refuses a frame rate outside what NDI will advertise', async () => {
    const { output } = await connected({ fps: 30 });

    output.setFrameRate(0);
    output.setFrameRate(1000);
    output.setFrameRate(Number.NaN);
    expect(output.targetFps).toBe(30);

    output.setFrameRate(60);
    expect(output.targetFps).toBe(60);
  });
});
