/**
 * Scenario.js - the score the AI performer plays.
 *
 * A scenario is the one document a performance is written in. It says what the
 * musician is sending, what the set is made of, and what the performer is
 * allowed to do with it:
 *
 *   signals   named live values - an OSC address, an audio band, the clock
 *   sections  the set, in order: what each one looks like and when it ends
 *   cues      named moments the musician fires by hand, out of order
 *   rules     the fence: what the performer may touch and how often
 *
 * It is deliberately a plain object. It is written by hand in the panel, saved
 * next to a patch, drafted by the model (ai.performer_scenario), and read back
 * by a model mid-set - four writers, so the format has to survive all four
 * being sloppy. That is what normalizeScenario() is: every field optional,
 * every value coerced, nothing thrown. validateScenario() is the separate,
 * strict pass that reports what a human should fix, and it reports ALL of it
 * rather than the first problem, because a scenario is usually fixed at a
 * desk hours before it is played and a one-error-at-a-time loop wastes that.
 *
 * The split matters at showtime: a scenario with warnings still runs. A set
 * that stops because section 9 names a scene that was renamed is a set that
 * stops in front of an audience, so a bad reference is an inert section and a
 * warning, never a refusal to start.
 */

import { ACTION_TYPES, normalizeAction, validateAction } from './actions.js';

/** The format version this build writes. Readers accept anything <= this. */
export const SCENARIO_VERSION = 1;

/** Where a signal can come from. */
export const SIGNAL_SOURCES = Object.freeze(['osc', 'audio', 'clock', 'manual']);

/** How a section decides it is over. */
export const ENTER_KINDS = Object.freeze(['cue', 'bars', 'seconds', 'when', 'manual']);

/** Response curves, matching ExternalParameterControl.mapNormalizedValue. */
export const CURVES = Object.freeze(['linear', 'exponential', 'logarithmic']);

/** Transition types, matching TransitionManager.TRANSITIONS. */
export const TRANSITION_TYPES = Object.freeze(['crossfade', 'cut', 'fade_black', 'fade_white']);

/** What an action can be quantised to. */
export const QUANTIZE_GRID = Object.freeze(['off', 'beat', 'half', 'bar', 'phrase']);

/**
 * Ceilings, so one bad scenario cannot make the engine the slow part of a
 * frame. A set with more than this in it is not a set, it is a mistake.
 */
export const LIMITS = Object.freeze({
  signals: 64,
  sections: 128,
  cues: 64,
  drivesPerSection: 32,
  movesPerSection: 32,
  actionsPerList: 32,
});

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const str = (value, fallback = '') => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
};

const pick = (value, allowed, fallback) =>
  allowed.includes(value) ? value : fallback;

const arr = (value) => (Array.isArray(value) ? value : []);

/**
 * A stable id from a name, for the common case of a scenario written by hand
 * where sections have names and nobody wanted to invent ids too.
 */
function slugify(value, index, prefix) {
  const base = str(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `${prefix}${index + 1}`;
}

/** Make every id in a list unique without renaming the first one that claimed it. */
function uniqueIds(items) {
  const seen = new Set();
  for (const item of items) {
    let id = item.id;
    let n = 2;
    while (seen.has(id)) id = `${item.id}-${n++}`;
    item.id = id;
    seen.add(id);
  }
  return items;
}

// --------------------------------------------------------------------------
// Signals
// --------------------------------------------------------------------------

/**
 * One named live value.
 *
 * `smooth` is a time constant in seconds, not a coefficient: a smoothing
 * factor is frame-rate dependent and a performance that ran differently on a
 * laptop than on the rig is not a performance anyone can rehearse. SignalBus
 * converts it per frame from the real delta.
 *
 * `inputMin`/`inputMax` are the range the SENDER emits, exactly as in the OSC
 * receiver - the signal is published normalised to 0-1 so a scenario written
 * against a 0-1 fader still works when the sender turns out to send 0-127.
 */
export function normalizeSignal(raw, index = 0) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const source = pick(str(input.source, 'osc'), SIGNAL_SOURCES, 'osc');

  const signal = {
    name: slugify(input.name ?? input.id, index, 'signal'),
    source,
    label: str(input.label) || str(input.name) || '',
    // The range the sender emits. Inverted or zero-width ranges are repaired
    // rather than refused: a divide by zero here is a NaN in a uniform.
    inputMin: num(input.inputMin, 0),
    inputMax: num(input.inputMax, 1),
    smooth: clamp(num(input.smooth, 0), 0, 10),
    // Attack/release asymmetry, so a level signal can snap up and fall slowly
    // the way a VU meter does. Absent means symmetric (`smooth` both ways).
    attack: input.attack === undefined ? null : clamp(num(input.attack, 0), 0, 10),
    release: input.release === undefined ? null : clamp(num(input.release, 0), 0, 10),
    invert: Boolean(input.invert),
    curve: pick(str(input.curve, 'linear'), CURVES, 'linear'),
  };

  if (signal.inputMax === signal.inputMin) signal.inputMax = signal.inputMin + 1;

  if (source === 'osc') {
    signal.address = str(input.address);
    signal.arg = Math.max(0, Math.trunc(num(input.arg, 0)));
  } else if (source === 'audio') {
    signal.channel = str(input.channel, 'level');
  } else if (source === 'clock') {
    // 'beatPhase' | 'barPhase' | 'phrasePhase' | 'beat' | 'bar' | 'bpm'
    signal.channel = str(input.channel, 'barPhase');
  } else if (source === 'manual') {
    signal.default = clamp(num(input.default, 0), 0, 1);
  }

  return signal;
}

// --------------------------------------------------------------------------
// Sections
// --------------------------------------------------------------------------

/**
 * When a section takes over.
 *
 * Four kinds, and the difference is who is in charge:
 *
 *   { cue: 'drop' }     the musician, by hand, over OSC
 *   { bars: 32 }        the clock, once the previous section has run that long
 *   { seconds: 45 }     the clock, for a set that is not on a grid
 *   { when: 'energy > 0.7' }  the music itself
 *   'manual'            nothing: only a jump reaches it
 *
 * A section with none of these is `manual`, which is the safe reading: an
 * entry condition that was meant to be written and was not should leave the
 * section sitting there, not fire it at bar zero.
 */
export function normalizeEnter(raw) {
  if (raw === undefined || raw === null) return { kind: 'manual' };
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === 'manual') return { kind: 'manual' };
    // A bare string is a cue name - the shorthand a hand-written scenario
    // reaches for first.
    return { kind: 'cue', cue: trimmed };
  }
  if (typeof raw === 'number') return { kind: 'bars', bars: Math.max(0, num(raw, 0)) };
  if (typeof raw !== 'object') return { kind: 'manual' };

  if (raw.cue !== undefined) return { kind: 'cue', cue: str(raw.cue) };
  if (raw.bars !== undefined) return { kind: 'bars', bars: Math.max(0, num(raw.bars, 0)) };
  if (raw.seconds !== undefined) return { kind: 'seconds', seconds: Math.max(0, num(raw.seconds, 0)) };
  if (raw.when !== undefined) return { kind: 'when', when: str(raw.when) };
  if (raw.kind !== undefined) {
    const kind = pick(str(raw.kind), ENTER_KINDS, 'manual');
    return normalizeEnter(kind === 'manual' ? null : { [kind]: raw[kind] ?? raw.value });
  }
  return { kind: 'manual' };
}

/** What a section looks like: an existing scene, a preset, or a literal patch. */
function normalizeLook(raw) {
  if (!raw || typeof raw !== 'object') {
    // A string is a scene id or name - again the hand-written shorthand.
    const name = str(raw);
    return name ? { kind: 'scene', scene: name } : { kind: 'none' };
  }
  if (raw.scene !== undefined) return { kind: 'scene', scene: str(raw.scene) };
  if (raw.preset !== undefined) return { kind: 'preset', preset: str(raw.preset) };
  if (raw.patch && typeof raw.patch === 'object') return { kind: 'patch', patch: raw.patch };
  return { kind: 'none' };
}

function normalizeTransition(raw, fallback) {
  const base = fallback || { type: 'crossfade', duration: 1, quantize: 'bar' };
  if (!raw || typeof raw !== 'object') {
    if (typeof raw === 'string') return { ...base, type: pick(raw, TRANSITION_TYPES, base.type) };
    return { ...base };
  }
  return {
    type: pick(str(raw.type, base.type), TRANSITION_TYPES, base.type),
    duration: clamp(num(raw.duration, base.duration), 0, 60),
    quantize: pick(str(raw.quantize, base.quantize), QUANTIZE_GRID, base.quantize),
  };
}

/**
 * A standing map from a signal to a parameter, live for as long as the section
 * is. This is the performer's equivalent of an OSC binding, and the reason it
 * is not one: a binding outlives the patch it was made against, while a drive
 * is torn down the moment the section ends, so a drive on a node the next
 * section does not have simply stops rather than writing into a stale id.
 */
export function normalizeDrive(raw, index = 0) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    id: str(input.id) || `drive${index + 1}`,
    signal: slugify(input.signal, index, 'signal'),
    // Node is matched by id first, then by name, then by kind - see
    // ActionExecutor.resolveNode. A scenario written against last week's patch
    // should still find "the Warp node".
    node: str(input.node ?? input.nodeId),
    param: str(input.param ?? input.parameter),
    min: num(input.min, 0),
    max: num(input.max, 1),
    curve: pick(str(input.curve, 'linear'), CURVES, 'linear'),
    invert: Boolean(input.invert),
    // Extra smoothing on top of the signal's own, for a parameter that wants
    // to lag the music rather than sit on it.
    smooth: clamp(num(input.smooth, 0), 0, 10),
  };
}

/** A timed move inside a section: do this, this far in. */
function normalizeMove(raw, index = 0) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const at = input.at && typeof input.at === 'object' ? input.at : {};
  const bars = input.atBars ?? at.bars;
  const seconds = input.atSeconds ?? at.seconds;

  return {
    id: str(input.id) || `move${index + 1}`,
    // Bars win when both are given: a set on a grid is written in bars.
    atBars: bars === undefined ? null : Math.max(0, num(bars, 0)),
    atSeconds: seconds === undefined ? null : Math.max(0, num(seconds, 0)),
    when: str(input.when),
    // A move fires once per visit to its section unless it says otherwise.
    repeat: Boolean(input.repeat),
    do: normalizeActionList(input.do ?? input.actions),
  };
}

export function normalizeActionList(raw) {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.slice(0, LIMITS.actionsPerList).map(normalizeAction).filter(Boolean);
}

export function normalizeSection(raw, index = 0) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const name = str(input.name) || str(input.id) || `Section ${index + 1}`;

  return {
    id: slugify(input.id ?? input.name, index, 'section'),
    name,
    enter: normalizeEnter(input.enter),
    // The floor on how long this section stays up once entered. It is what
    // stops a `when` condition that is true at the boundary from strobing
    // between two sections, and it is checked before every exit including a
    // director's.
    hold: {
      bars: input.hold?.bars === undefined ? null : Math.max(0, num(input.hold.bars, 0)),
      seconds: input.hold?.seconds === undefined ? null : Math.max(0, num(input.hold.seconds, 0)),
    },
    look: normalizeLook(input.look ?? input.scene),
    transition: normalizeTransition(input.transition),
    drives: arr(input.drives).slice(0, LIMITS.drivesPerSection).map(normalizeDrive),
    moves: arr(input.moves).slice(0, LIMITS.movesPerSection).map(normalizeMove),
    onEnter: normalizeActionList(input.onEnter),
    onExit: normalizeActionList(input.onExit),
    // Where to go when nothing else says. Empty means the next in the list.
    next: str(input.next),
    // Director hints. These are never executed - they are what the model is
    // told about the section when it is asked to improvise inside it.
    intensity: input.intensity === undefined ? null : clamp(num(input.intensity, 0.5), 0, 1),
    mood: str(input.mood),
    notes: str(input.notes),
  };
}

function normalizeCue(raw, index = 0) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    name: slugify(input.name ?? input.id ?? raw, index, 'cue'),
    label: str(input.label) || str(input.name) || '',
    do: normalizeActionList(input.do ?? input.actions),
  };
}

// --------------------------------------------------------------------------
// Rules
// --------------------------------------------------------------------------

/**
 * The fence.
 *
 * Everything here is a ceiling rather than a switch wherever it can be, because
 * the failure this guards against is not the performer doing the wrong thing
 * once - it is the performer doing the right thing forty times a second. A
 * scene change per frame is a black screen; a graph edit per bar is a
 * recompile stutter through the whole set.
 */
export function normalizeRules(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const director = input.director && typeof input.director === 'object' ? input.director : {};

  return {
    // Nothing may cut a section shorter than this, including the director.
    minSectionBars: clamp(num(input.minSectionBars, 4), 0, 256),
    // A ceiling on scene loads, which are the expensive action: importing a
    // project rebuilds the graph and recompiles the shader.
    minSceneChangeSeconds: clamp(num(input.minSceneChangeSeconds, 4), 0, 600),
    maxActionsPerBar: clamp(Math.trunc(num(input.maxActionsPerBar, 12)), 1, 200),

    allowSceneChanges: input.allowSceneChanges !== false,
    allowPresets: input.allowPresets !== false,
    allowParameterMoves: input.allowParameterMoves !== false,
    // Off by default, and the only one that is: a graph edit recompiles the
    // shader, which can drop frames on stage. A scenario that wants it says so.
    allowGraphEdits: Boolean(input.allowGraphEdits),
    minGraphEditSeconds: clamp(num(input.minGraphEditSeconds, 30), 0, 3600),

    // The master fader can be moved but never above this, so a performer
    // cannot undo a house limit set before doors.
    masterCeiling: clamp(num(input.masterCeiling, 1), 0, 1),
    // ...nor below this, which is what stops an over-eager fade reading as a
    // dead output. Panic is the deliberate exception and ignores it.
    masterFloor: clamp(num(input.masterFloor, 0), 0, 1),

    director: {
      enabled: director.enabled !== false,
      // How often the model is asked, in bars. It runs ahead of the music, so
      // this is a planning cadence rather than a reaction time.
      everyBars: clamp(Math.trunc(num(director.everyBars, 16)), 1, 256),
      // 0 = play the scenario as written, 1 = treat it as a starting point.
      freedom: clamp(num(director.freedom, 0.4), 0, 1),
      // A plan that arrives more than this long after it was asked for is
      // answering a moment that has passed. Dropped rather than played.
      staleAfterBars: clamp(num(director.staleAfterBars, 8), 1, 64),
      // What the director may do, narrowed from the rules above.
      mayChangeSection: director.mayChangeSection !== false,
      mayEditGraph: Boolean(director.mayEditGraph),
    },
  };
}

// --------------------------------------------------------------------------
// The document
// --------------------------------------------------------------------------

/**
 * Coerce anything into a runnable scenario. Never throws.
 *
 * @param {object|string} raw a scenario object, or JSON text
 * @returns {object} a complete, normalised scenario
 */
export function normalizeScenario(raw) {
  let input = raw;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      input = null;
    }
  }
  if (!input || typeof input !== 'object') input = {};

  const sections = uniqueIds(
    arr(input.sections).slice(0, LIMITS.sections).map(normalizeSection)
  );
  const signals = arr(input.signals).slice(0, LIMITS.signals).map(normalizeSignal);
  const cues = arr(input.cues).slice(0, LIMITS.cues).map(normalizeCue);

  // Signal names are the identifiers conditions are written against, so a
  // duplicate is a silent shadow rather than an error. Last one loses.
  const seenSignals = new Set();
  const dedupedSignals = signals.filter((signal) => {
    if (seenSignals.has(signal.name)) return false;
    seenSignals.add(signal.name);
    return true;
  });

  return {
    version: Math.min(SCENARIO_VERSION, Math.max(1, Math.trunc(num(input.version, SCENARIO_VERSION)))),
    name: str(input.name, 'Untitled set'),
    notes: str(input.notes),
    bpm: clamp(num(input.bpm, 120), 20, 300),
    beatsPerBar: clamp(Math.trunc(num(input.beatsPerBar, 4)), 1, 16),
    // A phrase is how many bars the performer treats as one musical unit. It
    // is what 'phrase' quantisation lands on, and what the director plans in.
    barsPerPhrase: clamp(Math.trunc(num(input.barsPerPhrase, 8)), 1, 64),
    signals: dedupedSignals,
    sections,
    cues,
    rules: normalizeRules(input.rules),
  };
}

/**
 * Report everything wrong with a scenario, without changing it.
 *
 * Errors are things that would make a section do nothing at all; warnings are
 * things that will probably surprise the artist. Neither stops a set: the
 * engine skips what it cannot run and says so in the log.
 *
 * @param {object} scenario a NORMALISED scenario
 * @param {{sceneIds?: string[], presetIds?: string[], nodeIds?: string[]}} [known]
 *        what actually exists right now, when the caller can say. Reference
 *        checks are skipped for anything not passed - a scenario written
 *        before its scenes were loaded is not wrong yet.
 * @returns {{ok: boolean, errors: Array, warnings: Array}}
 */
export function validateScenario(scenario, known = {}) {
  const errors = [];
  const warnings = [];
  const at = (where, message) => ({ where, message });

  if (!scenario || typeof scenario !== 'object') {
    return { ok: false, errors: [at('scenario', 'Not a scenario object.')], warnings };
  }

  if (!scenario.sections.length) {
    errors.push(at('sections', 'A scenario needs at least one section.'));
  }

  const signalNames = new Set(scenario.signals.map((s) => s.name));
  // The clock signals every scenario can name without declaring them.
  for (const builtin of BUILTIN_SIGNALS) signalNames.add(builtin);

  for (const signal of scenario.signals) {
    if (signal.source === 'osc' && !signal.address) {
      errors.push(at(`signal "${signal.name}"`, 'An OSC signal needs an address, e.g. /live/energy.'));
    }
    if (signal.source === 'osc' && signal.address && !signal.address.startsWith('/')) {
      warnings.push(at(`signal "${signal.name}"`, `OSC addresses start with "/" — got "${signal.address}".`));
    }
  }

  const sectionIds = new Set(scenario.sections.map((s) => s.id));
  const cueNames = new Set(scenario.cues.map((c) => c.name));

  const checkActions = (list, where) => {
    for (const action of list) {
      const problem = validateAction(action, { sectionIds, cueNames, known, rules: scenario.rules });
      if (problem) (problem.severity === 'warning' ? warnings : errors).push(at(where, problem.message));
    }
  };

  for (const section of scenario.sections) {
    const where = `section "${section.name}"`;

    if (section.enter.kind === 'cue' && !cueNames.has(section.enter.cue)) {
      // Not an error: a cue fired over OSC does not have to be declared, and a
      // scenario that lists only the ones with actions attached is normal.
      warnings.push(at(where, `Waits for cue "${section.enter.cue}", which no cue in this scenario declares. Firing it over OSC still works.`));
    }
    if (section.enter.kind === 'when') {
      const problem = checkCondition(section.enter.when, signalNames);
      if (problem) errors.push(at(where, `Entry condition: ${problem}`));
    }

    if (section.next && !sectionIds.has(section.next)) {
      errors.push(at(where, `"next" names section "${section.next}", which does not exist.`));
    }

    if (section.look.kind === 'scene' && Array.isArray(known.sceneIds)
        && !known.sceneIds.includes(section.look.scene)) {
      warnings.push(at(where, `Scene "${section.look.scene}" is not loaded. The section will run without changing the look.`));
    }
    if (section.look.kind === 'preset' && Array.isArray(known.presetIds)
        && !known.presetIds.includes(section.look.preset)) {
      warnings.push(at(where, `Preset "${section.look.preset}" does not exist. The section will run without applying it.`));
    }

    for (const drive of section.drives) {
      if (!signalNames.has(drive.signal)) {
        errors.push(at(where, `Drive reads signal "${drive.signal}", which is not declared.`));
      }
      if (!drive.node || !drive.param) {
        errors.push(at(where, 'A drive needs both a node and a parameter.'));
      }
      if (drive.min === drive.max) {
        warnings.push(at(where, `Drive on ${drive.node}.${drive.param} has min === max, so it will hold still.`));
      }
    }

    for (const move of section.moves) {
      if (move.atBars === null && move.atSeconds === null && !move.when) {
        errors.push(at(where, `Move "${move.id}" has no time and no condition, so it can never fire.`));
      }
      if (move.when) {
        const problem = checkCondition(move.when, signalNames);
        if (problem) errors.push(at(where, `Move "${move.id}": ${problem}`));
      }
      checkActions(move.do, where);
    }

    checkActions(section.onEnter, where);
    checkActions(section.onExit, where);
  }

  for (const cue of scenario.cues) {
    checkActions(cue.do, `cue "${cue.name}"`);
  }

  // A set nothing can start is the one configuration worth calling an error:
  // every section waiting on something means the performer sits dark.
  const reachable = scenario.sections.some(
    (s) => s.enter.kind !== 'manual' || s === scenario.sections[0]
  );
  if (scenario.sections.length && !reachable) {
    warnings.push(at('sections', 'Every section is manual. The set will start on the first one and go nowhere on its own.'));
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Signals every scenario has without declaring them, published by the clock.
 * Named here rather than in SignalBus so validation can see them without
 * standing one up.
 */
export const BUILTIN_SIGNALS = Object.freeze([
  'beatPhase', 'barPhase', 'phrasePhase', 'beat', 'bar', 'phrase', 'bpm',
  'sectionBars', 'sectionPhase', 'energy', 'intensity',
]);

/**
 * Parse-check a condition without evaluating it.
 *
 * Conditions go through the editor's own expression system (an AST
 * interpreter - never eval; see ARCHITECTURE.md §5), so this is the same
 * parser that will run at showtime. Catching a typo here is the difference
 * between a section that never fires and a soundcheck that says why.
 *
 * @returns {string|null} the problem, or null
 */
export function checkCondition(expression, signalNames) {
  const text = str(expression).trim();
  if (!text) return 'empty condition';

  for (const identifier of identifiersIn(text)) {
    if (!signalNames.has(identifier)) {
      return `"${identifier}" is not a signal. Declare it, or use one of: ${[...signalNames].slice(0, 8).join(', ')}…`;
    }
  }
  return null;
}

/**
 * Identifiers a condition reads, minus the things the expression system
 * provides itself. Used for the check above and for telling the director which
 * signals a section actually listens to.
 */
export function identifiersIn(expression) {
  const KNOWN = new Set([
    'PI', 'E', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt',
    'abs', 'pow', 'exp', 'log', 'log2', 'floor', 'ceil', 'round', 'min', 'max',
    'sign', 'clamp', 'lerp', 'map', 'smoothstep', 'step', 'fract', 'mod',
    'length', 'distance', 'normalize', 'dot',
  ]);
  const found = new Set();
  for (const match of str(expression).matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    if (!KNOWN.has(match[0])) found.add(match[0]);
  }
  return found;
}

/** A scenario with nothing in it, for a panel opened before anything is written. */
export function emptyScenario() {
  return normalizeScenario({
    name: 'Untitled set',
    sections: [{ name: 'Opening', enter: 'manual' }],
  });
}

/**
 * A worked example, shown in the panel and handed to the model as the shape to
 * answer in. It is a real set: OSC from the musician, two audio bands, four
 * sections on a cue-and-clock mix, and a drop the musician fires by hand.
 */
export const EXAMPLE_SCENARIO = Object.freeze({
  version: SCENARIO_VERSION,
  name: 'Example: four-section live set',
  bpm: 128,
  beatsPerBar: 4,
  barsPerPhrase: 8,
  signals: [
    { name: 'energy', source: 'osc', address: '/rhizo/perf/energy', smooth: 0.4 },
    { name: 'filter', source: 'osc', address: '/live/filter', inputMin: 0, inputMax: 127, smooth: 0.1 },
    { name: 'bass', source: 'audio', channel: 'low', attack: 0.01, release: 0.25 },
    { name: 'kick', source: 'audio', channel: 'kickTrig' },
  ],
  sections: [
    {
      id: 'intro',
      name: 'Intro',
      enter: 'manual',
      hold: { bars: 16 },
      look: { scene: 'intro-scene' },
      transition: { type: 'fade_black', duration: 2, quantize: 'bar' },
      drives: [
        { signal: 'bass', node: 'Warp', param: 'amount', min: 0, max: 0.4, curve: 'exponential' },
      ],
      next: 'build',
      intensity: 0.2,
      mood: 'dark, wide, barely moving',
    },
    {
      id: 'build',
      name: 'Build',
      enter: { when: 'energy > 0.45' },
      hold: { bars: 8 },
      look: { scene: 'build-scene' },
      transition: { type: 'crossfade', duration: 1, quantize: 'phrase' },
      moves: [
        { at: { bars: 8 }, do: [{ type: 'param', node: 'Warp', param: 'speed', to: 1.6, overBars: 8 }] },
      ],
      drives: [
        { signal: 'filter', node: 'Blur', param: 'radius', min: 0, max: 12 },
      ],
      next: 'drop',
      intensity: 0.6,
    },
    {
      id: 'drop',
      name: 'Drop',
      enter: { cue: 'drop' },
      hold: { bars: 32 },
      look: { scene: 'drop-scene' },
      transition: { type: 'cut', duration: 0, quantize: 'beat' },
      onEnter: [{ type: 'master', to: 1, overSeconds: 0.2 }],
      drives: [
        { signal: 'kick', node: 'Scale', param: 'amount', min: 1, max: 1.35 },
        { signal: 'energy', node: 'Hue', param: 'shift', min: 0, max: 0.5 },
      ],
      next: 'breakdown',
      intensity: 1,
      mood: 'hard, strobing, full frame',
    },
    {
      id: 'breakdown',
      name: 'Breakdown',
      enter: { bars: 64 },
      hold: { bars: 16 },
      look: { preset: 'soft-preset' },
      transition: { type: 'crossfade', duration: 4, quantize: 'phrase' },
      next: 'build',
      intensity: 0.3,
    },
  ],
  cues: [
    { name: 'drop', do: [{ type: 'section', to: 'drop' }] },
    { name: 'panic', do: [{ type: 'blackout', on: true }] },
    { name: 'lift', do: [{ type: 'master', to: 1, overSeconds: 1 }] },
  ],
  rules: {
    minSectionBars: 4,
    minSceneChangeSeconds: 4,
    maxActionsPerBar: 12,
    allowGraphEdits: false,
    masterCeiling: 1,
    director: { enabled: true, everyBars: 16, freedom: 0.4 },
  },
});

/** The action types a scenario may contain, re-exported for the panel's help. */
export { ACTION_TYPES };
