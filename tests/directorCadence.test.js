// When the model gets asked.
//
// The thing under test is a trade: ask often enough to feel like a
// co-performer, rarely enough that a two-hour set does not cost two hours of
// model time. Every case here is one side of that trade — the floor that
// bounds the spend, the novelty that beats the floor's timer, and the stretch
// that stops a drone being billed for staying a drone.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DirectorCadence,
  MIN_SECONDS,
  DEFAULT_EVERY_SECONDS,
  BOREDOM_CAP_SECONDS,
  DEFAULT_CALLS_PER_HOUR,
  BURST,
} from '../src/performer/DirectorCadence.js';

/** A listening description with only the fields the cadence reads. */
function heard({ events = [], heldSeconds = 10, pulse = { state: 'free', bpm: null }, listeningSeconds = 60 } = {}) {
  return { listeningSeconds, events, texture: { heldSeconds }, pulse };
}

function event(kind, secondsAgo, magnitude = 1) {
  return { kind, secondsAgo, magnitude };
}

/** A state with only the fields the cadence reads. */
function state(director = {}, now = {}) {
  return {
    scenario: { rules: { director: { enabled: true, ...director } } },
    now: { beatsPerBar: 4, bpm: 120, ...now },
  };
}

describe('DirectorCadence', () => {
  let clock;
  let cadence;

  beforeEach(() => {
    clock = { now: 1000 };
    cadence = new DirectorCadence({ now: () => clock.now });
  });

  it('asks straight away when there is no listener to wait for', () => {
    expect(cadence.shouldAsk(null, state())).toMatchObject({ reason: 'first' });
  });

  it('hears a little of the room before the first question', () => {
    expect(cadence.shouldAsk(heard({ listeningSeconds: 2 }), state())).toBeNull();
    expect(cadence.shouldAsk(heard({ listeningSeconds: 30 }), state())).toMatchObject({ reason: 'first' });
  });

  it('waits out the interval', () => {
    cadence.noteAsked('first');
    clock.now += (DEFAULT_EVERY_SECONDS - 5);
    expect(cadence.shouldAsk(heard(), state())).toBeNull();

    clock.now += 10;
    expect(cadence.shouldAsk(heard(), state())).toMatchObject({ reason: 'interval' });
  });

  it('asks early when the texture changes', () => {
    cadence.noteAsked('first');
    clock.now += MIN_SECONDS + 1;

    const d = heard({ events: [event('texture-change', 3)], heldSeconds: 3 });
    expect(cadence.shouldAsk(d, state())).toMatchObject({ reason: 'novelty' });
  });

  // The floor is the only thing bounding what a set can cost, so it holds
  // against anything — including music that is changing constantly.
  it('never breaks the floor, however much is happening', () => {
    cadence.noteAsked('first');
    const storm = heard({
      events: [event('drop', 0.5), event('swell', 0.2), event('texture-change', 0.1)],
      heldSeconds: 1,
    });

    for (let t = 0; t < MIN_SECONDS - 1; t += 0.5) {
      clock.now += 0.5;
      expect(cadence.shouldAsk(storm, state())).toBeNull();
    }

    clock.now += 1;
    expect(cadence.shouldAsk(storm, state())).toMatchObject({ reason: 'novelty' });
  });

  it('ignores an event that predates the last question', () => {
    cadence.noteAsked('first');
    clock.now += MIN_SECONDS + 1;

    // The drop happened two minutes ago; it was already news last time.
    const old = heard({ events: [event('drop', 120)], heldSeconds: 120 });
    expect(cadence.shouldAsk(old, state())).toBeNull();
  });

  it('ignores an event too small to be news', () => {
    cadence.noteAsked('first');
    clock.now += MIN_SECONDS + 1;

    const faint = heard({ events: [event('texture-change', 2, 0.05)], heldSeconds: 2 });
    expect(cadence.shouldAsk(faint, state())).toBeNull();
  });

  it('stretches the interval when nothing has changed, and caps the stretch', () => {
    const still = (held) => heard({ heldSeconds: held });

    cadence.noteAsked('first');
    const fresh = cadence.shouldAsk(still(5), state());
    expect(fresh).toBeNull();

    // Two minutes of the same texture: the interval is longer than it was.
    clock.now += DEFAULT_EVERY_SECONDS + 1;
    const stretched = cadence.shouldAsk(still(600), state());
    expect(stretched).toBeNull();
    expect(cadence.status().intervalSeconds).toBeGreaterThan(DEFAULT_EVERY_SECONDS);
    expect(cadence.status().intervalSeconds).toBeLessThanOrEqual(BOREDOM_CAP_SECONDS);

    // …but it does eventually come round.
    clock.now += BOREDOM_CAP_SECONDS;
    expect(cadence.shouldAsk(still(600), state())).toMatchObject({ reason: 'interval' });
  });

  it('takes everySeconds from the scenario', () => {
    cadence.noteAsked('first');
    clock.now += 31;
    expect(cadence.shouldAsk(heard(), state({ everySeconds: 30 }))).toMatchObject({ reason: 'interval' });
  });

  it('will not let a scenario ask more often than the floor', () => {
    cadence.noteAsked('first');
    clock.now += 3;
    expect(cadence.shouldAsk(heard(), state({ everySeconds: 2 }))).toBeNull();
    expect(cadence.status().intervalSeconds).toBe(MIN_SECONDS);
  });

  // The heart of it: a bar count is not a cadence unless there are bars.
  it('converts everyBars from the tempo it can hear', () => {
    const metered = heard({ pulse: { state: 'metered', bpm: 120, confidence: 0.9 } });
    cadence.noteAsked('first');
    // 8 bars of 4 beats at 120 BPM is 16 seconds — under the floor, so the
    // floor is what is enforced.
    cadence.shouldAsk(metered, state({ everyBars: 8 }));
    expect(cadence.status().intervalSeconds).toBe(MIN_SECONDS);

    // 16 bars at 120 is 32 seconds.
    cadence.shouldAsk(metered, state({ everyBars: 16 }));
    expect(cadence.status().intervalSeconds).toBe(32);
  });

  it('falls back to seconds when there is no pulse to convert against', () => {
    cadence.noteAsked('first');
    // The scenario says 64 bars. Without a pulse that is not 128 seconds, it
    // is nothing at all — so the seconds default stands.
    cadence.shouldAsk(heard(), state({ everyBars: 64 }));
    expect(cadence.status().intervalSeconds).toBe(DEFAULT_EVERY_SECONDS);
  });

  it('prefers an explicit everySeconds over everyBars', () => {
    const metered = heard({ pulse: { state: 'metered', bpm: 120, confidence: 0.9 } });
    cadence.noteAsked('first');
    cadence.shouldAsk(metered, state({ everyBars: 64, everySeconds: 25 }));
    expect(cadence.status().intervalSeconds).toBe(25);
  });

  it('reports what it is doing, for the panel', () => {
    cadence.noteAsked('novelty');
    clock.now += 10;
    const status = cadence.status();
    expect(status.reason).toBe('novelty');
    expect(status.sinceLastAsk).toBe(10);
    expect(status.nextInSeconds).toBe(DEFAULT_EVERY_SECONDS - 10);
  });

  it('starts over on reset', () => {
    cadence.noteAsked('first');
    cadence.reset();
    expect(cadence.shouldAsk(null, state())).toMatchObject({ reason: 'first' });
  });

  // The bound that actually decides what a set costs. The floor above spaces
  // two questions; it does nothing about a hundred and eighty of them.
  describe('the budget', () => {
    /** Ask as hard as the floor allows for `minutes`, and count what got through. */
    function hammer(cadence, minutes, s = state()) {
      const storm = heard({
        events: [event('texture-change', 1), event('drop', 0.5)],
        heldSeconds: 2,
      });
      let asks = 0;
      for (let t = 0; t < minutes * 60; t += 5) {
        clock.now += 5;
        // Keep the events "since the last ask" at every step.
        if (cadence.shouldAsk(storm, s)) {
          cadence.noteAsked('novelty');
          asks += 1;
        }
      }
      return asks;
    }

    it('holds an hour of constantly changing music to the allowance', () => {
      // Without the budget this is 180 calls against an allowance of 40, and
      // the artist runs dry half an hour into the set.
      const asks = hammer(cadence, 60);
      expect(asks).toBeLessThanOrEqual(DEFAULT_CALLS_PER_HOUR + BURST);
      expect(asks).toBeGreaterThan(DEFAULT_CALLS_PER_HOUR / 2);
    });

    it('spends a burst when the music suddenly changes, rather than sitting out', () => {
      // The first minute of a busy passage is exactly when a co-performer
      // earns its keep; a flat rate limit would make it miss that.
      const asks = hammer(cadence, 2);
      expect(asks).toBeGreaterThanOrEqual(BURST);
    });

    it('refuses rather than asks once the budget is gone, and says so', () => {
      // Ten minutes of relentless change. The floor alone would allow thirty
      // questions in that time; the budget covers about twelve, so the rest
      // was held back — and the panel has to be able to say so.
      hammer(cadence, 10);
      const status = cadence.status();
      expect(status.heldBack).toBeGreaterThan(0);
      expect(status.budgetLeft).toBeLessThan(BURST);
    });

    it('says how long until it can afford the next one', () => {
      // Drained by asking at the floor until it refuses, rather than by
      // spending a fixed count: the bucket refills while it is being emptied,
      // so "spent the burst" and "out of budget" are not the same moment.
      const storm = heard({ events: [event('drop', 1)], heldSeconds: 2 });
      let refused = false;
      for (let i = 0; i < 50 && !refused; i++) {
        clock.now += MIN_SECONDS + 1;
        if (cadence.shouldAsk(storm, state())) cadence.noteAsked('novelty');
        else refused = true;
      }

      expect(refused).toBe(true);
      const status = cadence.status();
      expect(status.budgetLeft).toBe(0);
      expect(status.budgetInSeconds).toBeGreaterThan(0);
      // At 40 an hour, one question is ninety seconds away at the very most.
      expect(status.budgetInSeconds).toBeLessThanOrEqual(90);
    });

    it('comes back once the budget has refilled', () => {
      hammer(cadence, 2);
      expect(cadence.shouldAsk(heard({ events: [event('drop', 1)] }), state())).toBeNull();

      // One question's worth of refill at 40/hour is 90 seconds.
      clock.now += 95;
      expect(cadence.shouldAsk(heard({ events: [event('drop', 1)] }), state())).toMatchObject({
        reason: 'novelty',
      });
    });

    it('takes a budget from the scenario', () => {
      const generous = state({ maxPerHour: 200 });
      const asks = hammer(cadence, 60, generous);
      expect(asks).toBeGreaterThan(DEFAULT_CALLS_PER_HOUR + BURST);
      expect(cadence.status().callsPerHour).toBe(200);
    });

    // A section change asks without consulting the cadence at all, and still
    // costs the artist a call.
    it('charges for an ask the cadence never suggested', () => {
      const before = cadence.status().budgetLeft;
      cadence.noteAsked('section');
      expect(cadence.status().budgetLeft).toBe(before - 1);
    });

    it('starts a new set with a full budget', () => {
      hammer(cadence, 2);
      expect(cadence.status().budgetLeft).toBeLessThan(BURST);
      cadence.reset();
      expect(cadence.status().budgetLeft).toBe(BURST);
      expect(cadence.status().heldBack).toBe(0);
    });
  });
});
