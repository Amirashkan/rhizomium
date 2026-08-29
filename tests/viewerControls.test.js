// The document behind "which knobs does this patch hand a visitor".
//
// Everything here is the part that runs without a GPU: what may be offered,
// what a saved control means when the graph has moved on under it, and the
// clamping that stands between a visitor's input and node.params.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ViewerControlsModel,
  MAX_VIEWER_CONTROLS,
  coerceControlValue,
  controlKindFor,
  currentValue,
  defaultStep,
  exposableParameters,
  makeViewerControl,
  resolveViewerControls,
} from '../src/viewer/ViewerControls.js';
import { makeNode } from '../src/data/NodeDefs.js';

/** A node kind with a float, a select and a boolean between them. */
function gradientNode() {
  const node = makeNode('ComputeGradient', 0, 0);
  node.id = '7';
  return node;
}

describe('controlKindFor', () => {
  it('gives numbers a slider and switches a toggle', () => {
    expect(controlKindFor({ type: 'float' })).toBe('slider');
    expect(controlKindFor({ type: 'f32' })).toBe('slider');
    expect(controlKindFor({ type: 'int' })).toBe('slider');
    expect(controlKindFor({ type: 'bool' })).toBe('toggle');
    expect(controlKindFor({ type: 'boolean' })).toBe('toggle');
  });

  it('gives a select with real options a menu, and one without nothing', () => {
    expect(controlKindFor({ type: 'select', options: ['A', 'B'] })).toBe('choice');
    expect(controlKindFor({ type: 'select', options: ['A'] })).toBe(null);
    expect(controlKindFor({ type: 'select' })).toBe(null);
  });

  it('refuses the authoring surfaces a visitor has no business holding', () => {
    for (const type of ['color', 'colorstops', 'file', 'font', 'glsl', 'text', 'button']) {
      expect(controlKindFor({ type })).toBe(null);
    }
  });
});

describe('exposableParameters', () => {
  it('lists a real node kind’s offerable parameters, and no others', () => {
    const params = exposableParameters(gradientNode());
    const names = params.map((p) => p.name);

    expect(names).toContain('radius');
    expect(names).toContain('reverse');
    expect(names).toContain('colorMode');
    // Colour stops are an editor surface, not a knob.
    expect(names).not.toContain('colorStops');
  });

  it('says nothing about a node kind it does not know', () => {
    expect(exposableParameters({ kind: 'NotANode' })).toEqual([]);
    expect(exposableParameters(null)).toEqual([]);
  });
});

describe('makeViewerControl', () => {
  it('fills a slider in from the parameter definition', () => {
    const control = makeViewerControl(
      { nodeId: 4, param: 'radius' },
      { name: 'radius', type: 'float', min: 0, max: 2, default: 0.5 },
    );
    expect(control).toMatchObject({ nodeId: '4', param: 'radius', kind: 'slider', min: 0, max: 2 });
    expect(control.step).toBeGreaterThan(0);
  });

  it('refuses a record that names no parameter', () => {
    expect(makeViewerControl({ nodeId: 4 })).toBe(null);
    expect(makeViewerControl({ param: 'radius' })).toBe(null);
    expect(makeViewerControl({})).toBe(null);
  });

  it('widens a zero-width range rather than shipping a dead slider', () => {
    const control = makeViewerControl({ nodeId: '1', param: 'x', min: 3, max: 3 });
    expect(control.min).toBe(3);
    expect(control.max).toBe(4);
  });

  it('puts a back-to-front range the right way round', () => {
    const control = makeViewerControl({ nodeId: '1', param: 'x', min: 9, max: 2 });
    expect(control).toMatchObject({ min: 2, max: 9 });
  });

  it('flattens a label rather than letting a newline into the panel', () => {
    const control = makeViewerControl({ nodeId: '1', param: 'x', label: 'a\nb   c' });
    expect(control.label).toBe('a b c');
  });
});

describe('defaultStep', () => {
  it('steps an integer by one', () => {
    expect(defaultStep({ type: 'int' }, 0, 20)).toBe(1);
  });

  it('scales to the span for everything else', () => {
    expect(defaultStep({ type: 'float' }, 0, 1)).toBeCloseTo(0.001);
    expect(defaultStep({ type: 'float' }, 0, 2)).toBeCloseTo(0.01);
    expect(defaultStep({ type: 'float' }, 0, 360)).toBeCloseTo(1);
  });

  it('takes the definition’s own step when it has one', () => {
    expect(defaultStep({ type: 'float', step: 0.25 }, 0, 1)).toBe(0.25);
  });
});

describe('ViewerControlsModel', () => {
  let model;
  let node;

  beforeEach(() => {
    model = new ViewerControlsModel();
    node = gradientNode();
  });

  it('offers a parameter and names it after the node', () => {
    const result = model.add(node, 'radius');
    expect(result.ok).toBe(true);
    expect(result.control.label).toMatch(/Radius/);
    expect(model.count).toBe(1);
    expect(model.has('7', 'radius')).toBe(true);
  });

  it('refuses a parameter the node does not have', () => {
    const result = model.add(node, 'nonesuch');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no such parameter/i);
  });

  it('refuses a parameter a formula owns', () => {
    node.params.radius = '=sin(time)';
    const result = model.add(node, 'radius');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/formula/i);
    expect(model.count).toBe(0);
  });

  it('refuses the same parameter twice', () => {
    model.add(node, 'radius');
    expect(model.add(node, 'radius').ok).toBe(false);
  });

  it('stops at the panel’s limit', () => {
    const second = gradientNode();
    second.id = '8';
    const params = exposableParameters(node).map((p) => p.name);
    expect(params.length * 2).toBeGreaterThan(MAX_VIEWER_CONTROLS);

    for (const param of params) model.add(node, param);
    for (const param of params) model.add(second, param);

    expect(model.count).toBe(MAX_VIEWER_CONTROLS);
    expect(model.add(second, params[0]).reason).toMatch(/at most/i);
  });

  it('notifies once per change, and not at all for a no-op', () => {
    let calls = 0;
    model.onChange(() => calls++);

    model.add(node, 'radius');
    expect(calls).toBe(1);

    model.update('7', 'radius', { min: 0.25 });
    expect(calls).toBe(2);

    model.update('7', 'radius', { min: 0.25 });
    expect(calls).toBe(2);

    model.remove('7', 'radius');
    expect(calls).toBe(3);
  });

  it('edits the presentation but never the parameter a control names', () => {
    model.add(node, 'radius');
    const updated = model.update('7', 'radius', {
      label: 'Bloom size',
      min: 0.1,
      max: 0.9,
      step: 0.05,
      param: 'angle',
      nodeId: '99',
    });
    expect(updated).toMatchObject({
      nodeId: '7',
      param: 'radius',
      label: 'Bloom size',
      min: 0.1,
      max: 0.9,
      step: 0.05,
    });
  });

  it('reorders, because the order is the order a visitor meets them in', () => {
    model.add(node, 'radius');
    model.add(node, 'angle');
    expect(model.list().map((c) => c.param)).toEqual(['radius', 'angle']);

    expect(model.move('7', 'angle', -1)).toBe(true);
    expect(model.list().map((c) => c.param)).toEqual(['angle', 'radius']);

    // Off either end is a no-op, not a wrap.
    expect(model.move('7', 'angle', -1)).toBe(false);
    expect(model.move('7', 'radius', 1)).toBe(false);
  });

  it('leaves a deleted node’s control out of the file without dropping it', () => {
    model.add(node, 'radius');
    // The node is gone from the graph, but the delete may be one Ctrl+Z away.
    expect(model.serialize([])).toBe(null);
    expect(model.count).toBe(1);
    expect(model.serialize([node])).toHaveLength(1);
  });

  it('writes nothing at all for a patch that offers nothing', () => {
    expect(model.serialize()).toBe(null);
  });

  it('round-trips through the project file', () => {
    model.add(node, 'radius', { label: 'Size', min: 0.2, max: 0.8 });
    model.add(node, 'reverse');
    const data = model.serialize();

    const loaded = new ViewerControlsModel();
    loaded.deserialize(data);
    expect(loaded.list()).toEqual(model.list());
  });

  it('drops junk and duplicates out of a hand-edited file', () => {
    const loaded = new ViewerControlsModel();
    loaded.deserialize([
      { nodeId: '7', param: 'radius' },
      { nodeId: '7', param: 'radius' }, // duplicate
      { nodeId: '7' }, // no parameter
      null,
      'nonsense',
    ]);
    expect(loaded.count).toBe(1);
  });

  it('prunes controls whose node has gone', () => {
    model.add(node, 'radius');
    expect(model.prune([node])).toBe(0);
    expect(model.prune([])).toBe(1);
    expect(model.count).toBe(0);
  });

  it('drops every control a node offered when the node goes', () => {
    model.add(node, 'radius');
    model.add(node, 'angle');
    expect(model.removeNode('7')).toBe(true);
    expect(model.count).toBe(0);
  });
});

describe('resolveViewerControls', () => {
  let node;
  beforeEach(() => {
    node = gradientNode();
  });

  it('resolves a saved control against the graph, with its current value', () => {
    node.params.radius = 0.4;
    const resolved = resolveViewerControls([{ nodeId: '7', param: 'radius' }], [node]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].value).toBe(0.4);
    expect(resolved[0].authored).toBe(0.4);
    expect(resolved[0].node).toBe(node);
  });

  it('drops a control whose node is not in the patch', () => {
    expect(resolveViewerControls([{ nodeId: '404', param: 'radius' }], [node])).toEqual([]);
  });

  it('drops a control naming a parameter the node kind does not have', () => {
    expect(resolveViewerControls([{ nodeId: '7', param: 'nonesuch' }], [node])).toEqual([]);
  });

  it('drops a control whose parameter has since become a formula', () => {
    node.params.radius = '=sin(time)';
    expect(resolveViewerControls([{ nodeId: '7', param: 'radius' }], [node])).toEqual([]);
  });

  it('drops a control whose presentation no longer matches the parameter', () => {
    // Saved as a slider; `colorMode` is a select.
    const resolved = resolveViewerControls(
      [{ nodeId: '7', param: 'colorMode', kind: 'slider' }],
      [node],
    );
    expect(resolved).toEqual([]);
  });

  it('takes a choice’s options from the node definition, not the file', () => {
    const resolved = resolveViewerControls(
      [{ nodeId: '7', param: 'colorMode', kind: 'choice', options: ['Hacked'] }],
      [node],
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].control.options).not.toContain('Hacked');
    expect(resolved[0].control.options).toContain('Grayscale');
  });

  it('honours the panel’s limit on a file that ignores it', () => {
    const second = gradientNode();
    second.id = '8';
    const names = exposableParameters(node).map((p) => p.name);
    const saved = [
      ...names.map((param) => ({ nodeId: '7', param })),
      ...names.map((param) => ({ nodeId: '8', param })),
    ];
    expect(saved.length).toBeGreaterThan(MAX_VIEWER_CONTROLS);
    expect(resolveViewerControls(saved, [node, second])).toHaveLength(MAX_VIEWER_CONTROLS);
  });

  it('shows nothing for a patch with no controls in it', () => {
    expect(resolveViewerControls(undefined, [node])).toEqual([]);
    expect(resolveViewerControls(null, [node])).toEqual([]);
    expect(resolveViewerControls([], [node])).toEqual([]);
  });
});

describe('currentValue and coerceControlValue', () => {
  it('reads the authored value even when it sits outside the offered range', () => {
    const node = gradientNode();
    node.params.radius = 5;
    const control = makeViewerControl({ nodeId: '7', param: 'radius', min: 0, max: 1 });
    expect(currentValue(node, control, { type: 'float', default: 0.5 })).toBe(5);
  });

  it('clamps what a visitor produces to the offered range', () => {
    const control = makeViewerControl({ nodeId: '7', param: 'radius', min: 0.2, max: 0.8 });
    expect(coerceControlValue(control, 9)).toBe(0.8);
    expect(coerceControlValue(control, -9)).toBe(0.2);
    expect(coerceControlValue(control, 0.5)).toBe(0.5);
    expect(coerceControlValue(control, 'not a number')).toBe(0.2);
  });

  it('reduces a toggle to a boolean whatever the input said', () => {
    const control = makeViewerControl({ nodeId: '7', param: 'reverse', kind: 'toggle' });
    expect(coerceControlValue(control, true)).toBe(true);
    expect(coerceControlValue(control, 'true')).toBe(true);
    expect(coerceControlValue(control, false)).toBe(false);
    expect(coerceControlValue(control, 'anything else')).toBe(false);
  });

  it('holds a choice to the options the node actually has', () => {
    const control = makeViewerControl(
      { nodeId: '7', param: 'colorMode', kind: 'choice' },
      { type: 'select', options: ['Grayscale', 'Rainbow'] },
    );
    expect(coerceControlValue(control, 'Rainbow')).toBe('Rainbow');
    expect(coerceControlValue(control, 'Hacked')).toBe('Grayscale');
  });
});
