import { describe, it, expect, beforeEach } from 'vitest';
import { BrowserAudioCapture } from '../src/audio/BrowserAudioCapture.js';

// Covers BrowserAudioCapture._computeSpectralFlux — the onset signal the kick detector reads.
// This layer previously had no tests, which is how a detector reading clamped byte data (pinned at
// 255 on loud material, contributing zero flux) went unnoticed.

const SAMPLE_RATE = 44100;
const BINS = 1024; // fftSize 2048 -> ~21.5 Hz per bin

// A fake AnalyserNode that hands back scripted dB spectra, one per call.
function fakeAnalyser(spectra) {
  let call = 0;
  return {
    frequencyBinCount: BINS,
    getFloatFrequencyData(out) {
      const s = spectra[Math.min(call, spectra.length - 1)];
      call++;
      out.set(s);
    },
  };
}

// A silent spectrum (well below the flux floor), with optional dB energy in given Hz ranges.
function spectrum(bands = []) {
  const binWidth = (SAMPLE_RATE / 2) / BINS;
  const s = new Float32Array(BINS).fill(-100);
  for (const [lo, hi, db] of bands) {
    for (let i = Math.floor(lo / binWidth); i < Math.ceil(hi / binWidth) && i < BINS; i++) s[i] = db;
  }
  return s;
}

function makeCapture(spectra) {
  const cap = Object.create(BrowserAudioCapture.prototype);
  cap.config = { frequency: { mode: 'bass', customMin: 60, customMax: 250 } };
  cap.audioContext = { sampleRate: SAMPLE_RATE };
  cap._fluxAnalyser = fakeAnalyser(spectra);
  return cap;
}

// Run one flux frame per scripted spectrum; return the last frame's values.
function runFlux(spectra) {
  const cap = makeCapture(spectra);
  for (let i = 0; i < spectra.length; i++) cap._computeSpectralFlux();
  return { bass: cap._fluxBass, mids: cap._fluxMids, highs: cap._fluxHighs, full: cap._fluxFull };
}

describe('BrowserAudioCapture spectral flux', () => {
  it('reports no flux on the first frame (nothing to compare against)', () => {
    const cap = makeCapture([spectrum([[30, 120, -10]])]);
    cap._computeSpectralFlux();
    expect(cap._fluxBass).toBe(0);
  });

  it('spikes on a kick-band transient and stays at zero for a sustained tone', () => {
    const quiet = spectrum();
    const kick = spectrum([[30, 120, -10]]);
    // silence -> kick: flux fires.
    expect(runFlux([quiet, kick]).bass).toBeGreaterThan(0.3);
    // kick held at the same level: no further change, so no flux.
    expect(runFlux([quiet, kick, kick]).bass).toBe(0);
  });

  it('does not saturate on loud material (regression: byte spectrum clamped at maxDecibels)', () => {
    // getByteFrequencyData clamps at maxDecibels (-30 dB by default), so on a loud track the low
    // bins pin at 255 and a kick produces NO byte-level change at all. Float dB data must still
    // register the transient well above the clamp point.
    const loud = spectrum([[30, 120, -12]]);
    const louder = spectrum([[30, 120, -2]]);
    expect(runFlux([loud, louder]).bass).toBeGreaterThan(0.2);
  });

  it('publishes each band raw, so a broadband onset shows up on all of them', () => {
    // Rejecting broadband onsets is the node's job (AudioAnalysisProcessor's Isolate switch), so
    // that it can apply to whichever band the node selected. This layer reports each band as
    // measured: a snare/clap fires across the spectrum and every band sees it.
    const quiet = spectrum();
    const snare = spectrum([[30, 120, -10], [250, 2000, -10], [2000, 16000, -10]]);
    const r = runFlux([quiet, snare]);
    expect(r.bass).toBeGreaterThan(0.3);
    expect(r.highs).toBeGreaterThan(0.3);
  });

  it('reports a low-only onset on the bass band and nothing up top', () => {
    const quiet = spectrum();
    const kickOnly = spectrum([[30, 120, -10]]);
    const r = runFlux([quiet, kickOnly]);
    expect(r.bass).toBeGreaterThan(0.3);
    expect(r.highs).toBe(0);
  });

  it('ignores energy above the kick band that a 20-250 Hz window would have caught', () => {
    // A snare's body around 200 Hz sits inside the level envelope's bass range but outside the
    // 30-120 Hz onset range, which is the point of using a narrower window for detection.
    const quiet = spectrum();
    const body = spectrum([[160, 240, -10]]);
    expect(runFlux([quiet, body]).bass).toBe(0);
  });

  it('reports nothing for a custom range too narrow to contain a real bin', () => {
    // A Custom band of 0-1 Hz spans no audio bin at all. It used to fall back on bin 0 — DC, which
    // drifts with any offset in the signal — and the detector dutifully found "onsets" in that
    // drift. An empty range must produce no signal instead.
    const cap = makeCapture([spectrum(), spectrum([[0, 40, -5]])]);
    cap.config.frequency = { mode: 'custom', customMin: 0, customMax: 1 };
    cap._computeSpectralFlux();
    cap._computeSpectralFlux();
    expect(cap._fluxCustom).toBe(0);
  });

  it('excludes the DC bin from an otherwise valid custom range', () => {
    // Bin 0 is not audio. A range starting at 0 Hz must still measure only real bins.
    const binWidth = (SAMPLE_RATE / 2) / BINS;
    const a = new Float32Array(BINS).fill(-100);
    const b = new Float32Array(BINS).fill(-100);
    b[0] = 0; // a huge jump, but in DC only
    const cap = makeCapture([a, b]);
    cap.config.frequency = { mode: 'custom', customMin: 0, customMax: binWidth * 4 };
    cap._computeSpectralFlux();
    cap._computeSpectralFlux();
    expect(cap._fluxCustom).toBe(0);
  });

  it('treats a falling spectrum as no onset (positive changes only)', () => {
    const loud = spectrum([[30, 120, -10]]);
    const quiet = spectrum();
    expect(runFlux([loud, quiet]).bass).toBe(0);
  });

  it('ignores wobble in bins that are effectively silent', () => {
    const a = spectrum([[30, 120, -95]]);
    const b = spectrum([[30, 120, -80]]); // a 15 dB jump, but both are below the silence floor
    expect(runFlux([a, b]).bass).toBe(0);
  });
});
