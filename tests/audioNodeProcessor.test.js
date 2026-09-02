import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioAnalysisProcessor } from '../src/core/AudioAnalysisProcessor.js';
import { AUDIO_INSTRUMENTS, AUDIO_TAP_CHANNELS } from '../src/audio/audioAnalysisTaps.js';
import {
  resetAudioAnalysisSettings,
  updateAudioAnalysisSettings,
} from '../src/audio/audioAnalysisSettings.js';

// Covers the decision half: turning a 0..1 meter into triggers. The analysis that produces those
// meters is tested separately in realtimeAudioAnalysis.test.js.

function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

// A uniform manager with each node's single value registered, as getParam() would leave it.
function makeUniformManager(ids = []) {
  const uniformValues = new Map();
  for (const id of ids) uniformValues.set(`${id}.value`, 0);
  return { uniformValues };
}

/** One trigger node per drum, which is how a patch that watches all three is built now. */
function triggerNodes(params = {}) {
  return AUDIO_INSTRUMENTS.map((name) => ({
    id: name,
    kind: 'Audio',
    params: {
      channel: `${name}Trig`,
      threshold: params[`${name}Thresh`] !== undefined ? params[`${name}Thresh`] : 0.5,
    },
    inputs: [],
  }));
}

function stubClient() {
  const configs = [];
  let ticks = 0;
  return { configs, get ticks() { return ticks; }, tick() { ticks++; }, updateConfig(c) { configs.push(c); } };
}

const BANDS = ['low', 'mid', 'high', 'kick', 'snare', 'hat'];

/** Publish one frame of analysis, as RealtimeAudioAnalysis would. */
function setBands(values = {}, presence = {}) {
  const out = {
    level: 0, low: 0, mid: 0, high: 0, kick: 0, snare: 0, hat: 0,
    centroid: 0, density: 0,
    presence: {},
    ...values,
  };
  for (const b of BANDS) {
    out.presence[b] = presence[b] !== undefined ? presence[b] : (out[b] || 0) > 0;
  }
  window._audioBands = out;
}

/**
 * A rig with one Audio node per named channel — the shape a patch takes now that a node reads one
 * channel. `read(channel)` is that node's uniform.
 */
function makeChannelRig(channels, threshold = 0.5) {
  const nodes = channels.map((channel) => ({
    id: channel, kind: 'Audio', params: { channel, threshold }, inputs: [],
  }));
  const graph = makeGraph(nodes);
  const um = makeUniformManager(channels);
  const proc = new AudioAnalysisProcessor();
  proc._audioClient = stubClient();

  let t = 0;
  return {
    proc, graph, um,
    step(values, presence) {
      setBands(values, presence);
      t += 1 / 60;
      proc.update(graph, { time: t, now: t, uniformManager: um });
    },
    read: (channel) => um.uniformValues.get(`${channel}.value`),
    node: (channel) => nodes.find((n) => n.params.channel === channel),
  };
}

/** Drive the processor frame by frame on an explicit clock. */
function makeRig(params = {}) {
  const nodes = triggerNodes(params);
  const node = nodes[0];
  const graph = makeGraph(nodes);
  const um = makeUniformManager(AUDIO_INSTRUMENTS);
  const proc = new AudioAnalysisProcessor();
  proc._audioClient = stubClient();

  let t = 0;
  const step = (values, presence) => {
    setBands(values, presence);
    t += 1 / 60;
    proc.update(graph, { time: t, now: t, uniformManager: um });
    return {
      kick: um.uniformValues.get('kick.value'),
      snare: um.uniformValues.get('snare.value'),
      hat: um.uniformValues.get('hat.value'),
    };
  };
  // Hold a meter at a value for n frames, returning how many times the kick triggered.
  const hold = (values, n = 1, presence) => {
    let fired = 0;
    for (let i = 0; i < n; i++) fired += step(values, presence).kick;
    return fired;
  };
  // A hit shaped like a real one: rises, peaks, falls back.
  const hit = (band = 'kick', peak = 0.9) => {
    let fired = 0;
    for (const v of [0.1, 0.5, peak, peak * 0.7, 0.3, 0.05]) {
      fired += step({ [band]: v })[band];
    }
    return fired;
  };

  return { proc, node, nodes, graph, um, step, hold, hit, get time() { return t; } };
}

describe('AudioAnalysisProcessor', () => {
  beforeEach(() => { window._audioBands = undefined; resetAudioAnalysisSettings(); });
  afterEach(() => { delete window._audioBands; resetAudioAnalysisSettings(); });

  it('triggers once as a meter crosses the threshold', () => {
    const rig = makeRig();
    expect(rig.hit('kick')).toBe(1);
  });

  it('triggers once per hit across a run, never twice', () => {
    const rig = makeRig();
    for (let i = 0; i < 10; i++) expect(rig.hit('kick')).toBe(1);
  });

  it('does not machine-gun while a meter stays above the threshold', () => {
    // The edge is what prevents this: crossing up fires, staying up does not.
    const rig = makeRig();
    expect(rig.hold({ kick: 0.9 }, 120)).toBe(1);
  });

  it('re-arms only after the meter falls clear of the threshold', () => {
    const rig = makeRig({ kickThresh: 0.5 });
    expect(rig.hold({ kick: 0.9 }, 3)).toBe(1);
    // Dipping to just under the threshold is inside the hysteresis, so it must NOT re-arm.
    rig.hold({ kick: 0.46 }, 3);
    expect(rig.hold({ kick: 0.9 }, 3)).toBe(0);
    // Falling clear does re-arm.
    rig.hold({ kick: 0.1 }, 3);
    expect(rig.hold({ kick: 0.9 }, 3)).toBe(1);
  });

  it('never latches an instrument shut, even at a threshold the meter never falls below', () => {
    // The threshold-relative re-arm needs the meter under threshold*(1-hysteresis). Put the
    // threshold near the floor and ordinary material never gets there, so that rule alone fires
    // once and then goes silent for the rest of the track — a far worse failure than a stray
    // trigger, and one that used to be reachable both this way and via a meter stuck at its clamp.
    // The fall-from-peak rule is what keeps the instrument alive.
    const rig = makeRig({ kickThresh: 0.05 });
    const half = () => {
      let fired = 0;
      for (let i = 0; i < 6; i++) {
        fired += rig.hold({ kick: 0.9 }, 3); // a hit
        fired += rig.hold({ kick: 0.2 }, 6); // the gap — still far above 0.05 * 0.75
      }
      return fired;
    };
    const first = half();
    const second = half();
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0); // still responding, not stuck since the very first hit
  });

  it('leaves the trigger high for exactly one frame', () => {
    const rig = makeRig();
    rig.step({ kick: 0.1 });
    expect(rig.step({ kick: 0.9 }).kick).toBe(1);
    expect(rig.step({ kick: 0.9 }).kick).toBe(0);
  });

  it('gives each drum its own threshold, and they do not interfere', () => {
    const rig = makeRig({ kickThresh: 0.8, snareThresh: 0.3 });
    // 0.5 clears the snare's threshold but not the kick's.
    const r = rig.step({ kick: 0.5, snare: 0.5 });
    expect(r.kick).toBe(0);
    expect(r.snare).toBe(1);
  });

  it('raising a threshold only ever triggers less', () => {
    const counts = [0.1, 0.4, 0.7, 0.95].map((kickThresh) => {
      const rig = makeRig({ kickThresh });
      let fired = 0;
      for (let i = 0; i < 12; i++) fired += rig.hit('kick', 0.8);
      return fired;
    });
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts[counts.length - 1]).toBe(0); // above every peak, nothing fires
  });

  it('never triggers on a band that is not sounding', () => {
    const rig = makeRig();
    let fired = 0;
    for (let i = 0; i < 60; i++) fired += rig.step({ kick: 1.0 }, { kick: false }).kick;
    expect(fired).toBe(0);
  });

  it('never triggers at threshold 0, which would otherwise mean "always above"', () => {
    const rig = makeRig({ kickThresh: 0 });
    let fired = 0;
    for (let i = 0; i < 60; i++) fired += rig.step({ kick: 0 }).kick;
    expect(fired).toBe(0);
  });

  it('passes the continuous meters straight through', () => {
    const rig = makeChannelRig(['level', 'low', 'mid', 'high', 'centroid', 'density']);
    rig.step({ level: 0.4, low: 0.6, mid: 0.3, high: 0.2, centroid: 0.7, density: 0.15 });
    expect(rig.read('level')).toBeCloseTo(0.4);
    expect(rig.read('low')).toBeCloseTo(0.6);
    expect(rig.read('mid')).toBeCloseTo(0.3);
    expect(rig.read('high')).toBeCloseTo(0.2);
    expect(rig.read('centroid')).toBeCloseTo(0.7);
    expect(rig.read('density')).toBeCloseTo(0.15);
  });

  it('reports each drum meter alongside its trigger, so a threshold can be aimed at it', () => {
    const rig = makeChannelRig(['kickMeter', 'snareMeter', 'hatMeter']);
    rig.step({ kick: 0.42, snare: 0.31, hat: 0.77 });
    expect(rig.read('kickMeter')).toBeCloseTo(0.42);
    expect(rig.read('snareMeter')).toBeCloseTo(0.31);
    expect(rig.read('hatMeter')).toBeCloseTo(0.77);
  });

  it('decays the drum envelope after a trigger', () => {
    const rig = makeChannelRig(['kick']);
    rig.step({ kick: 0.1 });
    rig.step({ kick: 0.9 });
    const peak = rig.read('kick');
    expect(peak).toBeCloseTo(1.0);
    let prev = peak;
    for (let i = 0; i < 14; i++) {
      rig.step({ kick: 0.0 });
      const v = rig.read('kick');
      expect(v).toBeLessThan(prev);
      prev = v;
    }
    expect(prev).toBeLessThan(0.2);
  });

  it('times triggers on the wall clock, not the render loop\'s sim time', () => {
    const rig = makeChannelRig(['kickTrig']);
    let wall = 0;
    const step = (kick) => {
      setBands({ kick });
      wall += 1 / 60;
      // Sim time frozen: audio runs in real time and does not stop when the clock is paused.
      rig.proc.update(rig.graph, { time: 0, now: wall, uniformManager: rig.um });
      return rig.read('kickTrig');
    };
    step(0.1);
    expect(step(0.9)).toBe(1);
  });

  it('mirrors the value onto the node for the CPU preview', () => {
    const rig = makeChannelRig(['level', 'kickTrig', 'hatMeter']);
    rig.step({ level: 0.4, kick: 0.9, hat: 0.2 });
    expect(rig.node('level').__audio_value).toBeCloseTo(0.4);
    expect(rig.node('kickTrig').__audio_value).toBe(1);
    expect(rig.node('hatMeter').__audio_value).toBeCloseTo(0.2);
  });

  it('pushes envelope shaping to the audio engine, and only when it changes', () => {
    // Shaping is one setting for the whole editor now (the Audio panel owns it), because there is
    // one engine behind every audio node — copies of it per node meant the last one written won.
    updateAudioAnalysisSettings({ attack: 12, release: 200, gain: 2 });
    const rig = makeRig();
    rig.step({ kick: 0 });
    expect(rig.proc._audioClient.configs.length).toBe(1);
    expect(rig.proc._audioClient.configs[0].analysis).toEqual({
      attack_ms: 12, release_ms: 200, gain: 2,
    });
    for (let i = 0; i < 10; i++) rig.step({ kick: 0 });
    expect(rig.proc._audioClient.configs.length).toBe(1);

    updateAudioAnalysisSettings({ attack: 30 });
    rig.step({ kick: 0 });
    expect(rig.proc._audioClient.configs.length).toBe(2);
  });

  it('drives the audio engine once per update so the meters never freeze', () => {
    const rig = makeRig();
    rig.step({ kick: 0 });
    rig.step({ kick: 0 });
    expect(rig.proc._audioClient.ticks).toBe(2);
  });

  it('reads zero for every channel when no analysis has been published', () => {
    const rig = makeChannelRig(AUDIO_TAP_CHANNELS);
    window._audioBands = undefined;
    rig.proc.update(rig.graph, { time: 0, now: 0, uniformManager: rig.um });
    for (const channel of AUDIO_TAP_CHANNELS) {
      expect(rig.read(channel), channel).toBe(0);
    }
  });

  it('prunes state for deleted nodes', () => {
    const proc = new AudioAnalysisProcessor();
    proc._audioClient = stubClient();
    setBands({ kick: 0.9 });
    const node = { id: 'a', kind: 'Audio', params: { channel: 'kickTrig' }, inputs: [] };
    proc.update(makeGraph([node]), { time: 0, now: 0, uniformManager: makeUniformManager(['a']) });
    expect(proc._state.has('a')).toBe(true);

    const other = { id: 'x', kind: 'Time', params: {}, inputs: [] };
    proc.update(makeGraph([other]), { time: 0.016, now: 0.016, uniformManager: makeUniformManager([]) });
    expect(proc._state.has('a')).toBe(false);
  });
});
