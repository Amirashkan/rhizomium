// src/core/AnnotationStore.js — review comments pinned to nodes.
//
// A code-review layer over a patch: someone opens a graph, leaves comments on
// the nodes they have something to say about, tags each one by what it is
// (a question, a change they want, a blocker, praise, a note), and the author
// works through them and resolves them. The canvas draws a numbered pin on
// every commented node; the review dock (src/ui/ReviewPanel.js) holds the
// threads.
//
// Two things this file is careful about:
//
//   * It has no DOM in it beyond localStorage, and that behind a guard. The
//     renderer reads it every frame and the panel reads it on every keystroke,
//     so it stays a plain data structure with a subscription — no elements, no
//     measuring, nothing that has to be on a page to work. That is also what
//     makes it testable without a browser.
//
//   * Comments are anchored to node IDs, not to positions. A node that gets
//     dragged, renamed or re-parameterised keeps its comments; the pin simply
//     draws wherever the node now is. A node that is DELETED leaves its
//     comments orphaned rather than silently destroying review history — see
//     `orphans()`, which the panel surfaces so they can be read and dismissed
//     deliberately.
//
// Persistence is localStorage, keyed per project name. Annotations are small
// text — no textures, no data URLs — so they fit the quota that pushed backups
// and autosave into IndexedDB (src/core/rhizomiumDB.js), and they survive a
// reload without touching the .rz file. They are review state ABOUT a patch,
// not part of the patch: exporting a project does not carry other people's
// comments along with it.

const STORAGE_PREFIX = 'glsl-node-editor.annotations';

/** Schema version, so a later shape change can migrate rather than discard. */
const SCHEMA_VERSION = 1;

/** Tag ids, in the order the compose form offers them. */
export const TAG_IDS = ['question', 'change', 'blocker', 'praise', 'note'];

/** Longest a single comment or reply may be. Past this it is a document. */
export const MAX_COMMENT_LENGTH = 2000;

/** Filters the review dock offers. */
export const FILTERS = ['all', 'open', 'resolved'];

function isTag(tag) {
  return TAG_IDS.includes(tag);
}

/**
 * Clean text typed into a comment box.
 *
 * Comments keep their line breaks — a review note is prose and often a list —
 * so unlike node names this only strips the control characters that are not
 * newlines, collapses runs of blank lines, and clamps the length.
 */
export function normalizeCommentText(raw) {
  if (typeof raw !== 'string') return '';
  let stripped = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0);
    if (ch === '\n' || ch === '\t') {
      stripped += ch === '\t' ? ' ' : '\n';
    } else if (code < 0x20 || code === 0x7f) {
      stripped += ' ';
    } else {
      stripped += ch;
    }
  }
  return stripped.replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_COMMENT_LENGTH);
}

/**
 * Ids are time-ordered so the natural sort is chronological and two comments
 * written in the same millisecond still differ.
 */
let idCounter = 0;
function makeId(prefix) {
  idCounter = (idCounter + 1) % 100000;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** The initial drawn on an avatar chip. */
function initialOf(author) {
  const name = String(author || '').trim();
  return name ? name[0].toUpperCase() : '?';
}

export class AnnotationStore {
  constructor({ storage, projectKey = 'Untitled' } = {}) {
    /**
     * Injected for tests; falls back to localStorage where there is one. A
     * browser with storage disabled (private mode, a locked-down webview) gets
     * a working in-memory store rather than a panel that throws on open.
     */
    this.storage = storage !== undefined ? storage : safeLocalStorage();
    this.projectKey = projectKey || 'Untitled';

    /** @type {Array<object>} newest last, which is also numbering order. */
    this.annotations = [];

    /** Transient view state — shared with the canvas, never persisted. */
    this.selectedId = null;
    this.hoveredId = null;
    this.filter = 'all';

    this.listeners = new Set();
    this.load();
  }

  // --- Persistence ---------------------------------------------------------

  storageKey() {
    return `${STORAGE_PREFIX}.${this.projectKey}`;
  }

  load() {
    this.annotations = [];
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.annotations;
      if (Array.isArray(list)) {
        this.annotations = list.map(hydrate).filter(Boolean);
      }
    } catch {
      // A corrupt or unreadable store is not worth a broken review panel: start
      // empty rather than throwing on open. The bad value is left in place so
      // it is not destroyed by merely looking at it.
    }
  }

  save() {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        this.storageKey(),
        JSON.stringify({ version: SCHEMA_VERSION, annotations: this.annotations }),
      );
    } catch {
      // Over quota or storage denied. The comments still work for this session;
      // failing the edit itself would be the worse outcome.
    }
  }

  /**
   * Point the store at another project. Called when a patch is opened or saved
   * under a new name — comments belong to the project they were written on, so
   * they are reloaded from that project's key rather than carried across.
   */
  setProjectKey(key) {
    const next = key || 'Untitled';
    if (next === this.projectKey) return;
    this.projectKey = next;
    this.selectedId = null;
    this.hoveredId = null;
    this.load();
    this.emit();
  }

  // --- Subscription --------------------------------------------------------

  /** @returns {() => void} unsubscribe */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) {
      try {
        fn(this);
      } catch (error) {
        console.warn('[AnnotationStore] listener failed:', error);
      }
    }
  }

  // --- Reading -------------------------------------------------------------

  /** Every comment, oldest first. */
  all() {
    return this.annotations;
  }

  get(id) {
    return this.annotations.find((a) => a.id === id) || null;
  }

  /**
   * A comment's number, as drawn on its pin: its 1-based position in creation
   * order across the WHOLE patch, not within the current filter. The number on
   * a pin has to keep meaning the same thing when the filter changes.
   */
  numberOf(id) {
    const index = this.annotations.findIndex((a) => a.id === id);
    return index < 0 ? null : index + 1;
  }

  /** Comments on one node, oldest first. */
  forNode(nodeId) {
    return this.annotations.filter((a) => a.nodeId === nodeId);
  }

  /**
   * What to draw on a node: its OPEN comments if it has any, otherwise its
   * resolved ones. A node with three resolved notes and one live blocker shows
   * the blocker — the pin is a call to action first and a history second.
   */
  pinFor(nodeId) {
    const list = this.forNode(nodeId);
    if (list.length === 0) return null;
    const open = list.filter((a) => !a.resolved);
    const chosen = open[0] || list[0];
    return {
      annotation: chosen,
      number: this.numberOf(chosen.id),
      count: list.length,
      openCount: open.length,
      resolved: open.length === 0,
    };
  }

  /** Comments whose node is no longer in the graph. */
  orphans(nodeIds) {
    const live = nodeIds instanceof Set ? nodeIds : new Set(nodeIds || []);
    return this.annotations.filter((a) => !live.has(a.nodeId));
  }

  /** The list the panel shows, under the active filter. */
  filtered() {
    if (this.filter === 'open') return this.annotations.filter((a) => !a.resolved);
    if (this.filter === 'resolved') return this.annotations.filter((a) => a.resolved);
    return this.annotations;
  }

  counts() {
    let open = 0;
    let resolved = 0;
    let blockers = 0;
    for (const a of this.annotations) {
      if (a.resolved) resolved += 1;
      else {
        open += 1;
        if (a.tag === 'blocker') blockers += 1;
      }
    }
    return { total: this.annotations.length, open, resolved, blockers };
  }

  // --- Writing -------------------------------------------------------------

  /**
   * Leave a comment on a node.
   * @returns {object|null} the stored comment, or null if there was nothing to store.
   */
  add({ nodeId, tag = 'note', text, author = 'You' } = {}) {
    const body = normalizeCommentText(text);
    if (!body || !nodeId) return null;

    const annotation = {
      id: makeId('an'),
      nodeId,
      tag: isTag(tag) ? tag : 'note',
      text: body,
      author: String(author || 'You'),
      resolved: false,
      createdAt: Date.now(),
      replies: [],
    };
    this.annotations.push(annotation);
    this.selectedId = annotation.id;
    this.save();
    this.emit();
    return annotation;
  }

  addReply(id, { text, author = 'You' } = {}) {
    const annotation = this.get(id);
    const body = normalizeCommentText(text);
    if (!annotation || !body) return null;

    const reply = {
      id: makeId('re'),
      text: body,
      author: String(author || 'You'),
      createdAt: Date.now(),
    };
    annotation.replies.push(reply);
    this.save();
    this.emit();
    return reply;
  }

  /**
   * Resolve or reopen. Returns the new resolved state, or null if there is no
   * such comment.
   */
  toggleResolve(id) {
    const annotation = this.get(id);
    if (!annotation) return null;
    annotation.resolved = !annotation.resolved;
    annotation.resolvedAt = annotation.resolved ? Date.now() : null;
    this.save();
    this.emit();
    return annotation.resolved;
  }

  remove(id) {
    const index = this.annotations.findIndex((a) => a.id === id);
    if (index < 0) return false;
    this.annotations.splice(index, 1);
    if (this.selectedId === id) this.selectedId = null;
    if (this.hoveredId === id) this.hoveredId = null;
    this.save();
    this.emit();
    return true;
  }

  /** Drop every comment on a node. Used when its node is deleted for good. */
  removeForNode(nodeId) {
    const before = this.annotations.length;
    this.annotations = this.annotations.filter((a) => a.nodeId !== nodeId);
    const removed = before - this.annotations.length;
    if (removed > 0) {
      if (this.selectedId && !this.get(this.selectedId)) this.selectedId = null;
      this.save();
      this.emit();
    }
    return removed;
  }

  // --- View state ----------------------------------------------------------

  /** Selecting the already-selected comment clears it, as clicking a pin twice should. */
  select(id) {
    const next = this.selectedId === id ? null : id;
    if (next === this.selectedId) return this.selectedId;
    this.selectedId = next;
    this.emit();
    return this.selectedId;
  }

  setSelected(id) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit();
  }

  /**
   * Hover is set from mousemove, so it returns whether anything actually
   * changed — the canvas only needs a redraw when it did.
   */
  setHovered(id) {
    if (this.hoveredId === id) return false;
    this.hoveredId = id;
    this.emit();
    return true;
  }

  setFilter(filter) {
    const next = FILTERS.includes(filter) ? filter : 'all';
    if (next === this.filter) return;
    this.filter = next;
    this.emit();
  }
}

/** Accept only what we wrote, and fill in anything an older version lacked. */
function hydrate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.id || !raw.nodeId) return null;
  const text = normalizeCommentText(raw.text);
  if (!text) return null;

  return {
    id: String(raw.id),
    nodeId: raw.nodeId,
    tag: isTag(raw.tag) ? raw.tag : 'note',
    text,
    author: String(raw.author || 'You'),
    resolved: !!raw.resolved,
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    resolvedAt: Number.isFinite(raw.resolvedAt) ? raw.resolvedAt : null,
    replies: Array.isArray(raw.replies)
      ? raw.replies
          .map((r) => {
            const body = normalizeCommentText(r?.text);
            if (!body) return null;
            return {
              id: String(r.id || makeId('re')),
              text: body,
              author: String(r.author || 'You'),
              createdAt: Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
            };
          })
          .filter(Boolean)
      : [],
  };
}

function safeLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Touch it: Safari in private mode has the object but throws on write.
    const probe = `${STORAGE_PREFIX}.probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export { initialOf };

/**
 * One store for the session, like the editor's other shared services. The
 * renderer, the event handler and the review dock all have to agree on which
 * comment is selected, so they share an instance rather than each holding one.
 */
let store = null;
export function getAnnotationStore() {
  if (!store) {
    store = new AnnotationStore({ projectKey: currentProjectKey() });
  }
  return store;
}

/** Test seam: drop the singleton so a suite can start from a known state. */
export function _resetAnnotationStore() {
  store = null;
}

/**
 * The project a comment belongs to. SaveLoadManager owns the project's name and
 * is on `window` by the time any of this runs; before it exists (or on an
 * unsaved patch) everything lands under "Untitled", which is the same bucket
 * the save dialog would offer.
 */
export function currentProjectKey() {
  try {
    return globalThis.saveLoadManager?.getProjectName?.() || 'Untitled';
  } catch {
    return 'Untitled';
  }
}
