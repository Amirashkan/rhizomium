/**
 * PerformerClock.js - the musical clock the performance runs on.
 *
 * Why this is not BeatSyncManager. That one is the VJ panel's metronome: it
 * counts a beat within a bar, resets its measure count when the tempo changes,
 * and drives callbacks off its own requestAnimationFrame. All three are wrong
 * for a score.
 *
 *   - A scenario says "hold 32 bars" and "fire at bar 8". That needs a
 *     MONOTONIC position, not a beat that wraps at 4 and a measure that goes
 *     back to zero the moment the musician nudges the tempo.
 *   - A tempo change mid-set is normal. It must change how fast the clock runs
 *     from now on and leave where it already is alone, so a section eight bars
 *     in is still eight bars in.
 *   - The engine ticks this from the shared RAF (ARCHITECTURE.md §4). A clock
 *     with its own loop is a second animation frame doing the same work.
 *
 * So position is accumulated rather than derived: every tick adds
 * `elapsed * bpm / 60` beats. Integrating like this is exactly what makes a
 * tempo change free — the beats already banked are not re-scaled, because they
 * were never a function of the current tempo.
 *
 * The musician stays in charge of where the grid sits. `syncToBar()` on an OSC
 * bar message snaps the phase without moving the count, which is how the
 * visuals stay on the downbeat through a set played by a human rather than a
 * sequencer.
 */

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Wall clock, injectable so tests can run a set in a millisecond. */
const defaultNow = () =>
  (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * The largest gap a single tick may bank.
 *
 * A backgrounded tab stops firing frames, and the first frame after it
 * returns carries the whole gap. Without a ceiling, coming back to a laptop
 * after a minute would advance the set by thirty bars and fire every move in
 * between at once. Half a second is longer than any real frame and shorter
 * than any musical unit.
 */
const MAX_TICK_SECONDS = 0.5;

export class PerformerClock {
  constructor(options = {}) {
    this.now = options.now || defaultNow;

    this.bpm = clamp(Number(options.bpm) || 120, 20, 300);
    this.beatsPerBar = clamp(Math.trunc(Number(options.beatsPerBar) || 4), 1, 16);
    this.barsPerPhrase = clamp(Math.trunc(Number(options.barsPerPhrase) || 8), 1, 64);

    this.running = false;
    this._lastTick = null;

    /** Monotonic position, in beats, since start(). Fractional. */
    this.beats = 0;
    /** Wall time since start(), in seconds, excluding pauses. */
    this.seconds = 0;

    // Tap tempo, kept here rather than in the panel so a tap over OSC and a
    // tap on a key land in the same place.
    this._taps = [];
  }

  /** Start from zero. */
  start() {
    this.beats = 0;
    this.seconds = 0;
    this._lastTick = this.now();
    this.running = true;
  }

  /** Stop and rewind. */
  stop() {
    this.running = false;
    this._lastTick = null;
    this.beats = 0;
    this.seconds = 0;
  }

  /** Stop where it is. */
  pause() {
    this.running = false;
    this._lastTick = null;
  }

  /** Carry on from where it stopped. */
  resume() {
    if (this.running) return;
    this._lastTick = this.now();
    this.running = true;
  }

  /**
   * Advance the clock. Called once per frame by the engine.
   *
   * @param {number} [timestamp] the frame's timestamp, when the caller has one
   * @returns {number} seconds banked by this tick (0 when stopped)
   */
  tick(timestamp) {
    if (!this.running) return 0;

    const now = Number.isFinite(timestamp) ? timestamp : this.now();
    if (this._lastTick === null) {
      this._lastTick = now;
      return 0;
    }

    // Clamped at both ends: negative would mean the timestamp went backwards
    // (a caller mixing performance.now() with Date.now()), and banking a
    // negative delta would rewind the set.
    const delta = clamp((now - this._lastTick) / 1000, 0, MAX_TICK_SECONDS);
    this._lastTick = now;

    this.seconds += delta;
    this.beats += (delta * this.bpm) / 60;
    return delta;
  }

  /**
   * Change tempo from here on.
   *
   * Nothing is recomputed: beats already banked stay banked. That is the whole
   * reason this clock integrates rather than dividing elapsed time by the beat
   * length, and it is what lets a musician ride the tempo through a section
   * without the section's own position jumping.
   */
  setBPM(bpm) {
    const value = Number(bpm);
    if (!Number.isFinite(value) || value < 20 || value > 300) return false;
    this.bpm = value;
    return true;
  }

  setMeter(beatsPerBar, barsPerPhrase) {
    if (Number.isFinite(beatsPerBar)) {
      this.beatsPerBar = clamp(Math.trunc(beatsPerBar), 1, 16);
    }
    if (Number.isFinite(barsPerPhrase)) {
      this.barsPerPhrase = clamp(Math.trunc(barsPerPhrase), 1, 64);
    }
  }

  // --- position ----------------------------------------------------------

  /** Whole beats elapsed. */
  get beat() { return Math.floor(this.beats); }

  /** Whole bars elapsed. */
  get bar() { return Math.floor(this.beats / this.beatsPerBar); }

  /** Whole phrases elapsed. */
  get phrase() { return Math.floor(this.beats / (this.beatsPerBar * this.barsPerPhrase)); }

  /** Position within the current beat, 0-1. */
  get beatPhase() { return this.beats - Math.floor(this.beats); }

  /** Position within the current bar, 0-1. */
  get barPhase() {
    const bars = this.beats / this.beatsPerBar;
    return bars - Math.floor(bars);
  }

  /** Position within the current phrase, 0-1. */
  get phrasePhase() {
    const phrases = this.beats / (this.beatsPerBar * this.barsPerPhrase);
    return phrases - Math.floor(phrases);
  }

  get secondsPerBeat() { return 60 / this.bpm; }
  get secondsPerBar() { return this.secondsPerBeat * this.beatsPerBar; }

  /** Bars as a fraction, for "how long has this section been up". */
  get barsElapsed() { return this.beats / this.beatsPerBar; }

  // --- staying with the musician -----------------------------------------

  /**
   * Put the grid's downbeat here, without losing count.
   *
   * Called on an OSC bar message. It moves the clock forward to the nearest
   * bar line rather than backward, because a section that has run 31.9 bars
   * and is waiting for 32 should be released by the downbeat it just heard —
   * rewinding it to 31.0 would hold the change for another whole bar.
   */
  syncToBar() {
    const bars = this.beats / this.beatsPerBar;
    this.beats = Math.round(bars) * this.beatsPerBar;
  }

  /** The same, on a beat message. */
  syncToBeat() {
    this.beats = Math.round(this.beats);
  }

  /**
   * Tap tempo. Two taps set a tempo; taps more than two seconds apart start a
   * new measurement rather than averaging across a pause.
   *
   * @returns {number|null} the tempo set, or null when there is not one yet
   */
  tap(at) {
    const now = Number.isFinite(at) ? at : this.now();
    this._taps = this._taps.filter((t) => now - t < 2000);
    this._taps.push(now);
    if (this._taps.length < 2) return null;

    let total = 0;
    for (let i = 1; i < this._taps.length; i++) total += this._taps[i] - this._taps[i - 1];
    const bpm = 60000 / (total / (this._taps.length - 1));
    if (!this.setBPM(Math.round(bpm * 10) / 10)) return null;

    // A tap says where the beat is as much as how fast it goes.
    this.syncToBeat();
    return this.bpm;
  }

  resetTap() { this._taps = []; }

  /**
   * When the next boundary of a grid falls, in seconds from now.
   *
   * Returns 0 for 'off' so an unquantised action runs on this tick.
   */
  secondsUntil(grid) {
    if (!grid || grid === 'off') return 0;

    const unitBeats = this.beatsPerUnit(grid);
    if (!unitBeats) return 0;

    const position = this.beats / unitBeats;
    const untilBeats = (Math.ceil(position) - position) * unitBeats;
    // Landing exactly on a boundary means the boundary is now, not a whole
    // unit away — otherwise an action queued on the downbeat waits a full bar.
    return untilBeats * this.secondsPerBeat;
  }

  /** The position (in beats) of the next boundary of a grid. */
  nextBoundaryBeats(grid) {
    if (!grid || grid === 'off') return this.beats;
    const unitBeats = this.beatsPerUnit(grid);
    if (!unitBeats) return this.beats;
    const position = this.beats / unitBeats;
    const next = Math.floor(position) + 1;
    return next * unitBeats;
  }

  /** How many beats one unit of a quantisation grid is. */
  beatsPerUnit(grid) {
    switch (grid) {
      case 'beat': return 1;
      case 'half': return this.beatsPerBar / 2;
      case 'bar': return this.beatsPerBar;
      case 'phrase': return this.beatsPerBar * this.barsPerPhrase;
      default: return 0;
    }
  }

  /** Everything a reader needs, in one object. */
  snapshot() {
    return {
      running: this.running,
      bpm: this.bpm,
      beatsPerBar: this.beatsPerBar,
      barsPerPhrase: this.barsPerPhrase,
      beats: this.beats,
      seconds: this.seconds,
      beat: this.beat,
      bar: this.bar,
      phrase: this.phrase,
      beatPhase: this.beatPhase,
      barPhase: this.barPhase,
      phrasePhase: this.phrasePhase,
    };
  }
}

export default PerformerClock;
