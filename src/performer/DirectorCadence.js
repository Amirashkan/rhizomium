/**
 * DirectorCadence.js - when the model gets asked.
 *
 * This replaces a single line: `state.now.bar - lastAskedBar < everyBars`.
 *
 * That line is fine for a set with a pulse in it. For a set without one it is
 * a fiction — the bar counter is a metronome running at whatever tempo was
 * typed into the panel, so "every sixteen bars" means "every thirty seconds at
 * 128" and nothing at all about the music. The model was being asked to think
 * on a clock that had no relationship to what it was listening to.
 *
 * So the cadence is decided from three things instead, in this order:
 *
 *   a floor      never more often than this, whatever happens. The spend is
 *                bounded here and nowhere else.
 *   novelty      the texture changed, the level dropped, something swelled —
 *                ask now rather than at the next tick of a timer. This is the
 *                whole difference between a co-performer and an alarm clock.
 *   an interval  and failing all that, every so often, in seconds.
 *
 * Plus one thing that saves money rather than spending it: when nothing has
 * changed for a long time, the interval stretches. Three minutes into a drone
 * there is no new question to ask, and asking it anyway bills the artist for
 * being told so.
 *
 * `everyBars` still works, for the sets that have bars. It is converted to
 * seconds from the real tempo when there IS a real tempo, and falls back to the
 * seconds default when there is not — which is the honest reading of a bar
 * count on music with no bars.
 */

/** Never ask more often than this, for any reason. The hard bound on spend. */
export const MIN_SECONDS = 20;

/** The default cadence when a scenario does not name one. */
export const DEFAULT_EVERY_SECONDS = 45;

/** Nothing has changed for this multiple of the interval: start stretching. */
export const BOREDOM_AFTER = 2;

/** …and never stretch past this. Even a drone deserves a look every so often. */
export const BOREDOM_CAP_SECONDS = 180;

/** Long enough to have heard something before the first question. */
export const WARMUP_SECONDS = 8;

/** What counts as the music doing something worth a fresh thought. */
export const NOVELTY_KINDS = Object.freeze(['texture-change', 'drop', 'swell', 'onset-stop']);

/** …and how big it has to be. A barely-there event is not news. */
const NOVELTY_MAGNITUDE = 0.25;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class DirectorCadence {
  /**
   * @param {object} [options]
   * @param {Function} [options.now] () => seconds. Injectable for tests.
   * @param {number} [options.minSeconds]
   */
  constructor(options = {}) {
    this.now = options.now || (() => Date.now() / 1000);
    this.minSeconds = options.minSeconds ?? MIN_SECONDS;

    this._startedAt = null;
    this._lastAskedAt = null;
    this._lastReason = null;
    this._interval = DEFAULT_EVERY_SECONDS;
  }

  /** Forget the cadence — a new set, or a director just switched on. */
  reset() {
    this._startedAt = null;
    this._lastAskedAt = null;
    this._lastReason = null;
  }

  /**
   * Should the model be asked right now?
   *
   * @param {object|null} description what MusicalListener says the music is doing
   * @param {object} state the engine's state, for the tempo and the scenario rules
   * @returns {{reason: string, interval: number}|null}
   */
  shouldAsk(description, state) {
    const now = this.now();
    if (this._startedAt === null) this._startedAt = now;

    const interval = this._intervalFor(description, state);
    this._interval = interval;

    // Never asked yet: hear a little of the room first, so the first question
    // is not spent on a description that says "nothing heard yet".
    //
    // Keyed off how long the LISTENER has been hearing rather than how long
    // this has been running, because those are different things — and because
    // a host with no listener at all has nothing to wait for and should ask
    // straight away.
    if (this._lastAskedAt === null) {
      const heard = description?.listeningSeconds;
      if (Number.isFinite(heard) && heard < WARMUP_SECONDS) return null;
      return { reason: 'first', interval };
    }

    const elapsed = now - this._lastAskedAt;
    if (elapsed < this.minSeconds) return null;

    if (this._novelSince(description, elapsed)) return { reason: 'novelty', interval };
    if (elapsed >= interval) return { reason: 'interval', interval };
    return null;
  }

  /** The director asked. Called whether the cadence suggested it or not. */
  noteAsked(reason = 'interval') {
    const now = this.now();
    if (this._startedAt === null) this._startedAt = now;
    this._lastAskedAt = now;
    this._lastReason = reason;
  }

  status() {
    const now = this.now();
    return {
      reason: this._lastReason,
      intervalSeconds: Math.round(this._interval),
      sinceLastAsk: this._lastAskedAt === null ? null : Math.round(now - this._lastAskedAt),
      nextInSeconds:
        this._lastAskedAt === null
          ? 0
          : Math.max(0, Math.round(this._lastAskedAt + this._interval - now)),
    };
  }

  // --- internals ---------------------------------------------------------

  /** Anything worth interrupting the interval for since the last question. */
  _novelSince(description, elapsed) {
    const events = description?.events;
    if (!Array.isArray(events)) return false;
    return events.some(
      (event) =>
        NOVELTY_KINDS.includes(event.kind) &&
        event.magnitude >= NOVELTY_MAGNITUDE &&
        event.secondsAgo <= elapsed,
    );
  }

  /**
   * The interval in force right now: what the scenario asked for, stretched by
   * however long the music has been doing the same thing.
   */
  _intervalFor(description, state) {
    const base = this._baseInterval(description, state);
    const held = description?.texture?.heldSeconds ?? 0;
    const quiet = base * BOREDOM_AFTER;
    if (held <= quiet) return base;

    // Linear in how long it has been static, capped. Geometric growth reaches
    // the cap so fast that the cap may as well have been the interval.
    const stretched = base * (1 + (held - quiet) / quiet);
    return clamp(stretched, base, Math.max(base, BOREDOM_CAP_SECONDS));
  }

  _baseInterval(description, state) {
    const rules = state?.scenario?.rules?.director || {};

    if (Number.isFinite(rules.everySeconds) && rules.everySeconds > 0) {
      return Math.max(this.minSeconds, rules.everySeconds);
    }

    // A bar count only converts to a cadence if there are really bars. The
    // clock's BPM is not enough on its own — it is 120 until someone says
    // otherwise — so the pulse has to have actually been heard.
    const metered = description?.pulse?.state === 'metered';
    const bpm = metered ? description.pulse.bpm : null;
    if (Number.isFinite(rules.everyBars) && bpm) {
      const beatsPerBar = Number(state?.now?.beatsPerBar) || 4;
      const seconds = (rules.everyBars * beatsPerBar * 60) / bpm;
      return clamp(seconds, this.minSeconds, BOREDOM_CAP_SECONDS);
    }

    return Math.max(this.minSeconds, DEFAULT_EVERY_SECONDS);
  }
}
