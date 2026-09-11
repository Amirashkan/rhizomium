/**
 * MusicalListener.js - what the music has been doing, not what this frame is.
 *
 * The audio analysis answers "right now": this frame's bands, this frame's
 * meters, this frame's triggers. Every value it produces is for THIS frame, on
 * purpose (RealtimeAudioAnalysis.js). That is the right shape for driving a
 * parameter, and the wrong shape entirely for telling a model what is going on.
 *
 * A co-performer does not need to be told that low is 0.41. It needs to be told
 * that this has been building for half a minute, that the texture has not
 * changed in two, that the brightness crept up after the last drop. That is
 * what this file works out: a rolling memory over three timescales, reported in
 * words a prompt can actually use.
 *
 * ## Why the pulse is one field and not the foundation
 *
 * The obvious thing to do with audio and a performer is detect the tempo and
 * count bars. For four-to-the-floor that works. For the music this was built
 * for it does not: there is no pulse to find, and a tempo detector asked to
 * find one anyway will report a number with no meaning rather than admit it.
 *
 * So `pulse` here reports `free` and NO number when the evidence is not there,
 * and everything else in the description is written to be useful without it.
 * A set with a pulse gets the BPM as a bonus. A set without one is not a
 * degraded case — it is the normal one.
 *
 * ## Purity
 *
 * No DOM, no audio context, no `performance.now()`, no module state. Time comes
 * in as seconds from the caller, which is what lets a test feed it a swell or
 * two minutes of drone and assert on what it says.
 */

/**
 * How much each drum counts as evidence of a pulse.
 *
 * A kick is the beat far more often than a hat is, and a hat pattern at
 * sixteenths will out-vote everything else on sheer count if it is not held
 * down. These are votes, not levels — they never touch the meters.
 */
export const ONSET_WEIGHTS = Object.freeze({ kick: 1, snare: 0.8, hat: 0.35 });

/** The three memories, as time constants in seconds. */
const SHORT_TAU = 2;
const MEDIUM_TAU = 15;
const LONG_TAU = 90;

/** Below this the room is silent, not quiet. */
const SILENCE_LEVEL = 0.004;
/** …and it has to stay there this long before the description says so. */
const SILENCE_SECONDS = 1.5;

/** Short-against-medium level ratios that read as building and receding. */
const BUILDING_RATIO = 1.18;
const RECEDING_RATIO = 0.85;

/** A drop is this sudden a fall from an audible level; a swell this sudden a rise. */
const DROP_RATIO = 0.4;
const SWELL_RATIO = 1.9;

/** Cosine distance between the short and medium spectral profile that reads as a new texture. */
const TEXTURE_DISTANCE = 0.1;
/** …sustained this long, so a single transient is not a section change. */
const TEXTURE_HOLD_SECONDS = 1;

/** Onsets were flowing and then stopped: this many seconds of nothing says so. */
const ONSET_STOP_SECONDS = 3;

/** The pulse search space. Nothing outside this is a tempo anyone counts in. */
const MIN_BPM = 60;
const MAX_BPM = 200;
const PULSE_WINDOW_SECONDS = 12;
const PULSE_CANDIDATES = 96;
const PULSE_MAX_ONSETS = 256;
/** Below this confidence the honest answer is "there is no pulse", not a number. */
const PULSE_CONFIDENCE_FLOOR = 0.45;
/** Fewer onsets than this in the window and there is nothing to measure. */
const PULSE_MIN_ONSETS = 8;

/** describe() is cached this long; the panel calls it far faster than it can change. */
const DESCRIBE_INTERVAL = 0.25;

/** Events older than this are no longer news. */
const EVENT_MEMORY_SECONDS = 180;
const MAX_EVENTS = 12;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * A time-constant average that is honest while it is still warming up.
 *
 * A plain one-pole starts at zero and takes a few time constants to mean
 * anything, so a ninety-second memory would spend its first minute claiming the
 * room was quieter than it is — and "receding" is exactly what that looks like
 * from the outside. Carrying the accumulated weight and dividing by it removes
 * that bias, so the long memory is usable from the first second and simply
 * widens as it fills.
 */
class Ema {
  constructor(tau) {
    this.tau = tau;
    this.acc = 0;
    this.weight = 0;
  }

  push(value, dt) {
    const alpha = 1 - Math.exp(-dt / this.tau);
    this.acc += (value - this.acc) * alpha;
    this.weight += (1 - this.weight) * alpha;
  }

  get value() {
    return this.weight > 1e-6 ? this.acc / this.weight : 0;
  }

  reset() {
    this.acc = 0;
    this.weight = 0;
  }
}

/** The fields that make up a spectral profile, in the order the vector uses. */
const PROFILE_FIELDS = ['low', 'mid', 'high', 'centroid', 'density'];

class Profile {
  constructor(tau) {
    this.level = new Ema(tau);
    for (const field of PROFILE_FIELDS) this[field] = new Ema(tau);
  }

  push(taps, dt) {
    this.level.push(clamp01(finite(taps.level)), dt);
    for (const field of PROFILE_FIELDS) this[field].push(clamp01(finite(taps[field])), dt);
  }

  /** The shape of the sound, ignoring how loud it is. */
  vector() {
    return PROFILE_FIELDS.map((field) => this[field].value);
  }

  reset() {
    this.level.reset();
    for (const field of PROFILE_FIELDS) this[field].reset();
  }
}

/** 1 - cos(a, b), or 0 when either side has no energy to have a shape. */
function cosineDistance(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na < 1e-9 || nb < 1e-9) return 0;
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Which way a number has moved against its own baseline. */
function trendOf(now, baseline, margin = 0.08) {
  const floor = Math.max(baseline, 0.02);
  if (now > floor * (1 + margin)) return 'rising';
  if (now < floor * (1 - margin)) return 'falling';
  return 'steady';
}

export class MusicalListener {
  constructor(options = {}) {
    this.silenceLevel = options.silenceLevel ?? SILENCE_LEVEL;
    this.pulseWindow = options.pulseWindow ?? PULSE_WINDOW_SECONDS;
    this.describeInterval = options.describeInterval ?? DESCRIBE_INTERVAL;
    this.preferredBpm = options.preferredBpm ?? 120;

    // The candidate periods, log-spaced so the resolution is even in musical
    // terms rather than in seconds — the difference between 60 and 61 BPM is
    // the same size as between 180 and 183, and a linear grid would spend most
    // of its bins on tempos nobody plays.
    this._periods = new Float64Array(PULSE_CANDIDATES);
    this._logMin = Math.log(60 / MAX_BPM);
    const logMax = Math.log(60 / MIN_BPM);
    this._logStep = (logMax - this._logMin) / (PULSE_CANDIDATES - 1);
    for (let i = 0; i < PULSE_CANDIDATES; i++) {
      this._periods[i] = Math.exp(this._logMin + i * this._logStep);
    }
    this._scores = new Float64Array(PULSE_CANDIDATES);

    this.reset();
  }

  reset() {
    this._started = null;
    this._lastObserved = null;

    this._short = new Profile(SHORT_TAU);
    this._medium = new Profile(MEDIUM_TAU);
    this._long = new Profile(LONG_TAU);

    /** A slowly-decaying loudest-so-far, so `intensity` means something in this room. */
    this._ceiling = 0;

    /** Onsets in the pulse window: { t, w }. */
    this._onsets = [];
    this._trigSeen = {};
    this._lastOnsetAt = null;
    this._onsetsFlowing = false;

    this._textureSince = null;
    this._texturePending = null;
    this._textureArmed = true;

    this._levelArmed = true;
    this._silentSince = null;
    this._wasSilent = false;

    this._events = [];
    this._mark = null;

    this._heldPulse = null;
    this._pulse = { state: 'free', bpm: null, confidence: 0 };
    this._pulseAt = null;

    this._cached = null;
    this._cachedAt = null;
  }

  /**
   * One analysis step.
   *
   * `taps` is the tap object AudioAnalysisProcessor publishes — the bounded
   * meters plus `trigCount`, the monotonic per-drum hit counters. Onsets are
   * read from the COUNTS rather than the 0/1 trigger channels for the reason
   * those counts exist: a trigger is one analysis step wide, and anything
   * sampling slower than the analysis would miss most of them.
   */
  observe(time, taps) {
    if (!Number.isFinite(time) || !taps) return;

    if (this._lastObserved === null) {
      this._started = time;
      this._lastObserved = time;
      this._readTriggers(time, taps, true);
      return;
    }

    // Clamped for the same reason the analysis clamps its own: a tab that was
    // in the background for a minute must not land as one enormous step.
    const dt = Math.min(0.25, Math.max(0, time - this._lastObserved));
    this._lastObserved = time;
    if (dt <= 0) return;

    const level = clamp01(finite(taps.level));
    this._short.push(taps, dt);
    this._medium.push(taps, dt);
    this._long.push(taps, dt);

    // Decay slowly, so the loudest moment of the set keeps setting the scale
    // for several minutes rather than being forgotten by the next quiet part.
    this._ceiling = Math.max(level, this._ceiling * Math.exp(-dt / 240));

    this._readTriggers(time, taps, false);
    this._trackLevel(time, level);
    this._trackTexture(time, dt);
    this._trackOnsetFlow(time);
  }

  /**
   * The description. Cached between recomputes — the panel asks at frame rate
   * and nothing in here can change faster than a quarter of a second.
   */
  describe(time) {
    // Nothing observed is not the same as silence observed, and the difference
    // matters: one is a room with nothing in it, the other is a dead input.
    if (this._lastObserved === null) return this._emptyDescription();
    const now = Number.isFinite(time) ? time : this._lastObserved;
    if (this._cached && this._cachedAt !== null && now - this._cachedAt < this.describeInterval) {
      return this._cached;
    }

    this._prunePulse(now);
    const description = this._build(now);
    this._cached = description;
    this._cachedAt = now;
    return description;
  }

  /**
   * Remember this moment as the one to measure change against.
   *
   * The director calls it when it asks the model something, so the next
   * description can say what has happened SINCE that question rather than
   * since some arbitrary frame. Nothing else should call it: two callers
   * marking would each erase the other's reference point.
   */
  mark(time) {
    const now = Number.isFinite(time) ? time : this._lastObserved;
    if (now === null) return;
    const d = this.describe(now);
    this._mark = {
      at: now,
      // The ABSOLUTE level, not `intensity`. Intensity is measured against a
      // ceiling that rises with the set, so a passage that got twice as loud
      // reads as unchanged against it — true, and useless for saying what
      // happened since the last question.
      level: this._short.level.value,
      brightness: d.brightness.value,
      noisiness: d.noisiness.value,
      onsetsPerSecond: d.density.onsetsPerSecond,
      dynamics: d.dynamics,
    };
    // The cached description was built before the mark existed, and its `since`
    // is therefore null. Drop it so the next read is measured from here.
    this._cached = null;
    this._cachedAt = null;
  }

  /** Whether anything has been heard at all — a dead input is not a quiet room. */
  get hearing() {
    return this._lastObserved !== null && this._long.level.weight > 1e-3;
  }

  // --- observation -------------------------------------------------------

  /** Turn the monotonic trigger counters into onset events. */
  _readTriggers(time, taps, seedOnly) {
    const counts = taps.trigCount;
    if (!counts) return;
    for (const name of Object.keys(ONSET_WEIGHTS)) {
      const count = finite(counts[name]);
      const seen = this._trigSeen[name];
      this._trigSeen[name] = count;
      if (seedOnly || seen === undefined) continue;
      // A counter that went backwards means the analysis restarted; re-seed
      // rather than inventing a burst of onsets that never happened.
      if (count < seen) continue;
      const fired = Math.min(count - seen, 8);
      if (fired <= 0) continue;
      const weight = ONSET_WEIGHTS[name] * Math.max(0.15, clamp01(finite(taps[`${name}Meter`])) || 1);
      for (let i = 0; i < fired; i++) this._onsets.push({ t: time, w: weight });
      this._lastOnsetAt = time;
    }
    if (this._onsets.length > PULSE_MAX_ONSETS) {
      this._onsets.splice(0, this._onsets.length - PULSE_MAX_ONSETS);
    }
  }

  /** Drops, swells, and the line between quiet and silent. */
  _trackLevel(time, level) {
    const medium = this._medium.level.value;

    if (level < this.silenceLevel) {
      if (this._silentSince === null) this._silentSince = time;
      if (!this._wasSilent && time - this._silentSince >= SILENCE_SECONDS) {
        this._wasSilent = true;
        this._note(time, 'silence', 1);
      }
    } else {
      this._silentSince = null;
      this._wasSilent = false;
    }

    // Only worth calling a drop or a swell if there was something to drop from.
    if (medium < 0.01) return;
    const ratio = level / medium;
    if (this._levelArmed) {
      if (ratio < DROP_RATIO) {
        this._levelArmed = false;
        this._note(time, 'drop', clamp01(1 - ratio));
      } else if (ratio > SWELL_RATIO) {
        this._levelArmed = false;
        this._note(time, 'swell', clamp01((ratio - 1) / 2));
      }
    } else if (ratio > 0.7 && ratio < 1.4) {
      // Back in the middle: ready to call the next one.
      this._levelArmed = true;
    }
  }

  /**
   * The change that matters most on music with no beat.
   *
   * A filter sweep, a new instrument, a pad replaced by noise — none of it
   * moves the level much, and none of it shows up in any single meter. What it
   * does move is the SHAPE of the spectrum, which is what the distance between
   * the short and medium profile measures. Requiring it to hold for a second
   * is what keeps a cymbal crash from reading as a new section.
   */
  _trackTexture(time, dt) {
    if (this._textureSince === null) this._textureSince = time;

    const distance = cosineDistance(this._short.vector(), this._medium.vector());
    // Nothing to compare shapes of when there is barely any sound.
    if (this._short.level.value < this.silenceLevel * 2) {
      this._texturePending = null;
      return;
    }

    if (distance > TEXTURE_DISTANCE) {
      if (this._texturePending === null) this._texturePending = time;
      if (this._textureArmed && time - this._texturePending >= TEXTURE_HOLD_SECONDS) {
        this._textureArmed = false;
        this._textureSince = time;
        this._texturePending = null;
        this._note(time, 'texture-change', clamp01(distance / (TEXTURE_DISTANCE * 3)));
      }
    } else {
      this._texturePending = null;
      // Re-arm only once the profiles have converged again, so one slow
      // transition is one event rather than a stutter of them.
      if (distance < TEXTURE_DISTANCE * 0.5) this._textureArmed = true;
    }
    void dt;
  }

  /** Rhythm stopping is a musical event even when the sound does not stop. */
  _trackOnsetFlow(time) {
    const recent = this._onsetsSince(time, 4);
    if (recent.length >= 4) {
      this._onsetsFlowing = true;
      return;
    }
    if (
      this._onsetsFlowing &&
      this._lastOnsetAt !== null &&
      time - this._lastOnsetAt >= ONSET_STOP_SECONDS
    ) {
      this._onsetsFlowing = false;
      this._note(time, 'onset-stop', 1);
    }
  }

  _note(time, kind, magnitude) {
    this._events.push({ at: time, kind, magnitude: clamp01(magnitude) });
    if (this._events.length > MAX_EVENTS) this._events.shift();
  }

  _onsetsSince(time, seconds) {
    const from = time - seconds;
    const out = [];
    for (let i = this._onsets.length - 1; i >= 0; i--) {
      if (this._onsets[i].t < from) break;
      out.push(this._onsets[i]);
    }
    return out;
  }

  // --- the pulse, such as it is ------------------------------------------

  _prunePulse(now) {
    const from = now - this.pulseWindow;
    let drop = 0;
    while (drop < this._onsets.length && this._onsets[drop].t < from) drop++;
    if (drop) this._onsets.splice(0, drop);
  }

  /**
   * Weighted inter-onset-interval scoring.
   *
   * Every pair of onsets in the window votes for the period between them and
   * for that period divided by 2, 3 and 4 — a bar-length gap between two hits
   * is evidence for the beat inside it, just weaker evidence. The `1/k` is what
   * makes it weaker, and it is also what keeps a sparse kick pattern from
   * reporting a tempo four times too fast.
   */
  _estimatePulse(now) {
    const onsets = this._onsets;
    if (onsets.length < PULSE_MIN_ONSETS) return { state: 'free', bpm: null, confidence: 0 };

    const scores = this._scores;
    scores.fill(0);
    const tau = this.pulseWindow / 2;
    const sigma = 0.6 * this._logStep;
    const twoSigmaSq = 2 * sigma * sigma;

    for (let j = 1; j < onsets.length; j++) {
      const b = onsets[j];
      const recency = Math.exp(-(now - b.t) / tau);
      for (let i = 0; i < j; i++) {
        const a = onsets[i];
        const gap = b.t - a.t;
        if (gap <= 0.08) continue;
        if (gap > 2.5) continue;
        const pairWeight = a.w * b.w * recency;
        for (let k = 1; k <= 4; k++) {
          const period = gap / k;
          const logP = Math.log(period);
          if (logP < this._logMin || logP > this._logMin + this._logStep * (PULSE_CANDIDATES - 1)) {
            continue;
          }
          const centre = Math.round((logP - this._logMin) / this._logStep);
          const weight = pairWeight / k;
          for (let n = Math.max(0, centre - 2); n <= Math.min(PULSE_CANDIDATES - 1, centre + 2); n++) {
            const d = logP - (this._logMin + n * this._logStep);
            scores[n] += weight * Math.exp(-(d * d) / twoSigmaSq);
          }
        }
      }
    }

    // A gentle preference for tempos people actually count in, which is what
    // resolves the octave when 64 and 128 fit the same onsets equally well.
    let best = -1;
    let bestIndex = -1;
    let total = 0;
    const held = this._heldPulse;
    for (let n = 0; n < PULSE_CANDIDATES; n++) {
      const bpm = 60 / this._periods[n];
      const octave = Math.log2(bpm / this.preferredBpm) / 0.55;
      let score = scores[n] * Math.exp(-0.5 * octave * octave);
      // Hysteresis: the octave already being reported wins a tie, so a set does
      // not flip between half and double time bar after bar.
      if (held && Math.abs(Math.log2(bpm / held)) < 0.25) score *= 1.15;
      scores[n] = score;
      total += score;
      if (score > best) {
        best = score;
        bestIndex = n;
      }
    }

    if (bestIndex < 0 || best <= 0) return { state: 'free', bpm: null, confidence: 0 };

    const mean = total / PULSE_CANDIDATES;
    // A flat score field is what random onsets look like; a real pulse is a
    // spike. This ratio is the difference, and it is what stops drone material
    // from ever reporting a tempo.
    const salience = clamp01((best / Math.max(mean, 1e-9) - 1) / 2.5);

    const period = this._periods[bestIndex];
    const expected = (this.pulseWindow / period) * 0.6;
    const support = clamp01(onsets.length / Math.max(expected, 1));

    // How tightly the onsets sit on the grid that period implies. Onsets
    // smeared across the beat are not a pulse however regular their average.
    let re = 0;
    let im = 0;
    let mass = 0;
    for (const onset of onsets) {
      const recency = Math.exp(-(now - onset.t) / tau);
      const w = onset.w * recency;
      const phase = (2 * Math.PI * onset.t) / period;
      re += w * Math.cos(phase);
      im += w * Math.sin(phase);
      mass += w;
    }
    const tightness = mass > 1e-9 ? Math.sqrt(re * re + im * im) / mass : 0;

    // Tightness counts in full rather than square-rooted, because it is the one
    // term that separates a pulse from onsets that merely happen often: give
    // enough irregular hits to an interval histogram and SOME period will
    // collect a decent score, but only a real pulse puts them all at the same
    // place in the cycle.
    const confidence = clamp01(support * salience * tightness);
    if (confidence < PULSE_CONFIDENCE_FLOOR) {
      this._heldPulse = null;
      return { state: 'free', bpm: null, confidence };
    }

    const bpm = Math.round((60 / period) * 10) / 10;
    this._heldPulse = bpm;
    return { state: 'metered', bpm, confidence };
  }

  // --- the description ---------------------------------------------------

  _build(now) {
    // The pulse is the only expensive part, so it runs on its own slower clock
    // than the rest of the description.
    if (this._pulseAt === null || now - this._pulseAt >= 1) {
      this._pulse = this._estimatePulse(now);
      this._pulseAt = now;
    }

    const shortLevel = this._short.level.value;
    const mediumLevel = this._medium.level.value;
    const ceiling = Math.max(this._ceiling, 0.02);

    let dynamics;
    if (this._wasSilent) dynamics = 'silent';
    else if (mediumLevel < 0.01) dynamics = shortLevel > 0.01 ? 'building' : 'silent';
    else if (shortLevel > mediumLevel * BUILDING_RATIO) dynamics = 'building';
    else if (shortLevel < mediumLevel * RECEDING_RATIO) dynamics = 'receding';
    else dynamics = 'holding';

    const recentOnsets = this._onsetsSince(now, MEDIUM_TAU);
    const priorOnsets = this._onsets.filter(
      (o) => o.t < now - MEDIUM_TAU && o.t >= now - MEDIUM_TAU * 2,
    );
    const onsetsPerSecond = Math.round((recentOnsets.length / MEDIUM_TAU) * 100) / 100;
    const priorPerSecond = priorOnsets.length / MEDIUM_TAU;

    const brightness = this._short.centroid.value;
    const noisiness = this._short.density.value;

    const events = this._events
      .filter((e) => now - e.at <= EVENT_MEMORY_SECONDS)
      .map((e) => ({
        kind: e.kind,
        secondsAgo: Math.round((now - e.at) * 10) / 10,
        magnitude: Math.round(e.magnitude * 100) / 100,
      }));

    const description = {
      listeningSeconds: this._started === null ? 0 : Math.round(now - this._started),
      dynamics,
      intensity: Math.round(clamp01(shortLevel / ceiling) * 100) / 100,
      density: {
        onsetsPerSecond,
        trend: trendOf(onsetsPerSecond, priorPerSecond, 0.25),
      },
      brightness: {
        value: Math.round(brightness * 100) / 100,
        trend: trendOf(brightness, this._medium.centroid.value),
      },
      noisiness: {
        value: Math.round(noisiness * 100) / 100,
        trend: trendOf(noisiness, this._medium.density.value),
      },
      texture: {
        heldSeconds:
          this._textureSince === null ? 0 : Math.round((now - this._textureSince) * 10) / 10,
        changedAt: this._textureSince,
      },
      pulse: { ...this._pulse },
      events,
      since: this._describeSince(now, {
        level: shortLevel,
        brightness,
        noisiness,
        onsetsPerSecond,
        dynamics,
      }),
    };

    description.summary = summarise(description);
    return description;
  }

  _describeSince(now, current) {
    const mark = this._mark;
    if (!mark) return null;
    const moved = (a, b, up, down, margin = 0.12) => {
      if (a > b + margin) return up;
      if (a < b - margin) return down;
      return 'about the same';
    };
    return {
      seconds: Math.round((now - mark.at) * 10) / 10,
      // A tenth of the mark's own level, so the margin means the same thing
      // whether the set is running at 0.05 or at 0.8.
      loudness: moved(current.level, mark.level, 'louder', 'quieter', Math.max(0.02, mark.level * 0.15)),
      brightness: moved(current.brightness, mark.brightness, 'brighter', 'darker'),
      noisiness: moved(current.noisiness, mark.noisiness, 'noisier', 'cleaner'),
      rhythm: moved(current.onsetsPerSecond, mark.onsetsPerSecond, 'busier', 'sparser', 0.6),
      wasDynamics: mark.dynamics,
      events: this._events.filter((e) => e.at >= mark.at).map((e) => e.kind),
    };
  }

  _emptyDescription() {
    return {
      listeningSeconds: 0,
      dynamics: 'silent',
      intensity: 0,
      density: { onsetsPerSecond: 0, trend: 'steady' },
      brightness: { value: 0, trend: 'steady' },
      noisiness: { value: 0, trend: 'steady' },
      texture: { heldSeconds: 0, changedAt: null },
      pulse: { state: 'free', bpm: null, confidence: 0 },
      events: [],
      since: null,
      summary: 'nothing heard yet',
    };
  }
}

/**
 * One line of English, because a prompt reads one better than it reads six
 * numbers — and because it is what the panel puts on screen.
 */
export function summarise(d) {
  if (!d) return '';
  if (d.dynamics === 'silent') return 'silence';
  const parts = [];
  parts.push(d.dynamics);
  if (d.density.onsetsPerSecond < 0.2) parts.push('no rhythm');
  else parts.push(`${d.density.onsetsPerSecond.toFixed(1)} hits/s ${d.density.trend}`);
  if (d.brightness.trend !== 'steady') parts.push(`${d.brightness.trend} brightness`);
  if (d.texture.heldSeconds > 30) parts.push(`same texture ${Math.round(d.texture.heldSeconds)}s`);
  parts.push(d.pulse.state === 'metered' ? `${d.pulse.bpm} BPM` : 'free pulse');
  return parts.join(', ');
}
