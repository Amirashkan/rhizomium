// Regression test: the per-node title-bar controls (bypass / preview toggle / size) must stay
// clickable even when the node's preview band is HIDDEN.
//
// Bug: checkPreviewControlClick skipped any node whose shouldShowPreview(node) was false. Once
// shouldShowPreview began reflecting the per-node visibility (numeric nodes hidden by default, or a
// node toggled off), a hidden node's eye button became unclickable — there was no way to turn its
// thumbnail back on. The controls are always drawn (Renderer._renderPreviewControls), so their hit
// areas must always be live.

import { describe, it, expect } from 'vitest';
import { EventHandler } from '../src/core/EventHandler.js';

// Drive checkPreviewControlClick via the prototype with a minimal `this` (the real constructor
// wires up canvas/DOM listeners we don't need here).
function makeHarness(node, editorOverrides = {}) {
  const calls = { toggleNodePreview: [], toggleNodeBypass: [], cyclePreviewSize: [] };
  const self = {
    editor: {
      graph: { nodes: [node] },
      shouldShowPreview: () => false, // node's band is hidden
      isNodePreviewEnabled: () => false, // and its preview is off
      toggleNodePreview: (id) => calls.toggleNodePreview.push(id),
      toggleNodeBypass: (id) => calls.toggleNodeBypass.push(id),
      cyclePreviewSize: (id) => calls.cyclePreviewSize.push(id),
      ...editorOverrides,
    },
    _requestDraw: () => {},
    checkPreviewControlClick: EventHandler.prototype.checkPreviewControlClick,
  };
  return { self, calls };
}

// The eye button rect mirrors Renderer/EventHandler: x in [node.x+node.w-46, node.x+node.w-34],
// y in [node.y+11, node.y+21].
const node = { id: '1', kind: 'Add', x: 100, y: 50, w: 160, h: 40 };
const eyeCenter = { x: node.x + node.w - 45 + 5, y: node.y + 19 - 3 };

describe('checkPreviewControlClick on a hidden node', () => {
  it('still toggles the preview when the eye button is clicked', () => {
    const { self, calls } = makeHarness(node);

    const consumed = self.checkPreviewControlClick.call(self, eyeCenter);

    expect(consumed).toBe(true);
    expect(calls.toggleNodePreview).toEqual(['1']);
  });

  it('still toggles bypass when the X button is clicked', () => {
    const { self, calls } = makeHarness(node);
    const xCenter = { x: node.x + node.w - 65 + 5, y: node.y + 19 - 3 };

    const consumed = self.checkPreviewControlClick.call(self, xCenter);

    expect(consumed).toBe(true);
    expect(calls.toggleNodeBypass).toEqual(['1']);
  });

  it('does not consume a click outside every control', () => {
    const { self, calls } = makeHarness(node);

    const consumed = self.checkPreviewControlClick.call(self, { x: node.x + 5, y: node.y + 30 });

    expect(consumed).toBe(false);
    expect(calls.toggleNodePreview).toEqual([]);
  });
});
