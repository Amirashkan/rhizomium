// Who draws the frame when a controller moves a parameter.
//
// A knob sweep delivers a hundred messages a second, and each one used to draw its own GPU frame
// with no time argument — so that frame rendered at wall-clock time while the render loop renders
// at its accumulated sim time. The two clocks are unrelated (sim time starts at zero, scales with
// timeScale, freezes while paused), so every controller-drawn frame landed at a different moment of
// the animation than the frames either side of it: an animated graph visibly jumped for as long as
// the knob moved, whether or not its shader read the mapped parameter at all.
//
// The rule these tests pin down: write the uniform always, draw only when nothing else will, and
// never draw at a clock of our own invention.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeParameterUniform } from '../src/parameters/ExternalParameterControl.js';
import { MIDIParameterBinding } from '../src/midi/MIDIParameterBinding.js';

function makeEventSystem() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    emit(type, data) {
      (handlers.get(type) || []).forEach((fn) => fn(data));
    },
  };
}

let renderer;
let uniformValues;

beforeEach(() => {
  uniformValues = new Map();
  renderer = {
    render: vi.fn(),
    _updateParameterUniforms: vi.fn(),
  };
  window.gpuRenderer = renderer;
  window.nodeCompiler = { uniformManager: { uniformValues } };
});

afterEach(() => {
  delete window.gpuRenderer;
  delete window.nodeCompiler;
  delete window.renderLoop;
  delete window.editor;
});

/** A render loop in the state the app leaves it in: started, drawing every frame. */
const runningLoop = (simTime = 12.5) => {
  window.renderLoop = { getState: () => ({ running: true, paused: false, simTime }) };
};

const stoppedLoop = (simTime = 12.5) => {
  window.renderLoop = { getState: () => ({ running: false, paused: false, simTime }) };
};

describe('writeParameterUniform', () => {
  it('always writes the value into the uniform buffer', () => {
    runningLoop();

    writeParameterUniform('n7', 'kickThresh', 0.42);

    expect(uniformValues.get('n7.kickThresh')).toBe(0.42);
    expect(renderer._updateParameterUniforms).toHaveBeenCalled();
  });

  it('leaves the frame to a running render loop', () => {
    runningLoop();

    writeParameterUniform('n7', 'kickThresh', 0.42);

    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('still leaves the frame to the loop while it is paused, since it keeps drawing', () => {
    window.renderLoop = { getState: () => ({ running: true, paused: true, simTime: 3 }) };

    writeParameterUniform('n7', 'kickThresh', 0.42);

    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('draws once at the loop clock when the loop is stopped', () => {
    stoppedLoop(12.5);

    writeParameterUniform('n7', 'kickThresh', 0.42);

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render).toHaveBeenCalledWith({ timeSec: 12.5 });
  });

  it('never draws at wall-clock time when a loop clock exists', () => {
    // Sim time and performance.now() diverge the moment anything pauses or scales time; a frame at
    // the wrong one is the jump this whole file is about.
    stoppedLoop(2);

    writeParameterUniform('n7', 'kickThresh', 0.42);

    const [config] = renderer.render.mock.calls[0];
    expect(config.timeSec).toBe(2);
    expect(config.timeSec).not.toBeCloseTo(performance.now() / 1000);
  });

  it('draws without a time argument when there is no loop to take a clock from', () => {
    writeParameterUniform('n7', 'kickThresh', 0.42);

    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(renderer.render.mock.calls[0][0]).toEqual({});
  });

  it('does nothing beyond the map write when there is no renderer', () => {
    delete window.gpuRenderer;

    expect(() => writeParameterUniform('n7', 'kickThresh', 0.42)).not.toThrow();
    expect(uniformValues.get('n7.kickThresh')).toBe(0.42);
  });
});

describe('a MIDI knob sweep on an Audio Analysis threshold', () => {
  let node;
  let binding;

  beforeEach(() => {
    node = { id: 'n7', kind: 'AudioAnalysis', params: { kickThresh: 0.5 }, x: 40, y: 80 };
    const graph = { nodes: [node], connections: [] };
    const events = makeEventSystem();
    window.editor = {};
    binding = new MIDIParameterBinding(graph, events, null);
    binding.createBinding('dev1', 0, 21, 'n7', 'kickThresh', { min: 0, max: 1 });
  });

  it('does not draw a frame per message while the loop is running', () => {
    runningLoop();
    renderer.render.mockClear();

    for (let i = 0; i <= 20; i++) {
      binding.handleCCMessage({ deviceId: 'dev1', channel: 0, cc: 21, value: i, normalizedValue: i / 20 });
    }

    expect(node.params.kickThresh).toBe(1);
    expect(uniformValues.get('n7.kickThresh')).toBe(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });
});
