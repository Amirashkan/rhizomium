// Regression: a Switch that cycles its inputs from a Count node (`select` = `=node_<count>`) must
// follow the counter everywhere the node is rendered — not only in the main output.
//
// Bug: three videos -> Switch -> 3D Field Visualizer. The mapper's source is materialized to a
// texture by FragmentTextureRenderer, which compiles its OWN, detached uniform manager. A Count has
// no `count` PARAMETER — its running counter lives on the CPU (node.__countValue, advanced every
// frame by CountNodeProcessor) and is streamed only into the MAIN renderer's uniform manager — so
// the subgraph's `<id>.count` uniform stayed at the compile-time default 0 forever. The Switch
// therefore stayed pinned to its first video in the bridged texture (and in node thumbnails) while
// the main output cycled correctly: "the 3D viz won't update with the new video".
//
// _syncCountUniforms mirrors the live counter into the snapshot before each render, and the same
// value is folded into the change-detection hash so the non-forced render paths re-fire when the
// counter (and with it the chosen input) moves.

import { describe, it, expect, afterEach } from 'vitest';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';

describe('FragmentTextureRenderer._syncCountUniforms', () => {
  let prevGraph;
  afterEach(() => { window.graph = prevGraph; });

  function setGraph(nodes) {
    prevGraph = window.graph;
    const byId = new Map(nodes.map((n) => [String(n.id), n]));
    window.graph = { getNode: (id) => byId.get(String(id)) };
  }

  it('overwrites each <id>.count entry with the node\'s live __countValue', () => {
    setGraph([{ id: '6', kind: 'Count', __countValue: 2 }]);

    const r = new FragmentTextureRenderer(null); // device unused by _syncCountUniforms
    const uniformManager = {
      uniformValues: new Map([
        ['8.select', 0],  // some other param
        ['6.count', 0],   // compiled default - a Count has no `count` param to seed it
      ]),
    };

    r._syncCountUniforms(uniformManager);

    expect(uniformManager.uniformValues.get('6.count')).toBe(2);
    expect(uniformManager.uniformValues.get('8.select')).toBe(0);
  });

  it('preserves Map insertion order (the Float32Array layout must match the struct)', () => {
    setGraph([{ id: '6', kind: 'Count', __countValue: 1 }]);

    const r = new FragmentTextureRenderer(null);
    const uniformManager = { uniformValues: new Map([['6.count', 0], ['8.select', 0.25]]) };

    r._syncCountUniforms(uniformManager);

    expect(Array.from(uniformManager.uniformValues.keys())).toEqual(['6.count', '8.select']);
    expect(Array.from(uniformManager.uniformValues.values())).toEqual([1, 0.25]);
  });

  it('leaves a same-named param on another kind of node alone', () => {
    // `count` is a plausible parameter name elsewhere; only a real Count node is streamed.
    setGraph([{ id: '7', kind: 'Repeat', params: { count: 4 }, __countValue: 99 }]);

    const r = new FragmentTextureRenderer(null);
    const uniformManager = { uniformValues: new Map([['7.count', 4]]) };

    r._syncCountUniforms(uniformManager);

    expect(uniformManager.uniformValues.get('7.count')).toBe(4);
  });

  it('leaves the default in place when the Count has not advanced yet', () => {
    setGraph([{ id: '6', kind: 'Count' }]); // __countValue undefined
    const r = new FragmentTextureRenderer(null);
    const uniformManager = { uniformValues: new Map([['6.count', 0]]) };

    r._syncCountUniforms(uniformManager);

    expect(uniformManager.uniformValues.get('6.count')).toBe(0);
  });

  it('is a no-op on an empty uniform set', () => {
    setGraph([]);
    const r = new FragmentTextureRenderer(null);
    expect(() => r._syncCountUniforms({ uniformValues: new Map() })).not.toThrow();
    expect(() => r._syncCountUniforms(null)).not.toThrow();
  });
});

describe('FragmentTextureRenderer._buildFragmentNodeHash (Count references)', () => {
  let prevGraph;
  afterEach(() => { window.graph = prevGraph; });
  function setGraph(nodes) {
    prevGraph = window.graph;
    const byId = new Map(nodes.map((n) => [String(n.id), n]));
    window.graph = { getNode: (id) => byId.get(String(id)) };
  }

  const switchNode = () => ({ id: '8', kind: 'Switch', params: { select: '=node_6' }, inputs: [] });

  it('changes when the referenced Count advances', () => {
    const count = { id: '6', kind: 'Count', __countValue: 0 };
    const sw = switchNode();
    setGraph([count, sw]);
    const r = new FragmentTextureRenderer(null);

    const h1 = r._buildFragmentNodeHash(sw, 0, {});
    count.__countValue = 1;
    const h2 = r._buildFragmentNodeHash(sw, 0, {});

    expect(h1).not.toBe(h2);
  });

  it('is stable while the counter holds (no needless re-render)', () => {
    setGraph([{ id: '6', kind: 'Count', __countValue: 1 }, switchNode()]);
    const r = new FragmentTextureRenderer(null);
    const sw = window.graph.getNode('8');

    expect(r._buildFragmentNodeHash(sw, 0, {})).toBe(r._buildFragmentNodeHash(sw, 0, {}));
  });

  it('_checkFragmentNodeNeedsRender re-fires when the counter moves', () => {
    const count = { id: '6', kind: 'Count', __countValue: 0 };
    const sw = switchNode();
    setGraph([count, sw]);
    const r = new FragmentTextureRenderer(null);

    expect(r._checkFragmentNodeNeedsRender('8', sw, 0, {})).toBe(true);  // first call
    expect(r._checkFragmentNodeNeedsRender('8', sw, 0, {})).toBe(false); // steady -> skip
    count.__countValue = 2;
    expect(r._checkFragmentNodeNeedsRender('8', sw, 0, {})).toBe(true);  // advanced -> render
  });
});
