// Regression: node values read through a `=node_<id>` reference moved in visible steps instead of
// animating, and many node kinds reported a value of 0 no matter what they were doing.
//
// Two evaluators had grown side by side:
//   * PreviewComputer.computePreviews — every node kind, but throttled to ~10 FPS and dirty-tracked.
//   * NodeValueComputer.computeNodeValue — called EVERY frame by the fragment texture bridge, the
//     3D field mapper and the thumbnail renderers to resolve references, but with a hand-written
//     switch covering ~20 kinds. Anything else (Sin, Remap, Mix, Clamp, the logic gates, Expr, ...)
//     fell through to `default: 0`, or to whatever the 10 FPS pass had last cached — which is the
//     stepping.
//
// Contract: one evaluator. NodeValueComputer delegates to PreviewComputer._evaluateNodeKind via
// evaluateNodeLive, which re-evaluates the node AND the chain feeding it at the current frame's
// sim time, so a reference tracks the animation frame for frame.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeValueComputer } from '../src/core/preview/NodeValueComputer.js';
import { PreviewComputer } from '../src/core/PreviewComputer.js';

function makeEditor(nodes, connections = []) {
  const graph = { nodes, connections };
  const previewComputer = new PreviewComputer();
  const editor = { graph, previewComputer };
  previewComputer.editor = editor;
  return { editor, previewComputer, computer: new NodeValueComputer(editor) };
}

function setFrame(time, frameIndex) {
  window.renderLoop = { _simTime: time, _frameIndex: frameIndex };
}

describe('live node value evaluation', () => {
  let previousRenderLoop;
  let previousEditor;

  beforeEach(() => {
    previousRenderLoop = window.renderLoop;
    previousEditor = window.editor;
    setFrame(0, 0);
  });

  afterEach(() => {
    window.renderLoop = previousRenderLoop;
    window.editor = previousEditor;
  });

  it('computes a node kind the local switch never had a case for', () => {
    const time = { id: 1, kind: 'Time', params: {}, inputs: [] };
    const sin = { id: 2, kind: 'Sin', params: {}, inputs: [1] };
    const { computer } = makeEditor([time, sin], [
      { from: { nodeId: 1, pin: 0 }, to: { nodeId: 2, pin: 0 } },
    ]);

    setFrame(Math.PI / 2, 1);

    expect(computer.computeNodeValue(time)).toBeCloseTo(Math.PI / 2, 5);
    expect(computer.computeNodeValue(sin)).toBeCloseTo(1, 5); // was 0 — no "sin" case
  });

  it('tracks the clock across frames instead of stepping at the preview cadence', () => {
    const float = { id: 3, kind: 'ConstFloat', params: { value: '=time * 2' }, inputs: [] };
    const multiply = { id: 4, kind: 'Multiply', params: { b: 3 }, inputs: [3] };
    const { computer } = makeEditor([float, multiply], [
      { from: { nodeId: 3, pin: 0 }, to: { nodeId: 4, pin: 0 } },
    ]);

    setFrame(0.25, 1);
    expect(computer.computeNodeValue(multiply)).toBeCloseTo(0.25 * 2 * 3, 5);

    setFrame(0.75, 2);
    expect(computer.computeNodeValue(multiply)).toBeCloseTo(0.75 * 2 * 3, 5);
  });

  it('re-evaluates the whole upstream chain, not just the referenced node', () => {
    const float = { id: 5, kind: 'ConstFloat', params: { value: '=time' }, inputs: [] };
    const remap = {
      id: 6,
      kind: 'Remap',
      params: { inMin: 0, inMax: 1, outMin: 0, outMax: 10 },
      inputs: [5],
    };
    const { computer } = makeEditor([float, remap], [
      { from: { nodeId: 5, pin: 0 }, to: { nodeId: 6, pin: 0 } },
    ]);

    setFrame(0.4, 1);
    expect(computer.computeNodeValue(remap)).toBeCloseTo(4, 5);

    setFrame(0.9, 2);
    expect(computer.computeNodeValue(remap)).toBeCloseTo(9, 5);
  });

  it('evaluates a dependency reached only through a parameter expression', () => {
    const float = { id: 7, kind: 'ConstFloat', params: { value: '=time' }, inputs: [] };
    // No wire — the Circle depends on the float purely through its radius expression.
    const circle = { id: 8, kind: 'Circle', params: { radius: '=node_7 * 0.5' }, inputs: [] };
    const { computer } = makeEditor([float, circle]);

    setFrame(0.6, 1);

    // A field node's value is a descriptor object for the thumbnail renderers; a reference
    // consumer gets the one scalar it stands for.
    expect(computer.computeNodeValue(circle)).toBeCloseTo(0.3, 5);
  });

  it('publishes live values into the cache reference consumers read', () => {
    const float = { id: 9, kind: 'ConstFloat', params: { value: '=time' }, inputs: [] };
    const add = { id: 10, kind: 'Add', params: { b: 1 }, inputs: [9] };
    const { computer, previewComputer } = makeEditor([float, add], [
      { from: { nodeId: 9, pin: 0 }, to: { nodeId: 10, pin: 0 } },
    ]);

    setFrame(2, 1);
    computer.computeNodeValue(add);

    expect(previewComputer.lastComputedValues.get(9)).toBeCloseTo(2, 5);
    expect(previewComputer.lastComputedValues.get(10)).toBeCloseTo(3, 5);
  });

  it('survives a cycle in the graph rather than recursing forever', () => {
    const a = { id: 11, kind: 'Add', params: {}, inputs: [12] };
    const b = { id: 12, kind: 'Add', params: {}, inputs: [11] };
    const { computer } = makeEditor([a, b], [
      { from: { nodeId: 12, pin: 0 }, to: { nodeId: 11, pin: 0 } },
      { from: { nodeId: 11, pin: 0 }, to: { nodeId: 12, pin: 0 } },
    ]);

    expect(Number.isFinite(computer.computeNodeValue(a))).toBe(true);
  });

  it('reads a Split source through the pin the wire actually came from', () => {
    const vec = { id: 13, kind: 'ConstVec3', params: { x: 0.1, y: 0.2, z: 0.3 }, inputs: [] };
    const split = { id: 14, kind: 'Split3', params: {}, inputs: [13] };
    const add = { id: 15, kind: 'Add', params: { b: 0 }, inputs: [14] };
    const { computer } = makeEditor([vec, split, add], [
      { from: { nodeId: 13, pin: 0 }, to: { nodeId: 14, pin: 0 } },
      { from: { nodeId: 14, pin: 2 }, to: { nodeId: 15, pin: 0 } }, // wired off the Z pin
    ]);

    expect(computer.computeNodeValue(add)).toBeCloseTo(0.3, 5);
  });

  it('mirrors the CPU-advanced value of stateful nodes', () => {
    const hold = { id: 16, kind: 'Hold', params: {}, inputs: [], __holdValue: 0.75 };
    const { computer } = makeEditor([hold]);

    expect(computer.computeNodeValue(hold)).toBe(0.75);

    hold.__holdValue = 0.25;
    setFrame(0.1, 2); // next frame — the per-frame memo must not pin the old value
    expect(computer.computeNodeValue(hold)).toBe(0.25);
  });
});
