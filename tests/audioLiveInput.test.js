// Live audio input: a microphone or line-in via getUserMedia, and whatever a tab or screen is
// playing via getDisplayMedia. Both feed the SAME analysis engine a file does, so the meters, the
// thresholds set against them and every deployed Audio Value node behave identically — which is
// only true if the wiring below stays true.
//
// The one thing that must never regress here is the audible path. A microphone routed to the
// speakers is a feedback loop, and the analyser used to sit in that path.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserAudioCapture, getBrowserAudioCapture } from '../src/audio/BrowserAudioCapture.js';
import { describeAudioSource } from '../src/ui/AudioSettingsPanel.js';

/** A stub AudioContext that records every connection made through it. */
function stubContext() {
  const destination = { id: 'destination' };
  const analysers = [];
  const connections = [];
  const makeNode = (id) => ({
    id,
    connect(target) { connections.push([id, target?.id ?? target]); },
    disconnect() { connections.push([id, 'disconnected']); },
  });
  return {
    destination,
    analysers,
    connections,
    state: 'running',
    sampleRate: 48000,
    resume: vi.fn(async () => { }),
    createAnalyser() {
      const node = makeNode(`analyser${analysers.length}`);
      node.fftSize = 0;
      node.smoothingTimeConstant = 0;
      node.frequencyBinCount = 1024;
      node.getByteFrequencyData = () => { };
      node.getFloatTimeDomainData = () => { };
      analysers.push(node);
      return node;
    },
    createMediaElementSource: vi.fn(() => makeNode('fileSource')),
    createMediaStreamSource: vi.fn(() => makeNode('liveSource')),
  };
}

/** A MediaStream carrying the tracks asked for. */
function stubStream({ audio = 1, video = 0 } = {}) {
  const make = (kind, i) => {
    const listeners = {};
    return {
      kind,
      label: `${kind} ${i}`,
      stopped: false,
      stop() { this.stopped = true; },
      addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
      emit(name) { for (const fn of listeners[name] || []) fn(); },
    };
  };
  const tracks = [
    ...Array.from({ length: audio }, (_, i) => make('audio', i)),
    ...Array.from({ length: video }, (_, i) => make('video', i)),
  ];
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  };
}

/** A capture instance with its context already stubbed, so nothing opens a real device. */
const opened = [];

function makeCapture(context = stubContext()) {
  const capture = new BrowserAudioCapture();
  capture.audioContext = context;
  capture._ensureContext();
  opened.push(capture);
  return capture;
}

let originalMediaDevices;

beforeEach(() => {
  originalMediaDevices = navigator.mediaDevices;
});

afterEach(() => {
  // Starting a source starts the analysis ticker; leaving one running outlives the test file.
  while (opened.length) opened.pop()._stopAnalysisTicker();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: originalMediaDevices, configurable: true, writable: true,
  });
  delete window._audioBands;
  vi.restoreAllMocks();
});

function withMediaDevices(impl) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: impl, configurable: true, writable: true,
  });
  return impl;
}

describe('opening a microphone', () => {
  it('taps both analysers and reaches the speakers through neither', async () => {
    const context = stubContext();
    const capture = makeCapture(context);
    withMediaDevices({ getUserMedia: vi.fn(async () => stubStream()) });

    await capture.startLiveInput({ kind: 'mic' });

    const fromLive = context.connections.filter(([from]) => from === 'liveSource');
    expect(fromLive.map(([, to]) => to).sort()).toEqual(['analyser0', 'analyser1']);
    // The whole point: nothing from a microphone may reach the output.
    expect(fromLive.some(([, to]) => to === context.destination.id)).toBe(false);
  });

  it('turns off the speech processing that would flatten the meters', async () => {
    const capture = makeCapture();
    const getUserMedia = vi.fn(async () => stubStream());
    withMediaDevices({ getUserMedia });

    await capture.startLiveInput({ kind: 'mic' });

    // Auto gain in particular erases the loud/quiet difference a threshold discriminates on.
    expect(getUserMedia.mock.calls[0][0].audio).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });

  it('asks for the chosen device exactly', async () => {
    const capture = makeCapture();
    const getUserMedia = vi.fn(async () => stubStream());
    withMediaDevices({ getUserMedia });

    await capture.startLiveInput({ kind: 'mic', deviceId: 'interface-2' });

    expect(getUserMedia.mock.calls[0][0].audio.deviceId).toEqual({ exact: 'interface-2' });
  });

  it('reports itself as the running source', async () => {
    const capture = makeCapture();
    withMediaDevices({ getUserMedia: vi.fn(async () => stubStream()) });

    await capture.startLiveInput({ kind: 'mic' });

    expect(capture.isLive()).toBe(true);
    expect(capture.getSourceKind()).toBe('mic');
    expect(capture.getIsPlaying()).toBe(true);
  });

  it('surfaces a denied permission instead of sitting at zero', async () => {
    const capture = makeCapture();
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    withMediaDevices({ getUserMedia: vi.fn(async () => { throw denied; }) });
    const errors = [];
    capture.on('error', (e) => errors.push(e));

    await expect(capture.startLiveInput({ kind: 'mic' })).rejects.toThrow('denied');
    expect(errors).toEqual([denied]);
    expect(capture.isLive()).toBe(false);
  });
});

describe('capturing system audio', () => {
  it('goes through getDisplayMedia and drops the video it had to ask for', async () => {
    const capture = makeCapture();
    const stream = stubStream({ audio: 1, video: 1 });
    const getDisplayMedia = vi.fn(async () => stream);
    withMediaDevices({ getDisplayMedia, getUserMedia: vi.fn() });

    await capture.startLiveInput({ kind: 'system' });

    // Video has to be requested for a browser to offer the audio checkbox at all, but nothing
    // reads the pixels, so encoding a screen capture for the rest of the session is pure waste.
    expect(getDisplayMedia.mock.calls[0][0].video).toBe(true);
    expect(stream.getVideoTracks()[0].stopped).toBe(true);
    expect(stream.getAudioTracks()[0].stopped).toBe(false);
    expect(capture.getSourceKind()).toBe('system');
  });

  it('says so when the share arrived with no audio ticked', async () => {
    const capture = makeCapture();
    const stream = stubStream({ audio: 0, video: 1 });
    withMediaDevices({ getDisplayMedia: vi.fn(async () => stream) });

    // The common mistake: sharing a tab without ticking "Share tab audio" produces a stream that
    // is silent forever, which is indistinguishable from a broken patch unless it is reported.
    await expect(capture.startLiveInput({ kind: 'system' })).rejects.toThrow(/Share tab audio/);
    expect(stream.getVideoTracks()[0].stopped).toBe(true);
    expect(capture.isLive()).toBe(false);
  });
});

describe('stopping a live input', () => {
  it('ends the tracks and settles every meter at zero', async () => {
    const capture = makeCapture();
    const stream = stubStream();
    withMediaDevices({ getUserMedia: vi.fn(async () => stream) });
    await capture.startLiveInput({ kind: 'mic' });
    capture._envelopeBass = 0.8;

    capture.stopLiveInput();

    expect(stream.getAudioTracks()[0].stopped).toBe(true);
    expect(capture.isLive()).toBe(false);
    expect(capture.getIsPlaying()).toBe(false);
    expect(window._audioEnvelopeBass).toBe(0);
    expect(window._audioBands.kick).toBe(0);
  });

  it('follows the browser revoking the share from its own bar', async () => {
    const capture = makeCapture();
    const stream = stubStream();
    withMediaDevices({ getUserMedia: vi.fn(async () => stream) });
    await capture.startLiveInput({ kind: 'mic' });

    // "Stop sharing" in the browser's bar never goes through this panel; the track ending is the
    // only notice there is.
    stream.getAudioTracks()[0].emit('ended');

    expect(capture.isLive()).toBe(false);
  });

  it('is what stop() does when a live input is what is running', async () => {
    const capture = makeCapture();
    const stream = stubStream();
    withMediaDevices({ getUserMedia: vi.fn(async () => stream) });
    await capture.startLiveInput({ kind: 'mic' });

    capture.stop();

    expect(stream.getAudioTracks()[0].stopped).toBe(true);
    expect(capture.isLive()).toBe(false);
  });
});

describe('one source at a time', () => {
  it('pauses the file when a live input opens', async () => {
    const capture = makeCapture();
    const pause = vi.fn();
    capture.audioElement = { pause, paused: false, ended: false, readyState: 4, src: 'blob:x', dataset: {} };
    capture.isPlaying = true;
    withMediaDevices({ getUserMedia: vi.fn(async () => stubStream()) });

    await capture.startLiveInput({ kind: 'mic' });

    // Two sources into one engine would read as their sum, with no way to tell which drum came
    // from where.
    expect(pause).toHaveBeenCalled();
  });

  it('drops the live input when the file is played', async () => {
    const capture = makeCapture();
    const stream = stubStream();
    withMediaDevices({ getUserMedia: vi.fn(async () => stubStream()) });
    capture.audioElement = { play: vi.fn(async () => { }), pause: vi.fn(), src: 'blob:x', dataset: {} };
    withMediaDevices({ getUserMedia: vi.fn(async () => stream) });
    await capture.startLiveInput({ kind: 'mic' });

    await capture.play();

    expect(capture.isLive()).toBe(false);
    expect(stream.getAudioTracks()[0].stopped).toBe(true);
  });

  it('switching between live kinds closes the first one', async () => {
    const capture = makeCapture();
    const mic = stubStream();
    const system = stubStream({ audio: 1, video: 1 });
    withMediaDevices({
      getUserMedia: vi.fn(async () => mic),
      getDisplayMedia: vi.fn(async () => system),
    });

    await capture.startLiveInput({ kind: 'mic' });
    await capture.startLiveInput({ kind: 'system' });

    expect(mic.getAudioTracks()[0].stopped).toBe(true);
    expect(capture.getSourceKind()).toBe('system');
  });
});

describe('the input list', () => {
  it('offers only audio inputs, named where the browser will name them', async () => {
    const capture = makeCapture();
    withMediaDevices({
      enumerateDevices: vi.fn(async () => [
        { kind: 'audioinput', deviceId: 'a', label: 'Scarlett 2i2' },
        { kind: 'videoinput', deviceId: 'b', label: 'FaceTime HD' },
        // Labels are withheld until permission has been granted once — a placeholder still lets
        // the device be picked, which is what grants it.
        { kind: 'audioinput', deviceId: 'c', label: '' },
      ]),
    });

    expect(await capture.listInputDevices()).toEqual([
      { deviceId: 'a', label: 'Scarlett 2i2' },
      { deviceId: 'c', label: 'Input 2' },
    ]);
  });

  it('is empty rather than throwing where enumeration is unavailable', async () => {
    const capture = makeCapture();
    withMediaDevices({});
    expect(await capture.listInputDevices()).toEqual([]);
  });
});

describe('what the rest of the app is told', () => {
  it('describes a live input as the running source', async () => {
    // describeAudioSource() reads the singleton, which is the one the app actually runs.
    const capture = getBrowserAudioCapture();
    capture.audioContext = stubContext();
    capture._ensureContext();
    opened.push(capture);
    withMediaDevices({ getUserMedia: vi.fn(async () => stubStream()) });
    await capture.startLiveInput({ kind: 'mic' });

    const source = describeAudioSource();

    // The Audio node's notice and the panel's chip both read this; a live meter must not be
    // reported as "every channel reads 0".
    expect(source.playing).toBe(true);
    expect(source.live).toBe(true);
    expect(source.state).toBe('live');
    expect(source.sourceKind).toBe('mic');
  });
});
