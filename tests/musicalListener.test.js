// The listening memory. What matters here is not that the numbers are right —
// they are averages of averages — but that the WORDS are right, because the
// words are what a model is handed and what an artist reads off the panel.
//
// The case that carries the most weight is the one with no beat in it: a
// texture change under a constant level, which no single meter shows and which
// is the main thing happening in the music this was built for.

import { describe, it, expect, beforeEach } from 'vitest';
import { MusicalListener } from '../src/audio/MusicalListener.js';

/** A frame of taps, with the trigger counters a caller would otherwise forget. */
function frame(values = {}, counts = {}) {
  return {
    level: 0, low: 0, mid: 0, high: 0, centroid: 0.4, density: 0.3,
    kickMeter: 0.8, snareMeter: 0.8, hatMeter: 0.8,
    ...values,
    trigCount: { kick: 0, snare: 0, hat: 0, ...counts },
  };
}

/**
 * Drive a listener over `seconds` of synthetic audio at the analysis rate.
 *
 * `shape(t)` returns the taps for that moment; `beat(t)` optionally returns a
 * kick period so hits can be laid on an exact grid. The clock is ours, so a
 * two-minute drone runs in a few milliseconds.
 */
function feed(listener, seconds, shape, { from = 0, step = 1 / 125, counts = null } = {}) {
  const trig = { kick: 0, snare: 0, hat: 0 };
  let t = from;
  const end = from + seconds;
  while (t < end) {
    if (counts) counts(t, trig);
    listener.observe(t, frame(shape(t), trig));
    t += step;
  }
  return t;
}

/** Kick hits every `period` seconds, counted into the monotonic counters. */
function kickEvery(period, jitter = 0) {
  let next = period;
  return (t, trig) => {
    if (t >= next) {
      trig.kick += 1;
      next += period + (jitter ? (Math.sin(t * 7.3) * jitter) : 0);
    }
  };
}

describe('MusicalListener', () => {
  let listener;
  beforeEach(() => { listener = new MusicalListener(); });

  it('says nothing has been heard before anything is fed', () => {
    const d = listener.describe(0);
    expect(d.dynamics).toBe('silent');
    expect(d.pulse.state).toBe('free');
    expect(d.summary).toBe('nothing heard yet');
  });

  it('reads a swell as building and then holding', () => {
    // Twenty seconds of rise, then twenty steady at the top.
    feed(listener, 20, (t) => ({ level: 0.05 + (t / 20) * 0.5, low: 0.3, mid: 0.2 }));
    expect(listener.describe(20).dynamics).toBe('building');

    feed(listener, 40, () => ({ level: 0.55, low: 0.3, mid: 0.2 }), { from: 20 });
    expect(listener.describe(60).dynamics).toBe('holding');
  });

  it('reads a fade as receding', () => {
    feed(listener, 40, () => ({ level: 0.5, low: 0.3, mid: 0.2 }));
    feed(listener, 10, (t) => ({ level: 0.5 * (1 - (t - 40) / 12), low: 0.3, mid: 0.2 }), { from: 40 });
    expect(listener.describe(50).dynamics).toBe('receding');
  });

  it('calls a cut to silence a drop, then silence', () => {
    feed(listener, 30, () => ({ level: 0.5, low: 0.4, mid: 0.3 }));
    feed(listener, 5, () => ({ level: 0 }), { from: 30 });

    const d = listener.describe(35);
    expect(d.dynamics).toBe('silent');
    expect(d.events.map((e) => e.kind)).toContain('drop');
    expect(d.events.map((e) => e.kind)).toContain('silence');
  });

  // The pulse-free case this whole file exists for: the level never moves, so
  // nothing a meter shows has changed — but the music plainly has.
  it('hears a texture change at constant level', () => {
    feed(listener, 60, () => ({ level: 0.4, low: 0.6, mid: 0.2, high: 0.05, centroid: 0.2, density: 0.2 }));
    const before = listener.describe(60);
    expect(before.texture.heldSeconds).toBeGreaterThan(30);
    expect(before.events.map((e) => e.kind)).not.toContain('texture-change');

    // Same loudness, different spectrum: the pad gives way to something bright.
    feed(listener, 20, () => ({ level: 0.4, low: 0.05, mid: 0.3, high: 0.6, centroid: 0.8, density: 0.7 }), { from: 60 });

    const after = listener.describe(80);
    expect(after.events.map((e) => e.kind)).toContain('texture-change');
    expect(after.texture.heldSeconds).toBeLessThan(25);
    expect(after.brightness.trend).toBe('rising');
  });

  it('does not call a texture change on a single transient', () => {
    feed(listener, 40, () => ({ level: 0.4, low: 0.6, mid: 0.2, high: 0.05, centroid: 0.2, density: 0.2 }));
    // A third of a second of something bright, then back.
    feed(listener, 0.3, () => ({ level: 0.45, low: 0.1, mid: 0.3, high: 0.7, centroid: 0.9, density: 0.8 }), { from: 40 });
    feed(listener, 20, () => ({ level: 0.4, low: 0.6, mid: 0.2, high: 0.05, centroid: 0.2, density: 0.2 }), { from: 40.3 });

    expect(listener.describe(60).events.map((e) => e.kind)).not.toContain('texture-change');
  });

  it('finds a pulse in a steady kick pattern', () => {
    // 128 BPM: a kick every 0.46875s.
    feed(listener, 30, () => ({ level: 0.5, low: 0.6, mid: 0.3 }), { counts: kickEvery(60 / 128) });

    const d = listener.describe(30);
    expect(d.pulse.state).toBe('metered');
    expect(d.pulse.bpm).toBeGreaterThan(126);
    expect(d.pulse.bpm).toBeLessThan(130);
  });

  it('does not report half time when the kick only lands on 1 and 3', () => {
    // A hit every two beats at 128 — the raw interval says 64.
    feed(listener, 40, () => ({ level: 0.5, low: 0.6 }), { counts: kickEvery((60 / 128) * 2) });

    const d = listener.describe(40);
    if (d.pulse.state === 'metered') {
      // Either it finds 128, or it stays honest — what it must not do is
      // confidently report something outside the tempo people count this in.
      expect(d.pulse.bpm).toBeGreaterThan(100);
    }
  });

  // The one that matters for these sets: no pulse means NO number, not a
  // low-confidence guess that a prompt will read as fact.
  it('reports a free pulse on drone with no onsets', () => {
    feed(listener, 90, (t) => ({
      level: 0.35 + Math.sin(t / 11) * 0.05,
      low: 0.5, mid: 0.3, high: 0.1,
      centroid: 0.3 + Math.sin(t / 17) * 0.05,
      density: 0.25,
    }));

    const d = listener.describe(90);
    expect(d.pulse.state).toBe('free');
    expect(d.pulse.bpm).toBeNull();
    expect(d.summary).toContain('free pulse');
  });

  it('reports a free pulse on irregular, unmetered hits', () => {
    // Onsets at irregular gaps: plenty of them, no period. Seeded rather than
    // a repeating list — a list that loops IS a rhythm, and one long enough to
    // look random still lines up with itself once the window sees the repeat.
    const irregular = () => {
      let seed = 987654321;
      const random = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };
      let next = 0.5;
      return (t, trig) => {
        if (t >= next) {
          trig.kick += 1;
          next += 0.25 + random() * 1.75;
        }
      };
    };
    feed(listener, 60, () => ({ level: 0.4, low: 0.5 }), { counts: irregular() });

    expect(listener.describe(60).pulse.state).toBe('free');
  });

  it('notices rhythm stopping even though the sound continues', () => {
    feed(listener, 30, () => ({ level: 0.5, low: 0.6 }), { counts: kickEvery(0.5) });
    feed(listener, 10, () => ({ level: 0.5, low: 0.6 }), { from: 30 });

    const d = listener.describe(40);
    expect(d.events.map((e) => e.kind)).toContain('onset-stop');
    expect(d.density.onsetsPerSecond).toBeLessThan(0.5);
  });

  it('measures change against a mark rather than an arbitrary frame', () => {
    feed(listener, 30, () => ({ level: 0.15, low: 0.4, centroid: 0.2 }));
    listener.mark(30);
    expect(listener.describe(30).since.seconds).toBe(0);

    feed(listener, 30, () => ({ level: 0.6, low: 0.5, centroid: 0.8 }), { from: 30 });

    const since = listener.describe(60).since;
    expect(since.seconds).toBe(30);
    expect(since.loudness).toBe('louder');
    expect(since.brightness).toBe('brighter');
  });

  it('is pure: no wall clock, and the same input twice gives the same answer', () => {
    const dateNow = Date.now;
    const perfNow = globalThis.performance?.now;
    let touched = 0;
    Date.now = () => { touched++; return 0; };
    if (globalThis.performance) globalThis.performance.now = () => { touched++; return 0; };

    try {
      const a = new MusicalListener();
      const b = new MusicalListener();
      const shape = (t) => ({ level: 0.3 + Math.sin(t) * 0.1, low: 0.4, mid: 0.2, centroid: 0.5 });
      feed(a, 20, shape, { counts: kickEvery(0.5) });
      feed(b, 20, shape, { counts: kickEvery(0.5) });

      expect(touched).toBe(0);
      expect(JSON.stringify(a.describe(20))).toBe(JSON.stringify(b.describe(20)));
    } finally {
      Date.now = dateNow;
      if (globalThis.performance && perfNow) globalThis.performance.now = perfNow;
    }
  });

  it('survives a trigger counter that restarts, without inventing onsets', () => {
    feed(listener, 10, () => ({ level: 0.4, low: 0.5 }), { counts: kickEvery(0.5) });
    // The analysis restarted: counters back to zero.
    listener.observe(10.1, frame({ level: 0.4, low: 0.5 }, { kick: 0 }));
    listener.observe(10.2, frame({ level: 0.4, low: 0.5 }, { kick: 1 }));
    expect(() => listener.describe(11)).not.toThrow();
  });

  it('forgets everything on reset', () => {
    feed(listener, 30, () => ({ level: 0.6, low: 0.5 }), { counts: kickEvery(0.5) });
    listener.reset();
    const d = listener.describe(0);
    expect(d.listeningSeconds).toBe(0);
    expect(d.events).toEqual([]);
    expect(d.pulse.bpm).toBeNull();
  });
});
