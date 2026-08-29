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

/** The Editor's own minimal event bus, enough for GRAPH_CHANGED. */
function fakeEventSystem() {
  const listeners = new Map();
  return {
    on: (e, cb) => { if (!listeners.has(e)) listeners.set(e, new Set()); listeners.get(e).add(cb); },
    off: (e, cb) => listeners.get(e)?.delete(cb),
    emit: (e, data) => listeners.get(e)?.forEach((cb) => cb(data)),
    count: (e) => listeners.get(e)?.size || 0,
  };
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
      eventSystem: fakeEventSystem(),
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

/**
 * Commenting on the node you have selected.
 *
 * The composer used to remember the node picked the last time it was open, so
 * "select a node, click New comment" quietly filed the comment against the
 * previous one. The target is re-read from the canvas every time the form
 * opens, and the button says which node it will hit.
 */
describe('composing against the selected node', () => {
  let panel;

  beforeEach(() => {
    localStorage.clear();
    _resetAnnotationStore();
    window.innerWidth = 1400;
    window.editor = {
      graph: {
        nodes: [makeNode('n1', 'Edge Detect'), makeNode('n2', 'Mix'), makeNode('n3', 'Blur')],
        selection: new Set(),
      },
      markDirty: vi.fn(),
      viewport: { fitToContent: vi.fn() },
      eventSystem: fakeEventSystem(),
    };
    panel = getReviewPanel();
  });

  afterEach(() => {
    if (panel.isOpen) panel.hide();
    delete window.editor;
  });

  const openComposer = () => panel.dock.querySelector('#review-compose-toggle').click();

  it('names the selected node on the compose button', () => {
    window.editor.graph.selection = new Set(['n3']);
    panel.show();
    expect(panel.dock.querySelector('#review-compose-toggle').textContent).toContain('Blur');
  });

  it('falls back to a generic label when nothing is selected', () => {
    panel.show();
    expect(panel.dock.querySelector('#review-compose-toggle').textContent).toContain('New comment');
  });

  it('says nothing about a node when several are selected', () => {
    window.editor.graph.selection = new Set(['n1', 'n2']);
    panel.show();
    expect(panel.dock.querySelector('#review-compose-toggle').textContent).toContain('New comment');
  });

  it('re-reads the selection every time the composer opens', () => {
    window.editor.graph.selection = new Set(['n1']);
    panel.show();
    openComposer();
    expect(panel.dock.querySelector('#review-compose-node').value).toBe('n1');

    // Close it, select something else, open it again.
    openComposer();
    window.editor.graph.selection = new Set(['n3']);
    openComposer();
    expect(panel.dock.querySelector('#review-compose-node').value).toBe('n3');
  });

  it('does not inherit the node the previous comment was filed against', () => {
    window.editor.graph.selection = new Set(['n1']);
    panel.show();
    openComposer();
    panel.drafts.text = 'first';
    panel.postComment();

    window.editor.graph.selection = new Set(['n2']);
    panel.render();
    openComposer();
    expect(panel.dock.querySelector('#review-compose-node').value).toBe('n2');
  });

  it('still honours a node picked by hand in the dropdown', () => {
    window.editor.graph.selection = new Set(['n1']);
    panel.show();
    openComposer();

    const select = panel.dock.querySelector('#review-compose-node');
    select.value = 'n3';
    select.dispatchEvent(new Event('change'));
    panel.drafts.text = 'on the one I picked';
    panel.postComment();

    expect(getAnnotationStore().all()[0].nodeId).toBe('n3');
  });

  it('opens on a given node from the canvas, selecting it too', () => {
    expect(panel.composeFor('n2')).toBe(true);
    expect(panel.isOpen).toBe(true);
    expect(panel.composing).toBe(true);
    expect(panel.dock.querySelector('#review-compose-node').value).toBe('n2');
    expect([...window.editor.graph.selection]).toEqual(['n2']);
  });

  it('refuses to compose against a node that is not there', () => {
    expect(panel.composeFor('nope')).toBe(false);
  });

  it('updates the button when the canvas selection changes under it', () => {
    panel.show();
    expect(panel.dock.querySelector('#review-compose-toggle').textContent).toContain('New comment');

    window.editor.graph.selection = new Set(['n2']);
    document.dispatchEvent(new Event('mouseup'));

    expect(panel.dock.querySelector('#review-compose-toggle').textContent).toContain('Mix');
  });
});

/**
 * Deleting a node.
 *
 * Its comments are kept — review history is dismissed on purpose, not lost to
 * a keystroke elsewhere on the canvas — but the panel has to SAY so the moment
 * it happens, rather than going on naming a node that is gone.
 */
describe('when a node is deleted', () => {
  let panel;

  beforeEach(() => {
    localStorage.clear();
    _resetAnnotationStore();
    window.innerWidth = 1400;
    window.editor = {
      graph: { nodes: [makeNode('n1', 'Edge Detect'), makeNode('n2', 'Mix')], selection: new Set() },
      markDirty: vi.fn(),
      viewport: { fitToContent: vi.fn() },
      eventSystem: fakeEventSystem(),
    };
    panel = getReviewPanel();
  });

  afterEach(() => {
    if (panel.isOpen) panel.hide();
    delete window.editor;
  });

  /** Delete a node the way Editor.deleteNode does: splice, then announce. */
  const deleteNode = (id) => {
    const graph = window.editor.graph;
    graph.nodes = graph.nodes.filter((n) => n.id !== id);
    window.editor.eventSystem.emit('GRAPH_CHANGED', { action: 'Node Deletion' });
  };

  it('marks the comment orphaned as soon as the node goes', () => {
    getAnnotationStore().add({ nodeId: 'n1', tag: 'blocker', text: 'about to lose my node' });
    panel.show();
    expect(panel.dock.querySelector('.review-card').classList.contains('is-orphan')).toBe(false);

    deleteNode('n1');

    const card = panel.dock.querySelector('.review-card');
    expect(card.classList.contains('is-orphan')).toBe(true);
    expect(card.querySelector('.review-node-name').textContent).toMatch(/deleted node/i);
    expect(card.querySelector('.review-focus').disabled).toBe(true);
    expect(panel.dock.querySelector('.review-orphan-note')).not.toBeNull();
  });

  it('keeps the comment rather than destroying it', () => {
    getAnnotationStore().add({ nodeId: 'n1', text: 'still worth reading' });
    panel.show();
    deleteNode('n1');

    expect(getAnnotationStore().all()).toHaveLength(1);
    expect(panel.dock.querySelectorAll('.review-card')).toHaveLength(1);
  });

  it('leaves comments on surviving nodes alone', () => {
    const store = getAnnotationStore();
    store.add({ nodeId: 'n1', text: 'doomed' });
    store.add({ nodeId: 'n2', text: 'fine' });
    panel.show();
    deleteNode('n1');

    const cards = [...panel.dock.querySelectorAll('.review-card')];
    expect(cards.map((c) => c.classList.contains('is-orphan'))).toEqual([true, false]);
  });

  it('un-orphans the comment when undo puts the node back', () => {
    getAnnotationStore().add({ nodeId: 'n1', text: 'comes back' });
    panel.show();
    deleteNode('n1');
    expect(panel.dock.querySelector('.review-card').classList.contains('is-orphan')).toBe(true);

    window.editor.graph.nodes.unshift(makeNode('n1', 'Edge Detect'));
    window.editor.eventSystem.emit('GRAPH_CHANGED', { action: 'Undo' });

    const card = panel.dock.querySelector('.review-card');
    expect(card.classList.contains('is-orphan')).toBe(false);
    expect(card.querySelector('.review-node-name').textContent).toContain('Edge Detect');
  });

  it('stops listening to the graph once it is closed', () => {
    panel.show();
    expect(window.editor.eventSystem.count('GRAPH_CHANGED')).toBe(1);
    panel.hide();
    expect(window.editor.eventSystem.count('GRAPH_CHANGED')).toBe(0);
  });
});

/**
 * The counters.
 *
 * Open work is the accent, the way live state reads everywhere else in this
 * editor — not amber, which is the app's warning colour and already means
 * "Change" on the tag pills. And a count of nobody's problem is not painted
 * like a problem.
 */
describe('the count tiles', () => {
  let panel;

  beforeEach(() => {
    localStorage.clear();
    _resetAnnotationStore();
    window.innerWidth = 1400;
    window.editor = {
      graph: { nodes: [makeNode('n1', 'Edge Detect')], selection: new Set() },
      markDirty: vi.fn(),
      viewport: { fitToContent: vi.fn() },
      eventSystem: fakeEventSystem(),
    };
    panel = getReviewPanel();
  });

  afterEach(() => {
    if (panel.isOpen) panel.hide();
    delete window.editor;
  });

  const tile = (kind) => panel.dock.querySelector(`.review-stat.is-${kind}`);

  it('dims every tile when there is nothing to report', () => {
    panel.show();
    for (const kind of ['open', 'resolved', 'blockers']) {
      expect(tile(kind).classList.contains('is-empty')).toBe(true);
    }
  });

  it('lights only the tiles that have something in them', () => {
    getAnnotationStore().add({ nodeId: 'n1', tag: 'question', text: 'just a question' });
    panel.show();

    expect(tile('open').classList.contains('is-empty')).toBe(false);
    // A question is not a blocker, so the red tile stays quiet.
    expect(tile('blockers').classList.contains('is-empty')).toBe(true);
    expect(tile('resolved').classList.contains('is-empty')).toBe(true);
  });

  it('moves a comment from open to resolved as it is resolved', () => {
    const a = getAnnotationStore().add({ nodeId: 'n1', tag: 'blocker', text: 'blocking' });
    panel.show();
    expect(tile('open').querySelector('.review-stat-value').textContent).toBe('1');
    expect(tile('blockers').querySelector('.review-stat-value').textContent).toBe('1');

    getAnnotationStore().toggleResolve(a.id);

    expect(tile('open').querySelector('.review-stat-value').textContent).toBe('0');
    expect(tile('blockers').querySelector('.review-stat-value').textContent).toBe('0');
    expect(tile('resolved').querySelector('.review-stat-value').textContent).toBe('1');
    expect(tile('blockers').classList.contains('is-empty')).toBe(true);
  });
});
