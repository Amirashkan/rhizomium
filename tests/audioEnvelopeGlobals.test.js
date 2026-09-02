// The five `audioEnvelope*` globals: the shader reads them every frame (gpuRenderer packs them into
// `g.audioEnvelope…`), CPU expressions resolve against them, and the second monitor is fed from
// them. Anything that leaves one of them stale is visible on screen and impossible to trace back.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { BrowserAudioCapture } from '../src/audio/BrowserAudioCapture.js';

const GLOBALS = [
  '_audioEnvelopeValue', '_audioEnvelopeBass',
  '_audioEnvelopeMids', '_audioEnvelopeHighs', '_audioEnvelopeFull',
];

/** An instance mid-track: every band up, as a playing frame would have left it. */
function sounding() {
  const capture = new BrowserAudioCapture();
  capture._envelopeValue = 0.8;
  capture._envelopeBass = 0.7;
  capture._envelopeMids = 0.6;
  capture._envelopeHighs = 0.5;
  capture._envelopeFull = 0.9;
  capture._publishEnvelopes();
  return capture;
}

afterEach(() => {
  for (const name of GLOBALS) delete window[name];
});

// What examples/audio-test.html was a manual page for: loading a second file must not call
// createMediaElementSource twice on the same element, which throws "already connected" and leaves
// the analyser deaf for the rest of the session.
describe('loading one file after another', () => {
  it('reuses the media element source instead of connecting a second one', async () => {
    const capture = new BrowserAudioCapture();
    const connect = vi.fn();
    const createMediaElementSource = vi.fn(() => ({ connect }));
    capture.audioContext = {
      sampleRate: 48000,
      createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0, connect: vi.fn(), frequencyBinCount: 1024 }),
      createMediaElementSource,
      destination: {},
    };
    // An element that reports metadata as soon as a src is set.
    capture.audioElement = {
      set src(_value) { queueMicrotask(() => this.onloadedmetadata?.()); },
      get src() { return 'blob:stub'; },
      pause() {}, currentTime: 0, dataset: {},
    };
    globalThis.URL.createObjectURL = () => 'blob:stub';
    globalThis.URL.revokeObjectURL = () => {};

    await capture.loadFile(new Blob(['a']));
    await capture.loadFile(new Blob(['b']));

    expect(createMediaElementSource).toHaveBeenCalledTimes(1);
  });
});

describe('the audioEnvelope globals', () => {
  it('publishes all five together', () => {
    sounding();
    expect(GLOBALS.map((name) => window[name])).toEqual([0.8, 0.7, 0.6, 0.5, 0.9]);
  });

  it('zeroes every band on stop, not just the overall envelope', () => {
    // The bug: stop() reset `_envelopeValue` alone, and the not-playing frame published only
    // `_audioEnvelopeValue`. The four band globals kept their last playing values for the rest of
    // the session, so a patch driven by `=audioEnvelopeBass` stayed stuck off-centre forever.
    const capture = sounding();
    capture.stop();

    for (const name of GLOBALS) expect(window[name], name).toBe(0);
  });

  it('decays the bands toward zero while nothing is playing', () => {
    const capture = sounding();
    capture.isPlaying = false;
    capture.analyser = null;

    const first = capture._envelopeBass;
    for (let i = 0; i < 40; i++) {
      capture._lastUpdateTime = performance.now() - 16.7;
      capture._processAudio();
    }

    expect(capture._envelopeBass).toBeLessThan(first);
    expect(window._audioEnvelopeBass).toBe(capture._envelopeBass);
    // ...and all the way down, rather than to some floor above zero.
    for (let i = 0; i < 400; i++) {
      capture._lastUpdateTime = performance.now() - 16.7;
      capture._processAudio();
    }
    expect(window._audioEnvelopeBass).toBe(0);
  });

  it('reads each band back through a getter that exists', () => {
    // PreviewComputer calls exactly these four. They were never defined, and `?.()` swallowed it —
    // so the CPU preview saw 0 for every band while the shader saw the real values, and a node
    // driven by `=audioEnvelopeBass` rendered correctly but previewed as if the track were silent.
    const capture = sounding();
    expect(capture.getAudioEnvelopeBass()).toBeCloseTo(0.7);
    expect(capture.getAudioEnvelopeMids()).toBeCloseTo(0.6);
    expect(capture.getAudioEnvelopeHighs()).toBeCloseTo(0.5);
    expect(capture.getAudioEnvelopeFull()).toBeCloseTo(0.9);
  });

  it('reads the spectrum once a frame, however many bands ask for it', () => {
    // Three bands used to mean three `getByteFrequencyData` calls into three freshly allocated
    // 1 KB buffers, per frame, for three views of a spectrum that cannot change between them.
    const capture = new BrowserAudioCapture();
    let spectrumReads = 0;
    let timeReads = 0;
    capture.analyser = {
      frequencyBinCount: 1024,
      getByteFrequencyData: () => { spectrumReads++; },
      getFloatTimeDomainData: () => { timeReads++; },
    };
    capture.audioContext = { sampleRate: 48000 };
    capture._analysisFrame = 1;

    const bass = capture._getFrequencyBandRMS('bass');
    const mids = capture._getFrequencyBandRMS('mids');
    const highs = capture._getFrequencyBandRMS('highs');
    expect([bass, mids, highs].every(Number.isFinite)).toBe(true);
    expect(spectrumReads).toBe(1);

    // A new frame gets a fresh read; the buffer itself is not reallocated.
    const buffer = capture._spectrumBuffer;
    capture._analysisFrame = 2;
    capture._getFrequencyBandRMS('bass');
    expect(spectrumReads).toBe(2);
    expect(capture._spectrumBuffer).toBe(buffer);

    // The time-domain path reuses its buffer too.
    capture._getFrequencyBandRMS('fullband');
    const timeBuffer = capture._timeDomainBuffer;
    capture._getFrequencyBandRMS('fullband');
    expect(timeReads).toBe(2);
    expect(capture._timeDomainBuffer).toBe(timeBuffer);
  });

  it('reads 0 from those getters before anything has played', () => {
    const capture = new BrowserAudioCapture();
    expect(capture.getAudioEnvelopeBass()).toBe(0);
    expect(capture.getAudioEnvelopeFull()).toBe(0);
  });
});
