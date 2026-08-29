import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The review dock's seams.
 *
 * The panel itself is markup, and testing markup line by line mostly tests the
 * markup. What is worth pinning down is where it touches the rest of the app:
 * that opening it narrows the canvas and closing it gives the width back, that
 * a canvas badge and the list agree on which comment is selected, and that
 * comment text — which people type and the store reads back — reaches the page
 * as text rather than as markup.
 */

vi.mock('../src/ui/ModalManager.js', () => ({
  modalManager: {
    confirm: async () => false,
    toast: vi.fn(),
    showModal: vi.fn(),
    createModal: (options) => options,
  },
}));

vi.mock('../src/ui/iconSprite.js', () => ({
  iconMarkup: () => '<svg></svg>',
  createIcon: () => document.createElement('svg'),
  ensureIconSprite: () => {},
}));

const { getReviewPanel } = await import('../src/ui/ReviewPanel.js');
const { getAnnotationStore, _resetAnnotationStore } = await import(
  '../src/core/AnnotationStore.js'
);
const { getRightDockWidth } = await import('../src/ui/dockLayout.js');

function makeNode(id, name, x = 0, y = 0) {
  return { id, kind: 'Mix', name, x, y, w: 160, h: 80 };
}

describe('the review dock', () => {
  let panel;

  beforeEach(() => {
    localStorage.clear();
    _resetAnnotationStore();
    window.innerWidth = 1400;
    window.editor = {
      graph: { nodes: [makeNode('n1', 'Edge Detect'), makeNode('n2', 'Mix')], selection: new Set() },
      markDirty: vi.fn(),
      viewport: { fitToContent: vi.fn() },
    };
    panel = getReviewPanel();
  });

  afterEach(() => {
    if (panel.isOpen) panel.hide();
    delete window.editor;
  });

  it('hands the canvas back its width when it closes', () => {
    expect(getRightDockWidth()).toBe(0);
    panel.show();
    expect(getRightDockWidth()).toBeGreaterThan(0);
    panel.hide();
    expect(getRightDockWidth()).toBe(0);
  });

  it('never takes more than half the window', () => {
    window.innerWidth = 600;
    panel.show();
    expect(panel.applyWidth(5000)).toBeLessThanOrEqual(300);
  });

  it('shows an invitation when the patch has no comments yet', () => {
    panel.show();
    expect(panel.dock.querySelector('.review-empty').textContent).toMatch(/no comments/i);
  });

  it('renders a card per comment, with the count in the header', () => {
    const store = getAnnotationStore();
    store.add({ nodeId: 'n1', tag: 'blocker', text: 'no decay in the loop' });
    store.add({ nodeId: 'n2', tag: 'praise', text: 'lovely drift' });
    panel.show();

    expect(panel.dock.querySelectorAll('.review-card')).toHaveLength(2);
    expect(panel.dock.querySelector('#review-total').textContent).toBe('2 comments');
  });

  it('redraws itself when the store changes underneath it', () => {
    panel.show();
    expect(panel.dock.querySelectorAll('.review-card')).toHaveLength(0);

    getAnnotationStore().add({ nodeId: 'n1', text: 'added from the canvas' });
    expect(panel.dock.querySelectorAll('.review-card')).toHaveLength(1);
  });

  it('follows the filter', () => {
    const store = getAnnotationStore();
    const a = store.add({ nodeId: 'n1', text: 'open one' });
    const b = store.add({ nodeId: 'n2', text: 'done one' });
    store.toggleResolve(b.id);
    panel.show();

    store.setFilter('open');
    const shown = [...panel.dock.querySelectorAll('.review-card')].map((c) => c.dataset.id);
    expect(shown).toEqual([a.id]);
  });

  it('puts comment text on the page as text, not as markup', () => {
    getAnnotationStore().add({
      nodeId: 'n1',
      text: '<img src=x onerror="boom()"> and <b>bold</b>',
    });
    panel.show();

    const text = panel.dock.querySelector('.review-text');
    expect(text.querySelector('img')).toBeNull();
    expect(text.querySelector('b')).toBeNull();
    expect(text.textContent).toContain('<b>bold</b>');
  });

  it('escapes a node name that contains markup', () => {
    window.editor.graph.nodes = [makeNode('n1', '<script>x</script>')];
    getAnnotationStore().add({ nodeId: 'n1', text: 'hello' });
    panel.show();

    const name = panel.dock.querySelector('.review-node-name');
    expect(name.querySelector('script')).toBeNull();
    expect(name.textContent).toContain('<script>x</script>');
  });

  it('opens on the comment a canvas badge asked for', () => {
    const store = getAnnotationStore();
    const a = store.add({ nodeId: 'n1', text: 'click me' });
    store.setSelected(null);

    store.setSelected(a.id);
    panel.revealComment(a.id);

    expect(panel.isOpen).toBe(true);
    expect(panel.dock.querySelector('.review-card.is-active')?.dataset.id).toBe(a.id);
  });

  it('offers a reply box only on the selected comment', () => {
    const store = getAnnotationStore();
    store.add({ nodeId: 'n1', text: 'one' });
    store.add({ nodeId: 'n2', text: 'two' });
    panel.show();

    expect(panel.dock.querySelectorAll('.review-reply-compose')).toHaveLength(1);
  });

  it('names a deleted node as deleted and cannot focus it', () => {
    getAnnotationStore().add({ nodeId: 'gone', text: 'orphaned' });
    panel.show();

    const card = panel.dock.querySelector('.review-card');
    expect(card.classList.contains('is-orphan')).toBe(true);
    expect(card.querySelector('.review-node-name').textContent).toMatch(/deleted node/i);
    expect(card.querySelector('.review-focus').disabled).toBe(true);
    expect(panel.dock.querySelector('.review-orphan-note')).not.toBeNull();
  });

  it('brings a comment’s node into view and selects it', () => {
    const store = getAnnotationStore();
    const a = store.add({ nodeId: 'n2', text: 'look here' });
    panel.show();

    panel.focusNode(store.get(a.id));

    expect(window.editor.viewport.fitToContent).toHaveBeenCalled();
    expect([...window.editor.graph.selection]).toEqual(['n2']);
  });

  it('composes against the node selected on the canvas', () => {
    window.editor.graph.selection = new Set(['n2']);
    panel.show();
    panel.composing = true;
    panel.render();

    expect(panel.dock.querySelector('#review-compose-node').value).toBe('n2');
  });

  it('posts a comment and closes the composer', () => {
    panel.show();
    panel.composing = true;
    panel.render();

    panel.drafts.nodeId = 'n1';
    panel.drafts.tag = 'change';
    panel.drafts.text = 'lower the threshold';
    panel.postComment();

    expect(getAnnotationStore().all()).toHaveLength(1);
    expect(panel.composing).toBe(false);
    expect(panel.drafts.text).toBe('');
  });

  it('will not post an empty comment', () => {
    panel.show();
    panel.composing = true;
    panel.render();
    panel.drafts.nodeId = 'n1';
    panel.drafts.text = '   ';
    panel.postComment();

    expect(getAnnotationStore().all()).toHaveLength(0);
    // Still open, so the draft is not silently swallowed.
    expect(panel.composing).toBe(true);
  });
});

describe('relativeTime', () => {
  it('reads as a review does: recent first, dates only once it is old', async () => {
    const { relativeTime } = await import('../src/ui/ReviewPanel.js');
    const now = Date.parse('2026-06-28T12:00:00Z');
    const ago = (ms) => relativeTime(now - ms, now);

    expect(ago(5_000)).toBe('now');
    expect(ago(4 * 60_000)).toBe('4m');
    expect(ago(3 * 3_600_000)).toBe('3h');
    expect(ago(2 * 86_400_000)).toBe('2d');
    expect(ago(40 * 86_400_000)).not.toMatch(/^\d+d$/);
  });
});
