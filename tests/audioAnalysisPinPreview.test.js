// Regression test: the Audio Analysis node has three independent outputs (level / kick / trig), but
// the CPU preview stored only a single scalar (level) for it. Every downstream CPU surface then
// collapsed to that one value: the per-pin value tags all showed level, a wire from the kick/trig
// pin read level, and a "=node_<id>_1/_2" reference read 0. The GPU output was always correct; only
// the preview/readout side was wrong.
//
// Fix: PreviewComputer exposes the node as a multi-output split { type:'split', values:[level,kick,
// trig] } — the same shape a Split node uses — so the existing multi-output plumbing resolves the
// right pin: _resolveInputValue indexes the split by the wire's source pin, and _addNodeRefsToContext
// unwraps it into node_<id>_0/1/2 for expression references.

import { describe, it, expect } from 'vitest';
import { PreviewComputer } from '../src/core/PreviewComputer.js';

describe('Audio Analysis multi-output pin preview', () => {
  function audioGraphWithRefs() {
    return {
      nodes: [
        { id: '10', kind: 'AudioAnalysis', inputs: [], params: {},
          __kickLevel: 0.42, __kickValue: 0.77, __kickTrig: 1.0 },
        // Reference each pin via an expression on a scalar node.
        { id: 'a', kind: 'ConstFloat', inputs: [], params: { value: '=node_10_0' } },
        { id: 'b', kind: 'ConstFloat', inputs: [], params: { value: '=node_10_1' } },
        { id: 'c', kind: 'ConstFloat', inputs: [], params: { value: '=node_10_2' } },
      ],
      connections: [],
    };
  }

  it('stores the node value as a split of [level, kick, trig]', () => {
    const computer = new PreviewComputer();
    const graph = audioGraphWithRefs();
    computer.computePreviews(graph);
    const audio = computer.lastComputedValues.get('10');
    expect(audio).toEqual({ type: 'split', values: [0.42, 0.77, 1.0] });
  });

  it('resolves =node_<id>_0/1/2 references to level / kick / trig', () => {
    const computer = new PreviewComputer();
    const graph = audioGraphWithRefs();
    computer.computePreviews(graph);
    expect(graph.nodes.find((n) => n.id === 'a').__preview).toBeCloseTo(0.42, 5); // level
    expect(graph.nodes.find((n) => n.id === 'b').__preview).toBeCloseTo(0.77, 5); // kick
    expect(graph.nodes.find((n) => n.id === 'c').__preview).toBeCloseTo(1.0, 5);  // trig
  });

  it('resolves a wire from pin 1 (kick) / pin 2 (trig) to the right output', () => {
    const computer = new PreviewComputer();
    const graph = {
      nodes: [
        { id: '10', kind: 'AudioAnalysis', inputs: [], params: {},
          __kickLevel: 0.42, __kickValue: 0.77, __kickTrig: 1.0 },
        // Add nodes wired to a specific source pin of the audio node.
        { id: 'k', kind: 'Add', inputs: ['10', null], params: {} },
        { id: 't', kind: 'Add', inputs: ['10', null], params: {} },
      ],
      connections: [
        { from: { nodeId: '10', pin: 1 }, to: { nodeId: 'k', pin: 0 } }, // kick
        { from: { nodeId: '10', pin: 2 }, to: { nodeId: 't', pin: 0 } }, // trig
      ],
    };
    computer.computePreviews(graph);
    // Add(pin + 0) — the wired pin value flows straight through.
    expect(graph.nodes.find((n) => n.id === 'k').__preview).toBeCloseTo(0.77, 5); // kick
    expect(graph.nodes.find((n) => n.id === 't').__preview).toBeCloseTo(1.0, 5);  // trig
  });
});
