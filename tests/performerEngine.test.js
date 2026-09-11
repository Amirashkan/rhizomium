// The engine: does a set actually play, and does the fence hold.
//
// Everything is faked below the ActionExecutor, so these run a whole set in a
// few milliseconds and assert on what the performer DID rather than on what
// appeared on a GPU there isn't one of.

import { describe, it, expect } from 'vitest';
import { PerformerEngine, STATE } from '../src/performer/PerformerEngine.js';
import { PerformerClock } from '../src/performer/PerformerClock.js';

/** Records every action instead of performing it. */
class FakeExecutor {
  constructor() {
    this.rules = null;
    this.performed = [];
    this.drivesCleared = 0;
    this.refuseNext = null;
  }
  execute(action) {
    if (this.refuseNext) {
      const reason = this.refuseNext;
      this.refuseNext = null;
      return { ok: false, reason, cost: 0 };
    }
    this.performed.push(action);
    return { ok: true, detail: '', cost: 1 };
  }
  tick() {}
  clearDrives() { this.drivesCleared++; }
  status() { return { drives: [], ramps: [], blackedOut: false, transition: {}, sceneChangeInFlight: false }; }
  /** Every action of a type, for readable assertions. */
  ofType(type) { return this.performed.filter((a) => a.type === type); }
  types() { return this.performed.map((a) => a.type); }
}

function makeEngine(scenario, options = {}) {
  const state = { now: 0 };
  const clock = new PerformerClock({ now: () => state.now, bpm: 120, beatsPerBar: 4 });
  const executor = new FakeExecutor();
  const engine = new PerformerEngine({ clock, executor, ...options });
  engine.loadScenario(scenario);

  /** Run `seconds` of performance at 60fps. */
  const play = (seconds) => {
    const frames = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < frames; i++) {
      state.now += (seconds * 1000) / frames;
      engine.tick();
    }
  };

  return { engine, executor, clock, state, play };
}

/** Two bars at 120 BPM is four seconds. */
const BAR_SECONDS = 2;

describe('PerformerEngine', () => {
  describe('transport', () => {
    it('refuses to start a scenario with nothing in it', () => {
      const { engine } = makeEngine({ sections: [] });
      expect(engine.start()).toBe(false);
      expect(engine.state).toBe(STATE.STOPPED);
    });

    it('enters the first section on start', () => {
      const { engine } = makeEngine({ sections: [{ name: 'One' }, { name: 'Two' }] });
      engine.start();
      expect(engine.state).toBe(STATE.RUNNING);
      expect(engine.currentSection.name).toBe('One');
    });

    it('applies a section\'s look when it is entered', () => {
      const { engine, executor } = makeEngine({
        sections: [{ name: 'One', look: { scene: 'opening' } }],
      });
      engine.start();
      expect(executor.ofType('scene')[0].scene).toBe('opening');
    });

    it('pauses and resumes without restarting the set', () => {
      const { engine, play } = makeEngine({ sections: [{ name: 'One' }] });
      engine.start();
      play(4);
      const at = engine.clock.beats;

      engine.pause();
      play(4);
      expect(engine.clock.beats).toBeCloseTo(at, 1);

      engine.start();
      play(2);
      expect(engine.clock.beats).toBeGreaterThan(at);
    });

    it('releases standing drives on stop, so parameters are the artist\'s again', () => {
      const { engine, executor } = makeEngine({ sections: [{ name: 'One' }] });
      engine.start();
      const before = executor.drivesCleared;
      engine.stop();
      expect(executor.drivesCleared).toBeGreaterThan(before);
      expect(engine.state).toBe(STATE.STOPPED);
    });

    it('kills the output on panic and pauses rather than stopping', () => {
      const { engine, executor } = makeEngine({ sections: [{ name: 'One' }] });
      engine.start();
      engine.panic();
      expect(executor.ofType('blackout').pop().on).toBe(true);
      expect(engine.state).toBe(STATE.PAUSED);
    });
  });

  describe('sections', () => {
    it('advances on a bar count', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One', transition: { quantize: 'off' } },
          { name: 'Two', enter: { bars: 4 }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 3);
      expect(engine.currentSection.name).toBe('One');
      play(BAR_SECONDS * 2);
      expect(engine.currentSection.name).toBe('Two');
    });

    it('advances on a condition over a live signal', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One', transition: { quantize: 'off' } },
          { name: 'Two', enter: { when: 'energy > 0.6' }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS);
      expect(engine.currentSection.name).toBe('One');

      engine.signals.setEnergy(0.9);
      play(BAR_SECONDS);
      expect(engine.currentSection.name).toBe('Two');
    });

    it('holds a section for its minimum however true the condition is', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One', hold: { bars: 8 }, transition: { quantize: 'off' } },
          { name: 'Two', enter: { when: 'energy > 0.1' }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      engine.signals.setEnergy(1);

      play(BAR_SECONDS * 6);
      expect(engine.currentSection.name).toBe('One');
      play(BAR_SECONDS * 4);
      expect(engine.currentSection.name).toBe('Two');
    });

    it('holds for the scenario\'s floor even when the section asks for less', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 8 },
        sections: [
          { name: 'One', hold: { bars: 1 }, transition: { quantize: 'off' } },
          { name: 'Two', enter: { bars: 1 }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 4);
      expect(engine.currentSection.name).toBe('One');
      play(BAR_SECONDS * 6);
      expect(engine.currentSection.name).toBe('Two');
    });

    it('only consults the next section, so a late threshold cannot grab the set', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One', transition: { quantize: 'off' } },
          { name: 'Two', enter: { bars: 100 }, transition: { quantize: 'off' } },
          { name: 'Three', enter: { when: 'energy > 0.1' }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      engine.signals.setEnergy(1);
      play(BAR_SECONDS * 8);
      expect(engine.currentSection.name).toBe('One');
    });

    it('loops back to a manual opener once the closing section has run its length', () => {
      // The commonest shape in a real set: an opener started by hand, and a
      // closer that says how long it runs and where it goes.
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One', transition: { quantize: 'off' } },
          { name: 'Two', enter: { bars: 1 }, hold: { bars: 2 }, next: 'one', transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 2);
      expect(engine.currentSection.name).toBe('Two');
      // Two stated two bars and where to go next; it was entered at bar 1, so
      // the set is back on the opener by bar 3.
      play(BAR_SECONDS * 1.5);
      expect(engine.currentSection.name).toBe('One');
    });

    it('sits on a section that stated no length and leads to a manual one', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One', transition: { quantize: 'off' } },
          { name: 'Two', enter: { bars: 1 }, next: 'one', transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 8);
      // Two never said how long it runs, and One cannot be reached on its own.
      expect(engine.currentSection.name).toBe('Two');
    });

    it('follows an explicit next out of order', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One', next: 'three', transition: { quantize: 'off' } },
          { name: 'Two', transition: { quantize: 'off' } },
          { name: 'Three', enter: { bars: 1 }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 2);
      expect(engine.currentSection.name).toBe('Three');
    });

    it('starts the section\'s drives and drops the last section\'s', () => {
      const { engine, executor, play } = makeEngine({
        rules: { minSectionBars: 0 },
        signals: [{ name: 'bass', source: 'audio', channel: 'low' }],
        sections: [
          {
            name: 'One',
            transition: { quantize: 'off' },
            drives: [{ signal: 'bass', node: 'Warp', param: 'amount', min: 0, max: 1 }],
          },
          { name: 'Two', enter: { bars: 1 }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      expect(executor.ofType('drive')).toHaveLength(1);

      const cleared = executor.drivesCleared;
      play(BAR_SECONDS * 2);
      expect(engine.currentSection.name).toBe('Two');
      expect(executor.drivesCleared).toBeGreaterThan(cleared);
    });
  });

  describe('cues', () => {
    it('releases a section waiting on a cue', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One', transition: { quantize: 'off' } },
          { name: 'Drop', enter: { cue: 'drop' }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 4);
      expect(engine.currentSection.name).toBe('One');

      engine.fireCue('drop');
      play(0.1);
      expect(engine.currentSection.name).toBe('Drop');
    });

    it('runs a declared cue\'s actions', () => {
      const { engine, executor, play } = makeEngine({
        sections: [{ name: 'One' }],
        cues: [{ name: 'lift', do: [{ type: 'master', to: 1 }] }],
      });
      engine.start();
      engine.fireCue('lift');
      play(0.05);
      expect(executor.ofType('master')).toHaveLength(1);
    });

    it('says so when a cue matches nothing rather than failing quietly', () => {
      const { engine, play } = makeEngine({ sections: [{ name: 'One' }] });
      engine.start();
      engine.fireCue('nonsense');
      play(0.05);
      expect(engine.log.some((e) => /matched nothing/.test(e.message))).toBe(true);
    });

    it('ignores an empty cue name', () => {
      const { engine } = makeEngine({ sections: [{ name: 'One' }] });
      expect(engine.fireCue('')).toBe(false);
    });

    it('lets a cue jump past the scenario\'s order, which is the point of a cue', () => {
      const { engine, play } = makeEngine({
        sections: [
          { name: 'One', hold: { bars: 64 }, transition: { quantize: 'off' } },
          { name: 'Two', transition: { quantize: 'off' } },
          { name: 'Drop', enter: { cue: 'drop' }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      engine.fireCue('drop');
      play(0.1);
      expect(engine.currentSection.name).toBe('Drop');
    });
  });

  describe('moves', () => {
    it('fires a move at its bar and only once', () => {
      const { engine, executor, play } = makeEngine({
        sections: [{
          name: 'One',
          hold: { bars: 64 },
          moves: [{ at: { bars: 2 }, do: [{ type: 'param', node: 'A', param: 'x', to: 1 }] }],
        }],
      });
      engine.start();
      play(BAR_SECONDS * 1);
      expect(executor.ofType('param')).toHaveLength(0);

      play(BAR_SECONDS * 4);
      expect(executor.ofType('param')).toHaveLength(1);
    });

    it('fires a repeating move more than once per visit', () => {
      const { engine, executor, play } = makeEngine({
        sections: [{
          name: 'One',
          hold: { bars: 64 },
          moves: [{ at: { bars: 1 }, repeat: true, do: [{ type: 'log', message: 'tick' }] }],
        }],
      });
      engine.start();
      play(BAR_SECONDS * 3);
      expect(executor.ofType('log').length).toBeGreaterThan(1);
    });

    it('requires both when a move has a time and a condition', () => {
      const { engine, executor, play } = makeEngine({
        sections: [{
          name: 'One',
          hold: { bars: 64 },
          moves: [{
            at: { bars: 1 },
            when: 'energy > 0.8',
            do: [{ type: 'log', message: 'both' }],
          }],
        }],
      });
      engine.start();
      play(BAR_SECONDS * 4);
      expect(executor.ofType('log')).toHaveLength(0);

      engine.signals.setEnergy(0.9);
      play(BAR_SECONDS);
      expect(executor.ofType('log')).toHaveLength(1);
    });

    it('starts a section\'s moves over when it is entered again', () => {
      const { engine, executor, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          {
            name: 'One',
            transition: { quantize: 'off' },
            moves: [{ at: { bars: 0 }, do: [{ type: 'log', message: 'in' }] }],
          },
          { name: 'Two', enter: { bars: 1 }, hold: { bars: 1 }, next: 'one', transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 6);
      expect(executor.ofType('log').length).toBeGreaterThan(1);
    });
  });

  describe('quantisation', () => {
    it('holds a section change until the bar line', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One' },
          { name: 'Drop', enter: { cue: 'drop' }, transition: { type: 'cut', quantize: 'bar' } },
        ],
      });
      engine.start();
      play(0.5); // a quarter of the way into bar 0
      engine.fireCue('drop');
      play(0.1);
      expect(engine.currentSection.name).toBe('One');

      play(BAR_SECONDS);
      expect(engine.currentSection.name).toBe('Drop');
    });

    it('still lands a change whose condition stopped being true while it waited', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One' },
          { name: 'Two', enter: { when: 'energy > 0.5' }, transition: { quantize: 'bar' } },
        ],
      });
      engine.start();
      play(0.2);
      engine.signals.setEnergy(1);
      play(0.05);
      engine.signals.setEnergy(0); // the moment passed; the decision stands
      play(BAR_SECONDS);
      expect(engine.currentSection.name).toBe('Two');
    });

    it('falls back to the bar when the grid is absurdly far off', () => {
      const { engine, play } = makeEngine({
        barsPerPhrase: 64,
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One' },
          { name: 'Drop', enter: { cue: 'drop' }, transition: { quantize: 'phrase' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 2);
      engine.fireCue('drop');
      play(0.1);
      // Waiting 62 bars for a phrase line is not quantising, it is hanging.
      expect(engine.currentSection.name).toBe('One');

      play(BAR_SECONDS);
      expect(engine.currentSection.name).toBe('Drop');
      expect(engine.log.some((e) => /cutting to the next bar/.test(e.message))).toBe(true);
    });
  });

  describe('the fence', () => {
    it('drops actions once the bar\'s budget is spent', () => {
      const { engine, executor, play } = makeEngine({
        rules: { maxActionsPerBar: 3, minSectionBars: 0 },
        sections: [{
          name: 'One',
          hold: { bars: 64 },
          moves: Array.from({ length: 10 }, (_, i) => ({
            at: { bars: 0 },
            do: [{ type: 'log', message: `m${i}` }],
          })),
        }],
      });
      engine.start();
      play(0.05);
      expect(executor.performed.length).toBeLessThanOrEqual(3);
      expect(engine.log.some((e) => /Budget spent/.test(e.message))).toBe(true);
    });

    it('refills the budget each bar', () => {
      const { engine, executor, play } = makeEngine({
        rules: { maxActionsPerBar: 2, minSectionBars: 0 },
        sections: [{
          name: 'One',
          hold: { bars: 64 },
          moves: [{ at: { bars: 0 }, repeat: true, do: [{ type: 'log', message: 'x' }] }],
        }],
      });
      engine.start();
      play(BAR_SECONDS * 4);
      expect(executor.ofType('log').length).toBeGreaterThan(2);
    });

    it('logs why an action the executor refused did not happen', () => {
      const { engine, executor, play } = makeEngine({
        sections: [{ name: 'One', onEnter: [{ type: 'scene', scene: 'x' }] }],
      });
      executor.refuseNext = 'too soon since the last scene change';
      engine.start();
      play(0.05);
      expect(engine.log.some((e) => /too soon/.test(e.message))).toBe(true);
    });
  });

  describe('conditions', () => {
    it('retires a broken condition instead of throwing sixty times a second', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One', transition: { quantize: 'off' } },
          { name: 'Two', enter: { when: 'nonsense_signal > 1' }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 2);

      const complaints = engine.log.filter((e) => /is broken/.test(e.message));
      expect(complaints).toHaveLength(1);
      expect(engine.currentSection.name).toBe('One');
    });

    it('publishes the section\'s own position for conditions to read', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { name: 'One', transition: { quantize: 'off' } },
          { name: 'Two', enter: { when: 'sectionBars > 3' }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 2);
      expect(engine.currentSection.name).toBe('One');
      play(BAR_SECONDS * 3);
      expect(engine.currentSection.name).toBe('Two');
    });
  });

  describe('reloading a scenario mid-set', () => {
    it('stays in the section it was in when that section survived the edit', () => {
      const { engine, play } = makeEngine({
        rules: { minSectionBars: 0 },
        sections: [
          { id: 'a', name: 'A', transition: { quantize: 'off' } },
          { id: 'b', name: 'B', enter: { bars: 1 }, transition: { quantize: 'off' } },
        ],
      });
      engine.start();
      play(BAR_SECONDS * 2);
      expect(engine.currentSection.id).toBe('b');

      engine.loadScenario({
        sections: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B renamed' },
          { id: 'c', name: 'C' },
        ],
      });
      expect(engine.currentSection.id).toBe('b');
      expect(engine.currentSection.name).toBe('B renamed');
    });

    it('falls back to the first section when the one it was in is gone', () => {
      const { engine, play } = makeEngine({
        sections: [{ id: 'a', name: 'A' }],
      });
      engine.start();
      play(1);
      engine.loadScenario({ sections: [{ id: 'z', name: 'Z' }] });
      expect(engine.currentSection.id).toBe('z');
    });
  });
});
