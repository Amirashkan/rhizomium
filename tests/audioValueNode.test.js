// The Audio Value node: one channel of the shared live analysis, deployed from the Audio panel.
//
// Covers the three things that make it a TAP rather than a second detector: it reads the shared
// channel values (so two taps on one channel agree), its uniform name does not depend on which
// channel it names (so switching channels costs no recompile), and the shared thresholds come from
// the panel's settings rather than from the node.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioAnalysisProcessor } from '../src/core/AudioAnalysisProcessor.js';
import { InputNodes as InputNodeCompiler } from '../src/codegen/compilers/InputNodes.js';
import { InputNodes as InputNodeDefs } from '../src/data/nodes/InputNodes.js';
import { AUDIO_ANALYSIS_PINS } from '../src/core/audioAnalysisPins.js';
import {
  AUDIO_TAP_CHANNELS,
  AUDIO_TAP_LABELS,
  DEFAULT_AUDIO_TAP_CHANNEL,
  getAudioTapValues,
  setAudioTapsWanted,
} from '../src/audio/audioAnalysisTaps.js';
import {
  getAudioAnalysisSettings,
  resetAudioAnalysisSettings,
  updateAudioAnalysisSettings,
} from '../src/audio/audioAnalysisSettings.js';

function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

/** A uniform manager with each tap's single `<id>.value` slot registered, as getParam would leave it. */
function makeUniformManager(ids = []) {
  const uniformValues = new Map();
  for (const id of ids) uniformValues.set(`${id}.value`, 0);
  return { uniformValues };
}

function tapNode(id, channel) {
  return { id, kind: 'AudioValue', params: { channel }, inputs: [] };
}

function stubClient() {
  const configs = [];
  return { configs, tick() {}, updateConfig(c) { configs.push(c); } };
}

const BANDS = ['low', 'mid', 'high', 'kick', 'snare', 'hat'];

function setBands(values = {}) {
  const out = {
    level: 0, low: 0, mid: 0, high: 0, kick: 0, snare: 0, hat: 0,
    centroid: 0, density: 0,
    presence: {},
    ...values,
  };
  for (const b of BANDS) out.presence[b] = (out[b] || 0) > 0;
  window._audioBands = out;
}

/** Drive the processor frame by frame on an explicit clock. */
function makeRig(nodes) {
  const graph = makeGraph(nodes);
  const um = makeUniformManager(nodes.map((n) => n.id));
  const proc = new AudioAnalysisProcessor();
  proc._audioClient = stubClient();

  let t = 0;
  const step = (values) => {
    setBands(values);
    t += 1 / 60;
    proc.update(graph, { time: t, now: t, uniformManager: um });
  };
  return { proc, graph, um, step };
}

describe('Audio Value node', () => {
  beforeEach(() => {
    window._audioBands = undefined;
    resetAudioAnalysisSettings();
    setAudioTapsWanted(false);
  });
  afterEach(() => {
    delete window._audioBands;
    resetAudioAnalysisSettings();
    setAudioTapsWanted(false);
  });

  describe('definition', () => {
    it('is a single-output float whose Channel menu covers every analysis channel', () => {
      const def = InputNodeDefs.AudioValue;
      expect(def.inputs).toBe(0);
      expect(def.pinsOut).toEqual([{ label: 'out', type: 'f32' }]);

      const channel = def.params.find((p) => p.name === 'channel');
      expect(channel.default).toBe(DEFAULT_AUDIO_TAP_CHANNEL);
      expect(channel.options.map((o) => o.value)).toEqual(AUDIO_ANALYSIS_PINS);
      // Labelled, because a canvas of nodes reading "hatTrig" is a canvas nobody can scan.
      expect(channel.options.map((o) => o.label)).toEqual(
        AUDIO_ANALYSIS_PINS.map((name) => AUDIO_TAP_LABELS[name]),
      );
    });

    it('names the same channels the taps do', () => {
      expect(AUDIO_TAP_CHANNELS).toEqual(AUDIO_ANALYSIS_PINS);
    });
  });

  describe('codegen', () => {
    const compiler = new InputNodeCompiler();

    it('reads one uniform, whatever channel the node names', () => {
      const getParam = (name) => `u_params._5_${name}`;
      const level = compiler.compile(tapNode('5', 'level'), () => '0.0', getParam);
      const trig = compiler.compile(tapNode('5', 'kickTrig'), () => '0.0', getParam);

      expect(level.line).toBe('let node_5 = u_params._5_value;');
      expect(level.outputType).toBe('f32');
      // Identical emitted code: the channel is resolved on the CPU, so switching it is a different
      // number in the same uniform rather than a shader rebuild.
      expect(trig.line).toBe(level.line);
    });

    it('falls back to a compilable 0.0 with no uniform manager', () => {
      const result = compiler.compile(tapNode('6', 'level'), () => '0.0', null);
      expect(result.line).toBe('let node_6 = 0.0;');
    });
  });

  describe('processor', () => {
    it('writes the named channel into the node uniform', () => {
      const low = tapNode('a', 'low');
      const high = tapNode('b', 'high');
      const rig = makeRig([low, high]);

      rig.step({ low: 0.4, high: 0.9 });

      expect(rig.um.uniformValues.get('a.value')).toBeCloseTo(0.4);
      expect(rig.um.uniformValues.get('b.value')).toBeCloseTo(0.9);
      // Also stashed on the node, which is what every CPU consumer (preview, Hold, Count) reads.
      expect(low.__audio_value).toBeCloseTo(0.4);
      expect(high.__audio_value).toBeCloseTo(0.9);
    });

    it('follows the channel parameter when it changes, with no recompile involved', () => {
      const tap = tapNode('a', 'low');
      const rig = makeRig([tap]);

      rig.step({ low: 0.4, high: 0.9 });
      expect(tap.__audio_value).toBeCloseTo(0.4);

      tap.params.channel = 'high';
      rig.step({ low: 0.4, high: 0.9 });
      expect(tap.__audio_value).toBeCloseTo(0.9);
    });

    it('gives two taps on one channel the same value', () => {
      const first = tapNode('a', 'kickTrig');
      const second = tapNode('b', 'kickTrig');
      const rig = makeRig([first, second]);

      let bothFired = 0;
      for (const v of [0.1, 0.5, 0.9, 0.6, 0.2, 0.05]) {
        rig.step({ kick: v });
        expect(first.__audio_value).toBe(second.__audio_value);
        bothFired += first.__audio_value;
      }
      // One hit, one trigger — on the same frame for both taps.
      expect(bothFired).toBe(1);
    });

    it('reads an unknown channel as the default rather than as undefined', () => {
      const tap = tapNode('a', 'nonsense');
      const rig = makeRig([tap]);
      rig.step({ level: 0.7 });
      expect(tap.__audio_value).toBeCloseTo(0.7);
    });

    it('thresholds each drum from the shared settings, not from the node', () => {
      const tap = tapNode('a', 'kickTrig');
      const rig = makeRig([tap]);

      // A hit that peaks at 0.4 clears a 0.3 threshold...
      updateAudioAnalysisSettings({ kickThresh: 0.3 });
      let fired = 0;
      for (const v of [0.05, 0.2, 0.4, 0.2, 0.05]) {
        rig.step({ kick: v });
        fired += tap.__audio_value;
      }
      expect(fired).toBe(1);

      // ...and does not clear a 0.8 one.
      updateAudioAnalysisSettings({ kickThresh: 0.8 });
      fired = 0;
      for (const v of [0.05, 0.2, 0.4, 0.2, 0.05]) {
        rig.step({ kick: v });
        fired += tap.__audio_value;
      }
      expect(fired).toBe(0);
    });

    it('publishes every channel for the panel to display', () => {
      const rig = makeRig([tapNode('a', 'level')]);
      rig.step({ level: 0.5, low: 0.25, centroid: 0.75 });

      const taps = getAudioTapValues();
      expect(Object.keys(taps).sort()).toEqual([...AUDIO_ANALYSIS_PINS].sort());
      expect(taps.level).toBeCloseTo(0.5);
      expect(taps.low).toBeCloseTo(0.25);
      expect(taps.centroid).toBeCloseTo(0.75);
    });

    it('keeps the taps live for the panel with no tap node in the graph', () => {
      const rig = makeRig([]);

      rig.step({ level: 0.6 });
      expect(getAudioTapValues().level).toBe(0);

      // The panel asks for them while it is on screen, so its meters move before anything has been
      // deployed — which is what a threshold is set against.
      setAudioTapsWanted(true);
      rig.step({ level: 0.6 });
      expect(getAudioTapValues().level).toBeCloseTo(0.6);

      // ...and stops paying for them once it closes.
      setAudioTapsWanted(false);
      rig.step({ level: 0.6 });
      expect(getAudioTapValues().level).toBe(0);
    });

    it('pushes the panel meter shaping to the engine', () => {
      const rig = makeRig([tapNode('a', 'level')]);
      updateAudioAnalysisSettings({ attack: 20, release: 300, gain: 2 });
      rig.step({ level: 0.5 });

      expect(rig.proc._audioClient.configs.at(-1)).toEqual({
        analysis: { attack_ms: 20, release_ms: 300, gain: 2 },
      });
    });

    it('leaves the engine to an Audio Analysis node when the graph still has one', () => {
      // Patches made before the panel existed carry their shaping on the node; it keeps winning, so
      // they go on behaving exactly as they did.
      const legacy = {
        id: 'legacy',
        kind: 'AudioAnalysis',
        params: { attack: 5, release: 90, gain: 3 },
        inputs: [],
      };
      const rig = makeRig([legacy, tapNode('a', 'level')]);
      updateAudioAnalysisSettings({ attack: 20, release: 300, gain: 2 });
      rig.step({ level: 0.5 });

      expect(rig.proc._audioClient.configs.at(-1)).toEqual({
        analysis: { attack_ms: 5, release_ms: 90, gain: 3 },
      });
      // The tap is still served — it just does not get to shape the engine.
      expect(rig.graph.getNode('a').__audio_value).toBeCloseTo(0.5);
    });
  });

  describe('shared settings', () => {
    it('clamps to a usable range instead of rejecting an out-of-range value', () => {
      expect(updateAudioAnalysisSettings({ kickThresh: 4 }).kickThresh).toBe(1);
      expect(updateAudioAnalysisSettings({ gain: -2 }).gain).toBe(0);
      expect(updateAudioAnalysisSettings({ attack: 'nonsense' }).attack)
        .toBe(getAudioAnalysisSettings().attack);
    });

    it('hands back a copy, so a caller cannot mutate the shared state', () => {
      const snapshot = getAudioAnalysisSettings();
      snapshot.gain = 99;
      expect(getAudioAnalysisSettings().gain).not.toBe(99);
    });
  });
});
