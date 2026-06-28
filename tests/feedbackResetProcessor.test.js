import { describe, it, expect, beforeEach } from 'vitest';
import { FeedbackResetProcessor } from '../src/core/FeedbackResetProcessor.js';

// Minimal stand-in for the editor graph: nodes + getNode by id.
function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

// Records resetNodeFeedback(nodeId) calls so tests can assert how often each node was reset.
function makeExecutor() {
  const calls = [];
  return { calls, resetNodeFeedback: (id) => calls.push(id) };
}

function constFloat(id, value) {
  return { id, kind: 'ConstFloat', params: { value }, inputs: [] };
}

// A Feedback node with pin 0 = texture Input, pin 1 = Reset control pin.
function feedbackNode(id, resetSrcId, kind = 'ComputeFeedback') {
  return { id, kind, params: {}, inputs: ['tex', resetSrcId] };
}

describe('FeedbackResetProcessor', () => {
  let proc;
  beforeEach(() => {
    proc = new FeedbackResetProcessor();
  });

  it('resets once per rising edge of the reset pin, not every frame it stays high', () => {
    const reset = constFloat('r', 0.0);
    const fb = feedbackNode('f', 'r');
    const graph = makeGraph([reset, fb]);
    const exec = makeExecutor();

    // Low -> nothing.
    proc.update(graph, { time: 0, computeExecutor: exec });
    expect(exec.calls).toEqual([]);

    // Rising edge -> one reset.
    reset.params.value = 1.0;
    proc.update(graph, { time: 0.016, computeExecutor: exec });
    expect(exec.calls).toEqual(['f']);

    // Still high -> no further reset.
    proc.update(graph, { time: 0.032, computeExecutor: exec });
    expect(exec.calls).toEqual(['f']);

    // Falls then rises again -> a second reset.
    reset.params.value = 0.0;
    proc.update(graph, { time: 0.048, computeExecutor: exec });
    reset.params.value = 1.0;
    proc.update(graph, { time: 0.064, computeExecutor: exec });
    expect(exec.calls).toEqual(['f', 'f']);
  });

  it('resolves a Trigger node wired into the reset pin', () => {
    const sig = constFloat('s', 0.1);
    const trigger = { id: 't', kind: 'Trigger', params: { threshold: 0.5 }, inputs: ['s'] };
    const fb = feedbackNode('f', 't');
    const graph = makeGraph([sig, trigger, fb]);
    const exec = makeExecutor();

    // Below threshold -> no pulse, no reset.
    proc.update(graph, { time: 0, computeExecutor: exec });
    expect(exec.calls).toEqual([]);

    // Signal crosses threshold -> trigger fires -> rising edge -> reset.
    sig.params.value = 0.9;
    proc.update(graph, { time: 0.016, computeExecutor: exec });
    expect(exec.calls).toEqual(['f']);
  });

  it('does not fire on a pin that is already high when first seen (seeds the level)', () => {
    const reset = constFloat('r', 1.0); // high from the very first frame (e.g. loaded that way)
    const fb = feedbackNode('f', 'r');
    const graph = makeGraph([reset, fb]);
    const exec = makeExecutor();

    proc.update(graph, { time: 0, computeExecutor: exec });
    expect(exec.calls).toEqual([]);
  });

  it('also drives the Feedback Field node', () => {
    const reset = constFloat('r', 0.0);
    const fb = feedbackNode('f', 'r', 'ComputeFeedbackField');
    const graph = makeGraph([reset, fb]);
    const exec = makeExecutor();

    proc.update(graph, { time: 0, computeExecutor: exec });
    reset.params.value = 1.0;
    proc.update(graph, { time: 0.016, computeExecutor: exec });
    expect(exec.calls).toEqual(['f']);
  });

  it('does nothing when the reset pin is unconnected', () => {
    const fb = { id: 'f', kind: 'ComputeFeedback', params: {}, inputs: ['tex'] }; // no pin-1 source
    const graph = makeGraph([fb]);
    const exec = makeExecutor();

    proc.update(graph, { time: 0, computeExecutor: exec });
    proc.update(graph, { time: 0.016, computeExecutor: exec });
    expect(exec.calls).toEqual([]);
  });

  it('prunes state for deleted feedback nodes', () => {
    const reset = constFloat('r', 0.0);
    const fb = feedbackNode('f', 'r');
    proc.update(makeGraph([reset, fb]), { time: 0, computeExecutor: makeExecutor() });
    expect(proc._state.has('f')).toBe(true);

    proc.update(makeGraph([reset]), { time: 0.016, computeExecutor: makeExecutor() });
    expect(proc._state.has('f')).toBe(false);
  });
});
