// src/ui/NodeReferenceDrop.js
//
// Drag a node from the graph onto a parameter field to reference it — or onto any
// other zone that has registered itself, such as a projection-mapping surface.
//
// A parameter can already reference another node by typing its identifier by hand
// (`=node_12`, resolved by UnifiedExpressionSystem). That requires knowing the id of the
// node you want, which is only visible on the node itself. This controller adds the direct
// gesture for the same thing: pick the node up, drop it on the field, and the reference is
// written for you.
//
// The graph lives on a canvas, so there are no DOM nodes to hand to the native HTML5
// drag-and-drop API. The gesture is instead driven from the existing node-drag in
// EventHandler: begin() when a node drag starts, update() on each move, finish() on release.
//
// Target rects are measured once in begin() rather than per mousemove — a node drag emits
// mousemove at pointer rate, and getBoundingClientRect()/elementFromPoint() there would
// force layout on every one of them. The parameter panel is a fixed-position element that
// nothing scrolls or resizes while a node is being dragged on the canvas, so the cached
// rects stay accurate for the life of the gesture.

// Parameter types whose value is a scalar/expression a node reference can stand in for.
// Colors, files and code blocks are not expression-evaluated, so they are never drop targets.
//
// A dropdown or a true/false toggle is not a target as a WIDGET — there is nowhere in a <select>
// or a checkbox to put "=node_5". Switched into fx mode it is an ordinary expression textarea and
// takes a drop like any other: the check below matches those by their expression-capable class
// rather than by declared type, so the gesture follows the field the user is actually looking at.
const REFERENCEABLE_PARAM_TYPES = new Set(['float', 'int', 'expression', 'string', 'text']);

const EXPRESSION_FIELD_CLASS = 'expression-capable';

function acceptsNodeReference(el) {
  return REFERENCEABLE_PARAM_TYPES.has(el.dataset.paramType)
    || el.classList.contains(EXPRESSION_FIELD_CLASS);
}

const HOVER_CLASS = 'node-ref-drop-target';

/**
 * Drop zones contributed from outside the parameter panel.
 *
 * A parameter field is a DOM rect, which is all the panel ever needed. A mapping
 * surface is a quad drawn on a canvas, so it cannot be hit-tested by rect and
 * cannot be highlighted by a CSS class — a zone brings its own hit test and its
 * own highlight instead of the gesture trying to guess at either.
 *
 * @typedef {object} DropZone
 * @property {(nodeId: string) => boolean} accepts whether this zone takes the dragged node
 * @property {(clientX: number, clientY: number) => *} hitTest the thing under the pointer, or null
 * @property {(hit: *, nodeId: string) => void} drop commit the drop
 * @property {(hit: *|null) => void} [highlight] show what a release would hit
 * @property {(hit: *) => string} [label] badge text; defaults to the node reference token
 */
const dropZones = new Set();

/**
 * Register a drop zone for node drags.
 * @param {DropZone} zone
 * @returns {Function} unregister
 */
export function registerNodeDropZone(zone) {
  if (!zone || typeof zone.hitTest !== 'function' || typeof zone.drop !== 'function') {
    return () => {};
  }
  dropZones.add(zone);
  return () => dropZones.delete(zone);
}

export const nodeReferenceDropStyles = `
.node-ref-drop-target {
  outline: 2px dashed #c6f24e;
  outline-offset: 2px;
}

.node-ref-drop-badge {
  position: fixed;
  z-index: 10001;
  pointer-events: none;
  padding: 3px 6px;
  background: #c6f24e;
  color: #14110a;
  border-radius: 3px;
  font-family: var(--rz-font-mono);
  font-size: 11px;
  white-space: nowrap;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}
`;

/**
 * Build the expression identifier for a node, the same form the expression system resolves
 * (see UnifiedExpressionSystem._buildInputNodeReferenceMapping).
 */
export function nodeReferenceToken(nodeId) {
  return `node_${nodeId}`;
}

/**
 * Write a node reference into a parameter field.
 *
 * The drop replaces whatever the field currently holds with `=node_5`, whether that was a
 * literal like `0.5` or an existing expression. The gesture reads as "this parameter is now
 * driven by that node", so appending to what was already there — leaving `=sin(time) * node_5`
 * or `0.node_55` behind — is never what was meant.
 *
 * @returns {string} the value written to the field.
 */
export function insertNodeReference(input, token) {
  const next = `=${token}`;
  const caret = next.length;

  // Focus BEFORE writing the value. The expression input handler snapshots the field's
  // contents on focus as "the last committed value" and skips the commit when the value it
  // later sees is unchanged from that snapshot — focusing after the write would hand it the
  // reference as the baseline, and the parameter would never be stored.
  try {
    input.focus();
  } catch {
    // A detached field cannot take focus; the value is still set below.
  }

  input.value = next;

  if (typeof input.setSelectionRange === 'function') {
    try {
      input.setSelectionRange(caret, caret);
    } catch {
      // Not every input type exposes a text selection.
    }
  }

  // The input handlers own validation, styling and the debounced commit — drive them through
  // their normal events rather than duplicating the commit path here.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  return next;
}

export class NodeReferenceDrop {
  constructor({ onDrop = null } = {}) {
    this.onDrop = onDrop;
    this.active = false;
    this.token = null;
    this.targets = [];
    this.zones = [];
    this.draggedNodeId = null;
    this.hovered = null;
    this.badge = null;
  }

  /**
   * Start tracking a node drag. Collects the parameter fields that can accept a reference to
   * `node` and measures them once.
   */
  begin(node) {
    this.cleanup();

    if (!node || node.id === undefined || node.id === null) return;
    if (typeof document === 'undefined') return;

    this.token = nodeReferenceToken(node.id);
    this.draggedNodeId = String(node.id);
    this.targets = this._collectTargets(this.draggedNodeId);
    this.zones = [...dropZones].filter((zone) => {
      try {
        return typeof zone.accepts !== 'function' || zone.accepts(this.draggedNodeId);
      } catch {
        return false; // a broken zone must not break dragging a node
      }
    });
    this.active = this.targets.length > 0 || this.zones.length > 0;
  }

  /** Is a reference drag in progress with at least one field to drop on? */
  isActive() {
    return this.active;
  }

  /**
   * Track the pointer. Highlights the field under it, if any.
   * @returns {boolean} true while the pointer is over a drop target.
   */
  update(clientX, clientY) {
    if (!this.active) return false;

    const target = this._hitTest(clientX, clientY);

    if (target !== this.hovered) {
      this._setHovered(target);
    }

    if (target) {
      this._showBadge(clientX, clientY, this._badgeText(target));
      return true;
    }

    this._hideBadge();
    return false;
  }

  /**
   * End the gesture. Writes the reference when the pointer is over a field.
   * @returns {boolean} true when a reference was inserted, so the caller can restore the
   *                    node's position instead of committing the move.
   */
  finish(clientX, clientY) {
    if (!this.active) {
      this.cleanup();
      return false;
    }

    const target = this._hitTest(clientX, clientY);
    const token = this.token;
    const nodeId = this.draggedNodeId;
    this.cleanup();

    if (!target || !token) return false;

    // A zone commits the drop its own way — wiring a graph connection, say,
    // rather than writing a reference into a text field.
    if (target.zone) {
      try {
        target.zone.drop(target.hit, nodeId);
      } catch {
        return false; // the drop failed; treat the drag as a plain node move
      }
      return true;
    }

    insertNodeReference(target.el, token);

    if (typeof this.onDrop === 'function') {
      this.onDrop({
        token,
        input: target.el,
        paramName: target.el.dataset?.param || '',
        targetNodeId: target.el.dataset?.nodeId || '',
      });
    }

    return true;
  }

  /** Abandon the gesture without inserting anything (e.g. the drag was cancelled). */
  cancel() {
    this.cleanup();
    return false;
  }

  cleanup() {
    this._setHovered(null);
    this._removeBadge();
    this.active = false;
    this.token = null;
    this.draggedNodeId = null;
    this.targets = [];
    this.zones = [];
  }

  _collectTargets(draggedNodeId) {
    const targets = [];

    for (const el of document.querySelectorAll('.param-input[data-param]')) {
      if (el.disabled) continue;

      if (!acceptsNodeReference(el)) continue;

      // A parameter referencing its own node is a cycle the expression system cannot resolve,
      // so those fields are not offered as targets.
      if (el.dataset.nodeId && el.dataset.nodeId === draggedNodeId) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      targets.push({ el, rect });
    }

    return targets;
  }

  _hitTest(clientX, clientY) {
    for (const target of this.targets) {
      const { rect } = target;
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return target;
      }
    }

    // Parameter fields win where they overlap: they are small, explicit targets
    // sitting above the canvas a zone is drawn on.
    for (const zone of this.zones) {
      let hit = null;
      try {
        hit = zone.hitTest(clientX, clientY);
      } catch {
        hit = null;
      }
      if (hit) return { zone, hit };
    }
    return null;
  }

  _setHovered(target) {
    if (this.hovered?.el) {
      this.hovered.el.classList.remove(HOVER_CLASS);
    }
    if (this.hovered?.zone?.highlight) {
      try { this.hovered.zone.highlight(null); } catch { /* ignore */ }
    }
    this.hovered = target;
    if (target?.el) {
      target.el.classList.add(HOVER_CLASS);
    }
    if (target?.zone?.highlight) {
      try { target.zone.highlight(target.hit); } catch { /* ignore */ }
    }
  }

  /** Badge text for the thing under the pointer. */
  _badgeText(target) {
    if (target?.zone?.label) {
      try {
        return target.zone.label(target.hit) || this.token;
      } catch {
        return this.token;
      }
    }
    return this.token;
  }

  _showBadge(clientX, clientY, text = this.token) {
    if (!this.badge) {
      this.badge = document.createElement('div');
      this.badge.className = 'node-ref-drop-badge';
      document.body.appendChild(this.badge);
    }
    this.badge.textContent = text;
    this.badge.style.left = `${clientX + 14}px`;
    this.badge.style.top = `${clientY + 14}px`;
  }

  _hideBadge() {
    if (this.badge) {
      this.badge.style.left = '-9999px';
    }
  }

  _removeBadge() {
    if (this.badge) {
      this.badge.remove();
      this.badge = null;
    }
  }
}
