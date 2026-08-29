// src/ui/ViewerControlsPanel.js
//
// The Web Viewer Controls panel: where an artist decides which parameters a
// visitor gets to move.
//
// The panel edits a {@link ViewerControlsModel} and nothing else. It never
// touches node parameters — moving a slider here would change the artwork, and
// what is being authored is the OFFER, not the value. Setting a range up is a
// composition decision ("this patch is interesting between 0.2 and 0.8"), so
// the range is stored per control rather than taken from the node definition
// every time.
//
// Its shape follows the screens panel: a floating tool window, a header you can
// drag, an add row, and one row per thing being offered. That is the house form
// for "a small list that is part of the document".

import { makeDraggable } from './utils/draggable.js';
import {
  MAX_VIEWER_CONTROLS,
  exposableParameters,
  holdsExpression,
  parameterDef,
  parameterLabel,
} from '../viewer/ViewerControls.js';
import { nodeDisplayName } from '../core/nodeName.js';

export class ViewerControlsPanel {
  /**
   * @param {import('../viewer/ViewerControls.js').ViewerControlsModel} model
   * @param {Object} [opts]
   * @param {() => Array<object>} [opts.getNodes] the graph's nodes, read fresh
   *   on every render — the graph changes under this panel while it is open
   * @param {(message: string, kind?: string) => void} [opts.onStatus]
   * @param {() => void} [opts.onPreview] open the web viewer, for the footer button
   * @param {() => boolean} [opts.canPreview] whether the preview button applies
   *   at all (it does not in the desktop app, which has no second tab to open)
   */
  constructor(model, opts = {}) {
    this.model = model;
    this.getNodes = typeof opts.getNodes === 'function' ? opts.getNodes : () => [];
    this.onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};
    this.onPreview = typeof opts.onPreview === 'function' ? opts.onPreview : null;
    this.canPreview = typeof opts.canPreview === 'function' ? opts.canPreview : () => true;

    this.isOpen = false;
    /** Which node the add row is aimed at, kept across re-renders. */
    this.pendingNodeId = '';

    this._createPanel();
    this._unsubscribe = this.model.onChange(() => {
      if (this.isOpen) this._render();
    });
  }

  // --- construction -------------------------------------------------------

  _createPanel() {
    const panel = document.createElement('div');
    panel.id = 'viewer-controls-panel';
    panel.innerHTML = `
      <div class="rz-vc-header">
        <h3 class="rz-vc-title">Web Viewer Controls</h3>
        <button class="rz-vc-close" data-act="close" aria-label="Close">&times;</button>
      </div>

      <p class="rz-vc-intro">
        Parameters listed here appear as controls beside the patch in the web
        viewer, so whoever opens the link can move them. Nothing is offered
        unless you put it here, and a parameter driven by a formula stays the
        formula's.
      </p>

      <div class="rz-vc-add">
        <select class="rz-vc-select" data-role="node" aria-label="Node"></select>
        <select class="rz-vc-select" data-role="param" aria-label="Parameter"></select>
        <button class="rz-vc-btn rz-vc-primary" data-act="add">+ Offer</button>
      </div>

      <div class="rz-vc-list" data-role="list"></div>

      <div class="rz-vc-foot">
        <span data-role="summary"></span>
        <span class="rz-vc-spacer"></span>
        <button class="rz-vc-btn" data-act="preview">Open in Web Viewer</button>
      </div>
    `;
    document.body.appendChild(panel);

    this.panel = panel;
    this.nodeSelect = panel.querySelector('[data-role="node"]');
    this.paramSelect = panel.querySelector('[data-role="param"]');
    this.listEl = panel.querySelector('[data-role="list"]');
    this.summaryEl = panel.querySelector('[data-role="summary"]');
    this.previewBtn = panel.querySelector('[data-act="preview"]');

    this._cleanupDraggable = makeDraggable(panel, panel.querySelector('.rz-vc-header'));

    panel.addEventListener('click', (e) => this._onClick(e));
    panel.addEventListener('change', (e) => this._onChange(e));
  }

  // --- open / close -------------------------------------------------------

  open() {
    this.isOpen = true;
    this.panel.classList.add('rz-vc-open');
    this._render();
  }

  close() {
    this.isOpen = false;
    this.panel.classList.remove('rz-vc-open');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  destroy() {
    try { this._unsubscribe?.(); } catch { /* ignore */ }
    try { this._cleanupDraggable?.(); } catch { /* ignore */ }
    try { this.panel?.remove(); } catch { /* ignore */ }
  }

  // --- events -------------------------------------------------------------

  _onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const row = btn.closest('[data-node-id]');
    const nodeId = row?.dataset.nodeId;
    const param = row?.dataset.param;

    if (act === 'close') { this.close(); return; }
    if (act === 'add') { this._add(); return; }
    if (act === 'preview') {
      this.onPreview?.();
      return;
    }
    if (act === 'remove' && nodeId) {
      this.model.remove(nodeId, param);
      return;
    }
    if (act === 'up' && nodeId) { this.model.move(nodeId, param, -1); return; }
    if (act === 'down' && nodeId) { this.model.move(nodeId, param, 1); return; }
  }

  _onChange(e) {
    const el = e.target;

    if (el.dataset.role === 'node') {
      this.pendingNodeId = el.value;
      this._renderAddRow();
      return;
    }
    if (el.dataset.role === 'param') return;

    const row = el.closest('[data-node-id]');
    if (!row) return;
    const { nodeId, param } = row.dataset;

    const patch = {};
    if (el.dataset.role === 'label') patch.label = el.value;
    if (el.dataset.role === 'min') patch.min = el.value;
    if (el.dataset.role === 'max') patch.max = el.value;
    if (el.dataset.role === 'step') patch.step = el.value;
    if (!Object.keys(patch).length) return;

    this.model.update(nodeId, param, patch);
    // The model sanitizes; redraw so the fields show what was actually stored
    // rather than what was typed.
    this._render();
  }

  _add() {
    const nodeId = this.nodeSelect.value;
    const param = this.paramSelect.value;
    if (!nodeId || !param) {
      this.onStatus('Pick a node and a parameter to offer.', 'warning');
      return;
    }

    const node = this.getNodes().find((n) => String(n?.id) === nodeId);
    if (!node) {
      this.onStatus('That node is no longer in the graph.', 'warning');
      this._render();
      return;
    }

    const result = this.model.add(node, param);
    if (!result.ok) {
      this.onStatus(result.reason, 'warning');
      return;
    }
    this.onStatus(`${result.control.label} is now a web viewer control.`);
  }

  // --- rendering ----------------------------------------------------------

  _render() {
    this._renderAddRow();
    this._renderList();
    this._renderFoot();
  }

  /**
   * The add row. Only nodes with something offerable are listed, and only the
   * parameters that are not already offered — the picker should never be able
   * to produce a refusal the artist could have seen coming.
   */
  _renderAddRow() {
    const nodes = this.getNodes();
    const candidates = nodes
      .map((node) => ({ node, params: this._availableParams(node) }))
      .filter((entry) => entry.params.length > 0);

    if (!candidates.some((c) => String(c.node.id) === this.pendingNodeId)) {
      this.pendingNodeId = candidates.length ? String(candidates[0].node.id) : '';
    }

    this.nodeSelect.innerHTML = candidates.length
      ? candidates
          .map(({ node }) => {
            const id = escapeHtml(String(node.id));
            const selected = String(node.id) === this.pendingNodeId ? ' selected' : '';
            return `<option value="${id}"${selected}>${escapeHtml(nodeDisplayName(node))} #${id}</option>`;
          })
          .join('')
      : '<option value="">Nothing to offer yet</option>';

    const current = candidates.find((c) => String(c.node.id) === this.pendingNodeId);
    this.paramSelect.innerHTML = current
      ? current.params
          .map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.label)}</option>`)
          .join('')
      : '<option value="">—</option>';

    const empty = candidates.length === 0;
    this.nodeSelect.disabled = empty;
    this.paramSelect.disabled = empty;
    this.panel.querySelector('[data-act="add"]').disabled = empty || this.model.isFull;
  }

  /**
   * What this node could still offer: an exposable parameter that is not
   * already a control and is not currently held by a formula.
   */
  _availableParams(node) {
    return exposableParameters(node).filter(
      (p) => !this.model.has(node.id, p.name) && !holdsExpression(node, p.name),
    );
  }

  _renderList() {
    const controls = this.model.list();
    const nodes = this.getNodes();
    const byId = new Map(nodes.map((n) => [String(n?.id), n]));

    if (!controls.length) {
      this.listEl.innerHTML = `
        <p class="rz-vc-empty">
          No controls yet. This patch plays in the viewer exactly as it does here.
        </p>`;
      return;
    }

    this.listEl.innerHTML = controls
      .map((control, index) => this._rowHtml(control, byId.get(control.nodeId), index, controls.length))
      .join('');
  }

  _rowHtml(control, node, index, total) {
    const id = escapeHtml(control.nodeId);
    const param = escapeHtml(control.param);
    const def = node ? parameterDef(node, control.param) : null;

    // A control whose node has gone says so instead of pretending: it will not
    // be written to the file, and the artist may want to undo the delete rather
    // than lose the control.
    const missing = !node;
    const source = missing
      ? `Node #${id} is no longer in the graph`
      : `${escapeHtml(nodeDisplayName(node))} #${id} · ${escapeHtml(def ? parameterLabel(def) : control.param)}`;

    const range = control.kind === 'slider'
      ? `
        <div class="rz-vc-row-range">
          <label>Min<input type="number" data-role="min" value="${control.min}" step="any" /></label>
          <label>Max<input type="number" data-role="max" value="${control.max}" step="any" /></label>
          <label>Step<input type="number" data-role="step" value="${control.step}" min="0" step="any" /></label>
        </div>`
      : `<div class="rz-vc-row-range rz-vc-row-note">${
          control.kind === 'toggle' ? 'A switch: on or off.' : 'A menu of this parameter’s modes.'
        }</div>`;

    return `
      <div class="rz-vc-row${missing ? ' rz-vc-missing' : ''}" data-node-id="${id}" data-param="${param}">
        <div class="rz-vc-row-top">
          <span class="rz-vc-kind" title="How this appears in the viewer">${control.kind}</span>
          <input class="rz-vc-label" data-role="label" value="${escapeHtml(control.label)}" maxlength="40"
                 title="What the viewer calls this control" />
          <button class="rz-vc-move" data-act="up" ${index === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button class="rz-vc-move" data-act="down" ${index === total - 1 ? 'disabled' : ''} title="Move down">↓</button>
          <button class="rz-vc-remove" data-act="remove" title="Stop offering this parameter">&times;</button>
        </div>
        <div class="rz-vc-row-source">${source}</div>
        ${range}
      </div>`;
  }

  _renderFoot() {
    const n = this.model.count;
    this.summaryEl.textContent = n
      ? `${n} of ${MAX_VIEWER_CONTROLS} controls`
      : 'No controls offered';

    const previewable = !!this.onPreview && this.canPreview();
    this.previewBtn.style.display = previewable ? '' : 'none';
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let _panel = null;

/**
 * The one viewer controls panel, created on first use.
 * @param {import('../viewer/ViewerControls.js').ViewerControlsModel} model
 * @param {Object} [opts] see {@link ViewerControlsPanel}
 * @returns {ViewerControlsPanel}
 */
export function getViewerControlsPanel(model, opts) {
  if (!_panel) _panel = new ViewerControlsPanel(model, opts);
  return _panel;
}
