import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VideoResetProcessor } from '../src/core/VideoResetProcessor.js';

// Minimal stand-in for the editor graph: nodes + getNode by id.
function makeGraph(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return { nodes, getNode: (id) => byId.get(id) };
}

// Records resetVideo(nodeId) calls so tests can assert how often each node was rewound.
function makeTextureManager() {
  const calls = [];
  return { calls, resetVideo: (id) => calls.push(id) };
}

function videoNode(id, reset, extra = {}) {
  return { id, kind: 'Texture2D', params: { sourceType: 'video', reset, ...extra }, inputs: [] };
}

describe('VideoResetProcessor', () => {
  let proc;
  let tm;

  beforeEach(() => {
    proc = new VideoResetProcessor();
    tm = makeTextureManager();
    globalThis.window = globalThis.window || {};
    window._audioEnvelopeBass = 0;
  });

  afterEach(() => {
    delete window._audioEnvelopeBass;
    delete window.editor;
  });

  it('rewinds once per rising edge, not every frame the expression stays high', () => {
    const graph = makeGraph([videoNode('v', '=audioEnvelopeBass > 0.6')]);

    // Low -> nothing, and the first frame only seeds the edge detector.
    proc.update(graph, { time: 0, textureManager: tm });
    expect(tm.calls).toEqual([]);

    window._audioEnvelopeBass = 0.9;
    proc.update(graph, { time: 0.016, textureManager: tm });
    expect(tm.calls).toEqual(['v']);

    // Still loud -> no second rewind.
    proc.update(graph, { time: 0.032, textureManager: tm });
    expect(tm.calls).toEqual(['v']);

    // Drops and hits again -> the next beat re-cues the clip.
    window._audioEnvelopeBass = 0.1;
    proc.update(graph, { time: 0.048, textureManager: tm });
    window._audioEnvelopeBass = 0.8;
    proc.update(graph, { time: 0.064, textureManager: tm });
    expect(tm.calls).toEqual(['v', 'v']);
  });

  it('does not fire on the first frame of an expression that is already high', () => {
    window._audioEnvelopeBass = 1;
    const graph = makeGraph([videoNode('v', '=audioEnvelopeBass')]);

    proc.update(graph, { time: 0, textureManager: tm });

    expect(tm.calls).toEqual([]);
  });

  it('leaves a click-only button alone', () => {
    const graph = makeGraph([videoNode('a', ''), videoNode('b', '   '), videoNode('c', undefined)]);

    proc.update(graph, { time: 0, textureManager: tm });
    proc.update(graph, { time: 1, textureManager: tm });

    expect(tm.calls).toEqual([]);
  });

  it('accepts an expression written without the leading =', () => {
    const graph = makeGraph([videoNode('v', 'audioEnvelopeBass')]);
    proc.update(graph, { time: 0, textureManager: tm });

    window._audioEnvelopeBass = 1;
    proc.update(graph, { time: 0.016, textureManager: tm });

    expect(tm.calls).toEqual(['v']);
  });

  it('fires on the clock, so a clip can be re-cued on a cycle', () => {
    // High for the second half of every 2s cycle.
    const graph = makeGraph([videoNode('v', '=sin(time * PI)  < 0')]);

    proc.update(graph, { time: 0.5, textureManager: tm });
    expect(tm.calls).toEqual([]);

    proc.update(graph, { time: 1.5, textureManager: tm });
    expect(tm.calls).toEqual(['v']);

    proc.update(graph, { time: 2.5, textureManager: tm });
    expect(tm.calls).toEqual(['v']);

    proc.update(graph, { time: 3.5, textureManager: tm });
    expect(tm.calls).toEqual(['v', 'v']);
  });

  it('reads another node in the patch by reference', () => {
    const source = { id: 12, kind: 'Trigger', params: {}, inputs: [], __preview: 0 };
    const graph = makeGraph([source, videoNode('v', '=node_12')]);

    proc.update(graph, { time: 0, textureManager: tm });
    expect(tm.calls).toEqual([]);

    source.__preview = 1;
    proc.update(graph, { time: 0.016, textureManager: tm });
    expect(tm.calls).toEqual(['v']);
  });

  it('treats a broken expression as "not firing" rather than as an edge', () => {
    const graph = makeGraph([videoNode('v', '=sin(')]);

    proc.update(graph, { time: 0, textureManager: tm });
    proc.update(graph, { time: 1, textureManager: tm });

    expect(tm.calls).toEqual([]);
  });

  it('ignores a still image and leaves the Feedback nodes\' own Reset alone', () => {
    const still = { id: 's', kind: 'Texture2D', params: { sourceType: 'image', reset: '=1' }, inputs: [] };
    const feedback = { id: 'f', kind: 'ComputeFeedback', params: { reset: '=1' }, inputs: [] };
    const graph = makeGraph([still, feedback]);

    proc.update(graph, { time: 0, textureManager: tm });
    proc.update(graph, { time: 1, textureManager: tm });

    expect(tm.calls).toEqual([]);
  });

  it('drops edge state for a node whose expression was cleared', () => {
    const node = videoNode('v', '=audioEnvelopeBass');
    const graph = makeGraph([node]);

    window._audioEnvelopeBass = 1;
    proc.update(graph, { time: 0, textureManager: tm }); // seeds high
    node.params.reset = '';
    proc.update(graph, { time: 0.016, textureManager: tm });
    expect(proc._state.size).toBe(0);

    // Typed again while the signal is still high: it seeds afresh instead of firing immediately.
    node.params.reset = '=audioEnvelopeBass';
    proc.update(graph, { time: 0.032, textureManager: tm });
    expect(tm.calls).toEqual([]);
  });

  it('survives an empty graph', () => {
    expect(() => proc.update(makeGraph([]), { time: 0, textureManager: tm })).not.toThrow();
    expect(() => proc.update(null, { time: 0, textureManager: tm })).not.toThrow();
  });
});
