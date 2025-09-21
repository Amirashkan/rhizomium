export class PreviewSettings {
  constructor(floatingPreview) {
    this.floatingPreview = floatingPreview;
    this.settings = {
      resolution: { width: 512, height: 512 },
      refreshRate: 60,
      wireframe: false,
      showNormals: false,
      debugChannel: "none",
      timeScale: 1.0,
      isPaused: false,
      quality: "high",
      showFPS: false,
    };
    this.settingsPanel = null;
  }

  showSettings() {
    if (this.settingsPanel) {
      this.hideSettings();
      return;
    }

    this.settingsPanel = this._createSettingsPanel();
    document.body.appendChild(this.settingsPanel);
    this._positionSettingsPanel();

    requestAnimationFrame(() => {
      this.settingsPanel.style.opacity = "1";
      this.settingsPanel.style.transform = "scale(1)";
    });
  }

  hideSettings() {
    if (!this.settingsPanel) return;

    this.settingsPanel.style.opacity = "0";
    this.settingsPanel.style.transform = "scale(0.95)";

    setTimeout(() => {
      if (this.settingsPanel) {
        this.settingsPanel.remove();
        this.settingsPanel = null;
      }
    }, 200);
  }

  _positionSettingsPanel() {
    if (!this.settingsPanel || !this.floatingPreview.container) return;

    const previewRect = this.floatingPreview.container.getBoundingClientRect();
    const panelWidth = 280;
    const panelHeight = this.settingsPanel.offsetHeight || 500;

    let left = previewRect.right + 10;
    let top = previewRect.top;

    if (left + panelWidth > window.innerWidth) {
      left = previewRect.left - panelWidth - 10;
    }
    if (top + panelHeight > window.innerHeight) {
      top = window.innerHeight - panelHeight - 10;
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    this.settingsPanel.style.left = left + "px";
    this.settingsPanel.style.top = top + "px";
  }

  updateSetting(key, value) {
    if (key.includes(".")) {
      const [parent, child] = key.split(".");
      this.settings[parent][child] = value;
    } else {
      this.settings[key] = value;
    }

    this._applySetting(key, value);
  }

  _applySetting(key, value) {
    switch (key) {
      case "resolution.width":
      case "resolution.height":
        this._updateResolution();
        break;
      case "showFPS":
        this._updateFPSDisplay(value);
        break;
      case "debugChannel":
        this._updateDebugChannel(value);
        break;
    }
  }

  _updateResolution() {
    this.floatingPreview.updateSize();
  }

  _updateFPSDisplay(show) {
    const fpsOverlay = document.querySelector(".fps-overlay");
    if (fpsOverlay) {
      fpsOverlay.style.display = show ? "block" : "none";
    }

    if (show && this.floatingPreview.fpsCounter) {
      this.floatingPreview.fpsCounter.start();
    } else if (this.floatingPreview.fpsCounter) {
      this.floatingPreview.fpsCounter.stop();
    }
  }

  _updateDebugChannel(channel) {
    // Send debug channel to shader
    if (window.setDebugChannel) {
      window.setDebugChannel(channel);
    }
    console.log("Debug channel:", channel);
  }

  _createSettingsPanel() {
    const panel = document.createElement("div");
    panel.className = "preview-settings-panel custom-scroll";
    panel.style.cssText = `
      position: fixed;
      width: 280px;
      background: rgba(28, 28, 30, 0.95);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      z-index: 1001;
      overflow: hidden;
      opacity: 0;
      transform: scale(0.95);
      transition: all 0.2s ease;
      max-height: 500px;
      overflow-y: auto;
    `;

    const header = document.createElement("div");
    header.style.cssText = `
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.05);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 1;
    `;

    const title = document.createElement("div");
    title.textContent = "Preview Settings";
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
    `;
    closeBtn.onclick = () => this.hideSettings();

    header.appendChild(title);
    header.appendChild(closeBtn);

    const content = document.createElement("div");
    content.style.cssText = "padding: 16px;";

    content.appendChild(
      this._createSection("Resolution", [
        this._createResolutionControl(),
        this._createDropdown(
          "Quality",
          "quality",
          ["low", "medium", "high"],
          this.settings.quality,
        ),
      ]),
    );

    content.appendChild(
      this._createSection("Display", [
        this._createSlider(
          "Refresh Rate",
          "refreshRate",
          30,
          120,
          this.settings.refreshRate,
          "Hz",
        ),
        this._createCheckbox("Show FPS", "showFPS", this.settings.showFPS),
        this._createCheckbox("Wireframe", "wireframe", this.settings.wireframe),
        this._createCheckbox(
          "Show Normals",
          "showNormals",
          this.settings.showNormals,
        ),
        this._createDropdown(
          "Debug Channel",
          "debugChannel",
          ["none", "red", "green", "blue", "alpha"],
          this.settings.debugChannel,
        ),
      ]),
    );

    content.appendChild(
      this._createSection("Animation", [
        this._createSlider(
          "Time Scale",
          "timeScale",
          0,
          2,
          this.settings.timeScale,
          "x",
          0.01,
        ),
        this._createCheckbox("Pause Time", "isPaused", this.settings.isPaused),
      ]),
    );

    panel.appendChild(header);
    panel.appendChild(content);

    return panel;
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

  _createResolutionControl() {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 8px;";

    const inputContainer = document.createElement("div");
    inputContainer.style.cssText =
      "display: flex; gap: 8px; margin-bottom: 8px;";

    const widthInput = this._createNumberInput(
      "Width",
      this.settings.resolution.width,
      128,
      2048,
    );
    const heightInput = this._createNumberInput(
      "Height",
      this.settings.resolution.height,
      128,
      2048,
    );

    widthInput.querySelector("input").addEventListener("change", (e) => {
      this.updateSetting("resolution.width", parseInt(e.target.value));
    });

    heightInput.querySelector("input").addEventListener("change", (e) => {
      this.updateSetting("resolution.height", parseInt(e.target.value));
    });

    const presets = document.createElement("div");
    presets.style.cssText = "display: flex; gap: 4px;";

    const presetSizes = [
      { label: "256", w: 256, h: 256 },
      { label: "512", w: 512, h: 512 },
      { label: "1K", w: 1024, h: 1024 },
      { label: "16:9", w: 640, h: 360 },
    ];

    presetSizes.forEach((preset) => {
      const btn = document.createElement("button");
      btn.textContent = preset.label;
      btn.style.cssText = `
    background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        cursor: pointer;
        transition: background 0.15s ease;
      `;

      btn.onmouseenter = () =>
        (btn.style.background = "rgba(255, 255, 255, 0.2)");
      btn.onmouseleave = () =>
        (btn.style.background = "rgba(255, 255, 255, 0.1)");

      btn.onclick = () => {
        this.updateSetting("resolution.width", preset.w);
        this.updateSetting("resolution.height", preset.h);
        widthInput.querySelector("input").value = preset.w;
        heightInput.querySelector("input").value = preset.h;
      };

      presets.appendChild(btn);
    });

    inputContainer.appendChild(widthInput);
    inputContainer.appendChild(heightInput);
    container.appendChild(inputContainer);
    container.appendChild(presets);

    return container;
  }

  _createNumberInput(label, value, min, max) {
    const container = document.createElement("div");
    container.style.cssText = "flex: 1;";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 11px;
      margin-bottom: 4px;
    `;

    const input = document.createElement("input");
    input.type = "number";
    input.value = value;
    input.min = min;
    input.max = max;
    input.style.cssText = `
      width: 100%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      box-sizing: border-box;
    `;

    container.appendChild(labelEl);
    container.appendChild(input);

    return container;
  }

  _createSlider(label, key, min, max, value, unit = "", step = 1) {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 12px;";

    const header = document.createElement("div");
    header.style.cssText =
      "display: flex; justify-content: space-between; margin-bottom: 6px;";

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

    // Custom slider styling
    const style = document.createElement("style");
    style.textContent = `
      input[type="range"]::-webkit-slider-thumb {
        appearance: none;
        width: 16px;
        height: 16px;
        background: #007AFF;
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid #fff;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }
      input[type="range"]::-moz-range-thumb {
        width: 16px;
        height: 16px;
        background: #007AFF;
        border-radius: 50%;
        cursor: pointer;
        border: 2px solid #fff;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
      }
    `;
    if (!document.querySelector("#slider-styles")) {
      style.id = "slider-styles";
      document.head.appendChild(style);
    }

    slider.addEventListener("input", (e) => {
      const newValue = parseFloat(e.target.value);
      valueEl.textContent = `${newValue}${unit}`;
      this.updateSetting(key, newValue);
    });

    header.appendChild(labelEl);
    header.appendChild(valueEl);
    container.appendChild(header);
    container.appendChild(slider);

    return container;
  }

  _createCheckbox(label, key, checked) {
    const container = document.createElement("div");
    container.style.cssText =
      "margin-bottom: 12px; display: flex; align-items: center; gap: 8px;";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = checked;
    checkbox.style.cssText = `
      width: 16px;
      height: 16px;
      accent-color: #007AFF;
      cursor: pointer;
    `;

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    labelEl.style.cssText = `
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      cursor: pointer;
      user-select: none;
    `;

    checkbox.addEventListener("change", (e) => {
      this.updateSetting(key, e.target.checked);
    });

    labelEl.addEventListener("click", () => {
      checkbox.checked = !checkbox.checked;
      this.updateSetting(key, checkbox.checked);
    });

    container.appendChild(checkbox);
    container.appendChild(labelEl);

    return container;
  }

  _createDropdown(label, key, options, selected) {
    const container = document.createElement("div");
    container.style.cssText = "margin-bottom: 12px;";

    const labelEl = document.createElement("label");
    labelEl.textContent = label;
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
      appearance: none;
      background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='white' viewBox='0 0 16 16'%3e%3cpath d='m7.247 4.86-4.796 5.481c-.566.647-.106 1.659.753 1.659h9.592a1 1 0 0 0 .753-1.659l-4.796-5.48a1 1 0 0 0-1.506 0z'/%3e%3c/svg%3e");
      background-repeat: no-repeat;
      background-position: right 8px center;
      background-size: 12px;
      padding-right: 32px;
    `;

    options.forEach((option) => {
      const optionEl = document.createElement("option");
      optionEl.value = option;
      optionEl.textContent = option.charAt(0).toUpperCase() + option.slice(1);
      optionEl.selected = option === selected;
      optionEl.style.cssText = "background: #1c1c1e; color: #fff;";
      select.appendChild(optionEl);
    });

    select.addEventListener("change", (e) => {
      this.updateSetting(key, e.target.value);
    });

    container.appendChild(labelEl);
    container.appendChild(select);

    return container;
  }
}
