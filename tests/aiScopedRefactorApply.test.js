import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * What the panel does with a refactor once the answer arrives.
 *
 * The scope switch decided what was sent and nothing else. Both scopes ended
 * at replaceGraphWithPatch(), which clears the canvas and imports the answer
 * over it — so running a refactor on a selection of six nodes in a patch of a
 * hundred left the artist with six nodes. The two settings did the same thing,
 * and the one that promised to be narrower was the destructive one.
 *
 * These tests hold the two paths apart, and hold the thing that makes the
 * scoped one safe: the ids it splices into are the ones that were *sent*, not
 * whatever happens to be selected when the answer lands. A refactor takes
 * minutes; artists click things in the meantime.
 */

const runFeature = vi.fn();
const confirm = vi.fn();
const replaceGraphWithPatch = vi.fn();
const spliceSelectionPatch = vi.fn();
const planSelectionSplice = vi.fn();

vi.mock('../src/ai/aiClient.js', () => ({
  runFeature: (...args) => runFeature(...args),
  AIRequestError: class AIRequestError extends Error {},
  GrantError: class GrantError extends Error {},
}));

vi.mock('../src/ui/ModalManager.js', () => ({
  modalManager: {
    toast: vi.fn(),
    showModal: vi.fn(),
    createModal: (options) => options,
    confirm: (...args) => confirm(...args),
  },
}));

vi.mock('../src/ai/entitlements.js', () => ({
  entitlements: {
    current: {},
    onChange: () => () => {},
    load: async () => {},
    editorCatalog: () => [],
    upgradeUrl: 'https://art.tenderworld.org/pricing',
  },
}));

vi.mock('../src/ai/applyResult.js', () => ({
  insertGeneratedNode: vi.fn(),
  replaceGraphWithPatch: (...args) => replaceGraphWithPatch(...args),
  planSelectionSplice: (...args) => planSelectionSplice(...args),
  spliceSelectionPatch: (...args) => spliceSelectionPatch(...args),
  selectNodes: vi.fn(),
}));

vi.mock('../src/ui/accountSession.js', () => ({
  DESKTOP_ORIGIN_HINT: '',
  signInToGallery: vi.fn(),
}));

const { AIPanel } = await import('../src/ui/AIPanel.js');

/** uv → mul → mix → out, with the middle two selected. */
function seedGraph(selection) {
  window.graph = {
    nodes: [
      { id: 'uv', kind: 'UV', x: 0, y: 0, params: {} },
      { id: 'mul', kind: 'Multiply', x: 200, y: 0, params: {} },
      { id: 'mix', kind: 'Mix', x: 400, y: 0, params: {} },
      { id: 'out', kind: 'OutputFinal', x: 600, y: 0, params: {} },
    ],
    connections: [
      { from: { nodeId: 'uv', pin: 0 }, to: { nodeId: 'mul', pin: 0 } },
      { from: { nodeId: 'mul', pin: 0 }, to: { nodeId: 'mix', pin: 0 } },
      { from: { nodeId: 'mix', pin: 0 }, to: { nodeId: 'out', pin: 0 } },
    ],
    selection: new Set(selection),
  };
  window.saveLoadManager = {
    exportProject: () => ({
      nodes: window.graph.nodes.map((node) => ({
        id: node.id,
        kind: node.kind,
        position: { x: node.x, y: node.y },
        params: node.params,
      })),
      connections: window.graph.connections,
    }),
  };
}

function answered() {
  runFeature.mockResolvedValue({
    result: {
      summary: 'Folded a constant.',
      changes: [],
      patch: {
        nodes: [
          { id: 'mul', kind: 'Multiply', x: 200, y: 0, params: {} },
          { id: 'mix', kind: 'Mix', x: 400, y: 0, params: {} },
        ],
        connections: [{ from: { nodeId: 'mul', pin: 0 }, to: { nodeId: 'mix', pin: 0 } }],
      },
    },
    warnings: [],
    label: 'Patch refactor',
  });
}

describe('applying a refactor', () => {
  let panel;

  beforeEach(() => {
    runFeature.mockReset();
    confirm.mockReset().mockResolvedValue(true);
    replaceGraphWithPatch.mockReset();
    spliceSelectionPatch.mockReset().mockResolvedValue({ replaced: 2, added: 0, untouched: 2 });
    planSelectionSplice.mockReset().mockReturnValue({
      replaced: 2,
      added: 0,
      removed: [],
      untouched: 2,
      renamed: [],
      reconnected: 2,
      droppedWires: [],
      survivorIds: ['mul', 'mix'],
      projectData: { nodes: [], connections: [] },
    });
    seedGraph(['mul', 'mix']);
    answered();
    panel = new AIPanel();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('replaces the canvas when the whole patch was sent', async () => {
    panel.prefs.scope = 'patch';
    await panel.run('ai.patch_refactor', {});

    expect(replaceGraphWithPatch).toHaveBeenCalledTimes(1);
    expect(spliceSelectionPatch).not.toHaveBeenCalled();
  });

  it('splices into the selection instead of replacing the canvas', async () => {
    panel.prefs.scope = 'selection';
    await panel.run('ai.patch_refactor', {});

    expect(replaceGraphWithPatch).not.toHaveBeenCalled();
    expect(spliceSelectionPatch).toHaveBeenCalledTimes(1);
    expect(spliceSelectionPatch.mock.calls[0][1].nodeIds).toEqual(['mul', 'mix']);
  });

  it('splices into what was sent, not into a selection that moved while it ran', async () => {
    panel.prefs.scope = 'selection';

    // The artist selects something else in the minutes the call takes.
    runFeature.mockImplementation(async () => {
      window.graph.selection = new Set(['uv', 'out']);
      return {
        result: {
          summary: 'Folded a constant.',
          changes: [],
          patch: { nodes: [{ id: 'mul', kind: 'Multiply', x: 200, y: 0, params: {} }], connections: [] },
        },
        warnings: [],
        label: 'Patch refactor',
      };
    });

    await panel.run('ai.patch_refactor', {});

    expect(spliceSelectionPatch.mock.calls[0][1].nodeIds).toEqual(['mul', 'mix']);
  });

  it('tells the artist what stays as well as what changes', async () => {
    panel.prefs.scope = 'selection';
    await panel.run('ai.patch_refactor', {});

    const [message] = confirm.mock.calls[0];
    expect(message).toContain('The other 2 nodes on the canvas are left exactly as they are.');
    expect(message).toContain('2 wires to the rest of the patch stay connected.');
    expect(message).not.toContain('replaces what is on the canvas');
  });

  it('names the wires a splice cannot keep, before it is accepted', async () => {
    panel.prefs.scope = 'selection';
    planSelectionSplice.mockReturnValue({
      replaced: 1,
      added: 0,
      removed: ['mul'],
      untouched: 2,
      renamed: [],
      reconnected: 1,
      droppedWires: ['uv:0 → mul:0 (mul was removed)'],
      survivorIds: ['mix'],
      projectData: { nodes: [], connections: [] },
    });

    await panel.run('ai.patch_refactor', {});

    expect(confirm.mock.calls[0][0]).toContain('uv:0 → mul:0 (mul was removed)');
  });

  it('does nothing at all when the artist declines', async () => {
    panel.prefs.scope = 'selection';
    confirm.mockResolvedValue(false);

    await panel.run('ai.patch_refactor', {});

    expect(spliceSelectionPatch).not.toHaveBeenCalled();
    expect(replaceGraphWithPatch).not.toHaveBeenCalled();
  });
});

describe('what each feature card says the scope does to it', () => {
  let panel;

  beforeEach(() => {
    seedGraph(['mul', 'mix']);
    panel = new AIPanel();
  });

  it('says the refactor writes, where the reading features read', () => {
    panel.prefs.scope = 'selection';
    expect(panel.scopeNote('ai.patch_refactor')).toContain('leaves the rest of the patch alone');
    expect(panel.scopeNote('ai.patch_review')).toBe('Reads the selection');
  });

  it('admits the generators do not look at the scope at all', () => {
    panel.prefs.scope = 'selection';
    expect(panel.scopeNote('ai.patch_generator')).toContain('Ignores the scope');
    expect(panel.scopeNote('ai.node_generator')).toContain('Ignores the scope');
  });
});
