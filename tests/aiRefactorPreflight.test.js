import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Clicking Refactor on a patch too large to refactor.
 *
 * The refactor hands its whole input back as JSON, so what it has to write
 * grows with the patch while the deadline does not. Past a certain size the
 * call cannot finish — and because the gallery spends the artist's quota when
 * it issues the grant, before the model is called at all, letting one through
 * costs them the action, a wait of nearly five minutes, and a 504 at the end
 * of it.
 *
 * So the panel works it out first, in front of runFeature(). These tests are
 * about the thing that must not happen: no grant, no call, no charge.
 */

const runFeature = vi.fn();
const toast = vi.fn();

vi.mock('../src/ai/aiClient.js', () => ({
  runFeature: (...args) => runFeature(...args),
  AIRequestError: class AIRequestError extends Error {},
  GrantError: class GrantError extends Error {},
}));

vi.mock('../src/ui/ModalManager.js', () => ({
  modalManager: {
    toast: (...args) => toast(...args),
    showModal: vi.fn(),
    createModal: (options) => options,
    confirm: async () => false,
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
  replaceGraphWithPatch: vi.fn(),
  selectNodes: vi.fn(),
}));

vi.mock('../src/ui/accountSession.js', () => ({
  DESKTOP_ORIGIN_HINT: '',
  signInToGallery: vi.fn(),
}));

let patchContext = null;

// Only the canvas read is stubbed. The fit check itself is the real one, so a
// change to the budgets it mirrors shows up here rather than passing silently.
vi.mock('../src/ai/patchContext.js', async (importOriginal) => ({
  ...(await importOriginal()),
  buildPatchContext: () => patchContext,
}));

const { AIPanel } = await import('../src/ui/AIPanel.js');
const { syntheticPatch, largestPatch, typicalPatch } = await import('../api/_lib/tokenCost.js');

describe('the pre-flight in front of a refactor', () => {
  let panel;

  beforeEach(() => {
    runFeature.mockReset();
    toast.mockReset();
    runFeature.mockResolvedValue({
      result: { summary: 'Tidied.', changes: [], patch: { nodes: [], connections: [] } },
      warnings: [],
      label: 'Patch refactor',
    });
    panel = new AIPanel();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('spends nothing on a patch that could not finish', async () => {
    patchContext = largestPatch();

    await panel.run('ai.patch_refactor', {});

    // The whole point: the grant is never asked for, so no allowance moves.
    expect(runFeature).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('Select part of the patch'),
      'warning',
      'Too large to refactor in one call'
    );
  });

  it('says the refusal cost nothing, because that is the artist\'s first question', async () => {
    patchContext = largestPatch();

    await panel.run('ai.patch_refactor', {});

    expect(toast.mock.calls[0][0]).toMatch(/nothing has been charged/i);
  });

  it('runs a patch that fits, without a word about size', async () => {
    patchContext = typicalPatch();

    await panel.run('ai.patch_refactor', {});

    expect(runFeature).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it('warns on a large one but still runs it', async () => {
    // The band most loaded patches land in. Refusing here would cost artists a
    // feature that works; saying nothing would let them wait without warning.
    patchContext = syntheticPatch(200);

    await panel.run('ai.patch_refactor', {});

    expect(runFeature).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('large refactor'),
      'info',
      'Large refactor'
    );
  });

  it('leaves the other patch features alone', async () => {
    // Only the refactor writes its input back out. A review of the same patch
    // answers in a few hundred tokens and must not be refused.
    patchContext = largestPatch();

    await panel.run('ai.patch_review', {});

    expect(runFeature).toHaveBeenCalledTimes(1);
  });
});
