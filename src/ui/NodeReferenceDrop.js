// src/ui/NodeReferenceDrop.js
//
// Drag a node from the graph onto a parameter field to reference it.
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
// Colors, files, selects, booleans and code blocks are not expression-evaluated, so they
// are never drop targets.
const REFERENCEABLE_PARAM_TYPES = new Set(['float', 'int', 'expression', 'string', 'text']);

const HOVER_CLASS = 'node-ref-drop-target';

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
    this.targets = this._collectTargets(String(node.id));
    this.active = this.targets.length > 0;
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
      this._showBadge(clientX, clientY);
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
    this.cleanup();

    if (!target || !token) return false;

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
    this.targets = [];
  }

  _collectTargets(draggedNodeId) {
    const targets = [];

    for (const el of document.querySelectorAll('.param-input[data-param]')) {
      if (el.disabled) continue;

      const type = el.dataset.paramType;
      if (!REFERENCEABLE_PARAM_TYPES.has(type)) continue;

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
    return null;
  }

  _setHovered(target) {
    if (this.hovered?.el) {
      this.hovered.el.classList.remove(HOVER_CLASS);
    }
    this.hovered = target;
    if (target?.el) {
      target.el.classList.add(HOVER_CLASS);
    }
  }

  _showBadge(clientX, clientY) {
    if (!this.badge) {
      this.badge = document.createElement('div');
      this.badge.className = 'node-ref-drop-badge';
      document.body.appendChild(this.badge);
    }
    this.badge.textContent = this.token;
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
