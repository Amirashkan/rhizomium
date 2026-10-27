// Connect Pins, Disconnect Pins, Go to Node and Describe Patch: the patch operated through native
// form controls, wired through the same ConnectionManager a mouse drag uses.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  openConnectDialog,
  openDisconnectDialog,
  openGoToNodeDialog,
  openDescribePatchDialog,
  patchDescriptionText,
} from '../src/accessibility/graphDialogs.js';
import { ConnectionManager } from '../src/core/ConnectionManager.js';
import { makeNode } from '../src/data/NodeDefs.js';

function buildEditor() {
  const time = makeNode('Time', 0, 0);
  const add = makeNode('Add', 300, 0);
  const out = makeNode('OutputFinal', 600, 0);
  const graph = { nodes: [time, add, out], connections: [], selection: new Set() };
  graph.connections.push({ from: { nodeId: add.id, pin: 0 }, to: { nodeId: out.id, pin: 0 } });
  out.inputs[0] = add.id;
  const editor = {
    graph,
    connections: new ConnectionManager(graph, vi.fn()),
    onChange: vi.fn(),
    markDirty: vi.fn(),
    draw: vi.fn(),
    undoManager: { beginTransaction: vi.fn(), commitTransaction: vi.fn() },
  };
  return { editor, time, add, out };
}

const button = (label) => [...document.querySelectorAll('.modal-button')].find((b) => b.textContent === label);
const select = (label) => {
  const lab = [...document.querySelectorAll('.rz-gd-label')].find((l) => l.textContent === label);
  return document.getElementById(lab.htmlFor);
};
const choose = (sel, value) => {
  sel.value = value;
  sel.dispatchEvent(new Event('change'));
};

describe('keyboard dialogs', () => {
  let ctx;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    ctx = buildEditor();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('connects an output to an input chosen from labelled lists', async () => {
    const onDone = vi.fn();
    const pending = openConnectDialog({ editor: ctx.editor, from: { nodeId: ctx.time.id, pin: 0 }, onDone });

    const from = select('From output');
    const to = select('To input');
    expect(from.value).toBe(`${ctx.time.id}::0`);
    // With the source given, the keyboard starts on the list still to choose from.
    expect(document.activeElement).toBe(to);
    expect([...to.options].map((o) => o.textContent)).toContain(`Add #${ctx.add.id} · A`);

    choose(to, `${ctx.add.id}::1`);
    button('Connect').click();
    vi.advanceTimersByTime(400);
    await pending;

    expect(ctx.add.inputs[1]).toBe(ctx.time.id);
    expect(onDone).toHaveBeenCalledWith({
      from: { nodeId: ctx.time.id, pin: 0 },
      to: { nodeId: ctx.add.id, pin: 1 },
    });
  });

  it('warns before replacing a wire, and refuses a node wired into itself', () => {
    openConnectDialog({ editor: ctx.editor, from: { nodeId: ctx.time.id, pin: 0 }, to: { nodeId: ctx.out.id, pin: 0 } });
    const status = document.querySelector('.rz-gd-status');
    expect(status.textContent).toContain(`is fed by Add #${ctx.add.id} now`);

    choose(select('From output'), `${ctx.add.id}::0`);
    choose(select('To input'), `${ctx.add.id}::0`);
    expect(status.textContent).toMatch(/same node/);
    button('Connect').click();
    expect(document.querySelector('.modal-overlay')).toBeTruthy(); // still open
    expect(ctx.add.inputs[0]).toBeNull();
  });

  it('narrows the lists as you type in the filter', () => {
    openConnectDialog({ editor: ctx.editor });
    const filter = document.querySelector('.rz-gd-filter');
    filter.value = 'time';
    filter.dispatchEvent(new Event('input'));
    const options = [...select('From output').options].map((o) => o.textContent);
    expect(options).toEqual([`Time #${ctx.time.id} · t (number)`]);
  });

  it('removes the chosen wires as one undo step', async () => {
    const pending = openDisconnectDialog({ editor: ctx.editor });
    const list = document.querySelector('.rz-gd-list');
    expect(list.multiple).toBe(true);
    expect([...list.options].map((o) => o.textContent)).toEqual([
      `Add #${ctx.add.id} · out → Output #${ctx.out.id} · color`,
    ]);
    list.options[0].selected = true;
    button('Disconnect').click();
    vi.advanceTimersByTime(400);
    await pending;

    expect(ctx.out.inputs[0]).toBeNull();
    expect(ctx.editor.undoManager.beginTransaction).toHaveBeenCalledTimes(1);
    expect(ctx.editor.undoManager.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('hands back the node picked in Go to Node', async () => {
    const onPick = vi.fn();
    const pending = openGoToNodeDialog({ editor: ctx.editor, onPick });
    choose(document.querySelector('.rz-gd-list'), ctx.add.id);
    button('Go').click();
    vi.advanceTimersByTime(400);
    await pending;
    expect(onPick).toHaveBeenCalledWith(ctx.add.id);
  });

  it('describes the patch as headings and lists', () => {
    openDescribePatchDialog({ editor: ctx.editor });
    const region = document.querySelector('.rz-gd-scroll');
    expect(region.getAttribute('role')).toBe('region');
    expect([...region.querySelectorAll('h4')].map((h) => h.textContent)).toEqual([
      'Summary',
      'Nodes, in signal order',
    ]);
    const items = region.querySelectorAll('.rz-gd-nodes > li');
    expect(items).toHaveLength(3);
    expect(items[1].textContent).toContain(`Add #${ctx.add.id}`);
    expect(items[1].textContent).toContain(`feeds Output #${ctx.out.id} input color`);
  });

  it('writes the same structure as plain text for copying', () => {
    const text = patchDescriptionText(ctx.editor.graph);
    expect(text).toContain('3 nodes, 1 wire.');
    expect(text).toContain(`2. Add #${ctx.add.id}, Math`);
    expect(text).toContain('   - input B, not connected');
  });
});
