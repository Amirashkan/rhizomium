// Regression test: the Audio Analysis node has three independent outputs (level / kick / trig), but
// the CPU preview stored only a single scalar (level) for it. Every downstream CPU surface then
// collapsed to that one value: the per-pin value tags all showed level, a wire from the kick/trig
// pin read level, and a "=node_<id>_N" reference read 0. The GPU output was always correct; only
// the preview/readout side was wrong.
//
// Fix: PreviewComputer exposes the node as a multi-output split { type:'split', values:[per-pin,
// trig] } — the same shape a Split node uses — so the existing multi-output plumbing resolves the
// right pin: _resolveInputValue indexes the split by the wire's source pin, and _addNodeRefsToContext
// unwraps it into node_<id>_N for expression references.

import { describe, it, expect } from 'vitest';
import { PreviewComputer } from '../src/core/PreviewComputer.js';
import { AUDIO_ANALYSIS_PINS } from '../src/core/audioAnalysisPins.js';

describe('Audio Analysis multi-output pin preview', () => {
  function audioGraphWithRefs() {
    return {
      nodes: [
        { id: '10', kind: 'AudioAnalysis', inputs: [], params: {},
          __audio_level: 0.42, __audio_kick: 0.77, __audio_kickTrig: 1.0 },
        // Reference each pin via an expression on a scalar node.
        { id: 'a', kind: 'ConstFloat', inputs: [], params: { value: '=node_10_0' } },
        { id: 'b', kind: 'ConstFloat', inputs: [], params: { value: `=node_10_${AUDIO_ANALYSIS_PINS.indexOf('kick')}` } },
        { id: 'c', kind: 'ConstFloat', inputs: [], params: { value: `=node_10_${AUDIO_ANALYSIS_PINS.indexOf('kickTrig')}` } },
      ],
      connections: [],
    };
  }

  it('stores the node value as a split with one entry per output pin', () => {
    const computer = new PreviewComputer();
    const graph = audioGraphWithRefs();
    computer.computePreviews(graph);
    const audio = computer.lastComputedValues.get('10');
    expect(audio.type).toBe('split');
    expect(audio.values).toHaveLength(AUDIO_ANALYSIS_PINS.length);
    expect(audio.values[AUDIO_ANALYSIS_PINS.indexOf('level')]).toBeCloseTo(0.42);
    expect(audio.values[AUDIO_ANALYSIS_PINS.indexOf('kick')]).toBeCloseTo(0.77);
    expect(audio.values[AUDIO_ANALYSIS_PINS.indexOf('kickTrig')]).toBeCloseTo(1.0);
  });

  it('resolves =node_<id>_N references to the matching pin', () => {
    const computer = new PreviewComputer();
    const graph = audioGraphWithRefs();
    computer.computePreviews(graph);
    expect(graph.nodes.find((n) => n.id === 'a').__preview).toBeCloseTo(0.42, 5); // level
    expect(graph.nodes.find((n) => n.id === 'b').__preview).toBeCloseTo(0.77, 5); // kick
    expect(graph.nodes.find((n) => n.id === 'c').__preview).toBeCloseTo(1.0, 5);  // trig
  });

  it('resolves a wire from a specific source pin to that pin\'s output', () => {
    const computer = new PreviewComputer();
    const graph = {
      nodes: [
        { id: '10', kind: 'AudioAnalysis', inputs: [], params: {},
          __audio_level: 0.42, __audio_kick: 0.77, __audio_kickTrig: 1.0 },
        // Add nodes wired to a specific source pin of the audio node.
        { id: 'k', kind: 'Add', inputs: ['10', null], params: {} },
        { id: 't', kind: 'Add', inputs: ['10', null], params: {} },
      ],
      connections: [
        { from: { nodeId: '10', pin: AUDIO_ANALYSIS_PINS.indexOf('kick') }, to: { nodeId: 'k', pin: 0 } },
        { from: { nodeId: '10', pin: AUDIO_ANALYSIS_PINS.indexOf('kickTrig') }, to: { nodeId: 't', pin: 0 } },
      ],
    };
    computer.computePreviews(graph);
    // Add(pin + 0) — the wired pin value flows straight through.
    expect(graph.nodes.find((n) => n.id === 'k').__preview).toBeCloseTo(0.77, 5); // kick
    expect(graph.nodes.find((n) => n.id === 't').__preview).toBeCloseTo(1.0, 5);  // trig
  });
});
