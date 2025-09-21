import { PreviewSettings } from "./PreviewSettings.js";

export class FloatingGPUPreview {
  constructor(gpuCanvas) {
    this.gpuCanvas = gpuCanvas;
    this.container = null;
    this.isVisible = false;
    this.isFullscreen = false;
    this.isDragging = false;
    this.isLocked = false;
    this.isDocked = false;
    this.isResizing = false;
    this.position = { x: 20, y: 60 };
    this.previewScale = 0.5;
    this.originalCanvasParent = gpuCanvas.parentNode;
    this.originalCanvasStyles = {
      position: gpuCanvas.style.position,
      width: gpuCanvas.style.width,
      height: gpuCanvas.style.height,
      zIndex: gpuCanvas.style.zIndex,
    };

    this.settings = new PreviewSettings(this);
    this.fpsCounter = new FPSCounter();
  }

  updateSize() {
    if (!this.container || this.isFullscreen) return;

    const { width, height } = this.settings.settings.resolution;
    const headerHeight = 37;
    const padding = 20;

    if (this.isDocked) {
      const dockedScale = 0.3;
      const dockedWidth = width * dockedScale;
      const dockedHeight = height * dockedScale;

      this.container.style.width = dockedWidth + padding + "px";
      this.container.style.height =
        dockedHeight + headerHeight + padding + "px";
    } else {
      const displayWidth = width * this.previewScale;
      const displayHeight = height * this.previewScale;

      this.container.style.width = displayWidth + padding + "px";
      this.container.style.height =
        displayHeight + headerHeight + padding + "px";
    }

    this.gpuCanvas.width = width;
    this.gpuCanvas.height = height;

    this._updateTitle();

    // Move settings panel IMMEDIATELY with NO delay
    if (this.settings.settingsPanel) {
      this.settings._positionSettingsPanel();
    }

    if (window.rebuild) {
      window.rebuild();
    }
  }

  // Replace your FloatingGPUPreview show() and hide() methods with these original working versions:

  show() {
    if (this.isVisible) return;

    this.container = this._createContainer();

    if (this.isDocked) {
      this._dockToWindow();
    } else {
      document.body.appendChild(this.container);
    }

    // Move the actual WebGPU canvas to the preview window
    const canvasWrapper = this.container.querySelector(
      ".preview-canvas-wrapper",
    );
    canvasWrapper.appendChild(this.gpuCanvas);

    this.gpuCanvas.style.width = "100%";
    this.gpuCanvas.style.height = "100%";
    this.gpuCanvas.style.position = "relative";
    this.gpuCanvas.style.zIndex = "auto";

    this.updateSize();
    this._setupDragging();

    if (this.isDocked) {
      this._setupDockedResize();
    }

    this.isVisible = true;

    if (this.settings.settings.showFPS) {
      this.fpsCounter.start();
    }

    requestAnimationFrame(() => {
      this.container.style.opacity = "1";
      this.container.style.transform = "scale(1)";
    });
  }

  hide() {
    if (!this.isVisible || !this.container) return;

    this.fpsCounter.stop();

    // Move the canvas back to its original container
    const originalContainer = document.querySelector(".canvas-wrapper");
    if (originalContainer && this.gpuCanvas) {
      originalContainer.appendChild(this.gpuCanvas);

      // Reset canvas styles
      this.gpuCanvas.style.width = "100%";
      this.gpuCanvas.style.height = "100%";
      this.gpuCanvas.style.position = "";
      this.gpuCanvas.style.zIndex = "";
    }

    this.container.style.opacity = "0";
    this.container.style.transform = "scale(0.95)";

    setTimeout(() => {
      if (this.container && this.container.parentNode) {
        this.container.parentNode.removeChild(this.container);
      }
      this.container = null;
      this.isVisible = false;
    }, 200);
  }

  toggle() {
    this.isVisible ? this.hide() : this.show();
  }

  toggleDocked() {
    this.isDocked = !this.isDocked;

    if (this.isVisible) {
      this.hide();
      setTimeout(() => this.show(), 250);
    }
  }

  toggleFullscreen() {
    if (!this.isVisible || this.isDocked) return;

    this.isFullscreen = !this.isFullscreen;
    const btn = this.container.querySelector(".btn-fullscreen");

    if (this.isFullscreen) {
      this.originalFullscreenSize = {
        width: this.gpuCanvas.width,
        height: this.gpuCanvas.height,
      };

      this.gpuCanvas.width = window.innerWidth;
      this.gpuCanvas.height = window.innerHeight;

      this.container.style.cssText +=
        ";position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;border-radius:0!important;";
      btn.textContent = "Exit FS";
    } else {
      if (this.originalFullscreenSize) {
        this.gpuCanvas.width = this.originalFullscreenSize.width;
        this.gpuCanvas.height = this.originalFullscreenSize.height;
      }

      this.container.style.cssText = this.container.style.cssText.replace(
        /;position:fixed!important.*?border-radius:0!important;/,
        "",
      );
      btn.textContent = "Fullscreen";
      this.updateSize();
    }

    if (window.rebuild) {
      window.rebuild();
    }
  }

  toggleLock() {
    if (!this.isVisible || this.isDocked) return;

    this.isLocked = !this.isLocked;
    const lockBtn = this.container.querySelector(".btn-lock");

    if (this.isLocked) {
      lockBtn.textContent = "Locked";
      this.container.style.pointerEvents = "none";
      this.container.querySelector(".preview-header").style.pointerEvents =
        "auto";
      this.container.style.opacity = "0.7";
    } else {
      lockBtn.textContent = "Unlocked";
      this.container.style.pointerEvents = "auto";
      this.container.style.opacity = "1";
    }
  }

  _updateTitle() {
    const title = this.container?.querySelector(".preview-title");
    if (title) {
      const { width, height } = this.settings.settings.resolution;
      const scale = this.isDocked
        ? "Docked"
        : `${Math.round(this.previewScale * 100)}%`;
      title.textContent = `Preview ${width}×${height} (${scale})`;
    }
  }

  _dockToWindow() {
    const { width, height } = this.settings.settings.resolution;
    const dockedScale = 0.3;
    const headerHeight = 37;
    const padding = 20;

    this.container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: ${width * dockedScale + padding}px;
      height: ${height * dockedScale + headerHeight + padding}px;
      background: rgba(20, 20, 22, 0.95);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      z-index: 500;
      overflow: hidden;
      opacity: 0;
      transform: scale(0.95);
      transition: opacity 0.2s ease, transform 0.2s ease;
      min-width: 200px;
      min-height: 150px;
    `;

    document.body.appendChild(this.container);
  }

  _createContainer() {
    const { width, height } = this.settings.settings.resolution;
    const headerHeight = 37;
    const padding = 20;
    const displayWidth = width * this.previewScale;
    const displayHeight = height * this.previewScale;

    const container = document.createElement("div");
    container.className = "floating-gpu-preview";

    if (!this.isDocked) {
      container.style.cssText = `
        position: fixed;
        left: ${this.position.x}px;
        top: ${this.position.y}px;
        width: ${displayWidth + padding}px;
        height: ${displayHeight + headerHeight + padding}px;
        background: rgba(20, 20, 22, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
        z-index: 1000;
        overflow: hidden;
        min-width: 200px;
        min-height: 150px;
        opacity: 0;
        transform: scale(0.95);
        transition: opacity 0.2s ease, transform 0.2s ease;
      `;
    }

    const header = document.createElement("div");
    header.className = "preview-header";
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.05);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      cursor: ${this.isDocked ? "default" : "move"};
      user-select: none;
      height: ${headerHeight}px;
      box-sizing: border-box;
    `;

    const title = document.createElement("div");
    title.className = "preview-title";
    title.style.cssText = "color: #fff; font-size: 13px; font-weight: 600;";

    const controls = document.createElement("div");
    controls.style.cssText = "display: flex; gap: 4px;";

    const settingsBtn = this._createButton("Settings", "btn-settings");
    settingsBtn.onclick = (e) => {
      e.stopPropagation();
      this.settings.showSettings();
    };

    const dockBtn = this._createButton(
      this.isDocked ? "Float" : "Dock",
      "btn-dock",
    );
    dockBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleDocked();
    };

    controls.appendChild(settingsBtn);
    controls.appendChild(dockBtn);

    if (!this.isDocked) {
      const lockBtn = this._createButton("Unlocked", "btn-lock");
      const fullscreenBtn = this._createButton("Fullscreen", "btn-fullscreen");

      lockBtn.onclick = (e) => {
        e.stopPropagation();
        this.toggleLock();
      };
      fullscreenBtn.onclick = (e) => {
        e.stopPropagation();
        this.toggleFullscreen();
      };

      controls.appendChild(lockBtn);
      controls.appendChild(fullscreenBtn);
    }

    const closeBtn = this._createButton("X", "btn-close");
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.hide();
    };
    controls.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(controls);

    const canvasWrapper = document.createElement("div");
    canvasWrapper.className = "preview-canvas-wrapper";
    canvasWrapper.style.cssText = `
      width: 100%; 
      height: calc(100% - ${headerHeight}px); 
      background: #000; 
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    `;

    // FPS overlay
    const fpsOverlay = document.createElement("div");
    fpsOverlay.className = "fps-overlay";
    fpsOverlay.style.cssText = `
      position: absolute;
      top: 8px;
      left: 8px;
      background: rgba(0, 0, 0, 0.7);
      color: #00ff88;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      font-weight: bold;
      z-index: 10;
      display: ${this.settings.settings.showFPS ? "block" : "none"};
      pointer-events: none;
    `;
    fpsOverlay.textContent = "FPS: --";
    canvasWrapper.appendChild(fpsOverlay);

    // Debug channel overlay
    const debugOverlay = document.createElement("div");
    debugOverlay.className = "debug-overlay";
    debugOverlay.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background: rgba(255, 0, 0, 0.7);
      color: #fff;
      padding: 4px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 10px;
      font-weight: bold;
      z-index: 10;
      display: ${this.settings.settings.debugChannel !== "none" ? "block" : "none"};
      pointer-events: none;
    `;
    debugOverlay.textContent =
      this.settings.settings.debugChannel.toUpperCase();
    canvasWrapper.appendChild(debugOverlay);

    // Proper resize handle for docked mode
    if (this.isDocked) {
      const resizeHandle = document.createElement("div");
      resizeHandle.className = "resize-handle-dock";
      resizeHandle.style.cssText = `
        position: absolute;
        bottom: 0;
        right: 0;
        width: 16px;
        height: 16px;
        background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.3) 60%);
        cursor: se-resize;
        border-radius: 0 0 12px 0;
        z-index: 20;
      `;
      canvasWrapper.appendChild(resizeHandle);
    }

    container.appendChild(header);
    container.appendChild(canvasWrapper);

    this._updateTitle();

    return container;
  }

  _createButton(text, className) {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.className = className;
    btn.style.cssText = `
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      cursor: pointer;
      font-size: 10px;
      padding: 3px 6px;
      border-radius: 4px;
      transition: background 0.15s ease;
    `;

    btn.onmouseenter = () =>
      (btn.style.background = "rgba(255, 255, 255, 0.2)");
    btn.onmouseleave = () =>
      (btn.style.background = "rgba(255, 255, 255, 0.1)");

    return btn;
  }

  _setupDragging() {
    const header = this.container.querySelector(".preview-header");
    let startX, startY, startLeft, startTop;

    const onMouseDown = (e) => {
      if (
        e.target.tagName === "BUTTON" ||
        this.isLocked ||
        this.isFullscreen ||
        this.isDocked
      )
        return;

      this.isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = this.container.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;

      this.container.style.transition = "none";

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
      e.stopPropagation();
    };

    const onMouseMove = (e) => {
      if (!this.isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      const newLeft = Math.max(
        0,
        Math.min(window.innerWidth - 200, startLeft + deltaX),
      );
      const newTop = Math.max(
        0,
        Math.min(window.innerHeight - 150, startTop + deltaY),
      );

      this.container.style.left = newLeft + "px";
      this.container.style.top = newTop + "px";

      this.position.x = newLeft;
      this.position.y = newTop;

      // Move settings panel IMMEDIATELY during drag
      if (this.settings.settingsPanel) {
        this.settings._positionSettingsPanel();
      }
    };

    const onMouseUp = () => {
      this.isDragging = false;
      this.container.style.transition =
        "opacity 0.2s ease, transform 0.2s ease";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    header.addEventListener("mousedown", onMouseDown);
  }

  _setupDockedResize() {
    const resizeHandle = this.container.querySelector(".resize-handle-dock");
    if (!resizeHandle) return;

    let startX, startY, startWidth, startHeight;

    const onMouseDown = (e) => {
      this.isResizing = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = this.container.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
      e.stopPropagation();
    };

    const onMouseMove = (e) => {
      if (!this.isResizing) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newWidth = Math.max(200, startWidth + deltaX);
      let newHeight = Math.max(150, startHeight + deltaY);

      // Maintain aspect ratio
      const { width, height } = this.settings.settings.resolution;
      const aspectRatio = width / height;

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        newHeight = newWidth / aspectRatio + 37 + 20;
      } else {
        newWidth = (newHeight - 37 - 20) * aspectRatio + 20;
      }

      this.container.style.width = newWidth + "px";
      this.container.style.height = newHeight + "px";
    };

    const onMouseUp = () => {
      this.isResizing = false;
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    resizeHandle.addEventListener("mousedown", onMouseDown);
  }
}

class FPSCounter {
  constructor() {
    this.fps = 0;
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.isRunning = false;
    this.updateInterval = null;
  }

  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.frameCount = 0;
    this.lastTime = performance.now();

    this.updateInterval = setInterval(() => {
      this._updateFPS();
    }, 100);
  }

  stop() {
    this.isRunning = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  frame() {
    if (this.isRunning) {
      this.frameCount++;
    }
  }

  _updateFPS() {
    const now = performance.now();
    const delta = now - this.lastTime;

    if (delta >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / delta);
      this.frameCount = 0;
      this.lastTime = now;

      const fpsOverlay = document.querySelector(".fps-overlay");
      if (fpsOverlay) {
        fpsOverlay.textContent = `FPS: ${this.fps}`;
      }
    }
  }
}
