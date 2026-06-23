// Regression tests: nodes created through the searchable "quick add" menu (MenuManager) must
// trigger per-node preview generation, the same way the radial menu and Editor.createNode do.
//
// Bug: adding a node via MenuManager._createNode (the Create Node button / quick-search hotkey) —
// or duplicating nodes via _duplicateSelected — never called previewIntegration.onNodeAdded. So a
// freshly added node rendered as a placeholder until some unrelated event (a parameter edit, or
// wiring it into the chain that reaches the output) happened to recompute its preview. That is the
// "per-node preview shows a placeholder until it's connected to the output" report.
//
// Contract locked in: every node-creation path in MenuManager schedules a preview refresh through
// window.editor.previewIntegration.onNodeAdded, so the node previews its own output immediately —
// even while it is still disconnected from the output.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MenuManager } from '../src/ui/MenuManager.js';

describe('MenuManager triggers preview generation when nodes are added', () => {
  let graph;
  let onNodeAdded;
  let previousEditor;

  beforeEach(() => {
    graph = { nodes: [], connections: [], selection: new Set() };
    onNodeAdded = vi.fn();
    previousEditor = window.editor;
    window.editor = { previewIntegration: { onNodeAdded } };
  });

  afterEach(() => {
    window.editor = previousEditor;
  });

  it('_createNode schedules a preview refresh for the newly added node', () => {
    const menu = new MenuManager(graph, () => {});

    menu._createNode('ConstVec2');

    expect(graph.nodes).toHaveLength(1);
    expect(onNodeAdded).toHaveBeenCalledTimes(1);
    // It must be handed the node that was actually added (so the refresh targets the right graph).
    expect(onNodeAdded).toHaveBeenCalledWith(graph.nodes[0]);
  });

  it('_createNode does not throw when no preview integration is available', () => {
    window.editor = {}; // no previewIntegration — optional chaining must keep node creation working
    const menu = new MenuManager(graph, () => {});

    expect(() => menu._createNode('ConstVec2')).not.toThrow();
    expect(graph.nodes).toHaveLength(1);
  });

  it('_duplicateSelected schedules a preview refresh for the clones', () => {
    const menu = new MenuManager(graph, () => {});

    // Seed a node and select it, then clear the spy so we only observe the duplication.
    menu._createNode('ConstVec2');
    onNodeAdded.mockClear();
    graph.selection = new Set([graph.nodes[0].id]);

    menu._duplicateSelected();

    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(onNodeAdded).toHaveBeenCalled();
  });
});
