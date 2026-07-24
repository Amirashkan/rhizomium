import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioAnalysisProcessor } from '../src/core/AudioAnalysisProcessor.js';

// Minimal stand-in for the editor graph: nodes + getNode by id.
function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

// A uniform manager whose buffer already has the node's keys registered (as the compiler's
// getParam() would).
function makeUniformManager(kickNodeIds = []) {
  const uniformValues = new Map();
  for (const id of kickNodeIds) {
    for (const k of ['level', 'kick', 'trig', 'strength']) uniformValues.set(`${id}.${k}`, 0);
  }
  return { uniformValues };
}

function kickNode(params = {}) {
  return {
    id: 'k', kind: 'AudioAnalysis',
    // The node's entire parameter set (see data/nodes/InputNodes.js): two knobs.
    params: { threshold: 1.0, sense: 0.6, ...params },
    inputs: [],
  };
}

const AUDIO_GLOBALS = [
  '_audioEnvelopeValue', '_audioEnvelopeBass', '_audioEnvelopeMids', '_audioEnvelopeHighs',
  '_audioEnvelopeFull', '_audioFluxBass', '_audioFluxMids', '_audioFluxHighs', '_audioFluxFull',
  '_audioFluxCustom',
];

// Stub the audio engine so tests never touch the real singleton; capture pushed configs + ticks.
function stubClient() {
  const configs = [];
  let ticks = 0;
  return { configs, get ticks() { return ticks; }, tick() { ticks++; }, updateConfig(c) { configs.push(c); } };
}

// The onset signal's real scale, measured on commercial music: background sits near 0.07 and a
// clear kick reads 1-2.5, which is why the shipped threshold is 1.0.
const BACKGROUND = 0.03;
const HIT = 2.5;
// Fixed internals the node no longer exposes (see AudioAnalysisProcessor).
const MIN_GAP_MS = 250;

/**
 * A test rig that drives the processor frame by frame on an explicit clock.
 *
 * `step(strength)` publishes one frame of the kick band's onset signal and advances 16ms.
 * Detection is judged one frame LATE (peak picking needs to see the frame after the candidate),
 * so a spike fires on the step AFTER the peak — `hit()` encodes that rise-then-fall shape.
 */
function makeRig(params = {}) {
  const node = kickNode(params);
  const graph = makeGraph([node]);
  const um = makeUniformManager(['k']);
  const proc = new AudioAnalysisProcessor();
  proc._audioClient = stubClient();

  let t = 0;
  const step = (flux, { energy = 0.5, dtMs = 16 } = {}) => {
    window._audioFluxBass = flux;
    window._audioEnvelopeBass = energy;
    t += dtMs / 1000;
    proc.update(graph, { time: t, now: t, uniformManager: um });
    return um.uniformValues.get('k.trig');
  };
  // Quiet frames, enough to establish a baseline for the median/MAD statistics.
  const silence = (frames = 20, opts) => {
    let fired = 0;
    for (let i = 0; i < frames; i++) fired += step(BACKGROUND, opts);
    return fired;
  };
  // One realistic transient: a multi-frame attack peaking at `strength`, then its decay. The whole
  // shape scales with `strength`, so a weak hit is weak throughout.
  const ATTACK_SHAPE = [0.06, 0.33, 0.78, 1.0, 0.65, 0.22, 0.06];
  const hit = (strength = HIT, opts) => {
    let fired = 0;
    for (const f of ATTACK_SHAPE) fired += step(f * strength, opts);
    return fired;
  };
  // Same transient, but reports the kick envelope sampled on the frame that fired.
  const hitPeakEnv = (strength = HIT, opts) => {
    let env = 0;
    for (const f of ATTACK_SHAPE) {
      if (step(f * strength, opts) === 1) env = um.uniformValues.get('k.kick');
    }
    return env;
  };

  return { proc, node, graph, um, step, silence, hit, hitPeakEnv, get time() { return t; } };
}

describe('AudioAnalysisProcessor', () => {
  beforeEach(() => {
    for (const g of AUDIO_GLOBALS) window[g] = 0;
  });

  afterEach(() => {
    for (const g of AUDIO_GLOBALS) delete window[g];
  });

  it('fires exactly once on a multi-frame attack', () => {
    // A kick's attack spans several frames as the FFT window slides over it, so a
    // threshold-crossing detector fires on the way up and again on later ripples. Peak picking
    // judges each frame once its successor is known and only accepts a local maximum, which a
    // single transient has exactly one of.
    const rig = makeRig();
    rig.silence();
    expect(rig.hit()).toBe(1);
  });

  it('fires once per hit across a run of kicks, never twice', () => {
    const rig = makeRig();
    rig.silence();
    for (let i = 0; i < 8; i++) {
      expect(rig.hit()).toBe(1);       // the transient itself
      expect(rig.silence(12)).toBe(0); // the gap between kicks stays quiet
    }
  });

  it('reports a full kick envelope, a single-frame trig, and the live level and strength', () => {
    const rig = makeRig();
    window._audioEnvelopeValue = 0.6; // the envelope feeding `level`
    rig.silence();
    // The envelope snaps to a full 1.0 on the firing frame, then decays.
    expect(rig.hitPeakEnv()).toBeCloseTo(1.0);
    expect(rig.um.uniformValues.get('k.level')).toBeCloseTo(0.6);
    // trig is a one-frame pulse: it has already cleared on the frames after the peak.
    expect(rig.um.uniformValues.get('k.trig')).toBe(0);
    // strength reports the onset signal Threshold is compared against.
    rig.step(1.75);
    expect(rig.um.uniformValues.get('k.strength')).toBeCloseTo(1.75);
  });

  it('never fires on sustained loudness — only change counts', () => {
    // A held bass note keeps the band's LEVEL high but produces no onset, so no tuning is needed
    // to reject it.
    const rig = makeRig();
    let fired = 0;
    for (let i = 0; i < 60; i++) fired += rig.step(0.0, { energy: 0.9 });
    expect(fired).toBe(0);
  });

  it('does not retrigger while the signal sits on a plateau', () => {
    const rig = makeRig();
    rig.silence();
    let fired = 0;
    for (let i = 0; i < 40; i++) fired += rig.step(1.5);
    expect(fired).toBeLessThanOrEqual(1);
  });

  it('stays silent while the band is not sounding, however the signal looks', () => {
    // The onset signal is relative, so without an absolute presence gate a silent passage's noise
    // could be shaped into something that looks like a hit.
    const rig = makeRig();
    rig.silence(20, { energy: 0.0 });
    expect(rig.hit(HIT, { energy: 0.0 })).toBe(0);
    rig.silence(20, { energy: 0.01 });
    expect(rig.hit(HIT, { energy: 0.01 })).toBe(0);
    // ...and the same transient does fire once the band actually has energy.
    rig.silence(20, { energy: 0.5 });
    expect(rig.hit(HIT, { energy: 0.5 })).toBe(1);
  });

  // --- the two knobs ---------------------------------------------------------------------------

  it('Threshold: raising it only ever fires less, and a high value fires nothing', () => {
    // Regression: the floor was once a fraction of a decaying running peak, which made every new
    // maximum read as 1.0 — a band of pure noise became a stream of onsets no value could refuse.
    const counts = [0.2, 1.0, 2.0, 50].map((threshold) => {
      const rig = makeRig({ threshold });
      let fired = 0;
      for (let i = 0; i < 6; i++) { fired += rig.hit(1.5); fired += rig.silence(20); }
      return fired;
    });
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[counts.length - 1]).toBe(0);
  });

  it('Threshold: a hit below it is refused however prominent it is locally', () => {
    const rig = makeRig({ threshold: 2.0 });
    rig.silence();
    expect(rig.hit(2.5)).toBe(1);
    rig.silence(30);
    expect(rig.hit(1.2)).toBe(0);
  });

  it('Sense: raising it fires MORE, matching what the name says', () => {
    // The knob it replaced was a strictness multiplier, so turning "sensitivity" up made the
    // detector fire less. Sense is inverted internally so the control reads the way it is labelled.
    const counts = [0.0, 0.4, 0.8, 1.0].map((sense) => {
      const rig = makeRig({ threshold: 0.05, sense });
      let fired = 0;
      // Hits that only just stand out from a busy background, so the margin is what decides.
      for (let i = 0; i < 10; i++) {
        fired += rig.hit(0.35);
        for (let j = 0; j < 18; j++) fired += rig.step(0.1 + 0.06 * (j % 3));
      }
      return fired;
    });
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0]);
  });

  it('Sense keeps working past the first few hits', () => {
    // Regression: the peak-picking delay line starts at Infinity, and those startup sentinels were
    // being recorded as local maxima. Once enough had accumulated, Sense's reference became
    // Infinity and the detector went permanently silent a couple of seconds in — the worst kind of
    // failure, since it looks fine at first.
    const rig = makeRig();
    rig.silence();
    for (let i = 0; i < 12; i++) {
      expect(rig.hit()).toBe(1);
      rig.silence(12);
    }
  });

  it('Sense at 0 still lets an unmistakable hit through', () => {
    const rig = makeRig({ sense: 0 });
    rig.silence();
    expect(rig.hit(HIT)).toBe(1);
  });

  it('clamps out-of-range knob values rather than misbehaving', () => {
    for (const sense of [-5, 99]) {
      const rig = makeRig({ sense });
      rig.silence();
      expect(() => rig.hit(HIT)).not.toThrow();
    }
  });

  // --- fixed internals -------------------------------------------------------------------------

  it('suppresses a second kick inside the fixed minimum gap, then allows one after it', () => {
    const rig = makeRig();
    rig.silence();
    expect(rig.hit()).toBe(1);
    // Another transient immediately after — inside the gap, so suppressed.
    expect(rig.hit()).toBe(0);
    // Wait out the gap, then a transient is allowed again.
    rig.silence(Math.ceil(MIN_GAP_MS / 16) + 4);
    expect(rig.hit()).toBe(1);
  });

  it('times the gap on the wall clock, not the render loop\'s sim time', () => {
    // Audio plays in real time: it does not slow with timeScale or stop when the sim clock pauses.
    const node = kickNode();
    const graph = makeGraph([node]);
    const um = makeUniformManager(['k']);
    const proc = new AudioAnalysisProcessor();
    proc._audioClient = stubClient();

    let wall = 0;
    const step = (flux) => {
      window._audioFluxBass = flux;
      window._audioEnvelopeBass = 0.5;
      wall += 0.016;
      proc.update(graph, { time: 0, now: wall, uniformManager: um }); // sim time frozen at 0
      return um.uniformValues.get('k.trig');
    };
    for (let i = 0; i < 20; i++) step(BACKGROUND);
    let fired = 0;
    for (const f of [0.15, 0.8, 1.9, 2.5, 1.6, 0.5, 0.15]) fired += step(f);
    expect(fired).toBe(1);
  });

  it('decays the kick envelope toward zero after a hit', () => {
    const rig = makeRig();
    rig.silence();
    rig.hit();
    const afterHit = rig.um.uniformValues.get('k.kick');
    expect(afterHit).toBeGreaterThan(0);

    let prev = afterHit;
    for (let i = 0; i < 14; i++) {
      rig.step(0.0);
      const env = rig.um.uniformValues.get('k.kick');
      expect(env).toBeLessThan(prev);
      prev = env;
    }
    expect(prev).toBeLessThan(0.2);
  });

  it('detects on the kick band only', () => {
    // The band is fixed: this is a kick detector. Activity in other bands must not trigger it.
    const rig = makeRig();
    rig.silence();
    let fired = 0;
    for (let i = 0; i < 14; i++) {
      window._audioFluxMids = HIT;
      window._audioFluxHighs = HIT;
      window._audioFluxFull = HIT;
      fired += rig.step(BACKGROUND);
    }
    expect(fired).toBe(0);
    expect(rig.hit()).toBe(1);
  });

  it('mirrors the live values onto the node for the CPU preview', () => {
    const rig = makeRig();
    window._audioEnvelopeValue = 0.42;
    rig.step(0.0);
    expect(rig.node.__kickLevel).toBeCloseTo(0.42);
    expect(rig.node.__kickStrength).toBeCloseTo(0);
  });

  it('pushes one fixed level-envelope config to the audio engine, and only once', () => {
    // The ten follower/ADSR/shaping parameters are gone; `level` keeps the behaviour they always
    // defaulted to, pushed once rather than re-derived from node params every frame.
    const rig = makeRig();
    rig.step(0.0);
    expect(rig.proc._audioClient.configs.length).toBe(1);
    const cfg = rig.proc._audioClient.configs[0];
    expect(cfg.frequency.mode).toBe('bass');
    expect(cfg.follower.attack_ms).toBe(50);
    expect(cfg.adsr.sustain).toBe(0.7);
    expect(cfg.shaping.curve).toBe('exp');

    for (let i = 0; i < 10; i++) rig.step(0.0);
    expect(rig.proc._audioClient.configs.length).toBe(1);
  });

  it('drives the audio engine once per update so the envelope never freezes', () => {
    const rig = makeRig();
    rig.step(0.0);
    rig.step(0.0);
    expect(rig.proc._audioClient.ticks).toBe(2);
  });

  it('prunes state for deleted nodes', () => {
    const proc = new AudioAnalysisProcessor();
    proc._audioClient = stubClient();
    const node = kickNode();
    proc.update(makeGraph([node]), { time: 0, now: 0, uniformManager: makeUniformManager(['k']) });
    expect(proc._state.has('k')).toBe(true);

    const other = { id: 'x', kind: 'Time', params: {}, inputs: [] };
    proc.update(makeGraph([other]), { time: 0.016, now: 0.016, uniformManager: makeUniformManager([]) });
    expect(proc._state.has('k')).toBe(false);
  });
});
