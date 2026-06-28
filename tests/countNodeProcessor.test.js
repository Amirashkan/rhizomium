import { describe, it, expect, beforeEach } from 'vitest';
import { CountNodeProcessor } from '../src/core/CountNodeProcessor.js';

// Minimal stand-in for the editor graph: nodes + getNode by id.
function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

// A uniform manager whose buffer already has the count key registered (as the compiler would).
function makeUniformManager(countNodeIds = []) {
  const uniformValues = new Map();
  for (const id of countNodeIds) uniformValues.set(`${id}.count`, 0);
  return { uniformValues };
}

function constFloat(id, value) {
  return { id, kind: 'ConstFloat', params: { value }, inputs: [] };
}

function countNode(params = {}) {
  return {
    id: 'c', kind: 'Count',
    params: { step: 1.0, threshold: 0.5, loop: false, min: 0, max: 10, ...params },
    inputs: ['p'],
  };
}

describe('CountNodeProcessor', () => {
  let proc;
  beforeEach(() => {
    proc = new CountNodeProcessor();
  });

  it('increments by step once per rising edge, not every frame the pulse is high', () => {
    const pulse = constFloat('p', 0.0);
    const count = countNode();
    const graph = makeGraph([pulse, count]);
    const um = makeUniformManager(['c']);

    // Low -> no count.
    proc.update(graph, { time: 0, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBe(0);

    // Rising edge -> +1.
    pulse.params.value = 1.0;
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(1);

    // Still high -> no further increment.
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(1);

    // Falls then rises again -> +1.
    pulse.params.value = 0.0;
    proc.update(graph, { time: 0.048, uniformManager: um });
    pulse.params.value = 1.0;
    proc.update(graph, { time: 0.064, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(2);
  });

  it('honours a custom step', () => {
    const pulse = constFloat('p', 1.0);
    const count = countNode({ step: 5 });
    const graph = makeGraph([pulse, count]);
    const um = makeUniformManager(['c']);

    proc.update(graph, { time: 0, uniformManager: um }); // rising edge from initial low
    expect(um.uniformValues.get('c.count')).toBeCloseTo(5);
  });

  it('wraps within [min, max] when looping is enabled', () => {
    const pulse = constFloat('p', 0.0);
    const count = countNode({ loop: true, min: 0, max: 3, step: 1 });
    const graph = makeGraph([pulse, count]);
    const um = makeUniformManager(['c']);

    // Starts at min.
    proc.update(graph, { time: 0, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(0);

    const pulseOnce = (t) => {
      pulse.params.value = 1.0;
      proc.update(graph, { time: t, uniformManager: um });
      pulse.params.value = 0.0;
      proc.update(graph, { time: t + 0.008, uniformManager: um });
    };

    pulseOnce(0.1); // 1
    expect(um.uniformValues.get('c.count')).toBeCloseTo(1);
    pulseOnce(0.2); // 2
    pulseOnce(0.3); // 3 -> wraps to 0
    expect(um.uniformValues.get('c.count')).toBeCloseTo(0);
    pulseOnce(0.4); // 1
    expect(um.uniformValues.get('c.count')).toBeCloseTo(1);
  });

  it('mirrors the count onto node.__countValue for the CPU preview', () => {
    const pulse = constFloat('p', 1.0);
    const count = countNode();
    const graph = makeGraph([pulse, count]);
    proc.update(graph, { time: 0, uniformManager: makeUniformManager(['c']) });
    expect(count.__countValue).toBeCloseTo(1);
  });

  it('resolves a Trigger node feeding the pulse input', () => {
    const sig = constFloat('s', 0.8);
    const trigger = { id: 't', kind: 'Trigger', params: { threshold: 0.5 }, inputs: ['s'] };
    const count = { ...countNode(), inputs: ['t'] };
    const graph = makeGraph([sig, trigger, count]);
    const um = makeUniformManager(['c']);

    // signal 0.8 >= 0.5 -> trigger fires -> rising edge -> +1.
    proc.update(graph, { time: 0, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(1);

    // signal drops -> trigger off, then back up -> another edge -> +1.
    sig.params.value = 0.1;
    proc.update(graph, { time: 0.016, uniformManager: um });
    sig.params.value = 0.9;
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(2);
  });

  it('prunes state for deleted count nodes', () => {
    const pulse = constFloat('p', 1.0);
    const count = countNode();
    proc.update(makeGraph([pulse, count]), { time: 0, uniformManager: makeUniformManager(['c']) });
    expect(proc._state.has('c')).toBe(true);

    proc.update(makeGraph([pulse]), { time: 0.016, uniformManager: makeUniformManager([]) });
    expect(proc._state.has('c')).toBe(false);
  });
});
