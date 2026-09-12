/**
 * PerformerDirector.js - the model, kept out of the frame loop.
 *
 * The performer has two brains and this is the slow one. The engine reacts in
 * a frame; the director thinks in bars, about what the next stretch of the set
 * should be. Everything here exists to keep those two clocks from touching:
 *
 *   offer(state)   "here is the performance, right now" — returns instantly,
 *                  and may or may not start a request in the background
 *   take()         "is anything ready?" — returns a plan or null, never waits
 *   discard(why)   "forget it, the musician just did something"
 *
 * A model call takes seconds. A bar at 128 BPM is under two. So a plan is
 * never an answer to the moment it lands in — it is an answer to the moment it
 * was ASKED in, which is why every plan carries `askedAtBeats` and the engine
 * drops one that has aged past `rules.director.staleAfterBars`. Getting this
 * wrong does not look like a bug; it looks like visuals that are consistently
 * a phrase behind the music, which is worse than no director at all.
 *
 * ## Two features
 *
 * `ai.performer_scenario` writes a scenario from a brief. Slow, offline, run
 * once at a desk — the artist reads what comes back and edits it.
 *
 * `ai.performer_live` improvises within one. It is handed the scenario, the
 * live signals and the last few things that happened, and answers with a short
 * list of actions and an optional note. It runs during the set.
 *
 * Both go through runFeature(), so both are grant-gated exactly like every
 * other AI feature in the editor (ARCHITECTURE.md, "Open-core boundary"):
 * setting a tier in devtools buys a lit-up button and a 401.
 */

import { runFeature, AIRequestError, GrantError } from '../ai/aiClient.js';
import { DirectorCadence } from './DirectorCadence.js';
import { normalizeScenario } from './Scenario.js';
import { normalizeAction } from './actions.js';

/** Feature keys. Mirrored in src/ai/tiers.js and api/_lib/features.js. */
export const SCENARIO_FEATURE = 'ai.performer_scenario';
export const LIVE_FEATURE = 'ai.performer_live';

/**
 * A live call that has not answered in this long is abandoned.
 *
 * It is deliberately short. The backend's own deadline is far longer, but a
 * live answer is worthless once it is stale anyway, and holding the in-flight
 * slot is what stops the NEXT, useful call from being made.
 */
const LIVE_TIMEOUT_MS = 20_000;

/** After a failure, wait this long before trying again, doubling to the cap. */
const BACKOFF_START_MS = 15_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/** Most actions a single live plan may carry. Past this it is not a plan. */
const MAX_PLAN_ACTIONS = 8;

/**
 * The most minutes one call may charge for.
 *
 * The gap between two questions is normally under a minute and at worst the
 * boredom cap, so this is not a limit the cadence can reach on its own. It is
 * there for the gap it cannot see: a set paused for an encore, a laptop asleep
 * between soundcheck and doors. Charging for that is charging for time nobody
 * performed.
 */
const MAX_UNITS_PER_CALL = 5;

export class PerformerDirector {
  /**
   * @param {object} [options]
   * @param {Function} [options.run] runFeature, injectable for tests
   * @param {Function} [options.log] (level, message, meta) => void
   * @param {Function} [options.now]
   */
  constructor(options = {}) {
    this.run = options.run || runFeature;
    this.log = options.log || (() => {});
    this.now = options.now || (() => Date.now());

    /** Off until the artist turns it on. A model does not join a set uninvited. */
    this.enabled = false;

    /** A finished plan waiting for the engine to take it. */
    this._ready = null;

    /** The request in flight, if any. */
    this._inFlight = null;
    this._inFlightAt = 0;
    /** Bumped on discard(); an answer tagged with an old token is thrown away. */
    this._token = 0;

    /**
     * When to ask. Not a bar count: see DirectorCadence for why a bar count is
     * the wrong unit on music that does not have bars.
     */
    this.cadence = options.cadence || new DirectorCadence({ now: () => this.now() / 1000 });

    /**
     * The listening memory, if the host wired one in. Optional on purpose — the
     * director still works without it, it is just asking on a timer and telling
     * the model less.
     */
    this.listener = options.listener || null;
    /** Wall clock, for the backoff. */
    this._nextAllowedAt = 0;
    this._failures = 0;

    this.lastError = null;
    this.lastNote = '';
    this.calls = 0;

    /**
     * Wall-clock of the previous live call, so each one can spend the minutes
     * of performance since the last rather than a flat one-per-call.
     *
     * Null until the first call of a session: that one spends a single minute
     * whatever the cadence works out to, because there is no stretch of set
     * before it to charge for.
     */
    this._lastCallAt = null;

    /** Free text from the artist: "keep it dark", "more strobe". Sent with every ask. */
    this.steer = '';

    /** Minutes of performance charged for so far, for the panel's readout. */
    this.minutesSpent = 0;

    /** Units a call in flight will cost, counted once it is known to be spent. */
    this._pendingUnits = 0;
  }

  /** Turn the live director on or off mid-set. */
  setEnabled(on) {
    const was = this.enabled;
    this.enabled = Boolean(on);
    if (!this.enabled) this.discard('director switched off');
    // Switched on mid-set: start the cadence from here, so the warm-up applies
    // and the first question is asked about music it has actually heard.
    if (this.enabled && !was) {
      this.cadence.reset();
      // Switched off and on again: the time in between was not performed, and
      // the next call must not charge for it.
      this._lastCallAt = null;
    }
    return this.enabled;
  }

  /**
   * Minutes of performance this call is charged for.
   *
   * The stretch of set since the last question, rounded up, because part of a
   * minute of someone's show is still their show. Capped so a set left running
   * overnight — or a director switched on, forgotten, and come back to — cannot
   * present the artist with a bill for the gap.
   */
  _unitsToSpend() {
    if (this._lastCallAt === null) return 1;
    const minutes = (this.now() - this._lastCallAt) / 60_000;
    return Math.max(1, Math.min(MAX_UNITS_PER_CALL, Math.ceil(minutes)));
  }

  /** Hand the director the listening memory. The engine does this when it is on. */
  setListener(listener) {
    this.listener = listener || null;
  }

  /** A line of direction from the artist, carried into the next ask. */
  setSteer(text) {
    this.steer = typeof text === 'string' ? text.slice(0, 500) : '';
  }

  // --- the live loop -----------------------------------------------------

  /**
   * Offered the performance state every frame. Decides nothing expensive
   * unless it is time; returns immediately either way.
   */
  offer(state) {
    if (!this.enabled) return;
    if (!state?.scenario?.rules?.director?.enabled) return;

    // Reap a request that has stopped being worth waiting for. Without this a
    // single hung fetch would silence the director for the rest of the night.
    if (this._inFlight && this.now() - this._inFlightAt > LIVE_TIMEOUT_MS) {
      this.log('warn', 'Director call timed out');
      this._inFlight = null;
      this._noteFailure();
    }

    if (this._inFlight || this._ready) return;
    if (this.now() < this._nextAllowedAt) return;

    const listening = this.listening(state);
    const due = this.cadence.shouldAsk(listening, state);
    if (!due) return;

    this.ask(state, due.reason, listening);
  }

  /**
   * What the music has been doing, or null if nothing is listening.
   *
   * Read here rather than in the engine because it is only ever wanted at the
   * moment a question is being considered — it caches, but the engine offers
   * this director a state every single frame.
   */
  listening(state) {
    if (state?.listening) return state.listening;
    if (!this.listener) return null;
    try {
      return this.listener.describe();
    } catch {
      // A listener that throws must not take the set down with it.
      return null;
    }
  }

  /**
   * A section just changed. Worth a fresh ask regardless of the cadence: the
   * section is the unit the director plans in, and one that just started is
   * the one worth planning.
   */
  onSectionChange(state) {
    if (!this.enabled) return;
    if (this._inFlight || this.now() < this._nextAllowedAt) return;
    this.ask(state, 'section');
  }

  /** Start a call. Never awaited by the caller. */
  ask(state, reason = 'interval', listening = undefined) {
    const heard = listening === undefined ? this.listening(state) : listening;
    this.cadence.noteAsked(reason);
    this._inFlightAt = this.now();
    this.calls++;

    // From here on, "since" means since this question — which is the only
    // reference point that makes the next answer about the right stretch of
    // music.
    try { this.listener?.mark?.(); } catch { /* never break the set */ }

    const token = this._token;
    const askedAtBeats = state.askedAtBeats;
    const askedAtSeconds = state.askedAtSeconds;

    // Counted only once the allowance has actually been spent — see
    // _noteFailure(). A grant the gallery refuses costs the artist nothing, and
    // a readout that says otherwise is worse than no readout.
    const units = this._unitsToSpend();
    this._pendingUnits = units;

    const request = this.run(LIVE_FEATURE, {
      state: compactState(state, heard),
      steer: this.steer,
      freedom: state.scenario.rules.director.freedom,
    }, { units })
      .then(({ result }) => {
        // A discard while this was in the air means the musician has since made
        // a decision. Answering it now would be overriding them.
        if (token !== this._token) return;
        this._inFlight = null;
        this._failures = 0;
        this.lastError = null;
        this._spend(units);

        const plan = shapePlan(result, askedAtBeats, askedAtSeconds);
        if (!plan) return;

        this.lastNote = plan.note || '';
        this._ready = plan;
      })
      .catch((error) => {
        if (token !== this._token) return;
        this._inFlight = null;
        this._noteFailure(error);
      });

    this._inFlight = request;
  }

  /**
   * Hand over a finished plan, once.
   *
   * The engine calls this every frame, so it has to be cheap and it has to
   * clear — a plan taken twice is a plan applied twice.
   */
  take() {
    const plan = this._ready;
    this._ready = null;
    return plan;
  }

  /**
   * Forget everything pending.
   *
   * The token bump is what makes this work against a request already in the
   * air: the promise still resolves, sees a stale token and drops its answer.
   * There is no way to cancel a call that has already reached the model, and
   * pretending otherwise is how a cancelled plan ends up playing anyway.
   */
  discard(why = '') {
    this._token++;
    this._inFlight = null;
    this._ready = null;
    if (why) this.log('info', `Director: ${why}`);
  }

  /**
   * The allowance this call actually cost.
   *
   * The grant is issued before the model runs, so a backend failure still
   * costs the artist (see AIRequestError.quotaSpent) — but a grant the gallery
   * REFUSED costs nothing, and that is the one case that must not be counted.
   */
  _spend(units) {
    this.minutesSpent += units;
    this._lastCallAt = this._inFlightAt;
    this._pendingUnits = 0;
  }

  _noteFailure(error) {
    this._failures++;
    this._nextAllowedAt = this.now()
      + Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** (this._failures - 1));

    if (error instanceof GrantError) {
      // Out of quota or the wrong tier is not a transient fault: say it once
      // and stop asking rather than burning the rest of the set on refusals.
      //
      // Nothing was spent: the gallery refused before a grant was issued. So
      // the minutes are not counted, and the cadence gets its budget back —
      // otherwise an artist who fixes their subscription mid-set would find
      // the director rationing itself against calls that never happened.
      this._pendingUnits = 0;
      this.cadence.refund();
      this.lastError = error.message;
      this.enabled = false;
      this.log('error', `Director stopped: ${error.message}`);
      return;
    }

    // Anything else got past the gallery, so the allowance went with it.
    if (this._pendingUnits) this._spend(this._pendingUnits);

    this.lastError = error instanceof AIRequestError || error instanceof Error
      ? error.message
      : String(error || 'unknown error');

    this.log('warn', `Director call failed (${this._failures}): ${this.lastError}`);
  }

  // --- writing a scenario ------------------------------------------------

  /**
   * Draft a scenario from a brief. Awaited by the panel, never by the engine.
   *
   * @param {string} brief what the set is
   * @param {object} context what the editor has to work with
   * @returns {Promise<{scenario: object, warnings: string[], note: string}>}
   */
  async authorScenario(brief, context = {}) {
    const text = String(brief || '').trim();
    if (!text) throw new Error('Describe the set before asking for a scenario.');

    const { result, warnings } = await this.run(SCENARIO_FEATURE, {
      brief: text,
      scenes: (context.scenes || []).slice(0, 40).map((scene) => ({
        id: String(scene.id),
        name: String(scene.name),
        notes: String(scene.notes || ''),
      })),
      presets: (context.presets || []).slice(0, 40).map((preset) => ({
        id: String(preset.id),
        name: String(preset.name),
      })),
      parameters: (context.parameters || []).slice(0, 60),
      oscAddresses: (context.oscAddresses || []).slice(0, 40),
      audioChannels: context.audioChannels || [],
      bpm: Number(context.bpm) || 120,
    });

    return {
      scenario: normalizeScenario(result?.scenario ?? result),
      warnings: warnings || [],
      note: String(result?.note || ''),
    };
  }

  status() {
    return {
      enabled: this.enabled,
      thinking: Boolean(this._inFlight),
      ready: Boolean(this._ready),
      calls: this.calls,
      minutesSpent: this.minutesSpent,
      failures: this._failures,
      lastError: this.lastError,
      lastNote: this.lastNote,
      steer: this.steer,
      cadence: this.cadence.status(),
      nextAllowedInMs: Math.max(0, this._nextAllowedAt - this.now()),
    };
  }
}

/**
 * What actually goes in the prompt.
 *
 * The engine's state object carries more than the model needs — every
 * signal's four derived readings, the rules object in full. Trimming here
 * rather than in the engine keeps describeState() honest as a debugging view
 * while still sending a prompt that fits.
 */
function compactState(state, listening) {
  const signals = {};
  for (const [name, signal] of Object.entries(state.signals || {})) {
    // A signal nothing has ever sent is noise in the prompt, and worse, it
    // reads as "the bass is at zero" rather than "there is no bass signal".
    if (!signal.seen) continue;
    signals[name] = {
      value: signal.value,
      rise: signal.rise,
      peak: signal.peak,
      average: signal.average,
    };
  }

  return {
    scenario: {
      name: state.scenario.name,
      notes: state.scenario.notes,
      sections: state.scenario.sections,
      cues: state.scenario.cues,
      allowed: {
        sceneChanges: state.scenario.rules.allowSceneChanges,
        presets: state.scenario.rules.allowPresets,
        parameterMoves: state.scenario.rules.allowParameterMoves,
        graphEdits: state.scenario.rules.allowGraphEdits && state.scenario.rules.director.mayEditGraph,
        sectionChanges: state.scenario.rules.director.mayChangeSection,
      },
    },
    now: state.now,
    // What the music has been DOING, which is the half of the picture the
    // signal values cannot carry: they are all "right now" by construction.
    listening: listening || null,
    signals,
    driving: state.driving,
    recent: state.recent,
  };
}

/**
 * Turn an answer into a plan, dropping anything that is not a verb we know.
 *
 * A model that invented an action loses that line, not the whole plan — the
 * same rule normalizeAction() applies to a hand-written scenario, for the same
 * reason: most of a good answer is still worth playing.
 */
function shapePlan(result, askedAtBeats, askedAtSeconds) {
  if (!result || typeof result !== 'object') return null;

  const actions = (Array.isArray(result.actions) ? result.actions : [])
    .slice(0, MAX_PLAN_ACTIONS)
    .map(normalizeAction)
    .filter(Boolean);

  const note = String(result.note || '').slice(0, 300);
  if (!actions.length && !note) return null;

  return { actions, note, askedAtBeats, askedAtSeconds };
}

export default PerformerDirector;
