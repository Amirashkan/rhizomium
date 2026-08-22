// Tests for dragging a node onto a parameter field to insert its `node_<id>` reference —
// the pointer equivalent of typing that identifier into the field by hand.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  NodeReferenceDrop,
  insertNodeReference,
  nodeReferenceToken,
} from '../src/ui/NodeReferenceDrop.js';
import { SelectionManager } from '../src/core/SelectionManager.js';

/**
 * Build a parameter field like the ones ParameterPanel renders, with a fixed screen rect
 * (happy-dom reports 0-sized rects, so the geometry is stubbed).
 */
function makeParamField({
  param = 'radius', type = 'float', nodeId = '2', value = '', rect, expressionCapable = true,
}) {
  const input = document.createElement('textarea');
  // Only the expression text handler marks a field expression-capable; a colour swatch or a file
  // picker is a plain widget, so the flag is what separates the two here as it does in the panel.
  input.className = expressionCapable ? 'param-input expression-capable' : 'param-input';
  input.setAttribute('data-param', param);
  input.setAttribute('data-param-type', type);
  if (nodeId !== null) input.setAttribute('data-node-id', String(nodeId));
  input.value = value;
  input.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
  });
  document.body.appendChild(input);
  return input;
}

describe('insertNodeReference', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('replaces a plain value with an expression referencing the node', () => {
    const input = makeParamField({ value: '0.5', rect: { left: 0, top: 0, width: 100, height: 20 } });
    expect(insertNodeReference(input, 'node_7')).toBe('=node_7');
    expect(input.value).toBe('=node_7');
  });

  it('replaces an empty field with an expression referencing the node', () => {
    const input = makeParamField({ value: '', rect: { left: 0, top: 0, width: 100, height: 20 } });
    expect(insertNodeReference(input, 'node_7')).toBe('=node_7');
  });

  it('replaces an existing expression rather than appending to it', () => {
    const input = makeParamField({ value: '=sin(time) * 2', rect: { left: 0, top: 0, width: 100, height: 20 } });
    expect(insertNodeReference(input, 'node_7')).toBe('=node_7');
    expect(input.value).toBe('=node_7');
  });

  it('replaces the whole expression even when the field is focused with a caret in it', () => {
    const input = makeParamField({ value: '=1 + 2 * 2', rect: { left: 0, top: 0, width: 100, height: 20 } });
    input.focus();
    input.setSelectionRange(5, 5);
    expect(insertNodeReference(input, 'node_7')).toBe('=node_7');
  });

  it('focuses the field before writing, so the handler keeps the old value as its commit baseline', () => {
    // ExpressionTextInputHandler snapshots the field on focus and skips committing a value
    // equal to that snapshot — focusing after the write would suppress the commit entirely.
    const input = makeParamField({ value: '1', rect: { left: 0, top: 0, width: 100, height: 20 } });
    let valueAtFocus = null;
    input.addEventListener('focus', () => { valueAtFocus = input.value; });

    insertNodeReference(input, 'node_7');

    expect(valueAtFocus).toBe('1');
    expect(input.value).toBe('=node_7');
  });

  it('notifies the input handlers so the new value is validated and committed', () => {
    const input = makeParamField({ value: '1', rect: { left: 0, top: 0, width: 100, height: 20 } });
    const events = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    insertNodeReference(input, 'node_7');
    expect(events).toEqual(['input', 'change']);
  });
});

describe('NodeReferenceDrop', () => {
  let controller;

  beforeEach(() => {
    controller = new NodeReferenceDrop();
  });

  afterEach(() => {
    controller.cleanup();
    document.body.innerHTML = '';
  });

  it('drops a reference on the field under the pointer', () => {
    const input = makeParamField({ rect: { left: 100, top: 50, width: 200, height: 24 } });

    controller.begin({ id: 7 });
    expect(controller.isActive()).toBe(true);
    expect(controller.update(150, 60)).toBe(true);
    expect(controller.finish(150, 60)).toBe(true);

    expect(input.value).toBe('=node_7');
  });

  it('reports the drop so the caller can surface it', () => {
    makeParamField({ param: 'radius', rect: { left: 100, top: 50, width: 200, height: 24 } });
    const onDrop = vi.fn();
    const c = new NodeReferenceDrop({ onDrop });

    c.begin({ id: 7 });
    c.finish(150, 60);

    expect(onDrop).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'node_7', paramName: 'radius', targetNodeId: '2' }),
    );
  });

  it('does nothing when released away from any field', () => {
    const input = makeParamField({ value: '3', rect: { left: 100, top: 50, width: 200, height: 24 } });

    controller.begin({ id: 7 });
    expect(controller.update(600, 600)).toBe(false);
    expect(controller.finish(600, 600)).toBe(false);

    expect(input.value).toBe('3');
  });

  it('highlights only the field under the pointer', () => {
    const a = makeParamField({ param: 'a', rect: { left: 0, top: 0, width: 100, height: 20 } });
    const b = makeParamField({ param: 'b', rect: { left: 0, top: 40, width: 100, height: 20 } });

    controller.begin({ id: 7 });

    controller.update(50, 10);
    expect(a.classList.contains('node-ref-drop-target')).toBe(true);
    expect(b.classList.contains('node-ref-drop-target')).toBe(false);

    controller.update(50, 45);
    expect(a.classList.contains('node-ref-drop-target')).toBe(false);
    expect(b.classList.contains('node-ref-drop-target')).toBe(true);

    controller.update(500, 500);
    expect(b.classList.contains('node-ref-drop-target')).toBe(false);
  });

  it('skips the dragged node\'s own parameters (a self-reference cannot resolve)', () => {
    const own = makeParamField({ nodeId: '7', rect: { left: 100, top: 50, width: 200, height: 24 } });

    controller.begin({ id: 7 });
    expect(controller.isActive()).toBe(false);
    expect(controller.finish(150, 60)).toBe(false);
    expect(own.value).toBe('');
  });

  it('skips parameter types that are not expression-evaluated', () => {
    const color = makeParamField({
      type: 'color', expressionCapable: false, rect: { left: 100, top: 50, width: 200, height: 24 },
    });

    controller.begin({ id: 7 });
    expect(controller.finish(150, 60)).toBe(false);
    expect(color.value).toBe('');
  });

  it('accepts a dropdown or toggle switched into fx mode', () => {
    // In fx mode the widget IS an expression textarea, so the drop gesture has to reach it — the
    // declared type is still 'select'/'boolean', which the type list deliberately excludes.
    const mode = makeParamField({
      param: 'sizeMode', type: 'select', rect: { left: 100, top: 50, width: 200, height: 24 },
    });

    controller.begin({ id: 7 });
    expect(controller.finish(150, 60)).toBe(true);
    expect(mode.value).toBe('=node_7');
  });

  it('still skips the dropdown WIDGET, which has nowhere to put a reference', () => {
    const select = document.createElement('select');
    select.className = 'param-select';
    select.setAttribute('data-param', 'sizeMode');
    select.setAttribute('data-param-type', 'select');
    select.getBoundingClientRect = () => ({ left: 100, top: 50, right: 300, bottom: 74, width: 200, height: 24 });
    document.body.appendChild(select);

    controller.begin({ id: 7 });
    expect(controller.isActive()).toBe(false);
  });

  it('skips fields that are disabled or not on screen', () => {
    const disabled = makeParamField({ param: 'a', rect: { left: 0, top: 0, width: 100, height: 20 } });
    disabled.disabled = true;
    makeParamField({ param: 'b', rect: { left: 0, top: 0, width: 0, height: 0 } });

    controller.begin({ id: 7 });
    expect(controller.isActive()).toBe(false);
  });

  it('clears highlight and badge once the gesture ends', () => {
    const input = makeParamField({ rect: { left: 100, top: 50, width: 200, height: 24 } });

    controller.begin({ id: 7 });
    controller.update(150, 60);
    expect(document.querySelector('.node-ref-drop-badge')).not.toBeNull();

    controller.finish(150, 60);
    expect(input.classList.contains('node-ref-drop-target')).toBe(false);
    expect(document.querySelector('.node-ref-drop-badge')).toBeNull();
    expect(controller.isActive()).toBe(false);
  });

  it('builds the identifier the expression system resolves', () => {
    expect(nodeReferenceToken(12)).toBe('node_12');
  });
});

describe('SelectionManager.cancelDrag', () => {
  it('restores dragged node positions and records nothing for undo', () => {
    const node = { id: 'a', x: 10, y: 20 };
    const graph = { nodes: [node], connections: [], selection: new Set() };
    const undoManager = { recordNodeMovement: vi.fn() };
    const selection = new SelectionManager(graph, () => {});
    selection.setUndoManager(undoManager);

    selection.startDrag('a', 0, 0);
    selection.updateDrag(100, 100);
    expect(node.x).not.toBe(10);

    selection.cancelDrag();

    expect(node).toMatchObject({ x: 10, y: 20 });
    expect(selection.getDragging()).toBeNull();
    expect(undoManager.recordNodeMovement).not.toHaveBeenCalled();
  });
});
