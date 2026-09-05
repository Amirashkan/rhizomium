// src/ui/ScreensPanel.js
//
// The screens panel: where a studio lays out which displays a patch is thrown
// onto, and what each of them shows.
//
// The panel edits a {@link ScreenModel} and nothing else. It holds no window
// handles and no render state — the model notifies, the output bridge opens and
// closes windows to match, and the project file carries the same data. That is
// what lets a rig set up here be reopened, unchanged, on the next show night.
//
// Its centre is the LAYOUT MAP: the composition drawn as one rectangle with each
// screen's region drawn on top of it. A rig is a physical arrangement, and a
// column of numbers is a poor way to see whether three projectors actually cover
// a wall — overlaps, gaps and a screen accidentally left mirroring the whole
// composition are all obvious in the picture and nearly invisible in the fields.
//
// Display enumeration is Tauri-only and loaded on demand, so importing this
// module stays safe on the web builds, where there is no rig to lay out.

import { makeDraggable } from './utils/draggable.js';
import { makeResizable } from './utils/resizable.js';
import {
  MAX_SCREENS,
  DISPLAY_AUTO,
  MAIN_SCREEN_ID,
} from '../screens/ScreenModel.js';
import { isTauri } from '../utils/isTauri.js';

/** Presentation-resolution choices, matching the single-output menu's. */
const RESOLUTION_PRESETS = [
  [0, 'Display native'],
  [1280, '720p'],
  [1920, '1080p'],
  [2560, '1440p'],
  [3840, '4K'],
];

/**
 * One-click rigs. These are the arrangements a studio actually builds, and
 * having them a button away is the difference between multi-screen being a
 * feature and being a chore.
 */
const LAYOUTS = [
  { id: 'single', label: 'Single', cols: 1, rows: 1, title: 'One screen showing the whole composition' },
  // Not a tiling: this keeps the rig and only clears the framing, so the same
  // image goes to every projector without closing and reopening any of them.
  { id: 'mirror', label: 'Mirror', mirror: true, title: 'Every screen shows the whole composition' },
  { id: 'span2', label: '2 across', cols: 2, rows: 1, title: 'Two screens, left and right halves' },
  { id: 'span3', label: '3 across', cols: 3, rows: 1, title: 'Three screens across — a projector panorama' },
  { id: 'stack2', label: '2 stacked', cols: 1, rows: 2, title: 'Two screens, top and bottom halves' },
  { id: 'grid4', label: '2 × 2', cols: 2, rows: 2, title: 'Four screens in a square video wall' },
];

export class ScreensPanel {
  /**
   * @param {import('../screens/ScreenModel.js').ScreenModel} model
   * @param {Object} [opts]
   * @param {(message: string, kind?: string) => void} [opts.onStatus]
   * @param {() => boolean} [opts.canUseMultiScreen] gate consulted before adding a
   *   second screen; returning false leaves the rig alone and reports why
   * @param {() => number} [opts.getCompositionAspect] the output format's w/h,
   *   used to draw the layout map in the composition's real shape
   */
  constructor(model, opts = {}) {
    this.model = model;
    this.onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : () => {};
    this.canUseMultiScreen = typeof opts.canUseMultiScreen === 'function'
      ? opts.canUseMultiScreen
      : () => true;
    this.getCompositionAspect = typeof opts.getCompositionAspect === 'function'
      ? opts.getCompositionAspect
      : () => 16 / 9;

    this.isOpen = false;
    /** Displays the machine reports, filled in on first open. */
    this.displays = [];
    /** Overlap the layout buttons apply, as a fraction of a tile. */
    this.overlap = 0;

    this._createPanel();
    this._unsubscribe = this.model.onChange(() => this._render());
  }

  // --- construction -------------------------------------------------------

  _createPanel() {
    const panel = document.createElement('div');
    panel.id = 'screens-panel';
    panel.innerHTML = `
      <div class="rz-scr-header">
        <h3 class="rz-scr-title">Output Screens</h3>
        <button class="rz-scr-close" data-act="close" aria-label="Close">&times;</button>
      </div>

      <div class="rz-scr-toolbar">
        <span class="rz-scr-label">Layout</span>
        ${LAYOUTS.map((l) => `<button class="rz-scr-btn" data-act="layout" data-layout="${l.id}" title="${l.title}">${l.label}</button>`).join('')}
        <span class="rz-scr-spacer"></span>
        <label class="rz-scr-field" title="How much each screen overlaps its neighbour, for edge blending on a projector rig. Applied when a layout above is used.">
          <span>Edge blend</span>
          <input type="range" data-role="overlap" min="0" max="25" step="1" value="0" />
          <output data-role="overlap-out">0%</output>
        </label>
      </div>

      <div class="rz-scr-map" data-role="map" aria-hidden="true"></div>

      <div class="rz-scr-listhead">
        <span data-role="summary">No screens</span>
        <span class="rz-scr-spacer"></span>
        <button class="rz-scr-btn rz-scr-primary" data-act="add">+ Add screen</button>
      </div>

      <div class="rz-scr-list" data-role="list"></div>

      <div class="rz-scr-foot" data-role="foot"></div>
    `;
    document.body.appendChild(panel);
    this.panel = panel;
    this.mapEl = panel.querySelector('[data-role="map"]');
    this.listEl = panel.querySelector('[data-role="list"]');
    this.summaryEl = panel.querySelector('[data-role="summary"]');
    this.footEl = panel.querySelector('[data-role="foot"]');
    this.overlapEl = panel.querySelector('[data-role="overlap"]');
    this.overlapOutEl = panel.querySelector('[data-role="overlap-out"]');

    this._cleanupDraggable = makeDraggable(panel, panel.querySelector('.rz-scr-header'));
    // A rig of many screens is a long list under a small map; both want room.
    this._cleanupResizable = makeResizable(panel, { minWidth: 460, minHeight: 320 });

    panel.addEventListener('click', (e) => this._onClick(e));
    panel.addEventListener('change', (e) => this._onChange(e));
    panel.addEventListener('input', (e) => this._onInput(e));
  }

  // --- open / close -------------------------------------------------------

  open() {
    this.isOpen = true;
    this.panel.classList.add('rz-scr-open');
    // The rig is aimed at real displays, and they change between sessions — a
    // projector switched on after the editor started must be selectable without
    // restarting the app.
    this._refreshDisplays();
    this._render();
  }

  close() {
    this.isOpen = false;
    this.panel.classList.remove('rz-scr-open');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  destroy() {
    try { this._unsubscribe?.(); } catch { /* ignore */ }
    try { this._cleanupDraggable?.(); } catch { /* ignore */ }
    try { this._cleanupResizable?.(); } catch { /* ignore */ }
    try { this.panel?.remove(); } catch { /* ignore */ }
  }

  /** Ask the OS what displays exist, then redraw the pickers. */
  async _refreshDisplays() {
    if (!isTauri()) { this.displays = []; return; }
    try {
      const windowApi = await import('@tauri-apps/api/window');
      const monitors = await windowApi.availableMonitors();
      this.displays = Array.isArray(monitors) ? monitors : [];
    } catch {
      this.displays = [];
    }
    if (this.isOpen) this._render();
  }

  /** A display's label: its name and native size, so a rig is picked by sight. */
  _displayLabel(monitor, index) {
    const name = monitor?.name || `Display ${index + 1}`;
    const w = monitor?.size?.width;
    const h = monitor?.size?.height;
    return (w && h) ? `${name} — ${w}×${h}` : name;
  }

  // --- events -------------------------------------------------------------

  _onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.closest('[data-screen]')?.dataset.screen;

    if (act === 'close') { this.close(); return; }
    if (act === 'add') { this._addScreen(); return; }
    if (act === 'remove' && id) {
      this.model.remove(id);
      return;
    }
    if (act === 'toggle' && id) {
      const screen = this.model.get(id);
      if (!screen) return;
      // Switching a screen ON is what opens a window, so it goes through the
      // same gate adding one does.
      if (!screen.enabled && this.model.enabledScreens().length >= 1 && !this._allowMulti()) return;
      this.model.update(id, { enabled: !screen.enabled });
      return;
    }
    if (act === 'layout') {
      const layout = LAYOUTS.find((l) => l.id === btn.dataset.layout);
      if (!layout) return;
      if (layout.mirror) {
        this.model.mirrorAll();
        this.onStatus(this.model.count > 1
          ? `All ${this.model.count} screens showing the whole composition`
          : 'Output showing the whole composition');
        return;
      }
      const tiles = layout.cols * layout.rows;
      if (tiles > 1 && !this._allowMulti()) return;
      this.model.applyTiling({ cols: layout.cols, rows: layout.rows, overlap: this.overlap });
      this.onStatus(tiles > 1
        ? `Output laid out on ${tiles} screens`
        : 'Output set to a single screen');
    }
  }

  _onChange(e) {
    const el = e.target;
    const id = el.closest?.('[data-screen]')?.dataset.screen;
    if (!id) return;
    const role = el.dataset.role;
    if (role === 'name') this.model.update(id, { name: el.value });
    else if (role === 'display') this.model.update(id, { displayIndex: parseInt(el.value, 10) });
    else if (role === 'res') this.model.update(id, { displayMaxDim: parseInt(el.value, 10) });
    else if (role && role.startsWith('region-')) this._updateRegion(id, role.slice(7), el.value);
  }

  _onInput(e) {
    if (e.target.dataset.role !== 'overlap') return;
    this.overlap = Math.min(0.5, Math.max(0, (parseInt(e.target.value, 10) || 0) / 100));
    if (this.overlapOutEl) this.overlapOutEl.textContent = `${Math.round(this.overlap * 100)}%`;
  }

  /** Patch one edge of a screen's region from a percentage field. */
  _updateRegion(id, key, value) {
    const screen = this.model.get(id);
    if (!screen) return;
    const n = parseFloat(value);
    if (!Number.isFinite(n)) { this._render(); return; }
    this.model.update(id, { region: { ...screen.region, [key]: n / 100 } });
  }

  _addScreen() {
    if (this.model.count >= MAX_SCREENS) {
      this.onStatus(`A rig is limited to ${MAX_SCREENS} screens`, 'warning');
      return;
    }
    if (this.model.count >= 1 && !this._allowMulti()) return;
    if (this.model.count === 0) this.model.ensureMain();
    else this.model.add({});
  }

  /** Consult the entitlement gate, reporting the refusal once. */
  _allowMulti() {
    if (this.canUseMultiScreen()) return true;
    this._render(); // the footer explains what is gated
    return false;
  }

  // --- rendering ----------------------------------------------------------

  _render() {
    if (!this.panel) return;
    const screens = this.model.list();
    this._renderMap(screens);
    this._renderList(screens);

    const open = this.model.enabledScreens().length;
    this.summaryEl.textContent = screens.length === 0
      ? 'No screens'
      : `${screens.length} screen${screens.length === 1 ? '' : 's'}, ${open} on`;

    const gated = !this.canUseMultiScreen();
    this.footEl.innerHTML = gated
      ? 'Multi-screen output is part of Cloude Plus. A single output screen keeps working without it.'
      : 'Every screen renders the same composition and shows its own region. Overlapping regions plus a soft edge in the mapping panel give a blended projector rig.';
    this.footEl.classList.toggle('rz-scr-gated', gated);
  }

  /**
   * Draw the rig: the composition, with each screen's region over it.
   *
   * Drawn in the composition's own aspect so a wide panorama looks wide, and
   * regions are positioned as plain percentages inside it — which is exactly
   * what a region is, so nothing can drift between the picture and the numbers.
   */
  _renderMap(screens) {
    const aspect = this.getCompositionAspect() || 16 / 9;
    this.mapEl.style.aspectRatio = `${aspect}`;
    this.mapEl.innerHTML = screens.map((s, i) => {
      const r = s.region;
      const off = s.enabled ? '' : ' rz-scr-region-off';
      return `<div class="rz-scr-region${off}" data-index="${i % 6}" style="
        left:${(r.x * 100).toFixed(3)}%; top:${(r.y * 100).toFixed(3)}%;
        width:${(r.w * 100).toFixed(3)}%; height:${(r.h * 100).toFixed(3)}%;
      "><i class="rz-scr-region-fill"></i><span>${escapeHtml(s.name)}</span></div>`;
    }).join('');
  }

  _renderList(screens) {
    if (!screens.length) {
      this.listEl.innerHTML = `<div class="rz-scr-empty">
        No output screens yet. <strong>Mirror</strong> sets up one showing the whole
        composition; the other layouts split it across a rig.
      </div>`;
      return;
    }

    const displayOptions = (selected) => {
      const opts = [`<option value="${DISPLAY_AUTO}"${selected < 0 ? ' selected' : ''}>Auto (next free display)</option>`];
      this.displays.forEach((m, i) => {
        opts.push(`<option value="${i}"${selected === i ? ' selected' : ''}>${escapeHtml(this._displayLabel(m, i))}</option>`);
      });
      // A display assignment saved against a rig that is not plugged in right now
      // must survive being looked at, so it is kept as an option of its own.
      if (selected >= 0 && selected >= this.displays.length) {
        opts.push(`<option value="${selected}" selected>Display ${selected + 1} (not connected)</option>`);
      }
      return opts.join('');
    };

    const pct = (v) => (v * 100).toFixed(1).replace(/\.0$/, '');

    // Rendered from a template, then the two <select>s are set from the model
    // explicitly. A `selected` attribute in parsed markup is honoured
    // inconsistently, and a picker that silently shows the wrong display is how
    // an output lands on the wrong projector.
    this.listEl.innerHTML = screens.map((s) => `
      <div class="rz-scr-row${s.enabled ? '' : ' rz-scr-row-off'}" data-screen="${escapeHtml(s.id)}">
        <div class="rz-scr-row-top">
          <button class="rz-scr-dot" data-act="toggle"
                  aria-pressed="${s.enabled}"
                  title="${s.enabled ? 'Switch this screen off (closes its window)' : 'Switch this screen on'}">${s.enabled ? '●' : '○'}</button>
          <input class="rz-scr-name" data-role="name" value="${escapeHtml(s.name)}" maxlength="64" />
          <select class="rz-scr-select" data-role="display" title="Which display this screen opens on">
            ${displayOptions(s.displayIndex)}
          </select>
          <select class="rz-scr-select" data-role="res" title="How many pixels this screen presents with. The render is always the output format.">
            ${RESOLUTION_PRESETS.map(([v, label]) =>
              `<option value="${v}"${(s.displayMaxDim || 0) === v ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
          <button class="rz-scr-remove" data-act="remove"
                  title="${s.id === MAIN_SCREEN_ID ? 'Remove this screen' : 'Remove this screen'}">&times;</button>
        </div>
        <div class="rz-scr-row-region" title="The part of the composition this screen shows, in percent">
          <span class="rz-scr-label">Region</span>
          <label>X<input type="number" data-role="region-x" value="${pct(s.region.x)}" min="0" max="100" step="0.5" /></label>
          <label>Y<input type="number" data-role="region-y" value="${pct(s.region.y)}" min="0" max="100" step="0.5" /></label>
          <label>W<input type="number" data-role="region-w" value="${pct(s.region.w)}" min="1" max="100" step="0.5" /></label>
          <label>H<input type="number" data-role="region-h" value="${pct(s.region.h)}" min="1" max="100" step="0.5" /></label>
        </div>
      </div>
    `).join('');

    for (const s of screens) {
      const row = this.listEl.querySelector(`[data-screen="${cssEscape(s.id)}"]`);
      if (!row) continue;
      row.querySelector('[data-role="display"]').value = String(s.displayIndex);
      row.querySelector('[data-role="res"]').value = String(s.displayMaxDim || 0);
    }
  }
}

/** Quote a screen id for use inside an attribute selector. */
function cssEscape(value) {
  const str = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(str);
  return str.replace(/["\\]/g, '\\$&');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let _panel = null;

/**
 * The one screens panel, created on first use.
 * @param {import('../screens/ScreenModel.js').ScreenModel} model
 * @param {Object} [opts] see {@link ScreensPanel}
 * @returns {ScreensPanel}
 */
export function getScreensPanel(model, opts) {
  if (!_panel) _panel = new ScreensPanel(model, opts);
  return _panel;
}
