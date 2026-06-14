// src/ui/OutputDisplayWindow.js
import { makeDraggable } from './utils/draggable.js';

export class OutputDisplayWindow {
  constructor(options = {}) {
    this.onClose = options.onClose || (() => {});
    this.onLaunchExternalViewer = options.onLaunchExternalViewer || (() => {});
    this.onStopExternalViewer = options.onStopExternalViewer || (() => {});

    // Shared ExternalViewerManager (screen detection + window placement). When
    // provided, the monitor dropdown maps 1:1 to the displays the viewer can
    // open on, so the chosen monitor is honoured reliably.
    this.manager = options.manager || null;

    this.window = null;
    this.keyHandler = null;
    this.cleanupDraggable = null;
    this.detectedMonitors = [];
    this.viewerActive = false;
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
    title.textContent = "External Viewer";
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

    // Launch / Stop External Viewer button (toggles based on viewer state)
    const launchBtn = document.createElement("button");
    launchBtn.id = "output-display-launch";
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
      margin-top: 8px;
    `;
    launchBtn.onmouseenter = () => {
      if (this.viewerActive) {
        launchBtn.style.background = "rgba(220, 70, 70, 0.32)";
        launchBtn.style.borderColor = "rgba(220, 70, 70, 0.7)";
      } else {
        launchBtn.style.background = "rgba(102, 126, 234, 0.3)";
        launchBtn.style.borderColor = "rgba(102, 126, 234, 0.6)";
      }
    };
    launchBtn.onmouseleave = () => {
      this._applyLaunchButtonStyle(launchBtn);
    };
    launchBtn.onclick = async () => {
      if (this.viewerActive) {
        this.onStopExternalViewer();
        return;
      }
      await this.onLaunchExternalViewer(this.getLaunchOptions());
    };

    // Settings section with controls + button
    const settingsSection = this._createSection("External Viewer (Second Monitor)", [
      this._createMonitorDropdown("Display", "monitor"),
      this._createCheckbox("Start in fullscreen", "fullscreen", true),
      this._createCheckbox("Hide viewer UI (clean output)", "hideui", true),
      launchBtn
    ]);
    content.appendChild(settingsSection);
    
    // Detect monitors
    this.detectMonitors().then(() => {
      this.updateMonitorDropdown();
    });

    // Help / info section
    const info = document.createElement("div");
    info.style.cssText = `
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      padding: 16px 18px;
      margin-bottom: 12px;
      color: #aaa;
      font-size: 12.5px;
      line-height: 1.6;
    `;
    info.innerHTML = `
      <div style="color: #ddd; font-weight: 600; margin-bottom: 8px;">How it works</div>
      Opens a separate viewer window that renders the live shader at 60&nbsp;FPS
      on the selected display — ideal for a projector or second monitor.
      It streams over the same browser (no server needed).
      <div style="margin-top: 10px; color: #888;">
        In the viewer: <strong style="color:#bbb;">F</strong> toggles fullscreen,
        <strong style="color:#bbb;">H</strong> hides the UI.
        If the browser blocks auto-fullscreen, just click the viewer once.
      </div>
    `;
    content.appendChild(info);

    this.window.appendChild(header);
    this.window.appendChild(content);
    document.body.appendChild(this.window);

    // Reflect current viewer state on the freshly-created Launch/Stop button.
    this.setViewerActive(this.viewerActive);

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

  async detectMonitors() {
    // Prefer the shared ExternalViewerManager so the dropdown maps 1:1 to the
    // displays the viewer window can actually open on.
    if (this.manager && typeof this.manager.detectScreens === 'function') {
      try {
        const screens = await this.manager.detectScreens();
        this.detectedMonitors = [
          { value: 'auto', label: 'Auto — second display if available' },
          ...screens.map(s => ({ value: s.id, label: s.label }))
        ];
        return;
      } catch (e) {
        console.warn('[OutputDisplayWindow] Screen detection via manager failed:', e);
      }
    }

    try {
      // Try to use Screen Details API (Chrome/Edge)
      if ('getScreenDetails' in window.screen) {
        const screenDetails = await window.screen.getScreenDetails();
        this.detectedMonitors = [];
        
        // Add primary screen
        this.detectedMonitors.push({
          value: 'primary',
          label: `Primary Monitor (${screen.width}x${screen.height})`
        });
        
        // Add other screens
        for (let i = 0; i < screenDetails.screens.length; i++) {
          const scr = screenDetails.screens[i];
          if (scr !== screenDetails.currentScreen) {
            this.detectedMonitors.push({
              value: `monitor_${i}`,
              label: `Monitor ${i + 1} (${scr.width}x${scr.height})`
            });
          }
        }
        
        return;
      }
      
      // Fallback: Try to detect via backend API
      try {
        const response = await fetch('/api/detect-monitors', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.monitors && Array.isArray(data.monitors)) {
            this.detectedMonitors = data.monitors.map((mon, idx) => ({
              value: `monitor_${idx}`,
              label: mon.label || `Monitor ${idx + 1} (${mon.width}x${mon.height})`
            }));
            return;
          }
        }
      } catch (e) {
        console.warn('[OutputDisplayWindow] Could not detect monitors via API:', e);
      }
      
      // Final fallback: Use basic screen info
      this.detectedMonitors = [
        { value: 'primary', label: `Primary Monitor (${screen.width}x${screen.height})` },
        { value: 'secondary', label: 'Secondary Monitor' },
        { value: 'all', label: 'All Monitors' }
      ];
    } catch (error) {
      console.warn('[OutputDisplayWindow] Monitor detection failed:', error);
      // Fallback to basic options
      this.detectedMonitors = [
        { value: 'primary', label: 'Primary Monitor' },
        { value: 'secondary', label: 'Secondary Monitor' },
        { value: 'all', label: 'All Monitors' }
      ];
    }
  }

  _createMonitorDropdown(label, id) {
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

    // Initial options (will be updated when monitors are detected)
    const initialOptions = [
      { value: "primary", label: "Detecting monitors..." }
    ];
    
    initialOptions.forEach(option => {
      const optionEl = document.createElement("option");
      optionEl.value = option.value;
      optionEl.textContent = option.label;
      select.appendChild(optionEl);
    });

    container.appendChild(labelEl);
    container.appendChild(select);

    return container;
  }

  updateMonitorDropdown() {
    const select = this.window?.querySelector('#output-display-monitor');
    if (!select) return;

    // Clear existing options
    select.innerHTML = '';

    // Add detected monitors
    if (this.detectedMonitors.length > 0) {
      this.detectedMonitors.forEach((monitor, index) => {
        const optionEl = document.createElement("option");
        optionEl.value = monitor.value;
        optionEl.textContent = monitor.label;
        // Default to the first option ('Auto' when present, else the first display).
        if (index === 0) {
          optionEl.selected = true;
        }
        select.appendChild(optionEl);
      });
    } else {
      // Fallback if detection failed
      const fallback = document.createElement("option");
      fallback.value = "primary";
      fallback.textContent = "Primary Monitor";
      fallback.selected = true;
      select.appendChild(fallback);
    }
  }

  /**
   * Current launch settings from the controls. Safe to call before the window
   * has been rendered — returns sensible defaults (auto display, fullscreen).
   * @returns {{ monitor: string, fullscreen: boolean, hideUI: boolean }}
   */
  getLaunchOptions() {
    const fullscreenCheckbox = this.window?.querySelector('#output-display-fullscreen');
    const hideUICheckbox = this.window?.querySelector('#output-display-hideui');
    const monitorSelect = this.window?.querySelector('#output-display-monitor');

    return {
      monitor: monitorSelect ? monitorSelect.value : 'auto',
      fullscreen: fullscreenCheckbox ? fullscreenCheckbox.checked : true,
      hideUI: hideUICheckbox ? hideUICheckbox.checked : true
    };
  }

  /** Reflect the viewer's running state on the Launch/Stop button. */
  setViewerActive(active) {
    this.viewerActive = !!active;
    const btn = this.window?.querySelector('#output-display-launch');
    if (btn) {
      btn.textContent = this.viewerActive ? "Stop External Viewer" : "Open External Viewer";
      this._applyLaunchButtonStyle(btn);
    }
  }

  /** Apply the resting (non-hover) style for the Launch/Stop button. */
  _applyLaunchButtonStyle(btn) {
    if (this.viewerActive) {
      btn.style.background = "rgba(220, 70, 70, 0.22)";
      btn.style.borderColor = "rgba(220, 70, 70, 0.5)";
    } else {
      btn.style.background = "rgba(102, 126, 234, 0.2)";
      btn.style.borderColor = "rgba(102, 126, 234, 0.4)";
    }
  }
}

