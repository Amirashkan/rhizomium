// Feature test: clicking one selected node's eye button hides/shows the WHOLE selection.
//
// When several nodes are selected and the user clicks the eye (preview toggle) on one of them, the
// entire selection follows the clicked node's new state — so the group hides its thumbnails
// together. Clicking the eye of a node that isn't part of a multi-selection still toggles just that
// one node.

import { describe, it, expect } from 'vitest';
import { EventHandler } from '../src/core/EventHandler.js';

// Two nodes side by side; we click the eye button of `node`. The eye rect mirrors
// Renderer/EventHandler: x in [node.x+node.w-46, +12], y in [node.y+11, node.y+21].
function eyeCenter(n) { return { x: n.x + n.w - 45 + 5, y: n.y + 19 - 3 }; }

function makeHarness({ selection, enabledFor }) {
  const nodeA = { id: '1', kind: 'Circle', x: 100, y: 50, w: 160, h: 40 };
  const nodeB = { id: '2', kind: 'Gradient', x: 400, y: 50, w: 160, h: 40 };
  const calls = { toggleNodePreview: [], setSelectedNodesPreview: [] };
  const self = {
    editor: {
      graph: { nodes: [nodeA, nodeB], selection: new Set(selection) },
      isNodePreviewEnabled: (n) => enabledFor(n),
      toggleNodePreview: (id) => calls.toggleNodePreview.push(id),
      setSelectedNodesPreview: (enabled, ids) =>
        calls.setSelectedNodesPreview.push({ enabled, ids: [...ids] }),
    },
    _requestDraw: () => {},
    checkPreviewControlClick: EventHandler.prototype.checkPreviewControlClick,
  };
  return { self, calls, nodeA, nodeB };
}

describe('eye button acts on the whole selection', () => {
  it('hides the entire selection when clicking a selected node whose preview is on', () => {
    const { self, calls, nodeA } = makeHarness({
      selection: ['1', '2'],
      enabledFor: () => true, // both currently visible
    });

    const consumed = self.checkPreviewControlClick.call(self, eyeCenter(nodeA));

    expect(consumed).toBe(true);
    // Whole selection targeted with enabled=false (hide), not a single-node toggle.
    expect(calls.setSelectedNodesPreview).toEqual([{ enabled: false, ids: ['1', '2'] }]);
    expect(calls.toggleNodePreview).toEqual([]);
  });

  it('shows the entire selection when clicking a selected node whose preview is off', () => {
    const { self, calls, nodeA } = makeHarness({
      selection: ['1', '2'],
      enabledFor: () => false, // both currently hidden
    });

    self.checkPreviewControlClick.call(self, eyeCenter(nodeA));

    expect(calls.setSelectedNodesPreview).toEqual([{ enabled: true, ids: ['1', '2'] }]);
  });

  it('falls back to single-node toggle when only that node is selected', () => {
    const { self, calls, nodeA } = makeHarness({
      selection: ['1'],
      enabledFor: () => true,
    });

    self.checkPreviewControlClick.call(self, eyeCenter(nodeA));

    expect(calls.toggleNodePreview).toEqual(['1']);
    expect(calls.setSelectedNodesPreview).toEqual([]);
  });

  it('toggles only the clicked node when it is outside the current selection', () => {
    const { self, calls, nodeB } = makeHarness({
      selection: ['1'], // node 2 (the one clicked) is NOT selected
      enabledFor: () => true,
    });

    self.checkPreviewControlClick.call(self, eyeCenter(nodeB));

    expect(calls.toggleNodePreview).toEqual(['2']);
    expect(calls.setSelectedNodesPreview).toEqual([]);
  });
});
