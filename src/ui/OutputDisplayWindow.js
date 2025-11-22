// src/ui/OutputDisplayWindow.js
import { makeDraggable } from './utils/draggable.js';

export class OutputDisplayWindow {
  constructor(options = {}) {
    this.onClose = options.onClose || (() => {});
    this.onLaunchExternalViewer = options.onLaunchExternalViewer || (() => {});

    this.window = null;
    this.keyHandler = null;
    this.cleanupDraggable = null;
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

    this.render();
  }

  hide() {
    if (!this.window) return;

    if (this.cleanupDraggable) {
      this.cleanupDraggable();
      this.cleanupDraggable = null;
    }

    if (this.keyHandler) {
      document.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }

    this.window.style.opacity = "0";
    this.window.style.transform = "translate(-50%, -50%) scale(0.95)";

    setTimeout(() => {
      if (this.window) {
        this.window.style.display = "none";
      }
      this.onClose();
    }, 200);
  }

  render() {
    this.window = document.createElement("div");
    this.window.id = "output-display-window";
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
    title.textContent = "Output Display";
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

    // Settings section
    const settingsSection = this._createSection("Display Settings", [
      this._createCheckbox("Start in Fullscreen", "fullscreen", false),
      this._createDropdown("Monitor", "monitor", [
        { value: "primary", label: "Primary Monitor" },
        { value: "secondary", label: "Secondary Monitor" },
        { value: "all", label: "All Monitors" }
      ], "primary")
    ]);
    content.appendChild(settingsSection);

    // Placeholder section
    const placeholder = document.createElement("div");
    placeholder.style.cssText = `
      background: rgba(0, 0, 0, 0.2);
      border: 1px dashed rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 40px 24px;
      margin-bottom: 20px;
      text-align: center;
      color: #888;
      font-size: 14px;
    `;
    placeholder.innerHTML = `
      <div style="margin-bottom: 8px; font-size: 16px; color: #aaa;">Output Display</div>
      <div style="font-size: 13px; color: #666;">Placeholder content will be added here</div>
    `;
    content.appendChild(placeholder);

    // Launch External Viewer button
    const launchBtn = document.createElement("button");
    launchBtn.textContent = "Open External Viewer";
    launchBtn.style.cssText = `
      width: 100%;
      padding: 12px 16px;
      background: rgba(102, 126, 234, 0.2);
      border: 1px solid rgba(102, 126, 234, 0.4);
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    `;
    launchBtn.onmouseenter = () => {
      launchBtn.style.background = "rgba(102, 126, 234, 0.3)";
      launchBtn.style.borderColor = "rgba(102, 126, 234, 0.6)";
    };
    launchBtn.onmouseleave = () => {
      launchBtn.style.background = "rgba(102, 126, 234, 0.2)";
      launchBtn.style.borderColor = "rgba(102, 126, 234, 0.4)";
    };
    launchBtn.onclick = async () => {
      if (this.onLaunchExternalViewer) {
        const fullscreenCheckbox = this.window.querySelector('#output-display-fullscreen');
        const monitorSelect = this.window.querySelector('#output-display-monitor');
        
        const options = {
          fullscreen: fullscreenCheckbox ? fullscreenCheckbox.checked : false,
          monitor: monitorSelect ? monitorSelect.value : 'primary'
        };
        
        await this.onLaunchExternalViewer(options);
      }
    };
    content.appendChild(launchBtn);

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

    // Close on Escape key
    this.keyHandler = (e) => {
      if (e.key === 'Escape' && this.window && this.window.style.display !== 'none') {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.keyHandler);
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

    controls.forEach(control => {
      section.appendChild(control);
    });

    return section;
  }

  _createCheckbox(label, id, checked) {
    const container = document.createElement("label");
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      cursor: pointer;
      color: #e8e8e8;
      font-size: 13px;
      user-select: none;
    `;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `output-display-${id}`;
    checkbox.checked = checked;
    checkbox.style.cssText = `
      width: 16px;
      height: 16px;
      cursor: pointer;
      accent-color: #007aff;
    `;

    const labelText = document.createElement("span");
    labelText.textContent = label;

    container.appendChild(checkbox);
    container.appendChild(labelText);

    return container;
  }

  _createDropdown(label, id, options, defaultValue) {
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
    labelEl.setAttribute("for", `output-display-${id}`);

    const select = document.createElement("select");
    select.id = `output-display-${id}`;
    select.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      color: #fff;
      font-size: 13px;
      cursor: pointer;
    `;

    options.forEach(option => {
      const optionEl = document.createElement("option");
      optionEl.value = typeof option === 'string' ? option : option.value;
      optionEl.textContent = typeof option === 'string' ? option : option.label;
      if (optionEl.value === defaultValue) {
        optionEl.selected = true;
      }
      select.appendChild(optionEl);
    });

    container.appendChild(labelEl);
    container.appendChild(select);

    return container;
  }
}

