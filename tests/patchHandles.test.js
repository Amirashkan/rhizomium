// The handles: what a scenario and a live plan can actually name.
//
// The failure these exist to stop is a silent one. A drive bound to a node the
// patch does not contain registers cleanly, writes nothing for the length of
// the set, and leaves a performance log full of successes over a still frame.
// So the tests below care most about two things: that a handle reported here
// is one ActionExecutor.resolveNode() would really find, and that a drive
// pointing at nothing is reported as pointing at nothing.

import { describe, it, expect } from 'vitest';
import { patchHandles, handlesText, deadDrives, handleFor } from '../src/performer/PatchHandles.js';
import { ActionExecutor } from '../src/performer/ActionExecutor.js';

const node = (id, kind, extra = {}) => ({ id, kind, params: {}, ...extra });

const patch = (...nodes) => ({ nodes });

describe('patchHandles', () => {
  it('reports nothing for an empty patch', () => {
    expect(patchHandles(null)).toEqual({ nodes: [], total: 0, ambiguous: [] });
    expect(patchHandles({ nodes: [] }).nodes).toEqual([]);
  });

  it('names a node by its kind when the artist has not renamed it', () => {
    const handles = patchHandles(patch(node('1', 'ComputeNoise')));
    expect(handles.nodes[0].name).toBe('ComputeNoise');
    expect(handles.nodes[0].named).toBe(false);
  });

  it('names a node by the artist\'s own name when it has one', () => {
    const handles = patchHandles(patch(node('1', 'ComputeNoise', { name: 'membrane' })));
    expect(handles.nodes[0].name).toBe('membrane');
    expect(handles.nodes[0].named).toBe(true);
  });

  it('lists only parameters a fader can move', () => {
    const handles = patchHandles(patch(node('1', 'ComputeNoise')));
    const names = handles.nodes[0].params.map((param) => param.name);
    // scale, octaves and speed are numbers; colorize is a boolean and
    // resolution is a select, and a drive can do nothing with either.
    expect(names).toContain('scale');
    expect(names).toContain('octaves');
    expect(names).not.toContain('colorize');
    expect(names).not.toContain('resolution');
  });

  it('carries each parameter\'s range and where it is sitting', () => {
    const handles = patchHandles(patch(node('1', 'ComputeGradient', { params: { inputMix: 0.45 } })));
    const mix = handles.nodes[0].params.find((param) => param.name === 'inputMix');
    expect(mix).toMatchObject({ min: 0, max: 1, at: 0.45 });
  });

  it('falls back to the registry default when the patch has not set a value', () => {
    const handles = patchHandles(patch(node('1', 'ComputeGradient')));
    const mix = handles.nodes[0].params.find((param) => param.name === 'inputMix');
    expect(mix.at).toBe(1);
  });

  it('puts the nodes the artist named first', () => {
    const handles = patchHandles(patch(
      node('1', 'ComputeNoise'),
      node('2', 'ComputeGradient', { name: 'ground' })
    ));
    expect(handles.nodes[0].name).toBe('ground');
  });

  it('drops a node with nothing performable on it', () => {
    const handles = patchHandles(patch(node('1', 'OutputFinal'), node('2', 'ComputeNoise')));
    expect(handles.nodes.map((one) => one.name)).toEqual(['ComputeNoise']);
  });

  it('says when two nodes answer to the same handle', () => {
    const handles = patchHandles(patch(node('1', 'ComputeNoise'), node('2', 'ComputeNoise')));
    expect(handles.ambiguous).toContain('computenoise');
  });

  it('caps the list and says how many were left out', () => {
    const many = Array.from({ length: 30 }, (_, i) => node(String(i), 'ComputeNoise', { name: `n${i}` }));
    const handles = patchHandles(patch(...many), { maxNodes: 5 });
    expect(handles.nodes).toHaveLength(5);
    expect(handles.total).toBe(30);
    expect(handlesText(handles)).toContain('25 more nodes');
  });

  // The one that matters: a handle nobody can resolve is worse than no handle.
  it('reports only handles the executor really resolves', () => {
    const nodes = [
      node('1', 'ComputeNoise', { name: 'membrane' }),
      node('2', 'ComputeGradient'),
    ];
    const executor = new ActionExecutor({ editor: { graph: { nodes } } });
    for (const handle of patchHandles({ nodes }).nodes) {
      expect(executor.resolveNode(handle.name)).toBeTruthy();
    }
  });

  it('agrees with the executor about a name that is not there', () => {
    const nodes = [node('1', 'ComputeNoise')];
    const executor = new ActionExecutor({ editor: { graph: { nodes } } });
    expect(executor.resolveNode('ComputeGradient')).toBeFalsy();
    expect(handleFor(nodes[0])).toBe('ComputeNoise');
  });
});

describe('handlesText', () => {
  it('is empty when there is nothing to name', () => {
    expect(handlesText(patchHandles({ nodes: [] }))).toBe('');
  });

  it('writes the name, the kind, the range and the current value', () => {
    const text = handlesText(patchHandles(patch(
      node('1', 'ComputeGradient', { name: 'ground', params: { inputMix: 0.2 } })
    )));
    expect(text).toContain('"ground" (ComputeGradient)');
    expect(text).toContain('inputMix 0..1, now 0.2');
  });
});

describe('deadDrives', () => {
  const graph = patch(node('1', 'ComputeNoise', { name: 'membrane' }));

  it('finds a drive whose node is not in the patch', () => {
    const dead = deadDrives([{ signal: 'level', node: 'ComputeGradient', param: 'brightness' }], graph);
    expect(dead).toHaveLength(1);
    expect(dead[0].why).toBe('no node by that name');
  });

  it('finds a drive whose node is there but whose parameter is not', () => {
    const dead = deadDrives([{ signal: 'low', node: 'membrane', param: 'brightness' }], graph);
    expect(dead[0].why).toContain('has no parameter by that name');
  });

  it('finds a drive that named nothing at all — the empty plan case', () => {
    const dead = deadDrives([{ signal: 'low', node: '', param: '' }], graph);
    expect(dead[0].why).toBe('no node was named');
  });

  it('leaves a drive that resolves alone', () => {
    expect(deadDrives([{ signal: 'low', node: 'membrane', param: 'scale' }], graph)).toEqual([]);
  });

  it('is empty for no drives', () => {
    expect(deadDrives(null, graph)).toEqual([]);
  });
});

describe('a kind the registry does not know', () => {
  it('falls back to the numbers the node is carrying', () => {
    const handles = patchHandles(patch(node('1', 'SomethingNewer', { params: { amount: 0.3, label: 'x' } })));
    expect(handles.nodes[0].params).toEqual([{ name: 'amount', at: 0.3 }]);
  });

  it('is still not a handle when it carries no numbers', () => {
    expect(patchHandles(patch(node('1', 'SomethingNewer', { params: { label: 'x' } }))).nodes).toEqual([]);
  });
});

describe('which parameters get the places', () => {
  // A Gradient's registry order spends its first places on geometry. The two a
  // performer reaches for — brightness and saturation — are near the end, and
  // a set that cannot name them is a set that cannot make the picture brighter.
  it('keeps the parameters a performer reaches for on a crowded node', () => {
    const names = patchHandles(patch(node('1', 'ComputeGradient')))
      .nodes[0].params.map((param) => param.name);
    expect(names).toContain('brightness');
    expect(names).toContain('saturation');
    expect(names).toContain('inputMix');
  });

  it('puts what the patch actually set ahead of what it left alone', () => {
    const names = patchHandles(patch(node('1', 'ComputeFieldMapper', { params: { instanceCount: 400 } })), { maxParams: 2 })
      .nodes[0].params.map((param) => param.name);
    expect(names[0]).toBe('instanceCount');
  });
});
