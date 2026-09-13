// Does the listening actually reach the performer?
//
// The unit tests either side of this one prove the listener hears correctly
// and that the cadence decides correctly. Neither proves the wire between
// them, and that wire runs through four files: the analysis publishes taps,
// the store holds the listener, the engine asks it to, and the director reads
// it. Every one of those is a place where the whole feature can be silently
// off — a director with nothing to say looks exactly the same as a director
// that was never given anything to hear.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioAnalysisProcessor } from '../src/core/AudioAnalysisProcessor.js';
import { PerformerEngine } from '../src/performer/PerformerEngine.js';
import { PerformerClock } from '../src/performer/PerformerClock.js';
import {
  musicalListeningWanted,
  resetMusicalListening,
  setMusicalListeningWanted,
} from '../src/audio/musicalListening.js';

function setBands(values = {}) {
  const out = {
    level: 0, low: 0, mid: 0, high: 0, kick: 0, snare: 0, hat: 0,
    centroid: 0, density: 0, presence: {}, ...values,
  };
  for (const b of ['low', 'mid', 'high', 'kick', 'snare', 'hat']) out.presence[b] = (out[b] || 0) > 0;
  window._audioBands = out;
}

/** The analysis engine, its own timer, and a performer reading what it hears. */
function makeRig() {
  const setup = { id: 'setup', kind: 'Audio', params: { kickThresh: 0.5 }, inputs: [] };
  const nodes = [setup];
  const graph = { nodes, getNode: (id) => nodes.find((n) => n.id === id) };
  const um = { uniformValues: new Map() };

  const listeners = [];
  const proc = new AudioAnalysisProcessor();
  proc._audioClient = {
    tick() {},
    updateConfig() {},
    on(event, fn) { if (event === 'analysis') listeners.push(fn); },
  };

  const director = {
    enabled: false,
    listener: null,
    asked: [],
    setEnabled(v) { this.enabled = v; return v; },
    setListener(l) { this.listener = l; },
    offer(state) { if (this.enabled) this.asked.push(state); },
    take: () => null,
    status: () => ({}),
  };

  const engine = new PerformerEngine({
    clock: new PerformerClock({ now: () => 0 }),
    executor: {
      rules: null,
      execute: () => ({ ok: true, cost: 1 }),
      tick() {},
      clearDrives() {},
      status: () => ({ drives: [], ramps: [], blackedOut: false, transition: {}, sceneChangeInFlight: false }),
    },
    director,
  });
  engine.loadScenario({ sections: [{ id: 'a', name: 'A' }] });

  let t = 0;
  return {
    proc, graph, um, engine, director,
    /** A rendered frame, which is also what keeps the analysis alive. */
    frame(seconds) {
      t = seconds;
      proc.update(graph, { time: t, now: t, uniformManager: um });
    },
    /** One analysis step: the engine's own timer, finer than the frame. */
    step(seconds, bands) {
      t = seconds;
      proc._clock = seconds;
      setBands(bands);
      for (const fn of listeners) fn();
    },
    /** Seconds of sound, at the analysis rate, with a frame every 60th. */
    play(from, seconds, bands, { kick = null } = {}) {
      let nextKick = kick === null ? Infinity : from + kick;
      for (let s = from; s < from + seconds; s += 1 / 125) {
        const hit = s >= nextKick;
        if (hit) nextKick += kick;
        this.step(s, { ...bands, kick: hit ? 0.9 : 0 });
        if (Math.round(s * 125) % 2 === 0) this.frame(s);
      }
      return from + seconds;
    },
  };
}

beforeEach(() => {
  setBands();
  resetMusicalListening();
  setMusicalListeningWanted(false);
});

afterEach(() => {
  setMusicalListeningWanted(false);
  resetMusicalListening();
  delete window._audioBands;
});

describe('listening, wired end to end', () => {
  it('costs nothing until the director is on', () => {
    const rig = makeRig();
    rig.play(0, 2, { level: 0.5, low: 0.5 });

    expect(musicalListeningWanted()).toBe(false);
    expect(rig.engine.listening()).toBeNull();
  });

  it('carries real audio all the way to the engine', () => {
    const rig = makeRig();
    rig.engine.setDirectorEnabled(true);
    expect(musicalListeningWanted()).toBe(true);

    rig.play(0, 30, { level: 0.45, low: 0.5, mid: 0.2, centroid: 0.3, density: 0.25 });

    const heard = rig.engine.listening();
    expect(heard).not.toBeNull();
    expect(heard.listeningSeconds).toBeGreaterThan(20);
    expect(heard.dynamics).not.toBe('silent');
  });

  it('hands the same listener to the director', () => {
    const rig = makeRig();
    rig.engine.setDirectorEnabled(true);
    expect(rig.director.listener).not.toBeNull();

    rig.play(0, 10, { level: 0.4, low: 0.4 });
    expect(rig.director.listener.describe(10).listeningSeconds).toBeGreaterThan(5);
  });

  it('puts what it heard into the state the director is offered', () => {
    const rig = makeRig();
    rig.engine.setDirectorEnabled(true);
    rig.engine.start();
    rig.play(0, 12, { level: 0.4, low: 0.5, centroid: 0.3 });

    rig.engine.tick();
    const offered = rig.director.asked.at(-1);
    expect(offered.listening).not.toBeNull();
    expect(offered.listening.pulse).toBeDefined();
    expect(offered.askedAtSeconds).toBeTypeOf('number');
  });

  // Real trigger edges, through the real detector, reaching the pulse
  // estimator. This is the path the unit test fakes with synthetic counters.
  it('reports a free pulse on unmetered audio and a tempo on metered', () => {
    const rig = makeRig();
    rig.engine.setDirectorEnabled(true);

    // Thirty seconds of drone: level and spectrum barely moving, nothing
    // crossing the kick threshold.
    let t = rig.play(0, 30, { level: 0.4, low: 0.5, mid: 0.25, centroid: 0.3, density: 0.3 });
    expect(rig.engine.listening().pulse.state).toBe('free');

    // The same rig, now with a kick on every beat at 128.
    rig.play(t, 45, { level: 0.5, low: 0.6, mid: 0.2, centroid: 0.3 }, { kick: 60 / 128 });

    const heard = rig.engine.listening();
    expect(heard.density.onsetsPerSecond).toBeGreaterThan(1);
    expect(heard.pulse.state).toBe('metered');
    expect(heard.pulse.bpm).toBeGreaterThan(125);
    expect(heard.pulse.bpm).toBeLessThan(131);
  });

  it('stops listening, and forgets, when the director goes off', () => {
    const rig = makeRig();
    rig.engine.setDirectorEnabled(true);
    rig.play(0, 20, { level: 0.5, low: 0.5 });
    expect(rig.engine.listening().listeningSeconds).toBeGreaterThan(10);

    rig.engine.setDirectorEnabled(false);
    expect(musicalListeningWanted()).toBe(false);
    expect(rig.engine.listening()).toBeNull();

    // A ninety-second memory of the last set is worse than no memory at all.
    rig.engine.setDirectorEnabled(true);
    expect(rig.engine.listening().listeningSeconds).toBe(0);
  });
});
