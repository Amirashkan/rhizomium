import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  applyFrameRate,
  hasRecordableAudio,
  openAudioTap,
  selectRecordingMimeType,
} from '../src/audio/recordingAudio.js';

/** Stand in for MediaRecorder, supporting only the mime types listed. */
function stubMediaRecorder(supported) {
  vi.stubGlobal('MediaRecorder', {
    isTypeSupported: (type) => supported.includes(type),
  });
}

/**
 * A BrowserAudioCapture stand-in: an audio element, a context whose
 * destination node hands out one track, and a source node recording what it
 * was connected to.
 */
function fakeCapture({ playing = false, currentTime = 12.5, contextState = 'running' } = {}) {
  const track = { stopped: false, stop() { this.stopped = true; } };
  const connections = [];
  const capture = {
    connections,
    resumed: false,
    playCalls: 0,
    pauseCalls: 0,
    audioElement: { currentTime },
    source: {
      connect: (node) => connections.push(node),
      disconnect: (node) => {
        const index = connections.indexOf(node);
        if (index === -1) throw new Error('not connected');
        connections.splice(index, 1);
      },
    },
    audioContext: {
      state: contextState,
      async resume() {
        capture.resumed = true;
        this.state = 'running';
      },
      createMediaStreamDestination: () => ({
        stream: { getAudioTracks: () => [track] },
      }),
    },
    getIsPlaying: () => playing,
    async play() {
      capture.playCalls++;
      playing = true;
    },
    pause() {
      capture.pauseCalls++;
      playing = false;
    },
  };
  capture.track = track;
  return capture;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('selectRecordingMimeType', () => {
  it('picks an audio-capable container when the recording carries sound', () => {
    stubMediaRecorder(['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2']);

    expect(selectRecordingMimeType({ withAudio: true })).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  });

  it('never picks a video-only container for an audio recording', () => {
    // H.264 video is supported, but only WebM can carry audio here. Choosing
    // the MP4 would drop the track silently, which is the bug this guards.
    stubMediaRecorder(['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9,opus']);

    expect(selectRecordingMimeType({ withAudio: true })).toBe('video/webm;codecs=vp9,opus');
  });

  it('still prefers MP4 for a silent recording', () => {
    stubMediaRecorder(['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9']);

    expect(selectRecordingMimeType()).toBe('video/mp4;codecs=avc1.42E01E');
  });

  it('returns null when the browser records nothing', () => {
    stubMediaRecorder([]);

    expect(selectRecordingMimeType({ withAudio: true })).toBeNull();
    expect(selectRecordingMimeType()).toBeNull();
  });
});

describe('applyFrameRate', () => {
  it('adds the hint when the browser takes it alongside the codecs', () => {
    stubMediaRecorder(['video/mp4;codecs=avc1.42E01E,mp4a.40.2;framerate=30']);

    expect(applyFrameRate('video/mp4;codecs=avc1.42E01E,mp4a.40.2', 30))
      .toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2;framerate=30');
  });

  it('keeps the codecs rather than buying the hint with them', () => {
    // The codec-less form is supported, but taking it would leave the audio
    // codec to the browser's default.
    stubMediaRecorder(['video/mp4;framerate=30']);

    expect(applyFrameRate('video/mp4;codecs=avc1.42E01E,mp4a.40.2', 30))
      .toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  });
});

describe('hasRecordableAudio', () => {
  it('sees a loaded file', () => {
    expect(hasRecordableAudio(fakeCapture())).toBe(true);
  });

  it('sees nothing before a file is loaded', () => {
    const capture = fakeCapture();
    capture.source = null;

    expect(hasRecordableAudio(capture)).toBe(false);
    expect(hasRecordableAudio(null)).toBe(false);
    expect(hasRecordableAudio(undefined)).toBe(false);
  });
});

describe('openAudioTap', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('branches off the source and yields a track', async () => {
    const capture = fakeCapture();

    const tap = await openAudioTap(capture);

    expect(tap.track).toBe(capture.track);
    expect(capture.connections).toHaveLength(1);
  });

  it('resumes a context the autoplay policy suspended', async () => {
    const capture = fakeCapture({ contextState: 'suspended' });

    await openAudioTap(capture);

    expect(capture.resumed).toBe(true);
  });

  it('returns null when there is no audio to record', async () => {
    const capture = fakeCapture();
    capture.source = null;

    expect(await openAudioTap(capture)).toBeNull();
  });

  it('starts playback only when the track is not already rolling', async () => {
    const stopped = fakeCapture({ playing: false });
    const rolling = fakeCapture({ playing: true });

    const stoppedTap = await openAudioTap(stopped);
    const rollingTap = await openAudioTap(rolling);

    expect(await stoppedTap.startPlayback()).toBe(true);
    expect(stopped.playCalls).toBe(1);
    expect(await rollingTap.startPlayback()).toBe(false);
    expect(rolling.playCalls).toBe(0);
  });

  it('puts the playhead back where the artist left it', async () => {
    const capture = fakeCapture({ playing: false, currentTime: 42 });

    const tap = await openAudioTap(capture);
    await tap.startPlayback();
    capture.audioElement.currentTime = 47; // played on through the recording
    tap.stop();

    expect(capture.pauseCalls).toBe(1);
    expect(capture.audioElement.currentTime).toBe(42);
  });

  it('leaves playback alone when it was already running', async () => {
    const capture = fakeCapture({ playing: true, currentTime: 8 });

    const tap = await openAudioTap(capture);
    await tap.startPlayback();
    capture.audioElement.currentTime = 13;
    tap.stop();

    expect(capture.pauseCalls).toBe(0);
    expect(capture.audioElement.currentTime).toBe(13);
  });

  it('drops the branch and ends the track on stop', async () => {
    const capture = fakeCapture();

    const tap = await openAudioTap(capture);
    tap.stop();

    expect(capture.connections).toHaveLength(0);
    expect(capture.track.stopped).toBe(true);
  });

  it('survives a second stop - the caller unwinds from several places', async () => {
    const capture = fakeCapture();

    const tap = await openAudioTap(capture);
    tap.stop();

    expect(() => tap.stop()).not.toThrow();
  });
});

// Live input — a microphone, or system audio shared from another tab — is the other thing a patch
// can be reacting to. An export made while one is running used to come out silent, because the tap
// only looked for a loaded file.
describe('recording a live input', () => {
  function liveCapture() {
    const connected = [];
    const liveSource = {
      connect: (d) => connected.push(d),
      disconnect: (d) => connected.splice(connected.indexOf(d), 1),
    };
    const track = { kind: 'audio', stop() { this.stopped = true; }, stopped: false };
    return {
      connected,
      liveSource,
      track,
      audioContext: {
        state: 'running',
        createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [track] } }),
      },
      audioElement: null,
      source: null,
      isLive: () => true,
      getIsPlaying: () => true,
      play: vi.fn(),
      pause: vi.fn(),
    };
  }

  it('counts as recordable with no file loaded', () => {
    expect(hasRecordableAudio(liveCapture())).toBe(true);
  });

  it('taps the live source', async () => {
    const capture = liveCapture();
    const tap = await openAudioTap(capture);
    expect(tap).not.toBeNull();
    expect(capture.connected).toHaveLength(1);
    tap.stop();
    expect(capture.connected).toHaveLength(0);
  });

  it('does not try to start playback that has no playhead', async () => {
    const capture = liveCapture();
    const tap = await openAudioTap(capture);
    // capture.play() on a live input would throw: there is no audio element to play.
    expect(await tap.startPlayback()).toBe(false);
    expect(capture.play).not.toHaveBeenCalled();
    tap.stop();
    expect(capture.pause).not.toHaveBeenCalled();
  });
});
