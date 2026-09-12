// The OSC control namespace: the musician's hands on the performer.
//
// Most of these are about the two things that cost a set: a button that sends
// on press AND release, and a bang that carries no value at all.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PerformerOSC } from '../src/performer/PerformerOSC.js';

function makeRig() {
  const engine = {
    started: 0, stopped: 0, paused: 0, panicked: 0,
    cues: [], jumps: [], nexts: 0, performed: [],
    clock: {
      bpm: 120, taps: 0, barSyncs: 0, beatSyncs: 0,
      setBPM(value) { if (value > 0 && value < 300) { this.bpm = value; return true; } return false; },
      tap() { this.taps++; },
      syncToBar() { this.barSyncs++; },
      syncToBeat() { this.beatSyncs++; },
    },
    signals: { pushed: [], energy: 0, push(n, v) { this.pushed.push([n, v]); }, setEnergy(v) { this.energy = v; } },
    director: { enabled: false, steer: '', setEnabled(v) { this.enabled = v; }, setSteer(v) { this.steer = v; } },
    // The engine owns the switch, not the director: turning the director on
    // also turns on the listening the director reads from.
    setDirectorEnabled(v) { return this.director.setEnabled(v); },
    // Tempo goes through the engine, not straight at the clock: one door for
    // the panel, OSC, a tap, and whatever sets it next.
    setBPM(v) { return this.clock.setBPM(v); },
    tapTempo() { this.clock.tap(); return this.clock.bpm; },
    syncBar() { this.clock.syncToBar(); },
    syncBeat() { this.clock.syncToBeat(); },
    start() { this.started++; },
    stop() { this.stopped++; },
    pause() { this.paused++; },
    panic() { this.panicked++; },
    fireCue(name) { this.cues.push(name); return true; },
    jumpToSection(ref, source) { this.jumps.push([ref, source]); return true; },
    nextSection() { this.nexts++; return true; },
    perform(action, source) { this.performed.push([action, source]); },
  };

  const router = new PerformerOSC(engine);
  const send = (address, args = []) => router.handle({ address, args });
  return { engine, router, send };
}

describe('PerformerOSC', () => {
  let rig;
  beforeEach(() => { rig = makeRig(); });

  it('ignores anything outside its prefix', () => {
    expect(rig.send('/live/fader', [1])).toBeNull();
    expect(rig.engine.started).toBe(0);
  });

  describe('transport', () => {
    it('takes a bang with no argument at all', () => {
      rig.send('/rhizo/perf/start');
      expect(rig.engine.started).toBe(1);
    });

    it('takes a button press', () => {
      rig.send('/rhizo/perf/start', [1]);
      expect(rig.engine.started).toBe(1);
    });

    it('does not fire again on the release, which is what a button also sends', () => {
      rig.send('/rhizo/perf/start', [1]);
      rig.send('/rhizo/perf/start', [0]);
      expect(rig.engine.started).toBe(1);
    });

    it('fires again on the next press', () => {
      rig.send('/rhizo/perf/start', [1]);
      rig.send('/rhizo/perf/start', [0]);
      rig.send('/rhizo/perf/start', [1]);
      expect(rig.engine.started).toBe(2);
    });

    it('lets a bang-only sender fire twice in a row', () => {
      rig.send('/rhizo/perf/tap');
      rig.send('/rhizo/perf/tap');
      expect(rig.engine.clock.taps).toBe(2);
    });

    it('routes stop, pause and panic', () => {
      rig.send('/rhizo/perf/stop');
      rig.send('/rhizo/perf/pause');
      rig.send('/rhizo/perf/panic');
      expect(rig.engine.stopped).toBe(1);
      expect(rig.engine.paused).toBe(1);
      expect(rig.engine.panicked).toBe(1);
    });
  });

  describe('cues', () => {
    it('fires a cue named in the argument', () => {
      rig.send('/rhizo/perf/cue', ['drop']);
      expect(rig.engine.cues).toEqual(['drop']);
    });

    it('fires a cue named in the address, for a sender that only bangs', () => {
      rig.send('/rhizo/perf/cue/drop');
      expect(rig.engine.cues).toEqual(['drop']);
    });

    it('does not swallow a second, different cue as a repeat', () => {
      rig.send('/rhizo/perf/cue', ['a']);
      rig.send('/rhizo/perf/cue', ['b']);
      expect(rig.engine.cues).toEqual(['a', 'b']);
    });

    it('edge-triggers a cue bound to a button', () => {
      rig.send('/rhizo/perf/cue/drop', [1]);
      rig.send('/rhizo/perf/cue/drop', [0]);
      rig.send('/rhizo/perf/cue/drop', [1]);
      expect(rig.engine.cues).toEqual(['drop', 'drop']);
    });

    it('ignores a cue message with no name', () => {
      rig.send('/rhizo/perf/cue', []);
      expect(rig.engine.cues).toEqual([]);
    });
  });

  describe('sections', () => {
    it('jumps by name', () => {
      rig.send('/rhizo/perf/section', ['drop']);
      expect(rig.engine.jumps[0]).toEqual(['drop', 'osc']);
    });

    it('jumps by index, as a grid controller sends', () => {
      rig.send('/rhizo/perf/section', [2]);
      expect(rig.engine.jumps[0]).toEqual([2, 'osc']);
    });

    it('moves the set on', () => {
      rig.send('/rhizo/perf/next');
      expect(rig.engine.nexts).toBe(1);
    });
  });

  describe('tempo', () => {
    it('sets the tempo', () => {
      rig.send('/rhizo/perf/bpm', [140]);
      expect(rig.engine.clock.bpm).toBe(140);
    });

    it('refuses a tempo the clock will not take', () => {
      rig.send('/rhizo/perf/bpm', [0]);
      expect(rig.engine.clock.bpm).toBe(120);
    });

    it('realigns the grid on a downbeat', () => {
      rig.send('/rhizo/perf/bar');
      rig.send('/rhizo/perf/beat');
      expect(rig.engine.clock.barSyncs).toBe(1);
      expect(rig.engine.clock.beatSyncs).toBe(1);
    });
  });

  describe('signals', () => {
    it('takes the musician\'s stated energy', () => {
      rig.send('/rhizo/perf/energy', [0.75]);
      expect(rig.engine.signals.energy).toBe(0.75);
    });

    it('drives a named signal directly', () => {
      rig.send('/rhizo/perf/signal/bass', [0.4]);
      expect(rig.engine.signals.pushed).toEqual([['bass', 0.4]]);
    });

    it('does not edge-trigger a continuous value, which would make a fader fire once', () => {
      rig.send('/rhizo/perf/energy', [0.2]);
      rig.send('/rhizo/perf/energy', [0.4]);
      rig.send('/rhizo/perf/energy', [0.6]);
      expect(rig.engine.signals.energy).toBe(0.6);
    });
  });

  describe('the director', () => {
    it('is let in and shut out', () => {
      rig.send('/rhizo/perf/director', [1]);
      expect(rig.engine.director.enabled).toBe(true);
      rig.send('/rhizo/perf/director', [0]);
      expect(rig.engine.director.enabled).toBe(false);
    });

    it('takes a line of direction', () => {
      rig.send('/rhizo/perf/steer', ['keep it dark']);
      expect(rig.engine.director.steer).toBe('keep it dark');
    });
  });

  describe('output', () => {
    it('moves the master fader', () => {
      rig.send('/rhizo/perf/master', [0.5]);
      expect(rig.engine.performed[0][0]).toMatchObject({ type: 'master', to: 0.5 });
    });

    it('kills and restores the output', () => {
      rig.send('/rhizo/perf/blackout', [1]);
      expect(rig.engine.performed[0][0]).toMatchObject({ type: 'blackout', on: true });
      rig.send('/rhizo/perf/blackout', [0]);
      expect(rig.engine.performed[1][0]).toMatchObject({ type: 'blackout', on: false });
    });
  });

  describe('attaching', () => {
    it('subscribes once and unsubscribes cleanly', () => {
      const handlers = new Map();
      const eventSystem = {
        on: vi.fn((name, fn) => handlers.set(name, fn)),
        off: vi.fn((name) => handlers.delete(name)),
      };
      const router = new PerformerOSC(rig.engine, { eventSystem });

      expect(router.attach()).toBe(true);
      expect(router.attach()).toBe(false);
      expect(eventSystem.on).toHaveBeenCalledTimes(1);

      handlers.get('OSC_MESSAGE')({ address: '/rhizo/perf/start', args: [] });
      expect(rig.engine.started).toBe(1);

      expect(router.detach()).toBe(true);
      expect(eventSystem.off).toHaveBeenCalledTimes(1);
    });

    it('lists what arrived, so the artist can see their sender', () => {
      rig.send('/rhizo/perf/energy', [0.5]);
      expect(rig.router.activity()[0].address).toBe('/rhizo/perf/energy');
    });
  });
});
