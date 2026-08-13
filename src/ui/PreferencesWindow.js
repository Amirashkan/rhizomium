/**
 * PreferencesWindow.js - Editor preferences.
 *
 * Only preferences that are actually applied live here. Render settings
 * (resolution, frame rate, export) are not duplicated in this window - they
 * belong to View -> Preview / Export Settings, which is the single owner of
 * the render resolution.
 */

import { makeDraggable } from './utils/draggable.js';

const DEFAULT_PREFERENCES = {
  snapToGrid: true,
  gridSize: 20,
};

const STORAGE_KEY = "rhizo.preferences";

export class PreferencesWindow {
  constructor() {
    this.window = null;
    this.cleanupDraggable = null;
    this.preferences = { ...DEFAULT_PREFERENCES, ...this._readStored() };
    this._controls = {};
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

  show() {
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
      this._refreshControls();
      return;
    }

    this.window = document.createElement("div");
    this.window.id = "preferences-window";
    this.window.style.cssText = `
      position: fixed;
      left: 50%;
      top: 50%;
      width: 420px;
      max-width: 90vw;
      max-height: 85vh;
      background: rgba(28, 28, 30, 0.98);
      backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      z-index: 1001;
      display: flex;
      flex-direction: column;
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.95);
      transition: all 0.2s ease;
      overflow: hidden;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.05);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      flex-shrink: 0;
    `;

    const title = document.createElement("div");
    title.textContent = "Preferences";
    title.style.cssText = "color: #f3ede4; font-size: 14px; font-weight: 600;";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
      background: transparent;
      border: none;
      color: #f3ede4;
      cursor: pointer;
      font-size: 18px;
      padding: 4px;
      border-radius: 4px;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    closeBtn.onclick = () => this.hide();

    header.appendChild(title);
    header.appendChild(closeBtn);

    const content = document.createElement("div");
    content.style.cssText = `
      padding: 16px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    `;
    content.className = "custom-scroll";

    content.appendChild(this._createCanvasSection());
    content.appendChild(this._createRenderPointer());
    content.appendChild(
      this._createButton("Reset Preferences to Defaults", () => this._resetAll(), true),
    );

    this.window.appendChild(header);
    this.window.appendChild(content);
    document.body.appendChild(this.window);

    requestAnimationFrame(() => {
      this.window.style.opacity = "1";
      this.window.style.transform = "translate(-50%, -50%) scale(1)";

      // Convert transform-based centering to left/top so dragging works.
      const rect = this.window.getBoundingClientRect();
      this.window.style.left = rect.left + 'px';
      this.window.style.top = rect.top + 'px';
      this.window.style.transform = 'scale(1)';

      this.cleanupDraggable = makeDraggable(this.window, header);
    });
  }

  hide() {
    if (!this.window) return;

    if (this.cleanupDraggable) {
      this.cleanupDraggable();
      this.cleanupDraggable = null;
    }

    this.window.style.opacity = "0";
    this.window.style.transform = "scale(0.95)";

    setTimeout(() => {
      if (this.window) {
        this.window.style.display = "none";
      }
    }, 200);
  }

  _createCanvasSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "Canvas / Node Editor";
    sectionTitle.style.cssText = `
      color: #f3ede4;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    const snap = this._createCheckbox("Snap to Grid", "snapToGrid", this.preferences.snapToGrid);
    const gridSize = this._createSlider("Grid Size", "gridSize", 2, 100, this.preferences.gridSize, "px", 1);

    section.appendChild(snap.container);
    section.appendChild(gridSize.container);

    this._controls.snapToGrid = snap.checkbox;
    this._controls.gridSize = gridSize;

    return section;
  }

  _createRenderPointer() {
    const note = document.createElement("div");
    note.style.cssText = `
      margin-bottom: 20px;
      padding: 10px 12px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.6);
      font-size: 11px;
      line-height: 1.5;
    `;
    note.textContent =
      "Render resolution, frame rate and export options live in View → Preview / Export Settings. That window is the single place they are set; the preview, exports and publishing all follow it.";
    return note;
  }

  _createCheckbox(label, key, checked) {
    const container = document.createElement("label");
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      color: #f3ede4;
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
      accent-color: #c6f24e;
    `;

    const labelEl = document.createElement("span");
    labelEl.textContent = label;

    checkbox.addEventListener("change", (e) => {
      this.preferences[key] = e.target.checked;
      this._persist();
      this._applyPreference(key, e.target.checked);
    });

    container.appendChild(checkbox);
    container.appendChild(labelEl);

    return { container, checkbox };
  }

  _createSlider(label, key, min, max, value, unit = "", step = 1) {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 12px;";

    const labelEl = document.createElement("label");
    labelEl.textContent = label + ":";
    labelEl.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = min;
    slider.max = max;
    slider.step = step;
    slider.value = value;
    slider.style.cssText = `
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      outline: none;
      border-radius: 2px;
      appearance: none;
      cursor: pointer;
      margin-bottom: 4px;
    `;

    const valueEl = document.createElement("div");
    valueEl.textContent = `${value}${unit}`;
    valueEl.style.cssText = `
      text-align: center;
      color: #8f867a;
      font-size: 11px;
      margin-top: 4px;
    `;

    slider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      valueEl.textContent = `${val}${unit}`;
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
    button.textContent = label;
    button.style.cssText = `
      width: 100%;
      padding: ${danger ? "8px 12px" : "10px 12px"};
      margin-bottom: 8px;
      background: ${danger ? "rgba(255, 59, 48, 0.2)" : "rgba(255, 255, 255, 0.1)"};
      border: 1px solid ${danger ? "rgba(255, 59, 48, 0.4)" : "rgba(255, 255, 255, 0.2)"};
      border-radius: 6px;
      color: ${danger ? "#f8615a" : "#f3ede4"};
      font-size: ${danger ? "12px" : "13px"};
      font-weight: ${danger ? "600" : "500"};
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: left;
    `;

    button.onmouseenter = () => {
      button.style.background = danger ? "rgba(255, 59, 48, 0.3)" : "rgba(255, 255, 255, 0.15)";
    };
    button.onmouseleave = () => {
      button.style.background = danger ? "rgba(255, 59, 48, 0.2)" : "rgba(255, 255, 255, 0.1)";
    };
    button.onclick = onClick;

    return button;
  }

  _applyPreference(key, value) {
    switch (key) {
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
    }
  }

  _refreshControls() {
    if (this._controls.snapToGrid) {
      this._controls.snapToGrid.checked = this.preferences.snapToGrid;
    }
    const gridSize = this._controls.gridSize;
    if (gridSize) {
      gridSize.slider.value = this.preferences.gridSize;
      gridSize.valueEl.textContent = `${this.preferences.gridSize}${gridSize.unit}`;
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
