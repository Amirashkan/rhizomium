// The director: staleness, backoff, and never blocking a frame.
//
// runFeature is injected, so none of these touch the network. What is actually
// under test is the discipline around it — a model call is seconds long and a
// bar is under two, and everything here is about that gap.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerformerDirector } from '../src/performer/PerformerDirector.js';
import { GrantError } from '../src/ai/entitlements.js';

/** A state object shaped like the engine's describeState(). */
function state(overrides = {}) {
  return {
    scenario: {
      name: 'set',
      notes: '',
      sections: [{ id: 'a', name: 'A' }],
      cues: ['drop'],
      rules: {
        allowSceneChanges: true, allowPresets: true, allowParameterMoves: true,
        allowGraphEdits: false,
        director: { enabled: true, everyBars: 16, freedom: 0.4, staleAfterBars: 8,
          mayChangeSection: true, mayEditGraph: false },
      },
    },
    now: { bar: 0, bpm: 120 },
    signals: { bass: { value: 0.5, rise: 0, peak: 0.6, average: 0.4, seen: true } },
    driving: [],
    recent: [],
    askedAtBeats: 0,
    ...overrides,
  };
}

/** A run() that resolves when the test says so. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('PerformerDirector', () => {
  let clock;
  let director;
  let run;

  beforeEach(() => {
    clock = { now: 0 };
    run = vi.fn(() => Promise.resolve({ result: { actions: [], note: '' } }));
    director = new PerformerDirector({ run, now: () => clock.now });
  });

  it('does nothing at all until it is turned on', () => {
    director.offer(state());
    expect(run).not.toHaveBeenCalled();
  });

  it('asks once when enabled, and not again until the cadence has passed', () => {
    director.setEnabled(true);
    director.offer(state({ now: { bar: 0, bpm: 120 } }));
    expect(run).toHaveBeenCalledTimes(1);

    clock.now += 4_000;
    director.offer(state({ now: { bar: 4, bpm: 120 } }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  // The cadence is in seconds, not bars: moving the bar counter changes
  // nothing, because on music with no pulse the bar counter is a metronome
  // nobody is playing to. See DirectorCadence.
  it('asks again once the cadence has passed, measured in time', async () => {
    director.setEnabled(true);
    director.offer(state());
    await Promise.resolve();
    director.take();

    clock.now += 5_000;
    director.offer(state({ now: { bar: 20, bpm: 120 } }));
    expect(run).toHaveBeenCalledTimes(1);

    clock.now += 60_000;
    director.offer(state({ now: { bar: 20, bpm: 120 } }));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never has two calls in the air at once', () => {
    const pending = deferred();
    run.mockReturnValue(pending.promise);
    director.setEnabled(true);

    director.offer(state({ now: { bar: 0, bpm: 120 } }));
    director.offer(state({ now: { bar: 100, bpm: 120 } }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns immediately even when the call never answers', () => {
    run.mockReturnValue(new Promise(() => {}));
    director.setEnabled(true);
    const before = Date.now();
    director.offer(state());
    expect(Date.now() - before).toBeLessThan(50);
  });

  it('hands a finished plan over exactly once', async () => {
    run.mockResolvedValue({ result: { actions: [{ type: 'master', to: 0.5 }], note: 'softer' } });
    director.setEnabled(true);
    director.offer(state());
    await Promise.resolve();
    await Promise.resolve();

    const plan = director.take();
    expect(plan.actions).toHaveLength(1);
    expect(plan.note).toBe('softer');
    expect(director.take()).toBeNull();
  });

  it('drops an action whose verb it does not know, keeping the rest', async () => {
    run.mockResolvedValue({
      result: { actions: [{ type: 'summon_dragon' }, { type: 'master', to: 1 }], note: '' },
    });
    director.setEnabled(true);
    director.offer(state());
    await Promise.resolve();
    await Promise.resolve();

    expect(director.take().actions.map((a) => a.type)).toEqual(['master']);
  });

  it('carries the position it was asked at, so a late answer can be recognised', async () => {
    run.mockResolvedValue({ result: { actions: [{ type: 'master', to: 1 }], note: '' } });
    director.setEnabled(true);
    director.offer(state({ askedAtBeats: 128 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(director.take().askedAtBeats).toBe(128);
  });

  it('throws away an answer to a moment the musician has since moved past', async () => {
    const pending = deferred();
    run.mockReturnValue(pending.promise);
    director.setEnabled(true);
    director.offer(state());

    director.discard('a cue was fired');

    pending.resolve({ result: { actions: [{ type: 'master', to: 0 }], note: '' } });
    await Promise.resolve();
    await Promise.resolve();

    expect(director.take()).toBeNull();
  });

  it('gives up on a call that has stopped being worth waiting for', () => {
    run.mockReturnValue(new Promise(() => {}));
    director.setEnabled(true);
    director.offer(state());
    expect(director.status().thinking).toBe(true);

    clock.now += 60_000;
    director.offer(state({ now: { bar: 100, bpm: 120 } }));
    expect(director.status().thinking).toBe(false);
  });

  it('backs off after a failure rather than hammering a broken service', async () => {
    run.mockRejectedValue(new Error('network'));
    director.setEnabled(true);

    director.offer(state({ now: { bar: 0, bpm: 120 } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(director.status().lastError).toMatch(/network/);

    director.offer(state({ now: { bar: 100, bpm: 120 } }));
    expect(run).toHaveBeenCalledTimes(1);

    clock.now += 60_000;
    director.offer(state({ now: { bar: 200, bpm: 120 } }));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stops asking altogether when the answer is "you have no quota"', async () => {
    run.mockRejectedValue(new GrantError('Out of actions for today.', { code: 'quota' }));
    director.setEnabled(true);
    director.offer(state());
    await Promise.resolve();
    await Promise.resolve();

    expect(director.enabled).toBe(false);
    expect(director.status().lastError).toMatch(/Out of actions/);
  });

  it('asks on a section change without waiting for the cadence', () => {
    director.setEnabled(true);
    director.onSectionChange(state());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps a signal nothing has sent out of the prompt', () => {
    director.setEnabled(true);
    director.offer(state({
      signals: {
        real: { value: 0.5, rise: 0, peak: 1, average: 0.4, seen: true },
        absent: { value: 0, rise: 0, peak: 0, average: 0, seen: false },
      },
    }));

    const sent = run.mock.calls[0][1].state;
    expect(Object.keys(sent.signals)).toEqual(['real']);
  });

  it('carries the artist\'s steer into the ask', () => {
    director.setEnabled(true);
    director.setSteer('keep it dark');
    director.offer(state());
    expect(run.mock.calls[0][1].steer).toBe('keep it dark');
  });

  describe('authoring a scenario', () => {
    it('refuses an empty brief before spending a call', async () => {
      await expect(director.authorScenario('  ')).rejects.toThrow(/Describe the set/);
      expect(run).not.toHaveBeenCalled();
    });

    it('normalises whatever comes back', async () => {
      run.mockResolvedValue({
        result: { scenario: { name: 'Night', sections: [{ name: 'Intro' }] }, note: 'check the scenes' },
        warnings: [],
      });

      const { scenario, note } = await director.authorScenario('a dark techno set');
      expect(scenario.sections[0].id).toBe('intro');
      expect(scenario.rules.minSectionBars).toBe(4);
      expect(note).toBe('check the scenes');
    });

    it('tells the model what is actually loaded', async () => {
      run.mockResolvedValue({ result: { scenario: { sections: [] } }, warnings: [] });
      await director.authorScenario('set', {
        scenes: [{ id: 's1', name: 'Intro', notes: 'cold open' }],
        oscAddresses: ['/live/energy'],
        bpm: 128,
      });

      const input = run.mock.calls[0][1];
      expect(input.scenes).toEqual([{ id: 's1', name: 'Intro', notes: 'cold open' }]);
      expect(input.oscAddresses).toEqual(['/live/energy']);
      expect(input.bpm).toBe(128);
    });
  });

  // The one feature billed against a clock rather than a button. What it
  // charges has to track how long the artist performed, not how eventful the
  // music happened to be — those came apart the moment the cadence started
  // reacting to the music.
  describe('what a set costs', () => {
    it('charges one minute for the first call of a session', async () => {
      director.setEnabled(true);
      director.offer(state());
      expect(run.mock.calls[0][2]).toEqual({ units: 1 });
      expect(director.minutesSpent).toBe(1);
    });

    it('charges the minutes since the last call, not one per call', async () => {
      director.setEnabled(true);
      director.offer(state());
      await Promise.resolve();
      director.take();

      // Three minutes of set went by before the next question.
      clock.now += 3 * 60_000;
      director.offer(state());

      expect(run.mock.calls[1][2]).toEqual({ units: 3 });
      expect(director.minutesSpent).toBe(4);
    });

    it('never charges for a gap nobody performed', async () => {
      director.setEnabled(true);
      director.offer(state());
      await Promise.resolve();
      director.take();

      // The laptop slept between soundcheck and doors.
      clock.now += 4 * 60 * 60_000;
      director.offer(state());

      expect(run.mock.calls[1][2].units).toBeLessThanOrEqual(5);
    });

    it('does not charge for the time it was switched off', async () => {
      director.setEnabled(true);
      director.offer(state());
      await Promise.resolve();
      director.take();

      director.setEnabled(false);
      clock.now += 30 * 60_000;
      director.setEnabled(true);
      director.offer(state());

      expect(run.mock.calls[1][2]).toEqual({ units: 1 });
    });
  });
});
