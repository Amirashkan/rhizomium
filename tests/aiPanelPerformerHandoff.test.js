// The two performer features, as the AI panel lists them.
//
// The panel draws its cards from the entitlements catalogue and gives each one
// a Run button, and for a while that included `ai.performer_scenario` and
// `ai.performer_live`. Neither can be run from here: a scenario call needs the
// rig, a live call needs a performance, and this panel has neither to send. So
// the button spent a click and the backend answered 400 "No performance state
// to act on." — the feature looked broken rather than misplaced.
//
// What is tested is the handoff: the cards stay (they are the tier's shop
// window), the button opens the coPerformer on the tab that can make the call,
// and nothing reaches runFeature().

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const toast = vi.fn();
const runFeature = vi.fn();

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

let catalog = [];

vi.mock('../src/ai/entitlements.js', () => ({
  entitlements: {
    current: { tier: 'cloude_plus', tierLabel: 'Cloude+', authenticated: true, degraded: false },
    onChange: () => () => {},
    load: async () => {},
    refresh: async () => {},
    editorCatalog: () => catalog,
    upgradeUrl: 'https://art.tenderworld.org/pricing',
  },
}));

vi.mock('../src/ai/applyResult.js', () => ({
  insertGeneratedNode: vi.fn(),
  replaceGraphWithPatch: vi.fn(),
  selectNodes: vi.fn(),
  planSelectionSplice: vi.fn(),
  spliceSelectionPatch: vi.fn(),
}));

vi.mock('../src/ui/accountSession.js', () => ({
  DESKTOP_ORIGIN_HINT: '',
  signInToGallery: vi.fn(),
}));

const { AIPanel } = await import('../src/ui/AIPanel.js');

/** The card for a feature, found the way the panel itself tags them. */
function cardFor(panel, feature) {
  return [...panel.dock.querySelectorAll('.ai-feature')].find(
    (element) => element.dataset.feature === feature
  );
}

describe('the performer features in the AI panel', () => {
  let panel;
  let performerPanel;

  beforeEach(() => {
    localStorage.clear();
    toast.mockReset();
    runFeature.mockReset();

    catalog = [
      {
        feature: 'ai.performer_live',
        label: 'Live performer',
        surface: 'editor',
        allowed: true,
        quota: { limit: 40, windowSeconds: 3600 },
        used: 0,
      },
      {
        feature: 'ai.performer_scenario',
        label: 'Performance scenario',
        surface: 'editor',
        allowed: true,
        quota: { limit: 5, windowSeconds: 86400 },
        used: 1,
      },
    ];

    // A graph is present, so nothing can pass for want of one: the point is
    // that these two never ask for a patch in the first place.
    window.graph = { nodes: [{ id: 1 }, { id: 2 }], connections: [], selection: new Set() };

    performerPanel = { show: vi.fn(), showTab: vi.fn() };
    window.performerPanel = performerPanel;

    panel = new AIPanel();
  });

  afterEach(() => {
    panel.hide();
    delete window.graph;
    delete window.performerPanel;
  });

  it('still lists both, with what is left of their allowance', async () => {
    await panel.show();

    expect(cardFor(panel, 'ai.performer_live')).toBeTruthy();
    expect(cardFor(panel, 'ai.performer_scenario')).toBeTruthy();
    expect(panel.dock.textContent).toContain('40 of 40 left today');
    expect(panel.dock.textContent).toContain('4 of 5 left today');
  });

  it('offers to open the coPerformer instead of a Run that cannot work', async () => {
    await panel.show();

    const live = cardFor(panel, 'ai.performer_live').querySelector('.ai-feature-run');
    expect(live.textContent).toBe('Open coPerformer');
    expect(live.disabled).toBe(false);
    expect(cardFor(panel, 'ai.performer_live').textContent).toContain('Let the AI improvise live');
  });

  it('opens the coPerformer on the tab that can make the call', async () => {
    await panel.show();

    cardFor(panel, 'ai.performer_live').querySelector('.ai-feature-run').click();
    expect(performerPanel.show).toHaveBeenCalled();
    expect(performerPanel.showTab).toHaveBeenCalledWith('set');

    cardFor(panel, 'ai.performer_scenario').querySelector('.ai-feature-run').click();
    expect(performerPanel.showTab).toHaveBeenLastCalledWith('scenario');
  });

  it('never sends a live call from here, whichever way it is started', async () => {
    await panel.show();

    cardFor(panel, 'ai.performer_live').querySelector('.ai-feature-run').click();
    await panel.run('ai.performer_live', {});

    expect(runFeature).not.toHaveBeenCalled();
  });

  it('says so when the build has no coPerformer, rather than doing nothing', async () => {
    delete window.performerPanel;
    await panel.show();

    cardFor(panel, 'ai.performer_live').querySelector('.ai-feature-run').click();

    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('not available in this build'),
      'warning',
      'Live performer'
    );
  });
});
