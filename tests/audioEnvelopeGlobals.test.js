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

// The band variables used to be their own measurement — RMS of the byte spectrum, x3, square-root —
// and since those bytes are already dB-scaled, ordinary music pinned bass and mids at 1.0, so
// `0.15 + audioEnvelopeBass * 0.3` held still. They now read the panel's Low / Mid / High / Level
// meters, which are calibrated and follow the Audio node's Attack / Release / Gain.
describe('the band variables', () => {
  /** A capture fed a fixed spectrum: `db(hz)` gives each bin's level in dBFS. */
  function playing(db) {
    const capture = new BrowserAudioCapture();
    const bins = 1024;
    const sampleRate = 48000;
    const fill = (out) => {
      for (let i = 0; i < out.length; i++) out[i] = db((i * sampleRate) / 2 / bins);
    };
    capture.audioContext = { sampleRate };
    capture.analyser = {
      frequencyBinCount: bins,
      getByteFrequencyData: (out) => out.fill(200),
      getFloatTimeDomainData: (out) => out.fill(0.3),
    };
    capture._fluxAnalyser = { frequencyBinCount: bins, getFloatFrequencyData: fill };
    capture.isPlaying = true;
    return capture;
  }

  function run(capture, frames = 30) {
    for (let i = 0; i < frames; i++) {
      capture._lastUpdateTime = performance.now() - 8;
      capture._processAudio();
    }
  }

  // Loud everywhere, as a mastered mix is.
  const loud = (hz) => (hz < 250 ? -12 : hz < 2000 ? -24 : -40);

  it('are the panel meters, so an expression reads the number its meter shows', () => {
    const capture = playing(loud);
    run(capture);

    const bands = window._audioBands;
    expect(capture.getAudioEnvelopeBass()).toBe(bands.low);
    expect(capture.getAudioEnvelopeMids()).toBe(bands.mid);
    expect(capture.getAudioEnvelopeHighs()).toBe(bands.high);
    expect(capture.getAudioEnvelopeFull()).toBe(bands.level);
    expect(window._audioEnvelopeBass).toBe(bands.low);
    expect(window._audioEnvelopeMids).toBe(bands.mid);
  });

  it('do not sit on the clamp for loud input', () => {
    const capture = playing(loud);
    run(capture);

    expect(capture.getAudioEnvelopeBass()).toBeGreaterThan(0);
    expect(capture.getAudioEnvelopeBass()).toBeLessThan(1);
    expect(capture.getAudioEnvelopeMids()).toBeGreaterThan(0);
    expect(capture.getAudioEnvelopeMids()).toBeLessThan(1);
  });

  it('read the same for the same mix 12 dB quieter', () => {
    const at0 = playing(loud);
    const atMinus12 = playing((hz) => loud(hz) - 12);
    run(at0);
    run(atMinus12);

    expect(atMinus12.getAudioEnvelopeBass()).toBeCloseTo(at0.getAudioEnvelopeBass(), 2);
    expect(atMinus12.getAudioEnvelopeMids()).toBeCloseTo(at0.getAudioEnvelopeMids(), 2);
  });

  it("follow the Audio node's Gain", () => {
    const base = playing(loud);
    const hot = playing(loud);
    hot.updateConfig({ analysis: { gain: 1.5 } });
    run(base);
    run(hot);

    expect(hot.getAudioEnvelopeBass()).toBeGreaterThan(base.getAudioEnvelopeBass());
  });

  it('fall back to zero on stop', () => {
    const capture = playing(loud);
    run(capture);
    capture.stop();

    for (const name of GLOBALS) expect(window[name], name).toBe(0);
    expect(capture.getAudioEnvelopeBass()).toBe(0);
  });
});
