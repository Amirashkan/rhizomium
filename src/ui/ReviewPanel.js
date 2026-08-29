/**
 * ReviewPanel.js — code review for a patch.
 *
 * The dock half of the annotation layer: the canvas draws a numbered badge on
 * every commented node (Renderer._renderAnnotations), and this holds the
 * threads behind them — what was asked, who asked it, what was replied, and
 * whether it is still open.
 *
 * A dock rather than a modal, for the same reason the AI panel is one: every
 * comment in here is ABOUT a node, and a window covering the graph means
 * reading a comment and looking at what it refers to become two different
 * actions. Open, the canvas ends where the panel starts (src/ui/dockLayout.js)
 * and both are usable at once — click a comment and its node lights up, click a
 * badge and its comment scrolls into view.
 *
 * Three things this panel is careful about:
 *
 *   - It re-renders from the store on every change, but never while someone is
 *     typing into it. A redraw that rebuilt the compose box would eat the draft
 *     mid-sentence, so drafts live on the panel and are written back into the
 *     fresh markup (see `drafts`).
 *   - Comment text is inserted as TEXT, never as markup. These are notes people
 *     type, they get stored and read back, and a review panel that renders HTML
 *     from its own store is an XSS hole with extra steps.
 *   - Deleting a node does not delete its comments. They surface in their own
 *     section instead, so review history is dismissed on purpose rather than
 *     lost by a keystroke somewhere else on the canvas.
 */

import { getAnnotationStore, TAG_IDS, initialOf } from '../core/AnnotationStore.js';
import { ANNOTATION_TAGS } from '../core/theme.js';
import { nodeDisplayName } from '../core/nodeName.js';
import { iconMarkup } from './iconSprite.js';
import { modalManager } from './ModalManager.js';
import { setRightDockWidth, notifyCanvasResize } from './dockLayout.js';

/** Dock geometry, matching the AI dock's so the two feel like one shell. */
const MIN_DOCK_WIDTH = 300;
const MAX_DOCK_WIDTH = 620;
const DEFAULT_DOCK_WIDTH = 380;

const STORAGE_KEY = 'glsl-node-editor.review-panel.prefs';

function loadPrefs() {
  const prefs = { width: DEFAULT_DOCK_WIDTH };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (Number.isFinite(stored.width)) prefs.width = stored.width;
  } catch {
    // A corrupt or unavailable store is not worth a broken panel.
  }
  return prefs;
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Not worth failing an open over.
  }
}

/**
 * How long ago, in the compactest form that is still true: "now", "4m", "3h",
 * "2d", then a date. A review is read in the present tense — what matters is
 * whether a comment is from this session or from last week, not its timestamp.
 */
export function relativeTime(then, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  try {
    return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return `${days}d`;
  }
}

/**
 * A stable colour for an author's avatar chip, picked from the category ramp by
 * hashing the name — so the same person is the same colour in every session
 * without anyone having to be assigned one.
 */
const AVATAR_COLORS = [
  'var(--rz-cat-generators)',
  'var(--rz-cat-vector)',
  'var(--rz-cat-modifiers)',
  'var(--rz-cat-transform)',
  'var(--rz-cat-texture)',
  'var(--rz-cat-utility)',
  'var(--rz-cat-dynamics)',
  'var(--rz-cat-effects)',
];

export function avatarColor(author) {
  const name = String(author || '');
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

class ReviewPanel {
  constructor() {
    this.dock = null;
    this.isOpen = false;
    this.unsubscribe = null;
    this.prefs = loadPrefs();
    this.dragging = false;

    /** Composer state, held here so a store change never eats a draft. */
    this.composing = false;
    this.drafts = { text: '', nodeId: '', tag: 'note', reply: '' };
    /** Which field had focus, so a re-render can give it back. */
    this.focusField = null;
    /** Set once after a reveal, to scroll the right card into view. */
    this.pendingScrollId = null;
  }

  get store() {
    return getAnnotationStore();
  }

  get graph() {
    return window.editor?.graph || window.graph || null;
  }

  // --- Opening and closing --------------------------------------------------

  show() {
    if (this.isOpen) {
      this.render();
      return;
    }

    this.createDock();
    this.isOpen = true;
    this.applyWidth(this.prefs.width);

    // The canvas and the dock share one store; a badge clicked on the canvas
    // has to move the list here, and vice versa.
    this.unsubscribe = this.store.subscribe(() => this.render());

    this.onWindowResize = () => {
      // Not mid-drag: every step of a resize notifies the canvases, which comes
      // back as a resize event, and re-applying the stored width then would
      // snap the edge back under the cursor on every frame.
      if (this.dragging) return;
      this.applyWidth(this.prefs.width, { persist: false, silent: true });
    };
    window.addEventListener('resize', this.onWindowResize);

    this.render();
  }

  hide() {
    if (this.dock?.parentElement) document.body.removeChild(this.dock);
    this.dock = null;
    this.isOpen = false;
    this.unsubscribe?.();
    this.unsubscribe = null;

    if (this.onWindowResize) {
      window.removeEventListener('resize', this.onWindowResize);
      this.onWindowResize = null;
    }

    // Clear the canvas highlight with the panel — a node left ringed by a panel
    // that is no longer open is a selection nobody can explain.
    this.store.setSelected(null);
    window.editor?.markDirty?.('annotation-close', 'full', { full: true });

    setRightDockWidth(0);
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
  }

  /** Open the dock on one comment: used when a canvas badge is clicked. */
  revealComment(id) {
    this.pendingScrollId = id;
    if (!this.isOpen) this.show();
    else this.render();
  }

  applyWidth(width, { persist = true, silent = false } = {}) {
    const ceiling = Math.max(MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, window.innerWidth * 0.5));
    const next = Math.round(Math.min(Math.max(width, MIN_DOCK_WIDTH), ceiling));

    if (this.dock) this.dock.style.width = `${next}px`;
    setRightDockWidth(this.isOpen ? next : 0, { silent });

    if (persist && next !== this.prefs.width) {
      this.prefs.width = next;
      savePrefs(this.prefs);
    }
    return next;
  }

  createDock() {
    this.dock = document.createElement('aside');
    this.dock.className = 'review-dock';
    this.dock.setAttribute('aria-label', 'Patch review');
    this.dock.innerHTML = `
      <div class="review-dock-resizer" role="separator" aria-orientation="vertical"
           aria-label="Resize the review panel" tabindex="0" title="Drag to resize"></div>
      <div class="review-dock-header">
        <h3>${iconMarkup('comment', { size: 15 })} Patch Review</h3>
        <span class="review-total" id="review-total"></span>
        <button class="review-icon-button" id="review-close" title="Close the review panel">
          ${iconMarkup('close', { size: 13, label: 'Close' })}
        </button>
      </div>
      <div class="review-dock-top" id="review-top"></div>
      <div class="review-dock-body rzscroll" id="review-body"></div>`;

    this.dock.querySelector('#review-close').addEventListener('click', () => this.hide());
    this.wireResizer(this.dock.querySelector('.review-dock-resizer'));
    document.body.appendChild(this.dock);
  }

  wireResizer(handle) {
    let frameQueued = false;
    const scheduleNotify = () => {
      if (frameQueued) return;
      frameQueued = true;
      requestAnimationFrame(() => {
        frameQueued = false;
        notifyCanvasResize();
      });
    };

    const onMove = (event) => {
      this.applyWidth(window.innerWidth - event.clientX, { persist: false, silent: true });
      scheduleNotify();
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      this.dragging = false;
      if (this.dock) this.applyWidth(this.dock.offsetWidth, { silent: true });
      notifyCanvasResize();
    };

    handle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.dragging = true;
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // The drag handle is a control, and a control only a mouse can work is one
    // some people cannot work at all.
    handle.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 48 : 16;
      if (event.key === 'ArrowLeft') this.applyWidth(this.dock.offsetWidth + step);
      else if (event.key === 'ArrowRight') this.applyWidth(this.dock.offsetWidth - step);
      else return;
      event.preventDefault();
    });
  }

  // --- Drawing --------------------------------------------------------------

  render() {
    if (!this.dock) return;
    this.renderTop();
    this.renderList();
    this.restoreFocus();
    this.scrollToPending();
  }

  renderTop() {
    const store = this.store;
    const counts = store.counts();

    const total = this.dock.querySelector('#review-total');
    total.textContent = counts.total === 1 ? '1 comment' : `${counts.total} comments`;

    const top = this.dock.querySelector('#review-top');
    top.innerHTML = `
      <div class="review-stats">
        <div class="review-stat is-open">
          <div class="review-stat-value">${counts.open}</div>
          <div class="review-stat-label">Open</div>
        </div>
        <div class="review-stat is-resolved">
          <div class="review-stat-value">${counts.resolved}</div>
          <div class="review-stat-label">Resolved</div>
        </div>
        <div class="review-stat is-blockers">
          <div class="review-stat-value">${counts.blockers}</div>
          <div class="review-stat-label">Blockers</div>
        </div>
      </div>
      <div class="review-filters" role="tablist" aria-label="Filter comments">
        ${['all', 'open', 'resolved']
          .map(
            (key) => `
          <button role="tab" class="review-filter${store.filter === key ? ' is-active' : ''}"
                  data-filter="${key}" aria-selected="${store.filter === key}">
            ${key[0].toUpperCase()}${key.slice(1)}
          </button>`,
          )
          .join('')}
      </div>
      <button class="review-compose-toggle" id="review-compose-toggle">
        ${this.composing ? 'Cancel' : '+ New comment'}
      </button>
      ${this.composing ? this.composeMarkup() : ''}`;

    for (const button of top.querySelectorAll('.review-filter')) {
      button.addEventListener('click', () => this.store.setFilter(button.dataset.filter));
    }

    top.querySelector('#review-compose-toggle').addEventListener('click', () => {
      this.composing = !this.composing;
      if (this.composing) this.focusField = 'compose-text';
      this.render();
    });

    if (this.composing) this.wireCompose(top);
  }

  /**
   * The compose form.
   *
   * The node dropdown is built from the live graph, so a comment can only ever
   * be filed against a node that exists — the one anchoring rule the whole
   * layer depends on. It defaults to the selected node, because "comment on
   * this" is what someone means nine times in ten.
   */
  composeMarkup() {
    const nodes = this.graph?.nodes || [];
    if (nodes.length === 0) {
      return `<div class="review-empty review-compose-empty">
                Add a node to the patch before commenting on it.
              </div>`;
    }

    const selected = this.defaultComposeNode(nodes);
    const options = nodes
      .map((node) => {
        const label = `${nodeDisplayName(node)} · #${node.id}`;
        return `<option value="${escapeAttr(node.id)}"${
          String(node.id) === String(selected) ? ' selected' : ''
        }>${escapeHtml(label)}</option>`;
      })
      .join('');

    const tags = TAG_IDS.map(
      (id) =>
        `<option value="${id}"${this.drafts.tag === id ? ' selected' : ''}>${
          ANNOTATION_TAGS[id].label
        }</option>`,
    ).join('');

    return `
      <div class="review-compose">
        <div class="review-compose-row">
          <select class="review-select" id="review-compose-node" aria-label="Node to comment on">
            ${options}
          </select>
          <select class="review-select review-select-tag" id="review-compose-tag" aria-label="Comment type">
            ${tags}
          </select>
        </div>
        <textarea class="review-textarea" id="review-compose-text" rows="3"
                  placeholder="Leave a comment on this node…"></textarea>
        <button class="review-primary" id="review-post">Post comment</button>
      </div>`;
  }

  /** The node a new comment defaults to: the draft's, else the canvas selection, else the first. */
  defaultComposeNode(nodes) {
    const known = new Set(nodes.map((n) => String(n.id)));
    if (this.drafts.nodeId && known.has(String(this.drafts.nodeId))) return this.drafts.nodeId;

    const selection = this.graph?.selection;
    if (selection?.size) {
      const first = Array.from(selection)[0];
      if (known.has(String(first))) return first;
    }
    return nodes[0].id;
  }

  wireCompose(root) {
    const nodeSelect = root.querySelector('#review-compose-node');
    const tagSelect = root.querySelector('#review-compose-tag');
    const text = root.querySelector('#review-compose-text');
    const post = root.querySelector('#review-post');
    if (!nodeSelect || !text || !post) return;

    this.drafts.nodeId = nodeSelect.value;
    text.value = this.drafts.text;

    nodeSelect.addEventListener('change', () => {
      this.drafts.nodeId = nodeSelect.value;
    });
    tagSelect.addEventListener('change', () => {
      this.drafts.tag = tagSelect.value;
    });
    text.addEventListener('input', () => {
      this.drafts.text = text.value;
    });
    text.addEventListener('focus', () => {
      this.focusField = 'compose-text';
    });
    // Ctrl/⌘+Enter posts, the way every other comment box does.
    text.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        this.postComment();
      }
    });
    post.addEventListener('click', () => this.postComment());
  }

  postComment() {
    const added = this.store.add({
      nodeId: this.drafts.nodeId,
      tag: this.drafts.tag,
      text: this.drafts.text,
    });
    if (!added) return;

    this.drafts.text = '';
    this.composing = false;
    this.focusField = null;
    this.pendingScrollId = added.id;
    // The badge is new; the canvas has to repaint to show it.
    window.editor?.markDirty?.('annotation-add', 'full', { full: true });
  }

  renderList() {
    const store = this.store;
    const body = this.dock.querySelector('#review-body');
    const list = store.filtered();

    const nodeIds = new Set((this.graph?.nodes || []).map((n) => String(n.id)));
    const orphans = this.graph ? store.orphans(nodeIds) : [];
    const orphanIds = new Set(orphans.map((a) => a.id));

    body.innerHTML = '';

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'review-empty';
      empty.textContent =
        store.all().length === 0
          ? 'No comments on this patch yet. Select a node and leave the first one.'
          : 'No comments in this view.';
      body.appendChild(empty);
    }

    for (const annotation of list) {
      body.appendChild(this.commentCard(annotation, orphanIds.has(annotation.id)));
    }

    // Comments whose node is gone. Shown under their own heading rather than
    // mixed into the list: they cannot be focused, and pretending otherwise
    // gives a button that does nothing.
    const orphansInView = orphans.filter((a) => list.includes(a));
    if (orphansInView.length > 0) {
      const note = document.createElement('div');
      note.className = 'review-orphan-note';
      note.textContent =
        orphansInView.length === 1
          ? '1 comment above is on a node that no longer exists.'
          : `${orphansInView.length} comments above are on nodes that no longer exist.`;
      body.appendChild(note);
    }
  }

  commentCard(annotation, isOrphan) {
    const store = this.store;
    const active = store.selectedId === annotation.id;
    const tag = ANNOTATION_TAGS[annotation.tag] || ANNOTATION_TAGS.note;
    const node = this.findNode(annotation.nodeId);

    const card = document.createElement('article');
    card.className = `review-card tag-${annotation.tag}`;
    if (active) card.classList.add('is-active');
    if (annotation.resolved) card.classList.add('is-resolved');
    if (isOrphan) card.classList.add('is-orphan');
    card.dataset.id = annotation.id;

    const number = store.numberOf(annotation.id);
    const nodeLabel = node
      ? `${nodeDisplayName(node)} · #${node.id}`
      : `Deleted node · #${annotation.nodeId}`;

    card.innerHTML = `
      <header class="review-card-head">
        <span class="review-num">${annotation.resolved ? '✓' : number}</span>
        <span class="review-node-name" title="${escapeAttr(nodeLabel)}">${escapeHtml(nodeLabel)}</span>
        <span class="review-tag">${tag.label}</span>
      </header>
      <p class="review-text"></p>
      <div class="review-byline">
        <span class="review-avatar" style="background:${avatarColor(annotation.author)}">${escapeHtml(
          initialOf(annotation.author),
        )}</span>
        <span class="review-author">${escapeHtml(annotation.author)}</span>
        <span class="review-time">· ${relativeTime(annotation.createdAt)}</span>
        ${annotation.resolved ? '<span class="review-resolved-flag">✓ Resolved</span>' : ''}
      </div>
      <div class="review-replies"></div>
      <div class="review-actions">
        <button class="review-action review-resolve">${
          annotation.resolved ? 'Reopen' : 'Resolve'
        }</button>
        <button class="review-action review-focus"${node ? '' : ' disabled'}>Focus node →</button>
        <button class="review-action review-delete" title="Delete this comment">
          ${iconMarkup('trash', { size: 12, label: 'Delete comment' })}
        </button>
      </div>`;

    // textContent, not innerHTML: this is text somebody typed.
    card.querySelector('.review-text').textContent = annotation.text;

    const replies = card.querySelector('.review-replies');
    for (const reply of annotation.replies) {
      replies.appendChild(this.replyRow(reply));
    }

    if (active) {
      replies.appendChild(this.replyComposer(annotation));
    }

    card.addEventListener('click', (event) => {
      // Only the card's own background selects — a press on a button in here
      // has already done something more specific.
      if (event.target.closest('button, input, textarea, select')) return;
      this.selectComment(annotation.id);
    });

    card.querySelector('.review-resolve').addEventListener('click', () => {
      this.store.toggleResolve(annotation.id);
      window.editor?.markDirty?.('annotation-resolve', 'full', { full: true });
    });

    const focusButton = card.querySelector('.review-focus');
    if (node) focusButton.addEventListener('click', () => this.focusNode(annotation));

    card.querySelector('.review-delete').addEventListener('click', () => {
      this.confirmDelete(annotation);
    });

    return card;
  }

  replyRow(reply) {
    const row = document.createElement('div');
    row.className = 'review-reply';
    row.innerHTML = `
      <span class="review-avatar is-small" style="background:${avatarColor(reply.author)}">${escapeHtml(
        initialOf(reply.author),
      )}</span>
      <div class="review-reply-body">
        <div class="review-reply-meta">
          <span class="review-reply-author">${escapeHtml(reply.author)}</span>
          <span class="review-time">· ${relativeTime(reply.createdAt)}</span>
        </div>
        <div class="review-reply-text"></div>
      </div>`;
    row.querySelector('.review-reply-text').textContent = reply.text;
    return row;
  }

  /** The reply box, shown only on the selected comment. */
  replyComposer(annotation) {
    const wrap = document.createElement('div');
    wrap.className = 'review-reply-compose';
    wrap.innerHTML = `
      <input class="review-input" type="text" placeholder="Reply…" aria-label="Reply to this comment" />
      <button class="review-action review-send">Send</button>`;

    const input = wrap.querySelector('input');
    input.value = this.drafts.reply;
    input.addEventListener('input', () => {
      this.drafts.reply = input.value;
    });
    input.addEventListener('focus', () => {
      this.focusField = 'reply';
    });

    const send = () => {
      if (!this.store.addReply(annotation.id, { text: this.drafts.reply })) return;
      this.drafts.reply = '';
      this.focusField = 'reply';
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        send();
      }
    });
    wrap.querySelector('.review-send').addEventListener('click', send);

    return wrap;
  }

  async confirmDelete(annotation) {
    const ok = await modalManager.confirm(
      'Delete this comment and its replies? This cannot be undone.',
      'Delete comment',
      { confirmLabel: 'Delete', danger: true },
    );
    if (!ok) return;
    this.store.remove(annotation.id);
    window.editor?.markDirty?.('annotation-delete', 'full', { full: true });
  }

  // --- Canvas coordination --------------------------------------------------

  selectComment(id) {
    this.drafts.reply = '';
    this.store.select(id);
    window.editor?.markDirty?.('annotation-select', 'full', { full: true });
  }

  /**
   * Bring a comment's node into view and select it on the canvas.
   *
   * Fits to the node's box with a generous margin rather than centring at the
   * current zoom: someone clicking "Focus node" from a comment is usually
   * looking at a patch zoomed out far enough that the node is a smudge.
   */
  focusNode(annotation) {
    const node = this.findNode(annotation.nodeId);
    const editor = window.editor;
    if (!node || !editor?.viewport) return;

    this.store.setSelected(annotation.id);

    const margin = 220;
    editor.viewport.fitToContent(
      {
        minX: node.x - margin,
        minY: node.y - margin,
        maxX: node.x + (node.w || 160) + margin,
        maxY: node.y + (node.h || 80) + margin,
      },
      40,
    );

    const graph = this.graph;
    if (graph) {
      if (!(graph.selection instanceof Set)) graph.selection = new Set();
      graph.selection.clear();
      graph.selection.add(node.id);
    }

    editor.markDirty?.('annotation-focus', 'full', { full: true });
  }

  findNode(nodeId) {
    const nodes = this.graph?.nodes || [];
    return nodes.find((n) => String(n.id) === String(nodeId)) || null;
  }

  // --- Focus and scroll -----------------------------------------------------

  /**
   * Give focus back after a re-render.
   *
   * The panel rebuilds its markup on every store change, which throws away the
   * focused element — so typing a reply, which changes the store on send, would
   * otherwise drop the cursor out of the box after every message.
   */
  restoreFocus() {
    if (!this.focusField || !this.dock) return;
    const target =
      this.focusField === 'compose-text'
        ? this.dock.querySelector('#review-compose-text')
        : this.dock.querySelector('.review-reply-compose input');
    if (!target) return;
    target.focus();
    const end = target.value.length;
    try {
      target.setSelectionRange(end, end);
    } catch {
      // Not every input type supports a selection range.
    }
  }

  scrollToPending() {
    if (!this.pendingScrollId || !this.dock) return;
    const card = this.dock.querySelector(`.review-card[data-id="${CSS.escape(this.pendingScrollId)}"]`);
    this.pendingScrollId = null;
    if (!card) return;
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

/** One panel for the session, like the editor's other docks. */
let panel = null;
export function getReviewPanel() {
  if (!panel) panel = new ReviewPanel();
  return panel;
}

export { ReviewPanel };
