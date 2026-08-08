// The Trigger node's "On value change" mode.
//
// Threshold mode is stateless and compiles straight to WGSL; "On value change" has to compare this
// frame's input against the previous frame's, which a fragment shader can't do, so TriggerNodeProcessor
// runs the comparison on the CPU each frame and streams a 0/1 pulse in via the "<id>.pulse" uniform.

import { describe, it, expect, beforeEach } from 'vitest';
import { TriggerNodeProcessor } from '../src/core/TriggerNodeProcessor.js';
import { InputNodes } from '../src/codegen/compilers/InputNodes.js';
import { HoldNodeProcessor } from '../src/core/HoldNodeProcessor.js';
import { CountNodeProcessor } from '../src/core/CountNodeProcessor.js';
import { TRIGGER_MODE_CHANGE, TRIGGER_MODE_THRESHOLD } from '../src/core/triggerMode.js';

// Minimal stand-in for the editor graph: nodes + getNode by id.
function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

// A uniform manager whose buffer already has the pulse key registered (as the compiler would).
function makeUniformManager(triggerNodeIds = []) {
  const uniformValues = new Map();
  for (const id of triggerNodeIds) uniformValues.set(`${id}.pulse`, 0);
  return { uniformValues };
}

function constFloat(id, value) {
  return { id, kind: 'ConstFloat', params: { value }, inputs: [] };
}

function changeTrigger(params = {}) {
  return {
    id: 't', kind: 'Trigger',
    params: { mode: TRIGGER_MODE_CHANGE, threshold: 0.5, minChange: 0.0001, ...params },
    inputs: ['s'],
  };
}

describe('TriggerNodeProcessor (On value change)', () => {
  let proc;
  beforeEach(() => {
    proc = new TriggerNodeProcessor();
  });

  it('does not fire on the first update (it only seeds the reference value)', () => {
    const src = constFloat('s', 3.0);
    const trigger = changeTrigger();
    const graph = makeGraph([src, trigger]);
    const um = makeUniformManager(['t']);

    proc.update(graph, { time: 0, uniformManager: um });

    expect(trigger.__triggerPulse).toBe(0);
    expect(um.uniformValues.get('t.pulse')).toBe(0);
  });

  it('fires for exactly one frame when the input changes, then falls back to 0', () => {
    const src = constFloat('s', 3.0);
    const trigger = changeTrigger();
    const graph = makeGraph([src, trigger]);
    const um = makeUniformManager(['t']);

    proc.update(graph, { time: 0, uniformManager: um }); // seed
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(trigger.__triggerPulse).toBe(0); // steady input, no pulse

    src.params.value = 3.5;
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(trigger.__triggerPulse).toBe(1);
    expect(um.uniformValues.get('t.pulse')).toBe(1);

    // Input holds at its new value: the pulse is a one-frame event, not a level.
    proc.update(graph, { time: 0.048, uniformManager: um });
    expect(trigger.__triggerPulse).toBe(0);
    expect(um.uniformValues.get('t.pulse')).toBe(0);
  });

  it('fires on a DECREASE too — it is a change detector, not a level detector', () => {
    const src = constFloat('s', 5.0);
    const trigger = changeTrigger();
    const graph = makeGraph([src, trigger]);
    const um = makeUniformManager(['t']);

    proc.update(graph, { time: 0, uniformManager: um });
    src.params.value = 1.0;
    proc.update(graph, { time: 0.016, uniformManager: um });

    expect(trigger.__triggerPulse).toBe(1);
  });

  it('fires below the threshold, which a Threshold-mode trigger never would', () => {
    // Both values sit under the default 0.5 threshold, so threshold mode would stay at 0 throughout.
    const src = constFloat('s', 0.1);
    const trigger = changeTrigger();
    const graph = makeGraph([src, trigger]);
    const um = makeUniformManager(['t']);

    proc.update(graph, { time: 0, uniformManager: um });
    src.params.value = 0.2;
    proc.update(graph, { time: 0.016, uniformManager: um });

    expect(trigger.__triggerPulse).toBe(1);
  });

  it('ignores movement within minChange', () => {
    const src = constFloat('s', 1.0);
    const trigger = changeTrigger({ minChange: 0.25 });
    const graph = makeGraph([src, trigger]);
    const um = makeUniformManager(['t']);

    proc.update(graph, { time: 0, uniformManager: um });
    src.params.value = 1.1; // below the deadband
    proc.update(graph, { time: 0.016, uniformManager: um });
    expect(trigger.__triggerPulse).toBe(0);

    src.params.value = 1.4; // now 0.4 from the reference — over the deadband
    proc.update(graph, { time: 0.032, uniformManager: um });
    expect(trigger.__triggerPulse).toBe(1);
  });

  it('treats minChange as a deadband, so a slow drift still fires once it accumulates', () => {
    const src = constFloat('s', 0);
    const trigger = changeTrigger({ minChange: 0.25 });
    const graph = makeGraph([src, trigger]);
    const um = makeUniformManager(['t']);

    proc.update(graph, { time: 0, uniformManager: um }); // seed at 0

    // Creep up by 0.1 a frame: each STEP is under the deadband, but the total drift is not.
    const pulses = [];
    for (let i = 1; i <= 4; i++) {
      src.params.value = i * 0.1;
      proc.update(graph, { time: i * 0.016, uniformManager: um });
      pulses.push(trigger.__triggerPulse);
    }
    // 0.1, 0.2 stay inside the deadband; 0.3 crosses it and re-seeds; 0.4 is inside again.
    expect(pulses).toEqual([0, 0, 1, 0]);
  });

  it('leaves Threshold-mode triggers alone (no CPU state, no uniform write)', () => {
    const src = constFloat('s', 3.0);
    const trigger = changeTrigger({ mode: TRIGGER_MODE_THRESHOLD });
    const graph = makeGraph([src, trigger]);
    const um = makeUniformManager(['t']);

    proc.update(graph, { time: 0, uniformManager: um });
    src.params.value = 4.0;
    proc.update(graph, { time: 0.016, uniformManager: um });

    expect(trigger.__triggerPulse).toBeUndefined();
    expect(um.uniformValues.get('t.pulse')).toBe(0);
  });

  it('drops state for deleted trigger nodes so it does not leak across edits', () => {
    const src = constFloat('s', 1.0);
    const a = { ...changeTrigger(), id: 'a' };
    const b = { ...changeTrigger(), id: 'b' };
    const graph = makeGraph([src, a, b]);
    proc.update(graph, { time: 0, uniformManager: makeUniformManager(['a', 'b']) });
    expect(proc._state.size).toBe(2);

    proc.update(makeGraph([src, a]), { time: 0.016, uniformManager: makeUniformManager(['a']) });
    expect(proc._state.size).toBe(1);
    expect(proc._state.has('b')).toBe(false);
  });
});

describe('Trigger node codegen', () => {
  const compiler = new InputNodes();

  it('reads the pulse uniform that getParam registers in "On value change" mode', () => {
    const node = { id: '5', kind: 'Trigger', params: { mode: TRIGGER_MODE_CHANGE } };
    const getParam = (name) => (name === 'pulse' ? 'u_params._5_pulse' : '0.0');
    const result = compiler.compile(node, () => 'in_value', getParam);
    expect(result.line).toBe('let node_5 = u_params._5_pulse;');
    expect(result.outputType).toBe('f32');
  });

  it('emits 0 in change mode when no uniform manager is available', () => {
    const node = { id: '6', kind: 'Trigger', params: { mode: TRIGGER_MODE_CHANGE } };
    const result = compiler.compile(node, () => 'in_value', null);
    expect(result.line).toBe('let node_6 = 0.0;');
  });

  it('still compiles the stateless comparison in Threshold mode', () => {
    const node = { id: '7', kind: 'Trigger', params: { threshold: 0.5 } };
    const result = compiler.compile(node, () => 'in_value', null);
    expect(result.line).toBe('let node_7 = select(0.0, 1.0, in_value >= 0.500000);');
  });

  it('defaults to Threshold mode for graphs saved before the mode param existed', () => {
    const node = { id: '8', kind: 'Trigger', params: {} };
    const result = compiler.compile(node, () => 'in_value', null);
    expect(result.line).toBe('let node_8 = select(0.0, 1.0, in_value >= 0.5);');
  });
});

describe('downstream consumers read the change-mode pulse', () => {
  it('a Hold latches on a change-mode Trigger pulse', () => {
    const value = constFloat('v', 7.0);
    const src = constFloat('s', 1.0);
    const trigger = changeTrigger();
    const hold = { id: 'h', kind: 'Hold', params: { mode: 'Continuous', threshold: 0.5 }, inputs: ['v', 't'] };
    const graph = makeGraph([value, src, trigger, hold]);

    const triggerProc = new TriggerNodeProcessor();
    const holdProc = new HoldNodeProcessor();
    const um = { uniformValues: new Map([['t.pulse', 0], ['h.hold', 0]]) };

    triggerProc.update(graph, { time: 0, uniformManager: um });
    holdProc.update(graph, { time: 0, uniformManager: um });
    expect(hold.__holdValue).toBe(0); // no change yet, nothing latched

    src.params.value = 2.0;
    triggerProc.update(graph, { time: 0.016, uniformManager: um });
    holdProc.update(graph, { time: 0.016, uniformManager: um });
    expect(hold.__holdValue).toBe(7.0);
  });

  it('a Count advances once per change-mode Trigger pulse', () => {
    const src = constFloat('s', 1.0);
    const trigger = changeTrigger();
    const count = {
      id: 'c', kind: 'Count',
      params: { step: 1.0, threshold: 0.5, loop: false, min: 0, max: 10 },
      inputs: ['t'],
    };
    const graph = makeGraph([src, trigger, count]);

    const triggerProc = new TriggerNodeProcessor();
    const countProc = new CountNodeProcessor();
    const um = { uniformValues: new Map([['t.pulse', 0], ['c.count', 0]]) };

    const step = (t) => {
      triggerProc.update(graph, { time: t, uniformManager: um });
      countProc.update(graph, { time: t, uniformManager: um });
    };

    step(0);
    expect(count.__countValue).toBe(0);

    src.params.value = 2.0;
    step(0.016);
    expect(count.__countValue).toBe(1);

    // Input steady: the pulse falls back to 0, so the count holds.
    step(0.032);
    expect(count.__countValue).toBe(1);

    src.params.value = 3.0;
    step(0.048);
    expect(count.__countValue).toBe(2);
  });
});
