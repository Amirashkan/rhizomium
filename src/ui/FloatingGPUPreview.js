// src/ui/FloatingGPUPreview.js - Fixed version with proper aspect ratio handling

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
    
    this.animationLoop = null;
    // Track previous canvas size to avoid unnecessary rebuilds
    this._lastCanvasSize = { width: 0, height: 0 };
    this._pendingDragPosition = null;
    this._dragRafId = null;
    this._pendingResizeDimensions = null;
    this._resizeRafId = null;
    this.isCanvasInteractionActive = false;
    this._handleInteractionEvent = this._handleInteractionEvent.bind(this);
    window.addEventListener("floating-preview-interaction", this._handleInteractionEvent);
    this._adaptiveConfig = {
      enabled: true,
      interactionScale: 0.7,
      resolutionScale: 0.75,
      cooldownMs: 350,
    };
    this._isAdaptiveActive = false;
    this._adaptiveScaleMultiplier = 1;
    this._adaptiveResolutionMultiplier = 1;
    this._adaptiveCooldownTimer = null;
    this._frameBudgetQualityMultiplier = 1.0; // Quality multiplier from frame budget allocator
    this._previewRenderLoopRunning = false;
    this._previewRafId = null;
    this._previewFrameSkipCounter = 0;
    this._previewLastFrameTime = 0;
    this._setupParameterListeners();
    this._setupAnimationLoop();
    this.onAdaptiveSettingsChanged(this.settings.settings.adaptiveQuality);
  }

  _getPerfMonitor() {
    return window.previewPerfMonitor || null;
  }

  _recordPerfRead(label) {
    const perf = this._getPerfMonitor();
    perf?.recordLayoutRead(`preview:${label}`);
  }

  _recordPerfWrite(label) {
    const perf = this._getPerfMonitor();
    perf?.recordLayoutWrite(`preview:${label}`);
  }
  
  _clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }

  _getAdaptiveConfig() {
    return this._adaptiveConfig || {
      enabled: false,
      interactionScale: 1,
      resolutionScale: 1,
      cooldownMs: 300,
    };
  }

  _getEffectiveResolution() {
    const { width, height } = this.settings.settings.resolution;
    // Combine adaptive resolution multiplier with frame budget quality multiplier
    const adaptiveMultiplier = this._adaptiveResolutionMultiplier || 1;
    const budgetQualityMultiplier = this._frameBudgetQualityMultiplier || 1;
    const multiplier = adaptiveMultiplier * budgetQualityMultiplier;
    const effectiveWidth = Math.max(64, Math.round(width * multiplier));
    const effectiveHeight = Math.max(64, Math.round(height * multiplier));
    return { width: effectiveWidth, height: effectiveHeight, baseWidth: width, baseHeight: height };
  }
  
  /**
   * Apply quality multiplier from frame budget allocator
   * This dynamically reduces preview resolution if frame budget is exceeded
   */
  _applyQualityMultiplier(multiplier) {
    if (typeof multiplier !== 'number' || multiplier < 0.5 || multiplier > 1.0) {
      return; // Invalid multiplier, ignore
    }
    
    // Only apply if significantly different to avoid constant resizing
    const currentMultiplier = this._frameBudgetQualityMultiplier || 1.0;
    if (Math.abs(multiplier - currentMultiplier) < 0.05) {
      return; // Less than 5% change, skip
    }
    
    this._frameBudgetQualityMultiplier = multiplier;
    
    // Update canvas resolution if visible
    if (this.isVisible && this.gpuCanvas) {
      const { width, height } = this._getEffectiveResolution();
      if (this.gpuCanvas.width !== width || this.gpuCanvas.height !== height) {
        // Update canvas size
        this.gpuCanvas.width = width;
        this.gpuCanvas.height = height;
        
        // Trigger rebuild if available
        if (window.rebuild) {
          window.rebuild();
        }
      }
    }
  }

  _getDisplayScale() {
    const baseScale = this.isDocked ? 0.3 : this.previewScale;
    return baseScale * (this._adaptiveScaleMultiplier || 1);
  }

  _applyDragPosition(left, top) {
    this.container.style.left = left + "px";
    this.container.style.top = top + "px";
    this._recordPerfWrite("drag:position");
    this.position.x = left;
    this.position.y = top;
    if (this.settings.settingsPanel) {
      this.settings._positionSettingsPanel();
      this._recordPerfWrite("drag:settingsPanel");
    }
  }

  _scheduleDragPositionFlush() {
    if (this._dragRafId || !this._pendingDragPosition) return;
    this._dragRafId = requestAnimationFrame(() => {
      this._dragRafId = null;
      if (!this._pendingDragPosition) return;
      const { left, top } = this._pendingDragPosition;
      this._pendingDragPosition = null;
      this._applyDragPosition(left, top);
    });
  }

  _flushDragPosition() {
    if (!this._pendingDragPosition) return;
    const { left, top } = this._pendingDragPosition;
    this._pendingDragPosition = null;
    if (this._dragRafId) {
      cancelAnimationFrame(this._dragRafId);
      this._dragRafId = null;
    }
    this._applyDragPosition(left, top);
  }

  _applyResizeDimensions(widthPx, heightPx) {
    this.container.style.width = widthPx + "px";
    this.container.style.height = heightPx + "px";
    this._recordPerfWrite("resize:container");
  }

  _scheduleResizeFlush() {
    if (this._resizeRafId || !this._pendingResizeDimensions) return;
    this._resizeRafId = requestAnimationFrame(() => {
      this._resizeRafId = null;
      if (!this._pendingResizeDimensions) return;
      const { width, height } = this._pendingResizeDimensions;
      this._pendingResizeDimensions = null;
      this._applyResizeDimensions(width, height);
    });
  }

  _flushResizeDimensions() {
    if (!this._pendingResizeDimensions) return;
    const { width, height } = this._pendingResizeDimensions;
    this._pendingResizeDimensions = null;
    if (this._resizeRafId) {
      cancelAnimationFrame(this._resizeRafId);
      this._resizeRafId = null;
    }
    this._applyResizeDimensions(width, height);
  }

  onAdaptiveSettingsChanged(config = {}) {
    const normalized = {
      enabled: config?.enabled !== false,
      interactionScale: this._clamp(
        Number(config?.interactionScale ?? this._adaptiveConfig.interactionScale ?? 0.7),
        0.3,
        1
      ),
      resolutionScale: this._clamp(
        Number(config?.resolutionScale ?? this._adaptiveConfig.resolutionScale ?? 0.75),
        0.25,
        1
      ),
      cooldownMs: Math.max(50, Number(config?.cooldownMs ?? this._adaptiveConfig.cooldownMs ?? 350)),
    };

    this._adaptiveConfig = normalized;
    if (!normalized.enabled) {
      this._exitAdaptiveMode(true);
    } else if (this._isAdaptiveActive) {
      this._adaptiveScaleMultiplier = normalized.interactionScale;
      this._adaptiveResolutionMultiplier = normalized.resolutionScale;
      if (this.isVisible) {
        this.updateSize();
      }
    }
  }

  _applyAdaptiveInteractionState(active, reason = "interaction") {
    const config = this._getAdaptiveConfig();
    if (!config.enabled) return;

    if (active) {
      if (this._adaptiveCooldownTimer) {
        clearTimeout(this._adaptiveCooldownTimer);
        this._adaptiveCooldownTimer = null;
      }
      if (!this._isAdaptiveActive) {
        this._isAdaptiveActive = true;
        this._adaptiveScaleMultiplier = config.interactionScale;
        this._adaptiveResolutionMultiplier = config.resolutionScale;
        this._announceAdaptiveState("engaged", reason);
        this.updateSize();
      }
    } else {
      if (!this._isAdaptiveActive) return;
      if (this._adaptiveCooldownTimer) {
        clearTimeout(this._adaptiveCooldownTimer);
      }
      this._adaptiveCooldownTimer = setTimeout(() => {
        this._adaptiveCooldownTimer = null;
        this._exitAdaptiveMode(false, reason);
      }, config.cooldownMs);
    }
  }

  _exitAdaptiveMode(force = false, reason = "interaction") {
    if (!force && !this._isAdaptiveActive) return;
    if (this._adaptiveCooldownTimer) {
      clearTimeout(this._adaptiveCooldownTimer);
      this._adaptiveCooldownTimer = null;
    }
    this._isAdaptiveActive = false;
    this._adaptiveScaleMultiplier = 1;
    this._adaptiveResolutionMultiplier = 1;
    this._announceAdaptiveState("restored", reason);
    if (this.isVisible) {
      this.updateSize();
    }
  }

  _announceAdaptiveState(phase, reason) {
    const perf = this._getPerfMonitor();
    perf?.recordValue("previewAdaptiveState", `${phase}:${reason}`);
  }

_setupParameterListeners() {
  // Debounce shader recompilation to prevent cascading updates
  let rebuildTimeout = null;
  
  const debouncedRebuild = () => {
    if (rebuildTimeout) {
      clearTimeout(rebuildTimeout);
    }
    
    rebuildTimeout = setTimeout(() => {
      if (this.isVisible && window.rebuild) {
        // CRITICAL FIX: Don't rebuild if a shader compilation is already in progress
        // This prevents the GPU bind group mismatch error
        if (!window.isCompilingShader) {
          window.rebuild();
        }
      }
      rebuildTimeout = null;
    }, 100);
  };
  
  if (window.editor?.eventSystem) {
    // DISABLED: These were causing double shader compilations
    // The parameter panel already handles preview updates
    // window.editor.eventSystem.on('EXPRESSION_EVALUATED', debouncedRebuild);
    // window.editor.eventSystem.on('PARAMETER_CHANGED', debouncedRebuild);
  }
  
  if (window.expressionSystem) {
    // DISABLED: This was causing the GPU bind group error
    // window.expressionSystem.addDependencyListener(debouncedRebuild);
  }
}

_setupAnimationLoop() {
  // INDEPENDENT PREVIEW RENDER LOOP
  // The preview has its own RAF loop that runs independently of the main canvas render loop
  // This ensures the preview continues rendering even during canvas interactions
  
  const originalShow = this.show.bind(this);
  this.show = () => {
    originalShow();
    this._startPreviewRenderLoop();
    
    // Listen for parameter changes to trigger immediate render
    if (window.editor?.paramPanel) {
      window.editor.paramPanel.on?.('parameterChanged', () => {
        // Trigger immediate render on parameter change
        if (this.isVisible && typeof window.render === "function") {
          window.render();
        }
      });
    }
  };

  const originalHide = this.hide.bind(this);
  this.hide = () => {
    this._stopPreviewRenderLoop();
    originalHide();
  };
}

_startPreviewRenderLoop() {
  if (this._previewRenderLoopRunning || !this.isVisible) return;
  
  this._previewRenderLoopRunning = true;
  this._previewFrameSkipCounter = 0;
  this._previewLastFrameTime = performance.now();
  
  const renderFrame = (timestamp) => {
    if (!this._previewRenderLoopRunning || !this.isVisible) {
      this._previewRenderLoopRunning = false;
      this._previewRafId = null;
      return;
    }
    
    // Frame skipping during heavy canvas interactions (render every 2nd frame)
    const shouldSkipFrame = this.isCanvasInteractionActive && (this._previewFrameSkipCounter % 2 !== 0);
    
    if (!shouldSkipFrame && typeof window.render === "function") {
      // Render preview independently - doesn't depend on canvas interaction state
      window.render();
      
      // Update FPS counter
      if (this.fpsCounter) {
        this.fpsCounter.frame();
      }
    }
    
    this._previewFrameSkipCounter++;
    this._previewLastFrameTime = timestamp;
    
    // Schedule next frame
    this._previewRafId = requestAnimationFrame(renderFrame);
  };
  
  // Start the loop
  this._previewRafId = requestAnimationFrame(renderFrame);
}

_stopPreviewRenderLoop() {
  this._previewRenderLoopRunning = false;
  if (this._previewRafId !== null) {
    cancelAnimationFrame(this._previewRafId);
    this._previewRafId = null;
  }
}

  async _rebuildAfterResize() {
    // Wait for GPU resize operations to complete
    const gpuRenderer = window.gpuRenderer;
    if (gpuRenderer && gpuRenderer.device) {
      try {
        // Wait for all pending GPU operations to complete
        await gpuRenderer.device.queue.onSubmittedWorkDone();
        // Wait a bit more to ensure textures are fully recreated
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (err) {
        console.warn('[FloatingGPUPreview] Failed to wait for GPU sync:', err);
      }
    }

    // Now rebuild shader - GPU operations are complete
    if (window.rebuild) {
      try {
        // Rebuild might be async, so handle it properly
        const rebuildResult = window.rebuild();
        if (rebuildResult instanceof Promise) {
          await rebuildResult;
        }
      } catch (err) {
        console.error('[FloatingGPUPreview] Rebuild failed:', err);
      }
    }

    // Wait for rebuild to fully complete (shader compilation, pipeline creation)
    // This ensures textures and pipelines are ready before rendering resumes
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify GPU is ready before restarting render loop
    if (gpuRenderer && gpuRenderer.device) {
      try {
        // One more sync check to ensure rebuild operations are complete
        await gpuRenderer.device.queue.onSubmittedWorkDone();
      } catch (err) {
        console.warn('[FloatingGPUPreview] Failed final GPU sync check:', err);
      }
    }

    // Now safely restart the render loop
    if (window.renderLoop && window.renderLoop.start) {
      window.renderLoop.start();
    } else if (typeof window.render === "function") {
      window.render();
    }
  }

  async updateSize() {
    if (!this.container || this.isFullscreen) return;

    const perfToken = this._getPerfMonitor()?.timeSection("previewDom");
    const { width, height, baseWidth, baseHeight } = this._getEffectiveResolution();
    const headerHeight = 37;
    const padding = 20;

    // FIX: Only rebuild if canvas size actually changed
    const sizeChanged = 
      this._lastCanvasSize.width !== width || 
      this._lastCanvasSize.height !== height;

    // CRITICAL FIX: Use synchronized resize to prevent screen tearing
    // This waits for GPU operations to complete before resizing the canvas
    const gpuRenderer = window.gpuRenderer;
    if (sizeChanged && gpuRenderer && gpuRenderer.resizeCanvasSync) {
      await gpuRenderer.resizeCanvasSync(width, height);
    } else if (sizeChanged) {
      // Fallback to direct resize if gpuRenderer not available
      this.gpuCanvas.width = width;
      this.gpuCanvas.height = height;
    }

    const displayScale = this._getDisplayScale();
    const cssWidth = baseWidth * displayScale;
    const cssHeight = baseHeight * displayScale;

    this.container.style.width = cssWidth + padding + "px";
    this.container.style.height = cssHeight + headerHeight + padding + "px";
    this._recordPerfWrite("updateSize:container");

    // FIX: Set CSS size to maintain aspect ratio
    this.gpuCanvas.style.width = cssWidth + "px";
    this.gpuCanvas.style.height = cssHeight + "px";
    this._recordPerfWrite("updateSize:canvas");

    this._updateTitle();

    if (this.settings.settingsPanel) {
      this.settings._positionSettingsPanel();
    }

    // FIX: Only trigger shader rebuild if canvas size actually changed
    // This prevents black screen on every canvas click
    if (sizeChanged) {
      // Update tracked size before rebuild
      this._lastCanvasSize = { width, height };
      
      // CRITICAL: Wait for GPU resize operations to complete before rebuilding
      // This prevents "destroyed texture" errors by ensuring textures are recreated
      this._rebuildAfterResize();
    } else {
      // Ensure render loop continues even if size didn't change
      const renderLoopState = window.renderLoop?.getState();
      if (window.renderLoop && renderLoopState && !renderLoopState.running) {
        window.renderLoop.start();
      }
      // Trigger a single render to refresh display
      if (typeof window.render === "function") {
        window.render();
      }
    }
  }
async show() {
  if (this.isVisible) return;

  this.container = this._createContainer();

  if (this.isDocked) {
    this._dockToWindow();
  } else {
    document.body.appendChild(this.container);
  }

    const canvasWrapper = this.container.querySelector(".preview-canvas-wrapper");
    canvasWrapper.appendChild(this.gpuCanvas);

    // FIX: Don't use 100% - use actual scaled dimensions
    const { width, height, baseWidth, baseHeight } = this._getEffectiveResolution();
    const scale = this._getDisplayScale();

    // CRITICAL FIX: Use synchronized resize to prevent screen tearing
    const gpuRenderer = window.gpuRenderer;
    if (gpuRenderer && gpuRenderer.resizeCanvasSync) {
      await gpuRenderer.resizeCanvasSync(width, height);
    } else {
      // Fallback to direct resize if gpuRenderer not available
      this.gpuCanvas.width = width;
      this.gpuCanvas.height = height;
    }

    this.gpuCanvas.style.width = (baseWidth * scale) + "px";
    this.gpuCanvas.style.height = (baseHeight * scale) + "px";
    this.gpuCanvas.style.position = "relative";
    this.gpuCanvas.style.zIndex = "auto";
    // FIX: Override global canvas CSS that sets left/top to 0
    this.gpuCanvas.style.left = "auto";
    this.gpuCanvas.style.top = "auto";

    // Initialize canvas size tracking
    this._lastCanvasSize = { width, height };
    await this.updateSize();
    this._setupDragging();

    if (this.isDocked) {
      this._setupDockedResize();
    }

    this.isVisible = true;
    if (this.settings.settings.showFPS) {
      this.fpsCounter.start();
    }

    // Start independent preview render loop
    this._startPreviewRenderLoop();

    // FIX: Handle visibility changes to ensure rendering continues
    this._setupVisibilityHandler();

    requestAnimationFrame(() => {
      this.container.style.opacity = "1";
      this.container.style.transform = "scale(1)";
    });
  }

  hide() {
    if (!this.isVisible || !this.container) return;

    this.fpsCounter.stop();
    
    // Stop independent preview render loop
    this._stopPreviewRenderLoop();

    // Cleanup visibility handler
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }

    const originalContainer = document.querySelector(".canvas-wrapper");
    if (originalContainer && this.gpuCanvas) {
      originalContainer.appendChild(this.gpuCanvas);

      this.gpuCanvas.style.width = "100%";
      this.gpuCanvas.style.height = "100%";
      this.gpuCanvas.style.position = "";
      this.gpuCanvas.style.zIndex = "";
      this.gpuCanvas.style.left = "";
      this.gpuCanvas.style.top = "";
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

  async toggleFullscreen() {
    if (!this.isVisible || this.isDocked) return;

    this.isFullscreen = !this.isFullscreen;
    const btn = this.container.querySelector(".btn-fullscreen");
    const hud = document.getElementById("hud");

    if (this.isFullscreen) {
      // Save original container styles before entering fullscreen
      this.originalFullscreenStyles = {
        cssText: this.container.style.cssText,
        canvasWidth: this.gpuCanvas.width,
        canvasHeight: this.gpuCanvas.height,
        canvasStyleWidth: this.gpuCanvas.style.width,
        canvasStyleHeight: this.gpuCanvas.style.height,
        hudDisplay: hud ? hud.style.display : null,
      };

      // Hide the HUD menu for true fullscreen experience
      if (hud) {
        hud.style.display = "none";
      }

      // FIX: Maintain aspect ratio in fullscreen
      const { width, height } = this.settings.settings.resolution;
      const aspectRatio = width / height;

      let fsWidth = window.innerWidth;
      let fsHeight = window.innerHeight;

      // Fit to window while maintaining aspect ratio
      if (fsWidth / fsHeight > aspectRatio) {
        fsWidth = fsHeight * aspectRatio;
      } else {
        fsHeight = fsWidth / aspectRatio;
      }

      // CRITICAL FIX: Use synchronized resize to prevent screen tearing
      const gpuRenderer = window.gpuRenderer;
      if (gpuRenderer && gpuRenderer.resizeCanvasSync) {
        await gpuRenderer.resizeCanvasSync(width, height);
      } else {
        // Fallback to direct resize if gpuRenderer not available
        this.gpuCanvas.width = width;
        this.gpuCanvas.height = height;
      }

      this.gpuCanvas.style.width = fsWidth + "px";
      this.gpuCanvas.style.height = fsHeight + "px";

      this.container.style.cssText +=
        ";position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;border-radius:0!important;display:flex!important;align-items:center!important;justify-content:center!important;";
      btn.textContent = "Exit FS";
    } else {
      // Restore original container and canvas styles
      if (this.originalFullscreenStyles) {
        this.container.style.cssText = this.originalFullscreenStyles.cssText;

        // CRITICAL FIX: Use synchronized resize to prevent screen tearing
        const gpuRenderer = window.gpuRenderer;
        if (gpuRenderer && gpuRenderer.resizeCanvasSync) {
          await gpuRenderer.resizeCanvasSync(
            this.originalFullscreenStyles.canvasWidth,
            this.originalFullscreenStyles.canvasHeight
          );
        } else {
          // Fallback to direct resize if gpuRenderer not available
          this.gpuCanvas.width = this.originalFullscreenStyles.canvasWidth;
          this.gpuCanvas.height = this.originalFullscreenStyles.canvasHeight;
        }

        this.gpuCanvas.style.width = this.originalFullscreenStyles.canvasStyleWidth;
        this.gpuCanvas.style.height = this.originalFullscreenStyles.canvasStyleHeight;

        // Restore HUD visibility
        if (hud && this.originalFullscreenStyles.hudDisplay !== null) {
          hud.style.display = this.originalFullscreenStyles.hudDisplay;
        }
      }

      btn.textContent = "Fullscreen";
      await this.updateSize();
    }

    if (window.rebuild) {
      window.rebuild();
    }
    this._getPerfMonitor()?.endSection(perfToken);
  }

  toggleLock() {
    if (!this.isVisible || this.isDocked) return;

    this.isLocked = !this.isLocked;
    const lockBtn = this.container.querySelector(".btn-lock");

    if (this.isLocked) {
      lockBtn.textContent = "Locked";
      this.container.style.pointerEvents = "none";
      this.container.querySelector(".preview-header").style.pointerEvents = "auto";
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
      const baseWidth = this.settings.settings.resolution.width;
      const baseHeight = this.settings.settings.resolution.height;
      const effective = this._getEffectiveResolution();
      const scaleValue = this.isDocked
        ? "Docked"
        : `${Math.round(this.previewScale * (this._adaptiveScaleMultiplier || 1) * 100)}%`;
      const resolutionLabel = this._isAdaptiveActive
        ? `${baseWidth}×${baseHeight} → ${effective.width}×${effective.height}`
        : `${baseWidth}×${baseHeight}`;
      const adaptiveLabel = this._isAdaptiveActive ? " • adaptive" : "";
      title.textContent = `Preview ${resolutionLabel} (${scaleValue}${adaptiveLabel})`;
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
      background: rgba(20, 20, 22, 0.98);
      /* PERFORMANCE: backdrop-filter disabled to prevent periodic FPS drops */
      /* backdrop-filter: blur(20px); */
      will-change: transform, opacity;
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
        background: rgba(20, 20, 22, 0.98);
        /* PERFORMANCE: backdrop-filter disabled to prevent periodic FPS drops */
        /* backdrop-filter: blur(20px); */
        will-change: transform, opacity;
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
    
    // Refresh FPS counter element cache after creating overlay
    if (this.fpsCounter) {
      this.fpsCounter.refreshElementCache();
    }

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
    debugOverlay.textContent = this.settings.settings.debugChannel.toUpperCase();
    canvasWrapper.appendChild(debugOverlay);

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

    btn.onmouseenter = () => (btn.style.background = "rgba(255, 255, 255, 0.2)");
    btn.onmouseleave = () => (btn.style.background = "rgba(255, 255, 255, 0.1)");

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
      this._recordPerfRead("drag:startBounds");
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

      this._pendingDragPosition = { left: newLeft, top: newTop };
      this._scheduleDragPositionFlush();
    };

    const onMouseUp = () => {
      this.isDragging = false;
      this.container.style.transition = "opacity 0.2s ease, transform 0.2s ease";
      this._flushDragPosition();
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    header.addEventListener("mousedown", onMouseDown);
  }

  _handleInteractionEvent(event) {
    const detail = event?.detail || {};
    const isActive = !!detail.active;
    const wasActive = this.isCanvasInteractionActive;
    this.isCanvasInteractionActive = isActive;
    
    // Immediately activate adaptive mode when panning starts
    if (isActive && !wasActive) {
      // Activate adaptive mode immediately on pan start
      this._applyAdaptiveInteractionState(true, detail.reason || "canvas");
      // Reset frame skip counter to ensure first frame renders
      this._previewFrameSkipCounter = 0;
    } else if (!isActive && wasActive) {
      // Exit adaptive mode after panning ends (with cooldown)
      this._applyAdaptiveInteractionState(false, detail.reason || "canvas");
    }
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
      this._recordPerfRead("resize:startBounds");
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

      const { width, height } = this.settings.settings.resolution;
      const aspectRatio = width / height;

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        newHeight = newWidth / aspectRatio + 37 + 20;
      } else {
        newWidth = (newHeight - 37 - 20) * aspectRatio + 20;
      }

      this._pendingResizeDimensions = { width: newWidth, height: newHeight };
      this._scheduleResizeFlush();
    };

    const onMouseUp = () => {
      this.isResizing = false;
      this._flushResizeDimensions();
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    resizeHandle.addEventListener("mousedown", onMouseDown);
  }

  _setupVisibilityHandler() {
    // FIX: Ensure preview render loop continues when canvas becomes visible
    // This prevents the "needs a click to continue rendering" issue
    if (!this.gpuCanvas) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && this.isVisible) {
        // Restart independent preview render loop if not running
        if (!this._previewRenderLoopRunning) {
          this._startPreviewRenderLoop();
        }
        // Trigger a render to refresh the display
        if (typeof window.render === "function") {
          window.render();
        }
      } else if (document.visibilityState === 'hidden') {
        // Pause preview render loop when page is hidden to save resources
        this._stopPreviewRenderLoop();
      }
    };

    // Listen for page visibility changes
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Also listen for canvas focus to ensure rendering continues
    this.gpuCanvas.addEventListener('focus', () => {
      if (!this._previewRenderLoopRunning && this.isVisible) {
        this._startPreviewRenderLoop();
      }
    });

    // Store handler for cleanup
    this._visibilityHandler = handleVisibilityChange;
  }
}

class FPSCounter {
  constructor() {
    this.fps = 0;
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.isRunning = false;
    this.updateInterval = null;
    // Cache FPS overlay element to avoid DOM queries
    this.fpsOverlayElement = null;
  }

  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.frameCount = 0;
    this.lastTime = performance.now();

    // Cache FPS overlay element once
    if (!this.fpsOverlayElement) {
      this.fpsOverlayElement = document.querySelector(".fps-overlay");
    }

    // Update FPS display every 500ms (2 updates per second)
    this.updateInterval = setInterval(() => {
      if (this.isRunning) {
        this._updateFPS();
      }
    }, 500);
  }

  stop() {
    this.isRunning = false;
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    // Clear cached element reference
    this.fpsOverlayElement = null;
  }

  frame() {
    if (this.isRunning) {
      this.frameCount++;
    }
  }

  _updateFPS() {
    const now = performance.now();
    const delta = now - this.lastTime;

    // Update FPS display every second
    if (delta >= 1000) {
      // Simple and accurate: FPS = frames rendered / time elapsed
      this.fps = Math.round((this.frameCount * 1000) / delta);
      this.frameCount = 0;
      this.lastTime = now;

      // Use cached element reference instead of DOM query
      if (!this.fpsOverlayElement) {
        this.fpsOverlayElement = document.querySelector(".fps-overlay");
      }
      
      if (this.fpsOverlayElement) {
        this.fpsOverlayElement.textContent = `FPS: ${this.fps}`;
      }
    }
  }
  
  // Method to refresh cached element reference (call when DOM changes)
  refreshElementCache() {
    this.fpsOverlayElement = document.querySelector(".fps-overlay");
  }
}
