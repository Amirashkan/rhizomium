// Regression tests: nodes created through the add-node palette must trigger per-node preview
// generation, the same way Editor.createNode does — and so must duplication in MenuManager.
//
// Bug: adding a node via the quick-add menu — or duplicating nodes via _duplicateSelected — never
// called previewIntegration.onNodeAdded. So a freshly added node rendered as a placeholder until
// some unrelated event (a parameter edit, or wiring it into the chain that reaches the output)
// happened to recompute its preview. That is the "per-node preview shows a placeholder until it's
// connected to the output" report.
//
// Contract locked in: every node-creation path schedules a preview refresh through
// window.editor.previewIntegration.onNodeAdded, so the node previews its own output immediately —
// even while it is still disconnected from the output.
//
// The creation half of this used to live on MenuManager._createNode; it moved to AddNodePalette
// when the search palette replaced the radial menu, so it is exercised there.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MenuManager } from '../src/ui/MenuManager.js';
import { AddNodePalette } from '../src/ui/AddNodePalette.js';

describe('adding a node triggers preview generation', () => {
  let graph;
  let onNodeAdded;
  let previousEditor;

  beforeEach(() => {
    vi.useFakeTimers();
    graph = { nodes: [], connections: [], selection: new Set() };
    onNodeAdded = vi.fn();
    previousEditor = window.editor;
    window.editor = { previewIntegration: { onNodeAdded } };
  });

  afterEach(() => {
    vi.useRealTimers();
    window.editor = previousEditor;
  });

  it('the palette schedules a preview refresh for the newly placed node', () => {
    const palette = new AddNodePalette(graph, () => {});

    palette._placeNode('ConstVec2');
    // The refresh is deferred alongside the shader rebuild, so let it fire.
    vi.runAllTimers();

    expect(graph.nodes).toHaveLength(1);
    expect(onNodeAdded).toHaveBeenCalledTimes(1);
    // It must be handed the node that was actually added (so the refresh targets the right graph).
    expect(onNodeAdded).toHaveBeenCalledWith(graph.nodes[0]);
  });

  it('placing a node does not throw when no preview integration is available', () => {
    window.editor = {}; // no previewIntegration — optional chaining must keep node creation working
    const palette = new AddNodePalette(graph, () => {});

    expect(() => {
      palette._placeNode('ConstVec2');
      vi.runAllTimers();
    }).not.toThrow();
    expect(graph.nodes).toHaveLength(1);
  });

  it('_duplicateSelected schedules a preview refresh for the clones', () => {
    const palette = new AddNodePalette(graph, () => {});
    const menu = new MenuManager(graph, () => {});

    // Seed a node and select it, then clear the spy so we only observe the duplication.
    palette._placeNode('ConstVec2');
    vi.runAllTimers();
    onNodeAdded.mockClear();
    graph.selection = new Set([graph.nodes[0].id]);

    menu._duplicateSelected();

    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(onNodeAdded).toHaveBeenCalled();
  });
});
