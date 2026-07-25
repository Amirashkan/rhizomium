/**
 * PreviewExportSettingsWindow.js - The single window for render settings.
 *
 * Opened from View -> Preview / Export Settings and from the floating preview's
 * gear button. Every control here is wired to something that actually runs:
 * the render resolution store, the render loop, or the exporters. Publishing to
 * the gallery lives in File -> Publish.
 */

import { makeDraggable } from './utils/draggable.js';
import { exportPNG, exportAnimation } from './exportRender.js';
import {
  DEFAULT_RESOLUTION,
  MAX_HEIGHT,
  MAX_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  RESOLUTION_PRESETS,
  getPreset,
  getRenderResolution,
  matchPreset,
  setRenderResolution,
  subscribeRenderResolution,
} from './RenderResolution.js';

const DEFAULT_SETTINGS = {
  refreshRate: 60,
  timingMode: "fixed",
  timeScale: 1.0,
  isPaused: false,
  showFPS: false,
};

export class PreviewExportSettingsWindow {
  constructor(floatingPreview) {
    this.floatingPreview = floatingPreview;
    // Live render state lives in PreviewSettings; this window only edits it.
    this.settings = floatingPreview?.settings?.settings || { ...DEFAULT_SETTINGS };
    this.window = null;
    this.cleanupDraggable = null;
    this._controls = {};
    this._unsubscribeResolution = null;
  }

  /** Push a setting change into PreviewSettings so it is applied and shared. */
  _set(key, value) {
    if (this.floatingPreview?.settings?.updateSetting) {
      this.floatingPreview.settings.updateSetting(key, value);
    } else {
      this.settings[key] = value;
    }
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
      this._refreshFromState();
      return;
    }

    this.window = document.createElement("div");
    this.window.id = "preview-export-settings-window";
    this.window.style.cssText = `
      position: fixed;
      left: 50%;
      top: 50%;
      width: 400px;
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
    title.textContent = "Preview / Export Settings";
    title.style.cssText = "color: #fff; font-size: 14px; font-weight: 600;";

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
      background: transparent;
      border: none;
      color: #fff;
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

    content.appendChild(this._createResolutionSection());
    content.appendChild(this._createTimingSection());
    content.appendChild(this._createDisplaySection());
    content.appendChild(this._createExportSection());
    content.appendChild(this._createResetSection());

    this.window.appendChild(header);
    this.window.appendChild(content);
    document.body.appendChild(this.window);

    this._unsubscribeResolution = subscribeRenderResolution((resolution) => {
      this._syncResolutionControls(resolution);
    });

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

  /** True while the window is on screen. */
  get isOpen() {
    return !!this.window && this.window.style.display !== "none";
  }

  // ---------------------------------------------------------------- sections

  _createSection(title, note) {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = title;
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: ${note ? "4px" : "12px"};
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    if (note) {
      const noteEl = document.createElement("div");
      noteEl.textContent = note;
      noteEl.style.cssText = `
        color: rgba(255, 255, 255, 0.45);
        font-size: 11px;
        line-height: 1.4;
        margin-bottom: 12px;
      `;
      section.appendChild(noteEl);
    }

    return section;
  }

  _createResolutionSection() {
    const section = this._createSection(
      "Render Resolution",
      "The one size everything renders at - preview, PNG export, animation export and publishing.",
    );

    const resolution = getRenderResolution();

    // Preset dropdown
    const presetContainer = document.createElement("div");
    presetContainer.style.cssText = "margin-bottom: 12px;";

    const presetLabel = document.createElement("label");
    presetLabel.textContent = "Preset:";
    presetLabel.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const presetSelect = document.createElement("select");
    presetSelect.id = "render-resolution-preset";
    presetSelect.style.cssText = this._selectStyle();

    RESOLUTION_PRESETS.forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.label;
      presetSelect.appendChild(option);
    });
    const customOption = document.createElement("option");
    customOption.value = "custom";
    customOption.textContent = "Custom";
    presetSelect.appendChild(customOption);
    presetSelect.value = matchPreset(resolution);

    presetSelect.addEventListener("change", (e) => {
      const preset = getPreset(e.target.value);
      if (preset) {
        setRenderResolution(preset.width, preset.height, "settingsWindow");
      }
    });

    presetContainer.appendChild(presetLabel);
    presetContainer.appendChild(presetSelect);
    section.appendChild(presetContainer);

    // Width / height
    const sizeRow = document.createElement("div");
    sizeRow.style.cssText = "display: flex; gap: 8px;";

    const widthInput = this._createSizeInput("Width", resolution.width, MIN_WIDTH, MAX_WIDTH);
    const heightInput = this._createSizeInput("Height", resolution.height, MIN_HEIGHT, MAX_HEIGHT);

    const commit = () => {
      setRenderResolution(
        parseInt(widthInput.input.value, 10),
        parseInt(heightInput.input.value, 10),
        "settingsWindow",
      );
      // Re-read: the store clamps, so the inputs must show what was applied.
      this._syncResolutionControls(getRenderResolution());
    };

    widthInput.input.addEventListener("change", commit);
    heightInput.input.addEventListener("change", commit);

    sizeRow.appendChild(widthInput.container);
    sizeRow.appendChild(heightInput.container);
    section.appendChild(sizeRow);

    this._controls.resolutionPreset = presetSelect;
    this._controls.resolutionWidth = widthInput.input;
    this._controls.resolutionHeight = heightInput.input;

    return section;
  }

  _createTimingSection() {
    const section = this._createSection("Timing");

    const timingSelect = this._createDropdown(
      "Timing Mode",
      [
        { value: "vsync", label: "V-Sync (display refresh)" },
        { value: "fixed", label: "Fixed step" },
      ],
      this.settings.timingMode || "fixed",
      (value) => {
        this._set("timingMode", value);
        this._syncRefreshRateAvailability();
      },
    );
    section.appendChild(timingSelect.container);

    const fps = this._createSlider(
      "Frame Rate",
      1,
      120,
      this.settings.refreshRate || 60,
      "Hz",
      1,
      (value) => this._set("refreshRate", value),
    );
    section.appendChild(fps.container);

    const timeScale = this._createSlider(
      "Time Scale",
      0,
      2,
      this.settings.timeScale ?? 1,
      "x",
      0.01,
      (value) => this._set("timeScale", value),
    );
    section.appendChild(timeScale.container);

    const pause = this._createCheckbox(
      "Pause Time",
      this.settings.isPaused === true,
      (checked) => this._set("isPaused", checked),
    );
    section.appendChild(pause.container);

    this._controls.timingMode = timingSelect.select;
    this._controls.refreshRate = fps;
    this._controls.timeScale = timeScale;
    this._controls.isPaused = pause.checkbox;

    this._syncRefreshRateAvailability();

    return section;
  }

  _createDisplaySection() {
    const section = this._createSection("Display");

    const showFps = this._createCheckbox(
      "Show FPS counter on preview",
      this.settings.showFPS === true,
      (checked) => this._set("showFPS", checked),
    );
    section.appendChild(showFps.container);

    const adaptive = this._createCheckbox(
      "Adaptive quality when frame rate drops",
      this.settings.adaptiveQuality?.autoEnable !== false,
      (checked) => this._set("adaptiveQuality.autoEnable", checked),
    );
    section.appendChild(adaptive.container);

    const adaptiveNote = document.createElement("div");
    adaptiveNote.textContent =
      "Temporarily renders below the resolution above when frames run over budget, and restores it once performance recovers.";
    adaptiveNote.style.cssText = `
      color: rgba(255, 255, 255, 0.45);
      font-size: 11px;
      line-height: 1.4;
      margin: -4px 0 0 24px;
    `;
    section.appendChild(adaptiveNote);

    this._controls.showFPS = showFps.checkbox;
    this._controls.adaptiveAutoEnable = adaptive.checkbox;

    return section;
  }

  _createExportSection() {
    const section = this._createSection(
      "Export",
      "Saves to your machine at the render resolution. To share to the gallery use File → Publish.",
    );

    const buttons = document.createElement("div");
    buttons.style.cssText = "display: flex; flex-direction: column; gap: 8px;";
    buttons.appendChild(this._createButton("Export as PNG", () => exportPNG()));
    buttons.appendChild(this._createButton("Export Animation (MP4/WebM)", () => exportAnimation()));

    section.appendChild(buttons);
    return section;
  }

  _createResetSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 4px;";
    section.appendChild(
      this._createButton("Reset to Default Settings", () => this._resetToDefaults(), true),
    );
    return section;
  }

  // ---------------------------------------------------------------- controls

  _selectStyle() {
    return `
      width: 100%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
    `;
  }

  _createSizeInput(label, value, min, max) {
    const container = document.createElement("div");
    container.style.cssText = "flex: 1;";

    const labelEl = document.createElement("label");
    labelEl.textContent = `${label}:`;
    labelEl.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = 1;
    input.style.cssText = `
      width: 100%;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      border-radius: 4px;
      font-size: 12px;
      box-sizing: border-box;
    `;

    container.appendChild(labelEl);
    container.appendChild(input);

    return { container, input };
  }

  _createDropdown(label, options, selected, onChange) {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 12px;";

    const labelEl = document.createElement("label");
    labelEl.textContent = `${label}:`;
    labelEl.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const select = document.createElement("select");
    select.style.cssText = this._selectStyle();

    options.forEach((option) => {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      optionEl.selected = option.value === selected;
      select.appendChild(optionEl);
    });

    select.addEventListener("change", (e) => onChange(e.target.value));

    container.appendChild(labelEl);
    container.appendChild(select);

    return { container, select };
  }

  _createSlider(label, min, max, value, unit, step, onChange) {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 12px;";

    const head = document.createElement("div");
    head.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 6px;";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.style.cssText = "color: rgba(255, 255, 255, 0.8); font-size: 12px;";

    const valueEl = document.createElement("span");
    valueEl.textContent = `${value}${unit}`;
    valueEl.style.cssText = "color: #fff; font-size: 12px; font-weight: 500;";

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
    `;

    slider.addEventListener("input", (e) => {
      const newValue = parseFloat(e.target.value);
      valueEl.textContent = `${newValue}${unit}`;
      onChange(newValue);
    });

    head.appendChild(labelEl);
    head.appendChild(valueEl);
    container.appendChild(head);
    container.appendChild(slider);

    return { container, slider, valueEl, labelEl, unit };
  }

  _createCheckbox(label, checked, onChange) {
    const container = document.createElement("label");
    container.className = "submenu-toggle";
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      color: #e8e8e8;
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
      accent-color: #007aff;
    `;

    const labelEl = document.createElement("span");
    labelEl.textContent = label;

    checkbox.addEventListener("change", (e) => onChange(e.target.checked));

    container.appendChild(checkbox);
    container.appendChild(labelEl);

    return { container, checkbox };
  }

  _createButton(label, onClick, danger = false) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = `
      width: 100%;
      padding: ${danger ? "8px 12px" : "10px 12px"};
      background: ${danger ? "rgba(255, 59, 48, 0.2)" : "rgba(255, 255, 255, 0.1)"};
      border: 1px solid ${danger ? "rgba(255, 59, 48, 0.4)" : "rgba(255, 255, 255, 0.2)"};
      border-radius: 6px;
      color: ${danger ? "#ff6b6b" : "#fff"};
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

  // ------------------------------------------------------------------- sync

  _syncRefreshRateAvailability() {
    const fps = this._controls.refreshRate;
    if (!fps) return;

    const disabled = (this.settings.timingMode || "fixed") !== "fixed";
    fps.slider.disabled = disabled;
    fps.slider.style.opacity = disabled ? "0.35" : "1";
    fps.slider.style.pointerEvents = disabled ? "none" : "auto";
    fps.valueEl.style.opacity = disabled ? "0.6" : "1";
    fps.labelEl.style.opacity = disabled ? "0.6" : "1";
  }

  _syncResolutionControls(resolution = getRenderResolution()) {
    const { resolutionPreset, resolutionWidth, resolutionHeight } = this._controls;
    if (resolutionWidth && resolutionWidth.value !== String(resolution.width)) {
      resolutionWidth.value = resolution.width;
    }
    if (resolutionHeight && resolutionHeight.value !== String(resolution.height)) {
      resolutionHeight.value = resolution.height;
    }
    if (resolutionPreset) {
      resolutionPreset.value = matchPreset(resolution);
    }
  }

  /**
   * Reflect a setting changed elsewhere (keyboard shortcut, reset) in the UI.
   * Called by PreviewSettings.updateSetting().
   */
  syncControl(key, value) {
    if (!this.window) return;

    switch (key) {
      case "timingMode":
        if (this._controls.timingMode) this._controls.timingMode.value = value;
        this._syncRefreshRateAvailability();
        break;
      case "refreshRate":
      case "timeScale": {
        const control = this._controls[key];
        if (control && control.slider.value !== String(value)) {
          control.slider.value = value;
          control.valueEl.textContent = `${value}${control.unit}`;
        }
        break;
      }
      case "isPaused":
      case "showFPS": {
        const checkbox = this._controls[key];
        if (checkbox && checkbox.checked !== !!value) checkbox.checked = !!value;
        break;
      }
      case "adaptiveQuality.autoEnable":
        if (this._controls.adaptiveAutoEnable) {
          this._controls.adaptiveAutoEnable.checked = !!value;
        }
        break;
    }
  }

  _refreshFromState() {
    this._syncResolutionControls();
    ["timingMode", "refreshRate", "timeScale", "isPaused", "showFPS"].forEach((key) => {
      this.syncControl(key, this.settings[key]);
    });
    this.syncControl("adaptiveQuality.autoEnable", this.settings.adaptiveQuality?.autoEnable !== false);
  }

  _resetToDefaults() {
    setRenderResolution(DEFAULT_RESOLUTION.width, DEFAULT_RESOLUTION.height, "reset");

    Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
      this._set(key, value);
    });
    this._set("adaptiveQuality.autoEnable", true);

    this._refreshFromState();

    if (typeof window.updateStatus === "function") {
      window.updateStatus("Render settings reset to defaults");
    }
  }
}
