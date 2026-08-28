/**
 * CollabPanel.js — the collab space, as an artist meets it.
 *
 * Three jobs, in the order they matter:
 *
 *   1. Say honestly whether this account can open a session at all, and what
 *      the remedy is when it cannot — sign in, upgrade, or wait, which are
 *      three different sentences and only one of them costs money
 *      (src/collab/collabGate.js decides; this only draws the answer).
 *   2. Get someone into a room without a lecture: a name, a room, a button.
 *   3. Make the other artists visible — who is here, and where their pointer
 *      is on the canvas — because a shared canvas where you cannot see anyone
 *      is just a canvas that changes by itself.
 *
 * The panel is shown even when it is locked. Hiding a paid feature means an
 * artist never finds out it exists, which is the same reasoning AIPanel.js
 * gives for drawing its locked cards.
 *
 * ## The warning before joining is not boilerplate
 *
 * Joining a room adopts the room's canvas over whatever is open here — see the
 * note in CollabSession.js about why there is no honest merge. That is
 * destructive to unsaved work, so the confirm step lives here, in front of the
 * only person who knows whether the open patch matters.
 */

import { openExternal } from '../utils/openExternal.js';
import { CollabSession, STATES, peerColor } from '../collab/CollabSession.js';
import { resolveCollabAccess, refusalMessage } from '../collab/collabGate.js';
import { collabGrantGetter } from '../collab/collabGrant.js';

const STORE_KEY = 'rhizomium.collab.prefs';

/** Where the room relay lives when the server has not said otherwise. */
const DEFAULT_RELAY_PORT = 8767;

const STATE_COPY = {
  [STATES.IDLE]: 'Not connected',
  [STATES.CONNECTING]: 'Connecting…',
  [STATES.SYNCING]: 'Adopting the room’s canvas…',
  [STATES.LIVE]: 'Live',
  [STATES.RECONNECTING]: 'Reconnecting…',
  [STATES.CLOSED]: 'Left the room',
  [STATES.FAILED]: 'Could not reach the room',
};

const STYLES = `
.rz-collab {
  position: fixed; top: 56px; right: 16px; width: 320px; z-index: 2600;
  background: var(--rz-surface-raised, #17171a); color: var(--rz-text, #e8e6e1);
  border: 1px solid var(--rz-line, rgba(255,255,255,0.12)); border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.45);
  font-family: var(--rz-font-ui, system-ui, sans-serif); font-size: 13px;
  display: flex; flex-direction: column; overflow: hidden;
}
.rz-collab[hidden] { display: none; }
.rz-collab-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid var(--rz-line, rgba(255,255,255,0.12));
}
.rz-collab-title { font-weight: 600; letter-spacing: 0.01em; }
.rz-collab-close {
  background: none; border: none; color: inherit; cursor: pointer;
  font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 4px;
}
.rz-collab-close:hover { background: rgba(255,255,255,0.08); }
.rz-collab-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.rz-collab-note { color: var(--rz-text-dim, rgba(232,230,225,0.6)); line-height: 1.45; margin: 0; }
.rz-collab-field { display: flex; flex-direction: column; gap: 4px; }
.rz-collab-field label {
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--rz-text-dim, rgba(232,230,225,0.6));
}
.rz-collab-field input {
  background: var(--rz-surface, #101012); color: inherit; font: inherit;
  border: 1px solid var(--rz-line, rgba(255,255,255,0.14));
  border-radius: 4px; padding: 6px 8px;
}
.rz-collab-field input:focus-visible { outline: 2px solid #6ea8ff; outline-offset: 1px; }
.rz-collab-actions { display: flex; gap: 8px; }
.rz-collab-btn {
  flex: 1; font: inherit; cursor: pointer; padding: 7px 10px; border-radius: 5px;
  border: 1px solid var(--rz-line, rgba(255,255,255,0.16));
  background: rgba(255,255,255,0.06); color: inherit;
}
.rz-collab-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
.rz-collab-btn:disabled { opacity: 0.45; cursor: default; }
.rz-collab-btn.primary { background: #2f6f4f; border-color: #3c8a63; }
.rz-collab-btn.primary:hover:not(:disabled) { background: #37815c; }
.rz-collab-btn.danger { background: rgba(150,60,60,0.5); border-color: rgba(200,90,90,0.5); }
.rz-collab-state {
  display: flex; align-items: center; gap: 7px;
  padding: 7px 9px; border-radius: 5px; background: rgba(255,255,255,0.05);
}
.rz-collab-dot { width: 8px; height: 8px; border-radius: 50%; background: #7a7a7a; flex: none; }
.rz-collab-dot.live { background: #4ec27f; }
.rz-collab-dot.busy { background: #d8a13c; }
.rz-collab-dot.bad { background: #d05c5c; }
.rz-collab-peers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.rz-collab-peers li { display: flex; align-items: center; gap: 8px; }
.rz-collab-chip { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.rz-collab-you { color: var(--rz-text-dim, rgba(232,230,225,0.6)); font-size: 11px; }
.rz-collab-link { color: #6ea8ff; cursor: pointer; text-decoration: underline; background: none; border: none; font: inherit; padding: 0; }
.rz-collab-limits { margin: 0; padding-left: 16px; color: var(--rz-text-dim, rgba(232,230,225,0.55)); line-height: 1.5; }

.rz-collab-cursors { position: fixed; inset: 0; pointer-events: none; z-index: 1500; overflow: hidden; }
.rz-collab-cursor { position: absolute; transform: translate(-2px, -2px); display: flex; align-items: flex-start; gap: 4px; }
.rz-collab-cursor svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6)); }
.rz-collab-cursor span {
  font: 11px/1.2 var(--rz-font-ui, system-ui, sans-serif); color: #fff;
  padding: 2px 5px; border-radius: 3px; white-space: nowrap;
}
@media (prefers-reduced-motion: no-preference) {
  .rz-collab-cursor { transition: left 80ms linear, top 80ms linear; }
}
`;

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  } catch {
    // A browser refusing local storage is not a reason to refuse a session.
  }
}

/** A room name someone can read down a phone line. */
function suggestRoom() {
  const words = ['amber', 'basalt', 'cobalt', 'drift', 'ember', 'fathom', 'gloam', 'harrow'];
  const word = words[Math.floor(Math.random() * words.length)];
  return `${word}-${Math.floor(Math.random() * 900 + 100)}`;
}

function defaultRelayUrl() {
  if (typeof location === 'undefined') return `ws://127.0.0.1:${DEFAULT_RELAY_PORT}/room`;
  const host = location.hostname || '127.0.0.1';
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${host}:${DEFAULT_RELAY_PORT}/room`;
}

export class CollabPanel {
  constructor() {
    this.root = null;
    this.overlay = null;
    this.session = null;
    this.grants = null;
    this.open = false;
    this.access = null;
    this.prefs = loadPrefs();
    this.pointerHandler = null;
    this.overlayFrame = null;
  }

  // ------------------------------------------------------------------
  // Shell
  // ------------------------------------------------------------------

  ensureStyles() {
    if (document.getElementById('rz-collab-styles')) return;
    const style = document.createElement('style');
    style.id = 'rz-collab-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  ensureRoot() {
    if (this.root) return this.root;
    this.ensureStyles();

    this.root = document.createElement('div');
    this.root.className = 'rz-collab';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Collab space');

    const head = document.createElement('div');
    head.className = 'rz-collab-head';
    const title = document.createElement('div');
    title.className = 'rz-collab-title';
    title.textContent = 'Collab space';
    const close = document.createElement('button');
    close.className = 'rz-collab-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', () => this.hide());
    head.append(title, close);

    this.body = document.createElement('div');
    this.body.className = 'rz-collab-body';

    this.root.append(head, this.body);
    document.body.appendChild(this.root);
    return this.root;
  }

  async toggle() {
    if (this.open) {
      this.hide();
      return;
    }
    this.ensureRoot();
    this.root.hidden = false;
    this.open = true;
    this.body.replaceChildren(this.note('Checking your plan…'));
    this.access = await resolveCollabAccess();
    this.render();
  }

  hide() {
    this.open = false;
    if (this.root) this.root.hidden = true;
  }

  // ------------------------------------------------------------------
  // Drawing
  // ------------------------------------------------------------------

  note(text) {
    const p = document.createElement('p');
    p.className = 'rz-collab-note';
    p.textContent = text;
    return p;
  }

  field(label, value, onInput) {
    const wrap = document.createElement('div');
    wrap.className = 'rz-collab-field';
    const id = `rz-collab-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    const el = document.createElement('label');
    el.setAttribute('for', id);
    el.textContent = label;
    const input = document.createElement('input');
    input.id = id;
    input.type = 'text';
    input.value = value || '';
    input.addEventListener('input', () => onInput(input.value));
    wrap.append(el, input);
    return { wrap, input };
  }

  render() {
    if (!this.open) return;
    this.body.replaceChildren();

    if (this.session) {
      this.renderSession();
      return;
    }
    if (!this.access?.allowed) {
      this.renderLocked();
      return;
    }
    this.renderJoinForm();
  }

  renderLocked() {
    const check = this.access;
    this.body.appendChild(this.note(refusalMessage(check)));

    if (check.remedy === 'retry') {
      const retry = document.createElement('button');
      retry.className = 'rz-collab-btn';
      retry.type = 'button';
      retry.textContent = 'Check again';
      retry.addEventListener('click', async () => {
        this.access = await resolveCollabAccess({ force: true });
        this.render();
      });
      this.body.appendChild(retry);
      return;
    }

    // Nothing to sell on an unpublished feature: an upgrade link here would be
    // selling something the gallery cannot switch on yet.
    if (check.reason === 'feature_unpublished') return;

    const link = document.createElement('button');
    link.className = 'rz-collab-link';
    link.type = 'button';
    link.textContent = check.remedy === 'sign_in'
      ? 'Sign in to the gallery'
      : `See what ${check.requiredTierLabel} includes`;
    link.addEventListener('click', () => openExternal(check.upgradeUrl));
    this.body.appendChild(link);
  }

  renderJoinForm() {
    const name = this.field('Your name', this.prefs.name || '', (value) => {
      this.prefs.name = value;
      savePrefs(this.prefs);
    });
    const room = this.field('Room', this.prefs.room || suggestRoom(), (value) => {
      this.prefs.room = value;
      savePrefs(this.prefs);
    });
    const relay = this.field('Relay', this.prefs.relay || defaultRelayUrl(), (value) => {
      this.prefs.relay = value;
      savePrefs(this.prefs);
    });

    const actions = document.createElement('div');
    actions.className = 'rz-collab-actions';
    const join = document.createElement('button');
    join.className = 'rz-collab-btn primary';
    join.type = 'button';
    join.textContent = 'Join room';
    join.addEventListener('click', () => {
      this.prefs = {
        name: name.input.value.trim() || 'Artist',
        room: room.input.value.trim(),
        relay: relay.input.value.trim(),
      };
      savePrefs(this.prefs);
      this.startSession();
    });
    actions.appendChild(join);

    this.body.append(
      this.note('Everyone in the same room edits one canvas. The first person in sets the canvas; anyone joining after adopts it.'),
      name.wrap,
      room.wrap,
      relay.wrap,
      actions,
      this.limits(),
    );
  }

  /** What this build of the collab space does not do. Said before, not after. */
  limits() {
    const list = document.createElement('ul');
    list.className = 'rz-collab-limits';
    for (const text of [
      'Joining replaces your open canvas with the room’s.',
      'Concurrent edits to one node settle on the last one in — they do not merge.',
      'Other people’s edits are not in your undo history.',
    ]) {
      const li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    }
    return list;
  }

  renderSession() {
    const state = this.session.state;
    const row = document.createElement('div');
    row.className = 'rz-collab-state';
    const dot = document.createElement('span');
    dot.className = 'rz-collab-dot';
    if (state === STATES.LIVE) dot.classList.add('live');
    else if (state === STATES.FAILED) dot.classList.add('bad');
    else if (state !== STATES.CLOSED) dot.classList.add('busy');
    const label = document.createElement('span');
    if (this.session.refused) {
      // The relay turned this peer away and said why. Its sentence is the whole
      // answer; prefixing it with "Could not reach the room" would be wrong as
      // well as redundant — the room was reached, and it said no.
      label.textContent = this.session.lastError;
    } else if (this.session.lastError && state !== STATES.LIVE) {
      label.textContent = `${STATE_COPY[state] || state} — ${this.session.lastError}`;
    } else {
      label.textContent = STATE_COPY[state] || state;
    }
    row.append(dot, label);

    const peers = document.createElement('ul');
    peers.className = 'rz-collab-peers';
    for (const peer of this.session.roster) {
      const li = document.createElement('li');
      const chip = document.createElement('span');
      chip.className = 'rz-collab-chip';
      chip.style.background = peerColor(peer.peerId);
      const who = document.createElement('span');
      who.textContent = peer.name;
      li.append(chip, who);
      if (peer.peerId === this.session.peerId) {
        const you = document.createElement('span');
        you.className = 'rz-collab-you';
        you.textContent = 'you';
        li.appendChild(you);
      }
      peers.appendChild(li);
    }

    const actions = document.createElement('div');
    actions.className = 'rz-collab-actions';
    const copy = document.createElement('button');
    copy.className = 'rz-collab-btn';
    copy.type = 'button';
    copy.textContent = 'Copy invite';
    copy.addEventListener('click', () => {
      const invite = `${this.prefs.relay} · room ${this.prefs.room}`;
      navigator.clipboard?.writeText(invite).catch(() => {});
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy invite'; }, 1500);
    });
    const leave = document.createElement('button');
    leave.className = 'rz-collab-btn danger';
    leave.type = 'button';
    leave.textContent = 'Leave';
    leave.addEventListener('click', () => this.endSession());
    actions.append(copy, leave);

    this.body.append(
      this.note(`Room ${this.prefs.room}`),
      row,
      peers,
      actions,
    );
  }

  // ------------------------------------------------------------------
  // Session
  // ------------------------------------------------------------------

  graph() {
    return window.editor?.graph || window.graph || null;
  }

  startSession() {
    if (!this.prefs.room) return;
    const graph = this.graph();
    const occupied = (graph?.nodes?.length || 0) > 0;
    if (occupied && !window.confirm(
      'Joining a room replaces the canvas you have open with the room’s canvas. Unsaved work here will be lost. Join anyway?'
    )) {
      return;
    }

    // A pass for the door, fetched fresh for every hello this session sends.
    // A relay on loopback will not ask for one; one on a public address will,
    // and the gallery is the only thing that can issue it (collabGrant.js).
    this.grants = collabGrantGetter();

    this.session = new CollabSession({
      url: this.prefs.relay,
      getGraph: () => this.graph(),
      onGraphChanged: () => this.requestRedraw(),
      getGrant: this.grants,
    });

    this.session.on('state', () => this.render());
    this.session.on('peers', () => this.render());
    this.session.on('cursors', (cursors) => this.drawCursors(cursors));
    this.session.on('error', ({ message }) => window.updateStatus?.(message, 'warning'));

    this.session.join(this.prefs.room, { name: this.prefs.name }).catch(() => {
      // The session reports the failure through its state event; nothing to
      // add here that the panel is not already showing.
    });

    this.trackPointer();
    this.render();
  }

  endSession() {
    this.session?.leave();
    this.session = null;
    this.grants = null;
    this.untrackPointer();
    this.clearCursors();
    this.render();
  }

  requestRedraw() {
    // The editor redraws through whichever scheduler is wired up; ask the ones
    // that exist and let the rest ignore us.
    window.editor?.requestRedraw?.();
    window.drawGraph?.();
  }

  // ------------------------------------------------------------------
  // Presence on the canvas
  // ------------------------------------------------------------------

  trackPointer() {
    if (this.pointerHandler) return;
    const canvas = document.getElementById('ui-canvas');
    if (!canvas) return;
    this.pointerHandler = (event) => {
      const viewport = window.editor?.viewport;
      if (!viewport || !this.session) return;
      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left - viewport.offsetX) / viewport.scale;
      const y = (event.clientY - rect.top - viewport.offsetY) / viewport.scale;
      this.session.moveCursor(x, y);
    };
    canvas.addEventListener('pointermove', this.pointerHandler, { passive: true });
  }

  untrackPointer() {
    const canvas = document.getElementById('ui-canvas');
    if (canvas && this.pointerHandler) {
      canvas.removeEventListener('pointermove', this.pointerHandler);
    }
    this.pointerHandler = null;
  }

  ensureOverlay() {
    if (this.overlay) return this.overlay;
    this.ensureStyles();
    this.overlay = document.createElement('div');
    this.overlay.className = 'rz-collab-cursors';
    document.body.appendChild(this.overlay);
    return this.overlay;
  }

  /**
   * Remote pointers arrive in canvas coordinates, so they stay put on the
   * patch while each artist pans and zooms their own view independently — a
   * cursor sent in screen pixels would point at a different node on every
   * screen in the room.
   */
  drawCursors(cursors) {
    this.lastCursors = cursors;
    if (this.overlayFrame) return;
    this.overlayFrame = requestAnimationFrame(() => {
      this.overlayFrame = null;
      this.paintCursors();
    });
  }

  paintCursors() {
    const overlay = this.ensureOverlay();
    const viewport = window.editor?.viewport;
    const canvas = document.getElementById('ui-canvas');
    if (!viewport || !canvas) return;
    const rect = canvas.getBoundingClientRect();

    overlay.replaceChildren();
    for (const cursor of this.lastCursors || []) {
      const el = document.createElement('div');
      el.className = 'rz-collab-cursor';
      el.style.left = `${rect.left + cursor.x * viewport.scale + viewport.offsetX}px`;
      el.style.top = `${rect.top + cursor.y * viewport.scale + viewport.offsetY}px`;
      el.innerHTML = `<svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true">`
        + `<path d="M1 1 L11 10 L6 10.5 L8.5 16 L6.5 17 L4 11.5 L1 14 Z" fill="${cursor.color}" stroke="rgba(0,0,0,0.5)" stroke-width="0.75"/></svg>`;
      const tag = document.createElement('span');
      tag.textContent = cursor.name;
      tag.style.background = cursor.color;
      el.appendChild(tag);
      overlay.appendChild(el);
    }
  }

  clearCursors() {
    this.lastCursors = [];
    this.overlay?.replaceChildren();
  }
}

let panel = null;

/** The one collab panel, created on first use. */
export function getCollabPanel() {
  if (!panel) panel = new CollabPanel();
  return panel;
}
