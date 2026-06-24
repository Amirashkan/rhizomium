// Regression test: a bare Time / RandomTime node must keep updating live, not freeze on a fixed
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
// Contract: clock-driven generator kinds (Time / RandomTime) are recomputed every frame and are
// never served from cache; the per-frame refresh marks them and their downstream dependents dirty.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NodeValueComputer } from '../src/core/preview/NodeValueComputer.js';
import { PreviewIntegration } from '../src/core/preview/PreviewIntegration.js';

describe('NodeValueComputer does not cache clock-driven nodes', () => {
  it('recomputes a Time node as the clock advances (no cache hit)', () => {
    const editor = { graph: { nodes: [], connections: [] } };
    const computer = new NodeValueComputer(editor);
    const timeNode = { id: 't1', kind: 'Time', params: {} };

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000); // (1000/1000) % 1 === 0
    const v1 = computer.computeNodeValue(timeNode);
    nowSpy.mockReturnValue(1500); // (1500/1000) % 1 === 0.5
    const v2 = computer.computeNodeValue(timeNode);
    nowSpy.mockRestore();

    expect(v1).toBeCloseTo(0, 5);
    expect(v2).toBeCloseTo(0.5, 5);
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

describe('updateTimeNodes refreshes intrinsic Time / RandomTime nodes', () => {
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
      _nodesReferencingClockNodes: PreviewIntegration.prototype._nodesReferencingClockNodes,
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

  it('marks a RandomTime node dirty', () => {
    const graph = {
      nodes: [{ id: 'r', kind: 'RandomTime', inputs: [] }],
      connections: [],
    };

    expect(makeHarness(graph)).toContain('r');
  });

  it('does nothing when there are no time nodes and no time expressions', () => {
    const graph = {
      nodes: [{ id: 'c', kind: 'constfloat', inputs: [] }],
      connections: [],
    };

    expect(makeHarness(graph)).toEqual([]);
  });

  // The reported bug: a Transform with translateX = "=node_<timeId>" animates at 60fps on the GPU
  // but its thumbnail crawled, because a node-reference (vs a literal "=time" expression) was never
  // treated as time-animated. updateTimeNodes must now refresh it and its downstream.
  it('marks a node that references a Time node via a parameter, plus its downstream', () => {
    const graph = {
      nodes: [
        { id: 't', kind: 'Time', inputs: [] },
        { id: 'x', kind: 'transform', params: { translateX: '=node_t', translateY: 0 }, inputs: [] },
        { id: 'o', kind: 'OutputFinal', inputs: ['x'] },
      ],
      connections: [{ from: { nodeId: 'x' }, to: { nodeId: 'o' } }],
    };

    const marked = makeHarness(graph);

    expect(marked).toContain('x'); // references the Time node through translateX
    expect(marked).toContain('o'); // downstream of the referencing node
  });

  it('does not treat a reference to a non-clock node as time-animated', () => {
    const graph = {
      nodes: [
        { id: 'c', kind: 'ConstFloat', params: { value: 1 }, inputs: [] },
        { id: 'x', kind: 'transform', params: { translateX: '=node_c' }, inputs: [] },
      ],
      connections: [],
    };

    // No Time/RandomTime node anywhere, so nothing should be flagged as animated.
    expect(makeHarness(graph)).toEqual([]);
  });
});
