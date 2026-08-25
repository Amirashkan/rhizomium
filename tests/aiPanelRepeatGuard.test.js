import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Clicking a read-only AI feature twice on an unchanged canvas.
 *
 * The gallery spends the artist's quota when it issues the grant, before the
 * model is called at all, so a duplicate run is paid for whether or not it says
 * anything new. The panel has to catch it in front of runFeature() — and has to
 * catch it without ever refusing an artist who genuinely wants another opinion.
 */

const runFeature = vi.fn();
const toast = vi.fn();
const showModal = vi.fn();

vi.mock('../src/ai/aiClient.js', () => ({
  runFeature: (...args) => runFeature(...args),
  AIRequestError: class AIRequestError extends Error {},
  GrantError: class GrantError extends Error {},
}));

vi.mock('../src/ui/ModalManager.js', () => ({
  modalManager: {
    toast: (...args) => toast(...args),
    showModal: (...args) => showModal(...args),
    createModal: (options) => options,
    confirm: async () => false,
  },
}));

vi.mock('../src/ai/entitlements.js', () => ({
  entitlements: { current: {}, onChange: () => () => {}, load: async () => {} },
}));

vi.mock('../src/ai/applyResult.js', () => ({
  insertGeneratedNode: vi.fn(),
  replaceGraphWithPatch: vi.fn(),
  selectNodes: vi.fn(),
}));

vi.mock('../src/ui/accountSession.js', () => ({
  DESKTOP_ORIGIN_HINT: '',
  signInToGallery: vi.fn(),
}));

let patchContext = { nodes: [{ id: 'a', kind: 'UV', x: 0, y: 0 }], connections: [] };

vi.mock('../src/ai/patchContext.js', () => ({
  buildPatchContext: () => patchContext,
  EmptyPatchError: class EmptyPatchError extends Error {},
  PatchTooLargeError: class PatchTooLargeError extends Error {},
}));

const { AIPanel } = await import('../src/ui/AIPanel.js');

function answered(summary) {
  runFeature.mockResolvedValue({
    result: { summary, findings: [] },
    warnings: [],
    label: 'Patch review',
  });
}

describe('running the same read-only feature twice', () => {
  let panel;

  beforeEach(() => {
    runFeature.mockReset();
    toast.mockReset();
    showModal.mockReset();
    patchContext = { nodes: [{ id: 'a', kind: 'UV', x: 0, y: 0 }], connections: [] };
    panel = new AIPanel();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('does not call the backend again when nothing has changed', async () => {
    answered('Fine.');

    await panel.run('ai.patch_review', {});
    await panel.run('ai.patch_review', {});

    expect(runFeature).toHaveBeenCalledTimes(1);
  });

  it('shows the previous answer rather than nothing at all', async () => {
    answered('Two dead branches.');

    await panel.run('ai.patch_review', {});
    showModal.mockReset();
    await panel.run('ai.patch_review', {});

    // The artist clicked a button; something has to open.
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('Nothing has changed'),
      'info',
      'Patch review'
    );
  });

  it('runs for real on the click after that', async () => {
    answered('Fine.');

    await panel.run('ai.patch_review', {});
    await panel.run('ai.patch_review', {}); // deferred, answered from memory
    await panel.run('ai.patch_review', {}); // the artist meant it

    expect(runFeature).toHaveBeenCalledTimes(2);
  });

  it('runs again as soon as the canvas moves', async () => {
    answered('Fine.');

    await panel.run('ai.patch_review', {});
    patchContext = { nodes: [{ id: 'a', kind: 'UV', x: 40, y: 0 }], connections: [] };
    await panel.run('ai.patch_review', {});

    expect(runFeature).toHaveBeenCalledTimes(2);
  });

  it('tells two features apart', async () => {
    answered('Fine.');

    await panel.run('ai.patch_review', {});
    await panel.run('ai.canvas_assist', {});

    expect(runFeature).toHaveBeenCalledTimes(2);
  });

  it('never holds back a feature that changes the canvas', async () => {
    // Asking a generator the same thing twice is how an artist asks for a
    // different idea, not a mistake to be saved from.
    runFeature.mockResolvedValue({
      result: { name: 'Curve mix', inputs: [], outputType: 'f32', code: 'input0' },
      warnings: [],
      label: 'Node generator',
    });

    await panel.run('ai.node_generator', { description: 'mix by a curve' });
    await panel.run('ai.node_generator', { description: 'mix by a curve' });

    expect(runFeature).toHaveBeenCalledTimes(2);
  });

  it('remembers nothing from a call that failed', async () => {
    runFeature.mockRejectedValueOnce(new Error('network'));
    await panel.run('ai.patch_review', {});

    answered('Fine.');
    await panel.run('ai.patch_review', {});

    expect(runFeature).toHaveBeenCalledTimes(2);
  });
});
