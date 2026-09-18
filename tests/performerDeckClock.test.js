// The set follows the deck.
//
// PerformerClock accumulates position from animation frames and refuses to
// bank more than half a second from any one of them, so a backgrounded tab
// cannot advance the set by thirty bars. The time it refuses is time it never
// gets back, and over a long stream that is the set sliding off the boundaries
// of the stem it was written against. When a file deck is playing, the deck's
// own playback position is the real clock and this is what follows it.

import { describe, it, expect } from 'vitest';
import { PerformerEngine } from '../src/performer/PerformerEngine.js';
import { PerformerClock } from '../src/performer/PerformerClock.js';

/** Nothing below the executor: these assert on position, not on pixels. */
const fakeExecutor = () => ({
  rules: null,
  execute: () => ({ ok: true, cost: 1 }),
  tick() {},
  clearDrives() {},
  status: () => ({ drives: [], ramps: [], blackedOut: false, transition: {}, sceneChangeInFlight: false }),
});

/** As much of BrowserAudioCapture as the engine reads, and no more. */
function fakeDeck({ kind = 'file', length = null } = {}) {
  return {
    kind,
    playing: true,
    at: 0,
    length,
    getSourceKind() { return this.kind; },
    getIsPlaying() { return this.playing; },
    getPlaybackSeconds() { return this.kind === 'file' ? this.at : null; },
    getPlaybackDuration() { return this.length; },
    /** Play `seconds` of file, wrapping at the end as a looping element does. */
    run(seconds) {
      this.at += seconds;
      if (this.length) this.at %= this.length;
    },
  };
}

function makeRig(deckOptions, scenario = { sections: [{ name: 'One' }] }) {
  const state = { now: 0 };
  const clock = new PerformerClock({ now: () => state.now, bpm: 120, beatsPerBar: 4 });
  const deck = fakeDeck(deckOptions);
  const engine = new PerformerEngine({ clock, deck, executor: fakeExecutor() });
  engine.loadScenario(scenario);

  /** Real seconds of frames at 60fps, with the deck playing through them. */
  const play = (seconds, { deckRuns = true } = {}) => {
    const frames = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < frames; i++) {
      state.now += (seconds * 1000) / frames;
      if (deckRuns) deck.run(seconds / frames);
      engine.tick();
    }
  };

  /** A stretch with no frames at all, as a backgrounded tab delivers. */
  const background = (seconds, { deckRuns = true } = {}) => {
    state.now += seconds * 1000;
    if (deckRuns) deck.run(seconds);
  };

  return { engine, clock, deck, state, play, background };
}

describe('the clock a file deck drives', () => {
  it('recovers what the dropped frames cost instead of losing it for good', () => {
    const rig = makeRig();
    rig.engine.start();
    rig.play(4);

    // A minute with the tab in the background. No frames — and the file kept
    // playing the whole time.
    rig.background(60);
    rig.play(5);

    // 69 seconds of stem, 69 seconds of set. On the RAF alone it would be 9.5:
    // four honest seconds, the half-second ceiling, and five more.
    expect(rig.clock.seconds).toBeCloseTo(69, 0);
  });

  it('leaves a live-input night on the room\'s own clock', () => {
    const rig = makeRig({ kind: 'mic' });
    rig.engine.start();
    rig.play(4);
    rig.background(60);
    rig.play(1);

    // Unchanged, which is correct: a mic has no position to read, the musician
    // is the clock, and the ceiling is what stops a sleeping tab firing a set's
    // worth of moves at once.
    expect(rig.clock.seconds).toBeCloseTo(5.5, 0);
  });

  it('carries the set through a loop rather than restarting it', () => {
    const rig = makeRig({ length: 10 });
    rig.engine.start();
    rig.play(24); // twice round a ten-second stem, and a bit

    expect(rig.clock.seconds).toBeCloseTo(24, 0);
    // Twelve bars at 120 in 4/4, give or take the frame the reading was taken
    // on — and monotonic, rather than two rewinds back to the top of the set.
    expect(rig.clock.barsElapsed).toBeCloseTo(12, 1);
  });

  it('keeps going across a wrap even with no length to count passes with', () => {
    // Metadata not in yet: no duration, so a wrap can only be re-anchored.
    const rig = makeRig({ length: null });
    rig.engine.start();
    rig.play(10);
    rig.deck.at = 0; // back to the head
    rig.play(6);

    // The set carried on from where it was rather than stalling at the wrap
    // waiting for playback to reach it again.
    expect(rig.clock.seconds).toBeGreaterThan(15);
  });

  it('does not freeze the set when the deck comes back from a pause', () => {
    const rig = makeRig();
    rig.engine.start();
    rig.play(4);

    // The file is stopped but the set is left running: back on the RAF.
    rig.deck.playing = false;
    rig.play(4, { deckRuns: false });
    expect(rig.clock.seconds).toBeCloseTo(8, 0);

    // Playback resumes four seconds behind where the set got to. The set must
    // carry on from here, not wait for the deck to catch up with it.
    rig.deck.playing = true;
    rig.play(4);
    expect(rig.clock.seconds).toBeCloseTo(12, 0);
  });

  it('holds a section on the stem\'s boundary through a gap', () => {
    // Eight bars is sixteen seconds at 120, and the cut belongs there.
    const rig = makeRig({}, {
      rules: { minSectionBars: 0 },
      sections: [
        { name: 'One', transition: { quantize: 'off' } },
        { name: 'Two', enter: { bars: 8 }, transition: { quantize: 'off' } },
      ],
    });
    rig.engine.start();

    rig.play(4);
    rig.background(10); // ten seconds of stem across a sleeping tab
    rig.play(1);

    // Fifteen seconds into the file, still short of the boundary.
    expect(rig.engine.currentSection.name).toBe('One');

    rig.play(2);
    // Past sixteen, so the cut has happened — on the RAF alone the clock would
    // read 5.5 seconds here and the set would still be a bar and a half early.
    expect(rig.engine.currentSection.name).toBe('Two');
  });

  it('re-anchors on a restart rather than fast-forwarding to the deck', () => {
    const rig = makeRig();
    rig.engine.start();
    rig.play(20);
    rig.engine.stop();

    // The file is still twenty seconds in; the set is not.
    rig.engine.start();
    rig.play(2);
    expect(rig.clock.seconds).toBeCloseTo(2, 0);
  });
});
