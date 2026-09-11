// Signals: normalisation, frame-rate-independent smoothing, and the scope a
// condition is evaluated against.

import { describe, it, expect } from 'vitest';
import { SignalBus } from '../src/performer/SignalBus.js';
import { PerformerClock } from '../src/performer/PerformerClock.js';
import { normalizeScenario } from '../src/performer/Scenario.js';

function busWith(signals, sources = {}) {
  const bus = new SignalBus(sources);
  bus.setScenario(normalizeScenario({ signals }));
  return bus;
}

describe('SignalBus', () => {
  it('normalises a sender\'s own range onto 0-1', () => {
    const osc = { getValue: () => 64 };
    const bus = busWith([{ name: 'cc', source: 'osc', address: '/cc', inputMin: 0, inputMax: 127 }], { osc });
    bus.update(1);
    expect(bus.value('cc')).toBeCloseTo(0.504, 2);
  });

  it('clamps a sender that overshoots its declared range', () => {
    const osc = { getValue: () => 500 };
    const bus = busWith([{ name: 'cc', source: 'osc', address: '/cc', inputMin: 0, inputMax: 127 }], { osc });
    bus.update(1);
    expect(bus.value('cc')).toBe(1);
  });

  it('passes a trigger channel through unsmoothed, so a one-frame kick survives', () => {
    let reading = 1;
    const audio = { audioTapValue: () => reading };
    const bus = busWith([{ name: 'kick', source: 'audio', channel: 'kickTrig' }], { audio });

    bus.update(0.016);
    expect(bus.value('kick')).toBe(1);

    reading = 0;
    bus.update(0.016);
    expect(bus.value('kick')).toBe(0);
  });

  it('smooths in seconds, so the same set behaves the same at 60Hz and 144Hz', () => {
    const audio = { audioTapValue: () => 1 };
    const slow = busWith([{ name: 'x', source: 'audio', channel: 'low', smooth: 0.5 }], { audio });
    const fast = busWith([{ name: 'x', source: 'audio', channel: 'low', smooth: 0.5 }], { audio });

    // Half a second of signal, delivered at two very different frame rates.
    for (let i = 0; i < 30; i++) slow.update(1 / 60);
    for (let i = 0; i < 72; i++) fast.update(1 / 144);

    expect(slow.value('x')).toBeCloseTo(fast.value('x'), 2);
    // One time constant covers 1 - 1/e of the distance.
    expect(slow.value('x')).toBeCloseTo(0.63, 1);
  });

  it('rises fast and falls slowly when attack and release differ', () => {
    let reading = 1;
    const audio = { audioTapValue: () => reading };
    const bus = busWith(
      [{ name: 'level', source: 'audio', channel: 'low', attack: 0.01, release: 1 }],
      { audio }
    );

    for (let i = 0; i < 6; i++) bus.update(1 / 60);
    const afterRise = bus.value('level');
    expect(afterRise).toBeGreaterThan(0.9);

    reading = 0;
    for (let i = 0; i < 6; i++) bus.update(1 / 60);
    // A tenth of a second into a one-second release: still most of the way up.
    expect(bus.value('level')).toBeGreaterThan(0.8);
  });

  it('decays a signal that stops arriving instead of freezing it', () => {
    let reading = 1;
    const osc = { getValue: () => reading };
    const bus = busWith([{ name: 'f', source: 'osc', address: '/f', smooth: 0.1 }], { osc });
    for (let i = 0; i < 20; i++) bus.update(1 / 60);
    expect(bus.value('f')).toBeGreaterThan(0.9);

    reading = 0; // the sender stopped; OSCManager keeps returning its last value
    for (let i = 0; i < 30; i++) bus.update(1 / 60);
    expect(bus.value('f')).toBeLessThan(0.05);
  });

  it('tracks how fast a signal is rising, which is what "building" means', () => {
    let reading = 0;
    const audio = { audioTapValue: () => reading };
    const bus = busWith([{ name: 'b', source: 'audio', channel: 'low', smooth: 0.1 }], { audio });
    bus.update(1 / 60);
    reading = 1;
    bus.update(1 / 60);
    expect(bus.scope().b_rise).toBeGreaterThan(0);
  });

  it('reads the clock without the scenario declaring it', () => {
    const clock = new PerformerClock({ bpm: 120 });
    const bus = new SignalBus({ clock });
    clock.start();
    expect(bus.value('bpm')).toBe(120);
    expect(bus.builtin('bar')).toBe(0);
  });

  it('takes a pushed value for one frame and then lets go of it', () => {
    const bus = busWith([{ name: 'm', source: 'manual', default: 0 }]);
    bus.push('m', 1);
    bus.update(1);
    expect(bus.value('m')).toBeCloseTo(1, 5);
    // A manual signal is a knob: it holds where it was put.
    bus.update(1);
    expect(bus.value('m')).toBeCloseTo(1, 5);
  });

  it('builds a condition scope with no prototype, so a signal named constructor is a number', () => {
    const bus = busWith([{ name: 'constructor', source: 'manual' }]);
    bus.update(1);
    const scope = bus.scope();
    expect(Object.getPrototypeOf(scope)).toBe(null);
    expect(typeof scope.constructor).toBe('number');
  });

  it('keeps a signal\'s smoothed state across a reload that did not change it', () => {
    const audio = { audioTapValue: () => 1 };
    const bus = busWith([{ name: 'x', source: 'audio', channel: 'low', smooth: 0.2 }], { audio });
    for (let i = 0; i < 30; i++) bus.update(1 / 60);
    const before = bus.value('x');

    bus.setScenario(normalizeScenario({
      signals: [{ name: 'x', source: 'audio', channel: 'low', smooth: 0.9 }],
    }));
    expect(bus.value('x')).toBeCloseTo(before, 5);
  });

  it('starts a signal over when its source changed', () => {
    const audio = { audioTapValue: () => 1 };
    const bus = busWith([{ name: 'x', source: 'audio', channel: 'low' }], { audio });
    for (let i = 0; i < 30; i++) bus.update(1 / 60);
    expect(bus.value('x')).toBeGreaterThan(0.5);

    bus.setScenario(normalizeScenario({
      signals: [{ name: 'x', source: 'audio', channel: 'high' }],
    }));
    expect(bus.value('x')).toBe(0);
  });

  it('marks a signal nothing has sent, so the director is not told it is zero', () => {
    const bus = busWith([{ name: 'quiet', source: 'osc', address: '/nothing' }], { osc: null });
    bus.update(1);
    expect(bus.snapshot().quiet.seen).toBe(false);
  });
});
