import { describe, it, expect, beforeEach } from 'vitest';
import {
  AnnotationStore,
  normalizeCommentText,
  MAX_COMMENT_LENGTH,
} from '../src/core/AnnotationStore.js';

/**
 * The review layer's data model.
 *
 * Everything here runs without a canvas, a GPU or a DOM, which is the point:
 * the store is what the renderer reads every frame and what the dock rewrites
 * on every keystroke, so it stays a plain structure that can be reasoned about
 * on its own.
 */

/** A localStorage stand-in, so a test can watch what was actually persisted. */
function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe('AnnotationStore', () => {
  let storage;
  let store;

  beforeEach(() => {
    storage = fakeStorage();
    store = new AnnotationStore({ storage, projectKey: 'patch-a' });
  });

  it('anchors a comment to a node and numbers it in creation order', () => {
    const first = store.add({ nodeId: 'n1', tag: 'question', text: 'Why the remap here?' });
    const second = store.add({ nodeId: 'n2', tag: 'blocker', text: 'No decay in the loop.' });

    expect(store.numberOf(first.id)).toBe(1);
    expect(store.numberOf(second.id)).toBe(2);
    expect(store.forNode('n1')).toHaveLength(1);
  });

  it('refuses a comment with no text or no node', () => {
    expect(store.add({ nodeId: 'n1', text: '   ' })).toBeNull();
    expect(store.add({ nodeId: '', text: 'orphan' })).toBeNull();
    expect(store.all()).toHaveLength(0);
  });

  it('falls back to the note tag when handed one it does not know', () => {
    const a = store.add({ nodeId: 'n1', tag: 'nonsense', text: 'hello' });
    expect(a.tag).toBe('note');
  });

  it('counts open, resolved and blocking comments separately', () => {
    store.add({ nodeId: 'n1', tag: 'blocker', text: 'blows out to white' });
    const praise = store.add({ nodeId: 'n2', tag: 'praise', text: 'gorgeous' });
    store.toggleResolve(praise.id);

    expect(store.counts()).toEqual({ total: 2, open: 1, resolved: 1, blockers: 1 });
  });

  it('stops counting a blocker once it is resolved', () => {
    const blocker = store.add({ nodeId: 'n1', tag: 'blocker', text: 'needs a gain stage' });
    store.toggleResolve(blocker.id);
    expect(store.counts().blockers).toBe(0);
  });

  describe('the pin a node shows', () => {
    it('is nothing at all for a node with no comments', () => {
      expect(store.pinFor('n9')).toBeNull();
    });

    it('prefers an open comment over a resolved one on the same node', () => {
      const done = store.add({ nodeId: 'n1', tag: 'note', text: 'first pass looked fine' });
      store.toggleResolve(done.id);
      const live = store.add({ nodeId: 'n1', tag: 'change', text: 'drop the threshold' });

      const pin = store.pinFor('n1');
      expect(pin.annotation.id).toBe(live.id);
      expect(pin.resolved).toBe(false);
      expect(pin.count).toBe(2);
      expect(pin.openCount).toBe(1);
    });

    it('reads as resolved only when every comment on the node is', () => {
      const a = store.add({ nodeId: 'n1', tag: 'note', text: 'one' });
      const b = store.add({ nodeId: 'n1', tag: 'note', text: 'two' });
      store.toggleResolve(a.id);
      expect(store.pinFor('n1').resolved).toBe(false);
      store.toggleResolve(b.id);
      expect(store.pinFor('n1').resolved).toBe(true);
    });

    it('carries the comment number from the whole patch, not from the node', () => {
      store.add({ nodeId: 'n1', text: 'first' });
      const onN2 = store.add({ nodeId: 'n2', text: 'second' });
      expect(store.pinFor('n2').number).toBe(2);
      expect(onN2.nodeId).toBe('n2');
    });
  });

  it('keeps the number stable under a filter', () => {
    const a = store.add({ nodeId: 'n1', text: 'one' });
    const b = store.add({ nodeId: 'n2', text: 'two' });
    store.toggleResolve(a.id);

    store.setFilter('open');
    expect(store.filtered().map((x) => x.id)).toEqual([b.id]);
    // b is still the SECOND comment even when it is the only one on screen.
    expect(store.numberOf(b.id)).toBe(2);
  });

  it('threads replies under their comment', () => {
    const a = store.add({ nodeId: 'n1', text: 'should this be exposed?' });
    store.addReply(a.id, { text: 'yes — as a Float input', author: 'Devin' });
    store.addReply(a.id, { text: '   ' });

    expect(store.get(a.id).replies).toHaveLength(1);
    expect(store.get(a.id).replies[0].author).toBe('Devin');
  });

  it('reports comments whose node has been deleted rather than dropping them', () => {
    store.add({ nodeId: 'n1', text: 'still here' });
    const gone = store.add({ nodeId: 'n404', text: 'node was deleted under me' });

    const orphans = store.orphans(new Set(['n1']));
    expect(orphans.map((a) => a.id)).toEqual([gone.id]);
    // The comment is still in the store — surfaced, not destroyed.
    expect(store.all()).toHaveLength(2);
  });

  it('clears the selection when the selected comment is removed', () => {
    const a = store.add({ nodeId: 'n1', text: 'select me' });
    expect(store.selectedId).toBe(a.id);
    store.remove(a.id);
    expect(store.selectedId).toBeNull();
  });

  it('toggles the selection off when the same comment is selected twice', () => {
    const a = store.add({ nodeId: 'n1', text: 'one' });
    store.setSelected(null);

    store.select(a.id);
    expect(store.selectedId).toBe(a.id);
    store.select(a.id);
    expect(store.selectedId).toBeNull();
  });

  it('only reports a hover change when the hover actually changed', () => {
    const a = store.add({ nodeId: 'n1', text: 'one' });
    expect(store.setHovered(a.id)).toBe(true);
    expect(store.setHovered(a.id)).toBe(false);
    expect(store.setHovered(null)).toBe(true);
  });

  it('notifies subscribers on a change and stops after unsubscribe', () => {
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.add({ nodeId: 'n1', text: 'one' });
    expect(calls).toBe(1);
    off();
    store.add({ nodeId: 'n1', text: 'two' });
    expect(calls).toBe(1);
  });

  describe('persistence', () => {
    it('reloads what it wrote', () => {
      store.add({ nodeId: 'n1', tag: 'change', text: 'lower the threshold' });
      const reopened = new AnnotationStore({ storage, projectKey: 'patch-a' });

      expect(reopened.all()).toHaveLength(1);
      expect(reopened.all()[0].tag).toBe('change');
      expect(reopened.all()[0].text).toBe('lower the threshold');
    });

    it('keeps each project to its own review', () => {
      store.add({ nodeId: 'n1', text: 'on patch a' });
      store.setProjectKey('patch-b');

      expect(store.all()).toHaveLength(0);
      store.setProjectKey('patch-a');
      expect(store.all()).toHaveLength(1);
    });

    it('starts empty on a corrupt store instead of throwing', () => {
      storage.setItem('glsl-node-editor.annotations.patch-c', '{ not json');
      const recovered = new AnnotationStore({ storage, projectKey: 'patch-c' });
      expect(recovered.all()).toEqual([]);
    });

    it('drops entries that are missing what a comment needs', () => {
      storage.setItem(
        'glsl-node-editor.annotations.patch-d',
        JSON.stringify({
          version: 1,
          annotations: [
            { id: 'a1', nodeId: 'n1', text: 'good' },
            { id: 'a2', text: 'no node' },
            { nodeId: 'n1', text: 'no id' },
            { id: 'a3', nodeId: 'n1', text: '   ' },
          ],
        }),
      );
      const loaded = new AnnotationStore({ storage, projectKey: 'patch-d' });
      expect(loaded.all().map((a) => a.id)).toEqual(['a1']);
    });

    it('works with no storage at all', () => {
      const memoryOnly = new AnnotationStore({ storage: null, projectKey: 'x' });
      expect(() => memoryOnly.add({ nodeId: 'n1', text: 'fine' })).not.toThrow();
      expect(memoryOnly.all()).toHaveLength(1);
    });
  });
});

describe('normalizeCommentText', () => {
  it('keeps the line breaks a review note is written with', () => {
    expect(normalizeCommentText('one\ntwo')).toBe('one\ntwo');
  });

  it('collapses runs of blank lines and trims the ends', () => {
    expect(normalizeCommentText('  a\n\n\n\nb  ')).toBe('a\n\nb');
  });

  it('strips control characters that are not newlines', () => {
    expect(normalizeCommentText('a\u0001b')).toBe('a b');
  });

  it('clamps a comment that has become a document', () => {
    expect(normalizeCommentText('x'.repeat(MAX_COMMENT_LENGTH + 500))).toHaveLength(
      MAX_COMMENT_LENGTH,
    );
  });

  it('returns empty for anything that is not a string', () => {
    expect(normalizeCommentText(null)).toBe('');
    expect(normalizeCommentText(42)).toBe('');
  });
});
