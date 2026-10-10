// Timeline playback has to reach every keyframe that scrubbing can.
//
// Scrubbing jumps the playhead with setCurrentTime(); Play advances it through
// the loop region each frame. The two disagreed whenever the loop region did not
// cover the timeline: lengthening the duration left the loop ending at the old
// 10 s, so Play wrapped back to 0 before it ever reached the keyframes past it.

import { describe, it, expect, beforeEach } from 'vitest';
import { TimelineManager } from '../src/core/TimelineManager.js';

function play(manager, seconds, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) manager.update(step);
}

describe('timeline playback', () => {
  let manager;

  beforeEach(() => {
    manager = new TimelineManager({ graph: { nodes: [] }, onChange: () => {} });
    manager.enable();
  });

  it('plays past the old end after the duration is lengthened', () => {
    manager.setDuration(20);
    expect(manager.getLoopEnd()).toBe(20);

    manager.setCurrentTime(9.5);
    manager.play();
    play(manager, 3);
    expect(manager.getCurrentTime()).toBeGreaterThan(12);
  });

  it('keeps a loop region the artist set when the duration changes', () => {
    manager.setLoopRegion(2, 4);
    manager.setDuration(20);
    expect([manager.getLoopStart(), manager.getLoopEnd()]).toEqual([2, 4]);
  });

  it('pulls the loop end in when the duration shrinks below it', () => {
    manager.setDuration(5);
    expect(manager.getLoopEnd()).toBe(5);
  });

  it('does not pin the playhead on a zero-length loop region', () => {
    manager.setLoopRegion(3, 3);
    manager.setCurrentTime(3);
    manager.play();
    play(manager, 1);
    expect(manager.getCurrentTime()).toBeGreaterThan(3.5);
  });

  it('starts over when Play is pressed at the end without a loop', () => {
    const states = [];
    manager.onPlayStateChange = (playing) => states.push(playing);
    manager.setLoop(false);
    manager.setCurrentTime(9.9);
    manager.play();
    play(manager, 0.5);
    expect(manager.isPlaying()).toBe(false);
    expect(states.at(-1)).toBe(false);

    manager.play();
    expect(manager.getCurrentTime()).toBe(0);
    play(manager, 0.5);
    expect(manager.getCurrentTime()).toBeGreaterThan(0.4);
  });
});
