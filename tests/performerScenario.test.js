// The scenario format: what it accepts, what it repairs, and what it refuses.
//
// The four writers of a scenario — a hand at a desk, a saved file, the model,
// and the panel's editor — are all sloppy in different ways, so most of these
// are about normalisation surviving nonsense rather than about the happy path.

import { describe, it, expect } from 'vitest';
import {
  normalizeScenario,
  validateScenario,
  normalizeDrive,
  normalizeEnter,
  normalizeSignal,
  emptyScenario,
  EXAMPLE_SCENARIO,
  LIMITS,
} from '../src/performer/Scenario.js';
import { normalizeAction } from '../src/performer/actions.js';

describe('normalizeScenario', () => {
  it('turns nothing at all into a runnable document', () => {
    const scenario = normalizeScenario(undefined);
    expect(scenario.sections).toEqual([]);
    expect(scenario.bpm).toBe(120);
    expect(scenario.rules.minSectionBars).toBe(4);
  });

  it('parses JSON text', () => {
    const scenario = normalizeScenario('{"name":"From text","sections":[{"name":"One"}]}');
    expect(scenario.name).toBe('From text');
    expect(scenario.sections).toHaveLength(1);
  });

  it('survives JSON that does not parse', () => {
    expect(() => normalizeScenario('{ not json')).not.toThrow();
    expect(normalizeScenario('{ not json').sections).toEqual([]);
  });

  it('gives sections ids derived from their names', () => {
    const scenario = normalizeScenario({ sections: [{ name: 'The Big Drop' }] });
    expect(scenario.sections[0].id).toBe('the-big-drop');
  });

  it('makes duplicate ids unique rather than letting one shadow the other', () => {
    const scenario = normalizeScenario({
      sections: [{ name: 'Build' }, { name: 'Build' }, { name: 'Build' }],
    });
    expect(scenario.sections.map((s) => s.id)).toEqual(['build', 'build-2', 'build-3']);
  });

  it('drops a duplicate signal rather than shadowing the first', () => {
    const scenario = normalizeScenario({
      signals: [
        { name: 'energy', source: 'osc', address: '/a' },
        { name: 'energy', source: 'osc', address: '/b' },
      ],
    });
    expect(scenario.signals).toHaveLength(1);
    expect(scenario.signals[0].address).toBe('/a');
  });

  it('caps the document so one bad file cannot make the engine the slow part of a frame', () => {
    const scenario = normalizeScenario({
      sections: Array.from({ length: LIMITS.sections + 50 }, (_, i) => ({ name: `s${i}` })),
    });
    expect(scenario.sections).toHaveLength(LIMITS.sections);
  });

  it('clamps a tempo that would break the clock', () => {
    expect(normalizeScenario({ bpm: 100000 }).bpm).toBe(300);
    expect(normalizeScenario({ bpm: -4 }).bpm).toBe(20);
    expect(normalizeScenario({ bpm: 'fast' }).bpm).toBe(120);
  });

  it('repairs a zero-width input range, which would divide by zero downstream', () => {
    const signal = normalizeSignal({ name: 'x', inputMin: 5, inputMax: 5 });
    expect(signal.inputMax).toBeGreaterThan(signal.inputMin);
  });

  it('leaves graph edits off unless the scenario asks for them', () => {
    expect(normalizeScenario({}).rules.allowGraphEdits).toBe(false);
    expect(normalizeScenario({ rules: { allowGraphEdits: true } }).rules.allowGraphEdits).toBe(true);
  });

  it('keeps the other rules on by default', () => {
    const rules = normalizeScenario({}).rules;
    expect(rules.allowSceneChanges).toBe(true);
    expect(rules.allowPresets).toBe(true);
    expect(rules.allowParameterMoves).toBe(true);
  });

  it('drops an action whose verb it does not know, keeping the rest', () => {
    const scenario = normalizeScenario({
      sections: [{ name: 'a', onEnter: [{ type: 'launch_missiles' }, { type: 'master', to: 0.5 }] }],
    });
    expect(scenario.sections[0].onEnter).toHaveLength(1);
    expect(scenario.sections[0].onEnter[0].type).toBe('master');
  });
});

// What the model actually answers with, which is not always what it was asked
// for. A drive and a move are the two parts of a scenario that address the rig
// by name, and the rig is described to the model as a list of "node.param"
// strings — so a pair arriving in one field, or a time arriving beside `at`
// rather than inside it, is a section that plays its look and moves nothing.
// Each of these is a whole set's worth of drives, so none of them is a
// curiosity.
describe('a drive the way a model writes one', () => {
  it('splits a dotted pair that arrived in the parameter field', () => {
    const drive = normalizeDrive({ signal: 'energy', param: 'ComputeNoise.scale' });
    expect(drive.node).toBe('ComputeNoise');
    expect(drive.param).toBe('scale');
  });

  it('splits one that arrived as a "target"', () => {
    const drive = normalizeDrive({ signal: 'energy', target: 'ComputeGradient.angle' });
    expect(drive.node).toBe('ComputeGradient');
    expect(drive.param).toBe('angle');
  });

  it('reads a nested target object', () => {
    const drive = normalizeDrive({ signal: 'bass', target: { node: 'Warp', param: 'amount' } });
    expect(drive.node).toBe('Warp');
    expect(drive.param).toBe('amount');
  });

  it('takes the parameter once when the node is written twice', () => {
    const drive = normalizeDrive({ signal: 'bass', node: 'Warp', param: 'Warp.amount' });
    expect(drive.node).toBe('Warp');
    expect(drive.param).toBe('amount');
  });

  it('splits at the last dot, so a node with a dot in its name survives', () => {
    const drive = normalizeDrive({ signal: 'bass', param: 'Fog 2.0.opacity' });
    expect(drive.node).toBe('Fog 2.0');
    expect(drive.param).toBe('opacity');
  });

  it('leaves a plain pair exactly as written', () => {
    const drive = normalizeDrive({ signal: 'bass', node: 'Warp', param: 'amount' });
    expect(drive.node).toBe('Warp');
    expect(drive.param).toBe('amount');
  });

  it('reads the same dotted pair in an action, so a cue is not dead either', () => {
    const action = normalizeAction({ type: 'drive', signal: 'bass', param: 'Warp.amount' });
    expect(action.node).toBe('Warp');
    expect(action.param).toBe('amount');
    const release = normalizeAction({ type: 'undrive', target: 'Warp.amount' });
    expect(release.node).toBe('Warp');
    expect(release.param).toBe('amount');
  });

  it('still reports a drive that names nothing at all, and says which one', () => {
    const report = validateScenario(normalizeScenario({
      signals: [{ name: 'energy', source: 'osc', address: '/e' }],
      sections: [{ name: 'a', drives: [{ id: 'd1', signal: 'energy', min: 0, max: 1 }] }],
    }));
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.message.includes('"d1"'))).toBe(true);
  });
});

describe('a move the way a model writes one', () => {
  const moveIn = (section) => normalizeScenario({ sections: [section] }).sections[0].moves[0];

  it('takes seconds written beside "at" rather than inside it', () => {
    const move = moveIn({ name: 'a', moves: [{ seconds: 40, do: [{ type: 'master', to: 1 }] }] });
    expect(move.atSeconds).toBe(40);
    expect(move.atBars).toBeNull();
  });

  it('takes bars written beside "at"', () => {
    const move = moveIn({ name: 'a', moves: [{ bars: 16, do: [{ type: 'master', to: 1 }] }] });
    expect(move.atBars).toBe(16);
  });

  it('reads a bare "at" in the unit the section around it is written in', () => {
    const free = moveIn({
      name: 'a',
      enter: { seconds: 60 },
      hold: { seconds: 90 },
      moves: [{ at: 30, do: [{ type: 'master', to: 1 }] }],
    });
    expect(free.atSeconds).toBe(30);
    expect(free.atBars).toBeNull();

    const metered = moveIn({
      name: 'a',
      enter: { bars: 32 },
      moves: [{ at: 8, do: [{ type: 'master', to: 1 }] }],
    });
    expect(metered.atBars).toBe(8);
    expect(metered.atSeconds).toBeNull();
  });

  it('reads a time with its unit written on it', () => {
    expect(moveIn({ name: 'a', moves: [{ at: '45s', do: [{ type: 'master', to: 1 }] }] }).atSeconds).toBe(45);
    expect(moveIn({ name: 'a', moves: [{ at: '8 bars', do: [{ type: 'master', to: 1 }] }] }).atBars).toBe(8);
    expect(moveIn({ name: 'a', moves: [{ at: '1:30', do: [{ type: 'master', to: 1 }] }] }).atSeconds).toBe(90);
    expect(moveIn({ name: 'a', moves: [{ at: '2 min', do: [{ type: 'master', to: 1 }] }] }).atSeconds).toBe(120);
  });

  it('still reports a move with no time at all', () => {
    const report = validateScenario(normalizeScenario({
      sections: [{ name: 'a', moves: [{ id: 'move1', do: [{ type: 'master', to: 1 }] }] }],
    }));
    expect(report.errors.some((e) => /"move1" has no time/.test(e.message))).toBe(true);
  });
});

describe('normalizeEnter', () => {
  it('reads a bare string as a cue, which is the hand-written shorthand', () => {
    expect(normalizeEnter('drop')).toEqual({ kind: 'cue', cue: 'drop' });
  });

  it('reads a bare number as a bar count', () => {
    expect(normalizeEnter(32)).toEqual({ kind: 'bars', bars: 32 });
  });

  it('defaults to manual, so a condition someone forgot to write does not fire at bar zero', () => {
    expect(normalizeEnter(undefined).kind).toBe('manual');
    expect(normalizeEnter({}).kind).toBe('manual');
    expect(normalizeEnter('manual').kind).toBe('manual');
  });

  it('takes each of the four kinds', () => {
    expect(normalizeEnter({ cue: 'x' }).kind).toBe('cue');
    expect(normalizeEnter({ bars: 8 }).kind).toBe('bars');
    expect(normalizeEnter({ seconds: 8 }).kind).toBe('seconds');
    expect(normalizeEnter({ when: 'energy > 0.5' }).kind).toBe('when');
  });

  // `by` is the ceiling on the two kinds that can wait for something that
  // never comes. Everything below is about it being carried exactly where it
  // can change what happens and nowhere else.
  describe('by, the deadline', () => {
    it('is carried by a cue and by a condition', () => {
      expect(normalizeEnter({ cue: 'drop', by: { bars: 24 } }).by).toEqual({ bars: 24, seconds: null });
      expect(normalizeEnter({ when: 'energy > 0.4', by: { seconds: 90 } }).by).toEqual({ bars: null, seconds: 90 });
    });

    it('reads a bare number as bars, the way enter itself does', () => {
      expect(normalizeEnter({ cue: 'drop', by: 16 }).by).toEqual({ bars: 16, seconds: null });
    });

    it('is dropped on the kinds that are already a length', () => {
      expect(normalizeEnter({ bars: 8, by: { bars: 16 } }).by).toBeUndefined();
      expect(normalizeEnter({ seconds: 8, by: { seconds: 16 } }).by).toBeUndefined();
      expect(normalizeEnter({ by: { bars: 16 } }).by).toBeUndefined();
    });

    it('is absent as a key rather than null when nothing was written', () => {
      expect('by' in normalizeEnter({ cue: 'drop' })).toBe(false);
    });

    // Zero would be a section skipped before it played, which is nobody's
    // intent and is the value a half-filled form hands over.
    it('reads zero and nonsense as no deadline at all', () => {
      expect(normalizeEnter({ cue: 'drop', by: { bars: 0 } }).by).toBeUndefined();
      expect(normalizeEnter({ cue: 'drop', by: {} }).by).toBeUndefined();
      expect(normalizeEnter({ cue: 'drop', by: 'soon' }).by).toBeUndefined();
    });

    it('survives the long-hand {kind} spelling the model sometimes answers in', () => {
      expect(normalizeEnter({ kind: 'cue', cue: 'drop', by: { bars: 24 } }).by)
        .toEqual({ bars: 24, seconds: null });
    });
  });
});

describe('validateScenario', () => {
  it('passes the worked example', () => {
    const report = validateScenario(normalizeScenario(EXAMPLE_SCENARIO));
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  // The set that starts, shows one frame and reports itself healthy. This
  // warning existed for it and could not fire: the `some()` that tested it
  // excluded the first section inside the same clause that did the test, so it
  // was satisfied by the first section every time.
  describe('a set that cannot leave its first section', () => {
    const stuck = (enter, first = { hold: { bars: 16 } }) => normalizeScenario({
      sections: [
        { id: 'intro', name: 'Intro', next: 'build', ...first },
        { id: 'build', name: 'Build', enter },
      ],
    });
    const said = (scenario) => validateScenario(scenario).warnings
      .filter((w) => /Nothing moves this set off/.test(w.message));

    it('warns when the only way on is a condition nobody may reach', () => {
      const [warning] = said(stuck({ when: 'energy > 0.45' }));
      expect(warning?.message).toMatch(/"Build" waits for energy > 0.45/);
      expect(warning?.message).toMatch(/hold one frame/);
    });

    it('warns when the only way on is a cue nobody may fire', () => {
      expect(said(stuck({ cue: 'drop' }))[0]?.message).toMatch(/waits for the cue "drop"/);
    });

    it('is quiet once that entry carries a deadline', () => {
      expect(said(stuck({ when: 'energy > 0.45', by: { bars: 32 } }))).toEqual([]);
      expect(said(stuck({ cue: 'drop', by: { bars: 24 } }))).toEqual([]);
    });

    it('is quiet about a clock entry, which is its own deadline', () => {
      expect(said(stuck({ bars: 32 }))).toEqual([]);
      expect(said(stuck({ seconds: 45 }))).toEqual([]);
    });

    // The engine advances into a manual section when the section AHEAD of it
    // stated a length, so manual strands a set only when it does not.
    it('reads a manual entry the way the engine does', () => {
      expect(said(stuck('manual'))).toEqual([]);
      expect(said(stuck('manual', {}))[0]?.message).toMatch(/is entered by hand/);
    });

    // resolveNextIndex() follows `next` before it falls through to the section
    // after this one, and a check that did not would look at the wrong section.
    it('follows "next" rather than the order on the page', () => {
      const scenario = normalizeScenario({
        sections: [
          { id: 'intro', name: 'Intro', hold: { bars: 16 }, next: 'closer' },
          { id: 'middle', name: 'Middle', enter: { bars: 8 } },
          { id: 'closer', name: 'Closer', enter: { cue: 'go' } },
        ],
      });
      expect(said(scenario)[0]?.message).toMatch(/"Closer" waits for the cue "go"/);
    });

    it('says nothing about a set with one section, which has nowhere to go', () => {
      expect(said(normalizeScenario({ sections: [{ name: 'Only' }] }))).toEqual([]);
    });
  });

  // A deadline inside the previous section's floor is a deadline that always
  // wins, which makes the cue or condition above it read as live when it is not.
  describe('a deadline with no window under it', () => {
    const window = (by, hold) => validateScenario(normalizeScenario({
      sections: [
        { id: 'a', name: 'A', hold, next: 'b' },
        { id: 'b', name: 'B', enter: { when: 'energy > 0.4', by } },
      ],
      signals: [{ name: 'energy', source: 'manual' }],
    })).warnings.filter((w) => /no window/.test(w.message));

    it('warns when the deadline is inside the hold', () => {
      expect(window({ bars: 16 }, { bars: 32 })[0]?.message).toMatch(/16 bars.*hold of 32 bars/);
    });

    it('warns when they are equal, which is a window of nothing', () => {
      expect(window({ bars: 32 }, { bars: 32 })).toHaveLength(1);
    });

    it('is quiet when the deadline is past the hold', () => {
      expect(window({ bars: 48 }, { bars: 32 })).toEqual([]);
    });

    // Bars against seconds needs a tempo, and the tempo at showtime is not the
    // one in the document.
    it('does not compare across units', () => {
      expect(window({ seconds: 5 }, { bars: 32 })).toEqual([]);
    });

    it('is quiet when the section ahead states no floor at all', () => {
      expect(window({ bars: 4 }, undefined)).toEqual([]);
    });
  });

  it('refuses a scenario with no sections', () => {
    const report = validateScenario(emptyScenario() && normalizeScenario({}));
    expect(report.ok).toBe(false);
    expect(report.errors[0].message).toMatch(/at least one section/);
  });

  it('catches a next that points nowhere', () => {
    const report = validateScenario(normalizeScenario({
      sections: [{ name: 'a', next: 'nowhere' }],
    }));
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => /does not exist/.test(e.message))).toBe(true);
  });

  it('catches a condition naming a signal that is not declared', () => {
    const report = validateScenario(normalizeScenario({
      sections: [{ name: 'a' }, { name: 'b', enter: { when: 'loudness > 0.5' } }],
    }));
    expect(report.errors.some((e) => /loudness/.test(e.message))).toBe(true);
  });

  it('accepts a condition over the built-in clock signals without declaring them', () => {
    const report = validateScenario(normalizeScenario({
      sections: [{ name: 'a' }, { name: 'b', enter: { when: 'bar > 16 && energy > 0.4' } }],
    }));
    expect(report.errors).toEqual([]);
  });

  it('accepts derived readings like bass_rise', () => {
    const report = validateScenario(normalizeScenario({
      signals: [{ name: 'bass', source: 'audio', channel: 'low' }],
      sections: [{ name: 'a' }, { name: 'b', enter: { when: 'bass > 0.5' } }],
    }));
    expect(report.errors).toEqual([]);
  });

  it('catches a move that can never fire', () => {
    const report = validateScenario(normalizeScenario({
      sections: [{ name: 'a', moves: [{ do: [{ type: 'master', to: 1 }] }] }],
    }));
    expect(report.errors.some((e) => /can never fire/.test(e.message))).toBe(true);
  });

  it('reports every problem at once rather than the first', () => {
    const report = validateScenario(normalizeScenario({
      sections: [
        { name: 'a', next: 'gone' },
        { name: 'b', next: 'also-gone' },
      ],
    }));
    expect(report.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('warns rather than errors on a scene that is not loaded, so the set still runs', () => {
    const report = validateScenario(
      normalizeScenario({ sections: [{ name: 'a', look: { scene: 'missing' } }] }),
      { sceneIds: ['present'] }
    );
    expect(report.ok).toBe(true);
    expect(report.warnings.some((w) => /not loaded/.test(w.message))).toBe(true);
  });

  it('says nothing about scenes when the caller did not say what exists', () => {
    const report = validateScenario(
      normalizeScenario({ sections: [{ name: 'a', look: { scene: 'anything' } }] })
    );
    expect(report.warnings).toEqual([]);
  });

  // A scenario for music with no pulse: every unit it can be written in has to
  // survive normalisation, or the prompt is promising something the format
  // will silently drop.
  describe('unmetered scenarios', () => {
    it('keeps seconds on enters, holds and moves', () => {
      const scenario = normalizeScenario({
        sections: [{
          id: 'drift',
          name: 'Drift',
          enter: { seconds: 90 },
          hold: { seconds: 120 },
          moves: [{ at: { seconds: 45 }, do: [{ type: 'master', to: 0.7, overSeconds: 8 }] }],
        }],
      });

      const section = scenario.sections[0];
      expect(section.enter).toEqual({ kind: 'seconds', seconds: 90 });
      expect(section.hold.seconds).toBe(120);
      expect(section.hold.bars).toBeNull();
      expect(section.moves[0].atSeconds).toBe(45);
      expect(section.moves[0].atBars).toBeNull();
    });

    it('accepts the onset grid', () => {
      const scenario = normalizeScenario({
        sections: [{ id: 'a', name: 'A', transition: { type: 'cut', quantize: 'onset' } }],
      });
      expect(scenario.sections[0].transition.quantize).toBe('onset');
    });

    it('takes a director cadence in seconds', () => {
      const scenario = normalizeScenario({
        sections: [{ id: 'a', name: 'A' }],
        rules: { director: { everySeconds: 30, staleAfterSeconds: 15 } },
      });
      expect(scenario.rules.director.everySeconds).toBe(30);
      expect(scenario.rules.director.staleAfterSeconds).toBe(15);
    });

    it('leaves everySeconds null when the scenario did not say', () => {
      // Null rather than a default: the cadence has to be able to tell "the
      // scenario asked for 45" from "the scenario said nothing".
      const scenario = normalizeScenario({ sections: [{ id: 'a', name: 'A' }] });
      expect(scenario.rules.director.everySeconds).toBeNull();
      expect(scenario.rules.director.everyBars).toBe(16);
    });
  });

  // Pre-directions. The resolution rule and the text format have their own
  // file (tests/preDirections.test.js); what matters here is that a scenario
  // carries them, round-trips them, and reports a bad one as a warning.
  describe('directions', () => {
    it('carries them, coerced from the shorthand', () => {
      const scenario = normalizeScenario({
        sections: [{ id: 'a', name: 'A' }],
        directions: ['patient and cold', { at: 'a', text: 'tighten it' }],
      });
      expect(scenario.directions).toHaveLength(2);
      expect(scenario.directions[0].at.section).toBe('');
      expect(scenario.directions[1].at.section).toBe('a');
    });

    it('is an empty list when the scenario said nothing', () => {
      expect(normalizeScenario({ sections: [{ id: 'a' }] }).directions).toEqual([]);
    });

    it('round-trips through JSON without moving a line', () => {
      const one = normalizeScenario({
        sections: [{ id: 'drop', name: 'Drop' }],
        directions: [{ at: { section: 'drop', bars: 16 }, text: 'hold it there' }],
      });
      const again = normalizeScenario(JSON.parse(JSON.stringify(one)));
      expect(again.directions).toEqual(one.directions);
    });

    it('warns about a line anchored to a section that does not exist, and still runs', () => {
      // The set opened from someone else's machine. A pre-direction cannot be
      // allowed to stop a show — the worst a bad one does is never be heard.
      const scenario = normalizeScenario({
        sections: [{ id: 'a', name: 'A' }],
        directions: [{ at: { section: 'gone' }, text: 'x' }],
      });
      const report = validateScenario(scenario);
      expect(report.ok).toBe(true);
      expect(report.warnings.some((w) => /pre-direction 1/.test(w.where))).toBe(true);
    });

    it('accepts the worked example, directions and all', () => {
      const report = validateScenario(normalizeScenario(EXAMPLE_SCENARIO));
      expect(report.errors).toEqual([]);
      expect(normalizeScenario(EXAMPLE_SCENARIO).directions.length).toBeGreaterThan(0);
    });
  });
});
