/**
 * PerformerEngine.js - the thing that actually performs.
 *
 * One tick, called once a frame, does the whole job in a fixed order:
 *
 *   1. advance the clock
 *   2. refresh the signals
 *   3. run standing drives and ramps
 *   4. fire moves that have come due
 *   5. decide whether the section is over
 *   6. release anything the quantiser was holding for this boundary
 *   7. take delivery of whatever the director has finished thinking about
 *
 * The order is not arbitrary. Signals are refreshed before conditions read
 * them, so every decision in a frame sees the same music. Drives run before
 * section changes, so the last frame of a section is still driven rather than
 * frozen. And the director is drained last, at the end of the frame, because
 * its answers are about the NEXT boundary and letting them jump the queue is
 * how a model ends up overriding a cue the musician just fired.
 *
 * ## What makes this safe to run on stage
 *
 * **The hot path is synchronous and allocation-light.** No promises are awaited
 * in a tick. The expensive things — a scene load, a graph edit, a model call —
 * are started and their completion is picked up on a later frame.
 *
 * **The musician always wins.** A cue fired over OSC is applied on the next
 * boundary regardless of what the director has planned, and it clears any plan
 * in the queue. Someone playing live should never have to fight the software
 * for control of their own set.
 *
 * **Nothing runs unbounded.** Every section change is floored by
 * `rules.minSectionBars`, every bar has an action budget, and a condition that
 * throws is disabled after its first failure rather than throwing sixty times
 * a second for the rest of the night.
 */

import { unifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';
import { PerformerClock } from './PerformerClock.js';
import { SignalBus } from './SignalBus.js';
import { ActionExecutor } from './ActionExecutor.js';
import { emptyScenario, normalizeScenario, validateScenario } from './Scenario.js';
import { describeAction } from './actions.js';

/** How many log lines are kept. Enough to read back a set, bounded for a long one. */
const MAX_LOG = 400;

/**
 * The longest a section change will wait for its quantisation grid.
 *
 * Eight bars is about fifteen seconds at club tempo — long enough that every
 * sane grid fits under it, short enough that a misconfigured one is noticed as
 * a slightly late cut rather than as the performer having stopped.
 */
const MAX_QUANTIZE_WAIT_BARS = 8;

/** Engine states, for the panel's transport. */
export const STATE = Object.freeze({
  STOPPED: 'stopped',
  RUNNING: 'running',
  PAUSED: 'paused',
});

export class PerformerEngine {
  /**
   * @param {object} deps
   * @param {object} deps.editor
   * @param {object} [deps.osc] OSCManager
   * @param {object} [deps.audio] the audioAnalysisTaps module
   * @param {object} [deps.vjPanel] VJControlPanel
   * @param {ActionExecutor} [deps.executor]
   * @param {object} [deps.director] PerformerDirector
   */
  constructor(deps = {}) {
    this.editor = deps.editor || null;
    this.director = deps.director || null;

    this.clock = deps.clock || new PerformerClock();
    this.signals = deps.signals || new SignalBus({
      osc: deps.osc || null,
      audio: deps.audio || null,
      clock: this.clock,
    });
    this.executor = deps.executor || new ActionExecutor({
      editor: this.editor,
      vjPanel: deps.vjPanel || null,
      replaceGraph: deps.replaceGraph || null,
      log: (level, message, meta) => this.write(level, message, meta),
    });

    this.scenario = emptyScenario();
    this.validation = { ok: true, errors: [], warnings: [] };

    this.state = STATE.STOPPED;

    /** Index into scenario.sections, or -1 before the first one. */
    this.sectionIndex = -1;
    /** Clock position (in beats) when the current section was entered. */
    this.sectionEnteredBeats = 0;
    this.sectionEnteredSeconds = 0;
    /** Move ids already fired in this visit to this section. */
    this._firedMoves = new Set();

    /**
     * Actions waiting for a musical boundary: { action, atBeats, source }.
     * Kept sorted by nothing — it is drained by comparison, and a set never
     * has enough pending actions for that to matter.
     */
    this.queue = [];

    /** Cues fired since the last tick, oldest first. */
    this._pendingCues = [];
    /** A jump requested out of band (panel button, OSC, a cue's action). */
    this._pendingJump = null;

    /** Conditions that threw, so they are not evaluated again. */
    this._brokenConditions = new Set();

    /** Action budget, reset each bar. */
    this._barSpent = 0;
    this._barAtLastReset = 0;

    this.log = [];
    this._listeners = new Set();

    /** Wall-clock of the last tick, for the panel's "is it alive" readout. */
    this.lastTickAt = 0;
  }

  // --- scenario ----------------------------------------------------------

  /**
   * Load a scenario. Safe while running: the set continues from the section
   * with the same id, which is what makes editing a scenario between sections
   * during a rehearsal possible at all.
   */
  loadScenario(raw, known = {}) {
    const previousId = this.currentSection?.id;

    this.scenario = normalizeScenario(raw);
    this.validation = validateScenario(this.scenario, known);

    this.clock.setBPM(this.scenario.bpm);
    this.clock.setMeter(this.scenario.beatsPerBar, this.scenario.barsPerPhrase);
    this.signals.setScenario(this.scenario);
    this.executor.rules = this.scenario.rules;
    this._brokenConditions.clear();

    if (previousId) {
      const index = this.scenario.sections.findIndex((s) => s.id === previousId);
      // A section that survived the edit keeps its position; one that did not
      // hands over to the first section rather than leaving the index dangling.
      this.sectionIndex = index >= 0 ? index : (this.scenario.sections.length ? 0 : -1);
    }

    this.write('info', `Scenario "${this.scenario.name}" loaded`, {
      sections: this.scenario.sections.length,
      errors: this.validation.errors.length,
      warnings: this.validation.warnings.length,
    });

    for (const problem of this.validation.errors) {
      this.write('error', `${problem.where}: ${problem.message}`);
    }

    this.emit();
    return this.validation;
  }

  get sections() { return this.scenario.sections; }

  get currentSection() {
    return this.sectionIndex >= 0 ? this.scenario.sections[this.sectionIndex] || null : null;
  }

  // --- transport ---------------------------------------------------------

  start() {
    if (this.state === STATE.RUNNING) return false;

    if (this.state === STATE.PAUSED) {
      this.clock.resume();
      this.state = STATE.RUNNING;
      this.write('info', 'Resumed');
      this.emit();
      return true;
    }

    if (!this.scenario.sections.length) {
      this.write('error', 'Nothing to perform: the scenario has no sections.');
      return false;
    }

    this.clock.start();
    this.state = STATE.RUNNING;
    this.queue = [];
    this._pendingCues = [];
    this._pendingJump = null;
    this._barSpent = 0;
    this._barAtLastReset = 0;
    this.sectionIndex = -1;
    this.write('info', `Performing "${this.scenario.name}"`);

    this.enterSection(0, 'start');
    this.emit();
    return true;
  }

  pause() {
    if (this.state !== STATE.RUNNING) return false;
    this.clock.pause();
    this.state = STATE.PAUSED;
    this.write('info', 'Paused');
    this.emit();
    return true;
  }

  /**
   * Stop performing.
   *
   * Standing drives are released, because a drive left in place would hold a
   * parameter at whatever the music last said and the artist would be dragging
   * a slider that snaps back. The output level is deliberately left alone: if
   * the performer faded to 40% for a breakdown, stopping should not slam it
   * back to full in front of an audience.
   */
  stop() {
    if (this.state === STATE.STOPPED) return false;
    this.clock.stop();
    this.state = STATE.STOPPED;
    this.executor.clearDrives();
    this.queue = [];
    this._pendingCues = [];
    this._pendingJump = null;
    this.sectionIndex = -1;
    this.write('info', 'Stopped');
    this.emit();
    return true;
  }

  /**
   * Everything off, now.
   *
   * Not a stop: a stop leaves the output where it was, and the reason to reach
   * for panic is that what is on the output is the problem.
   */
  panic() {
    this.queue = [];
    this._pendingCues = [];
    this._pendingJump = null;
    this.executor.clearDrives();
    this.executor.execute({ type: 'blackout', on: true }, { now: Date.now() });
    this.state = STATE.PAUSED;
    this.clock.pause();
    this.write('warn', 'PANIC — output killed, performance paused');
    this.emit();
    return true;
  }

  // --- input from the musician -------------------------------------------

  /**
   * Fire a cue. Applied on the next boundary of the cue's own quantisation,
   * or immediately when it has none.
   *
   * This is the musician's hand on the set, so it takes precedence over
   * anything the director has queued.
   */
  fireCue(name) {
    if (typeof name !== 'string' || !name) return false;
    this._pendingCues.push(name);
    // A cue is a decision the musician has just made. A plan drafted before it
    // was made is answering a different moment.
    this.dropDirectorPlans('a cue was fired');
    return true;
  }

  /** Jump to a section by id, name or index. */
  jumpToSection(reference, source = 'manual') {
    const index = this.findSection(reference);
    if (index < 0) {
      this.write('error', `No section "${reference}"`);
      return false;
    }
    this._pendingJump = { index, source };
    if (source === 'manual') this.dropDirectorPlans('a section was chosen by hand');
    return true;
  }

  /** Advance to whatever comes next, as if the section had ended on its own. */
  nextSection(source = 'manual') {
    const index = this.resolveNextIndex();
    if (index < 0) return false;
    this._pendingJump = { index, source };
    return true;
  }

  findSection(reference) {
    if (typeof reference === 'number' && Number.isInteger(reference)) {
      return reference >= 0 && reference < this.sections.length ? reference : -1;
    }
    const wanted = String(reference ?? '').toLowerCase();
    if (!wanted) return -1;
    let index = this.sections.findIndex((s) => s.id.toLowerCase() === wanted);
    if (index < 0) index = this.sections.findIndex((s) => s.name.toLowerCase() === wanted);
    return index;
  }

  /** Where the set goes when the current section ends by itself. */
  resolveNextIndex() {
    const section = this.currentSection;
    if (!section) return this.sections.length ? 0 : -1;

    if (section.next) {
      const named = this.findSection(section.next);
      if (named >= 0) return named;
    }

    // Wrapping rather than stopping: a VJ set loops, and a performance that
    // falls off the end of its own scenario is a black screen.
    return this.sections.length ? (this.sectionIndex + 1) % this.sections.length : -1;
  }

  // --- the frame ---------------------------------------------------------

  /**
   * One frame. The only entry point the RAF handler calls.
   * @param {number} [timestamp]
   */
  tick(timestamp) {
    if (this.state !== STATE.RUNNING) return;

    const delta = this.clock.tick(timestamp);
    this.lastTickAt = Date.now();

    this.publishEngineSignals();
    this.signals.update(delta);
    this.executor.tick(delta, this.signals);

    this.resetBarBudgetIfNeeded();

    // Cues and hand-made jumps first: they are the musician, and they decide
    // which section the rest of this frame is even about.
    this.drainCues();
    this.runDueMoves();
    this.checkSectionEnd();
    this.applyPendingJump();
    this.drainQueue();
    this.consultDirector();
  }

  /**
   * Publish what the engine itself knows, so a scenario can write conditions
   * against its own position — `sectionBars > 16` is the one most sets need.
   */
  publishEngineSignals() {
    const section = this.currentSection;
    const bars = this.sectionBars;

    this.signals.setExtra('sectionBars', bars);
    this.signals.setExtra('sectionSeconds', this.clock.seconds - this.sectionEnteredSeconds);

    // How far through its minimum hold the section is, 0-1. A move written
    // against this lands in the same place whatever the tempo.
    const holdBars = section?.hold?.bars;
    this.signals.setExtra('sectionPhase', holdBars > 0 ? Math.min(1, bars / holdBars) : 0);

    this.signals.intensity = section?.intensity ?? this.signals.energy;
  }

  /** Bars since the current section was entered. */
  get sectionBars() {
    return (this.clock.beats - this.sectionEnteredBeats) / this.clock.beatsPerBar;
  }

  get sectionSeconds() {
    return this.clock.seconds - this.sectionEnteredSeconds;
  }

  resetBarBudgetIfNeeded() {
    const bar = this.clock.bar;
    if (bar !== this._barAtLastReset) {
      this._barAtLastReset = bar;
      this._barSpent = 0;
    }
  }

  drainCues() {
    if (!this._pendingCues.length) return;
    const cues = this._pendingCues;
    this._pendingCues = [];

    for (const name of cues) {
      const cue = this.scenario.cues.find((c) => c.name === name);

      // A section can wait on a cue that no cue block declares — the musician
      // fires a name over OSC and a section picks it up. Both paths run: a
      // declared cue does its actions AND releases any section waiting on it.
      let handled = false;

      if (cue) {
        this.write('cue', `Cue "${name}"`);
        this.runActions(cue.do, `cue:${name}`);
        handled = true;
      }

      const waiting = this.sections.findIndex(
        (s) => s.enter.kind === 'cue' && s.enter.cue === name
      );
      if (waiting >= 0 && waiting !== this.sectionIndex) {
        this._pendingJump = { index: waiting, source: `cue:${name}` };
        handled = true;
      }

      if (!handled) this.write('warn', `Cue "${name}" matched nothing`);
    }
  }

  runDueMoves() {
    const section = this.currentSection;
    if (!section || !section.moves.length) return;

    const bars = this.sectionBars;
    const seconds = this.sectionSeconds;

    for (const move of section.moves) {
      if (!move.repeat && this._firedMoves.has(move.id)) continue;

      let due = false;
      if (move.atBars !== null) due = bars >= move.atBars;
      else if (move.atSeconds !== null) due = seconds >= move.atSeconds;

      // A move with both a time and a condition needs both: "eight bars in,
      // if the music is still going" is a thing a scenario wants to say.
      if (move.when) {
        const passes = this.evaluate(move.when, `move:${section.id}:${move.id}`);
        due = (move.atBars === null && move.atSeconds === null) ? passes : (due && passes);
      }

      if (!due) continue;

      this._firedMoves.add(move.id);
      this.runActions(move.do, `move:${move.id}`);
    }
  }

  /**
   * Has this section run its course?
   *
   * Only the NEXT section's entry condition is consulted, not every section's.
   * A scenario is a score read in order; letting any section with a satisfied
   * condition grab control turns it into a rule engine where a late section's
   * `energy > 0.5` fires in the first minute. Cues are the exception, and they
   * are handled above precisely because they are the musician overriding the
   * order on purpose.
   */
  checkSectionEnd() {
    if (this._pendingJump) return;

    const section = this.currentSection;
    if (!section) return;

    // The floor. Nothing — condition, clock or director — cuts a section
    // shorter than the scenario's rule, or shorter than its own hold.
    const bars = this.sectionBars;
    const minBars = Math.max(this.scenario.rules.minSectionBars, section.hold.bars ?? 0);
    if (bars < minBars) return;
    if (section.hold.seconds !== null && this.sectionSeconds < section.hold.seconds) return;

    const nextIndex = this.resolveNextIndex();
    const next = this.sections[nextIndex];
    if (!next || nextIndex === this.sectionIndex) return;

    let ended = false;
    switch (next.enter.kind) {
      case 'bars':
        ended = bars >= next.enter.bars;
        break;
      case 'seconds':
        ended = this.sectionSeconds >= next.enter.seconds;
        break;
      case 'when':
        ended = this.evaluate(next.enter.when, `enter:${next.id}`);
        break;
      case 'manual':
        // Nothing automatic reaches a manual section — except the section
        // before it saying how long it runs. A scenario that writes
        // `hold: {bars: 32}` has stated a length, and the commonest shape in a
        // real set is exactly this: a closing section with `next` pointing
        // back at an opener that was started by hand. Without this a set that
        // loops sits on its last section forever.
        ended = section.hold.bars !== null || section.hold.seconds !== null;
        break;
      // A cue waits to be told, which is the whole point of a cue.
      default:
        ended = false;
    }

    if (ended) this._pendingJump = { index: nextIndex, source: 'scenario' };
  }

  applyPendingJump() {
    const jump = this._pendingJump;
    if (!jump) return;

    const section = this.sections[jump.index];
    if (!section) { this._pendingJump = null; return; }

    // Quantise the change itself. A scene that lands mid-bar is the single
    // most obvious way for visuals to read as "not with the music", so the
    // section's own transition grid decides when the change actually happens.
    const grid = section.transition.quantize;
    const wait = this.clock.secondsUntil(grid);

    // A boundary this far off means the grid is wrong for this moment, not
    // that the change should wait that long — a scenario with a 64-bar phrase
    // would otherwise hold a fired cue for two minutes. Fall back to the next
    // bar, which still lands musically, rather than cutting on the spot.
    const maxWait = this.clock.secondsPerBar * MAX_QUANTIZE_WAIT_BARS;
    let effectiveGrid = grid;
    let effectiveWait = wait;
    if (grid !== 'off' && wait > maxWait) {
      effectiveGrid = 'bar';
      effectiveWait = this.clock.secondsUntil('bar');
      this.write('info', `${section.name}: ${grid} line is ${(wait).toFixed(1)}s away — cutting to the next bar instead`);
    }

    if (effectiveGrid !== 'off' && effectiveWait > 0) {
      // Hold it as a queued section change rather than re-deciding next frame:
      // the condition that released it may have stopped being true by the time
      // the boundary arrives, and a change already decided should still land.
      this.queue.push({
        action: { type: 'section', to: section.id, why: jump.source },
        atBeats: this.clock.nextBoundaryBeats(effectiveGrid),
        source: jump.source,
      });
      this._pendingJump = null;
      return;
    }

    this._pendingJump = null;
    this.enterSection(jump.index, jump.source);
  }

  /**
   * Take up a section: tear down the last one, apply the look, start the
   * drives.
   */
  enterSection(index, source = 'scenario') {
    const previous = this.currentSection;
    if (previous) this.runActions(previous.onExit, `exit:${previous.id}`);

    // Drives belong to the section that declared them. Releasing them here —
    // before the new look loads — is what stops a drive writing into a node
    // id that the incoming scene happens to reuse for something else.
    this.executor.clearDrives();

    this.sectionIndex = index;
    this.sectionEnteredBeats = this.clock.beats;
    this.sectionEnteredSeconds = this.clock.seconds;
    this._firedMoves.clear();

    const section = this.currentSection;
    if (!section) return;

    this.write('section', `→ ${section.name}`, { source, bar: this.clock.bar });

    // The look first, so onEnter actions and drives are working against the
    // patch the section is actually about.
    if (section.look.kind === 'scene') {
      this.dispatch({
        type: 'scene',
        scene: section.look.scene,
        transition: section.transition.type,
        duration: section.transition.duration,
        why: `section ${section.id}`,
      }, `section:${section.id}`);
    } else if (section.look.kind === 'preset') {
      this.dispatch({
        type: 'preset',
        preset: section.look.preset,
        overSeconds: section.transition.duration,
        why: `section ${section.id}`,
      }, `section:${section.id}`);
    } else if (section.look.kind === 'patch') {
      this.dispatch({
        type: 'graph',
        patch: section.look.patch,
        reason: `section ${section.id}`,
      }, `section:${section.id}`);
    }

    for (const drive of section.drives) {
      this.dispatch({ ...drive, type: 'drive' }, `section:${section.id}`);
    }

    this.runActions(section.onEnter, `enter:${section.id}`);

    // The director plans a section ahead, so a section change is when it wants
    // asking. Doing it here rather than on a bar count means it is thinking
    // about the section that just started, with its first frame of signal.
    this.director?.onSectionChange?.(this.describeState());

    this.emit();
  }

  // --- running actions ---------------------------------------------------

  runActions(actions, source) {
    if (!actions?.length) return;
    for (const action of actions) this.dispatch(action, source);
  }

  /**
   * Put one action where it belongs: straight through, or in the queue until
   * its boundary.
   */
  dispatch(action, source = 'scenario') {
    if (!action) return;

    const grid = action.quantize;
    if (grid && grid !== 'off') {
      const wait = this.clock.secondsUntil(grid);
      if (wait > 0) {
        this.queue.push({ action, atBeats: this.clock.nextBoundaryBeats(grid), source });
        return;
      }
    }

    this.perform(action, source);
  }

  /**
   * Actually do it, budget permitting.
   *
   * The budget is the backstop against a scenario or a plan that asks for more
   * than a frame's worth of work — a section jump loop, a director that
   * returned forty actions. It is per bar rather than per frame because the
   * things it guards (scene loads, graph edits) are measured in bars.
   */
  perform(action, source = 'scenario') {
    if (action.type === 'section') {
      const index = this.findSection(action.to);
      if (index < 0) { this.write('error', `No section "${action.to}"`); return; }
      if (index !== this.sectionIndex) this.enterSection(index, source);
      return;
    }

    if (action.type === 'cue') {
      this.fireCue(action.name);
      return;
    }

    const cost = this._barSpent;
    if (cost >= this.scenario.rules.maxActionsPerBar) {
      this.write('warn', `Budget spent for this bar — dropped ${describeAction(action)}`, { source });
      return;
    }

    const result = this.executor.execute(action, {
      now: Date.now(),
      secondsPerBar: this.clock.secondsPerBar,
    });

    this._barSpent += result.cost;

    if (result.ok) {
      this.write('action', describeAction(action), { source, detail: result.detail, why: action.why });
    } else {
      this.write('warn', `Skipped ${describeAction(action)}: ${result.reason}`, { source });
    }
  }

  /** Release everything the quantiser was holding for a boundary now passed. */
  drainQueue() {
    if (!this.queue.length) return;

    const beats = this.clock.beats;
    const due = [];
    const waiting = [];

    for (const entry of this.queue) {
      (beats >= entry.atBeats ? due : waiting).push(entry);
    }
    this.queue = waiting;

    for (const entry of due) this.perform(entry.action, entry.source);
  }

  // --- the director ------------------------------------------------------

  /**
   * Ask the model, if it is time and it is not already thinking.
   *
   * Everything about the timing is the director's business, not the engine's —
   * this only offers it the state and takes delivery of whatever is ready. The
   * split is what keeps a network call out of the frame loop: the director
   * returns immediately either way.
   */
  consultDirector() {
    const director = this.director;
    if (!director || !this.scenario.rules.director.enabled) return;

    director.offer?.(this.describeState());

    const plan = director.take?.();
    if (!plan) return;

    this.applyPlan(plan);
  }

  /**
   * Take a plan from the model.
   *
   * A plan is a list of actions and, optionally, a section to go to next. It
   * is checked the same way a scenario's own actions are — the rules do not
   * care where an action came from — plus one check of its own: whether the
   * moment it was written for has passed.
   */
  applyPlan(plan) {
    const rules = this.scenario.rules.director;

    const agedBars = (this.clock.beats - (plan.askedAtBeats ?? this.clock.beats))
      / this.clock.beatsPerBar;
    if (agedBars > rules.staleAfterBars) {
      this.write('warn', `Director plan arrived ${agedBars.toFixed(1)} bars late — dropped`, {
        note: plan.note,
      });
      return;
    }

    if (plan.note) this.write('director', plan.note);

    for (const action of plan.actions || []) {
      if (action.type === 'section' && !rules.mayChangeSection) {
        this.write('warn', 'Director wanted a section change; rules.director.mayChangeSection is off');
        continue;
      }
      if (action.type === 'graph' && !rules.mayEditGraph) {
        this.write('warn', 'Director wanted a patch change; rules.director.mayEditGraph is off');
        continue;
      }
      // Director actions are quantised to the bar unless they asked otherwise,
      // so an improvisation lands with the music like everything else.
      this.dispatch({ ...action, quantize: action.quantize || 'bar' }, 'director');
    }
  }

  /** Throw away anything the director has queued or is about to deliver. */
  dropDirectorPlans(why) {
    const before = this.queue.length;
    this.queue = this.queue.filter((entry) => entry.source !== 'director');
    this.director?.discard?.(why);
    if (this.queue.length !== before) {
      this.write('info', `Dropped ${before - this.queue.length} queued director action(s): ${why}`);
    }
  }

  /**
   * The performance, as the model is shown it.
   *
   * Compact on purpose: this is built every frame the director is offered, and
   * it is also what goes into a prompt. Everything in it is a fact about right
   * now — nothing is summarised, because a summary written here is a summary
   * the model cannot check.
   */
  describeState() {
    const section = this.currentSection;

    return {
      scenario: {
        name: this.scenario.name,
        notes: this.scenario.notes,
        sections: this.scenario.sections.map((s) => ({
          id: s.id,
          name: s.name,
          intensity: s.intensity,
          mood: s.mood,
          notes: s.notes,
          look: s.look.kind === 'scene' ? s.look.scene
            : s.look.kind === 'preset' ? s.look.preset : s.look.kind,
        })),
        cues: this.scenario.cues.map((c) => c.name),
        rules: this.scenario.rules,
      },
      now: {
        state: this.state,
        sectionId: section?.id || null,
        sectionName: section?.name || null,
        sectionBars: round(this.sectionBars),
        bar: this.clock.bar,
        phrase: this.clock.phrase,
        bpm: this.clock.bpm,
        beatsPerBar: this.clock.beatsPerBar,
        energy: round(this.signals.energy),
        intensity: round(this.signals.intensity),
      },
      signals: this.signals.snapshot(),
      driving: this.executor.status().drives,
      recent: this.log.slice(-12).map((entry) => ({
        at: entry.bar,
        level: entry.level,
        message: entry.message,
      })),
      askedAtBeats: this.clock.beats,
    };
  }

  // --- conditions --------------------------------------------------------

  /**
   * Evaluate a scenario condition against the current signals.
   *
   * Through the editor's own expression system: an AST interpreter, never
   * eval, for the same reason parameter expressions are (ARCHITECTURE.md §5)
   * — a scenario is a document that arrives from other people's machines.
   *
   * A condition that throws is retired. At sixty frames a second a bad
   * identifier would otherwise fill the log faster than anyone can read it,
   * and the answer would be the same every time.
   */
  evaluate(expression, key) {
    if (!expression) return false;
    if (this._brokenConditions.has(key)) return false;

    try {
      const value = unifiedExpressionSystem.evaluateCPUOrThrow(expression, this.signals.scope());
      return Number.isFinite(value) ? value > 0.5 : false;
    } catch (error) {
      this._brokenConditions.add(key);
      this.write('error', `Condition "${expression}" is broken and will not be checked again: ${error?.message || error}`);
      return false;
    }
  }

  // --- log and listeners -------------------------------------------------

  write(level, message, meta = {}) {
    const entry = {
      at: Date.now(),
      bar: this.clock.bar,
      beat: round(this.clock.beats),
      level,
      message,
      ...meta,
    };
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    this.emit('log', entry);
    return entry;
  }

  /** Subscribe to engine changes. Returns an unsubscribe. */
  on(listener) {
    if (typeof listener !== 'function') return () => {};
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  emit(kind = 'state', payload = null) {
    for (const listener of this._listeners) {
      try {
        listener(kind, payload, this);
      } catch {
        // A panel that throws while repainting must not stop the performance.
      }
    }
  }

  /** Everything the panel draws. */
  status() {
    const section = this.currentSection;
    return {
      state: this.state,
      scenarioName: this.scenario.name,
      sectionIndex: this.sectionIndex,
      sectionId: section?.id || null,
      sectionName: section?.name || null,
      sectionBars: round(this.sectionBars),
      holdBars: section?.hold?.bars ?? null,
      clock: this.clock.snapshot(),
      signals: this.signals.snapshot(),
      energy: round(this.signals.energy),
      queued: this.queue.length,
      executor: this.executor.status(),
      director: this.director?.status?.() || null,
      validation: this.validation,
      lastTickAt: this.lastTickAt,
    };
  }

  destroy() {
    this.stop();
    this._listeners.clear();
  }
}

const round = (value) => Math.round(value * 1000) / 1000;

export default PerformerEngine;
