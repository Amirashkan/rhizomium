// The scenario format: what it accepts, what it repairs, and what it refuses.
//
// The four writers of a scenario — a hand at a desk, a saved file, the model,
// and the panel's editor — are all sloppy in different ways, so most of these
// are about normalisation surviving nonsense rather than about the happy path.

import { describe, it, expect } from 'vitest';
import {
  normalizeScenario,
  validateScenario,
  normalizeEnter,
  normalizeSignal,
  emptyScenario,
  EXAMPLE_SCENARIO,
  LIMITS,
} from '../src/performer/Scenario.js';

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
});

describe('validateScenario', () => {
  it('passes the worked example', () => {
    const report = validateScenario(normalizeScenario(EXAMPLE_SCENARIO));
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
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
});
