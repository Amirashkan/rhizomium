import { describe, it, expect } from 'vitest';
import { BrowserAudioCapture } from '../src/audio/BrowserAudioCapture.js';

// The frame clock feeding the analysis. Its only job is to never hand the envelopes a step so long
// that a single unrepresentative sample gets treated as the whole gap — see MAX_FRAME_DT_S.

describe('BrowserAudioCapture frame clock', () => {
  it('measures an ordinary frame as it really was', () => {
    const c = new BrowserAudioCapture();
    c._lastUpdateTime = performance.now() - 16.7;
    const dt = c._frameDelta();
    expect(dt).toBeGreaterThan(0.01);
    expect(dt).toBeLessThan(0.05);
  });

  it('bounds a stalled frame instead of advancing the filters across the whole gap', () => {
    // A shader compile, a heavy graph edit, a backgrounded tab. The audio during the gap was never
    // sampled, so the frame that arrives afterwards describes one instant, not five seconds.
    const c = new BrowserAudioCapture();
    for (const stallSeconds of [0.5, 5, 300]) {
      c._lastUpdateTime = performance.now() - stallSeconds * 1000;
      expect(c._frameDelta()).toBeLessThanOrEqual(0.1);
    }
  });

  it('never reports a negative step, whatever the clock does', () => {
    const c = new BrowserAudioCapture();
    c._lastUpdateTime = performance.now() + 5000;
    expect(c._frameDelta()).toBe(0);
  });

  it('advances the clock, so two reads in a row do not both see the same gap', () => {
    const c = new BrowserAudioCapture();
    c._lastUpdateTime = performance.now() - 1000;
    expect(c._frameDelta()).toBe(0.1);   // clamped
    expect(c._frameDelta()).toBeLessThan(0.01); // ...and the backlog is not replayed
  });
});
