// The musical clock. Everything here is about the three things a VJ clock has
// to survive that a metronome does not: a tempo change mid-set, a backgrounded
// tab, and a musician whose downbeat is not the software's.

import { describe, it, expect, beforeEach } from 'vitest';
import { PerformerClock } from '../src/performer/PerformerClock.js';

/** A clock driven by a number we control, so a set runs in a millisecond. */
function makeClock(options = {}) {
  const state = { now: 0 };
  const clock = new PerformerClock({ now: () => state.now, ...options });
  // Advance real seconds, in frames small enough not to hit the tick ceiling.
  const advance = (seconds, frameMs = 16) => {
    const steps = Math.max(1, Math.round((seconds * 1000) / frameMs));
    for (let i = 0; i < steps; i++) {
      state.now += (seconds * 1000) / steps;
      clock.tick();
    }
  };
  return { clock, state, advance };
}

describe('PerformerClock', () => {
  let rig;
  beforeEach(() => { rig = makeClock({ bpm: 120, beatsPerBar: 4, barsPerPhrase: 8 }); });

  it('banks nothing before it is started', () => {
    rig.advance(10);
    expect(rig.clock.beats).toBe(0);
  });

  it('counts beats at the tempo', () => {
    rig.clock.start();
    rig.advance(2); // 2s at 120 BPM = 4 beats
    expect(rig.clock.beats).toBeCloseTo(4, 2);
    expect(rig.clock.bar).toBe(1);
  });

  it('keeps counting past the bar rather than wrapping', () => {
    rig.clock.start();
    rig.advance(20.5); // 41 beats
    expect(rig.clock.beats).toBeCloseTo(41, 1);
    expect(rig.clock.bar).toBe(10);
    expect(rig.clock.phrase).toBe(1);
  });

  it('leaves banked position alone when the tempo changes', () => {
    rig.clock.start();
    rig.advance(4); // 8 beats at 120
    const before = rig.clock.beats;

    rig.clock.setBPM(180);
    expect(rig.clock.beats).toBeCloseTo(before, 5);

    rig.advance(4); // 12 more beats at 180
    expect(rig.clock.beats).toBeCloseTo(before + 12, 1);
  });

  it('refuses a tempo outside what a performance can use', () => {
    expect(rig.clock.setBPM(0)).toBe(false);
    expect(rig.clock.setBPM(9999)).toBe(false);
    expect(rig.clock.setBPM(NaN)).toBe(false);
    expect(rig.clock.bpm).toBe(120);
  });

  it('does not fast-forward the set after a backgrounded tab', () => {
    rig.clock.start();
    // One frame carrying a whole minute, as a tab that was asleep delivers.
    rig.state.now += 60_000;
    rig.clock.tick();
    // Half a second banked, not sixty.
    expect(rig.clock.beats).toBeLessThanOrEqual(1.1);
  });

  it('ignores a timestamp that goes backwards', () => {
    rig.clock.start();
    rig.advance(2);
    const before = rig.clock.beats;
    rig.clock.tick(-100000);
    expect(rig.clock.beats).toBeCloseTo(before, 5);
  });

  it('pauses and resumes without losing position', () => {
    rig.clock.start();
    rig.advance(2);
    const at = rig.clock.beats;

    rig.clock.pause();
    rig.state.now += 10_000;
    rig.clock.tick();
    expect(rig.clock.beats).toBeCloseTo(at, 5);

    rig.clock.resume();
    rig.advance(1);
    expect(rig.clock.beats).toBeCloseTo(at + 2, 1);
  });

  describe('phases', () => {
    it('reports where it is inside the beat, bar and phrase', () => {
      rig.clock.start();
      rig.advance(0.25); // half a beat at 120
      expect(rig.clock.beatPhase).toBeCloseTo(0.5, 1);
      expect(rig.clock.barPhase).toBeCloseTo(0.125, 1);
    });
  });

  describe('staying with the musician', () => {
    it('snaps the grid forward to the nearest bar, not back', () => {
      rig.clock.start();
      rig.advance(7.9); // 15.8 beats — just short of bar 4
      rig.clock.syncToBar();
      expect(rig.clock.beats).toBe(16);
      expect(rig.clock.bar).toBe(4);
    });

    it('sets a tempo from two taps', () => {
      rig.clock.start();
      const bpm = (() => {
        rig.clock.tap(0);
        return rig.clock.tap(500); // 500ms apart = 120 BPM
      })();
      expect(bpm).toBeCloseTo(120, 0);
    });

    it('starts a new measurement after a long gap rather than averaging over it', () => {
      rig.clock.tap(0);
      rig.clock.tap(500);
      rig.clock.tap(10_000);      // way past the window
      const bpm = rig.clock.tap(10_250); // 250ms = 240 BPM
      expect(bpm).toBeCloseTo(240, 0);
    });
  });

  describe('quantisation', () => {
    it('says a boundary is now when it is standing on one', () => {
      rig.clock.start();
      expect(rig.clock.secondsUntil('bar')).toBe(0);
      expect(rig.clock.secondsUntil('off')).toBe(0);
    });

    it('measures the wait to the next bar', () => {
      rig.clock.start();
      rig.advance(0.5); // one beat in; three to go at 0.5s each
      expect(rig.clock.secondsUntil('bar')).toBeCloseTo(1.5, 1);
    });

    it('measures the wait to the next phrase', () => {
      rig.clock.start();
      rig.advance(1);
      // A phrase is 32 beats = 16s at 120 BPM; one second in leaves 15.
      expect(rig.clock.secondsUntil('phrase')).toBeCloseTo(15, 1);
    });

    it('gives the next boundary as a position, so a queued action survives the condition that queued it', () => {
      rig.clock.start();
      rig.advance(0.6);
      expect(rig.clock.nextBoundaryBeats('bar')).toBe(4);
      expect(rig.clock.nextBoundaryBeats('beat')).toBe(2);
    });
  });
});
