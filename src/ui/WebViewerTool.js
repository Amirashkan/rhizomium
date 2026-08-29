// src/ui/WebViewerTool.js
//
// THE WEB VIEWER TOOL: one window for the page a link leads to, and the link.
//
// Publishing to the web used to be spread across the File menu — a Publish
// submenu that uploads a still, an "Open in Web Viewer" that opens a tab — with
// nothing that answered "what will people see, and what do I send them?". This
// is that place, in the order those questions come up:
//
//   PAGE      the room the piece hangs in: title, ground, framing, apparatus
//   CONTROLS  which parameters a visitor may move (see viewer/ViewerControls.js)
//   LINK      the URL, and which of the two kinds of URL it is
//
// The tool edits two documents (ViewerPageModel, ViewerControlsModel) and asks
// viewerLink.js for URLs. It holds no state of its own beyond what is being
// typed and the last link produced, so closing and reopening it shows the patch
// as it stands rather than as the tool last remembered it.

import { makeDraggable } from './utils/draggable.js';
import {
  MAX_VIEWER_CONTROLS,
  exposableParameters,
  holdsExpression,
  parameterDef,
  parameterLabel,
} from '../viewer/ViewerControls.js';
import { nodeDisplayName } from '../core/nodeName.js';
import { copyToClipboard, makePreviewLink, makeShareLink, publishForLink } from './viewerLink.js';
import { modalManager } from './ModalManager.js';
import { openExternal } from '../utils/openExternal.js';

/** The three sections, in the order the questions come up. */
const SECTIONS = [
  ['page', 'Page'],
  ['controls', 'Controls'],
  ['link', 'Link'],
];

const FIT_CHOICES = [
  ['contain', 'Fit', 'The whole composition, letterboxed into the window'],
  ['cover', 'Fill', 'Fills the window; the edges of the composition are cropped'],
];

const CONTROLS_CHOICES = [
  ['auto', 'Fade', 'Shown, then fades out until the visitor moves the pointer'],
  ['pinned', 'Always', 'Stays open from the moment the patch appears'],
  ['hidden', 'Hidden', 'The controls stay in the patch, but this page does not show them'],
];

export class WebViewerTool {
  /**
   * @param {object} models
   * @param {import('../viewer/ViewerPageModel.js').ViewerPageModel} models.page
   * @param {import('../viewer/ViewerControls.js').ViewerControlsModel} models.controls
   * @param {Object} [opts]
   * @param {() => Array<object>} [opts.getNodes] the graph's nodes, read fresh
   *   on every render — the graph changes under this tool while it is open
   * @param {() => string} [opts.getProjectName]
   * @param {(message: string, kind?: string) => void} [opts.onStatus]
   * @param {() => void} [opts.onOpenViewer] File → Open in Web Viewer
   * @param {() => boolean} [opts.canOpenViewer] false in the desktop app, which
   *   has no second tab to open
   */
  constructor(models, opts = {}) {
    this.pageModel = models.page;
    this.controlsModel = models.controls;

    this.getNodes = typeof opts.getNodes === 'function' ? opts.getNodes : () => [];
    this.getProjectName = typeof opts.getProjectName === 'function' ? opts.getProjectName : () => '';
    /** The last paste that was refused, shown under the field that caused it. */
    this.linkError = '';
    this.onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};
    this.onOpenViewer = typeof opts.onOpenViewer === 'function' ? opts.onOpenViewer : null;
    this.canOpenViewer = typeof opts.canOpenViewer === 'function' ? opts.canOpenViewer : () => true;

    this.isOpen = false;
    this.section = 'page';
    /** Which node the add row is aimed at, kept across re-renders. */
    this.pendingNodeId = '';
    /** The last link produced, and which of the two kinds it is. */
    this.link = null;
    /** What is in the "already published" field, kept across re-renders. */
    this.pendingPatchUrl = '';
    this.busy = false;

    this._createPanel();
    // `_silent` is held across a colour-picker drag: the picker fires `input`
    // continuously, and rebuilding the section under it would close it on the
    // first pixel of movement.
    this._silent = false;
    const redraw = () => {
      if (this.isOpen && !this._silent) this._render();
    };
    this._unsubscribe = [this.pageModel.onChange(redraw), this.controlsModel.onChange(redraw)];
  }

  // --- construction -------------------------------------------------------

  _createPanel() {
    const panel = document.createElement('div');
    panel.id = 'web-viewer-tool';
    panel.innerHTML = `
      <div class="rz-wv-header">
        <h3 class="rz-wv-title">Web Viewer</h3>
        <button class="rz-wv-close" data-act="close" aria-label="Close">&times;</button>
      </div>

      <div class="rz-wv-tabs" role="tablist">
        ${SECTIONS.map(([id, label]) =>
          `<button class="rz-wv-tab" role="tab" data-act="section" data-section="${id}">${label}</button>`,
        ).join('')}
      </div>

      <div class="rz-wv-body" data-role="body"></div>
    `;
    document.body.appendChild(panel);

    this.panel = panel;
    this.bodyEl = panel.querySelector('[data-role="body"]');

    this._cleanupDraggable = makeDraggable(panel, panel.querySelector('.rz-wv-header'));

    panel.addEventListener('click', (e) => this._onClick(e));
    panel.addEventListener('change', (e) => this._onChange(e));
    panel.addEventListener('input', (e) => this._onInput(e));
  }

  // --- open / close -------------------------------------------------------

  open(section = null) {
    this.isOpen = true;
    if (section) this.section = section;
    this.panel.classList.add('rz-wv-open');
    this._render();
  }

  close() {
    this.isOpen = false;
    this.panel.classList.remove('rz-wv-open');
  }

  toggle(section = null) {
    if (this.isOpen && (!section || section === this.section)) this.close();
    else this.open(section);
  }

  destroy() {
    for (const off of this._unsubscribe || []) {
      try { off(); } catch { /* ignore */ }
    }
    try { this._cleanupDraggable?.(); } catch { /* ignore */ }
    try { this.panel?.remove(); } catch { /* ignore */ }
  }

  // --- events -------------------------------------------------------------

  _onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    const row = btn.closest('[data-node-id]');
    const nodeId = row?.dataset.nodeId;
    const param = row?.dataset.param;

    switch (act) {
      case 'close': this.close(); return;
      case 'section': this.section = btn.dataset.section; this._render(); return;
      case 'add': this._addControl(); return;
      case 'remove': if (nodeId) this.controlsModel.remove(nodeId, param); return;
      case 'up': if (nodeId) this.controlsModel.move(nodeId, param, -1); return;
      case 'down': if (nodeId) this.controlsModel.move(nodeId, param, 1); return;
      case 'reset-page': this.pageModel.reset(); this.onStatus('Page settings reset.'); return;
      case 'open-viewer': this.onOpenViewer?.(); return;
      case 'preview-link': this._makePreviewLink(); return;
      case 'publish-link': this._publishLink(); return;
      case 'share-existing': this._shareExisting(); return;
      case 'copy-link': this._copyLink(); return;
      case 'open-link': this._openLink(); return;
      default: return;
    }
  }

  _onChange(e) {
    const el = e.target;
    const role = el.dataset.role;

    if (role === 'node') {
      this.pendingNodeId = el.value;
      this._render();
      return;
    }
    if (role === 'param' || role === 'patch-url') return;

    // Page settings.
    if (role === 'page-title') return this._patchPage({ title: el.value });
    if (role === 'page-background') return this._patchPage({ background: el.value });
    if (role === 'page-fit') return this._patchPage({ fit: el.value });
    if (role === 'page-notes') return this._patchPage({ showNotes: el.checked });
    if (role === 'page-controls') return this._patchPage({ controls: el.value });

    // Control presentation.
    const row = el.closest('[data-node-id]');
    if (!row) return;
    const patch = {};
    if (role === 'label') patch.label = el.value;
    if (role === 'min') patch.min = el.value;
    if (role === 'max') patch.max = el.value;
    if (role === 'step') patch.step = el.value;
    if (!Object.keys(patch).length) return;

    this.controlsModel.update(row.dataset.nodeId, row.dataset.param, patch);
    // The model sanitizes; redraw so the fields show what was actually stored
    // rather than what was typed.
    this._render();
  }

  /**
   * A colour picker fires `input` continuously while it is open and `change`
   * only when it closes, so the ground colour follows the drag live — but
   * without the redraw that would close the picker. Only the two things that
   * depend on it are touched by hand.
   */
  _onInput(e) {
    if (e.target.dataset.role !== 'page-background') return;

    this._silent = true;
    this.pageModel.update({ background: e.target.value });
    this._silent = false;

    const page = this.pageModel.get();
    const swatch = this.bodyEl.querySelector('.rz-wv-mono');
    if (swatch) swatch.textContent = page.background;
    const reset = this.bodyEl.querySelector('[data-act="reset-page"]');
    if (reset) reset.disabled = this.pageModel.isDefault;
  }

  _patchPage(patch) {
    this.pageModel.update(patch);
  }

  _addControl() {
    const nodeId = this.panel.querySelector('[data-role="node"]')?.value;
    const param = this.panel.querySelector('[data-role="param"]')?.value;
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

    const result = this.controlsModel.add(node, param);
    if (!result.ok) {
      this.onStatus(result.reason, 'warning');
      return;
    }
    this.onStatus(`${result.control.label} is now a web viewer control.`);
  }

  // --- the link -----------------------------------------------------------

  async _makePreviewLink() {
    await this._withBusy(async () => {
      try {
        const { url } = await makePreviewLink();
        this._setLink({ kind: 'preview', url });
        this.onStatus('Preview link ready — it works in this browser only.');
      } catch (error) {
        this.onStatus(error.message, 'warning');
      }
    });
  }

  async _publishLink() {
    const go = await modalManager.confirm(
      'This uploads the patch, and a still frame of it, to the TenderWorld gallery ' +
        'so the link works for anyone you send it to.\n\nPublish now?',
      'Publish for a link',
      { confirmLabel: 'Publish', cancelLabel: 'Cancel' },
    );
    if (!go) return;

    const progress = modalManager.showProgress('Publishing', 'Capturing a frame…');
    await this._withBusy(async () => {
      try {
        const result = await publishForLink({
          onProgress: (percent, message, detail) => progress.update(percent, message, detail),
        });
        progress.close();
        this._setLink({ kind: 'share', url: result.shareUrl, patchUrl: result.patchUrl });
        this.onStatus('Published. The link works for anyone.');
      } catch (error) {
        progress.close();
        // An upload the browser never sent is the dev-server case: the gallery
        // does not answer this origin. The preview link below still works and
        // needs no network, so point at it rather than leaving a dead end.
        const message = error.code === 'upload_blocked'
          ? `${error.message} A preview link, below, still works from here.`
          : error.message;
        // The gallery's own refusals are worth a dialog rather than a toast:
        // the artist has just spent an upload on this.
        await modalManager.alert(message, 'Could not make a link');
        this._failLink(message);
      }
    });
  }

  /**
   * Build a share link from a patch URL the artist already has.
   *
   * A refusal is shown under the field as well as in the status bar, and clears
   * whatever link was on screen: leaving the previous one sitting there while a
   * toast slides past is how someone copies a preview link believing it is the
   * share link they just asked for.
   */
  _shareExisting() {
    const field = this.panel.querySelector('[data-role="patch-url"]');
    const value = field?.value?.trim();
    this.pendingPatchUrl = value || '';

    if (!value) {
      this._failLink('Paste the address of a patch published to the gallery.');
      return;
    }
    try {
      const url = makeShareLink(value, { title: this.pageModel.get().title || this.getProjectName() });
      this.linkError = '';
      this._setLink({ kind: 'share', url, patchUrl: value });
      this.onStatus('Link ready.');
    } catch (error) {
      this._failLink(error.message);
    }
  }

  /** Drop the link on screen and say why, where the artist is looking. */
  _failLink(message) {
    this.linkError = message;
    this.link = null;
    this.onStatus(message, 'warning');
    this._render();
  }

  _setLink(link) {
    this.linkError = '';
    this.link = link;
    this.section = 'link';
    this._render();
  }

  async _copyLink() {
    if (!this.link) return;
    const copied = await copyToClipboard(this.link.url);
    if (copied) {
      this.onStatus('Link copied.');
      return;
    }
    // No clipboard permission. Select it instead, so the artist can copy it by
    // hand rather than being told nothing at all.
    const field = this.panel.querySelector('[data-role="link"]');
    field?.select?.();
    this.onStatus('Could not reach the clipboard — the link is selected, copy it.', 'warning');
  }

  _openLink() {
    if (!this.link) return;
    openExternal(this.link.url, { label: 'web-viewer-link', title: 'Rhizomium viewer' })
      .then((page) => {
        if (!page) this.onStatus('The link could not be opened here.', 'warning');
      })
      .catch(() => this.onStatus('The link could not be opened here.', 'warning'));
  }

  /** Run one action at a time; the buttons say so while it is running. */
  async _withBusy(fn) {
    if (this.busy) return;
    this.busy = true;
    this._render();
    try {
      await fn();
    } finally {
      this.busy = false;
      this._render();
    }
  }

  // --- rendering ----------------------------------------------------------

  _render() {
    for (const tab of this.panel.querySelectorAll('.rz-wv-tab')) {
      const active = tab.dataset.section === this.section;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    }

    const badge = this.controlsModel.count;
    const controlsTab = this.panel.querySelector('[data-section="controls"]');
    if (controlsTab) controlsTab.textContent = badge ? `Controls (${badge})` : 'Controls';

    if (this.section === 'page') this._renderPage();
    else if (this.section === 'controls') this._renderControls();
    else this._renderLink();
  }

  _renderPage() {
    const page = this.pageModel.get();
    const projectName = this.getProjectName();

    this.bodyEl.innerHTML = `
      <p class="rz-wv-intro">
        How the viewer page looks around the render. These travel in the patch,
        so a visitor opening your link sees the page you set up here.
      </p>

      <label class="rz-wv-field">
        <span>Title</span>
        <input type="text" data-role="page-title" value="${escapeHtml(page.title)}" maxlength="80"
               placeholder="${escapeHtml(projectName || 'Rhizomium viewer')}"
               title="What the browser tab says. Empty uses the project name." />
      </label>

      <label class="rz-wv-field">
        <span>Ground</span>
        <input type="color" data-role="page-background" value="${escapeHtml(page.background)}"
               title="The colour behind the render, seen wherever the composition does not reach" />
        <code class="rz-wv-mono">${escapeHtml(page.background)}</code>
      </label>

      <label class="rz-wv-field">
        <span>Framing</span>
        <select data-role="page-fit">
          ${FIT_CHOICES.map(([value, label, hint]) =>
            `<option value="${value}"${page.fit === value ? ' selected' : ''} title="${escapeHtml(hint)}">${label}</option>`,
          ).join('')}
        </select>
        <span class="rz-wv-hint">${escapeHtml(hintFor(FIT_CHOICES, page.fit))}</span>
      </label>

      <label class="rz-wv-field">
        <span>Controls</span>
        <select data-role="page-controls">
          ${CONTROLS_CHOICES.map(([value, label, hint]) =>
            `<option value="${value}"${page.controls === value ? ' selected' : ''} title="${escapeHtml(hint)}">${label}</option>`,
          ).join('')}
        </select>
        <span class="rz-wv-hint">${escapeHtml(hintFor(CONTROLS_CHOICES, page.controls))}</span>
      </label>

      <label class="rz-wv-check">
        <input type="checkbox" data-role="page-notes"${page.showNotes ? ' checked' : ''} />
        <span>Show the note about what the viewer cannot play</span>
      </label>
      <p class="rz-wv-note">
        A patch that reacts to audio, MIDI or the 3D viewport looks static in the
        viewer. The note says why. Turn it off for a piece that needs none of them.
      </p>

      <div class="rz-wv-foot">
        <span>${this.pageModel.isDefault ? 'Default page' : 'Customised'}</span>
        <span class="rz-wv-spacer"></span>
        <button class="rz-wv-btn" data-act="reset-page"${this.pageModel.isDefault ? ' disabled' : ''}>Reset</button>
      </div>
    `;
  }

  _renderControls() {
    const nodes = this.getNodes();
    const candidates = nodes
      .map((node) => ({ node, params: this._availableParams(node) }))
      .filter((entry) => entry.params.length > 0);

    if (!candidates.some((c) => String(c.node.id) === this.pendingNodeId)) {
      this.pendingNodeId = candidates.length ? String(candidates[0].node.id) : '';
    }
    const current = candidates.find((c) => String(c.node.id) === this.pendingNodeId);
    const empty = candidates.length === 0;

    const controls = this.controlsModel.list();
    const byId = new Map(nodes.map((n) => [String(n?.id), n]));

    this.bodyEl.innerHTML = `
      <p class="rz-wv-intro">
        Parameters listed here appear as controls beside the patch in the viewer,
        so whoever opens the link can move them. Nothing is offered unless you put
        it here, and a parameter driven by a formula stays the formula's.
      </p>

      <div class="rz-wv-add">
        <select class="rz-wv-select" data-role="node" aria-label="Node"${empty ? ' disabled' : ''}>
          ${empty
            ? '<option value="">Nothing to offer yet</option>'
            : candidates.map(({ node }) => {
                const id = escapeHtml(String(node.id));
                const selected = String(node.id) === this.pendingNodeId ? ' selected' : '';
                return `<option value="${id}"${selected}>${escapeHtml(nodeDisplayName(node))} #${id}</option>`;
              }).join('')}
        </select>
        <select class="rz-wv-select" data-role="param" aria-label="Parameter"${empty ? ' disabled' : ''}>
          ${current
            ? current.params.map((p) =>
                `<option value="${escapeHtml(p.name)}">${escapeHtml(p.label)}</option>`).join('')
            : '<option value="">—</option>'}
        </select>
        <button class="rz-wv-btn rz-wv-primary" data-act="add"${empty || this.controlsModel.isFull ? ' disabled' : ''}>+ Offer</button>
      </div>

      <div class="rz-wv-list">
        ${controls.length
          ? controls.map((control, i) =>
              this._controlRow(control, byId.get(control.nodeId), i, controls.length)).join('')
          : `<p class="rz-wv-empty">No controls yet. This patch plays in the viewer exactly as it does here.</p>`}
      </div>

      <div class="rz-wv-foot">
        <span>${controls.length ? `${controls.length} of ${MAX_VIEWER_CONTROLS} controls` : 'No controls offered'}</span>
      </div>
    `;
  }

  /**
   * What this node could still offer: an exposable parameter that is not
   * already a control and is not currently held by a formula.
   */
  _availableParams(node) {
    return exposableParameters(node).filter(
      (p) => !this.controlsModel.has(node.id, p.name) && !holdsExpression(node, p.name),
    );
  }

  _controlRow(control, node, index, total) {
    const id = escapeHtml(control.nodeId);
    const param = escapeHtml(control.param);
    const def = node ? parameterDef(node, control.param) : null;

    // A control whose node has gone says so instead of pretending: it will not
    // be written to the file, and the artist may want to undo the delete rather
    // than lose the control.
    const source = node
      ? `${escapeHtml(nodeDisplayName(node))} #${id} · ${escapeHtml(def ? parameterLabel(def) : control.param)}`
      : `Node #${id} is no longer in the graph`;

    const range = control.kind === 'slider'
      ? `
        <div class="rz-wv-row-range">
          <label>Min<input type="number" data-role="min" value="${control.min}" step="any" /></label>
          <label>Max<input type="number" data-role="max" value="${control.max}" step="any" /></label>
          <label>Step<input type="number" data-role="step" value="${control.step}" min="0" step="any" /></label>
        </div>`
      : `<div class="rz-wv-row-range rz-wv-row-note">${
          control.kind === 'toggle' ? 'A switch: on or off.' : 'A menu of this parameter’s modes.'
        }</div>`;

    return `
      <div class="rz-wv-row${node ? '' : ' rz-wv-missing'}" data-node-id="${id}" data-param="${param}">
        <div class="rz-wv-row-top">
          <span class="rz-wv-kind" title="How this appears in the viewer">${control.kind}</span>
          <input class="rz-wv-label" data-role="label" value="${escapeHtml(control.label)}" maxlength="40"
                 title="What the viewer calls this control" />
          <button class="rz-wv-move" data-act="up" ${index === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button class="rz-wv-move" data-act="down" ${index === total - 1 ? 'disabled' : ''} title="Move down">↓</button>
          <button class="rz-wv-remove" data-act="remove" title="Stop offering this parameter">&times;</button>
        </div>
        <div class="rz-wv-row-source">${source}</div>
        ${range}
      </div>`;
  }

  _renderLink() {
    const busy = this.busy;
    const canOpenViewer = !!this.onOpenViewer && this.canOpenViewer();

    const linkBlock = this.link
      ? `
        <div class="rz-wv-link ${this.link.kind === 'share' ? 'is-share' : 'is-preview'}">
          <div class="rz-wv-link-kind">
            ${this.link.kind === 'share'
              ? 'Anyone with this link'
              : 'This browser only, for 24 hours'}
          </div>
          <input class="rz-wv-link-field" data-role="link" readonly value="${escapeHtml(this.link.url)}" />
          <div class="rz-wv-link-actions">
            <button class="rz-wv-btn rz-wv-primary" data-act="copy-link">Copy</button>
            <button class="rz-wv-btn" data-act="open-link">Open</button>
          </div>
        </div>`
      : '<p class="rz-wv-empty">No link yet. Make one below.</p>';

    this.bodyEl.innerHTML = `
      ${linkBlock}

      <div class="rz-wv-group">
        <h4>Share it</h4>
        <p class="rz-wv-note">
          Publishes the patch, and a still of it, to the TenderWorld gallery, then
          builds a viewer link pointing at the published patch. That link works for
          whoever you send it to.
        </p>
        <button class="rz-wv-btn rz-wv-primary" data-act="publish-link"${busy ? ' disabled' : ''}>
          ${busy ? 'Working…' : 'Publish &amp; make a link'}
        </button>

        <p class="rz-wv-note">Already published? Paste the patch’s address:</p>
        <div class="rz-wv-add">
          <input class="rz-wv-select${this.linkError ? ' is-bad' : ''}" type="url" data-role="patch-url"
                 placeholder="https://…/patch.rz" value="${escapeHtml(this.pendingPatchUrl || '')}"
                 aria-label="Published patch address" />
          <button class="rz-wv-btn" data-act="share-existing">Make link</button>
        </div>
        ${this.linkError ? `<p class="rz-wv-error">${escapeHtml(this.linkError)}</p>` : ''}
      </div>

      <div class="rz-wv-group">
        <h4>Check it first</h4>
        <p class="rz-wv-note">
          A preview link runs the patch straight from this browser — nothing is
          uploaded and nothing is published. It is how the page looks; it is not
          something to send, because no other machine has the patch.
        </p>
        <div class="rz-wv-link-actions">
          <button class="rz-wv-btn" data-act="preview-link"${busy ? ' disabled' : ''}>
            ${busy ? 'Working…' : 'Make a preview link'}
          </button>
          ${canOpenViewer
            ? '<button class="rz-wv-btn" data-act="open-viewer">Open in Web Viewer</button>'
            : ''}
        </div>
      </div>
    `;
  }
}

function hintFor(choices, value) {
  return choices.find(([id]) => id === value)?.[2] || '';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let _tool = null;

/**
 * The one web viewer tool, created on first use.
 * @returns {WebViewerTool}
 */
export function getWebViewerTool(models, opts) {
  if (!_tool) _tool = new WebViewerTool(models, opts);
  return _tool;
}
