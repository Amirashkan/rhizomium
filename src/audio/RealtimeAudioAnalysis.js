/**
 * RealtimeAudioAnalysis.js
 *
 * Per-frame audio analysis: band levels, instrument meters, spectral descriptors. Every value it
 * produces is for THIS frame — nothing here waits on a window of history before it will answer.
 *
 * The shape follows the signal chain a TouchDesigner patch uses, because that arrangement is what
 * makes thresholds findable by hand:
 *
 *     input -> auto-gain -> band split -> RMS -> attack/release -> normalise -> METER (0..1)
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
// Fixed scale per band, turning an auto-gained band level into a 0..1 meter. Bands do not carry
// equal energy in real music — the low end is far hotter than the top — so each gets its own
// factor, chosen (see tools notes in the tests) so ordinary material sits mid-meter and a hit
// approaches the top.
//
// These are FIXED on purpose. Normalising each band against its own recent peak is the obvious
// alternative and it is a trap: any reference that converges on the signal reads full-scale in
// steady state, so a quiet, unchanging band would show a meter pinned at 1.0 and every threshold
// would be met. Absolute scaling after a single whole-signal auto-gain keeps quiet quiet.
// Measured by running this engine over a commercially mastered track and reading what each band's
// auto-gained envelope actually reaches (see the calibration note in the tests): each scale puts
// that band's loudest moments near 0.85, leaving headroom without pinning the meter. Bands differ
// by more than an order of magnitude, which is why guessing these does not work — the low end
// carries vastly more energy than the top.
const BAND_SCALE = {
  low: 0.077,
  mid: 0.41,
  high: 2.1,
  kick: 0.054,
  snare: 0.11,
  hat: 2.0,
};
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

/** One band's running state. */
class BandState {
  constructor() {
    this.env = 0;    // attack/release smoothed, auto-gained level
    this.meter = 0;  // env * BAND_SCALE, clamped — the number a threshold is compared against
    this.level = 0;  // raw level, before gain (for the presence check)
  }
}

export class RealtimeAudioAnalysis {
  constructor() {
    this._bands = {};
    for (const name of Object.keys(BANDS)) this._bands[name] = new BandState();
    this._gain = 1;
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
    if (meanMag > AUTOGAIN_MIN_MEAN) {
      const wanted = Math.min(AUTOGAIN_MAX, AUTOGAIN_TARGET_RMS / meanMag);
      const a = 1 - Math.exp(-dt / AUTOGAIN_TAU_S);
      this._gain += (wanted - this._gain) * a;
    }
    const g = this._gain * gain;

    // Frame-rate independent one-pole coefficients.
    const attack = 1 - Math.exp(-dt / Math.max(0.001, attackMs / 1000));
    const release = 1 - Math.exp(-dt / Math.max(0.001, releaseMs / 1000));

    for (const name of Object.keys(BANDS)) {
      const [start, end] = this._binRanges[name];
      let sum = 0;
      for (let i = start; i < end; i++) sum += mag[i] * mag[i];
      const rms = Math.sqrt(sum / (end - start));
      const st = this._bands[name];
      st.level = rms;

      const audible = rms > AUDIBLE_FLOOR;
      const target = audible ? rms * g : 0;

      // Attack/release follower: fast up so a transient is caught on its way in, slower down so it
      // stays readable for a few frames afterwards.
      st.env += (target - st.env) * (target > st.env ? attack : release);

      // Fixed scale to a 0..1 meter. Quiet stays quiet, which is the whole point.
      st.meter = audible ? clamp01(st.env * BAND_SCALE[name]) : 0;

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
      st.env = 0; st.meter = 0; st.level = 0;
    }
    this._gain = 1;
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
