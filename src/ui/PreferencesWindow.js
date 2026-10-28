/**
 * PreferencesWindow.js - Editor preferences.
 *
 * Only preferences that are actually applied live here. Render settings
 * (resolution, frame rate, export) are not duplicated in this window - they
 * belong to View -> Preview / Export Settings, which is the single owner of
 * the render resolution.
 *
 * The Accessibility section is a view onto the accessibility settings store
 * (src/accessibility/a11ySettings.js) rather than onto this window's own
 * record: those settings are read by the renderer, the preview, the patch
 * outline and the motion check, each of which subscribes to the store, so the
 * controls here write to it and the rest follows.
 *
 * The window is itself operable from the keyboard: it is a labelled dialog,
 * every control has a real <label>, Escape closes it, and closing hands focus
 * back to wherever it was opened from.
 */

import { makeDraggable } from './utils/draggable.js';
import { makeResizable } from './utils/resizable.js';
import { getA11ySettings, UI_SCALE_STEPS } from '../accessibility/a11ySettings.js';
import { COLOR_VISION_LABELS } from '../accessibility/colorVision.js';

const DEFAULT_PREFERENCES = {
  showGrid: true,
  snapToGrid: true,
  gridSize: 20,
  autoSave: true,
};

const STORAGE_KEY = "rhizo.preferences";

let controlIds = 0;
const nextId = (stem) => `rz-pref-${stem}-${++controlIds}`;

export class PreferencesWindow {
  /**
   * @param {object} [options]
   * @param {object} [options.a11y]          accessibility settings store
   * @param {() => void} [options.onCheckMotion]   Tools → Check Flashing & Motion
   * @param {() => void} [options.onShowKeyboardHelp]  the keymap, at the patch-canvas keys
   */
  constructor({ a11y = getA11ySettings(), onCheckMotion = null, onShowKeyboardHelp = null } = {}) {
    this.window = null;
    this.cleanupDraggable = null;
    this.preferences = { ...DEFAULT_PREFERENCES, ...this._readStored() };
    this._controls = {};
    this._a11yControls = {};
    this.a11y = a11y;
    this.onCheckMotion = onCheckMotion;
    this.onShowKeyboardHelp = onShowKeyboardHelp;
    this._returnFocus = null;
    this._unsubscribeA11y = this.a11y?.subscribe?.(() => this._refreshA11yControls()) || null;
  }

  _readStored() {
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _persist() {
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
    } catch {
      // Storage unavailable - preferences still apply for this session.
    }
  }

  /** Apply every stored preference. Called once the editor exists. */
  applyAll() {
    Object.entries(this.preferences).forEach(([key, value]) => {
      this._applyPreference(key, value);
    });
  }

  /**
   * Open the window. `{ section: "accessibility" }` scrolls to that section and
   * puts focus on its first control — what Edit → Accessibility… asks for.
   */
  show({ section = null } = {}) {
    const active = document.activeElement;
    if (!this.window || this.window.style.display === "none") {
      this._returnFocus = active && active !== document.body && !this.window?.contains(active) ? active : null;
    }

    if (this.window) {
      this.window.style.display = "flex";
      this.window.style.opacity = "1";

      if (!this.window.style.left || this.window.style.left === 'auto' || this.window.style.left === '50%') {
        const left = (window.innerWidth - this.window.offsetWidth) / 2;
        const top = (window.innerHeight - this.window.offsetHeight) / 2;
        this.window.style.left = left + 'px';
        this.window.style.top = top + 'px';
      }
      this.window.style.transform = "scale(1)";
      // Hiding tears the drag and resize handlers down; reopening has to put
      // them back, or a reopened window is a frozen one.
      this._attachWindowHandlers();
      this._refreshControls();
      this._refreshA11yControls();
      this._focusSection(section);
      return;
    }

    this.window = document.createElement("div");
    this.window.id = "preferences-window";
    this.window.setAttribute("role", "dialog");
    this.window.setAttribute("aria-modal", "false");
    this.window.style.cssText = `
      position: fixed;
      left: 50%;
      top: 50%;
      width: 440px;
      max-width: 90vw;
      max-height: 85vh;
      background: var(--rz-surface-raised);
      backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid var(--rz-line-strong);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      z-index: 1001;
      display: flex;
      flex-direction: column;
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.95);
      transition: all 0.2s ease;
      overflow: hidden;
      font-family: var(--rz-font-ui);
      color: var(--rz-text);
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      padding: 12px 16px;
      background: var(--rz-fill-soft);
      border-bottom: 1px solid var(--rz-line);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      flex-shrink: 0;
    `;

    const title = document.createElement("h2");
    title.id = nextId("title");
    title.textContent = "Preferences";
    title.style.cssText = "margin: 0; color: var(--rz-text); font-size: 14px; font-weight: 600;";
    this.window.setAttribute("aria-labelledby", title.id);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Close preferences");
    closeBtn.title = "Close (Esc)";
    closeBtn.style.cssText = `
      background: transparent;
      border: none;
      color: var(--rz-text);
      cursor: pointer;
      font-size: 18px;
      padding: 4px;
      border-radius: 4px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    closeBtn.onclick = () => this.hide();

    header.appendChild(title);
    header.appendChild(closeBtn);
    this.header = header;

    const content = document.createElement("div");
    content.style.cssText = `
      padding: 16px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    `;
    content.className = "custom-scroll rz-pref-content";

    content.appendChild(this._createAccessibilitySection());
    content.appendChild(this._createCanvasSection());
    content.appendChild(this._createSavingSection());
    content.appendChild(this._createRenderPointer());
    content.appendChild(
      this._createButton("Reset Preferences to Defaults", () => this._resetAll(), true),
    );
    content.appendChild(
      this._createHint(
        "Resets the canvas and saving preferences. Accessibility settings keep their own reset, at the end of their section, so that this button can never take away a larger interface or a higher contrast someone depends on.",
      ),
    );

    this.window.appendChild(header);
    this.window.appendChild(content);
    // Escape closes the window from any control in it, as the close button's title promises.
    this.window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.hide();
      }
    });
    document.body.appendChild(this.window);

    requestAnimationFrame(() => {
      this.window.style.opacity = "1";
      this.window.style.transform = "translate(-50%, -50%) scale(1)";

      // Convert transform-based centering to left/top so dragging works.
      const rect = this.window.getBoundingClientRect();
      this.window.style.left = rect.left + 'px';
      this.window.style.top = rect.top + 'px';
      this.window.style.transform = 'scale(1)';

      this._attachWindowHandlers();
    });
    this._focusSection(section);
  }

  /** Scroll a section into view and focus its first control (or the first control at all). */
  _focusSection(section) {
    const target =
      (section && this.window?.querySelector(`[data-pref-section="${section}"]`)) || this.window;
    target?.scrollIntoView?.({ block: "start" });
    const first = target?.querySelector?.("select, input, button:not([aria-label='Close preferences'])");
    first?.focus?.();
  }

  /** Drag by the header, size from any edge. Idempotent — see show(). */
  _attachWindowHandlers() {
    if (!this.window || !this.header) return;

    if (!this.cleanupDraggable) {
      this.cleanupDraggable = makeDraggable(this.window, this.header);
    }
    if (!this.cleanupResizable) {
      this.cleanupResizable = makeResizable(this.window, {
        minWidth: 320,
        minHeight: 220,
      });
    }
  }

  hide() {
    if (!this.window) return;

    if (this.cleanupDraggable) {
      this.cleanupDraggable();
      this.cleanupDraggable = null;
    }

    if (this.cleanupResizable) {
      this.cleanupResizable();
      this.cleanupResizable = null;
    }

    const hadFocus = this.window.contains(document.activeElement);
    this.window.style.opacity = "0";
    this.window.style.transform = "scale(0.95)";
    if (hadFocus) {
      const back = this._returnFocus;
      this._returnFocus = null;
      if (back?.isConnected) back.focus?.();
      else document.activeElement?.blur?.();
    }

    setTimeout(() => {
      if (this.window) {
        this.window.style.display = "none";
      }
    }, 200);
  }

  _createSection(title, key = null) {
    const section = document.createElement("section");
    section.style.cssText = "margin-bottom: 20px;";
    if (key) section.dataset.prefSection = key;

    const sectionTitle = document.createElement("h3");
    sectionTitle.id = nextId("section");
    sectionTitle.textContent = title;
    sectionTitle.style.cssText = `
      color: var(--rz-text);
      font-size: 13px;
      font-weight: 600;
      margin: 0 0 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.setAttribute("aria-labelledby", sectionTitle.id);
    section.appendChild(sectionTitle);

    return section;
  }

  // ---- Accessibility ---------------------------------------------------------

  _createAccessibilitySection() {
    const section = this._createSection("Accessibility", "accessibility");
    const store = this.a11y;
    const add = (control) => section.appendChild(control.container);

    const contrast = this._createSelect(
      "Contrast",
      [
        ["system", "Follow system setting"],
        ["standard", "Standard"],
        ["high", "High"],
        ["maximum", "Maximum (black and white)"],
      ],
      store.get("contrast"),
      (value) => store.set("contrast", value),
    );
    add(contrast);
    section.appendChild(
      this._createHint("Stronger text, lines and borders, in the menus, panels and the node graph itself."),
    );

    const scale = this._createSelect(
      "Interface size",
      UI_SCALE_STEPS.map((step) => [String(step), `${Math.round(step * 100)}%`]),
      String(store.get("uiScale")),
      (value) => store.set("uiScale", Number(value)),
    );
    add(scale);
    section.appendChild(
      this._createHint(
        "Enlarges the menus, status bar, dialogs and panel contents. The patch canvas has its own zoom: Ctrl+= and Ctrl+-.",
      ),
    );

    const focusRing = this._createSelect(
      "Focus indicator",
      [
        ["standard", "Standard"],
        ["bold", "Bold"],
      ],
      store.get("focusRing"),
      (value) => store.set("focusRing", value),
    );
    add(focusRing);

    const motion = this._createSelect(
      "Interface animation",
      [
        ["system", "Follow system setting"],
        ["reduce", "Reduced"],
        ["full", "Full"],
      ],
      store.get("reduceMotion"),
      (value) => store.set("reduceMotion", value),
    );
    add(motion);

    const warnings = this._createCheckbox(
      "Warn before playing fast motion or flashing",
      null,
      store.motionWarningsEnabled(),
      (checked) => store.set("motionWarnings", checked),
    );
    section.appendChild(warnings.container);
    section.appendChild(
      this._createHint(
        "A patch you open is held on its first frame and checked first: flashing faster than three times a second, or very fast motion, is shown in a warning before anything plays. On by default when your system asks for reduced motion.",
      ),
    );
    section.appendChild(
      this._createButton("Check This Patch Now", () => {
        (this.onCheckMotion || window.motionGate?.checkNow?.bind(window.motionGate))?.();
      }),
    );

    const vision = this._createSelect(
      "Colour vision preview",
      Object.entries(COLOR_VISION_LABELS),
      store.get("colorVision"),
      (value) => store.set("colorVision", value),
    );
    add(vision);
    const visionMode = this._createSelect(
      "Colour vision mode",
      [
        ["simulate", "Simulate — see it the way that viewer would"],
        ["correct", "Correct — shift colours apart for my eyes"],
      ],
      store.get("colorVisionMode"),
      (value) => store.set("colorVisionMode", value),
    );
    add(visionMode);
    section.appendChild(
      this._createHint(
        "Filters the preview window, the node thumbnails and the 3D view only. Exports, published work and output screens always keep their real colours. Achromatopsia has no correction: there is no colour left to shift into.",
      ),
    );

    const announcements = this._createSelect(
      "Screen reader announcements",
      [
        ["off", "Off"],
        ["normal", "Normal — results of actions"],
        ["verbose", "Verbose — also positions and progress"],
      ],
      store.get("announcements"),
      (value) => store.set("announcements", value),
    );
    add(announcements);

    const order = this._createSelect(
      "Patch outline order",
      [
        ["flow", "Signal flow — sources first, output last"],
        ["position", "Canvas position — left to right"],
      ],
      store.get("outlineOrder"),
      (value) => store.set("outlineOrder", value),
    );
    add(order);
    section.appendChild(
      this._createHint(
        "Keyboard: Tab into the patch canvas (or press Ctrl+Alt+N) and the arrow keys walk the nodes in this order; Right opens a node's ports, Enter its parameters, C connects. F10 reaches the menu bar.",
      ),
    );
    section.appendChild(
      this._createButton("Keyboard Shortcuts for the Patch Canvas", () => {
        (this.onShowKeyboardHelp || (() => window.showShortcutsDialog?.()))();
      }),
    );
    section.appendChild(
      this._createButton("Reset Accessibility Settings", () => {
        store.reset();
        window.updateStatus?.("Accessibility settings reset");
      }, true),
    );

    this._a11yControls = {
      contrast: contrast.select,
      uiScale: scale.select,
      focusRing: focusRing.select,
      reduceMotion: motion.select,
      motionWarnings: warnings.checkbox,
      colorVision: vision.select,
      colorVisionMode: visionMode.select,
      announcements: announcements.select,
      outlineOrder: order.select,
    };
    this._refreshA11yControls();
    return section;
  }

  _refreshA11yControls() {
    const controls = this._a11yControls;
    const store = this.a11y;
    if (!controls || !store) return;
    for (const key of ["contrast", "focusRing", "reduceMotion", "colorVision", "colorVisionMode", "announcements", "outlineOrder"]) {
      if (controls[key]) controls[key].value = store.get(key);
    }
    if (controls.uiScale) controls.uiScale.value = String(store.get("uiScale"));
    if (controls.motionWarnings) controls.motionWarnings.checked = store.motionWarningsEnabled();
    if (controls.colorVisionMode) controls.colorVisionMode.disabled = store.get("colorVision") === "none";
  }

  // ---- Canvas / saving -------------------------------------------------------

  _createCanvasSection() {
    const section = this._createSection("Canvas / Node Editor", "canvas");

    const showGrid = this._createCheckbox("Show Grid", "showGrid", this.preferences.showGrid);
    const snap = this._createCheckbox("Snap to Grid", "snapToGrid", this.preferences.snapToGrid);
    const gridSize = this._createSlider("Grid Size", "gridSize", 2, 100, this.preferences.gridSize, "px", 1);

    section.appendChild(showGrid.container);
    section.appendChild(snap.container);
    section.appendChild(gridSize.container);

    this._controls.showGrid = showGrid.checkbox;
    this._controls.snapToGrid = snap.checkbox;
    this._controls.gridSize = gridSize;

    return section;
  }

  _createSavingSection() {
    const section = this._createSection("Saving", "saving");

    const autoSave = this._createCheckbox("Auto-Save", "autoSave", this.preferences.autoSave);
    section.appendChild(autoSave.container);
    section.appendChild(
      this._createHint(
        "Snapshots the patch every 30 seconds - in a gap between frames, never mid-gesture - and again when the window is hidden or closed, so it can be recovered after a crash. Turn it off to keep saving entirely manual; an autosave already stored stays recoverable either way.",
      ),
    );

    this._controls.autoSave = autoSave.checkbox;

    return section;
  }

  _createHint(text) {
    const hint = document.createElement("p");
    hint.textContent = text;
    hint.style.cssText = `
      color: var(--rz-text-3);
      font-size: 11px;
      line-height: 1.5;
      margin: 2px 0 10px 0;
    `;
    return hint;
  }

  _createRenderPointer() {
    const note = document.createElement("div");
    note.style.cssText = `
      margin-bottom: 20px;
      padding: 10px 12px;
      border: 1px solid var(--rz-line);
      border-radius: 6px;
      color: var(--rz-text-3);
      font-size: 11px;
      line-height: 1.5;
    `;
    note.textContent =
      "Render resolution, frame rate and export options live in View → Preview / Export Settings. That window is the single place they are set; the preview, exports and publishing all follow it.";
    return note;
  }

  /**
   * A checkbox row. With a `key`, it writes this window's own preference; with
   * an `onChange`, it reports the new state to the caller instead.
   */
  _createCheckbox(label, key, checked, onChange = null) {
    const container = document.createElement("label");
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      color: var(--rz-text);
      font-size: 13px;
      cursor: pointer;
      user-select: none;
    `;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.style.cssText = `
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: #d9733f;
    `;

    const labelEl = document.createElement("span");
    labelEl.textContent = label;

    checkbox.addEventListener("change", (e) => {
      if (onChange) {
        onChange(e.target.checked);
        return;
      }
      this.preferences[key] = e.target.checked;
      this._persist();
      this._applyPreference(key, e.target.checked);
    });

    container.appendChild(checkbox);
    container.appendChild(labelEl);

    return { container, checkbox };
  }

  /** A labelled native <select>: `options` is [[value, label], …]. */
  _createSelect(label, options, value, onChange) {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 8px;";

    const id = nextId("select");
    const labelEl = document.createElement("label");
    labelEl.htmlFor = id;
    labelEl.textContent = label;
    labelEl.style.cssText = `
      display: block;
      color: var(--rz-text-2);
      font-size: 12px;
      margin-bottom: 4px;
    `;

    const select = document.createElement("select");
    select.id = id;
    select.style.cssText = `
      width: 100%;
      padding: 6px 8px;
      background: var(--rz-well);
      color: var(--rz-text);
      border: 1px solid var(--rz-line-strong);
      border-radius: 6px;
      font-family: inherit;
      font-size: 12px;
    `;
    for (const [optionValue, optionLabel] of options) {
      const option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionLabel;
      select.appendChild(option);
    }
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));

    container.appendChild(labelEl);
    container.appendChild(select);
    return { container, select };
  }

  _createSlider(label, key, min, max, value, unit = "", step = 1) {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 12px;";

    const id = nextId("slider");
    const labelEl = document.createElement("label");
    labelEl.htmlFor = id;
    labelEl.textContent = label + ":";
    labelEl.style.cssText = `
      display: block;
      color: var(--rz-text-2);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = id;
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    slider.setAttribute("aria-valuetext", `${value}${unit}`);
    slider.style.cssText = `
      width: 100%;
      height: 4px;
      background: var(--rz-line-strong);
      outline: none;
      border-radius: 2px;
      appearance: none;
      cursor: pointer;
      margin-bottom: 4px;
    `;

    const valueEl = document.createElement("div");
    valueEl.textContent = `${value}${unit}`;
    valueEl.setAttribute("aria-hidden", "true");
    valueEl.style.cssText = `
      text-align: center;
      color: var(--rz-text-3);
      font-size: 11px;
      margin-top: 4px;
    `;

    slider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      valueEl.textContent = `${val}${unit}`;
      slider.setAttribute("aria-valuetext", `${val}${unit}`);
      this.preferences[key] = val;
      this._persist();
      this._applyPreference(key, val);
    });

    container.appendChild(labelEl);
    container.appendChild(slider);
    container.appendChild(valueEl);

    return { container, slider, valueEl, unit };
  }

  _createButton(label, onClick, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = `
      width: 100%;
      padding: ${danger ? "8px 12px" : "10px 12px"};
      margin-bottom: 8px;
      background: ${danger ? "rgba(255, 59, 48, 0.2)" : "var(--rz-fill-soft)"};
      border: 1px solid ${danger ? "rgba(255, 59, 48, 0.4)" : "var(--rz-line-strong)"};
      border-radius: 6px;
      color: ${danger ? "#f8615a" : "var(--rz-text)"};
      font-family: inherit;
      font-size: ${danger ? "12px" : "13px"};
      font-weight: ${danger ? "600" : "500"};
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: left;
    `;

    button.onmouseenter = () => {
      button.style.background = danger ? "rgba(255, 59, 48, 0.3)" : "var(--rz-hover-strong)";
    };
    button.onmouseleave = () => {
      button.style.background = danger ? "rgba(255, 59, 48, 0.2)" : "var(--rz-fill-soft)";
    };
    button.onclick = onClick;

    return button;
  }

  _applyPreference(key, value) {
    switch (key) {
      case "showGrid": {
        window.editor?.setGridVisible?.(value);
        const showToggle = document.getElementById("view-show-grid");
        if (showToggle) showToggle.checked = value;
        break;
      }
      case "snapToGrid": {
        window.editor?.setSnapEnabled?.(value);
        const toggle = document.getElementById("snap-toggle");
        if (toggle) toggle.checked = value;
        break;
      }
      case "gridSize": {
        window.editor?.setSnapGridSize?.(value);
        const sizeInput = document.getElementById("snap-size");
        if (sizeInput) sizeInput.value = value;
        document.documentElement.style?.setProperty("--snap-grid-size", `${value}px`);
        break;
      }
      case "autoSave": {
        window.saveLoadManager?.setAutosaveEnabled?.(value);
        break;
      }
    }
  }

  _refreshControls() {
    if (this._controls.showGrid) {
      this._controls.showGrid.checked = this.preferences.showGrid;
    }
    if (this._controls.snapToGrid) {
      this._controls.snapToGrid.checked = this.preferences.snapToGrid;
    }
    if (this._controls.autoSave) {
      this._controls.autoSave.checked = this.preferences.autoSave;
    }
    const gridSize = this._controls.gridSize;
    if (gridSize) {
      gridSize.slider.value = this.preferences.gridSize;
      gridSize.valueEl.textContent = `${this.preferences.gridSize}${gridSize.unit}`;
      gridSize.slider.setAttribute("aria-valuetext", `${this.preferences.gridSize}${gridSize.unit}`);
    }
  }

  /** Keep the window in step with the View menu's grid controls. */
  syncPreference(key, value) {
    if (!(key in DEFAULT_PREFERENCES)) return;
    this.preferences[key] = value;
    this._persist();
    this._refreshControls();
  }

  _resetAll() {
    this.preferences = { ...DEFAULT_PREFERENCES };
    this._persist();
    this.applyAll();
    this._refreshControls();

    if (typeof window.updateStatus === "function") {
      window.updateStatus("Preferences reset to defaults");
    }
  }
}
