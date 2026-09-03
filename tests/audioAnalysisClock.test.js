// The clock the analysis runs on.
//
// It used to be the render loop's RAF handler, which tied onset detection to the frame rate: a
// heavy shader at 20 fps also gave the kick detector 20 Hz, so a hit could land 50 ms late and two
// hits inside one frame collapsed into one. The engine now runs on its own timer, with the RAF
// handler kept as a second driver for the case timers are throttled harder than frames (a
// background tab throttles setInterval to 1 Hz but stops RAF outright).
//
// tick() de-duping is what makes two drivers safe. If that guard ever widened past the timer's own
// interval, the timer's ticks would be the ones dropped and the decoupling would silently undo
// itself.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { BrowserAudioCapture } from '../src/audio/BrowserAudioCapture.js';

/**
 * Fake timers that also move performance.now(), which tick() reads for its de-dupe guard. Without
 * the clock advancing alongside the timer, every tick after the first looks like a duplicate.
 */
function useClock() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance', 'Date'] });
}

/** A capture whose analysis step is counted rather than run. */
function counted() {
  const capture = new BrowserAudioCapture();
  capture._processAudio = vi.fn();
  capture.audioElement = { play: vi.fn(async () => { }), pause: vi.fn(), currentTime: 0, src: 'blob:x', dataset: {} };
  return capture;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the analysis timer', () => {
  it('advances the analysis while playing, with no frames at all', async () => {
    useClock();
    const capture = counted();

    await capture.play();
    // Nothing here drives a RAF. If the analysis only ran on frames, this would be zero.
    vi.advanceTimersByTime(100);

    // ~8 ms resolution: an order of magnitude finer than a loaded frame rate would give.
    expect(capture._processAudio.mock.calls.length).toBeGreaterThan(8);
    capture.stop();
  });

  it('stops when playback pauses', async () => {
    useClock();
    const capture = counted();

    await capture.play();
    vi.advanceTimersByTime(50);
    capture.pause();
    const after = capture._processAudio.mock.calls.length;
    vi.advanceTimersByTime(200);

    expect(capture._processAudio.mock.calls.length).toBe(after);
  });

  it('stops when playback stops', async () => {
    useClock();
    const capture = counted();

    await capture.play();
    vi.advanceTimersByTime(50);
    capture.stop();
    const after = capture._processAudio.mock.calls.length;
    vi.advanceTimersByTime(200);

    expect(capture._processAudio.mock.calls.length).toBe(after);
  });

  it('does not stack a second timer when play is pressed twice', async () => {
    useClock();
    const capture = counted();

    await capture.play();
    await capture.play();
    vi.advanceTimersByTime(100);
    const twice = capture._processAudio.mock.calls.length;

    capture.stop();
    // A stacked timer would keep running past the single clearInterval in stop().
    vi.advanceTimersByTime(100);
    expect(capture._processAudio.mock.calls.length).toBe(twice);
  });
});

describe('two drivers, one step per instant', () => {
  it('collapses a timer tick and a frame landing together', () => {
    const capture = counted();
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    capture.tick();
    capture.tick(); // the other driver, same instant

    expect(capture._processAudio).toHaveBeenCalledTimes(1);
  });

  it('lets an ordinary timer interval through', () => {
    const capture = counted();
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);

    capture.tick();
    clock += 8; // one ANALYSIS_INTERVAL_MS later
    capture.tick();

    // The guard exists to drop same-instant duplicates, not to rate-limit the timer. Widening it
    // past the interval would quietly put the analysis back on the frame clock.
    expect(capture._processAudio).toHaveBeenCalledTimes(2);
  });
});
