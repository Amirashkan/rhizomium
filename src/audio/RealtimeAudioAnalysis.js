/**
 * RealtimeAudioAnalysis.js
 *
 * Per-frame audio analysis: band levels, instrument meters, spectral descriptors. Every value it
 * produces is for THIS frame — nothing here waits on a window of history before it will answer.
 *
 * The shape follows the signal chain a TouchDesigner patch uses, because that arrangement is what
 * makes thresholds findable by hand:
 *
 *     input -> band split -> RMS -> attack/release -> normalise -> METER (0..1)
 *
 * and then, separately, the decision:
 *
 *     METER -> compare to threshold -> rising edge -> trigger
 *
 * The important part is the split between those two lines. Everything that adapts — the auto-gain,
 * the per-band normaliser — lives on the FIRST line, where its only job is to land the meter in a
 * predictable 0..1 range whatever the track's level. The decision on the second line is then a
 * plain comparison against a number, evaluated the instant the meter crosses it.
 *
 * That is what a detector built around rolling statistics gets wrong. Deciding from a window makes
 * the answer depend on several seconds of surrounding audio, so the same hit is judged differently
 * depending on what happened around it, and the control cannot be aimed at anything you can see.
 * Here a meter reads 0..1, a threshold sits somewhere in that range, and a hit is a crossing.
 *
 * Normalising per band cannot invent hits out of a silent band: `presence` reports each band's
 * absolute level and anything below AUDIBLE_FLOOR is reported as silent, meter forced to zero.
 *
 * The two kinds of meter are normalised differently, because they are asked different questions.
 *
 *   TONAL (low/mid/high) — "how much energy is in this band right now?" A modulation value, so it
 *   wants an absolute reading: auto-gain, then a fixed per-band scale. Nothing compares it to a
 *   threshold, so it is free to sit wherever the music puts it.
 *
 *   INSTRUMENT (kick/snare/hat) — "is a drum hitting right now?" This one feeds a threshold, so it
 *   must mean the same thing in every bar of every track. It is normalised against a slow average
 *   of THAT BAND's own level, so it reads how far the band has jumped above its own recent
 *   background, and nothing outside the band can move it.
 *
 * That split is the fix for a real bug. Driving the instrument meters from the shared auto-gain
 * coupled them to the entire spectrum: the gain is computed from the full-spectrum mean, so adding
 * a hat or synth layer that puts NO energy at all below 2 kHz would wind the gain down and drag the
 * kick meter with it — measured at 0.03x, a 33-fold drop, for a kick that had not changed. Detection
 * then held for a few seconds and fell apart for a few seconds as the arrangement moved, with a
 * threshold that was correct one bar and hopeless the next.
 */

// Frequency ranges, in Hz. The instrument bands are narrower than the tonal ones on purpose: they
// are chosen to catch one drum each with as little of its neighbours as possible.
export const BANDS = {
  // Tonal bands — continuous modulation values.
  low: [20, 250],
  mid: [250, 2000],
  high: [2000, 16000],
  // Instrument bands — what the triggers watch.
  kick: [40, 110],    // the kick's fundamental; below a snare's body, above the rumble
  snare: [150, 450],  // a snare's body; the crack above it is shared with hats, so it is left out
  hat: [6000, 14000], // hats and cymbals, well clear of most instruments' harmonics
};

// A band whose mean bin magnitude is below this is treated as silent. This is the one absolute
// quantity in the file, and it exists so that dividing a band by its own recent level cannot turn
// the noise in an empty band into a full-scale meter.
const AUDIBLE_FLOOR = 1e-4;
// Fixed scale per TONAL band, turning an auto-gained band level into a 0..1 meter. Bands do not
// carry equal energy in real music — the low end is far hotter than the top — so each gets its own
// factor, chosen (see the calibration note in the tests) so ordinary material sits mid-meter and a
// loud moment approaches the top, near 0.85, leaving headroom without pinning the meter. Bands
// differ by more than an order of magnitude, which is why guessing these does not work.
//
// These are FIXED because a tonal meter is a modulation value and has to read loudness: a
// normaliser that converged on the signal would report a quiet unchanging band as full-scale.
// The instrument bands are the opposite case and are handled separately below — they answer "is
// something happening", where reading zero on a steady band is exactly right, so a converging
// reference is the correct tool there rather than a trap.
const BAND_SCALE = {
  low: 0.077,
  mid: 0.41,
  high: 2.1,
};

// The bands whose meter feeds a threshold, and which therefore take the contrast path below rather
// than the auto-gained absolute path above.
const INSTRUMENT_BANDS = new Set(['kick', 'snare', 'hat']);
// How long the instrument meters' reference looks back. This is the "background level" a hit is
// measured against, and the choice is a trade: shorter adapts to an arrangement change faster but
// starts averaging away the hits themselves once it approaches the gap between them. One second
// spans two beats at 120 BPM, so even sixteenth-note patterns still stand above their own average,
// while a section change is absorbed within a bar or two.
const REFERENCE_TAU_S = 1.0;
// The contrast — band level over its own reference — that reads full scale.
//
// The mapping is logarithmic, so equal ratios are equal distances on the meter: contrast 1 (a band
// sitting exactly at its own average, i.e. nothing happening) reads 0. A linear map would cram
// everything interesting into the bottom of the range and give the threshold nothing to grip.
//
// This is also what makes the meter self-clearing, which the fixed-scale version was not: there,
// a wound-up gain could pin the meter at the 1.0 clamp for seconds, and since re-arming needs the
// meter to fall back below the threshold, the detector latched and stopped triggering entirely.
// A ratio against a converging reference cannot stay pinned — holding the band high just pulls the
// reference up after it, and the meter returns to 0.
//
// Full scale was 8 (+18 dB), which turned out to be INSIDE the range hits actually occupy rather
// than above it. Measured on a kick against a quiet background: contrast sat at ~2 between hits and
// peaked between 8.4 and 12.8 on them — so every hit reached the clamp, every hit read exactly 1.0,
// and no threshold could tell a downbeat from a ghost note. The symptom was the whole control doing
// nothing: the same six triggers at 0.05 as at 0.95. Full scale has to sit ABOVE where hits land,
// or the meter has no range left to be thresholded in.
//
// At 24 (+27.6 dB) those same peaks land between 0.67 and 0.80, spread out and well clear of the
// ~0.29 the band idles at, so the default threshold of 0.5 still falls between the two.
const CONTRAST_FULL = 24;
const LOG_CONTRAST_FULL = Math.log2(CONTRAST_FULL);
// Above this the meter stops being linear-in-log and eases toward 1 without ever arriving, so
// material louder than full scale still reads louder rather than flattening onto the clamp. The
// join is smooth — same value and same slope — so nothing steps as a hit crosses it.
const CONTRAST_KNEE = 0.8;
// Auto-gain (the `audiodynamics` equivalent): a slow trim that brings the whole signal toward a
// working level, so a quietly mastered track and a loud one present similar meters.
const AUTOGAIN_TAU_S = 1.5;
const AUTOGAIN_TARGET_RMS = 0.12;
// Wide enough to lift even a very quietly mastered file to a working level. Amplifying near-silence
// is not a risk here because each band's presence check runs on its level BEFORE gain, so a silent
// band reports silent no matter how far the gain has wound up.
const AUTOGAIN_MAX = 2000;
// Only avoids dividing by zero. It is deliberately far below AUDIBLE_FLOOR: the full-spectrum mean
// is tiny for narrowband material (a bass-only passage spreads little energy over many empty bins),
// and gating the gain at an audible level would leave such material un-normalised.
const AUTOGAIN_MIN_MEAN = 1e-7;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Log-contrast to a 0..1 meter, with a soft knee at the top.
 *
 * Below the knee this is exactly the linear-in-log mapping. Above it, the remaining headroom is
 * approached asymptotically: a hit twice as far above its background as full scale still reads
 * higher than one at full scale, instead of both landing on 1.0 with nothing between them. Strictly
 * increasing and never reaching 1, which is what keeps a threshold meaningful however extreme the
 * material gets.
 */
export function contrastMeter(contrast) {
  if (!(contrast > 1)) return 0;
  const x = Math.log2(contrast) / LOG_CONTRAST_FULL;
  if (x <= CONTRAST_KNEE) return x;
  const headroom = 1 - CONTRAST_KNEE;
  return 1 - headroom * Math.exp(-(x - CONTRAST_KNEE) / headroom);
}

/** One band's running state. */
class BandState {
  constructor() {
    this.env = 0;     // attack/release smoothed level
    this.meter = 0;   // the 0..1 output — what a threshold is compared against
    this.level = 0;   // raw level, before gain (for the presence check)
    this.slow = 0;    // instrument bands: slow average of this band's own level, the reference
    this.frames = 0;  // instrument bands: frames seen, for the reference's warm-up
  }
}

export class RealtimeAudioAnalysis {
  constructor() {
    this._bands = {};
    for (const name of Object.keys(BANDS)) this._bands[name] = new BandState();
    this._gain = 1;
    this._gainSeeded = false;
    this._spectrum = null;
    this._magnitude = null;
    this._binRanges = null;
    this._binCount = 0;
    this._sampleRate = 0;
    // Latest results, replaced each frame.
    this.out = {
      level: 0, low: 0, mid: 0, high: 0,
      kick: 0, snare: 0, hat: 0,
      centroid: 0, density: 0,
      presence: { low: false, mid: false, high: false, kick: false, snare: false, hat: false },
    };
  }

  /** Precompute each band's bin span. Bin 0 is DC and is never included. */
  _prepare(binCount, sampleRate) {
    if (this._binCount === binCount && this._sampleRate === sampleRate) return;
    this._binCount = binCount;
    this._sampleRate = sampleRate;
    this._spectrum = new Float32Array(binCount);
    this._magnitude = new Float64Array(binCount);
    const binHz = (sampleRate / 2) / binCount;
    this._binRanges = {};
    for (const [name, [lo, hi]] of Object.entries(BANDS)) {
      const start = Math.max(1, Math.floor(lo / binHz));
      const end = Math.min(binCount, Math.max(start + 1, Math.ceil(hi / binHz)));
      this._binRanges[name] = [start, end];
    }
    this._binHz = binHz;
  }

  /**
   * Analyse one frame.
   *
   * @param {AnalyserNode} analyser - unsmoothed, so transients are not blurred away
   * @param {number} dt - seconds since the previous call
   * @param {Object} opts
   * @param {number} opts.attackMs - how fast a meter rises. Short, so a hit is not rounded off.
   * @param {number} opts.releaseMs - how fast it falls back, which sets how long a hit reads as one.
   * @param {number} opts.gain - manual trim on top of the auto-gain.
   */
  process(analyser, dt, { attackMs = 8, releaseMs = 120, gain = 1 } = {}) {
    if (!analyser) return this.out;
    this._prepare(analyser.frequencyBinCount, this._sampleRate || 44100);

    analyser.getFloatFrequencyData(this._spectrum);
    const n = this._binCount;
    const mag = this._magnitude;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const db = this._spectrum[i];
      const m = db <= -140 ? 0 : Math.pow(10, db / 20);
      mag[i] = m;
      total += m;
    }
    const meanMag = total / n;

    // Auto-gain: creep toward the level everything downstream expects. Slow on purpose — it is
    // matching the track to the meters, not reacting to individual hits.
    //
    // The first frame after a reset jumps straight to the wanted gain instead of ramping to it.
    // Ramping from 1 costs about eight seconds before the meters mean anything — five time
    // constants to climb to a gain in the tens — and playback almost always starts on a downbeat,
    // so that was the opening of every track under-reading and under-triggering.
    if (meanMag > AUTOGAIN_MIN_MEAN) {
      const wanted = Math.min(AUTOGAIN_MAX, AUTOGAIN_TARGET_RMS / meanMag);
      if (!this._gainSeeded) {
        this._gain = wanted;
        this._gainSeeded = true;
      } else {
        const a = 1 - Math.exp(-dt / AUTOGAIN_TAU_S);
        this._gain += (wanted - this._gain) * a;
      }
    }
    const g = this._gain * gain;

    // Frame-rate independent one-pole coefficients.
    const attack = 1 - Math.exp(-dt / Math.max(0.001, attackMs / 1000));
    const release = 1 - Math.exp(-dt / Math.max(0.001, releaseMs / 1000));
    const reference = 1 - Math.exp(-dt / REFERENCE_TAU_S);

    for (const name of Object.keys(BANDS)) {
      const [start, end] = this._binRanges[name];
      let sum = 0;
      for (let i = start; i < end; i++) sum += mag[i] * mag[i];
      const rms = Math.sqrt(sum / (end - start));
      const st = this._bands[name];
      st.level = rms;
      const audible = rms > AUDIBLE_FLOOR;

      if (INSTRUMENT_BANDS.has(name)) {
        // Instrument band: measure the hit against this band's own recent background.
        //
        // The follower runs on the RAW band level, deliberately skipping the auto-gain and the
        // manual trim. Both cancel in the ratio below, so applying them would only couple this
        // meter back to material in other bands — the bug this path exists to fix.
        const target = audible ? rms : 0;
        st.frames++;
        if (st.frames === 1) {
          // Seed rather than climb from zero: an empty reference makes the first frame's ratio
          // enormous, which would fire a trigger on the instant playback starts.
          st.env = target;
        } else {
          st.env += (target - st.env) * (target > st.env ? attack : release);
        }

        // The reference is a plain running mean until it has REFERENCE_TAU_S of history, and the
        // exponential average after that — 1/frames crosses below the exponential coefficient at
        // exactly that point, so the two meet without a step.
        //
        // Seeding it to the first frame instead would carry that frame's contents for a second or
        // more: start playback on a downbeat and the reference begins at the height of a kick, so
        // the following hits measure against it and read low until it decays. The whole first
        // phrase came in under-triggered. A running mean has no such memory of where it started.
        st.slow += (rms - st.slow) * Math.max(reference, 1 / st.frames);

        // Contrast against the band's own background, on a log scale. Steady material of any
        // loudness sits at ratio 1 and reads 0; only a jump above the background moves the meter,
        // which is why a held bass note in the kick band no longer parks it halfway up.
        const ref = Math.max(st.slow, AUDIBLE_FLOOR);
        st.meter = audible ? contrastMeter(st.env / ref) : 0;
      } else {
        // Tonal band: an absolute reading, auto-gained and scaled to land in range.
        const target = audible ? rms * g : 0;

        // Attack/release follower: fast up so a transient is caught on its way in, slower down so
        // it stays readable for a few frames afterwards.
        st.env += (target - st.env) * (target > st.env ? attack : release);

        // Fixed scale to a 0..1 meter. Quiet stays quiet, which is the whole point.
        st.meter = audible ? clamp01(st.env * BAND_SCALE[name]) : 0;
      }

      this.out[name] = st.meter;
      this.out.presence[name] = audible;
    }

    // Overall level: the full spectrum, for a general-purpose modulation value. Scaled so that
    // audio sitting exactly at the auto-gain's target reads 0.5, which leaves room to move in both
    // directions — scaling it to read 1.0 there (as this first did) just pins it at the clamp.
    this.out.level = clamp01((meanMag * g) / (AUTOGAIN_TARGET_RMS * 2));

    // Spectral centroid: where the energy sits, 0..1 across the spectrum on a log scale so it
    // tracks perceived brightness rather than being dominated by the top octave's bin count.
    let weighted = 0, magSum = 0;
    for (let i = 1; i < n; i++) { weighted += i * mag[i]; magSum += mag[i]; }
    if (magSum > 0) {
      const centreHz = (weighted / magSum) * this._binHz;
      this.out.centroid = clamp01(Math.log2(Math.max(20, centreHz) / 20) / Math.log2(20000 / 20));
    } else {
      this.out.centroid = 0;
    }

    // Spectral density (flatness): 1 when energy is spread like noise, 0 when concentrated in a few
    // partials. Both means must run over the SAME bins — taking the geometric mean only over the
    // bins that happen to be non-zero, against an arithmetic mean over all of them, makes a pure
    // tone score higher than noise. Empty bins are floored rather than skipped.
    const FLATNESS_EPS = 1e-10;
    let logSum = 0, linSum = 0;
    for (let i = 1; i < n; i++) {
      const m = mag[i] > FLATNESS_EPS ? mag[i] : FLATNESS_EPS;
      logSum += Math.log(m);
      linSum += m;
    }
    const count = n - 1;
    if (count > 0 && linSum > 0) {
      const geometric = Math.exp(logSum / count);
      const arithmetic = linSum / count;
      this.out.density = clamp01(geometric / arithmetic);
    } else {
      this.out.density = 0;
    }

    return this.out;
  }

  /** Reset every follower, so restarting playback does not inherit the previous track's scaling. */
  reset() {
    for (const st of Object.values(this._bands)) {
      st.env = 0; st.meter = 0; st.level = 0; st.slow = 0; st.frames = 0;
    }
    this._gain = 1;
    // Re-seed on the next frame with real audio rather than ramping up from 1 again.
    this._gainSeeded = false;
    for (const k of Object.keys(this.out.presence)) this.out.presence[k] = false;
  }

  /** Tell the engine the sample rate before the first process() call. */
  setSampleRate(rate) {
    if (rate && rate !== this._sampleRate) {
      this._sampleRate = rate;
      this._binCount = 0; // force _prepare to recompute the bin spans
    }
  }
}

export default RealtimeAudioAnalysis;
