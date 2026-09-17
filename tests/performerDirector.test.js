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

  // A section change is the second door into ask(). It used to be the only one
  // that did not check the scenario's own switch, so a set with the director
  // off in its rules still spent a call at every boundary — and because the
  // engine does not consult a director its rules have off, nothing collected
  // the answer or timed the request out. It surfaced much later, as a plan
  // dropped for arriving half a minute after it was asked for.
  it('does not ask at a section change when the scenario has the director off', () => {
    director.setEnabled(true);
    const off = state();
    off.scenario.rules.director.enabled = false;

    director.onSectionChange(off);
    expect(run).not.toHaveBeenCalled();
  });

  it('still asks at a section change when the scenario wants one', () => {
    director.setEnabled(true);
    director.onSectionChange(state());
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('shows the model the patch, so a plan can name a node that exists', () => {
    director.setEnabled(true);
    director.offer(state({
      patch: [{ node: 'ComputeNoise', kind: 'ComputeNoise', params: ['scale', 'speed'] }],
    }));

    const [, input] = run.mock.calls[0];
    expect(input.state.patch).toEqual([
      { node: 'ComputeNoise', kind: 'ComputeNoise', params: ['scale', 'speed'] },
    ]);
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

  it('does not ask on a section change the scenario\'s own rules have off', () => {
    // The engine consults the director only when rules.director.enabled is on,
    // so without this gate a section boundary is a second door into ask(): the
    // call is made and charged, and nothing ever collects the answer or times
    // it out. It surfaces much later as a plan dropped for arriving late.
    director.setEnabled(true);
    director.onSectionChange(state({
      scenario: { ...state().scenario, rules: { ...state().scenario.rules, director: { enabled: false, freedom: 0.4 } } },
    }));
    expect(run).not.toHaveBeenCalled();
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
    it('charges nothing for a grant the gallery refused', async () => {
      // A 403 means no grant was issued, so nothing was spent — and a readout
      // that claims otherwise is worse than no readout.
      run.mockReturnValue(Promise.reject(new GrantError('no tier', { code: 'tier' })));
      director.setEnabled(true);
      director.offer(state());
      await Promise.resolve();
      await Promise.resolve();

      expect(director.minutesSpent).toBe(0);
      expect(director.enabled).toBe(false);
    });

    it('gives the cadence its budget back when nothing was spent', async () => {
      run.mockReturnValue(Promise.reject(new GrantError('no tier', { code: 'tier' })));
      director.setEnabled(true);
      const before = director.cadence.status().budgetLeft;
      director.offer(state());
      await Promise.resolve();
      await Promise.resolve();

      expect(director.cadence.status().budgetLeft).toBe(before);
    });

    it('still charges when the call got past the gallery and then failed', async () => {
      // The grant is issued before the model runs, so a backend failure costs
      // the artist an action whether or not an answer came back.
      run.mockReturnValue(Promise.reject(new Error('backend exploded')));
      director.setEnabled(true);
      director.offer(state());
      await Promise.resolve();
      await Promise.resolve();

      expect(director.minutesSpent).toBe(1);
    });

    it('charges one minute for the first call of a session', async () => {
      director.setEnabled(true);
      director.offer(state());
      expect(run.mock.calls[0][2]).toEqual({ units: 1 });

      // Counted when the call comes back, not when it is sent: until then
      // nobody knows whether the gallery let it through.
      expect(director.minutesSpent).toBe(0);
      await Promise.resolve();
      await Promise.resolve();
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
      await Promise.resolve();
      await Promise.resolve();

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

    // A call reaped as timed out is still out there, unaborted, and will
    // eventually settle on its own. If that late settlement were allowed to
    // spend again, a slow-but-successful call would be billed twice: once for
    // the timeout, once for the answer that arrives after all.
    it('does not charge twice when a reaped call answers late', async () => {
      const pending = deferred();
      run.mockReturnValue(pending.promise);
      director.setEnabled(true);
      director.offer(state());

      clock.now += 20_001; // past LIVE_TIMEOUT_MS
      director.offer(state()); // reaps the hung call
      expect(director.minutesSpent).toBe(1);

      // The original request finally comes back, successfully.
      pending.resolve({ result: { actions: [], note: '' } });
      await Promise.resolve();
      await Promise.resolve();

      expect(director.minutesSpent).toBe(1);
    });
  });
});

describe('building a show', () => {
  // The director's other slow job: a manifest in, a set that plays generated
  // looks out. runFeature is still injected, so this spends nothing.

  const MANIFEST = {
    show: 'Test set',
    looks: [
      { id: 'opening', name: 'Opening', brief: 'slow fog over near-black' },
      { id: 'drop', name: 'Drop', brief: 'hard, white, full frame' },
    ],
  };

  const patch = () => ({
    nodes: [{ id: 'a', kind: 'Noise', x: 0, y: 0, params: {} }],
    connections: [],
  });

  function makeDirector() {
    const run = vi.fn(async (feature) => {
      if (feature === 'ai.patch_generator') {
        return { result: { patch: patch(), title: 'A look', notes: 'turn the speed' } };
      }
      if (feature === 'ai.performer_scenario') {
        return {
          result: {
            scenario: {
              name: 'Test set',
              sections: [
                { id: 'opening', name: 'Opening', enter: 'manual' },
                { id: 'drop', name: 'Drop', enter: { bars: 32 } },
              ],
            },
            note: 'check the drop',
          },
        };
      }
      throw new Error(`unexpected feature ${feature}`);
    });
    return { run, director: new PerformerDirector({ run, now: () => 0 }) };
  }

  it('runs the editor\'s own patch generator, once per look', async () => {
    const { run, director } = makeDirector();
    const installed = [];

    await director.buildShow(MANIFEST, {
      installScene: (name) => { installed.push(name); return { id: name, name }; },
    });

    const generated = run.mock.calls.filter(([feature]) => feature === 'ai.patch_generator');
    expect(generated).toHaveLength(2);
    expect(installed).toEqual(['Opening', 'Drop']);
  });

  it('sends the show with each look, so the patches read as one set', async () => {
    const { run, director } = makeDirector();
    await director.buildShow(MANIFEST, { installScene: (name) => ({ id: name, name }) });

    const [, input] = run.mock.calls.find(([feature]) => feature === 'ai.patch_generator');
    expect(input.prompt).toContain('slow fog over near-black');
    expect(input.show.context).toContain('Test set');
    expect(input.show.look).toBe('Opening');
  });

  it('leaves the plain patch generator exactly as it was', async () => {
    const { run, director } = makeDirector();
    await director.generatePatch('just a patch');

    const [feature, input] = run.mock.calls[0];
    expect(feature).toBe('ai.patch_generator');
    expect(input).toEqual({ prompt: 'just a patch', show: undefined });
  });

  it('hands back a scenario that names the scenes it just installed', async () => {
    const { director } = makeDirector();
    const report = await director.buildShow(MANIFEST, {
      installScene: (name) => ({ id: `scene_${name}`, name }),
    });

    expect(report.scenario.sections.map((section) => section.look.scene))
      .toEqual(['Opening', 'Drop']);
    expect(report.note).toBe('check the drop');
  });

  it('loads nothing: the set is a document until the artist presses Load', async () => {
    const { director } = makeDirector();
    const report = await director.buildShow(MANIFEST, {
      installScene: (name) => ({ id: name, name }),
    });

    // The same rule a drafted scenario follows. A set that starts playing
    // because a build finished is exactly the surprise the panel avoids.
    expect(report.scenario.name).toBe('Test set');
    expect(director.enabled).toBe(false);
  });

  it('refuses a manifest with nothing to build, before spending a call', async () => {
    const { run, director } = makeDirector();
    await expect(director.buildShow({ show: 'empty' }, { installScene: () => ({}) }))
      .rejects.toThrow(/at least one look/);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses when there is nowhere to put the looks', async () => {
    const { run, director } = makeDirector();
    await expect(director.buildShow(MANIFEST, {})).rejects.toThrow(/Nowhere to put/);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not charge a show build against the live director\'s minutes', async () => {
    // Its allowance is patch generations and one scenario, all counted by the
    // gallery per call. The minutes readout is the live feature's alone.
    const { director } = makeDirector();
    await director.buildShow(MANIFEST, { installScene: (name) => ({ id: name, name }) });
    expect(director.minutesSpent).toBe(0);
    expect(director.calls).toBe(0);
  });

  it('says it is building, and stops saying so when it is done', async () => {
    const { director } = makeDirector();
    expect(director.status().building).toBe(false);

    const building = director.buildShow(MANIFEST, { installScene: (name) => ({ id: name, name }) });
    expect(director.status().building).toBe(true);

    await building;
    expect(director.status().building).toBe(false);
  });
});
