import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * What the AI panel says while debug mode is on.
 *
 * The panel is the only place the mode is visible, and it has to be visible:
 * `?aidebug=1` can arrive in a shared link, and an artist who follows one would
 * otherwise see every paid feature unlocked, no allowance spent, and a first
 * run that fails at the backend for no reason they could see.
 *
 * The entitlements client here is the real one — that is the seam under test.
 * Everything else the panel pulls in is mocked, as in aiPanelDock.test.js.
 */

vi.mock('../src/ai/aiClient.js', () => ({
  runFeature: vi.fn(),
  AIRequestError: class AIRequestError extends Error {},
  GrantError: class GrantError extends Error {},
}));

vi.mock('../src/ui/ModalManager.js', () => ({
  modalManager: {
    toast: vi.fn(),
    showModal: vi.fn(),
    createModal: (options) => options,
    confirm: async () => false,
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

const { AIPanel } = await import('../src/ui/AIPanel.js');
const { setAIDebugMode, resetAIDebugMode } = await import('../src/ai/debugMode.js');

describe('the AI panel with debug mode on', () => {
  let panel;

  beforeEach(() => {
    localStorage.clear();
    resetAIDebugMode();
    delete window.graph;
    // Nothing in this file should reach the gallery; a call that tries is a
    // failure of the mode, not a network flake.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'));
    // Which the client reports on its way to the free-tier fallback; that is
    // the behaviour under test elsewhere, and noise here.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    panel = new AIPanel();
  });

  afterEach(() => {
    panel.hide();
    resetAIDebugMode();
    vi.restoreAllMocks();
  });

  it('says Debug on the badge instead of a plan, and offers the way out', async () => {
    setAIDebugMode(true);
    await panel.show();

    const badge = panel.dock.querySelector('#ai-panel-tier');
    expect(badge.textContent).toBe('Debug');
    expect(badge.className).toContain('tier-debug');

    const body = panel.dock.querySelector('#ai-panel-body');
    expect(body.textContent).toContain('AI debug mode is on');
    // The backend half is the part that is easy to forget and hard to diagnose.
    expect(body.textContent).toContain('AI_DEBUG_MODE');
    expect(
      [...body.querySelectorAll('button')].some((button) => button.textContent === 'Turn off')
    ).toBe(true);

    // The sign-in prompt is about an account the mode is not consulting.
    expect(body.textContent).not.toContain('You are signed out');
  });

  it('draws every feature as available and nothing as metered', async () => {
    setAIDebugMode(true);
    await panel.show();

    const body = panel.dock.querySelector('#ai-panel-body');
    expect(body.textContent).toContain('Nothing is metered while debug mode is on');
    expect(body.textContent).not.toContain('Upgrade to');
  });

  it('draws a plan, not a mode, when it is off', async () => {
    await panel.show();

    const badge = panel.dock.querySelector('#ai-panel-tier');
    expect(badge.textContent).not.toBe('Debug');
    expect(badge.className).not.toContain('tier-debug');
    expect(panel.dock.querySelector('#ai-panel-body').textContent).not.toContain('AI debug mode is on');
  });
});
