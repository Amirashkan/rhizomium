// Regression tests for the per-node thumbnail visibility model:
//
//   * Numeric/scalar nodes (not a visual/vector-output node, not a compute node) are HIDDEN by
//     default — no explicit per-node entry needed.
//   * Visual and compute nodes are VISIBLE by default.
//   * An explicit per-node toggle always wins over the default.
//   * toggleNodePreview flips the EFFECTIVE state, so the first click on a hidden-by-default numeric
//     node turns its thumbnail ON (rather than seeding `enabled: true` and immediately negating it).
//
// These drive the eye-button icon, the layout band (shouldShowPreview), and every thumbnail
// generator, so they all agree on what's visible.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '../src/core/Editor.js';

// Classify like ShaderPreviewManager: compute = kind starts with "compute"; "visual" is supplied
// per-test via a set of kinds so we don't depend on the full NodeDefs table here.
function makeSpm(visualKinds = new Set()) {
  return {
    enableGPUPreview: true,
    isComputeNode: (n) => {
      const k = typeof n === 'string' ? n : n?.kind;
      return !!k && k.toLowerCase().startsWith('compute');
    },
    isVisualNode: (n) => {
      const k = typeof n === 'string' ? n : n?.kind;
      return visualKinds.has(k);
    },
  };
}

// Minimal `this` for the Editor preview helpers under test (the real constructor is heavy).
function makeEditor(graph) {
  return {
    graph,
    nodePreviews: new Map(),
    previewIntegration: null,
    safeDraw() {},
    defaultNodePreviewEnabled: Editor.prototype.defaultNodePreviewEnabled,
    isNodePreviewEnabled: Editor.prototype.isNodePreviewEnabled,
    shouldShowPreview: Editor.prototype.shouldShowPreview,
    toggleNodePreview: Editor.prototype.toggleNodePreview,
  };
}

describe('per-node thumbnail visibility defaults', () => {
  let previousSpm;

  beforeEach(() => {
    previousSpm = window.shaderPreviewManager;
    window.shaderPreviewManager = makeSpm(new Set(['Circle']));
  });

  afterEach(() => {
    window.shaderPreviewManager = previousSpm;
  });

  it('hides a numeric (non-visual, non-compute) node by default', () => {
    const ed = makeEditor({ nodes: [] });
    const node = { id: '1', kind: 'Add' };
    expect(ed.defaultNodePreviewEnabled(node)).toBe(false);
    expect(ed.isNodePreviewEnabled(node)).toBe(false);
    expect(ed.shouldShowPreview(node)).toBe(false);
  });

  it('shows a visual node by default', () => {
    const ed = makeEditor({ nodes: [] });
    const node = { id: '2', kind: 'Circle' };
    expect(ed.defaultNodePreviewEnabled(node)).toBe(true);
    expect(ed.isNodePreviewEnabled(node)).toBe(true);
  });

  it('shows a compute node by default', () => {
    const ed = makeEditor({ nodes: [] });
    const node = { id: '3', kind: 'ComputeNoise' };
    expect(ed.defaultNodePreviewEnabled(node)).toBe(true);
    expect(ed.isNodePreviewEnabled(node)).toBe(true);
  });

  it('lets an explicit entry override the default (both directions)', () => {
    const ed = makeEditor({ nodes: [] });
    const numeric = { id: '4', kind: 'Add' };
    const visual = { id: '5', kind: 'Circle' };
    ed.nodePreviews.set('4', { enabled: true });   // force a numeric node visible
    ed.nodePreviews.set('5', { enabled: false });  // force a visual node hidden
    expect(ed.isNodePreviewEnabled(numeric)).toBe(true);
    expect(ed.isNodePreviewEnabled(visual)).toBe(false);
  });

  it('defaults to visible when the preview manager is unavailable', () => {
    window.shaderPreviewManager = undefined;
    const ed = makeEditor({ nodes: [] });
    expect(ed.defaultNodePreviewEnabled({ id: '6', kind: 'Add' })).toBe(true);
  });
});

describe('toggleNodePreview flips the effective state', () => {
  let previousSpm;

  beforeEach(() => {
    previousSpm = window.shaderPreviewManager;
    window.shaderPreviewManager = makeSpm(new Set(['Circle']));
  });

  afterEach(() => {
    window.shaderPreviewManager = previousSpm;
  });

  it('first click on a hidden-by-default numeric node turns it ON', () => {
    const node = { id: '1', kind: 'Add' };
    const ed = makeEditor({ nodes: [node] });

    ed.toggleNodePreview('1');

    expect(ed.nodePreviews.get('1').enabled).toBe(true);
    expect(ed.isNodePreviewEnabled(node)).toBe(true);
  });

  it('first click on a visible-by-default visual node turns it OFF and clears the thumbnail', () => {
    const node = { id: '2', kind: 'Circle', __thumb: 'IMG' };
    const ed = makeEditor({ nodes: [node] });

    ed.toggleNodePreview('2');

    expect(ed.nodePreviews.get('2').enabled).toBe(false);
    expect(ed.isNodePreviewEnabled(node)).toBe(false);
    expect(node.__thumb).toBe(null);
  });

  it('toggles back and forth', () => {
    const node = { id: '3', kind: 'Add' };
    const ed = makeEditor({ nodes: [node] });

    ed.toggleNodePreview('3'); // off -> on
    expect(ed.isNodePreviewEnabled(node)).toBe(true);
    ed.toggleNodePreview('3'); // on -> off
    expect(ed.isNodePreviewEnabled(node)).toBe(false);
  });
});
