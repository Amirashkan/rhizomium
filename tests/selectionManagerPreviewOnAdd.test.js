// Regression tests: the keyboard duplicate (Cmd/Ctrl+D) and paste (Cmd/Ctrl+V) paths go through
// SelectionManager, which must trigger per-node preview generation for the nodes it adds.
//
// Bug: SelectionManager.duplicateSelected and pasteFromClipboard added clones and called onChange
// but never called previewIntegration.onNodeAdded, so duplicated/pasted nodes rendered as
// placeholders until some unrelated event (a parameter edit, or wiring them into the chain that
// reaches the output) happened to recompute them. Same family as the MenuManager creation paths.
//
// Contract locked in: every SelectionManager path that adds nodes schedules a preview refresh
// through window.editor.previewIntegration.onNodeAdded.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SelectionManager } from '../src/core/SelectionManager.js';
import { makeNode } from '../src/data/NodeDefs.js';

describe('SelectionManager triggers preview generation when nodes are added', () => {
  let graph;
  let onNodeAdded;
  let previousEditor;

  beforeEach(() => {
    const seed = makeNode('ConstVec2', 100, 100);
    graph = { nodes: [seed], connections: [], selection: new Set([seed.id]) };
    onNodeAdded = vi.fn();
    previousEditor = window.editor;
    window.editor = { previewIntegration: { onNodeAdded } };
  });

  afterEach(() => {
    window.editor = previousEditor;
  });

  it('duplicateSelected schedules a preview refresh for the clones', () => {
    const selection = new SelectionManager(graph, () => {});

    selection.duplicateSelected();

    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(onNodeAdded).toHaveBeenCalled();
  });

  it('pasteFromClipboard schedules a preview refresh for the pasted nodes', () => {
    const selection = new SelectionManager(graph, () => {});

    expect(selection.copySelected()).toBe(true);
    onNodeAdded.mockClear();

    expect(selection.pasteFromClipboard()).toBe(true);
    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(onNodeAdded).toHaveBeenCalled();
  });

  it('does not throw when no preview integration is available', () => {
    window.editor = {}; // no previewIntegration — optional chaining must keep duplication working
    const selection = new SelectionManager(graph, () => {});

    expect(() => selection.duplicateSelected()).not.toThrow();
    expect(graph.nodes.length).toBeGreaterThan(1);
  });
});
