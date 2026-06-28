import { describe, it, expect, beforeEach } from 'vitest';
import { HoldNodeProcessor } from '../src/core/HoldNodeProcessor.js';

// Minimal stand-in for the editor graph: nodes + getNode by id.
function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

// A uniform manager whose buffer already has the hold key registered (as the compiler would).
function makeUniformManager(holdNodeIds = []) {
  const uniformValues = new Map();
  for (const id of holdNodeIds) uniformValues.set(`${id}.hold`, 0);
  return { uniformValues };
}

function constFloat(id, value) {
  return { id, kind: 'ConstFloat', params: { value }, inputs: [] };
}

describe('HoldNodeProcessor', () => {
  let proc;
  beforeEach(() => {
    proc = new HoldNodeProcessor();
  });

  it('continuous mode tracks the value while the pulse is high and holds it when low', () => {
    const value = constFloat('v', 0.7);
    const pulse = constFloat('p', 1.0); // high
    const hold = {
      id: 'h', kind: 'Hold',
      params: { mode: 'Continuous', threshold: 0.5 },
      inputs: ['v', 'p'],
    };
    const graph = makeGraph([value, pulse, hold]);
    const um = makeUniformManager(['h']);

    proc.update(graph, { time: 0, uniformManager: um });
    expect(um.uniformValues.get('h.hold')).toBeCloseTo(0.7);

    // Value changes while pulse stays high -> tracked.
    value.params.value = 0.2;
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('h.hold')).toBeCloseTo(0.2);

    // Pulse drops to 0 and value changes -> the held value must NOT drop to 0; it stays latched.
    pulse.params.value = 0.0;
    value.params.value = 0.9;
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('h.hold')).toBeCloseTo(0.2);
  });

  it('once-per-trigger mode samples only on the rising edge and holds between triggers', () => {
    const value = constFloat('v', 0.3);
    const pulse = constFloat('p', 0.0); // low
    const hold = {
      id: 'h', kind: 'Hold',
      params: { mode: 'Once per trigger', threshold: 0.5 },
      inputs: ['v', 'p'],
    };
    const graph = makeGraph([value, pulse, hold]);
    const um = makeUniformManager(['h']);

    // Low -> nothing sampled yet.
    proc.update(graph, { time: 0, uniformManager: um });
    expect(um.uniformValues.get('h.hold')).toBe(0);

    // Rising edge -> sample 0.3.
    pulse.params.value = 1.0;
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('h.hold')).toBeCloseTo(0.3);

    // Still high, value changes -> NOT re-sampled (only once per trigger).
    value.params.value = 0.8;
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('h.hold')).toBeCloseTo(0.3);

    // Pulse falls -> held.
    pulse.params.value = 0.0;
    proc.update(graph, { time: 0.048, uniformManager: um });
    expect(um.uniformValues.get('h.hold')).toBeCloseTo(0.3);

    // Next rising edge -> sample the new value 0.8.
    pulse.params.value = 1.0;
    proc.update(graph, { time: 0.064, uniformManager: um });
    expect(um.uniformValues.get('h.hold')).toBeCloseTo(0.8);
  });

  it('mirrors the held value onto node.__holdValue for the CPU preview', () => {
    const value = constFloat('v', 0.5);
    const pulse = constFloat('p', 1.0);
    const hold = {
      id: 'h', kind: 'Hold',
      params: { mode: 'Continuous', threshold: 0.5 },
      inputs: ['v', 'p'],
    };
    const graph = makeGraph([value, pulse, hold]);
    proc.update(graph, { time: 0, uniformManager: makeUniformManager(['h']) });
    expect(hold.__holdValue).toBeCloseTo(0.5);
  });

  it('resolves a Trigger node feeding the pulse input', () => {
    const value = constFloat('v', 0.42);
    const sig = constFloat('s', 0.8);
    const trigger = { id: 't', kind: 'Trigger', params: { threshold: 0.5 }, inputs: ['s'] };
    const hold = {
      id: 'h', kind: 'Hold',
      params: { mode: 'Continuous', threshold: 0.5 },
      inputs: ['v', 't'],
    };
    const graph = makeGraph([value, sig, trigger, hold]);
    const um = makeUniformManager(['h']);

    // signal 0.8 >= 0.5 -> trigger fires -> hold latches value.
    proc.update(graph, { time: 0, uniformManager: um });
    expect(um.uniformValues.get('h.hold')).toBeCloseTo(0.42);

    // signal drops below threshold -> trigger off -> value held, not zeroed.
    sig.params.value = 0.1;
    value.params.value = 0.99;
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('h.hold')).toBeCloseTo(0.42);
  });

  it('prunes state for deleted hold nodes', () => {
    const value = constFloat('v', 0.5);
    const pulse = constFloat('p', 1.0);
    const hold = { id: 'h', kind: 'Hold', params: {}, inputs: ['v', 'p'] };
    proc.update(makeGraph([value, pulse, hold]), { time: 0, uniformManager: makeUniformManager(['h']) });
    expect(proc._state.has('h')).toBe(true);

    // Hold node removed from the graph.
    proc.update(makeGraph([value, pulse]), { time: 0.016, uniformManager: makeUniformManager([]) });
    expect(proc._state.has('h')).toBe(false);
  });
});
