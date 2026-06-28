// Regression: a node that references a Hold node via `=node_<id>` (e.g. a Circle whose radius is
// `=node_<hold>`) must update its GPU thumbnail as the held value changes.
//
// Bug: the per-node preview (FragmentTextureRenderer) compiles its OWN, detached uniform manager.
// A Hold node compiles to a `<id>.hold` uniform whose value lives on the CPU — HoldNodeProcessor
// advances node.__holdValue every frame and streams it into the MAIN renderer's uniform manager.
// The preview manager never received it, so its hold uniform stayed at the compile-time default and
// the thumbnail rendered a frozen value even though the CPU readout (which reads __holdValue
// directly) tracked the latch. _syncHoldUniforms mirrors the live held value into the snapshot
// before each render.

import { describe, it, expect, afterEach } from 'vitest';
import { FragmentTextureRenderer } from '../src/gpu/FragmentTextureRenderer.js';

describe('FragmentTextureRenderer._syncHoldUniforms', () => {
  let prevGraph;
  afterEach(() => { window.graph = prevGraph; });

  function setGraph(nodes) {
    prevGraph = window.graph;
    const byId = new Map(nodes.map((n) => [String(n.id), n]));
    window.graph = { getNode: (id) => byId.get(String(id)) };
  }

  it('overwrites each <id>.hold entry with the node\'s live __holdValue', () => {
    const hold = { id: '5', kind: 'Hold', __holdValue: 0.73 };
    setGraph([hold]);

    const r = new FragmentTextureRenderer(null); // device unused by _syncHoldUniforms
    const uniformManager = {
      uniformValues: new Map([
        ['6.radius', 0.25], // some other param
        ['5.hold', 0.0],    // compiled default
      ]),
    };

    r._syncHoldUniforms(uniformManager);

    expect(uniformManager.uniformValues.get('5.hold')).toBeCloseTo(0.73);
    // Unrelated params are untouched.
    expect(uniformManager.uniformValues.get('6.radius')).toBeCloseTo(0.25);
  });

  it('preserves Map insertion order (the Float32Array layout must match the struct)', () => {
    const hold = { id: '5', kind: 'Hold', __holdValue: 0.9 };
    setGraph([hold]);

    const r = new FragmentTextureRenderer(null);
    const uniformManager = {
      uniformValues: new Map([['5.hold', 0.0], ['6.radius', 0.25]]),
    };

    r._syncHoldUniforms(uniformManager);

    expect(Array.from(uniformManager.uniformValues.keys())).toEqual(['5.hold', '6.radius']);
    expect(Array.from(uniformManager.uniformValues.values())).toEqual([0.9, 0.25]);
  });

  it('leaves the default in place when the Hold node has no numeric __holdValue yet', () => {
    setGraph([{ id: '5', kind: 'Hold' }]); // __holdValue undefined
    const r = new FragmentTextureRenderer(null);
    const uniformManager = { uniformValues: new Map([['5.hold', 0.0]]) };

    r._syncHoldUniforms(uniformManager);

    expect(uniformManager.uniformValues.get('5.hold')).toBe(0.0);
  });

  it('is a no-op on an empty uniform set', () => {
    setGraph([]);
    const r = new FragmentTextureRenderer(null);
    expect(() => r._syncHoldUniforms({ uniformValues: new Map() })).not.toThrow();
    expect(() => r._syncHoldUniforms(null)).not.toThrow();
  });
});
