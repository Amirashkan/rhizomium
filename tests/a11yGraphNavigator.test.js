// The patch canvas from the keyboard: the outline tree inside the canvas, and every edit it can
// make — driven with real key events against the real ConnectionManager and SelectionManager.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GraphNavigator, parseItemKey } from '../src/accessibility/GraphNavigator.js';
import { A11ySettings } from '../src/accessibility/a11ySettings.js';
import { ConnectionManager } from '../src/core/ConnectionManager.js';
import { SelectionManager } from '../src/core/SelectionManager.js';
import { makeNode } from '../src/data/NodeDefs.js';

/**
 * Time → Add.A → Output, with a Sin off to the side below. In signal order the unwired Sin comes
 * after Add: both are ready once Time is placed, and position breaks the tie (same column, Add is
 * higher up).
 */
function buildPatch() {
  const time = makeNode('Time', 0, 0);
  const add = makeNode('Add', 300, 0);
  const out = makeNode('OutputFinal', 600, 0);
  const sin = makeNode('Sin', 300, 300);
  const graph = {
    nodes: [time, add, out, sin],
    connections: [],
    selection: new Set(),
  };
  const connect = (from, to, pin) => {
    graph.connections.push({ from: { nodeId: from.id, pin: 0 }, to: { nodeId: to.id, pin } });
    to.inputs[pin] = from.id;
  };
  connect(time, add, 0);
  connect(add, out, 0);
  return { graph, time, add, out, sin };
}

function makeEditor(graph) {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const onChange = vi.fn();
  const editor = {
    graph,
    canvas,
    onChange,
    connections: new ConnectionManager(graph, onChange),
    selection: new SelectionManager(graph, onChange),
    viewport: {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      setViewport: vi.fn(),
      canvasToScreen: (x, y) => ({ x, y }),
      screenToCanvas: (x, y) => ({ x, y }),
    },
    markDirty: vi.fn(),
    draw: vi.fn(),
    invalidateNodes: vi.fn(),
    undoManager: {
      recordNodeMovement: vi.fn(),
      beginTransaction: vi.fn(),
      commitTransaction: vi.fn(),
    },
    paramPanel: { showNodeParameters: vi.fn(), panel: { style: { display: 'none' } } },
    menu: { showCreateMenu: vi.fn(), isAddMenuOpen: () => false, showNodeMenu: vi.fn(), menuEl: null },
    toggleNodeBypass: vi.fn((id) => {
      const node = graph.nodes.find((n) => n.id === id);
      if (node && node.kind !== 'OutputFinal') node.bypassed = !node.bypassed;
    }),
    isSnapEnabled: () => false,
    selectAll: () => {
      graph.selection = new Set(graph.nodes.map((n) => n.id));
    },
  };
  editor.selection.setUndoManager(editor.undoManager);
  return editor;
}

function press(key, init = {}) {
  const target = document.activeElement || document.body;
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const activeKey = () => document.activeElement?.dataset?.key;

describe('GraphNavigator', () => {
  let patch;
  let editor;
  let navigator;
  let said;

  beforeEach(() => {
    document.body.innerHTML = '';
    patch = buildPatch();
    editor = makeEditor(patch.graph);
    said = [];
    navigator = new GraphNavigator({
      editor,
      settings: new A11ySettings({ storage: null, matchMedia: () => null }),
      announce: (message) => said.push(message),
    }).install();
  });

  afterEach(() => {
    navigator.dispose();
    document.body.innerHTML = '';
  });

  it('builds an ARIA tree inside the canvas, nodes in signal order', () => {
    const tree = editor.canvas.querySelector('[role="tree"]');
    expect(tree).toBeTruthy();
    expect(tree.getAttribute('aria-multiselectable')).toBe('true');

    const items = [...tree.querySelectorAll('[role="treeitem"]')];
    expect(items.map((el) => parseItemKey(el.dataset.key).nodeId)).toEqual([
      patch.time.id,
      patch.add.id,
      patch.sin.id,
      patch.out.id,
    ]);
    expect(items[1].textContent).toBe(`Add #${patch.add.id}, Math node`);
    expect(items[1].getAttribute('aria-level')).toBe('1');
    expect(items[1].getAttribute('aria-posinset')).toBe('2');
    expect(items[1].getAttribute('aria-setsize')).toBe('4');
    expect(items[1].getAttribute('aria-expanded')).toBe('false');
    expect(items[1].getAttribute('aria-description')).toContain(`from Time #${patch.time.id}`);
    // One stop in the tab order.
    expect(items.filter((el) => el.tabIndex === 0)).toHaveLength(1);
  });

  it('walks the nodes with the arrows and selection follows', () => {
    navigator.focus();
    expect(activeKey()).toBe(`node:${patch.time.id}`);

    press('ArrowDown');
    expect(activeKey()).toBe(`node:${patch.add.id}`);
    expect([...patch.graph.selection]).toEqual([patch.add.id]);
    expect(document.activeElement.getAttribute('aria-selected')).toBe('true');

    press('End');
    expect(activeKey()).toBe(`node:${patch.out.id}`);
    press('Home');
    expect(activeKey()).toBe(`node:${patch.time.id}`);

    // Ctrl+arrow moves without changing the selection.
    press('ArrowDown', { ctrlKey: true });
    expect(activeKey()).toBe(`node:${patch.add.id}`);
    expect([...patch.graph.selection]).toEqual([patch.time.id]);
  });

  it('opens a node onto its ports and parameters, and closes it again', () => {
    navigator.focusNode(patch.add.id);
    press('ArrowRight');
    const children = [...editor.canvas.querySelectorAll('[aria-level="2"]')].map((el) => el.textContent);
    expect(children).toEqual([
      `Input A, from Time #${patch.time.id} output t`,
      'Input B, not connected',
      `Output out, feeds Output #${patch.out.id} input color`,
      'Parameters, 2',
    ]);

    press('ArrowRight');
    expect(activeKey()).toBe(`in:${patch.add.id}:0`);
    press('ArrowLeft');
    expect(activeKey()).toBe(`node:${patch.add.id}`);
    press('ArrowLeft');
    expect(editor.canvas.querySelectorAll('[aria-level="2"]')).toHaveLength(0);
  });

  it('follows a wire upstream with Enter', () => {
    navigator.focusItem(`in:${patch.add.id}:0`);
    press('Enter');
    expect(activeKey()).toBe(`out:${patch.time.id}:0`);
  });

  it('connects with C on one end and C on the other, through ConnectionManager', () => {
    navigator.focusItem(`out:${patch.time.id}:0`);
    press('c');
    expect(said.at(-1)).toMatch(/^Connecting from Time #\d+, output t/);
    expect(navigator.renderFocus().connectFrom).toEqual({ nodeId: patch.time.id, part: 'output', pin: 0 });

    navigator.focusItem(`in:${patch.add.id}:1`);
    press('c');

    expect(patch.add.inputs[1]).toBe(patch.time.id);
    expect(patch.graph.connections).toContainEqual({
      from: { nodeId: patch.time.id, pin: 0 },
      to: { nodeId: patch.add.id, pin: 1 },
    });
    expect(said.at(-1)).toBe(`Connected Time #${patch.time.id} t to Add #${patch.add.id} input B.`);
    expect(editor.onChange).toHaveBeenCalled();
    expect(activeKey()).toBe(`in:${patch.add.id}:1`);
  });

  it('completes a connection on a node by picking its first free input', () => {
    navigator.focusItem(`out:${patch.time.id}:0`);
    press('c');
    navigator.focusNode(patch.sin.id);
    press('c');
    expect(patch.sin.inputs[0]).toBe(patch.time.id);
  });

  it('refuses to wire a node into itself, and Escape cancels a connection', () => {
    navigator.focusItem(`out:${patch.add.id}:0`);
    press('c');
    navigator.focusItem(`in:${patch.add.id}:1`);
    press('c');
    expect(patch.add.inputs[1]).toBeNull();
    expect(said.at(-1)).toMatch(/another node/);

    press('Escape');
    expect(said.at(-1)).toBe('Connection cancelled.');
    expect(navigator.renderFocus().connectFrom).toBeNull();
  });

  it('keeps a connection in progress across a trip out of the outline (Go to Node)', () => {
    navigator.focusItem(`out:${patch.time.id}:0`);
    press('c');
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus(); // the Go to Node dialog's field, say
    expect(navigator.hasFocus()).toBe(false);

    navigator.focusNode(patch.sin.id);
    expect(said.at(-1)).toMatch(/^Still connecting from Time #/);
    press('c');
    expect(patch.sin.inputs[0]).toBe(patch.time.id);
  });

  it('disconnects the focused input with X', () => {
    navigator.focusItem(`in:${patch.add.id}:0`);
    press('x');
    expect(patch.add.inputs[0]).toBeNull();
    expect(patch.graph.connections.some((c) => c.to.nodeId === patch.add.id)).toBe(false);
    expect(said.at(-1)).toBe(`Disconnected Add #${patch.add.id} input A from Time #${patch.time.id}.`);
  });

  it('moves the selection in move mode as one undo step, and Escape puts it back', () => {
    navigator.focusNode(patch.sin.id);
    press('m');
    press('ArrowRight');
    press('ArrowRight', { shiftKey: true });
    press('ArrowDown');
    expect(patch.sin.x).toBe(300 + 10 + 50);
    expect(patch.sin.y).toBe(310);
    press('Enter');
    expect(editor.undoManager.recordNodeMovement).toHaveBeenCalledTimes(1);
    expect(editor.undoManager.recordNodeMovement.mock.calls[0][0]).toEqual([
      { nodeId: patch.sin.id, oldX: 300, oldY: 300, newX: 360, newY: 310 },
    ]);

    press('m');
    press('ArrowLeft');
    press('Escape');
    expect(patch.sin.x).toBe(360);
    expect(said.at(-1)).toBe('Move cancelled.');
  });

  it('deletes the focused node and lands on its neighbour', () => {
    navigator.focusNode(patch.sin.id);
    press('Delete');
    expect(patch.graph.nodes.some((n) => n.id === patch.sin.id)).toBe(false);
    expect(said.at(-1)).toBe(`Deleted Sin #${patch.sin.id}.`);
    // The node that now sits where Sin was in the outline.
    expect(activeKey()).toBe(`node:${patch.out.id}`);
  });

  it('extends the selection with Shift+Space and selects everything with Ctrl+A', () => {
    navigator.focusNode(patch.time.id);
    press('ArrowDown', { ctrlKey: true });
    press(' ', { shiftKey: true });
    expect([...patch.graph.selection].sort()).toEqual([patch.time.id, patch.add.id].sort());
    expect(said.at(-1)).toBe(`Add #${patch.add.id} added to selection, 2 selected.`);
    press(' ', { shiftKey: true });
    expect([...patch.graph.selection]).toEqual([patch.time.id]);
    press('a', { ctrlKey: true });
    expect(patch.graph.selection.size).toBe(4);
    expect(said.at(-1)).toBe('Selected all 4 nodes.');
  });

  it('jumps to the nearest node in a direction with Alt+arrows', () => {
    navigator.focusNode(patch.time.id);
    press('ArrowRight', { altKey: true });
    expect(activeKey()).toBe(`node:${patch.add.id}`);
    press('ArrowDown', { altKey: true });
    expect(activeKey()).toBe(`node:${patch.sin.id}`);
  });

  it('bypasses with B, and says when the Output node refuses', () => {
    navigator.focusNode(patch.add.id);
    press('b');
    expect(patch.add.bypassed).toBe(true);
    expect(said.at(-1)).toBe(`Bypassed Add #${patch.add.id}.`);

    navigator.focusNode(patch.out.id);
    press('b');
    expect(said.at(-1)).toBe(`Output #${patch.out.id} cannot be bypassed.`);
  });

  it('opens the add-node palette beside the node, carrying a wire from a focused output', () => {
    navigator.focusItem(`out:${patch.add.id}:0`);
    press('n');
    expect(editor.menu.showCreateMenu).toHaveBeenCalledTimes(1);
    const [x, y] = editor.menu.showCreateMenu.mock.calls[0];
    expect(x).toBeGreaterThan(patch.add.x + patch.add.w);
    expect(y).toBe(patch.add.y);
    expect(editor.connections.getDragWire()).toMatchObject({
      from: { nodeId: patch.add.id, pin: 0 },
      isFromInput: false,
    });
  });

  it('renames with F2 and brings focus back once the title field closes', async () => {
    const field = document.createElement('input');
    document.body.appendChild(field);
    editor.nodeNameEditor = { isOpen: false };
    editor.beginNodeRename = vi.fn(() => {
      editor.nodeNameEditor.isOpen = true;
      field.focus();
    });

    navigator.focusNode(patch.add.id);
    press('F2');
    expect(editor.beginNodeRename).toHaveBeenCalledWith(patch.add.id);
    expect(document.activeElement).toBe(field);

    // The field commits and goes away, leaving focus nowhere in particular.
    patch.add.name = 'beat gate';
    editor.nodeNameEditor.isOpen = false;
    field.remove();
    await vi.waitFor(() => expect(activeKey()).toBe(`node:${patch.add.id}`));
    expect(document.activeElement.textContent).toBe(`beat gate (Add) #${patch.add.id}, Math node`);
  });

  it('describes an item with I and the whole patch with Shift+I', () => {
    navigator.focusNode(patch.add.id);
    press('i');
    expect(said.at(-1)).toContain('Add #');
    expect(said.at(-1)).toContain('Parameters: A: 0; B: 0.');
    press('I', { shiftKey: true });
    expect(said.at(-1)).toMatch(/^4 nodes, 2 wires\./);
  });

  it('keeps the keys it handles away from the editor, and lets the rest through', () => {
    const globalKeys = vi.fn();
    window.addEventListener('keydown', globalKeys);
    navigator.focus();
    press('ArrowDown');
    press('s', { ctrlKey: true });
    window.removeEventListener('keydown', globalKeys);
    expect(globalKeys).toHaveBeenCalledTimes(1);
    expect(globalKeys.mock.calls[0][0].key).toBe('s');
  });

  it('only asks the renderer for a ring while the outline has focus', () => {
    expect(navigator.renderFocus()).toBeNull();
    navigator.focusItem(`in:${patch.add.id}:1`);
    expect(navigator.renderFocus()).toMatchObject({ nodeId: patch.add.id, part: 'input', pin: 1 });
    document.activeElement.blur();
    expect(navigator.renderFocus()).toBeNull();
  });

  it('comes back to the node last selected with the mouse, and scrolls it into view', () => {
    navigator.focus();
    expect(activeKey()).toBe(`node:${patch.time.id}`);
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    // A click selects Sin; the view is then panned far away from it.
    patch.graph.selection = new Set([patch.sin.id]);
    editor.canvas.getBoundingClientRect = () => ({ left: 0, top: 40, right: 1200, bottom: 900, width: 1200, height: 860 });
    editor.viewport.offsetX = -3000;
    editor.viewport.setViewport.mockClear();

    navigator.focus();
    expect(activeKey()).toBe(`node:${patch.sin.id}`);
    expect([...patch.graph.selection]).toEqual([patch.sin.id]);
    expect(editor.viewport.setViewport).toHaveBeenCalled();
  });

  it('keeps the item a screen reader moves focus straight onto', () => {
    navigator.focus();
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    patch.graph.selection = new Set([patch.sin.id]);

    editor.canvas.querySelector(`[data-key="node:${patch.out.id}"]`).focus();
    expect(activeKey()).toBe(`node:${patch.out.id}`);
    expect([...patch.graph.selection]).toEqual([patch.out.id]);
  });

  it('scrolls a node out from under the key hint and the status bar, though clicks pass through them', () => {
    const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
    const canvasBox = box(0, 40, 1200, 860);
    editor.canvas.getBoundingClientRect = () => canvasBox;
    Object.assign(editor.viewport, { offsetX: 100, offsetY: 100 });
    // On screen: Time at y 790–850 over a status bar grown to 76px (200% interface size), Sin at
    // y 440–520 under the hint, Add in the clear at the top.
    Object.assign(patch.time, { y: 650, w: 180, h: 60 });
    Object.assign(patch.sin, { w: 180, h: 80 });
    Object.assign(patch.add, { w: 180, h: 100 });
    const statusBar = document.createElement('div');
    statusBar.className = 'rz-statusbar';
    statusBar.getBoundingClientRect = () => box(0, 824, 1200, 76);
    document.body.appendChild(statusBar);
    const hint = box(300, 490, 600, 40);
    navigator.hintEl.getBoundingClientRect = () => hint;

    const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const landsClear = (node) => {
      const [scale, offsetX, offsetY] = editor.viewport.setViewport.mock.calls.at(-1);
      const at = box(canvasBox.left + node.x * scale + offsetX, canvasBox.top + node.y * scale + offsetY, node.w, node.h);
      return !overlaps(at, hint) && !overlaps(at, statusBar.getBoundingClientRect());
    };

    navigator.focusNode(patch.time.id);
    expect(editor.viewport.setViewport).toHaveBeenCalled();
    expect(landsClear(patch.time)).toBe(true);

    editor.viewport.setViewport.mockClear();
    navigator.focusNode(patch.add.id);
    expect(editor.viewport.setViewport).not.toHaveBeenCalled();

    navigator.focusNode(patch.sin.id);
    expect(editor.viewport.setViewport).toHaveBeenCalled();
    expect(landsClear(patch.sin)).toBe(true);
  });

  it('notices edits made elsewhere on the next repaint', async () => {
    vi.useFakeTimers();
    try {
      const extra = makeNode('Cos', 900, 0);
      patch.graph.nodes.push(extra);
      navigator.afterDraw(Date.now() + 1000);
      vi.advanceTimersByTime(200);
      const keys = [...editor.canvas.querySelectorAll('[role="treeitem"]')].map((el) => el.dataset.key);
      expect(keys).toContain(`node:${extra.id}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('labels an empty patch and offers a way in', () => {
    navigator.dispose();
    const empty = makeEditor({ nodes: [], connections: [], selection: new Set() });
    navigator = new GraphNavigator({
      editor: empty,
      settings: new A11ySettings({ storage: null, matchMedia: () => null }),
      announce: () => {},
    }).install();
    const tree = empty.canvas.querySelector('[role="tree"]');
    expect(tree.tabIndex).toBe(0);
    expect(tree.getAttribute('aria-label')).toMatch(/empty/);
  });
});
