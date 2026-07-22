// Feature test: hide/show the thumbnails of several selected nodes at once.
//
// Editor.setSelectedNodesPreview(enabled) applies one explicit visibility state to every node in
// the current selection (clearing __thumb when hiding), and toggleSelectedNodesPreview() is the
// smart toggle behind the H shortcut: if ANY selected node is visible, the whole selection hides;
// otherwise it all comes back.

import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '../src/core/Editor.js';

// Build a bare Editor without running its DOM/GPU constructor, wiring only the state these two
// methods touch.
function makeEditor(nodes, selectedIds) {
  const ed = Object.create(Editor.prototype);
  ed.graph = { nodes, selection: new Set(selectedIds) };
  ed.nodePreviews = new Map();
  ed.previewIntegration = { generateNodePreview: (node) => { node.__thumb = 'REGEN'; } };
  ed.safeDraw = () => { ed._drawn = (ed._drawn || 0) + 1; };
  return ed;
}

describe('bulk hide/show of selected node previews', () => {
  let nodes;
  let ed;

  beforeEach(() => {
    // Visual nodes default to visible (defaultNodePreviewEnabled -> true when no preview manager).
    nodes = [
      { id: '1', kind: 'Circle', params: {}, __thumb: 'A' },
      { id: '2', kind: 'Gradient', params: {}, __thumb: 'B' },
      { id: '3', kind: 'Noise', params: {}, __thumb: 'C' }, // not selected
    ];
    ed = makeEditor(nodes, ['1', '2']);
  });

  it('hides every selected node and clears its thumbnail, leaving unselected nodes untouched', () => {
    const changed = ed.setSelectedNodesPreview(false);

    expect(changed).toBe(2);
    expect(ed.isNodePreviewEnabled(nodes[0])).toBe(false);
    expect(ed.isNodePreviewEnabled(nodes[1])).toBe(false);
    expect(nodes[0].__thumb).toBe(null);
    expect(nodes[1].__thumb).toBe(null);
    // Node 3 was not selected — untouched.
    expect(ed.isNodePreviewEnabled(nodes[2])).toBe(true);
    expect(nodes[2].__thumb).toBe('C');
  });

  it('shows selected nodes again and regenerates their previews', () => {
    ed.setSelectedNodesPreview(false);
    const changed = ed.setSelectedNodesPreview(true);

    expect(changed).toBe(2);
    expect(ed.isNodePreviewEnabled(nodes[0])).toBe(true);
    expect(nodes[0].__thumb).toBe('REGEN');
    expect(nodes[1].__thumb).toBe('REGEN');
  });

  it('does not double-count nodes already in the target state', () => {
    ed.setSelectedNodesPreview(false);       // both -> hidden
    const changed = ed.setSelectedNodesPreview(false); // already hidden
    expect(changed).toBe(0);
  });

  it('toggle hides the whole selection when any member is visible', () => {
    ed.setSelectedNodesPreview(false, new Set(['1'])); // node 1 hidden, node 2 still visible
    ed.toggleSelectedNodesPreview();

    expect(ed.isNodePreviewEnabled(nodes[0])).toBe(false);
    expect(ed.isNodePreviewEnabled(nodes[1])).toBe(false);
  });

  it('toggle shows the whole selection when all members are hidden', () => {
    ed.setSelectedNodesPreview(false); // both hidden
    ed.toggleSelectedNodesPreview();

    expect(ed.isNodePreviewEnabled(nodes[0])).toBe(true);
    expect(ed.isNodePreviewEnabled(nodes[1])).toBe(true);
  });

  it('is a no-op with an empty selection', () => {
    ed.graph.selection = new Set();
    expect(ed.setSelectedNodesPreview(false)).toBe(0);
    expect(ed.toggleSelectedNodesPreview()).toBe(0);
  });
});
