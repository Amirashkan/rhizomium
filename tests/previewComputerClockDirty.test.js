// Regression test: a node driven by the clock must be recomputed as the clock advances, even
// though nothing about it changes between frames.
//
// Bug: "float (sin time) -> remap -> a translate parameter causes a stepped movement."
// _evaluateDirtyNodes decided dirtiness from a JSON hash of node.params plus the wired inputs.
// For a Float whose value is `sin(time)` both are byte-for-byte identical every frame, so the node
// was never dirty and computePreviews() early-returned the cached value. Compute-node parameters
// resolve `=node_<id>` references on the CPU (ComputeNodes.getParam registers them as uniforms
// instead of emitting shader code) and read exactly that cache, so a compute Transform whose
// translate was `=node_<remap>` only moved when PreviewIntegration.updateTimeNodes() forced the
// chain dirty — on its 100 ms UI throttle — while the render loop ran at frame rate. Hence steps.
// A bare `sin(time)` (no `=` prefix) was worse still: ParameterExpressionSystem.timeAnimatedNodes
// keys off isExpression(), which requires the `=`, so updateTimeNodes never covered it and the
// value never advanced at all, while the shader-side value animated normally.
//
// Fix: _evaluateDirtyNodes marks clock-driven nodes (and their dependents) dirty whenever
// animationTime advances, so the values track whatever cadence the caller computes at.

import { describe, it, expect, beforeEach } from 'vitest';
import { PreviewComputer } from '../src/core/PreviewComputer.js';
import { isClockExpression, hasClockExpressionParam } from '../src/core/clockExpression.js';

// Editor.hasTimeBasedExpressions — the render loop's "should I keep redrawing?" test — is now a
// one-liner over hasClockExpressionParam. It used to require a leading `=`, so a graph animated
// only by a bare `sin(time)` was declared static and stopped redrawing, even though the compilers
// emit `sin(g.time)` for that exact value.
describe('clock expression detection', () => {
  it('accepts the bare and `=`-prefixed forms alike', () => {
    expect(isClockExpression('sin(time)')).toBe(true);
    expect(isClockExpression('=sin(time)')).toBe(true);
    expect(isClockExpression('=time * 2')).toBe(true);
    expect(isClockExpression('=frame')).toBe(true);
    expect(isClockExpression('audioEnvelope')).toBe(true);
    expect(isClockExpression('=audioEnvelopeHighs * 0.5')).toBe(true);
  });

  it('does not match static values or words that merely contain the letters', () => {
    expect(isClockExpression('0.5')).toBe(false);
    expect(isClockExpression(0.5)).toBe(false);
    expect(isClockExpression(undefined)).toBe(false);
    expect(isClockExpression('timeline')).toBe(false);
    expect(isClockExpression('overtime')).toBe(false);
    expect(isClockExpression('frames_per_beat')).toBe(false);
  });

  it('scans every parameter of a node', () => {
    expect(hasClockExpressionParam({ params: { x: '0', y: '=sin(time)' } })).toBe(true);
    expect(hasClockExpressionParam({ params: { x: '0', y: '1' } })).toBe(false);
    expect(hasClockExpressionParam({})).toBe(false);
    expect(hasClockExpressionParam(null)).toBe(false);
  });
});

describe('PreviewComputer clock-driven dirty propagation', () => {
  let computer;

  // Float(<expr>) -> Remap, the chain a translate parameter references as `=node_5`.
  const makeGraph = (expr) => ({
    nodes: [
      { id: '4', kind: 'ConstFloat', inputs: [], params: { value: expr } },
      { id: '5', kind: 'Remap', inputs: ['4'], params: { inMin: -1, inMax: 1, outMin: -0.5, outMax: 0.5 } },
    ],
    connections: [],
  });

  // Put the computer in the steady state it reaches after a frame: structure known, param hashes
  // and input snapshots recorded, so only a genuine change dirties anything.
  const prime = (graph, time) => {
    computer.animationTime = time;
    computer.graphStructureHash = computer._computeGraphStructureHash(graph);
    for (const node of graph.nodes) {
      computer.lastParameterHashes.set(node.id, computer._computeParameterHash(node));
      computer.lastComputedInputs.set(node.id, computer._snapshotNodeInputs(node));
    }
    computer._lastClockDirtyTime = time;
  };

  const dirtyAt = (graph, time) => {
    computer.animationTime = time;
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return computer._evaluateDirtyNodes(graph, graph.nodes, byId).dirtyNodes;
  };

  beforeEach(() => {
    computer = new PreviewComputer();
  });

  it('identifies clock-driven nodes by expression and by kind', () => {
    expect(computer._isClockDrivenNode({ kind: 'ConstFloat', params: { value: 'sin(time)' } })).toBe(true);
    expect(computer._isClockDrivenNode({ kind: 'ConstFloat', params: { value: '=sin(time)' } })).toBe(true);
    expect(computer._isClockDrivenNode({ kind: 'ConstFloat', params: { value: '=audioEnvelopeBass * 2' } })).toBe(true);
    expect(computer._isClockDrivenNode({ kind: 'Time', params: {} })).toBe(true);
    expect(computer._isClockDrivenNode({ kind: 'RandomValue', params: { speed: 1 } })).toBe(true);
    // Wave is a free-running LFO — none of its params name `time`, so only the kind check finds it.
    expect(computer._isClockDrivenNode({ kind: 'Wave', params: { frequency: 1, amplitude: 1 } })).toBe(true);

    // Static values stay static.
    expect(computer._isClockDrivenNode({ kind: 'ConstFloat', params: { value: 0.25 } })).toBe(false);
    expect(computer._isClockDrivenNode({ kind: 'ConstFloat', params: { value: '=node_7 * 2' } })).toBe(false);
    // Mouse is input-driven, not clock-driven (PreviewIntegration refreshes it on pointer events).
    expect(computer._isClockDrivenNode({ kind: 'Mouse', params: {} })).toBe(false);
    // A word that merely contains the letters must not read as animated.
    expect(computer._isClockDrivenNode({ kind: 'Text', params: { text: 'timeline overtime' } })).toBe(false);
  });

  it('re-dirties a `sin(time)` Float and its downstream Remap as the clock advances', () => {
    const graph = makeGraph('sin(time)');
    prime(graph, 1.0);

    // Nothing edited — only the clock moved. Before the fix this was empty and the compute
    // uniform kept reading the previous frame's number.
    const dirty = dirtyAt(graph, 1.016);
    expect(dirty.has('4')).toBe(true);
    expect(dirty.has('5')).toBe(true);
  });

  it('does the same for the `=`-prefixed form', () => {
    const graph = makeGraph('=sin(time)');
    prime(graph, 1.0);

    const dirty = dirtyAt(graph, 1.016);
    expect(dirty.has('4')).toBe(true);
    expect(dirty.has('5')).toBe(true);
  });

  it('leaves a static graph clean so the computePreviews early-return still holds', () => {
    const graph = makeGraph(0.25);
    prime(graph, 1.0);

    expect(dirtyAt(graph, 1.016).size).toBe(0);
    expect(dirtyAt(graph, 2.5).size).toBe(0);
  });

  it('marks nothing extra while the clock is paused on the same timestamp', () => {
    const graph = makeGraph('sin(time)');
    prime(graph, 1.0);

    // A paused/scrubbed-and-held transport reports the same sim time every frame.
    expect(dirtyAt(graph, 1.0).size).toBe(0);
    // ...and resumes dirtying as soon as it moves again.
    expect(dirtyAt(graph, 1.016).has('4')).toBe(true);
  });

  it('re-dirties a Wave LFO and its downstream Remap as the clock advances', () => {
    const graph = {
      nodes: [
        { id: '4', kind: 'Wave', inputs: [], params: { shape: 'Sine', frequency: 1, amplitude: 1 } },
        { id: '5', kind: 'Remap', inputs: ['4'], params: { inMin: -1, inMax: 1, outMin: -0.5, outMax: 0.5 } },
      ],
      connections: [],
    };
    prime(graph, 1.0);

    const dirty = dirtyAt(graph, 1.016);
    expect(dirty.has('4')).toBe(true);
    expect(dirty.has('5')).toBe(true);
  });

  it('reaches a dependent that consumes the chain through a parameter expression', () => {
    const graph = makeGraph('sin(time)');
    // A compute Transform whose translate references the Remap — no wire between them.
    graph.nodes.push({
      id: '7',
      kind: 'ComputeTransform',
      inputs: ['6'],
      params: { translateX: '=node_5', translateY: 0 },
    });
    prime(graph, 1.0);

    const dirty = dirtyAt(graph, 1.016);
    expect(dirty.has('7')).toBe(true);
  });
});
