import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The AI panel as a dock rather than a dialog.
 *
 * The point of docking it is that the canvas stays visible and reachable while
 * it is open: every feature in the panel talks about the graph, and a modal
 * covering the graph made "show me those nodes" a promise the panel could not
 * keep. So what is tested here is mostly the seam — that opening the panel
 * actually hands the canvas a narrower window, and that closing it gives the
 * width back.
 */

const toast = vi.fn();

vi.mock('../src/ai/aiClient.js', () => ({
  runFeature: vi.fn(),
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
    current: { tier: 'free', tierLabel: 'Free', authenticated: true, degraded: false },
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
}));

vi.mock('../src/ui/accountSession.js', () => ({
  DESKTOP_ORIGIN_HINT: '',
  signInToGallery: vi.fn(),
}));

const { AIPanel } = await import('../src/ui/AIPanel.js');
const { canvasViewportWidth, getRightDockWidth } = await import('../src/ui/dockLayout.js');

const inset = () => document.documentElement.style.getPropertyValue('--rz-canvas-inset-right');

describe('the AI dock and the canvas beside it', () => {
  let panel;

  beforeEach(() => {
    localStorage.clear();
    catalog = [];
    toast.mockReset();
    delete window.graph;
    panel = new AIPanel();
  });

  afterEach(() => {
    panel.hide();
  });

  it('takes width from the canvas while open and gives it back on close', async () => {
    const full = window.innerWidth;

    await panel.show();
    const width = panel.dock.offsetWidth || panel.prefs.width;

    expect(getRightDockWidth()).toBe(width);
    expect(inset()).toBe(`${width}px`);
    expect(canvasViewportWidth()).toBe(full - width);

    panel.hide();

    expect(getRightDockWidth()).toBe(0);
    expect(inset()).toBe('0px');
    expect(canvasViewportWidth()).toBe(full);
  });

  it('never takes more than half the window', async () => {
    window.innerWidth = 900;
    panel.prefs.width = 800;

    await panel.show();

    expect(getRightDockWidth()).toBeLessThanOrEqual(450);
    expect(canvasViewportWidth()).toBeGreaterThanOrEqual(450);

    window.innerWidth = 1024;
  });

  it('remembers the width it was left at', async () => {
    await panel.show();
    panel.applyWidth(460);
    panel.hide();

    const stored = JSON.parse(localStorage.getItem('glsl-node-editor.ai-panel.prefs'));
    expect(stored.width).toBe(460);
  });

  it('toggles from the same entry point', async () => {
    await panel.toggle();
    expect(panel.isOpen).toBe(true);

    await panel.toggle();
    expect(panel.isOpen).toBe(false);
    expect(inset()).toBe('0px');
  });
});

describe('what the dock says a call will carry', () => {
  let panel;

  beforeEach(() => {
    localStorage.clear();
    toast.mockReset();
    catalog = [
      {
        feature: 'ai.patch_review',
        label: 'Patch review',
        surface: 'editor',
        allowed: true,
        quota: { limit: 15, windowSeconds: 86400 },
        used: 3,
      },
    ];
    window.graph = {
      nodes: [{ id: 1 }, { id: 2 }, { id: 3 }],
      connections: [{ from: { nodeId: 1 }, to: { nodeId: 2 } }],
      selection: new Set(),
    };
    panel = new AIPanel();
  });

  afterEach(() => {
    panel.hide();
    delete window.graph;
  });

  it('counts the graph without touching the project exporter', async () => {
    await panel.show();

    const text = panel.dock.textContent;
    expect(text).toContain('Nodes sent');
    expect(text).toContain('Wires');
    // 12 of 15 left, and the allowance summary agrees.
    expect(text).toContain('12 of 15 left today');
    expect(text).toContain('Actions left today');
  });

  it('refuses to run a reading feature on an empty selection, and says why', async () => {
    panel.prefs.scope = 'selection';
    await panel.show();

    expect(panel.dock.textContent).toContain('nothing is selected');
    const run = panel.dock.querySelector('.ai-feature-run');
    expect(run.disabled).toBe(true);
  });

  it('runs once something is selected', async () => {
    panel.prefs.scope = 'selection';
    window.graph.selection = new Set([1]);
    await panel.show();

    const run = panel.dock.querySelector('.ai-feature-run');
    expect(run.disabled).toBe(false);
    expect(panel.dock.textContent).toContain('Reads the selection');
  });

  it('disables a feature whose allowance is spent', async () => {
    catalog[0].used = 15;
    await panel.show();

    const run = panel.dock.querySelector('.ai-feature-run');
    expect(run.disabled).toBe(true);
    expect(panel.dock.textContent).toContain('0 of 15 left today');
  });
});
