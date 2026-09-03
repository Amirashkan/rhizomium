import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * What the panel shows for a director answer, and in particular what it shows
 * when there is no arc in one.
 *
 * The arc is written by the backend, not by this bundle: the prompt that asks
 * for one and the schema that shapes it live in api/_lib/features.js. So an
 * editor can be newer than the deployment it is talking to and get an answer in
 * the older shape — which used to draw exactly like an answer from before arcs
 * existed. Prose, no arc, and no way for an artist to tell that apart from a
 * director who judged the patch not ready, or from something broken.
 *
 * Those three cases are here together because the only thing separating them on
 * screen is what this file asserts.
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

const { AIPanel } = await import('../src/ui/AIPanel.js');

/** The prose half, which every director answer has. */
const PROSE = {
  reading: 'A field that states its idea in ten seconds and repeats it.',
  directions: [
    {
      title: 'Withhold the scale',
      rationale: 'It arrives already open.',
      steps: ['Start small.'],
      nodeIds: ['field1'],
    },
  ],
};

const ARC = {
  title: 'Opening out',
  summary: 'Held small, then opened across the second half.',
  durationSeconds: 64,
  sections: [{ name: 'Held', startSeconds: 0, intent: 'Nothing moves but the noise.' }],
  moves: [
    {
      nodeId: 'field1',
      param: 'scale',
      why: 'Withhold the scale',
      keyframes: [
        { atSeconds: 0, value: 0.4, ease: 'linear' },
        { atSeconds: 64, value: 4.5, ease: 'ease-out' },
      ],
    },
  ],
};

describe('a director answer in the panel', () => {
  let panel;

  beforeEach(async () => {
    runFeature.mockReset();
    toast.mockReset();
    panel = new AIPanel();
    await panel.show();
  });

  async function present(result) {
    await panel.presentResult('ai.creative_director', 'AI creative director', result, [], {
      durationMs: 1000,
    });
  }

  it('draws the arc, its shape and the way onto the timeline', async () => {
    await present({ ...PROSE, arc: ARC });

    const arc = panel.dock.querySelector('.ai-arc');
    expect(arc).toBeTruthy();
    expect(arc.classList.contains('is-absent')).toBe(false);
    expect(arc.textContent).toContain('Opening out');
    // Length, moves and keyframes, as an artist reads them off the timeline.
    expect(arc.querySelector('.ai-arc-meta').textContent).toBe('1:04 · 1 move · 2 keyframes');
    expect(arc.textContent).toContain('field1.scale');
    expect(
      [...arc.querySelectorAll('button')].some((b) => b.textContent.includes('Put this on the timeline'))
    ).toBe(true);
  });

  it('says so when the answer carries no arc at all', async () => {
    // The regression worth a test: this used to render nothing, so an editor
    // talking to a deployment without the arc backend looked identical to one
    // where the feature had never been built.
    await present({ ...PROSE });

    const arc = panel.dock.querySelector('.ai-arc');
    expect(arc).toBeTruthy();
    expect(arc.classList.contains('is-absent')).toBe(true);
    expect(arc.textContent).toContain('No arc in this answer');
    // And it points at the half that is missing, since that is what decides
    // who fixes it.
    expect(arc.textContent).toMatch(/backend/i);
    // Nothing to press: there is no arc to apply.
    expect(arc.querySelectorAll('button')).toHaveLength(0);
    // The direction still stands.
    expect(panel.dock.textContent).toContain('Withhold the scale');
  });

  it('distinguishes an empty arc from a missing one', async () => {
    // The director was asked and declined: this patch needs work first. That is
    // an answer, and it says so even with no summary to sit under.
    await present({ ...PROSE, arc: { ...ARC, summary: '', moves: [] } });

    const arc = panel.dock.querySelector('.ai-arc');
    expect(arc.classList.contains('is-absent')).toBe(false);
    expect(arc.textContent).toContain('No moves');
    expect(arc.textContent).not.toContain('No arc in this answer');
    expect(arc.querySelectorAll('button')).toHaveLength(0);
  });
});
