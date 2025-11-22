/**
 * PreferencesWindow.js - Movable window for Application Preferences
 */

import { makeDraggable } from './utils/draggable.js';

export class PreferencesWindow {
  constructor() {
    this.window = null;
    this.cleanupDraggable = null;
    this.preferences = {
      // General
      language: "English",
      autoSaveInterval: 5, // minutes
      theme: "Dark",
      showTooltips: true,
      
      // Canvas / Node Editor
      snapToGrid: true,
      gridSize: 20,
      selectionHighlightColor: "#007aff",
      defaultNodeSize: 120,
      enableNodePreviews: true,
      
      // Preview / Render
      defaultResolution: "1080p",
      defaultAntiAliasing: 2,
      defaultGPUPrecision: "high",
      showWireframeByDefault: false,
      
      // Audio / Signal
      defaultSampleRate: "48kHz",
      enableRealTimeAudioMonitoring: true,
      defaultInputDevice: "default",
      
      // Shortcuts
      // (shortcuts would be stored separately)
      
      // Advanced
      enableExperimentalFeatures: false,
      loggingLevel: "Warning",
    };
  }

  show() {
    if (this.window) {
      this.window.style.display = "flex";
      this.window.style.opacity = "1";
      
      // If window already has left/top positioning (from dragging), preserve it
      // Otherwise, center it on first show
      if (!this.window.style.left || this.window.style.left === 'auto' || this.window.style.left === '50%') {
        // Center on screen
        const left = (window.innerWidth - this.window.offsetWidth) / 2;
        const top = (window.innerHeight - this.window.offsetHeight) / 2;
        this.window.style.left = left + 'px';
        this.window.style.top = top + 'px';
      }
      this.window.style.transform = "scale(1)";
      
      return;
    }

    this.window = document.createElement("div");
    this.window.id = "preferences-window";
    this.window.style.cssText = `
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 500px;
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

    // General Section
    content.appendChild(this._createGeneralSection());

    // Canvas / Node Editor Section
    content.appendChild(this._createCanvasSection());

    // Preview / Render Section
    content.appendChild(this._createPreviewSection());

    // Audio / Signal Section
    content.appendChild(this._createAudioSection());

    // Shortcuts Section
    content.appendChild(this._createShortcutsSection());

    // Advanced Section
    content.appendChild(this._createAdvancedSection());

    this.window.appendChild(header);
    this.window.appendChild(content);
    document.body.appendChild(this.window);

    // Make draggable - needs to be done after element is in DOM
    requestAnimationFrame(() => {
      this.window.style.opacity = "1";
      
      // Center the window initially using transform
      this.window.style.transform = "translate(-50%, -50%) scale(1)";
      
      // Get the actual position after centering
      const rect = this.window.getBoundingClientRect();
      
      // Convert from transform-based centering to left/top positioning
      // This makes dragging work properly
      this.window.style.left = rect.left + 'px';
      this.window.style.top = rect.top + 'px';
      this.window.style.transform = 'scale(1)';
      
      // Make draggable after positioning is set
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
    this.window.style.transform = "translate(-50%, -50%) scale(0.95)";

    setTimeout(() => {
      if (this.window) {
        this.window.style.display = "none";
      }
    }, 200);
  }

  _createSection(title, controls) {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = title;
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;

    section.appendChild(sectionTitle);
    controls.forEach((control) => section.appendChild(control));

    return section;
  }

  _createCheckbox(label, key, checked) {
    const container = document.createElement("label");
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

    checkbox.addEventListener("change", (e) => {
      this.preferences[key] = e.target.checked;
      this._applyPreference(key, e.target.checked);
    });

    container.appendChild(checkbox);
    container.appendChild(labelEl);

    return container;
  }

  _createDropdown(label, key, options, selected) {
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

    const select = document.createElement("select");
    select.style.cssText = `
      width: 100%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
    `;

    options.forEach((option) => {
      const optionEl = document.createElement("option");
      optionEl.value = typeof option === "string" ? option : option.value;
      optionEl.textContent = typeof option === "string" ? option : option.label;
      optionEl.selected = (typeof option === "string" ? option : option.value) === selected;
      select.appendChild(optionEl);
    });

    select.addEventListener("change", (e) => {
      this.preferences[key] = e.target.value;
      this._applyPreference(key, e.target.value);
    });

    container.appendChild(labelEl);
    container.appendChild(select);

    return container;
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
    valueEl.id = `pref-${key}-value`;
    valueEl.textContent = `${value}${unit}`;
    valueEl.style.cssText = `
      text-align: center;
      color: #aaa;
      font-size: 11px;
      margin-top: 4px;
    `;

    slider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      valueEl.textContent = `${val}${unit}`;
      this.preferences[key] = val;
      this._applyPreference(key, val);
    });

    container.appendChild(labelEl);
    container.appendChild(slider);
    container.appendChild(valueEl);

    return container;
  }

  _createNumberInput(label, key, value, min, max) {
    const container = document.createElement("div");
    container.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
    
    const labelEl = document.createElement("label");
    labelEl.textContent = label + ":";
    labelEl.style.cssText = "color: rgba(255, 255, 255, 0.8); font-size: 12px; min-width: 150px;";

    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    input.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      border-radius: 4px;
      font-size: 12px;
    `;

    input.addEventListener("change", (e) => {
      const val = parseInt(e.target.value) || value;
      this.preferences[key] = val;
      this._applyPreference(key, val);
    });

    container.appendChild(labelEl);
    container.appendChild(input);

    return container;
  }

  _createColorPicker(label, key, value) {
    const container = document.createElement("div");
    container.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
    
    const labelEl = document.createElement("label");
    labelEl.textContent = label + ":";
    labelEl.style.cssText = "color: rgba(255, 255, 255, 0.8); font-size: 12px; min-width: 150px;";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = value;
    colorInput.style.cssText = `
      width: 60px;
      height: 32px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 4px;
      cursor: pointer;
      background: ${value};
    `;

    const valueDisplay = document.createElement("span");
    valueDisplay.textContent = value;
    valueDisplay.style.cssText = "color: #aaa; font-size: 11px; font-family: monospace;";

    colorInput.addEventListener("change", (e) => {
      const val = e.target.value;
      valueDisplay.textContent = val;
      this.preferences[key] = val;
      this._applyPreference(key, val);
    });

    container.appendChild(labelEl);
    container.appendChild(colorInput);
    container.appendChild(valueDisplay);

    return container;
  }

  _createGeneralSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "General";
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    section.appendChild(this._createDropdown("Language", "language", ["English", "Other"], this.preferences.language));
    section.appendChild(this._createSlider("Auto-Save Interval", "autoSaveInterval", 1, 30, this.preferences.autoSaveInterval, " minutes", 1));
    section.appendChild(this._createDropdown("Theme", "theme", ["Light", "Dark", "Custom"], this.preferences.theme));
    section.appendChild(this._createCheckbox("Show Tooltips", "showTooltips", this.preferences.showTooltips));

    return section;
  }

  _createCanvasSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "Canvas / Node Editor";
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    section.appendChild(this._createCheckbox("Snap to Grid", "snapToGrid", this.preferences.snapToGrid));
    section.appendChild(this._createSlider("Grid Size", "gridSize", 2, 100, this.preferences.gridSize, "px", 1));
    section.appendChild(this._createColorPicker("Node Selection Highlight Color", "selectionHighlightColor", this.preferences.selectionHighlightColor));
    section.appendChild(this._createSlider("Default Node Size", "defaultNodeSize", 60, 300, this.preferences.defaultNodeSize, "px", 10));
    section.appendChild(this._createCheckbox("Enable Node Previews", "enableNodePreviews", this.preferences.enableNodePreviews));

    return section;
  }

  _createPreviewSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "Preview / Render";
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    section.appendChild(this._createDropdown("Default Resolution", "defaultResolution", ["720p", "1080p", "4K"], this.preferences.defaultResolution));
    section.appendChild(this._createDropdown("Anti-Aliasing Default", "defaultAntiAliasing", [
      { value: "2", label: "2x" },
      { value: "4", label: "4x" },
      { value: "8", label: "8x" },
    ], String(this.preferences.defaultAntiAliasing)));
    section.appendChild(this._createDropdown("GPU Precision", "defaultGPUPrecision", [
      { value: "high", label: "High Precision" },
      { value: "medium", label: "Medium Precision" },
      { value: "low", label: "Low Precision" },
    ], this.preferences.defaultGPUPrecision));
    section.appendChild(this._createCheckbox("Show Wireframe by Default", "showWireframeByDefault", this.preferences.showWireframeByDefault));

    return section;
  }

  _createAudioSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "Audio / Signal";
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    section.appendChild(this._createDropdown("Default Sample Rate", "defaultSampleRate", ["44.1kHz", "48kHz", "96kHz"], this.preferences.defaultSampleRate));
    section.appendChild(this._createCheckbox("Enable Real-Time Audio Monitoring", "enableRealTimeAudioMonitoring", this.preferences.enableRealTimeAudioMonitoring));
    section.appendChild(this._createDropdown("Default Input Device", "defaultInputDevice", ["default", "Microphone", "Line In"], this.preferences.defaultInputDevice));

    return section;
  }

  _createShortcutsSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "Shortcuts / Keymap";
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    const customizeBtn = this._createButton("Customize Shortcuts (opens keymap editor)", () => {
      // TODO: Open keymap editor
      if (typeof updateStatus === "function") {
        updateStatus("Shortcuts editor: Feature coming soon");
      }
    });

    const resetBtn = this._createButton("Reset to Default Shortcuts", () => {
      // TODO: Reset shortcuts to defaults
      if (typeof updateStatus === "function") {
        updateStatus("Shortcuts reset: Feature coming soon");
      }
    }, false, true);

    section.appendChild(customizeBtn);
    section.appendChild(resetBtn);

    return section;
  }

  _createAdvancedSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "Advanced";
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    section.appendChild(this._createCheckbox("Enable Experimental Features", "enableExperimentalFeatures", this.preferences.enableExperimentalFeatures));
    section.appendChild(this._createDropdown("Logging Level", "loggingLevel", ["None", "Error", "Warning", "Info", "Debug"], this.preferences.loggingLevel));

    const resetAllBtn = this._createButton("Reset All Preferences to Defaults", () => {
      this._resetAllPreferences();
    }, false, true);

    section.appendChild(resetAllBtn);

    return section;
  }

  _createButton(label, onClick, primary = false, reset = false) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = `
      width: 100%;
      padding: ${reset ? "8px 12px" : "10px 12px"};
      margin-bottom: 8px;
      background: ${reset ? "rgba(255, 59, 48, 0.2)" : primary ? "rgba(0, 122, 255, 0.8)" : "rgba(255, 255, 255, 0.1)"};
      border: 1px solid ${reset ? "rgba(255, 59, 48, 0.4)" : primary ? "rgba(0, 122, 255, 1)" : "rgba(255, 255, 255, 0.2)"};
      border-radius: 6px;
      color: ${reset ? "#ff6b6b" : "#fff"};
      font-size: ${reset ? "12px" : "13px"};
      font-weight: ${primary || reset ? "600" : "500"};
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: left;
    `;

    button.onmouseenter = () => {
      button.style.background = reset ? "rgba(255, 59, 48, 0.3)" : primary ? "rgba(0, 150, 255, 1)" : "rgba(255, 255, 255, 0.15)";
    };

    button.onmouseleave = () => {
      button.style.background = reset ? "rgba(255, 59, 48, 0.2)" : primary ? "rgba(0, 122, 255, 0.8)" : "rgba(255, 255, 255, 0.1)";
    };

    button.onclick = onClick;

    return button;
  }

  _applyPreference(key, value) {
    // Apply preferences to the application
    switch (key) {
      case "snapToGrid":
        if (window.editor?.setSnapEnabled) {
          window.editor.setSnapEnabled(value);
        }
        if (document.getElementById("snap-toggle")) {
          document.getElementById("snap-toggle").checked = value;
        }
        break;
      case "gridSize":
        if (window.editor?.setSnapGridSize) {
          window.editor.setSnapGridSize(value);
        }
        if (document.getElementById("snap-size")) {
          document.getElementById("snap-size").value = value;
        }
        // Update CSS variable
        if (document.documentElement.style) {
          document.documentElement.style.setProperty("--snap-grid-size", `${value}px`);
        }
        break;
      case "enableNodePreviews":
        // TODO: Toggle node previews globally
        break;
      case "autoSaveInterval":
        // TODO: Update auto-save interval
        break;
      case "loggingLevel":
        // TODO: Set logging level
        break;
      // Add more preference applications as needed
    }
  }

  _resetAllPreferences() {
    this.preferences = {
      language: "English",
      autoSaveInterval: 5,
      theme: "Dark",
      showTooltips: true,
      snapToGrid: true,
      gridSize: 20,
      selectionHighlightColor: "#007aff",
      defaultNodeSize: 120,
      enableNodePreviews: true,
      defaultResolution: "1080p",
      defaultAntiAliasing: 2,
      defaultGPUPrecision: "high",
      showWireframeByDefault: false,
      defaultSampleRate: "48kHz",
      enableRealTimeAudioMonitoring: true,
      defaultInputDevice: "default",
      enableExperimentalFeatures: false,
      loggingLevel: "Warning",
    };

    // Refresh the window
    this.hide();
    setTimeout(() => this.show(), 250);

    if (typeof updateStatus === "function") {
      updateStatus("All preferences reset to defaults");
    }
  }
}

