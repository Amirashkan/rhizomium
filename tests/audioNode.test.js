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
  AUDIO_ANALYSIS_DEFAULTS,
  clampAudioSetting,
} from '../src/audio/audioAnalysisDefaults.js';

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
  return { id, kind: 'AudioValue', params: { channel, ...params }, inputs: [] };
}

/** The Audio node the analysis's settings live on. */
function setupNode(params = {}, id = 'setup') {
  return { id, kind: 'Audio', params, inputs: [] };
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
    setAudioTapsWanted(false);
  });
  afterEach(() => {
    delete window._audioBands;
    setAudioTapsWanted(false);
    clearExternalReadings('a');
    clearExternalReadings('b');
    clearExternalReadings('setup');
  });

  describe('definition', () => {
    it('is a single-output float whose Channel menu covers every analysis channel', () => {
      const def = InputNodeDefs.AudioValue;
      expect(def.inputs).toBe(0);
      expect(def.pinsOut).toEqual([{ label: 'out', type: 'f32' }]);
      // It reads a channel and nothing else: the drums are thresholded once, on the Audio node.
      expect(def.params.find((p) => p.name === 'threshold')).toBeUndefined();
      // Added from the panel, beside the meter you are choosing — so it stays out of the palette.
      expect(def.hidden).toBe(true);

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

    it('keeps the analysis settings on the Audio node, as MIDI-mappable parameters', () => {
      const def = InputNodeDefs.Audio;
      // No outputs: it is the setup, not a signal.
      expect(def.pinsOut).toEqual([]);
      expect(def.inputs).toBe(0);
      // In the palette, unlike the reader — this is the node you reach for to automate the audio.
      expect(def.hidden).toBeUndefined();

      const byName = Object.fromEntries(def.params.map((p) => [p.name, p]));
      for (const name of ['kickThresh', 'snareThresh', 'hatThresh']) {
        // min/max are what a controller's 0-1 sweep is mapped onto.
        expect(byName[name].min, name).toBe(0);
        expect(byName[name].max, name).toBe(1);
      }
      for (const name of ['attack', 'release', 'gain']) {
        expect(byName[name], name).toBeTruthy();
      }
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

    it('decides every reader of a drum on the setup node\'s threshold', () => {
      // One decision per drum for the whole patch: two nodes on `kickTrig` are two views of one
      // kick and fire on the same frame.
      const setup = setupNode({ kickThresh: 0.3 });
      const first = tapNode('a', 'kickTrig');
      const second = tapNode('b', 'kickTrig');
      const rig = makeRig([setup, first, second]);

      let fired = 0;
      for (const v of [0.05, 0.2, 0.4, 0.2, 0.05]) {
        rig.step({ kick: v });
        expect(first.__audio_value).toBe(second.__audio_value);
        fired += first.__audio_value;
      }
      expect(fired).toBe(1);

      // Raise it past the hit and the same material stops firing.
      setup.params.kickThresh = 0.8;
      fired = 0;
      for (const v of [0.05, 0.2, 0.4, 0.2, 0.05]) {
        rig.step({ kick: v });
        fired += first.__audio_value;
      }
      expect(fired).toBe(0);
    });

    it('follows a threshold written as an expression, including `=midi`', () => {
      // The reading a MIDI binding records for this parameter is what `midi` resolves to, exactly
      // as it does on a shader-side parameter — so a knob on the threshold moves the decision the
      // trigger is actually made on, not just a number in the panel.
      const setup = setupNode({ kickThresh: '=midi' });
      const tap = tapNode('a', 'kickTrig');
      const rig = makeRig([setup, tap]);

      const hit = () => {
        let fired = 0;
        for (const v of [0.05, 0.2, 0.4, 0.2, 0.05]) {
          rig.step({ kick: v });
          fired += tap.__audio_value;
        }
        return fired;
      };

      recordExternalReading('setup', 'kickThresh', 'midi', 0.3);
      expect(hit()).toBe(1);

      recordExternalReading('setup', 'kickThresh', 'midi', 0.8);
      expect(hit()).toBe(0);

      // Turned back down, the same hit fires again — the knob is live, not read once.
      recordExternalReading('setup', 'kickThresh', 'midi', 0.3);
      expect(hit()).toBe(1);
    });

    it('exposes the resolved settings for the panel to draw against the meters', () => {
      const setup = setupNode({ kickThresh: '=midi' });
      const rig = makeRig([setup, tapNode('a', 'kick')]);
      recordExternalReading('setup', 'kickThresh', 'midi', 0.42);
      rig.step({ kick: 0.1 });
      // What the panel shows on the slider and draws as the marker: the number decided on, not the
      // text in the field.
      expect(setup.__audio_settings.kickThresh).toBeCloseTo(0.42);
    });

    it('reads an envelope channel as the envelope and a trigger channel as the pulse', () => {
      const env = tapNode('a', 'kick');
      const trig = tapNode('b', 'kickTrig');
      const rig = makeRig([setupNode({ kickThresh: 0.3 }), env, trig]);

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

    it('falls back to the built-in defaults when the patch has no Audio node', () => {
      const tap = tapNode('a', 'kickTrig');
      const rig = makeRig([tap]);

      // The default threshold is 0.5, so a peak of 0.6 is a hit and a peak of 0.4 is not.
      let fired = 0;
      for (const v of [0.05, 0.2, 0.6, 0.2, 0.05]) {
        rig.step({ kick: v });
        fired += tap.__audio_value;
      }
      expect(fired).toBe(1);
      expect(AUDIO_ANALYSIS_DEFAULTS.kickThresh).toBe(0.5);

      let quiet = 0;
      for (const v of [0.05, 0.2, 0.4, 0.2, 0.05]) {
        rig.step({ kick: v });
        quiet += tap.__audio_value;
      }
      expect(quiet).toBe(0);
    });

    it('publishes every channel for the panel to display', () => {
      const rig = makeRig([tapNode('a', 'level')]);
      rig.step({ level: 0.5, low: 0.25, centroid: 0.75 });

      const taps = getAudioTapValues();
      // Every channel, plus `trigCount` — not a channel, but the per-drum fire counts a reader
      // slower than the ~125 Hz analysis needs in order not to miss a one-step trigger.
      expect(Object.keys(taps).sort()).toEqual([...AUDIO_TAP_CHANNELS, 'trigCount'].sort());
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

    it('pushes the Audio node meter shaping to the engine', () => {
      const setup = { id: 'setup', kind: 'Audio', params: { attack: 20, release: 300, gain: 2 }, inputs: [] };
      const rig = makeRig([setup, tapNode('a', 'level')]);
      rig.step({ level: 0.5 });

      expect(rig.proc._audioClient.configs.at(-1)).toEqual({
        analysis: { attack_ms: 20, release_ms: 300, gain: 2 },
      });
    });

    it('pushes the built-in defaults with no Audio node', () => {
      const rig = makeRig([tapNode('a', 'level')]);
      rig.step({ level: 0.5 });

      expect(rig.proc._audioClient.configs.at(-1)).toEqual({
        analysis: { attack_ms: 8, release_ms: 120, gain: 1 },
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

    /** A rig with a CC bound to the setup node's kick threshold, and a way to deliver readings. */
    function makeMidiRig(kickThresh) {
      const setup = setupNode({ kickThresh });
      const tap = tapNode('a', 'kickTrig');
      const rig = makeRig([setup, tap]);
      const events = makeEventSystem();
      const binding = new MIDIParameterBinding(rig.graph, events, null);
      binding.createBinding('dev', 0, 7, 'setup', 'kickThresh', { min: 0, max: 1 });

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
      return { setup, send, hit };
    }

    it('moves a plain threshold, and with it the decision the trigger is made on', () => {
      const { setup, send, hit } = makeMidiRig(0.5);

      send(0.3);
      expect(setup.params.kickThresh).toBeCloseTo(0.3);
      expect(hit()).toBe(1);

      send(0.8);
      expect(setup.params.kickThresh).toBeCloseTo(0.8);
      expect(hit()).toBe(0);
    });

    it('feeds a threshold that holds an expression instead of overwriting it', () => {
      // `=midi * 0.5` — the knob sets the threshold, halved. The formula survives every CC.
      const { setup, send, hit } = makeMidiRig('=midi * 0.5');

      send(0.6);
      expect(hit()).toBe(1);
      // The formula is still in the field; what it resolved to this frame is half the reading.
      expect(setup.params.kickThresh).toBe('=midi * 0.5');
      expect(setup.__audio_settings.kickThresh).toBeCloseTo(0.3);

      send(1);
      expect(hit()).toBe(0);
      expect(setup.params.kickThresh).toBe('=midi * 0.5');
      expect(setup.__audio_settings.kickThresh).toBeCloseTo(0.5);
    });
  });

  describe('the settings declaration', () => {
    // A value out of range does not merely misbehave, it wedges the detector: a release of -5 ms or
    // a threshold of 40 leaves an instrument that can never fire. A parameter can hold an
    // expression and an expression can produce anything, so the engine takes the nearest usable
    // number instead of the one it was handed.
    it('clamps to a usable range instead of rejecting an out-of-range value', () => {
      expect(clampAudioSetting('kickThresh', 4)).toBe(1);
      expect(clampAudioSetting('gain', -2)).toBe(0);
      expect(clampAudioSetting('release', 0)).toBe(1);
      expect(clampAudioSetting('attack', 'nonsense')).toBe(AUDIO_ANALYSIS_DEFAULTS.attack);
    });

    it('clamps what the processor reads off a node, not just what a field accepts', () => {
      const setup = {
        id: 'setup', kind: 'Audio',
        // An expression is the way a wild number actually gets here.
        params: { kickThresh: '=1 + 40', release: '=0 - 5' },
        inputs: [],
      };
      const rig = makeRig([setup, tapNode('a', 'kickTrig')]);
      rig.step({ kick: 0.9 });

      expect(setup.__audio_settings.kickThresh).toBe(1);
      expect(setup.__audio_settings.release).toBe(1);
    });
  });
});
