// A MIDI-controlled parameter used to be nothing but the controller's output: the incoming CC was
// written straight over node.params, so a parameter could hold a formula or it could be mapped to a
// fader, never both. "=midi + sin(time)" — a fader setting the centre while an LFO wobbles around
// it — was impossible to express, and typing it only worked until the next CC arrived and replaced
// it with a bare number.
//
// The reading is now recorded alongside the parameter instead of replacing it, and expressions can
// name it as `midi` (`osc` for the OSC side). These tests cover both halves: the write path leaving
// an expression alone, and the expression reading the controller on CPU and on GPU.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MIDIParameterBinding } from '../src/midi/MIDIParameterBinding.js';
import { OSCParameterBinding } from '../src/osc/OSCParameterBinding.js';
import { expressionSystem } from '../src/utils/ParameterExpressionSystem.js';
import { ParameterUniformManager } from '../src/gpu/ParameterUniformManager.js';
import { buildParamRefMapping, externalControlScope } from '../src/utils/paramReferences.js';
import { unifiedExpressionSystem } from '../src/utils/UnifiedExpressionSystem.js';
import { clearExternalReadings } from '../src/parameters/ExternalParameterControl.js';

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
  node = { id: 'n1', kind: 'CircleField', params: { radius: 0.2 }, x: 10, y: 20 };
  graph = { nodes: [node], connections: [] };
  events = makeEventSystem();
  binding = new MIDIParameterBinding(graph, events, null);
  expressionSystem.clearCache();
});

afterEach(() => {
  clearExternalReadings('n1');
  delete window.editor;
  delete window.nodeCompiler;
  delete window.gpuRenderer;
});

/** Deliver a CC the way MIDIManager would, as a 0-1 reading. */
function sendCC(normalized, { channel = 0, cc = 7 } = {}) {
  events.emit('MIDI_CC', {
    deviceId: 'dev', channel, cc,
    value: Math.round(normalized * 127),
    normalizedValue: normalized,
  });
}

describe('a controller reaching an expression instead of replacing it', () => {
  it('still writes the value onto a plain numeric parameter', () => {
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 0, max: 1 });

    sendCC(0.5);

    expect(node.params.radius).toBe(0.5);
  });

  it('leaves an expression in place when a CC arrives', () => {
    node.params.radius = '=midi + 0.1';
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 0, max: 1 });

    sendCC(0.25);
    sendCC(0.75);

    expect(node.params.radius).toBe('=midi + 0.1');
  });

  it('feeds the reading to the expression as `midi`', () => {
    node.params.radius = '=midi + 0.1';
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 0, max: 1 });

    sendCC(0.25);
    expect(expressionSystem.evaluateExpression('=midi + 0.1', {}, node, 'radius')).toBeCloseTo(0.35);

    sendCC(0.75);
    expect(expressionSystem.evaluateExpression('=midi + 0.1', {}, node, 'radius')).toBeCloseTo(0.85);
  });

  it('maps the reading through the binding range before the expression sees it', () => {
    node.params.radius = '=midi';
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 2, max: 4 });

    sendCC(0.5);

    expect(expressionSystem.evaluateExpression('=midi', {}, node, 'radius')).toBeCloseTo(3);
  });

  it('reads 0 for a controller that has not sent anything yet', () => {
    node.params.radius = '=midi * 10';

    expect(expressionSystem.evaluateExpression('=midi * 10', {}, node, 'radius')).toBe(0);
  });

  it('recovers the parameter name when the caller only passes the node', () => {
    node.params.radius = '=midi + 1';
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 0, max: 1 });

    sendCC(0.5);

    // Most call sites (previews, node overlays, the text rasteriser) evaluate with the node alone.
    expect(expressionSystem.evaluateExpression('=midi + 1', {}, node)).toBeCloseTo(1.5);
  });

  it('does not leak one parameter\'s reading into another\'s expression', () => {
    node.params.radius = '=midi';
    node.params.softness = '=midi';
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 0, max: 1 });

    sendCC(0.8);

    expect(expressionSystem.evaluateExpression('=midi', {}, node, 'radius')).toBeCloseTo(0.8);
    expect(expressionSystem.evaluateExpression('=midi', {}, node, 'softness')).toBe(0);
  });

  it('resets `midi` to 0 once the binding is removed', () => {
    node.params.radius = '=midi';
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 0, max: 1 });
    sendCC(0.6);

    binding.removeBindingForParameter('n1', 'radius');

    expect(expressionSystem.evaluateExpression('=midi', {}, node, 'radius')).toBe(0);
  });

  it('reports the expression result, not the raw reading, on PARAMETER_CHANGED', () => {
    window.expressionSystem = expressionSystem;
    node.params.radius = '=midi + 1';
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 0, max: 1 });

    sendCC(0.5);

    const [change] = events.of('PARAMETER_CHANGED').slice(-1);
    expect(change.newValue).toBeCloseTo(1.5);
    expect(change.controlValue).toBeCloseTo(0.5);
    delete window.expressionSystem;
  });
});

describe('a parameter named midi', () => {
  it('does not shadow the controller identifier', () => {
    // `midi` is owned by the expression language, like `time` — a node that happens to have a
    // parameter by that name must not capture it.
    node.params = { radius: '=midi', midi: 42 };

    expect(expressionSystem.evaluateExpression('=midi', {}, node, 'radius')).toBe(0);
  });
});

describe('shader generation', () => {
  it('compiles `midi` to the parameter uniform, not a baked number', () => {
    const uniformManager = new ParameterUniformManager();
    node.params.radius = '=midi + sin(time)';

    const mapping = buildParamRefMapping(node, 'midi + sin(time)', {
      uniformManager,
      excludeParam: 'radius',
      graph,
    });
    const wgsl = unifiedExpressionSystem.generateShader('midi + sin(time)', mapping, graph);

    expect(mapping.midi).toBe('u_params._n1_radius');
    expect(wgsl).toBe('(u_params._n1_radius + sin(g.time))');
    // Registering the uniform is what keeps the fader at 60fps: the reading is a buffer write, not
    // a shader rebuild.
    expect(uniformManager.uniformValues.has('n1.radius')).toBe(true);
  });

  it('registers the uniform before any binding exists', () => {
    const uniformManager = new ParameterUniformManager();
    node.params.radius = '=midi';

    buildParamRefMapping(node, 'midi', { uniformManager, excludeParam: 'radius', graph });

    expect(uniformManager.uniformValues.get('n1.radius')).toBe(0);
  });

  it('seeds the uniform with the current reading', () => {
    const uniformManager = new ParameterUniformManager();
    node.params.radius = '=midi';
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 0, max: 1 });
    sendCC(0.4);

    buildParamRefMapping(node, 'midi', { uniformManager, excludeParam: 'radius', graph });

    expect(uniformManager.uniformValues.get('n1.radius')).toBeCloseTo(0.4);
  });

  it('bakes the reading when no uniform manager is available', () => {
    // A per-node thumbnail compiles a subgraph with no parameter uniforms; the value freezes at
    // the current reading rather than falling back to an unknown identifier and zeroing.
    node.params.radius = '=midi';
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 0, max: 1 });
    sendCC(0.5);

    const mapping = buildParamRefMapping(node, 'midi', { excludeParam: 'radius', graph });

    expect(mapping.midi).toBe('0.5');
  });
});

describe('uniform analysis', () => {
  it('keeps the live reading when the parameter holds an expression', () => {
    const uniformManager = new ParameterUniformManager();
    window.editor = { midiBinding: binding, onChange: () => {} };
    binding.createBinding('dev', 0, 7, 'n1', 'radius', { min: 0, max: 1 });
    node.params.radius = '=midi + sin(time)';
    sendCC(0.75);

    // A recompile re-analyses every node. parseFloat("=midi + sin(time)") is NaN, and the old
    // `|| 0` zeroed the fader on every unrelated edit in the patch.
    uniformManager.analyzeNode(node);

    expect(uniformManager.uniformValues.get('n1.radius')).toBeCloseTo(0.75);
  });
});

describe('OSC', () => {
  let oscEvents;
  let oscBinding;

  beforeEach(() => {
    oscEvents = makeEventSystem();
    oscBinding = new OSCParameterBinding(graph, oscEvents, null);
  });

  it('feeds an expression through `osc` instead of replacing it', () => {
    node.params.radius = '=osc * 2';
    oscBinding.createBinding('/1/fader1', 0, 'n1', 'radius', { min: 0, max: 1 });

    oscEvents.emit('OSC_MESSAGE', { address: '/1/fader1', args: [0.5], types: '', value: 0.5 });

    expect(node.params.radius).toBe('=osc * 2');
    expect(externalControlScope('n1', 'radius').osc).toBeCloseTo(0.5);
    expect(expressionSystem.evaluateExpression('=osc * 2', {}, node, 'radius')).toBeCloseTo(1);
  });

  it('still drives a plain numeric parameter', () => {
    oscBinding.createBinding('/1/fader1', 0, 'n1', 'radius', { min: 0, max: 10 });

    oscEvents.emit('OSC_MESSAGE', { address: '/1/fader1', args: [0.5], types: '', value: 0.5 });

    expect(node.params.radius).toBe(5);
  });
});
