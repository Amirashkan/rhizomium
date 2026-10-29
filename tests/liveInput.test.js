// Live Input: frames from outside the editor (TouchDesigner, OBS, NDI sources) as a texture.
//
// LiveInput is the editor half - it subscribes to the sources Live Input nodes name on the
// video_in_bridge_server.py socket and hands each decoded frame to TextureManager. What matters
// is what a live show leans on: a node binds itself just by being compiled, frames reach every
// node on that source, a slow decode skips frames instead of queueing them, and a node that is
// gone stops its subscription. The codegen half must bind and sample it exactly like a Texture 2D.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LiveInput,
  VIDEO_IN_BRIDGE_PORT,
  defaultVideoInUrl,
  normalizeSourceName,
} from '../src/input/LiveInput.js';
import { TextureManager } from '../src/core/TextureManager.js';
import { buildWGSL } from '../src/codegen/glslBuilder.js';
import { NodeDefs } from '../src/data/NodeDefs.js';
import { isTextureSourceKind } from '../src/core/autoConnect.js';

class FakeSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
    FakeSocket.instances.push(this);
  }

  open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
  send(payload) { this.sent.push(payload); }
  close() { this.closed = true; this.readyState = 3; this.onclose?.(); }
  receive(data) { this.onmessage?.({ data }); }
  jsonSent() { return this.sent.map((p) => JSON.parse(p)); }
}

function fakeBitmap(width = 4, height = 2) {
  return { width, height, closed: false, close() { this.closed = true; } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function frame(socket, source, { width = 4, height = 2, format = 'rgba' } = {}) {
  socket.receive(JSON.stringify({ type: 'frame', source, width, height, format }));
  socket.receive(new ArrayBuffer(width * height * 4));
}

describe('LiveInput client', () => {
  let textureManager;
  let live;

  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    // Bridges only connect from the desktop app; these tests run as if inside it.
    window.__TAURI_INTERNALS__ = {};
    textureManager = { setLiveFrame: vi.fn(), releaseLiveInput: vi.fn() };
    live = new LiveInput({
      url: 'ws://127.0.0.1:8769/ws',
      textureManager,
      decode: vi.fn(async (header) => fakeBitmap(header.width, header.height)),
    });
  });

  afterEach(() => {
    live.disconnect();
    delete window.__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
  });

  it('never opens a socket outside the desktop app', () => {
    delete window.__TAURI_INTERNALS__;
    live.bind('n1', 'TouchDesigner');

    expect(FakeSocket.instances).toHaveLength(0);
    expect(live.statusFor('n1').state).toBe('desktop-only');
  });

  it('defaults to the bridge port next to NDI output', () => {
    expect(VIDEO_IN_BRIDGE_PORT).toBe(8769);
    expect(defaultVideoInUrl()).toContain(':8769/ws');
    expect(normalizeSourceName('  TouchDesigner  ')).toBe('TouchDesigner');
    expect(normalizeSourceName(null)).toBe('');
  });

  it('opens no socket until a node binds a source', () => {
    expect(FakeSocket.instances).toHaveLength(0);
    live.bind('5', '');
    expect(FakeSocket.instances).toHaveLength(0);
    live.bind('5', 'TouchDesigner');
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('subscribes on open, once per source, and binding again is a no-op', () => {
    live.bind('5', 'TouchDesigner');
    live.bind('6', 'TouchDesigner');
    const socket = FakeSocket.instances[0];
    socket.open();
    live.bind('5', 'TouchDesigner');

    expect(socket.jsonSent()).toEqual([{ type: 'subscribe', source: 'TouchDesigner' }]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('delivers one decoded frame to every node on that source', async () => {
    live.bind('5', 'TouchDesigner');
    live.bind('6', 'TouchDesigner');
    live.bind('7', 'OBS');
    const socket = FakeSocket.instances[0];
    socket.open();

    frame(socket, 'TouchDesigner');
    await flush();

    const ids = textureManager.setLiveFrame.mock.calls.map(([id]) => id);
    expect(ids.sort()).toEqual(['5', '6']);
    expect(live.statusFor('5').state).toBe('live');
    expect(live.statusFor('7').state).toBe('waiting');
  });

  it('keeps only the newest frame while a decode is in flight', async () => {
    let release;
    live.decode = vi.fn((header) => new Promise((resolve) => {
      release = () => resolve(fakeBitmap(header.width, header.height));
    }));
    live.bind('5', 'TouchDesigner');
    const socket = FakeSocket.instances[0];
    socket.open();

    frame(socket, 'TouchDesigner', { width: 1, height: 1 });
    frame(socket, 'TouchDesigner', { width: 2, height: 2 });
    frame(socket, 'TouchDesigner', { width: 3, height: 3 });
    expect(live.decode).toHaveBeenCalledTimes(1);

    release();
    await flush();
    expect(live.decode).toHaveBeenCalledTimes(2);
    expect(live.decode.mock.calls[1][0].width).toBe(3);
    expect(live.framesDropped).toBe(1);
  });

  it('closes the previous thumbnail bitmap when a newer frame replaces it', async () => {
    live.bind('5', 'TouchDesigner');
    const socket = FakeSocket.instances[0];
    socket.open();

    frame(socket, 'TouchDesigner');
    await flush();
    const first = live.statusFor('5').bitmap;
    frame(socket, 'TouchDesigner');
    await flush();

    expect(first.closed).toBe(true);
    expect(live.statusFor('5').bitmap.closed).toBe(false);
  });

  it('unsubscribes when the last node on a source goes, and disconnects when none are left', () => {
    live.bind('5', 'TouchDesigner');
    live.bind('6', 'TouchDesigner');
    const socket = FakeSocket.instances[0];
    socket.open();

    live.unbind('5');
    expect(socket.jsonSent()).not.toContainEqual({ type: 'unsubscribe', source: 'TouchDesigner' });

    live.unbind('6');
    expect(socket.jsonSent()).toContainEqual({ type: 'unsubscribe', source: 'TouchDesigner' });
    expect(socket.closed).toBe(true);
    expect(textureManager.releaseLiveInput).toHaveBeenCalledWith('6');
  });

  it('moves a node to a new source when its Source parameter changes', () => {
    live.bind('5', 'TouchDesigner');
    FakeSocket.instances[0].open();
    live.bind('5', 'OBS');

    const socket = FakeSocket.instances.at(-1);
    socket.open();
    expect(socket.jsonSent()).toContainEqual({ type: 'subscribe', source: 'OBS' });
    expect(live.sourceFor('5')).toBe('OBS');
  });

  it('sweeps away bindings whose node left the graph (a different project was opened)', () => {
    live.bind('5', 'TouchDesigner');
    live.bind('6', 'OBS');
    live.sweep({ nodes: [{ id: '6', kind: 'LiveInput' }] });

    expect(live.sourceFor('5')).toBe('');
    expect(live.sourceFor('6')).toBe('OBS');
  });

  it('reports a missing bridge so the thumbnail can say what to run', () => {
    live.bind('5', 'TouchDesigner');
    const status = live.statusFor('5');
    expect(status.state).toBe('no-bridge');
    expect(status.message).toContain('npm run video-in');
  });

  it('records what the bridge says about NDI and the sources it sees', () => {
    live.bind('5', 'TouchDesigner');
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive(JSON.stringify({
      type: 'welcome',
      ndi_available: false,
      ndi_error: 'pip install cyndilib',
      sources: [{ name: 'TouchDesigner', kind: 'stream' }],
    }));

    const status = live.getStatus();
    expect(status.ndiAvailable).toBe(false);
    expect(status.ndiError).toContain('cyndilib');
    expect(status.sources).toEqual([{ name: 'TouchDesigner', kind: 'stream' }]);
  });
});

describe('TextureManager.setLiveFrame', () => {
  function fakeDevice() {
    const textures = [];
    return {
      textures,
      createTexture: vi.fn((desc) => {
        const texture = { ...desc.size, destroyed: false, destroy() { this.destroyed = true; }, createView: () => ({}) };
        textures.push(texture);
        return texture;
      }),
      createSampler: vi.fn(() => ({})),
      queue: { copyExternalImageToTexture: vi.fn(), onSubmittedWorkDone: undefined },
    };
  }

  beforeEach(() => {
    vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reuses one texture per node while the size holds, and rebinds only on a resize', () => {
    const tm = new TextureManager();
    tm.device = fakeDevice();
    tm.bindGroup = {};

    tm.setLiveFrame('5', fakeBitmap(640, 360));
    expect(tm.bindGroup).toBe(null);
    tm.bindGroup = {};
    tm.setLiveFrame('5', fakeBitmap(640, 360));
    expect(tm.bindGroup).toEqual({});
    expect(tm.device.createTexture).toHaveBeenCalledTimes(1);
    expect(tm.device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);

    tm.setLiveFrame('5', fakeBitmap(1280, 720));
    expect(tm.device.createTexture).toHaveBeenCalledTimes(2);
    expect(tm.device.textures[0].destroyed).toBe(true);
    expect(tm.bindGroup).toBe(null);
    expect(tm.gpuTextures.get('5').width).toBe(1280);
    expect(tm.liveInputs.get('5').frame).toBe(3);
  });
});

describe('Live Input codegen', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
    globalThis.window.liveInput = undefined;
  });
  afterEach(() => vi.unstubAllGlobals());

  function build(params) {
    const graph = {
      nodes: [
        { id: '12', kind: 'LiveInput', params, inputs: [null] },
        { id: '99', kind: 'OutputFinal', params: {}, inputs: ['12'] },
      ],
      connections: [],
    };
    const result = buildWGSL(graph);
    return typeof result === 'string' ? result : result.wgsl;
  }

  it('is a Texture node with a Source and a Fit', () => {
    const def = NodeDefs.LiveInput;
    expect(def.cat).toBe('Texture');
    expect(def.params.map((p) => p.name)).toEqual(['source', 'fit']);
    expect(isTextureSourceKind('LiveInput')).toBe(true);
  });

  it('binds texture_<id> and samples it like a Texture 2D', () => {
    const wgsl = build({ source: 'TouchDesigner', fit: 'stretch' });
    expect(wgsl).toMatch(/var texture_12: texture_2d<f32>;/);
    expect(wgsl).toContain('textureSample(texture_12');
    expect(wgsl).not.toContain('textureDimensions(texture_12)');
  });

  it('reads the incoming frame size for contain/cover, and blacks out the letterbox', () => {
    const contain = build({ source: 'TouchDesigner', fit: 'contain' });
    expect(contain).toContain('textureDimensions(texture_12)');
    expect(contain).toContain('inside_12');

    const cover = build({ source: 'TouchDesigner', fit: 'cover' });
    expect(cover).toContain('max(1.0, u.aspect / srcaspect_12)');
    expect(cover).not.toContain('inside_12');
  });
});
