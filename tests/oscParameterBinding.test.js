// Tests for OSCParameterBinding — mapping OSC messages onto node parameters.
//
// OSC has no equivalent of MIDI's fixed 0-127, so the input range is per
// binding; most of what follows is about that mapping being right, plus the
// shared write path not moving nodes around the canvas.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OSCParameterBinding } from '../src/osc/OSCParameterBinding.js';

function makeEventSystem() {
  const handlers = new Map();
  const seen = [];
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    emit(type, data) {
      seen.push({ type, data });
      (handlers.get(type) || []).forEach((fn) => fn(data));
    },
    of(type) {
      return seen.filter((e) => e.type === type).map((e) => e.data);
    },
  };
}

let graph;
let events;
let binding;
let node;

beforeEach(() => {
  node = { id: 'n1', kind: 'CircleField', params: { radius: 0 }, x: 100, y: 200 };
  graph = { nodes: [node], connections: [] };
  events = makeEventSystem();
  binding = new OSCParameterBinding(graph, events, null);
});

afterEach(() => {
  delete window.editor;
  delete window.nodeCompiler;
  delete window.gpuRenderer;
});

/** Deliver a message the way OSCManager would. */
function send(address, args) {
  events.emit('OSC_MESSAGE', { address, args, types: '', value: args[0] });
}

describe('binding creation', () => {
  it('binds an address to a parameter and drives it', () => {
    binding.createBinding('/1/fader1', 0, 'n1', 'radius', { min: 0, max: 10 });

    send('/1/fader1', [0.5]);

    expect(node.params.radius).toBe(5);
  });

  it('refuses to bind a node that is not in the graph', () => {
    expect(binding.createBinding('/x', 0, 'missing', 'radius')).toBe(false);
    expect(binding.getAllBindings()).toHaveLength(0);
  });

  it('defaults to the 0-1 range OSC senders normally use', () => {
    binding.createBinding('/a', 0, 'n1', 'radius');
    const created = binding.getBinding('/a', 0);

    expect(created.inputMin).toBe(0);
    expect(created.inputMax).toBe(1);
  });

  it('replaces an earlier binding on the same parameter', () => {
    binding.createBinding('/old', 0, 'n1', 'radius', { min: 0, max: 10 });
    binding.createBinding('/new', 0, 'n1', 'radius', { min: 0, max: 10 });

    expect(binding.getAllBindings()).toHaveLength(1);

    send('/old', [1]);
    expect(node.params.radius).toBe(0);

    send('/new', [1]);
    expect(node.params.radius).toBe(10);
  });

  it('announces creation and removal', () => {
    binding.createBinding('/a', 0, 'n1', 'radius');
    binding.removeBinding('/a', 0);

    expect(events.of('OSC_BINDING_CREATED')).toHaveLength(1);
    expect(events.of('OSC_BINDING_REMOVED')).toHaveLength(1);
  });
});

describe('value mapping', () => {
  it('normalises against a declared input range', () => {
    // A sender emitting 0-127 rather than 0-1.
    binding.createBinding('/cc', 0, 'n1', 'radius', {
      inputMin: 0,
      inputMax: 127,
      min: 0,
      max: 1,
    });

    send('/cc', [127]);
    expect(node.params.radius).toBe(1);

    send('/cc', [63.5]);
    expect(node.params.radius).toBe(0.5);
  });

  it('clamps readings outside the declared input range', () => {
    binding.createBinding('/a', 0, 'n1', 'radius', { min: 0, max: 10 });

    send('/a', [5]);
    expect(node.params.radius).toBe(10);

    send('/a', [-5]);
    expect(node.params.radius).toBe(0);
  });

  it('maps onto a parameter range that does not start at zero', () => {
    binding.createBinding('/a', 0, 'n1', 'radius', { min: -1, max: 1 });

    send('/a', [0.5]);
    expect(node.params.radius).toBe(0);
  });

  it('inverts when asked', () => {
    binding.createBinding('/a', 0, 'n1', 'radius', { min: 0, max: 10, inverted: true });

    send('/a', [0.25]);
    expect(node.params.radius).toBe(7.5);
  });

  it('applies the exponential and logarithmic curves', () => {
    binding.createBinding('/exp', 0, 'n1', 'radius', { min: 0, max: 1, curve: 'exponential' });
    send('/exp', [0.5]);
    expect(node.params.radius).toBe(0.25);

    binding.createBinding('/log', 0, 'n1', 'radius', { min: 0, max: 1, curve: 'logarithmic' });
    send('/log', [0.25]);
    expect(node.params.radius).toBe(0.5);
  });

  it('treats a toggle or bang as full scale', () => {
    binding.createBinding('/toggle', 0, 'n1', 'radius', { min: 0, max: 4 });

    send('/toggle', [true]);
    expect(node.params.radius).toBe(4);

    send('/toggle', [false]);
    expect(node.params.radius).toBe(0);
  });

  it('ignores a disabled binding', () => {
    binding.createBinding('/a', 0, 'n1', 'radius', { min: 0, max: 10 });
    binding.setBindingEnabled('/a', 0, false);

    send('/a', [1]);
    expect(node.params.radius).toBe(0);
  });
});

describe('per-argument bindings', () => {
  it('drives two parameters from one message', () => {
    // '/xy 0.3 0.7' is the normal shape for a pad, not an edge case.
    node.params.cx = 0;
    node.params.cy = 0;
    binding.createBinding('/xy', 0, 'n1', 'cx', { min: 0, max: 1 });
    binding.createBinding('/xy', 1, 'n1', 'cy', { min: 0, max: 1 });

    send('/xy', [0.3, 0.7]);

    expect(node.params.cx).toBeCloseTo(0.3, 6);
    expect(node.params.cy).toBeCloseTo(0.7, 6);
  });

  it('keeps bindings on the same address independent', () => {
    node.params.cy = 0;
    binding.createBinding('/xy', 1, 'n1', 'cy', { min: 0, max: 1 });

    send('/xy', [0.3, 0.7]);

    expect(node.params.radius).toBe(0);
    expect(node.params.cy).toBeCloseTo(0.7, 6);
  });
});

describe('one channel driving several parameters', () => {
  it('fans one address out to several parameters', () => {
    // One LFO opening a radius while it tilts a rotation — ordinary in a live
    // set, and previously the second mapping replaced the first.
    node.params.rotation = 0;
    binding.createBinding('/lfo', 0, 'n1', 'radius', { min: 0, max: 10 });
    binding.createBinding('/lfo', 0, 'n1', 'rotation', { min: 0, max: 360 });

    send('/lfo', [0.5]);

    expect(node.params.radius).toBe(5);
    expect(node.params.rotation).toBe(180);
    expect(binding.getAllBindings()).toHaveLength(2);
  });

  it('fans out across different nodes', () => {
    const other = { id: 'n2', kind: 'CircleField', params: { radius: 0 }, x: 0, y: 0 };
    graph.nodes.push(other);

    binding.createBinding('/lfo', 0, 'n1', 'radius', { min: 0, max: 1 });
    binding.createBinding('/lfo', 0, 'n2', 'radius', { min: 0, max: 100 });

    send('/lfo', [1]);

    expect(node.params.radius).toBe(1);
    expect(other.params.radius).toBe(100);
  });

  it('removes one target without disturbing its siblings', () => {
    node.params.rotation = 0;
    binding.createBinding('/lfo', 0, 'n1', 'radius', { min: 0, max: 10 });
    binding.createBinding('/lfo', 0, 'n1', 'rotation', { min: 0, max: 360 });

    binding.removeBindingForParameter('n1', 'radius');
    send('/lfo', [1]);

    expect(node.params.radius).toBe(0);
    expect(node.params.rotation).toBe(360);
    expect(binding.shouldUseUniform('n1', 'radius')).toBe(false);
    expect(binding.shouldUseUniform('n1', 'rotation')).toBe(true);
  });

  it('edits one range without moving its siblings', () => {
    node.params.rotation = 0;
    binding.createBinding('/lfo', 0, 'n1', 'radius', { min: 0, max: 10 });
    binding.createBinding('/lfo', 0, 'n1', 'rotation', { min: 0, max: 360 });

    binding.updateBindingForParameter('n1', 'radius', { max: 2 });
    send('/lfo', [1]);

    expect(node.params.radius).toBe(2);
    expect(node.params.rotation).toBe(360);
  });

  it('keeps each target separate through a save/load round trip', () => {
    node.params.rotation = 0;
    binding.createBinding('/lfo', 0, 'n1', 'radius', { min: 0, max: 10 });
    binding.createBinding('/lfo', 0, 'n1', 'rotation', { min: 0, max: 360 });

    const events2 = makeEventSystem();
    const restored = new OSCParameterBinding(graph, events2, null);
    restored.deserialize(JSON.parse(JSON.stringify(binding.serialize())));

    expect(restored.getAllBindings()).toHaveLength(2);
    events2.emit('OSC_MESSAGE', { address: '/lfo', args: [0.5], types: '' });
    expect(node.params.radius).toBe(5);
    expect(node.params.rotation).toBe(180);
  });

  it('drops a whole node without orphaning a shared address', () => {
    const other = { id: 'n2', kind: 'CircleField', params: { radius: 0 }, x: 0, y: 0 };
    graph.nodes.push(other);
    binding.createBinding('/lfo', 0, 'n1', 'radius', { min: 0, max: 1 });
    binding.createBinding('/lfo', 0, 'n2', 'radius', { min: 0, max: 1 });

    binding.cleanupNodeBindings('n1');

    expect(binding.getAllBindings()).toHaveLength(1);
    send('/lfo', [1]);
    expect(other.params.radius).toBe(1);
  });
});

describe('OSC learn', () => {
  it('binds the next message that arrives', () => {
    binding.startLearning('n1', 'radius');
    send('/learned/fader', [0.5]);

    const created = binding.getBinding('/learned/fader', 0);
    expect(created).toMatchObject({ nodeId: 'n1', paramName: 'radius' });
    expect(binding.learningMode).toBe(false);
  });

  it('skips a leading label and learns the first numeric argument', () => {
    binding.startLearning('n1', 'radius');
    send('/labelled', ['name', 0.5]);

    expect(binding.getBinding('/labelled', 1)).toBeTruthy();
    expect(binding.getBinding('/labelled', 0)).toBeUndefined();
  });

  it('widens the input range when the sender is clearly not using 0-1', () => {
    binding.startLearning('n1', 'radius');
    send('/degrees', [270]);

    expect(binding.getBinding('/degrees', 0).inputMax).toBe(270);
  });

  it('ignores channels that are merely streaming, and takes the one that moves', () => {
    // A modular rack sends every channel continuously. Binding whatever
    // arrives next would map an essentially random channel, microseconds after
    // arming, with nothing to do with what the artist touched.
    const manager = {
      getAddresses: () => [
        { address: '/vcv/ch0', args: [0.20] },
        { address: '/vcv/ch1', args: [0.50] },
        { address: '/vcv/ch2', args: [0.80] },
      ],
    };
    const withRack = new OSCParameterBinding(graph, events, manager);

    withRack.startLearning('n1', 'radius');

    // Idle traffic: same values as when learn was armed.
    send('/vcv/ch0', [0.20]);
    send('/vcv/ch2', [0.80]);
    expect(withRack.getAllBindings()).toHaveLength(0);
    expect(withRack.learningMode).toBe(true);

    // The artist turns ch1.
    send('/vcv/ch1', [0.65]);

    expect(withRack.getBinding('/vcv/ch1', 0)).toMatchObject({ paramName: 'radius' });
    expect(withRack.getAllBindings()).toHaveLength(1);
  });

  it('tolerates the jitter of a streaming channel', () => {
    const manager = { getAddresses: () => [{ address: '/noisy', args: [0.5] }] };
    const withRack = new OSCParameterBinding(graph, events, manager);
    withRack.startLearning('n1', 'radius');

    send('/noisy', [0.5005]);           // noise, not a gesture
    expect(withRack.getAllBindings()).toHaveLength(0);

    send('/noisy', [0.7]);              // an actual move
    expect(withRack.getAllBindings()).toHaveLength(1);
  });

  it('scales the movement threshold to the range the channel sends', () => {
    // A 0-127 source moving by 1 is noise; the same delta on a 0-1 fader is a
    // real gesture.
    const manager = { getAddresses: () => [{ address: '/cc', args: [64] }] };
    const withRack = new OSCParameterBinding(graph, events, manager);
    withRack.startLearning('n1', 'radius');

    send('/cc', [64.5]);
    expect(withRack.getAllBindings()).toHaveLength(0);

    send('/cc', [90]);
    expect(withRack.getAllBindings()).toHaveLength(1);
  });

  it('keeps driving existing bindings while learn waits for a move', () => {
    const manager = { getAddresses: () => [{ address: '/vcv/ch0', args: [0.2] }] };
    const withRack = new OSCParameterBinding(graph, events, manager);
    withRack.createBinding('/vcv/ch0', 0, 'n1', 'radius', { min: 0, max: 10 });
    withRack.startLearning('n1', 'radius');

    send('/vcv/ch0', [0.2]);            // idle repeat

    expect(node.params.radius).toBe(2);
  });

  it('still binds the first message from a sender that stays quiet until touched', () => {
    // TouchOSC and friends send nothing until a control moves, so there is no
    // baseline to compare against and the first message is the gesture.
    const manager = { getAddresses: () => [] };
    const quiet = new OSCParameterBinding(graph, events, manager);
    quiet.startLearning('n1', 'radius');

    send('/touch/fader', [0.4]);

    expect(quiet.getBinding('/touch/fader', 0)).toBeTruthy();
  });

  it('stays armed between channels in continuous mode', () => {
    node.params.rotation = 0;
    binding.setContinuousLearn(true);

    binding.startLearning('n1', 'radius');
    send('/ch1', [0.5]);
    expect(binding.getBinding('/ch1', 0)).toBeTruthy();
    expect(binding.learningMode).toBe(true);

    // Next parameter, no re-arming.
    binding.retargetLearning('n1', 'rotation');
    send('/ch2', [0.5]);
    expect(binding.getBinding('/ch2', 0)).toBeTruthy();
    expect(binding.getAllBindings()).toHaveLength(2);
  });

  it('does not steal a channel while waiting for the next target', () => {
    // Between two maps there is no target. A channel arriving then must drive
    // the binding it already has rather than be swallowed by the armed learn —
    // with a rack running, other channels keep arriving throughout mapping.
    node.params.rotation = 0;
    binding.setContinuousLearn(true);
    binding.createBinding('/already', 0, 'n1', 'radius', { min: 0, max: 10 });

    binding.startLearning('n1', 'rotation');
    send('/ch1', [0.5]);          // maps ch1 -> rotation, now awaiting a target

    send('/already', [1]);        // must drive radius, not rebind it
    expect(node.params.radius).toBe(10);
    expect(binding.getBindingForParameter('n1', 'radius').address).toBe('/already');
    expect(binding.getAllBindings()).toHaveLength(2);
  });

  it('disarms after one map when continuous is off', () => {
    binding.startLearning('n1', 'radius');
    send('/ch1', [0.5]);

    expect(binding.learningMode).toBe(false);
  });

  it('can be cancelled without binding anything', () => {
    binding.startLearning('n1', 'radius');
    binding.cancelLearning();
    send('/late', [0.5]);

    expect(binding.getAllBindings()).toHaveLength(0);
    expect(events.of('OSC_LEARN_CANCELLED')).toHaveLength(1);
  });

  it('runs the callback and announces completion', () => {
    const callback = vi.fn();
    binding.startLearning('n1', 'radius', callback);
    send('/cb', [0.5]);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ address: '/cb', nodeId: 'n1', paramName: 'radius' }),
    );
    expect(events.of('OSC_LEARN_COMPLETED')).toHaveLength(1);
  });
});

describe('uniforms and persistence', () => {
  it('marks a bound parameter as needing a GPU uniform', () => {
    binding.createBinding('/a', 0, 'n1', 'radius');

    expect(binding.shouldUseUniform('n1', 'radius')).toBe(true);
    expect(binding.shouldUseUniform('n1', 'other')).toBe(false);
  });

  it('stops needing a uniform once unbound', () => {
    binding.createBinding('/a', 0, 'n1', 'radius');
    binding.removeBinding('/a', 0);

    expect(binding.shouldUseUniform('n1', 'radius')).toBe(false);
  });

  it('writes the new value into the uniform buffer instead of recompiling', () => {
    const uniformValues = new Map();
    window.nodeCompiler = { uniformManager: { uniformValues } };
    window.gpuRenderer = { _updateParameterUniforms: vi.fn(), render: vi.fn() };

    binding.createBinding('/a', 0, 'n1', 'radius', { min: 0, max: 10 });
    send('/a', [0.5]);

    expect(uniformValues.get('n1.radius')).toBe(5);
    expect(window.gpuRenderer._updateParameterUniforms).toHaveBeenCalled();
  });

  it('survives a save/load round trip', () => {
    binding.createBinding('/a', 1, 'n1', 'radius', {
      min: 2,
      max: 8,
      inputMax: 127,
      curve: 'exponential',
      inverted: true,
    });

    const restored = new OSCParameterBinding(graph, makeEventSystem(), null);
    restored.deserialize(JSON.parse(JSON.stringify(binding.serialize())));

    expect(restored.getBinding('/a', 1)).toMatchObject({
      nodeId: 'n1',
      paramName: 'radius',
      min: 2,
      max: 8,
      inputMax: 127,
      curve: 'exponential',
      inverted: true,
    });
    expect(restored.shouldUseUniform('n1', 'radius')).toBe(true);
  });

  it('reads a saved binding that predates per-argument indices', () => {
    const restored = new OSCParameterBinding(graph, makeEventSystem(), null);
    restored.deserialize({
      bindings: [{ address: '/legacy', nodeId: 'n1', paramName: 'radius', min: 0, max: 1 }],
    });

    expect(restored.getBinding('/legacy', 0)).toBeTruthy();
  });

  it('drops bindings for a deleted node', () => {
    binding.createBinding('/a', 0, 'n1', 'radius');
    binding.cleanupNodeBindings('n1');

    expect(binding.getAllBindings()).toHaveLength(0);
  });
});

describe('the shared write path', () => {
  it('never writes a vector component onto the node position', () => {
    // node.x/node.y are canvas coordinates. Writing a ConstVec's 'x' component
    // there would drag the node across the graph every time the control moved.
    const vec = { id: 'v1', kind: 'ConstVec2', params: { x: 0, y: 0 }, x: 100, y: 200 };
    graph.nodes.push(vec);

    binding.createBinding('/pos', 0, 'v1', 'x', { min: 0, max: 1 });
    send('/pos', [1]);

    expect(vec.params.x).toBe(1);
    expect(vec.x).toBe(100);
    expect(vec.y).toBe(200);
  });

  it("keeps 'value' on its legacy top-level field", () => {
    const constant = { id: 'c1', kind: 'ConstFloat', params: { value: 0 }, value: 0 };
    graph.nodes.push(constant);

    binding.createBinding('/v', 0, 'c1', 'value', { min: 0, max: 3 });
    send('/v', [1]);

    expect(constant.value).toBe(3);
    expect(constant.params.value).toBe(3);
  });

  it('announces the parameter change as coming from OSC', () => {
    binding.createBinding('/a', 0, 'n1', 'radius', { min: 0, max: 10 });
    send('/a', [1]);

    expect(events.of('PARAMETER_CHANGED')[0]).toMatchObject({
      parameterName: 'radius',
      newValue: 10,
      source: 'osc',
    });
  });

  it('ignores a message for a node that has since been deleted', () => {
    binding.createBinding('/a', 0, 'n1', 'radius', { min: 0, max: 10 });
    graph.nodes = [];

    expect(() => send('/a', [1])).not.toThrow();
  });
});
