// Editable node names — a node draws its definition's label ("Float", "Remap") until the artist
// renames it, and its own `node.name` from then on.
//
// The name is display-only, which is exactly what makes it easy to break quietly: nothing
// downstream fails if it stops being read, saved or undone. These tests pin down the four places
// it has to survive:
//
//   1. the name helpers (fallback, normalization, "typing the default clears it"),
//   2. the title-bar hit area that starts a rename, which must stop short of the control chips,
//   3. Editor.renameNode's undo/redo round-trip,
//   4. the save format, which carries the name across a reload.

import { describe, it, expect } from 'vitest';
import {
  MAX_NODE_NAME_LENGTH,
  customNodeName,
  defaultNodeName,
  hasCustomNodeName,
  nodeDisplayName,
  normalizeNodeName,
} from '../src/core/nodeName.js';
import { hitNodeTitle, nodeTitleRect, HEADER_H, HEADER_CONTROLS_W } from '../src/core/pinLayout.js';
import { Editor } from '../src/core/Editor.js';
import { SelectionManager } from '../src/core/SelectionManager.js';
import { SaveLoadManager } from '../src/core/SaveLoadManager.js';
import { GraphProcessor } from '../src/codegen/processors/GraphProcessor.js';

const remap = (extra = {}) => ({ id: '3', kind: 'Remap', x: 100, y: 50, w: 180, h: 96, ...extra });

// Editor methods under test only touch the graph, the undo manager and the redraw hooks, so they
// run on a stub rather than a constructed Editor (which wants a canvas, GPU and timers).
function editorStub(nodes) {
  const actions = [];
  const stub = {
    graph: { nodes },
    onChange: () => {},
    safeDraw: () => {},
    markDirty: () => {},
    undoManager: { pushAction: (action) => actions.push(action) },
    actions,
  };
  stub.renameNode = Editor.prototype.renameNode.bind(stub);
  stub._applyNodeName = Editor.prototype._applyNodeName.bind(stub);
  return stub;
}

describe('node display name', () => {
  it("falls back to the kind's label until the node is renamed", () => {
    const node = remap();
    expect(nodeDisplayName(node)).toBe('Remap');
    expect(hasCustomNodeName(node)).toBe(false);

    node.name = 'beat gate';
    expect(nodeDisplayName(node)).toBe('beat gate');
    expect(hasCustomNodeName(node)).toBe(true);
  });

  it('treats a blank name as no name, so the label comes back', () => {
    expect(nodeDisplayName(remap({ name: '   ' }))).toBe('Remap');
    expect(customNodeName(remap({ name: '' }))).toBe('');
    expect(hasCustomNodeName(remap({ name: '\t' }))).toBe(false);
  });

  it('falls back to the raw kind for a node whose definition is unknown', () => {
    expect(defaultNodeName({ kind: 'SomeFutureNode' })).toBe('SomeFutureNode');
    expect(nodeDisplayName({ kind: 'SomeFutureNode' })).toBe('SomeFutureNode');
  });
});

describe('normalizeNodeName', () => {
  const node = remap();

  it('collapses a title to one trimmed line', () => {
    expect(normalizeNodeName('  hue   drift  ', node)).toBe('hue drift');
    expect(normalizeNodeName('two\nlines\there', node)).toBe('two lines here');
  });

  it('clamps to the maximum length instead of letting a node grow without bound', () => {
    const long = 'x'.repeat(MAX_NODE_NAME_LENGTH + 20);
    expect(normalizeNodeName(long, node)).toHaveLength(MAX_NODE_NAME_LENGTH);
  });

  it('stores the kind\'s own label as "no custom name"', () => {
    expect(normalizeNodeName('Remap', node)).toBe('');
    expect(normalizeNodeName('  Remap  ', node)).toBe('');
    // A different kind's label is a perfectly good custom name.
    expect(normalizeNodeName('Remap', { kind: 'ConstFloat' })).toBe('Remap');
  });

  it('rejects a blank entry and a non-string', () => {
    expect(normalizeNodeName('   ', node)).toBe('');
    expect(normalizeNodeName(undefined, node)).toBe('');
    expect(normalizeNodeName(42, node)).toBe('');
  });
});

describe('title-bar hit area', () => {
  it('covers the header but stops before the control chips', () => {
    const node = remap();
    const rect = nodeTitleRect(node);

    expect(rect.h).toBe(HEADER_H);
    expect(rect.w).toBeLessThan(node.w - HEADER_CONTROLS_W);

    // Over the title text.
    expect(hitNodeTitle(node, node.x + 20, node.y + 12)).toBe(true);
    // Over the bypass / eye / size chips — a near-miss there must not rename the node.
    expect(hitNodeTitle(node, node.x + node.w - 40, node.y + 12)).toBe(false);
    // Below the header, in the node body.
    expect(hitNodeTitle(node, node.x + 20, node.y + HEADER_H + 10)).toBe(false);
    // Outside the node entirely.
    expect(hitNodeTitle(node, node.x - 5, node.y + 12)).toBe(false);
  });
});

describe('Editor.renameNode', () => {
  it('stores a normalized name and undoes back to the definition label', () => {
    const node = remap();
    const editor = editorStub([node]);

    expect(editor.renameNode('3', '  hue drift ')).toBe(true);
    expect(node.name).toBe('hue drift');
    expect(nodeDisplayName(node)).toBe('hue drift');

    const [action] = editor.actions;
    expect(action.type).toBe('RENAME_NODE');

    action.undo();
    expect('name' in node).toBe(false);
    expect(nodeDisplayName(node)).toBe('Remap');

    action.redo();
    expect(node.name).toBe('hue drift');
  });

  it('clears the name rather than storing an empty string', () => {
    const node = remap({ name: 'hue drift' });
    const editor = editorStub([node]);

    expect(editor.renameNode('3', '')).toBe(true);
    expect('name' in node).toBe(false);
    expect(nodeDisplayName(node)).toBe('Remap');

    editor.actions[0].undo();
    expect(node.name).toBe('hue drift');
  });

  it('records nothing for a no-op rename', () => {
    const node = remap({ name: 'hue drift' });
    const editor = editorStub([node]);

    expect(editor.renameNode('3', 'hue drift')).toBe(false);
    expect(editor.renameNode('3', '  hue   drift  ')).toBe(false);
    expect(editor.renameNode('nope', 'ghost')).toBe(false);
    expect(editor.actions).toHaveLength(0);
  });

  it('typing the definition label clears the custom name', () => {
    const node = remap({ name: 'hue drift' });
    const editor = editorStub([node]);

    expect(editor.renameNode('3', 'Remap')).toBe(true);
    expect('name' in node).toBe(false);
  });
});

describe('duplicating a renamed node', () => {
  it('carries the name onto the copy', () => {
    const clone = SelectionManager.prototype.cloneNodeProperly.call(
      {},
      { kind: 'Remap', x: 0, y: 0, name: 'bloom mask', params: {} },
    );
    expect(clone.name).toBe('bloom mask');
    expect(nodeDisplayName(clone)).toBe('bloom mask');
    // A fresh id still tells the two apart on the canvas.
    expect(clone.id).toBeTruthy();
  });

  it('leaves an un-renamed node anonymous', () => {
    const clone = SelectionManager.prototype.cloneNodeProperly.call(
      {},
      { kind: 'Remap', x: 0, y: 0, params: {} },
    );
    expect('name' in clone).toBe(false);
    expect(nodeDisplayName(clone)).toBe('Remap');
  });
});

describe('node identification', () => {
  it('does not let a display name stand in for the node kind', () => {
    // The output sink is found by kind. A node merely NAMED "output final mix" is not the sink —
    // both lookups (GraphProcessor.findActiveOutput and main.js) match kind/type only.
    const decoy = { id: '1', kind: 'Remap', name: 'output final mix', inputs: [null] };
    const sink = { id: '2', kind: 'OutputFinal', inputs: ['1'] };

    const found = new GraphProcessor().findActiveOutput({ nodes: [decoy, sink], connections: [] });
    expect(found?.id).toBe('2');
  });
});

describe('save format', () => {
  it('carries a custom name across export and import', async () => {
    const exported = SaveLoadManager.prototype.exportNodes.call({
      graph: { nodes: [remap({ name: 'hue drift', inputs: [null] })] },
      textureManager: null,
    });
    expect(exported[0].name).toBe('hue drift');

    const target = { graph: {} };
    await SaveLoadManager.prototype.importNodes.call(target, exported);
    expect(target.graph.nodes[0].name).toBe('hue drift');
    expect(nodeDisplayName(target.graph.nodes[0])).toBe('hue drift');
  });

  it('writes nothing for a node that was never renamed', () => {
    const [plain] = SaveLoadManager.prototype.exportNodes.call({
      graph: { nodes: [remap({ inputs: [null] })] },
      textureManager: null,
    });
    expect('name' in plain).toBe(false);
  });
});
