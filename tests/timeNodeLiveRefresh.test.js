// Regression test: a bare Time node must keep updating live, not freeze on a fixed
// value.
//
// Bug: the editor only treated a node as "animated" when it had a parameter expression referencing
// time/frame/audioEnvelope (tracked in expressionSystem.timeAnimatedNodes). A Time node has no such
// expression, so it was never registered. Consequences:
//   1. NodeValueComputer cached its value keyed on input/param hashes (which never change for a
//      Time node), so computeNodeValue returned a frozen value forever.
//   2. PreviewIntegration.updateTimeNodes() early-returned when timeAnimatedNodes was empty, so the
//      Time node (and anything downstream of it) was never marked dirty / recomputed per frame.
// Connecting the node to something triggered a one-time invalidation — hence "it updates once then
// stays fixed".
//
// Contract: clock-driven generator kinds (Time) are recomputed every frame and are
// never served from cache; the per-frame refresh marks them and their downstream dependents dirty.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NodeValueComputer } from '../src/core/preview/NodeValueComputer.js';
import { PreviewIntegration } from '../src/core/preview/PreviewIntegration.js';

describe('NodeValueComputer does not cache clock-driven nodes', () => {
  it('recomputes a Time node as the clock advances (no cache hit)', () => {
    const editor = { graph: { nodes: [], connections: [] } };
    const computer = new NodeValueComputer(editor);
    const timeNode = { id: 't1', kind: 'Time', params: {} };

    // A Time node reads the clock in seconds, unwrapped — the same value the shader gets as
    // g.time. It used to be wrapped to `(Date.now() / 1000) % 1`, a sawtooth that snapped back to
    // 0 every second, so a reference to a Time node jumped once a second instead of ramping.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const v1 = computer.computeNodeValue(timeNode);
    nowSpy.mockReturnValue(1500);
    const v2 = computer.computeNodeValue(timeNode);
    nowSpy.mockRestore();

    expect(v1).toBeCloseTo(1, 5);
    expect(v2).toBeCloseTo(1.5, 5);
    expect(v1).not.toBe(v2); // would be equal (cached) before the fix
    // A clock-driven node must never be stored in the value cache.
    expect(computer._valueCache.has('t1')).toBe(false);
  });

  it('still caches ordinary nodes (constfloat) whose value is input/param driven', () => {
    const editor = { graph: { nodes: [], connections: [] } };
    const computer = new NodeValueComputer(editor);
    const node = { id: 'c1', kind: 'constfloat', params: { value: 0.42 } };

    expect(computer.computeNodeValue(node)).toBe(0.42);
    expect(computer._valueCache.has('c1')).toBe(true);
  });
});

describe('updateTimeNodes refreshes intrinsic Time nodes', () => {
  let previousEditor;

  // Drive updateTimeNodes without constructing PreviewIntegration (its constructor schedules
  // timers / RAF handlers). We provide just the collaborators the method touches and capture which
  // node ids get marked dirty.
  function makeHarness(graph, { expressionTimeNodes = [] } = {}) {
    const markedDirty = [];
    const self = {
      editor: {
        graph,
        previewComputer: {
          markNodeDirty: (id) => markedDirty.push(id),
          requestPreviewComputation: () => {}, // dirtying happens before this call; ignore callback
        },
        paramPanel: { refreshParameterDisplays: () => {} },
        markDirty: () => {},
        draw: () => {},
      },
      previewSystem: {},
      lastSignificantUpdate: -1e6, // bypass the 100ms throttle
      // Helpers updateTimeNodes calls on `this`; bind them off the prototype since we don't
      // construct PreviewIntegration here.
      _buildExpressionDependentsMap: PreviewIntegration.prototype._buildExpressionDependentsMap,
      _extractNodeReferences: PreviewIntegration.prototype._extractNodeReferences,
    };
    // The expression-animated set is read off window.editor, the graph off this.editor.
    window.editor = {
      paramPanel: { expressionSystem: { timeAnimatedNodes: new Set(expressionTimeNodes) } },
    };
    PreviewIntegration.prototype.updateTimeNodes.call(self);
    return markedDirty;
  }

  beforeEach(() => {
    previousEditor = window.editor;
  });

  afterEach(() => {
    window.editor = previousEditor;
  });

  it('marks a bare Time node dirty even with no time-based expressions', () => {
    const graph = {
      nodes: [{ id: 't', kind: 'Time', inputs: [] }],
      connections: [],
    };

    const marked = makeHarness(graph);

    expect(marked).toContain('t');
  });

  it('marks Time and everything downstream of it dirty', () => {
    const graph = {
      nodes: [
        { id: 't', kind: 'Time', inputs: [] },
        { id: 'm', kind: 'multiply', inputs: ['t'] },
        { id: 'o', kind: 'OutputFinal', inputs: ['m'] },
      ],
      connections: [
        { from: { nodeId: 't' }, to: { nodeId: 'm' } },
        { from: { nodeId: 'm' }, to: { nodeId: 'o' } },
      ],
    };

    const marked = makeHarness(graph);

    expect(marked).toContain('t');
    expect(marked).toContain('m');
    expect(marked).toContain('o');
  });

  it('does nothing when there are no time nodes and no time expressions', () => {
    const graph = {
      nodes: [{ id: 'c', kind: 'constfloat', inputs: [] }],
      connections: [],
    };

    expect(makeHarness(graph)).toEqual([]);
  });

  // Regression: a node that consumes an animated node through a *parameter expression* (e.g. a
  // ternary `=node_1 > 0.5 ? 1 : 0`) rather than a wire must also be refreshed each frame. Before
  // the fix only wired dependents were followed, so the value shown beside the float's output pin
  // froze while the parameter panel readout (re-evaluated on every refresh) stayed correct.
  it('marks an expression-only dependent (e.g. =node_1 > 0.5 ? 1 : 0) dirty when its referenced node animates', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'Time', inputs: [] },
        { id: '2', kind: 'ConstFloat', inputs: [], params: { value: '=node_1 > 0.5 ? 1 : 0' } },
      ],
      connections: [], // no wire — the dependency exists only through the expression
    };

    const marked = makeHarness(graph);

    expect(marked).toContain('1'); // the Time node itself
    expect(marked).toContain('2'); // the float whose expression references it
  });

  // Regression: a Hold (sample-and-hold) node's held value is advanced on the CPU every frame by
  // HoldNodeProcessor, so it has no time/audio parameter expression and is never registered in
  // timeAnimatedNodes. It must still be treated as a live node here, otherwise a consumer that
  // references it (e.g. a Circle radius = `=node_<hold>`) freezes at a stale value.
  it('marks a bare Hold node dirty even with no time-based expressions', () => {
    const graph = {
      nodes: [{ id: 'h', kind: 'Hold', inputs: [] }],
      connections: [],
    };

    expect(makeHarness(graph)).toContain('h');
  });

  it('marks a node that references a Hold node via =node_<id> (e.g. Circle radius) dirty', () => {
    const graph = {
      nodes: [
        { id: '5', kind: 'Hold', inputs: [] },
        { id: '6', kind: 'Circle', inputs: [], params: { radius: '=node_5' } },
      ],
      connections: [], // no wire — the dependency exists only through the expression
    };

    const marked = makeHarness(graph);

    expect(marked).toContain('5'); // the Hold node itself
    expect(marked).toContain('6'); // the Circle whose radius references it
  });

  // Regression: a Random Value node is clock-driven (fract(sin(g.time...))) and, like a bare Time
  // node, has no time/audio parameter expression, so it never registers in timeAnimatedNodes. It
  // must still be marked dirty each frame here, otherwise its live value freezes — most visibly
  // when one is wired through to the output via drag+tab (which also left the value frozen by
  // leaving interaction mode set; see the hadTimeAnimatedNodes gate in main.js).
  it('marks a bare Random Value node dirty even with no time-based expressions', () => {
    const graph = {
      nodes: [{ id: 'r', kind: 'RandomValue', inputs: [] }],
      connections: [],
    };

    expect(makeHarness(graph)).toContain('r');
  });

  it('marks a Random Value and everything wired downstream of it dirty', () => {
    const graph = {
      nodes: [
        { id: 'r', kind: 'RandomValue', inputs: [] },
        { id: 'c', kind: 'Count', inputs: ['r'] },
        { id: 'o', kind: 'OutputFinal', inputs: ['c'] },
      ],
      connections: [
        { from: { nodeId: 'r' }, to: { nodeId: 'c' } },
        { from: { nodeId: 'c' }, to: { nodeId: 'o' } },
      ],
    };

    const marked = makeHarness(graph);

    expect(marked).toContain('r');
    expect(marked).toContain('c');
    expect(marked).toContain('o');
  });

  it('follows expression references transitively through a chain', () => {
    const graph = {
      nodes: [
        { id: '1', kind: 'Time', inputs: [] },
        { id: '2', kind: 'ConstFloat', inputs: [], params: { value: '=node_1 * 2' } },
        { id: '3', kind: 'ConstFloat', inputs: [], params: { value: '=node_2 + 1' } },
      ],
      connections: [],
    };

    const marked = makeHarness(graph);

    expect(marked).toContain('1');
    expect(marked).toContain('2');
    expect(marked).toContain('3');
  });
});
