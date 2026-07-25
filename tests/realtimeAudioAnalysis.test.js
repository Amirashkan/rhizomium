import { describe, it, expect } from 'vitest';
import { RealtimeAudioAnalysis, BANDS } from '../src/audio/RealtimeAudioAnalysis.js';

// Covers the analysis half: turning a frame of spectrum into bounded 0..1 meters. The detector on
// top is only as good as these are, and their whole job is to be predictable — a meter that does
// not reliably land in range is a threshold nobody can place.

const SAMPLE_RATE = 44100;
const BINS = 1024; // fftSize 2048 -> ~21.5 Hz per bin
const BIN_HZ = (SAMPLE_RATE / 2) / BINS;

// An analyser that replays scripted dB spectra, one per process() call.
function fakeAnalyser(frames) {
  let i = 0;
  return {
    frequencyBinCount: BINS,
    getFloatFrequencyData(out) {
      out.set(frames[Math.min(i, frames.length - 1)]);
      i++;
    },
  };
}

// A silent spectrum with optional energy (in dB) over given Hz ranges.
function spectrum(bands = []) {
  const s = new Float32Array(BINS).fill(-140);
  for (const [lo, hi, db] of bands) {
    for (let b = Math.max(1, Math.floor(lo / BIN_HZ)); b < Math.ceil(hi / BIN_HZ) && b < BINS; b++) {
      s[b] = db;
    }
  }
  return s;
}

// Run frames at 60fps and return the final output (a copy, since `out` is reused).
function run(frames, opts) {
  const a = new RealtimeAudioAnalysis();
  a.setSampleRate(SAMPLE_RATE);
  const an = fakeAnalyser(frames);
  let last;
  for (let i = 0; i < frames.length; i++) last = a.process(an, 1 / 60, opts);
  return { ...last, presence: { ...last.presence } };
}

// A music-like spectrum: broadband with a pink-ish tilt, optionally with extra energy in a band.
// Real mixes always have breadth; a bare tone in three bins is a degenerate input that legitimately
// pins whichever meter it lands in, so it cannot show whether scaling behaves sensibly.
function musicLike(overallDb = -30, emphasis = null) {
  const s = new Float32Array(BINS).fill(-140);
  for (let b = 1; b < BINS; b++) {
    const hz = b * BIN_HZ;
    if (hz < 20 || hz > 16000) continue;
    // -3 dB per octave from 20 Hz, the usual shape of recorded music.
    s[b] = overallDb - 3 * Math.log2(hz / 20);
  }
  if (emphasis) {
    const [lo, hi, boost] = emphasis;
    for (let b = Math.max(1, Math.floor(lo / BIN_HZ)); b < Math.ceil(hi / BIN_HZ) && b < BINS; b++) {
      s[b] += boost;
    }
  }
  return s;
}

const repeat = (frame, n) => Array.from({ length: n }, () => frame);

describe('RealtimeAudioAnalysis', () => {
  it('reports every meter as 0 on silence, with nothing present', () => {
    const r = run(repeat(spectrum(), 60));
    for (const name of Object.keys(BANDS)) {
      expect(r[name]).toBe(0);
      expect(r.presence[name]).toBe(false);
    }
    expect(r.level).toBe(0);
  });

  it('keeps every meter inside 0..1 on loud material', () => {
    const loud = spectrum([[20, 16000, 0]]); // full scale across the spectrum
    const r = run(repeat(loud, 120));
    for (const name of Object.keys(BANDS)) {
      expect(r[name]).toBeGreaterThanOrEqual(0);
      expect(r[name]).toBeLessThanOrEqual(1);
    }
    expect(r.level).toBeLessThanOrEqual(1);
  });

  it('lights the band the energy is actually in, and leaves the others alone', () => {
    // Energy only in the kick band: kick reads high, hat reads nothing.
    const kickOnly = repeat(spectrum([[45, 100, -20]]), 90);
    const rk = run(kickOnly);
    expect(rk.kick).toBeGreaterThan(0.5);
    expect(rk.presence.kick).toBe(true);
    expect(rk.hat).toBe(0);
    expect(rk.presence.hat).toBe(false);

    // ...and the mirror case.
    const hatOnly = repeat(spectrum([[7000, 12000, -20]]), 90);
    const rh = run(hatOnly);
    expect(rh.hat).toBeGreaterThan(0.5);
    expect(rh.kick).toBe(0);
  });

  it('separates a kick from a snare by band', () => {
    // A snare's body sits above the kick band, so each should light its own meter.
    const rk = run(repeat(spectrum([[45, 100, -20]]), 90));
    expect(rk.kick).toBeGreaterThan(rk.snare);
    const rs = run(repeat(spectrum([[180, 400, -20]]), 90));
    expect(rs.snare).toBeGreaterThan(rs.kick);
  });

  it('gives the same meters for the same material at very different volumes', () => {
    // The point of the auto-gain: a quietly mastered track and a loud one must present the same
    // meters, or a threshold set on one is meaningless on the other. Checked on a music-like
    // spectrum that lands mid-meter, so the two are not just both against the clamp, and run long
    // enough for the gain to settle.
    // 30 dB apart — a wide spread for two masters, and inside the auto-gain's range. Beyond its
    // ceiling the quiet one simply cannot be lifted far enough, which is a deliberate limit: an
    // unbounded gain would haul the noise floor of a near-silent track into the meters.
    const quiet = run(repeat(musicLike(-55), 900));
    const loud = run(repeat(musicLike(-25), 900));
    for (const name of ['low', 'mid', 'kick', 'snare']) {
      expect(loud[name]).toBeGreaterThan(0.02);
      expect(loud[name]).toBeLessThan(0.98); // genuinely mid-range, not pinned
      expect(quiet[name]).toBeCloseTo(loud[name], 1);
    }
  });

  it('rises on a hit and falls back afterwards', () => {
    const a = new RealtimeAudioAnalysis();
    a.setSampleRate(SAMPLE_RATE);
    // A mix, and the same mix with the kick band briefly lifted — what a kick actually looks like.
    const quiet = musicLike(-40);
    const hit = musicLike(-40, [40, 110, 18]);
    // 30 frames of groove, 4 of hit, then back — a plausible kick.
    const frames = [...repeat(quiet, 30), ...repeat(hit, 4), ...repeat(quiet, 40)];
    const an = fakeAnalyser(frames);
    const trace = [];
    for (let i = 0; i < frames.length; i++) trace.push(a.process(an, 1 / 60).kick);

    const before = trace[29];
    const peak = Math.max(...trace.slice(30, 40));
    const after = trace[trace.length - 1];
    expect(peak).toBeGreaterThan(before * 3); // the hit stands clearly above the groove
    expect(after).toBeLessThan(peak * 0.7);   // ...then falls back, ready for the next one
  });

  it('honours attack and release times', () => {
    const quiet = musicLike(-40);
    const hit = musicLike(-40, [40, 110, 18]);
    const frames = [...repeat(quiet, 30), ...repeat(hit, 30)];
    const peakAt = (opts) => {
      const a = new RealtimeAudioAnalysis();
      a.setSampleRate(SAMPLE_RATE);
      const an = fakeAnalyser(frames);
      const trace = [];
      for (let i = 0; i < frames.length; i++) trace.push(a.process(an, 1 / 60, opts).kick);
      return trace[33]; // three frames into the hit
    };
    // A short attack is further along at the same moment than a long one.
    expect(peakAt({ attackMs: 4 })).toBeGreaterThan(peakAt({ attackMs: 200 }));
  });

  it('puts the centroid low for bass and high for treble', () => {
    const bass = run(repeat(spectrum([[40, 120, -20]]), 60));
    const treble = run(repeat(spectrum([[8000, 14000, -20]]), 60));
    expect(bass.centroid).toBeLessThan(0.4);
    expect(treble.centroid).toBeGreaterThan(0.6);
    expect(treble.centroid).toBeGreaterThan(bass.centroid);
  });

  it('reads density high for broadband noise and low for a single tone', () => {
    const noise = run(repeat(spectrum([[20, 16000, -30]]), 60));
    const tone = run(repeat(spectrum([[440, 470, -20]]), 60));
    expect(noise.density).toBeGreaterThan(tone.density);
  });

  it('starts clean after reset, so one track does not inherit the last one\'s scaling', () => {
    const a = new RealtimeAudioAnalysis();
    a.setSampleRate(SAMPLE_RATE);
    const an = fakeAnalyser(repeat(spectrum([[45, 100, -10]]), 60));
    for (let i = 0; i < 60; i++) a.process(an, 1 / 60);
    a.reset();
    for (const name of Object.keys(BANDS)) expect(a.out.presence[name]).toBe(false);
  });
});
