// Feature test: "Reset Parameters to Default" in the node context menu.
//
// Editor.resetNodeParameters(ids) puts every parameter of the given nodes (the live selection by
// default) back to the value makeNode would have seeded, leaving wiring, position and preview
// state alone. The whole gesture is one undo step, and the menu only offers it when a node
// actually holds a non-default value.

import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '../src/core/Editor.js';
import { MenuManager } from '../src/ui/MenuManager.js';
import { makeNode, defaultParameterValues } from '../src/data/NodeDefs.js';

// Build a bare Editor without running its DOM/GPU constructor, wiring only the state the reset
// path touches.
function makeEditor(nodes, selectedIds, undoManager = null) {
  const ed = Object.create(Editor.prototype);
  ed.graph = { nodes, selection: new Set(selectedIds), connections: [] };
  ed.undoManager = undoManager;
  ed.changes = [];
  ed.onChange = (reason) => ed.changes.push(reason);
  ed.triggerShaderRebuild = () => { ed._rebuilds = (ed._rebuilds || 0) + 1; };
  ed.safeDraw = () => { ed._drawn = (ed._drawn || 0) + 1; };
  ed.previewIntegration = { onParameterChange: (node) => { node.__previewRefreshed = true; } };
  ed.events = [];
  ed.eventSystem = { emit: (type, data) => ed.events.push({ type, data }) };
  return ed;
}

// Minimal stand-in for UndoManager: the reset pushes a custom action whose undo/redo callbacks the
// real manager invokes from its default switch branch.
function makeUndoManager() {
  const stack = [];
  return {
    stack,
    pushAction: (action) => stack.push(action),
    undoLast: () => stack.pop().undo(),
  };
}

describe('resetting a node\'s parameters to their defaults', () => {
  let circle;
  let ed;

  beforeEach(() => {
    circle = makeNode('Circle', 100, 200);
    ed = makeEditor([circle], [circle.id]);
  });

  it('restores every edited parameter to the node definition default', () => {
    const defaults = defaultParameterValues('Circle');
    circle.params.radius = 0.9;
    circle.params.centerX = 0.1;
    circle.params.invert = true;

    expect(ed.resetNodeParameters()).toBe(1);

    expect(circle.params.radius).toBe(defaults.radius);
    expect(circle.params.centerX).toBe(defaults.centerX);
    expect(circle.params.invert).toBe(defaults.invert);
  });

  it('writes the default into props too, so stale copies cannot outlive the reset', () => {
    circle.params.radius = 0.9;
    circle.props.radius = 0.9;

    ed.resetNodeParameters();

    expect(circle.props.radius).toBe(defaultParameterValues('Circle').radius);
  });

  it('resets the value/expr fields that mirror params, not just node.params', () => {
    const constFloat = makeNode('ConstFloat', 0, 0);
    const defaults = defaultParameterValues('ConstFloat');
    constFloat.value = 42;
    constFloat.params.value = 42;
    const editor = makeEditor([constFloat], [constFloat.id]);

    editor.resetNodeParameters();

    expect(constFloat.value).toBe(defaults.value);
    expect(constFloat.params.value).toBe(defaults.value);
  });

  it('leaves position, size, wiring and bypass state untouched', () => {
    circle.params.radius = 0.9;
    circle.bypassed = true;
    circle.inputs = ['7'];

    ed.resetNodeParameters();

    expect(circle.x).toBe(100);
    expect(circle.y).toBe(200);
    expect(circle.w).toBe(180);
    expect(circle.bypassed).toBe(true);
    expect(circle.inputs).toEqual(['7']);
  });

  it('resets every selected node and reports how many changed', () => {
    const other = makeNode('Circle', 0, 0);
    const untouched = makeNode('Circle', 0, 0);
    circle.params.radius = 0.9;
    other.params.radius = 0.1;
    const editor = makeEditor(
      [circle, other, untouched],
      [circle.id, other.id, untouched.id],
    );

    // Only the two edited nodes count as changed; the pristine one is skipped.
    expect(editor.resetNodeParameters()).toBe(2);
    expect(circle.params.radius).toBe(other.params.radius);
  });

  it('ignores nodes outside the given id set', () => {
    const other = makeNode('Circle', 0, 0);
    other.params.radius = 0.42;
    const editor = makeEditor([circle, other], [circle.id, other.id]);
    circle.params.radius = 0.9;

    editor.resetNodeParameters(new Set([circle.id]));

    expect(other.params.radius).toBe(0.42);
  });

  it('is a no-op on a node already at its defaults', () => {
    expect(ed.resetNodeParameters()).toBe(0);
    expect(ed.changes).toEqual([]);
  });

  it('is a no-op with an empty or missing selection', () => {
    ed.graph.selection = new Set();
    expect(ed.resetNodeParameters()).toBe(0);
    expect(ed.resetNodeParameters(null)).toBe(0);
  });

  it('refreshes previews, recompiles and redraws once for the batch', () => {
    circle.params.radius = 0.9;

    ed.resetNodeParameters();

    expect(circle.__previewRefreshed).toBe(true);
    expect(ed.changes).toEqual(['Reset Parameters']);
    expect(ed._rebuilds).toBe(1);
    expect(ed._drawn).toBe(1);
  });

  it('announces each reset parameter so bound parameters and the panel follow', () => {
    circle.params.radius = 0.9;

    ed.resetNodeParameters();

    const changed = ed.events.filter((e) => e.type === 'PARAMETER_CHANGED');
    expect(changed).toHaveLength(1);
    expect(changed[0].data).toMatchObject({
      parameterName: 'radius',
      oldValue: 0.9,
      newValue: defaultParameterValues('Circle').radius,
      source: 'reset',
    });
  });

  it('re-renders the parameter panel when it is showing a reset node', () => {
    let rendered = null;
    ed.paramPanel = {
      selectedNode: circle,
      renderParameters: (node) => { rendered = node; },
    };
    circle.params.radius = 0.9;

    ed.resetNodeParameters();

    expect(rendered).toBe(circle);
  });
});

describe('undoing a parameter reset', () => {
  it('restores the previous values in a single undo step', () => {
    const circle = makeNode('Circle', 0, 0);
    const undoManager = makeUndoManager();
    const ed = makeEditor([circle], [circle.id], undoManager);

    circle.params.radius = 0.9;
    circle.params.centerX = 0.1;
    ed.resetNodeParameters();

    expect(undoManager.stack).toHaveLength(1);
    undoManager.undoLast();

    expect(circle.params.radius).toBe(0.9);
    expect(circle.params.centerX).toBe(0.1);
  });

  it('redo puts the defaults back', () => {
    const circle = makeNode('Circle', 0, 0);
    const undoManager = makeUndoManager();
    const ed = makeEditor([circle], [circle.id], undoManager);

    circle.params.radius = 0.9;
    ed.resetNodeParameters();

    const action = undoManager.stack[0];
    action.undo();
    action.redo();

    expect(circle.params.radius).toBe(defaultParameterValues('Circle').radius);
  });

  it('drops fields the reset introduced instead of leaving them undefined', () => {
    // A node saved before a parameter existed has no stored value for it at all; undo has to take
    // the node back to that state rather than leaving `value: undefined` behind.
    const constFloat = makeNode('ConstFloat', 0, 0);
    delete constFloat.value;
    delete constFloat.params.value;
    const undoManager = makeUndoManager();
    const ed = makeEditor([constFloat], [constFloat.id], undoManager);

    ed.resetNodeParameters();
    expect(constFloat.value).toBe(defaultParameterValues('ConstFloat').value);

    undoManager.undoLast();
    expect('value' in constFloat).toBe(false);
    expect('value' in constFloat.params).toBe(false);
  });
});

describe('the node menu entry', () => {
  function showMenu(nodes, selectedIds, editor) {
    const graph = { nodes, selection: new Set(selectedIds), connections: [] };
    const menu = new MenuManager(graph, () => {});
    const previous = window.editor;
    window.editor = editor;
    try {
      menu.showNodeMenu(nodes[0], 10, 10);
      return Array.from(menu.menuEl.querySelectorAll('.ctx-item')).map((el) => el.textContent);
    } finally {
      window.editor = previous;
      menu.hide();
    }
  }

  it('offers the reset when a node holds a non-default value', () => {
    const circle = makeNode('Circle', 0, 0);
    circle.params.radius = 0.9;
    const ed = makeEditor([circle], [circle.id]);

    expect(showMenu([circle], [circle.id], ed)).toContain('Reset Parameters to Default');
  });

  it('hides the reset on a node that is already at its defaults', () => {
    const circle = makeNode('Circle', 0, 0);
    const ed = makeEditor([circle], [circle.id]);

    const items = showMenu([circle], [circle.id], ed);
    expect(items.some((label) => label.startsWith('Reset Parameters'))).toBe(false);
  });

  it('counts the nodes a multi-selection would reset', () => {
    const a = makeNode('Circle', 0, 0);
    const b = makeNode('Circle', 0, 0);
    const pristine = makeNode('Circle', 0, 0);
    a.params.radius = 0.9;
    b.params.radius = 0.1;
    const ed = makeEditor([a, b, pristine], [a.id, b.id, pristine.id]);

    expect(showMenu([a, b, pristine], [a.id, b.id, pristine.id], ed))
      .toContain('Reset Parameters to Default (2)');
  });

  it('resets the whole selection when the entry is clicked', () => {
    const a = makeNode('Circle', 0, 0);
    const b = makeNode('Circle', 0, 0);
    a.params.radius = 0.9;
    b.params.radius = 0.1;
    const graph = { nodes: [a, b], selection: new Set([a.id, b.id]), connections: [] };
    const ed = makeEditor(graph.nodes, [a.id, b.id]);
    ed.graph = graph;

    const menu = new MenuManager(graph, () => {});
    const previous = window.editor;
    window.editor = ed;
    try {
      menu.showNodeMenu(a, 10, 10);
      const item = Array.from(menu.menuEl.querySelectorAll('.ctx-item'))
        .find((el) => el.textContent.startsWith('Reset Parameters'));
      item.click();
    } finally {
      window.editor = previous;
      menu.hide();
    }

    const radius = defaultParameterValues('Circle').radius;
    expect(a.params.radius).toBe(radius);
    expect(b.params.radius).toBe(radius);
  });
});
