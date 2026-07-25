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

  it('counts an Audio Analysis output wired into the pulse input (selects the connected pin)', () => {
    // Audio Analysis exposes many pins; see core/audioAnalysisPins.js for the order. Here:
    // level (pin 0), kick (pin 4), kickTrig (pin 5). AudioAnalysisProcessor stashes their live
    // values on the node as __audio_<pin> each frame.
    const audio = { id: 'a', kind: 'AudioAnalysis', params: {}, inputs: [],
      __audio_level: 0, __audio_kick: 0, __audio_kickTrig: 0 };
    const count = { ...countNode(), inputs: ['a'] };
    // Wire the `kickTrig` output (pin 5) into the count's pulse pin (pin 0).
    const graph = {
      nodes: [audio, count],
      getNode: (id) => (id === 'a' ? audio : id === 'c' ? count : undefined),
      connections: [{ from: { nodeId: 'a', pin: 5 }, to: { nodeId: 'c', pin: 0 } }],
    };
    const um = makeUniformManager(['c']);

    // No hit yet -> trig 0 -> no count.
    proc.update(graph, { time: 0, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBe(0);

    // A detected hit sets trig to 1 for a single frame -> rising edge -> +1.
    audio.__audio_kickTrig = 1;
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(1);

    // Trig falls back to 0 (single-frame pulse), then a second hit -> +1.
    audio.__audio_kickTrig = 0;
    proc.update(graph, { time: 0.032, uniformManager: um });
    audio.__audio_kickTrig = 1;
    proc.update(graph, { time: 0.048, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(2);
  });

  it('reads the kick envelope (pin 4) when that output is the one wired', () => {
    const audio = { id: 'a', kind: 'AudioAnalysis', params: {}, inputs: [],
      __audio_level: 0.2, __audio_kick: 0, __audio_kickTrig: 0 };
    const count = { ...countNode(), inputs: ['a'] };
    const graph = {
      nodes: [audio, count],
      getNode: (id) => (id === 'a' ? audio : id === 'c' ? count : undefined),
      connections: [{ from: { nodeId: 'a', pin: 4 }, to: { nodeId: 'c', pin: 0 } }],
    };
    const um = makeUniformManager(['c']);

    // level (pin 0) is above threshold but kick (pin 4) is the wired output and is still low.
    proc.update(graph, { time: 0, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBe(0);

    // kick envelope snaps up on a hit -> crosses threshold -> +1.
    audio.__audio_kick = 1;
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(1);
  });

  it('resets the counter to 0 on requestReset (non-looping)', () => {
    const pulse = constFloat('p', 0.0);
    const count = countNode();
    const graph = makeGraph([pulse, count]);
    const um = makeUniformManager(['c']);

    // Advance to 2.
    const pulseOnce = (t) => {
      pulse.params.value = 1.0;
      proc.update(graph, { time: t, uniformManager: um });
      pulse.params.value = 0.0;
      proc.update(graph, { time: t + 0.008, uniformManager: um });
    };
    pulseOnce(0.1);
    pulseOnce(0.2);
    expect(um.uniformValues.get('c.count')).toBeCloseTo(2);

    // Reset takes effect on the next update.
    proc.requestReset('c');
    proc.update(graph, { time: 0.3, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(0);
    expect(count.__countValue).toBeCloseTo(0);
  });

  it('resets to min when looping is enabled', () => {
    const pulse = constFloat('p', 0.0);
    const count = countNode({ loop: true, min: 5, max: 10, step: 1 });
    const graph = makeGraph([pulse, count]);
    const um = makeUniformManager(['c']);

    proc.update(graph, { time: 0, uniformManager: um });
    pulse.params.value = 1.0;
    proc.update(graph, { time: 0.1, uniformManager: um }); // -> 6
    expect(um.uniformValues.get('c.count')).toBeCloseTo(6);

    proc.requestReset('c');
    proc.update(graph, { time: 0.2, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(5);
  });

  it('does not immediately re-increment after a reset while the pulse is held high', () => {
    const pulse = constFloat('p', 1.0); // held high the whole time
    const count = countNode();
    const graph = makeGraph([pulse, count]);
    const um = makeUniformManager(['c']);

    proc.update(graph, { time: 0, uniformManager: um }); // rising edge from initial low -> 1
    expect(um.uniformValues.get('c.count')).toBeCloseTo(1);

    // Reset with the pulse still high: should land on 0 and stay (no phantom rising edge).
    proc.requestReset('c');
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(0);
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(um.uniformValues.get('c.count')).toBeCloseTo(0);
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
