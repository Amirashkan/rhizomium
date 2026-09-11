/**
 * SignalBus.js - what the performer can hear.
 *
 * One named, normalised, smoothed value per signal, refreshed once a frame.
 * Everything downstream — a drive, a `when` condition, the state the model is
 * shown — reads this and only this, which is what keeps three different
 * consumers agreeing about what "energy" was at the moment a section changed.
 *
 * Three things it does that a raw OSC value does not:
 *
 * 1. **Normalises to 0-1.** A scenario written against a 0-1 fader has to keep
 *    working when the sender turns out to emit 0-127, because the scenario was
 *    written at a desk and the sender is found at soundcheck. The declared
 *    input range is the only place that knowledge lives.
 *
 * 2. **Smooths in seconds, not frames.** A per-frame coefficient makes a
 *    performance behave differently on a 60 Hz laptop and a 144 Hz rig — the
 *    same set, rehearsed and then not reproducible. The time constant here is
 *    converted against the real frame delta, so a 0.4 s signal takes 0.4 s
 *    either way. Attack and release can differ, which is how a level signal
 *    snaps up and falls away like a meter instead of averaging into mush.
 *
 * 3. **Keeps a little history.** `rise` (how fast it is moving) and the rolling
 *    peak are what a scenario needs to say "the music is building" rather than
 *    "the music is loud", and they are most of what makes a director's reading
 *    of a moment better than a single number.
 *
 * Reads are pull-based: nothing here subscribes to OSC. The engine's tick
 * samples OSCManager's last-value map, which it already maintains for the
 * settings panel. A signal that stops arriving therefore decays through its
 * own release rather than freezing at its last value — a fader the musician
 * let go of should fall, not hang.
 */

import { BUILTIN_SIGNALS } from './Scenario.js';

const clamp01 = (value) => (value > 1 ? 1 : value < 0 ? 0 : value);

/**
 * Convert a time constant into a per-frame blend factor.
 *
 * Standard one-pole: after `tau` seconds the value has covered 1 - 1/e of the
 * distance. tau of 0 is a pass-through, which is what a trigger channel needs —
 * smoothing a one-frame kick pulse is the same as deleting it.
 */
function blendFactor(tau, deltaSeconds) {
  if (!(tau > 0)) return 1;
  if (!(deltaSeconds > 0)) return 0;
  return 1 - Math.exp(-deltaSeconds / tau);
}

/** Apply a response curve to an already-normalised reading. */
function applyCurve(value, curve) {
  switch (curve) {
    case 'exponential': return value * value;
    case 'logarithmic': return Math.sqrt(value);
    default: return value;
  }
}

/** How long a signal's history window is. Two seconds is about a bar at 120. */
const HISTORY_SECONDS = 2;

class Signal {
  constructor(definition) {
    this.def = definition;
    this.name = definition.name;

    /** Smoothed, normalised, curved: what everything downstream reads. */
    this.value = 0;
    /** The same reading before smoothing, for a trigger that must not be blurred. */
    this.raw = 0;
    /** Change per second, signed. Positive means building. */
    this.rise = 0;
    /** Highest value seen in the last HISTORY_SECONDS. */
    this.peak = 0;
    /** Mean over the same window. */
    this.average = 0;

    this._peakAge = 0;
    this._sum = 0;
    this._sumSeconds = 0;
    this._lastValue = 0;
    /** Whether anything has ever written to this signal. */
    this.seen = false;
  }

  /**
   * Feed one reading, in the sender's own units.
   *
   * @param {number} reading raw value from the source
   * @param {number} delta seconds since the last update
   */
  update(reading, delta) {
    const def = this.def;

    let normalized = 0;
    if (Number.isFinite(reading)) {
      this.seen = true;
      const span = def.inputMax - def.inputMin;
      normalized = span === 0 ? 0 : (reading - def.inputMin) / span;
      normalized = clamp01(normalized);
      if (def.invert) normalized = 1 - normalized;
      normalized = applyCurve(normalized, def.curve);
    }

    this.raw = normalized;

    // Attack and release fall back to `smooth` so a signal can say either
    // "settle over 0.3s" or "snap up, fall over 0.3s" without saying both.
    const rising = normalized > this.value;
    const tau = rising
      ? (def.attack === null ? def.smooth : def.attack)
      : (def.release === null ? def.smooth : def.release);

    const previous = this.value;
    this.value += (normalized - this.value) * blendFactor(tau, delta);

    // Guard the derivative rather than the value: at 144 Hz a delta can be
    // small enough that dividing by it turns float noise into a spike, and
    // `rise` is what a "building" condition reads.
    this.rise = delta > 1e-4 ? (this.value - previous) / delta : this.rise;

    this._sum += this.value * delta;
    this._sumSeconds += delta;
    if (this._sumSeconds > HISTORY_SECONDS) {
      // A decaying window rather than a ring buffer: same answer to within a
      // frame, no allocation, and it costs two floats per signal per frame.
      const keep = HISTORY_SECONDS / this._sumSeconds;
      this._sum *= keep;
      this._sumSeconds *= keep;
    }
    this.average = this._sumSeconds > 0 ? this._sum / this._sumSeconds : 0;

    if (this.value >= this.peak) {
      this.peak = this.value;
      this._peakAge = 0;
    } else {
      this._peakAge += delta;
      if (this._peakAge > HISTORY_SECONDS) {
        // Let the peak fall towards the current value rather than resetting it,
        // so a quiet passage lowers the bar smoothly instead of in a step.
        this.peak += (this.value - this.peak) * blendFactor(HISTORY_SECONDS, delta);
      }
    }

    this._lastValue = normalized;
    return this.value;
  }
}

export class SignalBus {
  /**
   * @param {object} sources
   * @param {{getValue?: Function}} [sources.osc] an OSCManager
   * @param {{audioTapValue?: Function}} [sources.audio] audioAnalysisTaps module
   * @param {PerformerClock} [sources.clock]
   */
  constructor(sources = {}) {
    this.osc = sources.osc || null;
    this.audio = sources.audio || null;
    this.clock = sources.clock || null;

    /** name -> Signal */
    this.signals = new Map();

    /**
     * Values pushed in rather than read out: a `manual` signal, and anything
     * arriving on /rhizo/perf/signal/<name>. Held separately so a push that
     * lands between two frames is not lost to the next poll.
     */
    this.pushed = new Map();

    /**
     * The two the whole system leans on, published whether or not a scenario
     * declares them. `energy` is what the musician sends to say how hard the
     * music is going; `intensity` is what the performer is currently playing
     * at. A scenario that declares its own `energy` signal overrides this.
     */
    this.energy = 0;
    this.intensity = 0;

    /** Extra values the engine publishes each frame (section position, etc). */
    this.extras = Object.create(null);
  }

  /** Point the bus at a scenario's signal list. Existing values survive a rename-free reload. */
  setScenario(scenario) {
    const next = new Map();
    for (const definition of scenario?.signals || []) {
      const existing = this.signals.get(definition.name);
      if (existing && sameShape(existing.def, definition)) {
        existing.def = definition;
        next.set(definition.name, existing);
      } else {
        next.set(definition.name, new Signal(definition));
      }
    }
    this.signals = next;
  }

  /** Push a value for a manual signal, or override any signal by name. */
  push(name, value) {
    if (typeof name !== 'string' || !name) return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    this.pushed.set(name, n);
  }

  /** Set the musician's stated energy, 0-1. */
  setEnergy(value) {
    const n = Number(value);
    if (Number.isFinite(n)) this.energy = clamp01(n);
  }

  /** Publish an engine-derived value under a name conditions can read. */
  setExtra(name, value) {
    const n = Number(value);
    this.extras[name] = Number.isFinite(n) ? n : 0;
  }

  /**
   * Refresh every signal. Called once per frame, before anything reads.
   * @param {number} delta seconds since the last update
   */
  update(delta) {
    const dt = Number.isFinite(delta) && delta > 0 ? delta : 0;

    for (const signal of this.signals.values()) {
      signal.update(this.read(signal.def), dt);
    }

    // A pushed value is consumed by the frame that reads it. Holding it would
    // make a one-shot push a permanent override of its own signal.
    this.pushed.clear();
  }

  /** Read one signal definition's current source value, in the sender's units. */
  read(definition) {
    const pushed = this.pushed.get(definition.name);
    if (pushed !== undefined) return pushed;

    switch (definition.source) {
      case 'osc': {
        const osc = this.osc;
        if (!osc?.getValue) return NaN;
        // An address the bridge has never seen reads 0 from OSCManager, and a
        // signal sitting at 0 because nothing sends it is a different fact
        // from one sitting at 0 because the fader is down. NaN carries that
        // difference: the signal holds at zero and `seen` stays false, so the
        // panel can say "nothing arriving" and the director is not told the
        // bass is quiet when there is no bass signal at all.
        if (osc.addresses?.has && !osc.addresses.has(definition.address)) return NaN;
        return osc.getValue(definition.address, definition.arg);
      }

      case 'audio':
        return this.audio?.audioTapValue ? this.audio.audioTapValue(definition.channel) : NaN;

      case 'clock': {
        const clock = this.clock;
        if (!clock) return NaN;
        switch (definition.channel) {
          case 'beatPhase': return clock.beatPhase;
          case 'barPhase': return clock.barPhase;
          case 'phrasePhase': return clock.phrasePhase;
          case 'beat': return clock.beat;
          case 'bar': return clock.bar;
          case 'phrase': return clock.phrase;
          case 'bpm': return clock.bpm;
          default: return 0;
        }
      }

      case 'manual':
        // Nothing pushed this frame: hold where it was, which for a manual
        // signal is the point — it is a knob, not a stream.
        return this.signals.get(definition.name)?.raw ?? definition.default ?? 0;

      default:
        return NaN;
    }
  }

  /** One signal's smoothed value, or 0 when it is not declared. */
  value(name) {
    const signal = this.signals.get(name);
    if (signal) return signal.value;
    if (name in this.extras) return this.extras[name];
    return this.builtin(name);
  }

  /** Clock and engine values every scenario can read without declaring them. */
  builtin(name) {
    const clock = this.clock;
    switch (name) {
      case 'energy': return this.energy;
      case 'intensity': return this.intensity;
      case 'beatPhase': return clock ? clock.beatPhase : 0;
      case 'barPhase': return clock ? clock.barPhase : 0;
      case 'phrasePhase': return clock ? clock.phrasePhase : 0;
      case 'beat': return clock ? clock.beat : 0;
      case 'bar': return clock ? clock.bar : 0;
      case 'phrase': return clock ? clock.phrase : 0;
      case 'bpm': return clock ? clock.bpm : 0;
      default: return 0;
    }
  }

  /**
   * The scope a condition is evaluated against.
   *
   * Null-prototype on purpose. The expression system resolves an identifier
   * with `name in context`, and on a normal object literal that finds
   * `constructor` and `toString` — a scenario with a signal named `constructor`
   * would otherwise read a function where it expected a number.
   */
  scope() {
    const context = Object.create(null);

    for (const name of BUILTIN_SIGNALS) context[name] = this.builtin(name);
    for (const [name, value] of Object.entries(this.extras)) context[name] = value;

    for (const [name, signal] of this.signals) {
      context[name] = signal.value;
      // Derived readings, addressable as identifiers so a condition can say
      // `bass_rise > 0.4` — "the bass is coming up" — without the scenario
      // having to declare a second signal for it.
      context[`${name}_raw`] = signal.raw;
      context[`${name}_rise`] = signal.rise;
      context[`${name}_peak`] = signal.peak;
      context[`${name}_avg`] = signal.average;
    }

    return context;
  }

  /** What the panel's meters and the director's prompt read. */
  snapshot() {
    const out = {};
    for (const [name, signal] of this.signals) {
      out[name] = {
        value: round(signal.value),
        raw: round(signal.raw),
        rise: round(signal.rise),
        peak: round(signal.peak),
        average: round(signal.average),
        source: signal.def.source,
        seen: signal.seen,
      };
    }
    return out;
  }

  /** Every identifier a condition may legally name right now. */
  knownNames() {
    const names = new Set(BUILTIN_SIGNALS);
    for (const name of Object.keys(this.extras)) names.add(name);
    for (const name of this.signals.keys()) {
      names.add(name);
      names.add(`${name}_raw`);
      names.add(`${name}_rise`);
      names.add(`${name}_peak`);
      names.add(`${name}_avg`);
    }
    return names;
  }
}

const round = (value) => Math.round(value * 1000) / 1000;

/** Whether a redefinition can keep the old signal's smoothed state. */
function sameShape(a, b) {
  return a.source === b.source
    && a.address === b.address
    && a.channel === b.channel
    && a.arg === b.arg;
}

export default SignalBus;
