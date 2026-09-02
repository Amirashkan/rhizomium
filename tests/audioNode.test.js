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
import {
  AUDIO_TAP_CHANNELS,
  AUDIO_TAP_LABELS,
  AUDIO_THRESHOLD_CHANNELS,
  DEFAULT_AUDIO_TAP_CHANNEL,
  getAudioTapValues,
  setAudioTapsWanted,
} from '../src/audio/audioAnalysisTaps.js';
import {
  clearExternalReadings,
  recordExternalReading,
} from '../src/parameters/ExternalParameterControl.js';
import { MIDIParameterBinding } from '../src/midi/MIDIParameterBinding.js';
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

function tapNode(id, channel, params = {}) {
  return { id, kind: 'Audio', params: { channel, ...params }, inputs: [] };
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

describe('Audio node', () => {
  beforeEach(() => {
    window._audioBands = undefined;
    resetAudioAnalysisSettings();
    setAudioTapsWanted(false);
  });
  afterEach(() => {
    delete window._audioBands;
    resetAudioAnalysisSettings();
    setAudioTapsWanted(false);
    clearExternalReadings('a');
    clearExternalReadings('b');
  });

  describe('definition', () => {
    it('is a single-output float whose Channel menu covers every analysis channel', () => {
      const def = InputNodeDefs.Audio;
      expect(def.inputs).toBe(0);
      expect(def.pinsOut).toEqual([{ label: 'out', type: 'f32' }]);

      const threshold = def.params.find((p) => p.name === 'threshold');
      // A node parameter, not a panel setting: that is what makes it MIDI-mappable and saved with
      // the patch. min/max are what a controller's 0-1 sweep is mapped onto.
      expect(threshold.min).toBe(0);
      expect(threshold.max).toBe(1);
      // Dimmed on the channels where a threshold decides nothing.
      expect(threshold.activeWhen).toEqual({ channel: AUDIO_THRESHOLD_CHANNELS });

      const channel = def.params.find((p) => p.name === 'channel');
      expect(channel.default).toBe(DEFAULT_AUDIO_TAP_CHANNEL);
      expect(channel.options.map((o) => o.value)).toEqual(AUDIO_TAP_CHANNELS);
      // Labelled, because a canvas of nodes reading "hatTrig" is a canvas nobody can scan.
      expect(channel.options.map((o) => o.label)).toEqual(
        AUDIO_TAP_CHANNELS.map((name) => AUDIO_TAP_LABELS[name]),
      );
    });

    it('names the same channels the taps do', () => {
      expect(AUDIO_TAP_CHANNELS).toEqual(AUDIO_TAP_CHANNELS);
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

    it('gives two taps on one channel and one threshold the same value', () => {
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

    it('decides each trigger tap on its OWN threshold parameter', () => {
      // Two taps on one drum, thresholded differently: the quiet hit is a kick for one of them and
      // not for the other. That is the point of the threshold living on the node.
      const low = tapNode('a', 'kickTrig', { threshold: 0.3 });
      const high = tapNode('b', 'kickTrig', { threshold: 0.8 });
      const rig = makeRig([low, high]);

      let lowFired = 0;
      let highFired = 0;
      for (const v of [0.05, 0.2, 0.4, 0.2, 0.05]) {
        rig.step({ kick: v });
        lowFired += low.__audio_value;
        highFired += high.__audio_value;
      }
      expect(lowFired).toBe(1);
      expect(highFired).toBe(0);
    });

    it('follows a threshold written as an expression, including `=midi`', () => {
      // The reading a MIDI binding records for this parameter is what `midi` resolves to, exactly
      // as it does on a shader-side parameter — so a knob on the threshold moves the decision the
      // trigger is actually made on, not just a number in the panel.
      const tap = tapNode('a', 'kickTrig', { threshold: '=midi' });
      const rig = makeRig([tap]);

      const hit = () => {
        let fired = 0;
        for (const v of [0.05, 0.2, 0.4, 0.2, 0.05]) {
          rig.step({ kick: v });
          fired += tap.__audio_value;
        }
        return fired;
      };

      recordExternalReading('a', 'threshold', 'midi', 0.3);
      expect(hit()).toBe(1);

      recordExternalReading('a', 'threshold', 'midi', 0.8);
      expect(hit()).toBe(0);

      // Turned back down, the same hit fires again — the knob is live, not read once.
      recordExternalReading('a', 'threshold', 'midi', 0.3);
      expect(hit()).toBe(1);
    });

    it('exposes the resolved threshold for the panel to draw against the meter', () => {
      const tap = tapNode('a', 'kick', { threshold: '=midi' });
      const rig = makeRig([tap]);
      recordExternalReading('a', 'threshold', 'midi', 0.42);
      rig.step({ kick: 0.1 });
      expect(tap.__audio_threshold).toBeCloseTo(0.42);
    });

    it('reads an envelope channel as the envelope and a trigger channel as the pulse', () => {
      const env = tapNode('a', 'kick', { threshold: 0.3 });
      const trig = tapNode('b', 'kickTrig', { threshold: 0.3 });
      const rig = makeRig([env, trig]);

      rig.step({ kick: 0.05 });
      rig.step({ kick: 0.9 });
      // The hit frame: both read 1.
      expect(env.__audio_value).toBeCloseTo(1);
      expect(trig.__audio_value).toBe(1);

      rig.step({ kick: 0.9 });
      // The frame after: the trigger is one frame wide, the envelope decays.
      expect(trig.__audio_value).toBe(0);
      expect(env.__audio_value).toBeGreaterThan(0.5);
      expect(env.__audio_value).toBeLessThan(1);
    });

    it('forgets a deleted tap’s trigger memory', () => {
      const tap = tapNode('a', 'kickTrig', { threshold: 0.3 });
      const rig = makeRig([tap]);
      rig.step({ kick: 0.9 });
      expect(rig.proc._state.has('a')).toBe(true);

      rig.graph.nodes.length = 0;
      setAudioTapsWanted(true);
      rig.step({ kick: 0.9 });
      expect(rig.proc._state.has('a')).toBe(false);
    });

    it('publishes every channel for the panel to display', () => {
      const rig = makeRig([tapNode('a', 'level')]);
      rig.step({ level: 0.5, low: 0.25, centroid: 0.75 });

      const taps = getAudioTapValues();
      expect(Object.keys(taps).sort()).toEqual([...AUDIO_TAP_CHANNELS].sort());
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

  });

  // The point of the threshold being a node parameter rather than a panel setting: the MIDI
  // machinery that already exists for every other parameter reaches it, with nothing added.
  describe('MIDI on the threshold', () => {
    function makeEventSystem() {
      const handlers = new Map();
      return {
        on(type, fn) {
          if (!handlers.has(type)) handlers.set(type, []);
          handlers.get(type).push(fn);
        },
        emit(type, data) { (handlers.get(type) || []).forEach((fn) => fn(data)); },
      };
    }

    /** A rig with a CC bound to the tap's threshold, and a way to deliver readings. */
    function makeMidiRig(params) {
      const tap = tapNode('a', 'kickTrig', params);
      const rig = makeRig([tap]);
      const events = makeEventSystem();
      const binding = new MIDIParameterBinding(rig.graph, events, null);
      binding.createBinding('dev', 0, 7, 'a', 'threshold', { min: 0, max: 1 });

      const send = (normalized) => events.emit('MIDI_CC', {
        deviceId: 'dev', channel: 0, cc: 7,
        value: Math.round(normalized * 127), normalizedValue: normalized,
      });
      // A hit peaking at 0.4: above a low threshold, below a high one.
      const hit = () => {
        let fired = 0;
        for (const v of [0.05, 0.2, 0.4, 0.2, 0.05]) {
          rig.step({ kick: v });
          fired += tap.__audio_value;
        }
        return fired;
      };
      return { tap, send, hit };
    }

    it('moves a plain threshold, and with it the decision the trigger is made on', () => {
      const { tap, send, hit } = makeMidiRig({ threshold: 0.5 });

      send(0.3);
      expect(tap.params.threshold).toBeCloseTo(0.3);
      expect(hit()).toBe(1);

      send(0.8);
      expect(tap.params.threshold).toBeCloseTo(0.8);
      expect(hit()).toBe(0);
    });

    it('feeds a threshold that holds an expression instead of overwriting it', () => {
      // `=midi * 0.5` — the knob sets the threshold, halved. The formula survives every CC.
      const { tap, send, hit } = makeMidiRig({ threshold: '=midi * 0.5' });

      send(0.6);
      expect(hit()).toBe(1);
      // The formula is still in the field; what it resolved to this frame is half the reading.
      expect(tap.params.threshold).toBe('=midi * 0.5');
      expect(tap.__audio_threshold).toBeCloseTo(0.3);

      send(1);
      expect(hit()).toBe(0);
      expect(tap.params.threshold).toBe('=midi * 0.5');
      expect(tap.__audio_threshold).toBeCloseTo(0.5);
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
