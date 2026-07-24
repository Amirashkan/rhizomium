import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioAnalysisProcessor } from '../src/core/AudioAnalysisProcessor.js';

// Minimal stand-in for the editor graph: nodes + getNode by id.
function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

// A uniform manager whose buffer already has the node's three keys registered (as the compiler's
// getParam() would).
function makeUniformManager(kickNodeIds = []) {
  const uniformValues = new Map();
  for (const id of kickNodeIds) {
    uniformValues.set(`${id}.level`, 0);
    uniformValues.set(`${id}.kick`, 0);
    uniformValues.set(`${id}.trig`, 0);
  }
  return { uniformValues };
}

function kickNode(params = {}) {
  return {
    id: 'k', kind: 'AudioAnalysis',
    // Mirrors the node's shipped defaults (see data/nodes/InputNodes.js) so the tests exercise
    // what users actually get.
    params: { band: 'Bass', threshold: 1.0, sensitivity: 2.5, kickRelease: 140, refractory: 250, ...params },
    inputs: [],
  };
}

// Which globals feed a given Band: [spectral flux (detection), band envelope (presence gate)].
// Custom has no dedicated band envelope, so its presence gate falls back to full-band.
const BAND_GLOBALS = {
  Bass: ['_audioFluxBass', '_audioEnvelopeBass'],
  Mids: ['_audioFluxMids', '_audioEnvelopeMids'],
  Highs: ['_audioFluxHighs', '_audioEnvelopeHighs'],
  Full: ['_audioFluxFull', '_audioEnvelopeFull'],
  Custom: ['_audioFluxCustom', '_audioEnvelopeFull'],
};

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
// clear kick reads 1-2.5, which is why the shipped threshold is 1.0. Tests use these so they
// exercise realistic magnitudes rather than arbitrary ones.
const BACKGROUND = 0.03;
const HIT = 2.5;

/**
 * A test rig that drives the processor frame by frame on an explicit clock.
 *
 * `step(flux)` publishes one frame of spectral flux for the node's band and advances 16ms.
 * Detection is judged one frame LATE (peak picking needs to see the frame after the candidate),
 * so a spike fires on the step AFTER the peak — `hit()` encodes that rise-then-fall shape.
 */
function makeRig(params = {}) {
  const node = kickNode(params);
  const band = params.band || 'Bass';
  const [fluxKey, energyKey] = BAND_GLOBALS[band];
  const graph = makeGraph([node]);
  const um = makeUniformManager(['k']);
  const proc = new AudioAnalysisProcessor();
  proc._audioClient = stubClient();

  let t = 0;
  const step = (flux, { energy = 0.5, dtMs = 16 } = {}) => {
    window[fluxKey] = flux;
    window[energyKey] = energy;
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
  // shape scales with `strength`, so a weak hit is weak throughout. Returns how many times it fired.
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
    // The doubling regression. A kick's attack spans several frames as the FFT window slides over
    // it, so a threshold-crossing detector fires on the way up and again on later ripples. Peak
    // picking judges each frame once its successor is known and only accepts a local maximum,
    // which a single transient has exactly one of.
    const rig = makeRig();
    rig.silence();
    expect(rig.hit()).toBe(1);
  });

  it('fires once per hit across a run of kicks, never twice', () => {
    const rig = makeRig();
    rig.silence();
    for (let i = 0; i < 8; i++) {
      expect(rig.hit()).toBe(1);   // the transient itself
      expect(rig.silence(12)).toBe(0); // the gap between kicks stays quiet
    }
  });

  it('reports a full kick envelope and a single-frame trig, and passes the shaped level through', () => {
    const rig = makeRig();
    window._audioEnvelopeValue = 0.6; // the shaped envelope feeding `level`
    rig.silence();
    // The envelope snaps to a full 1.0 on the firing frame (it decays from there over kickRelease).
    expect(rig.hitPeakEnv()).toBeCloseTo(1.0);
    expect(rig.um.uniformValues.get('k.level')).toBeCloseTo(0.6);
    // trig is a one-frame pulse: it has already cleared on the frames after the peak.
    expect(rig.um.uniformValues.get('k.trig')).toBe(0);
  });

  it('never fires on sustained loudness — only spectral change counts', () => {
    // The point of the flux detector: a held bass note keeps the band's LEVEL high but its
    // spectrum static, so flux stays ~0 and no threshold tuning is needed to reject it.
    const rig = makeRig();
    let fired = 0;
    for (let i = 0; i < 60; i++) fired += rig.step(0.0, { energy: 0.9 });
    expect(fired).toBe(0);
  });

  it('does not retrigger while flux sits on a plateau', () => {
    const rig = makeRig();
    rig.silence();
    let fired = 0;
    for (let i = 0; i < 40; i++) fired += rig.step(1.5);
    // The rise into the plateau is at most one onset; the flat part must never re-fire.
    expect(fired).toBeLessThanOrEqual(1);
  });

  it('stays silent while the band is not sounding, however the flux looks', () => {
    // Phantom-hit regression: flux is a RELATIVE measure, so without an absolute presence gate the
    // noise floor of a silent passage normalizes into a "strong onset".
    const rig = makeRig();
    rig.silence(20, { energy: 0.0 });
    expect(rig.hit(HIT, { energy: 0.0 })).toBe(0);
    rig.silence(20, { energy: 0.01 });
    expect(rig.hit(HIT, { energy: 0.01 })).toBe(0);
    // ...and the same transient does fire once the band actually has energy.
    rig.silence(20, { energy: 0.5 });
    expect(rig.hit(HIT, { energy: 0.5 })).toBe(1);
  });

  it('requires prominence over a busy passage (adaptive median+MAD threshold)', () => {
    // When flux is churning every frame, a bump no bigger than the ambient churn is not a distinct
    // hit. The statistics learned from recent frames reject it without manual retuning.
    const rig = makeRig();
    let fired = 0;
    for (let i = 0; i < 60; i++) fired += rig.step(i % 2 ? 1.4 : 0.85);
    // At most the initial onset into the churn; the ongoing ripple must not machine-gun.
    expect(fired).toBeLessThanOrEqual(1);
  });

  it('rejects a weak peak below the absolute floor', () => {
    const rig = makeRig({ threshold: 2.0 });
    rig.silence();
    expect(rig.hit(2.5)).toBe(1);  // 2.5 clears the 2.0 floor
    rig.silence(30);
    expect(rig.hit(1.2)).toBe(0);  // 1.2 does not, however prominent it is locally
  });

  it('raising the threshold only ever fires less, and a high one fires nothing', () => {
    // Regression: the floor used to be a fraction of a decaying running peak, which made every new
    // maximum read as 1.0. A band carrying nothing but low-level wobble was normalized into a
    // stream of "perfect" onsets that no threshold could refuse — including 1.0.
    const weak = () => {
      const rig = makeRig(); // shipped threshold
      let fired = 0;
      for (let i = 0; i < 200; i++) {
        // Irregular wobble an order of magnitude below a real hit.
        fired += rig.step(BACKGROUND + 0.25 * Math.abs(Math.sin(i * 2.399)) * (i % 7 === 0 ? 1 : 0.2));
      }
      return fired;
    };
    expect(weak()).toBe(0);

    // ...and the knob is monotonic on a signal that does contain real hits.
    const counts = [0.2, 1.0, 2.0, 50].map((threshold) => {
      const rig = makeRig({ threshold });
      let fired = 0;
      for (let i = 0; i < 6; i++) { fired += rig.hit(1.5); fired += rig.silence(20); }
      return fired;
    });
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[0]).toBeGreaterThan(0); // a low floor does let the hits through
    expect(counts[counts.length - 1]).toBe(0); // a floor above any real onset fires nothing
  });

  it('suppresses a second kick inside the refractory window, then allows one after it', () => {
    const rig = makeRig({ refractory: 200 });
    rig.silence();
    expect(rig.hit()).toBe(1);
    // Another transient immediately after — inside the 200ms window, so suppressed.
    expect(rig.hit()).toBe(0);
    // Wait out the window, then a transient is allowed again.
    rig.silence(20);
    expect(rig.hit()).toBe(1);
  });

  it('times the refractory on the wall clock, not the render loop\'s sim time', () => {
    // Audio plays in real time: it does not slow with timeScale or stop when the sim clock pauses.
    // With sim time frozen, detection timing must still advance.
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

  it('decays the kick envelope toward zero over the kick-release time', () => {
    const rig = makeRig({ kickRelease: 100 });
    rig.silence();
    rig.hit();
    const afterHit = rig.um.uniformValues.get('k.kick');
    expect(afterHit).toBeGreaterThan(0);

    // Flux falls back to silence; the kick envelope should monotonically decay and approach 0.
    let prev = afterHit;
    for (let i = 0; i < 14; i++) {
      rig.step(0.0);
      const env = rig.um.uniformValues.get('k.kick');
      expect(env).toBeLessThan(prev);
      prev = env;
    }
    expect(prev).toBeLessThan(0.2);
  });

  it('detects on the selected band\'s spectral flux, not the shaped level', () => {
    // The shaped level (follower/ADSR output) plateaus and must never drive detection; the flux of
    // the node's Band must. A Mids node ignores bass flux and fires on mids flux.
    const rig = makeRig({ band: 'Mids' });
    window._audioEnvelopeValue = 0.9;
    rig.silence();

    // A big transient on the WRONG band -> nothing.
    window._audioFluxBass = 0.9;
    window._audioEnvelopeBass = 0.9;
    let fired = 0;
    for (let i = 0; i < 7; i++) fired += rig.step(BACKGROUND);
    expect(fired).toBe(0);

    // The same transient on Mids -> one hit, and `level` still reports the shaped value.
    expect(rig.hit()).toBe(1);
    expect(rig.um.uniformValues.get('k.level')).toBeCloseTo(0.9);
  });

  it('uses the dedicated custom-band flux for Band: Custom', () => {
    const rig = makeRig({ band: 'Custom' });
    rig.silence();
    // Full-band flux must be ignored — Custom no longer falls back to it for detection.
    window._audioFluxFull = HIT;
    let fired = 0;
    for (let i = 0; i < 7; i++) fired += rig.step(BACKGROUND);
    expect(fired).toBe(0);
    expect(rig.hit()).toBe(1);
  });

  it('rejects a broadband onset with Isolate on, and accepts it with Isolate off', () => {
    // A snare or clap fires across the whole spectrum at once. Isolate subtracts the high band, so
    // it cancels while a kick — nearly all low energy — survives untouched.
    const broadband = (rig, strength) => {
      let fired = 0;
      for (const f of [0.06, 0.33, 0.78, 1.0, 0.65, 0.22, 0.06]) {
        window._audioFluxHighs = f * strength;      // present across the spectrum
        fired += rig.step(f * strength);            // ...including the bass band
      }
      window._audioFluxHighs = 0;
      return fired;
    };

    const isolated = makeRig();
    isolated.silence();
    expect(broadband(isolated, HIT)).toBe(0);
    // The same rig still fires on a low-only hit.
    expect(isolated.hit(HIT)).toBe(1);

    const raw = makeRig({ isolate: false });
    raw.silence();
    expect(broadband(raw, HIT)).toBe(1);
  });

  it('applies Isolate to a Custom band too, not just Bass', () => {
    // Regression: broadband rejection used to be baked into the bass signal, so a hand-dialled
    // Custom kick range behaved completely differently from the built-in Bass one.
    const rig = makeRig({ band: 'Custom' });
    rig.silence();
    let fired = 0;
    for (const f of [0.06, 0.33, 0.78, 1.0, 0.65, 0.22, 0.06]) {
      window._audioFluxHighs = f * HIT;
      fired += rig.step(f * HIT);
    }
    window._audioFluxHighs = 0;
    expect(fired).toBe(0);
    expect(rig.hit(HIT)).toBe(1);
  });

  it('auto-calibrates a threshold from the audio it hears', () => {
    // The whole point: the user should not have to find this number by hand.
    const rig = makeRig({ threshold: 40 }); // starts far too high to fire on anything
    rig.proc.requestCalibration('k');
    expect(rig.proc.isCalibrating('k')).toBe(true);

    // Play a groove past it for longer than the calibration window.
    for (let i = 0; i < 60; i++) { rig.hit(HIT); rig.silence(16); }

    expect(rig.proc.isCalibrating('k')).toBe(false);
    const chosen = rig.node.params.threshold;
    expect(chosen).toBeGreaterThan(0);
    expect(chosen).toBeLessThan(HIT);  // below a hit, so hits register
    expect(chosen).toBeGreaterThan(0.01); // above the background

    // ...and the chosen value actually detects the material it was calibrated on.
    let fired = 0;
    for (let i = 0; i < 8; i++) { fired += rig.hit(HIT); rig.silence(16); }
    expect(fired).toBe(8);
  });

  it('leaves the threshold alone when calibration hears nothing usable', () => {
    const rig = makeRig({ threshold: 1.5 });
    rig.proc.requestCalibration('k');
    for (let i = 0; i < 500; i++) rig.step(0.0); // silence: no peaks to learn from
    expect(rig.node.params.threshold).toBe(1.5);
    expect(rig.node.__kickCalibrationResult).toBe('failed');
  });

  it('mirrors the live level onto node.__kickLevel for the CPU preview', () => {
    const rig = makeRig();
    window._audioEnvelopeValue = 0.42;
    rig.step(0.0);
    expect(rig.node.__kickLevel).toBeCloseTo(0.42);
  });

  it('pushes the Band/Follower/ADSR/Shaping params to the audio engine, only when they change', () => {
    const rig = makeRig({ band: 'Mids', attack: 30, envRelease: 250, gate: 0.2, curve: 'Sigmoid', normalize: false });

    rig.step(0.0);
    expect(rig.proc._audioClient.configs.length).toBe(1);
    const cfg = rig.proc._audioClient.configs[0];
    expect(cfg.frequency.mode).toBe('mids');
    expect(cfg.follower.attack_ms).toBe(30);
    expect(cfg.follower.release_ms).toBe(250);
    expect(cfg.follower.threshold).toBe(0.2);
    expect(cfg.shaping.curve).toBe('sigmoid');
    expect(cfg.shaping.normalize).toBe(false);

    // Unchanged params -> no repeat push.
    rig.step(0.0);
    expect(rig.proc._audioClient.configs.length).toBe(1);

    // Change a param -> one more push.
    rig.node.params.band = 'Highs';
    rig.step(0.0);
    expect(rig.proc._audioClient.configs.length).toBe(2);
    expect(rig.proc._audioClient.configs[1].frequency.mode).toBe('highs');
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
