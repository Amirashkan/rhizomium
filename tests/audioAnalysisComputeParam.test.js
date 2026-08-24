// Regression: dropping an Audio Analysis node onto a compute node's parameter (Pattern's Scale,
// say) did nothing — the pattern sat at its default scale however loud the music was.
//
// Two independent causes, both covered here:
//
//   1. VALUE. The drag gesture writes a BARE reference, `=node_28` (NodeReferenceDrop). On the GPU
//      the compiler resolves that to the node's first output pin, `level`. On the CPU — which is
//      where a compute node's parameters are evaluated, since they are packed into uniforms rather
//      than compiled into the shader — the bare name was bound to the whole 15-pin array, so the
//      expression evaluated to a non-number and every consumer fell back to the parameter default.
//
//   2. LIVENESS. A compute node only re-evaluates its uniforms when it dispatches, and it only
//      dispatches when something says it changed. An Audio Analysis reference looks static to that
//      check — its meters live on the node object, not in the referring node's params — so even a
//      correctly-resolved reference would have moved only when some other edit forced a dispatch.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ParameterExpressionSystem } from '../src/utils/ParameterExpressionSystem.js';
import { ComputeShaderManager } from '../src/gpu/ComputeShaderManager.js';
import { ComputeExecutor } from '../src/gpu/ComputeExecutor.js';
import { PreviewComputer } from '../src/core/PreviewComputer.js';
import { AUDIO_ANALYSIS_PINS } from '../src/core/audioAnalysisPins.js';

const LOW = AUDIO_ANALYSIS_PINS.indexOf('low');

// An analysis node mid-signal: level 0.42, low 0.7, kick 0.9.
const audioNode = () => ({
  id: '28',
  kind: 'AudioAnalysis',
  params: {},
  __audio_level: 0.42,
  __audio_low: 0.7,
  __audio_kick: 0.9,
});

describe('an Audio Analysis reference on a compute parameter', () => {
  let es, audio, pattern, previousEditor, previousGraph, previousRegistry;

  beforeEach(() => {
    es = new ParameterExpressionSystem();
    audio = audioNode();
    pattern = { id: '9', kind: 'ComputePattern', params: { scaleX: '=node_28' } };
    previousEditor = window.editor;
    previousGraph = window.graph;
    previousRegistry = window.computeNodeRegistry;
    window.editor = { graph: { nodes: [audio, pattern] } };
  });

  afterEach(() => {
    window.editor = previousEditor;
    window.graph = previousGraph;
    window.computeNodeRegistry = previousRegistry;
  });

  it('resolves the bare `=node_<id>` the drag gesture writes to pin 0 (level)', () => {
    expect(es.evaluateExpression('=node_28', {}, pattern)).toBeCloseTo(0.42);
  });

  it('still resolves an explicit pin reference, and a formula around one', () => {
    expect(es.evaluateExpression(`=node_28_${LOW}`, {}, pattern)).toBeCloseTo(0.7);
    expect(es.evaluateExpression(`=node_28_${LOW} * 20`, {}, pattern)).toBeCloseTo(14);
  });

  it('follows the live meter instead of freezing at the first value read', () => {
    expect(es.evaluateExpression('=node_28', {}, pattern)).toBeCloseTo(0.42);
    audio.__audio_level = 0.05;
    expect(es.evaluateExpression('=node_28', {}, pattern)).toBeCloseTo(0.05);
  });

  it('leaves a Mouse reference as the vec4 its GPU global is', () => {
    const mouse = { id: '31', kind: 'Mouse', params: {} };
    window.editor.graph.nodes.push(mouse);
    window._mousePosition = [0.25, 0.75, 1, 0];
    try {
      expect(es.evaluateExpression('=node_31_y', {}, pattern)).toBeCloseTo(0.75);
    } finally {
      delete window._mousePosition;
    }
  });

  // The value a compute node's parameter actually reaches the uniform buffer through.
  it('packs the meter into the parameter instead of falling back to the default', () => {
    const evaluate = (value, def) =>
      ComputeShaderManager.prototype.evaluateParam.call({ node: pattern }, value, def, 0, {});

    expect(evaluate('=node_28', 8.0)).toBeCloseTo(0.42);
    expect(evaluate(`=node_28_${LOW} * 20`, 8.0)).toBeCloseTo(14);
    // A plain number is still packed as itself.
    expect(evaluate(12, 8.0)).toBeCloseTo(12);
  });
});

describe('Audio Analysis references in the preview pass', () => {
  const computer = Object.create(PreviewComputer.prototype);

  it('binds a bare reference to pin 0 and each pin to its index', () => {
    const context = {};
    const values = new Map([
      ['28', { type: 'split', scalarPins: true, values: [0.42, 0.7, 0.1] }],
    ]);
    computer._addNodeRefsToContext(context, values);

    expect(context.node_28).toBeCloseTo(0.42);
    expect(context.node_28_1).toBeCloseTo(0.7);
  });

  it('still binds a vector node to its whole vector', () => {
    const context = {};
    computer._addNodeRefsToContext(context, new Map([
      ['4', { type: 'split', values: [0.2, 0.8] }],
      ['5', [0.3, 0.6]],
    ]));

    expect(context.node_4).toEqual([0.2, 0.8]);
    expect(context.node_4_y).toBeCloseTo(0.8);
    expect(context.node_5).toEqual([0.3, 0.6]);
  });
});

describe('dispatching a compute node driven by audio', () => {
  let previousRegistry, previousEditor, previousGraph;

  // Exercised off the prototype: the method only reads window state, so this keeps the test clear
  // of the constructor's GPU device.
  const check = (node) =>
    ComputeExecutor.prototype.hasTimeDependentReferencedNodes.call({}, node);
  const seesReference = (node) =>
    ComputeExecutor.prototype.hasNodeReferenceParameters.call({}, node);

  const withGraph = (nodes) => {
    window.editor = { graph: { nodes } };
    window.graph = { getNode: (id) => nodes.find(n => String(n.id) === String(id)) || null };
  };

  beforeEach(() => {
    previousRegistry = window.computeNodeRegistry;
    previousEditor = window.editor;
    previousGraph = window.graph;
    // Deliberately empty: an Audio Analysis is not a compute node, so it is never in here.
    window.computeNodeRegistry = new Map();
  });

  afterEach(() => {
    window.computeNodeRegistry = previousRegistry;
    window.editor = previousEditor;
    window.graph = previousGraph;
  });

  it('keeps dispatching a node whose parameter references the analysis', () => {
    withGraph([audioNode()]);
    expect(check({ id: '9', kind: 'ComputePattern', params: { scaleX: '=node_28' } })).toBe(true);
  });

  it('sees a reference written as a formula, not only as a bare `=node_<id>`', () => {
    withGraph([audioNode()]);
    const node = { id: '9', kind: 'ComputePattern', params: { scaleX: '=clamp(node_28_1 * 20, 1, 40)' } };
    expect(seesReference(node)).toBe(true);
    expect(check(node)).toBe(true);
  });

  it('follows the chain through a node WIRED to the analysis', () => {
    // Audio Analysis --wire--> Remap --`=node_<remap>`--> Pattern. The wire carries the movement
    // and is invisible to a params-only check, so the Pattern froze at whatever the Remap read
    // when it was last dispatched.
    withGraph([
      audioNode(),
      { id: '30', kind: 'Remap', params: { inMin: 0, inMax: 1, outMin: 1, outMax: 40 }, inputs: ['28'] },
    ]);
    expect(check({ id: '9', kind: 'ComputePattern', params: { scaleX: '=node_30' } })).toBe(true);
  });

  it('follows the chain through a node that REFERENCES the analysis', () => {
    withGraph([
      audioNode(),
      { id: '30', kind: 'ConstFloat', params: { value: '=node_28_4' }, inputs: [] },
    ]);
    expect(check({ id: '9', kind: 'ComputePattern', params: { scaleX: '=node_30' } })).toBe(true);
  });

  it('still treats a reference to a static chain as static', () => {
    // The point of the check is to avoid dispatching every frame for nothing.
    withGraph([
      { id: '5', kind: 'ConstFloat', params: { value: 0.5 }, inputs: [] },
      { id: '6', kind: 'Remap', params: { outMax: 4 }, inputs: ['5'] },
    ]);
    expect(check({ id: '9', kind: 'ComputePattern', params: { scaleX: '=node_6' } })).toBe(false);
  });

  it('terminates on a feedback loop rather than recursing forever', () => {
    withGraph([
      { id: '5', kind: 'ComputeMix', params: {}, inputs: ['6'] },
      { id: '6', kind: 'ComputeMix', params: { amount: '=node_5' }, inputs: ['5'] },
    ]);
    expect(check({ id: '9', kind: 'ComputePattern', params: { scaleX: '=node_5' } })).toBe(false);
  });
});
