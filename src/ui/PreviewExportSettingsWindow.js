/**
 * PreviewExportSettingsWindow.js - Movable window for Preview / Export Settings
 */

import { makeDraggable } from './utils/draggable.js';

export class PreviewExportSettingsWindow {
  constructor(floatingPreview) {
    this.floatingPreview = floatingPreview;
    // Use the same settings object as PreviewSettings - direct reference for synchronization
    if (floatingPreview?.settings?.settings) {
      this.settings = floatingPreview.settings.settings;
      // Initialize missing properties
      if (!this.settings.showGrid) this.settings.showGrid = false;
      if (this.settings.showNodePreviews === undefined) this.settings.showNodePreviews = true;
      if (!this.settings.antiAliasing) this.settings.antiAliasing = 2;
      if (this.settings.startFrame === undefined) this.settings.startFrame = 0;
      if (this.settings.endFrame === undefined) this.settings.endFrame = 60;
      if (this.settings.loop === undefined) this.settings.loop = true;
      if (this.settings.alphaChannel === undefined) this.settings.alphaChannel = false;
      if (!this.settings.compression) this.settings.compression = 90;
      if (!this.settings.aspectRatio) this.settings.aspectRatio = "16:9";
    } else {
      // Fallback if settings don't exist yet
      this.settings = {
        resolution: { width: 1920, height: 1080 },
        refreshRate: 60,
        wireframe: false,
        showGrid: false,
        showNodePreviews: true,
        quality: "high",
        antiAliasing: 2,
        startFrame: 0,
        endFrame: 60,
        fps: 30,
        loop: true,
        alphaChannel: false,
        compression: 90,
        aspectRatio: "16:9",
      };
    }
    this.window = null;
    this.cleanupDraggable = null;
    this._uiElements = {}; // Store UI element references for updates
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
    this.window.id = "preview-export-settings-window";
    this.window.style.cssText = `
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
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

    // Display Options Section
    content.appendChild(this._createSection("Display Options", [
      this._createCheckbox("Show Grid", "showGrid", this.settings.showGrid || false),
      this._createCheckbox("Show Wireframe", "wireframe", this.settings.wireframe || false),
      this._createCheckbox("Show Node Previews", "showNodePreviews", this.settings.showNodePreviews !== false),
    ]));

    // Resolution / Aspect Ratio Section
    content.appendChild(this._createResolutionSection());

    // Animation Settings Section
    content.appendChild(this._createAnimationSection());

    // Export / Publish Section
    content.appendChild(this._createExportSection());

    // Advanced Settings Section
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
    checkbox.setAttribute('data-key', key); // For syncing
    checkbox.style.cssText = `
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: #007aff;
    `;

    const labelEl = document.createElement("span");
    labelEl.textContent = label;

    checkbox.setAttribute('data-setting-key', key); // For syncing
    
    checkbox.addEventListener("change", (e) => {
      // Update settings directly (they're shared with PreviewSettings)
      this.settings[key] = e.target.checked;
      // Notify PreviewSettings to apply the change (this will also sync UI)
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting(key, e.target.checked);
      }
    });

    container.appendChild(checkbox);
    container.appendChild(labelEl);

    return container;
  }

  _createResolutionSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "Resolution / Aspect Ratio";
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    // Aspect Ratio Dropdown
    const aspectRatioContainer = document.createElement("div");
    aspectRatioContainer.style.cssText = "margin-bottom: 12px;";
    
    const aspectRatioLabel = document.createElement("label");
    aspectRatioLabel.textContent = "Aspect Ratio:";
    aspectRatioLabel.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const aspectRatioSelect = document.createElement("select");
    aspectRatioSelect.id = "settings-aspect-ratio";
    aspectRatioSelect.style.cssText = `
      width: 100%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
    `;

    ["1:1", "4:3", "16:9", "21:9", "custom"].forEach((ratio) => {
      const option = document.createElement("option");
      option.value = ratio;
      option.textContent = ratio === "custom" ? "Custom" : ratio;
      option.selected = this.settings.aspectRatio === ratio;
      aspectRatioSelect.appendChild(option);
    });

    const customResolutionContainer = document.createElement("div");
    customResolutionContainer.id = "custom-resolution-inputs";
    customResolutionContainer.style.cssText = `
      display: ${this.settings.aspectRatio === "custom" ? "flex" : "none"};
      gap: 8px;
      margin-top: 8px;
    `;

    const widthInput = document.createElement("input");
    widthInput.type = "number";
    widthInput.placeholder = "Width";
    widthInput.value = this.settings.resolution?.width || 1920;
    widthInput.min = 128;
    widthInput.max = 7680;
    widthInput.id = "settings-resolution-width";
    widthInput.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      border-radius: 4px;
      font-size: 12px;
    `;

    const heightInput = document.createElement("input");
    heightInput.type = "number";
    heightInput.placeholder = "Height";
    heightInput.value = this.settings.resolution?.height || 1080;
    heightInput.min = 128;
    heightInput.max = 4320;
    heightInput.id = "settings-resolution-height";
    heightInput.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      border-radius: 4px;
      font-size: 12px;
    `;

    customResolutionContainer.appendChild(widthInput);
    customResolutionContainer.appendChild(heightInput);

    aspectRatioSelect.addEventListener("change", (e) => {
      const ratio = e.target.value;
      this.settings.aspectRatio = ratio;
      
      if (ratio === "custom") {
        customResolutionContainer.style.display = "flex";
      } else {
        customResolutionContainer.style.display = "none";
        const preset = this.aspectRatioPresets[ratio];
        if (preset) {
          this.settings.resolution.width = preset.width;
          this.settings.resolution.height = preset.height;
          widthInput.value = preset.width;
          heightInput.value = preset.height;
          if (this.floatingPreview?.settings?.updateSetting) {
            this.floatingPreview.settings.updateSetting("resolution.width", preset.width);
            this.floatingPreview.settings.updateSetting("resolution.height", preset.height);
          }
        }
      }
    });

    widthInput.addEventListener("change", (e) => {
      const width = parseInt(e.target.value) || 1920;
      this.settings.resolution.width = width;
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting("resolution.width", width);
      }
    });

    heightInput.addEventListener("change", (e) => {
      const height = parseInt(e.target.value) || 1080;
      this.settings.resolution.height = height;
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting("resolution.height", height);
      }
    });

    aspectRatioContainer.appendChild(aspectRatioLabel);
    aspectRatioContainer.appendChild(aspectRatioSelect);
    aspectRatioContainer.appendChild(customResolutionContainer);
    section.appendChild(aspectRatioContainer);

    // Resolution Presets
    const resolutionContainer = document.createElement("div");
    resolutionContainer.style.cssText = "margin-bottom: 12px;";
    
    const resolutionLabel = document.createElement("label");
    resolutionLabel.textContent = "Resolution Preset:";
    resolutionLabel.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const resolutionSelect = document.createElement("select");
    resolutionSelect.id = "settings-resolution-preset";
    resolutionSelect.style.cssText = `
      width: 100%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
    `;

    const currentRes = this.settings.resolution || { width: 1920, height: 1080 };
    let selectedPreset = "custom";
    Object.keys(this.resolutionPresets).forEach((preset) => {
      if (preset !== "custom") {
        const p = this.resolutionPresets[preset];
        if (currentRes.width === p.width && currentRes.height === p.height) {
          selectedPreset = preset;
        }
      }
    });

    ["720p", "1080p", "1440p", "2K", "4K", "5K", "8K", "custom"].forEach((preset) => {
      const option = document.createElement("option");
      option.value = preset;
      option.textContent = preset === "custom" ? "Custom" : preset;
      option.selected = preset === selectedPreset;
      resolutionSelect.appendChild(option);
    });

    const customResInputs = document.createElement("div");
    customResInputs.id = "custom-res-inputs";
    customResInputs.style.cssText = `
      display: ${selectedPreset === "custom" ? "flex" : "none"};
      gap: 8px;
      margin-top: 8px;
    `;

    const resWidthInput = document.createElement("input");
    resWidthInput.type = "number";
    resWidthInput.placeholder = "Width";
    resWidthInput.value = currentRes.width || 1920;
    resWidthInput.min = 128;
    resWidthInput.max = 7680;
    resWidthInput.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      border-radius: 4px;
      font-size: 12px;
    `;

    const resHeightInput = document.createElement("input");
    resHeightInput.type = "number";
    resHeightInput.placeholder = "Height";
    resHeightInput.value = currentRes.height || 1080;
    resHeightInput.min = 128;
    resHeightInput.max = 4320;
    resHeightInput.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      border-radius: 4px;
      font-size: 12px;
    `;

    customResInputs.appendChild(resWidthInput);
    customResInputs.appendChild(resHeightInput);

    resolutionSelect.addEventListener("change", (e) => {
      const preset = e.target.value;
      
      if (preset === "custom") {
        customResInputs.style.display = "flex";
      } else {
        customResInputs.style.display = "none";
        const res = this.resolutionPresets[preset];
        if (res) {
          this.settings.resolution.width = res.width;
          this.settings.resolution.height = res.height;
          resWidthInput.value = res.width;
          resHeightInput.value = res.height;
          widthInput.value = res.width;
          heightInput.value = res.height;
          if (this.floatingPreview?.settings?.updateSetting) {
            this.floatingPreview.settings.updateSetting("resolution.width", res.width);
            this.floatingPreview.settings.updateSetting("resolution.height", res.height);
          }
        }
      }
    });

    resWidthInput.addEventListener("change", (e) => {
      const width = parseInt(e.target.value) || 1920;
      this.settings.resolution.width = width;
      widthInput.value = width;
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting("resolution.width", width);
      }
    });

    resHeightInput.addEventListener("change", (e) => {
      const height = parseInt(e.target.value) || 1080;
      this.settings.resolution.height = height;
      heightInput.value = height;
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting("resolution.height", height);
      }
    });

    resolutionContainer.appendChild(resolutionLabel);
    resolutionContainer.appendChild(resolutionSelect);
    resolutionContainer.appendChild(customResInputs);
    section.appendChild(resolutionContainer);

    // Anti-Aliasing Slider
    const aaContainer = document.createElement("div");
    aaContainer.style.cssText = "margin-bottom: 12px;";
    
    const aaLabel = document.createElement("label");
    aaLabel.textContent = "Sampling / Anti-Aliasing:";
    aaLabel.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const aaSlider = document.createElement("input");
    aaSlider.type = "range";
    aaSlider.min = "0";
    aaSlider.max = "3";
    aaSlider.step = "1";
    aaSlider.value = this._aaToSlider(this.settings.antiAliasing || 2);
    aaSlider.style.cssText = `
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      outline: none;
      border-radius: 2px;
      appearance: none;
      cursor: pointer;
      margin-bottom: 4px;
    `;

    const aaValue = document.createElement("div");
    aaValue.id = "aa-value";
    aaValue.textContent = this._formatAA(this.settings.antiAliasing || 2);
    aaValue.style.cssText = `
      text-align: center;
      color: #aaa;
      font-size: 11px;
      margin-top: 4px;
    `;

    aaSlider.addEventListener("input", (e) => {
      const aa = this._sliderToAA(parseInt(e.target.value));
      aaValue.textContent = this._formatAA(aa);
      this.settings.antiAliasing = aa;
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting("antiAliasing", aa);
      }
    });

    aaContainer.appendChild(aaLabel);
    aaContainer.appendChild(aaSlider);
    aaContainer.appendChild(aaValue);
    section.appendChild(aaContainer);

    return section;
  }

  _aaToSlider(aa) {
    if (aa === 0) return 0;
    if (aa === 2) return 1;
    if (aa === 4) return 2;
    if (aa === 8) return 3;
    return 1; // Default to 2x
  }

  _sliderToAA(slider) {
    if (slider === 0) return 0;
    if (slider === 1) return 2;
    if (slider === 2) return 4;
    if (slider === 3) return 8;
    return 2;
  }

  _formatAA(aa) {
    if (aa === 0) return "Off";
    return `${aa}x`;
  }

  _createAnimationSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "Animation Settings";
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    // Start Frame
    const startFrameContainer = document.createElement("div");
    startFrameContainer.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
    
    const startFrameLabel = document.createElement("label");
    startFrameLabel.textContent = "Start Frame:";
    startFrameLabel.style.cssText = "color: rgba(255, 255, 255, 0.8); font-size: 12px; min-width: 100px;";

    const startFrameInput = document.createElement("input");
    startFrameInput.type = "number";
    startFrameInput.value = this.settings.startFrame || 0;
    startFrameInput.min = 0;
    startFrameInput.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      border-radius: 4px;
      font-size: 12px;
    `;

    startFrameContainer.appendChild(startFrameLabel);
    startFrameContainer.appendChild(startFrameInput);
    section.appendChild(startFrameContainer);

    // End Frame
    const endFrameContainer = document.createElement("div");
    endFrameContainer.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
    
    const endFrameLabel = document.createElement("label");
    endFrameLabel.textContent = "End Frame:";
    endFrameLabel.style.cssText = "color: rgba(255, 255, 255, 0.8); font-size: 12px; min-width: 100px;";

    const endFrameInput = document.createElement("input");
    endFrameInput.type = "number";
    endFrameInput.value = this.settings.endFrame || 60;
    endFrameInput.min = 1;
    endFrameInput.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      border-radius: 4px;
      font-size: 12px;
    `;

    endFrameContainer.appendChild(endFrameLabel);
    endFrameContainer.appendChild(endFrameInput);
    section.appendChild(endFrameContainer);

    // FPS (uses refreshRate in shared settings object)
    const fpsContainer = document.createElement("div");
    fpsContainer.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";
    
    const fpsLabel = document.createElement("label");
    fpsLabel.textContent = "FPS:";
    fpsLabel.style.cssText = "color: rgba(255, 255, 255, 0.8); font-size: 12px; min-width: 100px;";

    const fpsInput = document.createElement("input");
    fpsInput.type = "number";
    fpsInput.id = "animation-fps-input";
    // Store data attribute for synchronization (using refreshRate key)
    fpsInput.setAttribute('data-setting-key', 'refreshRate');
    // Use refreshRate from shared settings object (not fps)
    fpsInput.value = this.settings.refreshRate || 30;
    fpsInput.min = 1;
    fpsInput.max = 120;
    fpsInput.style.cssText = `
      flex: 1;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      border-radius: 4px;
      font-size: 12px;
    `;

    fpsContainer.appendChild(fpsLabel);
    fpsContainer.appendChild(fpsInput);
    section.appendChild(fpsContainer);

    // Loop toggle
    section.appendChild(this._createCheckbox("Loop / Play Options", "loop", this.settings.loop !== false));

    // Event handlers
    startFrameInput.addEventListener("change", (e) => {
      const value = parseInt(e.target.value) || 0;
      this.settings.startFrame = value;
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting("startFrame", value);
      }
    });

    endFrameInput.addEventListener("change", (e) => {
      const value = parseInt(e.target.value) || 60;
      this.settings.endFrame = value;
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting("endFrame", value);
      }
    });

    fpsInput.addEventListener("change", (e) => {
      const value = parseInt(e.target.value) || 30;
      // Update refreshRate in shared settings object (consistent with PreviewSettings)
      this.settings.refreshRate = value;
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting("refreshRate", value);
      }
    });

    return section;
  }

  _createExportSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "Export / Publish";
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    const buttonsContainer = document.createElement("div");
    buttonsContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

    const exportPngBtn = this._createButton("Export as PNG", async () => {
      if (this.floatingPreview?.settings?._exportPNG) {
        await this.floatingPreview.settings._exportPNG();
      }
    });

    const exportAnimBtn = this._createButton("Export Animation (MP4/WebM)", async () => {
      if (this.floatingPreview?.settings?._exportAnimation) {
        await this.floatingPreview.settings._exportAnimation();
      }
    });

    const publishImageBtn = this._createButton("Publish Image to TenderWorld", async () => {
      if (this.floatingPreview?.settings?._publishImage) {
        await this.floatingPreview.settings._publishImage();
      }
    }, true);

    const publishAnimBtn = this._createButton("Publish Animation to TenderWorld", async () => {
      if (this.floatingPreview?.settings?._publishAnimation) {
        await this.floatingPreview.settings._publishAnimation();
      }
    }, true);

    buttonsContainer.appendChild(exportPngBtn);
    buttonsContainer.appendChild(exportAnimBtn);
    buttonsContainer.appendChild(publishImageBtn);
    buttonsContainer.appendChild(publishAnimBtn);

    section.appendChild(buttonsContainer);
    return section;
  }

  _createAdvancedSection() {
    const section = document.createElement("div");
    section.style.cssText = "margin-bottom: 20px;";

    const sectionTitle = document.createElement("div");
    sectionTitle.textContent = "Advanced / Optional Settings";
    sectionTitle.style.cssText = `
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    `;
    section.appendChild(sectionTitle);

    section.appendChild(this._createCheckbox("Alpha Channel", "alphaChannel", this.settings.alphaChannel || false));

    // Compression Level
    const compressionContainer = document.createElement("div");
    compressionContainer.style.cssText = "margin-bottom: 12px;";
    
    const compressionLabel = document.createElement("label");
    compressionLabel.textContent = "Compression Level:";
    compressionLabel.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const compressionSlider = document.createElement("input");
    compressionSlider.type = "range";
    compressionSlider.min = "0";
    compressionSlider.max = "100";
    compressionSlider.step = "1";
    compressionSlider.value = this.settings.compression || 90;
    compressionSlider.id = "compression-slider";
    compressionSlider.style.cssText = `
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.2);
      outline: none;
      border-radius: 2px;
      appearance: none;
      cursor: pointer;
      margin-bottom: 4px;
    `;

    const compressionValue = document.createElement("div");
    compressionValue.id = "compression-value";
    compressionValue.textContent = `${this.settings.compression || 90}%`;
    compressionValue.style.cssText = `
      text-align: center;
      color: #aaa;
      font-size: 11px;
      margin-top: 4px;
    `;

    compressionSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      compressionValue.textContent = `${value}%`;
      this.settings.compression = value;
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting("compression", value);
      }
    });

    compressionContainer.appendChild(compressionLabel);
    compressionContainer.appendChild(compressionSlider);
    compressionContainer.appendChild(compressionValue);
    section.appendChild(compressionContainer);

    // GPU Precision
    const gpuContainer = document.createElement("div");
    gpuContainer.style.cssText = "margin-bottom: 12px;";
    
    const gpuLabel = document.createElement("label");
    gpuLabel.textContent = "GPU / Render Options:";
    gpuLabel.style.cssText = `
      display: block;
      color: rgba(255, 255, 255, 0.8);
      font-size: 12px;
      margin-bottom: 6px;
    `;

    const gpuSelect = document.createElement("select");
    gpuSelect.style.cssText = `
      width: 100%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
    `;

    ["low", "medium", "high"].forEach((quality) => {
      const option = document.createElement("option");
      option.value = quality;
      option.textContent = quality === "low" ? "Low Precision" : quality === "medium" ? "Medium Precision" : "High Precision";
      option.selected = (this.settings.quality || "high") === quality;
      gpuSelect.appendChild(option);
    });

    gpuSelect.addEventListener("change", (e) => {
      this.settings.quality = e.target.value;
      if (this.floatingPreview?.settings?.updateSetting) {
        this.floatingPreview.settings.updateSetting("quality", e.target.value);
      }
    });

    gpuContainer.appendChild(gpuLabel);
    gpuContainer.appendChild(gpuSelect);
    section.appendChild(gpuContainer);

    // Reset Button
    const resetBtn = this._createButton("Reset to Default Settings", () => {
      this._resetToDefaults();
    }, false, true);

    section.appendChild(resetBtn);

    return section;
  }

  _createButton(label, onClick, primary = false, reset = false) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.cssText = `
      width: 100%;
      padding: ${reset ? "8px 12px" : "10px 12px"};
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

  _resetToDefaults() {
    const defaults = {
      resolution: { width: 1920, height: 1080 },
      refreshRate: 60, // Use refreshRate (not fps) for consistency with PreviewSettings
      wireframe: false,
      showGrid: false,
      showNodePreviews: true,
      quality: "high",
      antiAliasing: 2,
      startFrame: 0,
      endFrame: 60,
      loop: true,
      alphaChannel: false,
      compression: 90,
      aspectRatio: "16:9",
    };

    Object.keys(defaults).forEach((key) => {
      if (key === "resolution") {
        this.settings.resolution = { ...defaults[key] };
        if (this.floatingPreview?.settings) {
          this.floatingPreview.settings.updateSetting("resolution.width", defaults[key].width);
          this.floatingPreview.settings.updateSetting("resolution.height", defaults[key].height);
        }
      } else {
        this.settings[key] = defaults[key];
        if (this.floatingPreview?.settings) {
          this.floatingPreview.settings.updateSetting(key, defaults[key]);
        }
      }
    });

    // Refresh the window
    this.hide();
    setTimeout(() => this.show(), 250);
  }

  _syncUIElement(key, value) {
    // Update UI elements when settings change from PreviewSettings panel
    if (!this.window) return;
    
    // Update checkboxes
    if (key === 'showGrid' || key === 'wireframe' || key === 'showNodePreviews' || key === 'loop' || key === 'alphaChannel') {
      // Find checkboxes by looking for their labels or data attributes
      const checkboxes = this.window.querySelectorAll(`input[type="checkbox"]`);
      checkboxes.forEach(cb => {
        const label = cb.closest('label');
        if (label) {
          const labelText = label.textContent.toLowerCase();
          if ((key === 'showGrid' && labelText.includes('show grid')) ||
              (key === 'wireframe' && labelText.includes('wireframe')) ||
              (key === 'showNodePreviews' && labelText.includes('node previews')) ||
              (key === 'loop' && labelText.includes('loop')) ||
              (key === 'alphaChannel' && labelText.includes('alpha channel'))) {
            if (cb.checked !== !!value) {
              cb.checked = !!value;
            }
          }
        }
      });
    }
    
    // Update resolution inputs
    if (key === 'resolution.width') {
      const widthInputs = this.window.querySelectorAll('input[placeholder="Width"]');
      widthInputs.forEach(input => {
        if (input.value !== String(value)) {
          input.value = value;
        }
      });
    }
    
    if (key === 'resolution.height') {
      const heightInputs = this.window.querySelectorAll('input[placeholder="Height"]');
      heightInputs.forEach(input => {
        if (input.value !== String(value)) {
          input.value = value;
        }
      });
    }
    
    // Update anti-aliasing slider
    if (key === 'antiAliasing') {
      const aaSlider = Array.from(this.window.querySelectorAll('input[type="range"]'))
        .find(slider => slider.id !== 'compression-slider' && slider.value !== undefined);
      if (aaSlider) {
        const sliderValue = this._aaToSlider(value);
        if (aaSlider.value !== String(sliderValue)) {
          aaSlider.value = sliderValue;
          const aaValue = this.window.querySelector('#aa-value');
          if (aaValue) {
            aaValue.textContent = this._formatAA(value);
          }
        }
      }
    }
    
    // Update quality dropdown
    if (key === 'quality') {
      const selectElements = this.window.querySelectorAll('select');
      selectElements.forEach(select => {
        const options = Array.from(select.options).map(opt => opt.value.toLowerCase());
        if (options.includes(value.toLowerCase()) && select.value !== value) {
          select.value = value;
        }
      });
    }
  }

  // Store aspect ratio and resolution presets
  get aspectRatioPresets() {
    return {
      "1:1": { ratio: 1, width: 1080, height: 1080 },
      "4:3": { ratio: 4/3, width: 1440, height: 1080 },
      "16:9": { ratio: 16/9, width: 1920, height: 1080 },
      "21:9": { ratio: 21/9, width: 2560, height: 1080 },
      "custom": { ratio: null, width: 1920, height: 1080 },
    };
  }

  get resolutionPresets() {
    return {
      "720p": { width: 1280, height: 720 },
      "1080p": { width: 1920, height: 1080 },
      "1440p": { width: 2560, height: 1440 },
      "2K": { width: 2048, height: 1080 },
      "4K": { width: 3840, height: 2160 },
      "5K": { width: 5120, height: 2880 },
      "8K": { width: 7680, height: 4320 },
      "custom": { width: null, height: null },
    };
  }
}
