// Trigger detection runs on the analysis clock, not the render frame.
//
// The engine already advanced on its own ~8 ms timer, but the meter -> threshold -> edge DECISION
// still ran once per rendered frame. That put detection straight back on the frame rate: at 20 fps
// a kick whose meter rose and fell inside 50 ms was never sampled above the threshold, so the hit
// was not late — it was gone. Deciding on every analysis step catches it, and the per-drum fire
// counts in the taps carry it down to a consumer reading at the frame rate without loss.
//
// The two failure modes on the other side matter just as much: a hit must not arrive twice, and a
// frame with no hit behind it must read 0.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioAnalysisProcessor } from '../src/core/AudioAnalysisProcessor.js';
import { getAudioTapValues } from '../src/audio/audioAnalysisTaps.js';
import { resetAudioAnalysisSettings } from '../src/audio/audioAnalysisSettings.js';

function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

function setBands(values = {}) {
  const out = {
    level: 0, low: 0, mid: 0, high: 0, kick: 0, snare: 0, hat: 0,
    centroid: 0, density: 0, presence: {}, ...values,
  };
  for (const b of ['low', 'mid', 'high', 'kick', 'snare', 'hat']) out.presence[b] = (out[b] || 0) > 0;
  window._audioBands = out;
}

/**
 * An engine that steps on its own clock, the way BrowserAudioCapture's timer does, with the render
 * frame arriving separately and much less often.
 */
function makeRig({ threshold = 0.5 } = {}) {
  const setup = { id: 'setup', kind: 'Audio', params: { kickThresh: threshold }, inputs: [] };
  const reader = { id: 'kickOut', kind: 'AudioValue', params: { channel: 'kickTrig' }, inputs: [] };
  const graph = makeGraph([setup, reader]);
  const um = { uniformValues: new Map([['kickOut.value', 0]]) };

  const listeners = [];
  const proc = new AudioAnalysisProcessor();
  proc._audioClient = {
    tick() { },
    updateConfig() { },
    on(event, fn) { if (event === 'analysis') listeners.push(fn); },
  };

  let t = 0;
  return {
    proc, graph, um, reader,
    /** One rendered frame at the given wall-clock second. */
    frame(seconds) {
      t = seconds;
      proc.update(graph, { time: t, now: t, uniformManager: um });
      return um.uniformValues.get('kickOut.value');
    },
    /** One analysis step between frames — the engine's timer firing. */
    step(seconds, bands) {
      t = seconds;
      proc._clock = seconds;
      setBands(bands);
      for (const fn of listeners) fn();
    },
    listenerCount: () => listeners.length,
  };
}

beforeEach(() => {
  resetAudioAnalysisSettings();
  setBands();
});

afterEach(() => {
  delete window._audioBands;
});

describe('deciding between frames', () => {
  it('subscribes to the engine once, however many frames run', () => {
    const rig = makeRig();
    rig.frame(0);
    rig.frame(1 / 60);
    rig.frame(2 / 60);
    expect(rig.listenerCount()).toBe(1);
  });

  it('delivers a kick that rose and fell entirely between two frames', () => {
    const rig = makeRig();
    rig.frame(0);

    // 50 ms apart: a patch running at 20 fps. The whole hit happens in between.
    rig.step(0.008, { kick: 0.1 });
    rig.step(0.016, { kick: 0.9 });   // the transient
    rig.step(0.024, { kick: 0.6 });
    rig.step(0.032, { kick: 0.05 });  // and gone again

    // Sampling the meter once per frame would have seen 0.1 then 0.05 and found nothing at all.
    expect(rig.frame(0.05)).toBe(1);
  });

  it('reports a hit exactly once, not on every frame after it', () => {
    const rig = makeRig();
    rig.frame(0);
    rig.step(0.016, { kick: 0.9 });
    rig.step(0.024, { kick: 0.05 });

    expect(rig.frame(0.05)).toBe(1);
    // The count has been consumed; nothing new has happened since.
    expect(rig.frame(0.1)).toBe(0);
    expect(rig.frame(0.15)).toBe(0);
  });

  it('reads 0 on a frame with no hit behind it', () => {
    const rig = makeRig();
    rig.frame(0);
    rig.step(0.016, { kick: 0.1 });
    rig.step(0.032, { kick: 0.2 });
    expect(rig.frame(0.05)).toBe(0);
  });

  it('gives one frame of 1 for two hits inside one frame, and loses neither count', () => {
    const rig = makeRig();
    rig.frame(0);

    rig.step(0.010, { kick: 0.9 });
    rig.step(0.020, { kick: 0.02 });
    // Clear of MIN_RETRIGGER_MS, so this is a second hit and not chatter.
    rig.step(0.070, { kick: 0.9 });
    rig.step(0.080, { kick: 0.02 });

    // A uniform is one number a frame, so two hits in one frame can only be one pulse — but the
    // count records both, so nothing downstream silently disagrees about how many there were.
    expect(rig.frame(0.1)).toBe(1);
    expect(getAudioTapValues().trigCount.kick).toBe(2);
  });

  it('keeps counting for the panel while no frame is rendering at all', () => {
    const rig = makeRig();
    rig.frame(0);

    // The render loop is stalled — a shader compile, a heavy graph edit. The analysis is not.
    for (let i = 1; i <= 6; i++) {
      rig.step(i * 0.1, { kick: 0.9 });
      rig.step(i * 0.1 + 0.02, { kick: 0.02 });
    }

    expect(getAudioTapValues().trigCount.kick).toBe(6);
    // And the frame that finally arrives still knows a hit happened.
    expect(rig.frame(1)).toBe(1);
  });
});

describe('when nothing wants audio any more', () => {
  it('stops deciding, so the engine steps do not keep firing triggers', () => {
    const rig = makeRig();
    rig.frame(0);
    rig.step(0.016, { kick: 0.9 });
    expect(getAudioTapValues().trigCount.kick).toBe(1);

    // The nodes are gone and the panel is closed.
    rig.graph.nodes.length = 0;
    rig.frame(0.05);

    rig.step(0.1, { kick: 0.9 });
    rig.step(0.12, { kick: 0.02 });
    rig.step(0.2, { kick: 0.9 });
    expect(getAudioTapValues().trigCount.kick).toBe(0);
  });
});
