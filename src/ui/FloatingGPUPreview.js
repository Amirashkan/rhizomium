// src/ui/FloatingGPUPreview.js - Fixed version with proper aspect ratio handling

import { PreviewSettings } from "./PreviewSettings.js";
import { letterboxRect } from "./letterbox.js";
import { getInteractionStateManager } from '../utils/InteractionStateManager.js';
import { PRIORITY } from '../core/UnifiedRAFManager.js';

// Panel chrome: the header strip plus the 1px border on each edge. The canvas
// area is whatever is left, and the render is fitted into it.
const HEADER_HEIGHT = 37;
const BORDER = 1;
const MIN_PANEL_WIDTH = 200;
const MIN_PANEL_HEIGHT = 150;
const PANEL_SIZE_STORAGE_KEY = "rhizo.previewPanelSize";

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
    // The panel is sized freely by the user (drag its corner); the render is
    // fitted inside whatever size it has. Sizes persist per docking mode.
    this.panelSizes = this._loadPanelSizes();
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
    this._previewRenderLoopRunning = false;
    this._handlerName = 'floatingGPUPreview'; // Handler name for UnifiedRAFManager
    this._lastRenderTime = 0; // Track last render time for 60 FPS throttling
    
    // Smart adaptive quality - only activates when resources are actually low
    // Disabled by default, can be enabled via "light mode" or auto-enabled when needed
    this._adaptiveConfig = {
      enabled: false, // Disabled by default - only auto-enable when resources are low
      lightMode: false, // User can enable "light mode" to always use adaptive quality
      autoEnable: true, // Auto-enable when frame times consistently exceed budget
      resolutionScale: 0.75,
      cooldownMs: 350,
      // Thresholds for auto-enabling
      autoEnableThreshold: 20, // ms - enable if avg frame time exceeds this
      autoEnableFrames: 30, // Number of consecutive frames before enabling
      autoDisableThreshold: 16, // ms - disable if avg frame time drops below this
      autoDisableFrames: 60, // Number of consecutive frames before disabling
    };
    this._isAdaptiveActive = false;
    this._adaptiveResolutionMultiplier = 1;
    this._adaptiveCooldownTimer = null;
    this._performanceMonitoringActive = false;
    this._consecutiveSlowFrames = 0;
    this._consecutiveFastFrames = 0;
    
    // Interaction state manager for monitoring
    this.interactionStateManager = getInteractionStateManager();
    this._setupPerformanceMonitoring();
    
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

  /**
   * Setup performance monitoring to auto-enable adaptive quality when needed
   */
  _setupPerformanceMonitoring() {
    // Monitor frame times and auto-enable adaptive quality if resources are low
    if (!this._adaptiveConfig.autoEnable) return;
    
    this._performanceMonitoringActive = true;
    // Monitoring happens in updateSize() and via frame time callbacks
  }
  
  /**
   * Check if adaptive quality should be auto-enabled based on performance
   */
  _checkPerformanceAndAutoEnable() {
    if (!this._adaptiveConfig.autoEnable || this._adaptiveConfig.lightMode) {
      return; // Auto-enable disabled or light mode already handles it
    }
    
    const perfMonitor = this._getPerfMonitor();
    if (!perfMonitor) return;
    
    const budgetAllocator = perfMonitor.getBudgetAllocator?.();
    if (!budgetAllocator) return;
    
    const stats = budgetAllocator.getStats();
    const avgFrameTime = stats.avgFrameTime || 0;
    
    // Check if we should auto-enable
    if (avgFrameTime > this._adaptiveConfig.autoEnableThreshold) {
      this._consecutiveSlowFrames++;
      this._consecutiveFastFrames = 0;
      
      if (this._consecutiveSlowFrames >= this._adaptiveConfig.autoEnableFrames && !this._isAdaptiveActive) {
        // Performance is consistently poor - enable adaptive quality
        console.log(`[FloatingPreview] Auto-enabling adaptive quality (avg frame time: ${avgFrameTime.toFixed(2)}ms)`);
        this._enableAdaptiveMode('auto-performance');
      }
    } else if (avgFrameTime < this._adaptiveConfig.autoDisableThreshold) {
      this._consecutiveFastFrames++;
      this._consecutiveSlowFrames = 0;
      
      if (this._consecutiveFastFrames >= this._adaptiveConfig.autoDisableFrames && this._isAdaptiveActive) {
        // Performance has recovered - disable adaptive quality
        console.log(`[FloatingPreview] Auto-disabling adaptive quality (avg frame time: ${avgFrameTime.toFixed(2)}ms)`);
        this._disableAdaptiveMode('auto-performance');
      }
    } else {
      // Reset counters if in middle range
      this._consecutiveSlowFrames = Math.max(0, this._consecutiveSlowFrames - 1);
      this._consecutiveFastFrames = Math.max(0, this._consecutiveFastFrames - 1);
    }
  }

  _getEffectiveResolution() {
    const { width, height } = this.settings.settings.resolution;
    // Apply adaptive resolution multiplier only if adaptive mode is active
    const multiplier = this._adaptiveResolutionMultiplier || 1;
    const effectiveWidth = Math.max(64, Math.round(width * multiplier));
    const effectiveHeight = Math.max(64, Math.round(height * multiplier));
    return { width: effectiveWidth, height: effectiveHeight, baseWidth: width, baseHeight: height };
  }

  _loadPanelSizes() {
    try {
      const raw = window.localStorage?.getItem(PANEL_SIZE_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return {
        floating: this._sanitizePanelSize(parsed?.floating),
        docked: this._sanitizePanelSize(parsed?.docked),
      };
    } catch {
      return { floating: null, docked: null };
    }
  }

  _sanitizePanelSize(size) {
    const width = Number(size?.width);
    const height = Number(size?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return {
      width: Math.max(MIN_PANEL_WIDTH, Math.round(width)),
      height: Math.max(MIN_PANEL_HEIGHT, Math.round(height)),
    };
  }

  _savePanelSizes() {
    try {
      window.localStorage?.setItem(PANEL_SIZE_STORAGE_KEY, JSON.stringify(this.panelSizes));
    } catch {
      // Storage unavailable - the size still applies for this session.
    }
  }

  /**
   * Panel size for the current docking mode. The first time a mode is used the
   * size is seeded from the render resolution so the panel opens at a familiar
   * size - and then pinned, so from that point on the panel is the user's and
   * never moves again when the render resolution changes.
   */
  _getPanelSize() {
    const mode = this.isDocked ? "docked" : "floating";
    const stored = this.panelSizes[mode];
    if (stored) return { ...stored };

    const { baseWidth, baseHeight } = this._getEffectiveResolution();
    const scale = this.isDocked ? 0.3 : 0.5;
    // Keep the seed on screen: a 4K render must not open a panel wider than
    // the window. The user can still drag it to any size afterwards.
    const maxWidth = Math.max(MIN_PANEL_WIDTH, (window.innerWidth || 1280) * 0.8);
    const maxHeight = Math.max(MIN_PANEL_HEIGHT, (window.innerHeight || 800) * 0.8);

    return this._setPanelSize(
      Math.min(maxWidth, Math.round(baseWidth * scale) + 2 * BORDER),
      Math.min(maxHeight, Math.round(baseHeight * scale) + HEADER_HEIGHT + 2 * BORDER),
    );
  }

  _setPanelSize(width, height) {
    const mode = this.isDocked ? "docked" : "floating";
    this.panelSizes[mode] = {
      width: Math.max(MIN_PANEL_WIDTH, Math.round(width)),
      height: Math.max(MIN_PANEL_HEIGHT, Math.round(height)),
    };
    this._savePanelSizes();
    return { ...this.panelSizes[mode] };
  }

  /** Space left for the render once the header and borders are taken out. */
  _getCanvasBox(panelSize = this._getPanelSize()) {
    return {
      width: Math.max(1, panelSize.width - 2 * BORDER),
      height: Math.max(1, panelSize.height - HEADER_HEIGHT - 2 * BORDER),
    };
  }

  /**
   * Fit the render into the panel preserving its aspect ratio, letterboxing the
   * leftover space. The canvas backing store stays at the render resolution;
   * only its CSS size changes, so panel size and render size are independent.
   */
  _fitCanvasToPanel(panelSize = this._getPanelSize()) {
    const { baseWidth, baseHeight } = this._getEffectiveResolution();
    const box = this._getCanvasBox(panelSize);
    const { dw, dh } = letterboxRect(baseWidth, baseHeight, box.width, box.height);

    this.gpuCanvas.style.width = Math.max(1, Math.round(dw)) + "px";
    this.gpuCanvas.style.height = Math.max(1, Math.round(dh)) + "px";
    this._recordPerfWrite("fitCanvas");

    return { width: dw, height: dh };
  }

  /**
   * Enable adaptive mode (called automatically when resources are low, or manually via light mode)
   */
  _enableAdaptiveMode(reason = 'manual') {
    if (this._isAdaptiveActive) return;
    
    const config = this._getAdaptiveConfig();
    if (!config.enabled && !config.lightMode && reason !== 'auto-performance') {
      return; // Not enabled
    }
    
    this._isAdaptiveActive = true;
    this._adaptiveResolutionMultiplier = config.resolutionScale;
    
    if (this.isVisible) {
      this.updateSize();
      this._updateAdaptiveIndicator();
    }
    
    const perf = this._getPerfMonitor();
    perf?.recordValue("previewAdaptiveState", `enabled:${reason}`);
  }
  
  /**
   * Disable adaptive mode (called automatically when performance recovers)
   */
  _disableAdaptiveMode(reason = 'manual') {
    if (!this._isAdaptiveActive) return;
    
    const config = this._getAdaptiveConfig();
    // Don't disable if light mode is enabled (unless explicitly requested)
    if (config.lightMode && reason === 'auto-performance') {
      return;
    }
    
    this._isAdaptiveActive = false;
    this._adaptiveResolutionMultiplier = 1;
    
    if (this.isVisible) {
      this.updateSize();
      this._updateAdaptiveIndicator();
    }
    
    const perf = this._getPerfMonitor();
    perf?.recordValue("previewAdaptiveState", `disabled:${reason}`);
  }
  
  /**
   * Apply adaptive interaction state (for testing and internal use)
   * @param {boolean} active - Whether adaptive mode should be active
   * @param {string} reason - Reason for the state change
   */
  _applyAdaptiveInteractionState(active, reason = 'test') {
    if (active) {
      this._enableAdaptiveMode(reason);
    } else {
      this._disableAdaptiveMode(reason);
    }
  }
  
  _getAdaptiveConfig() {
    return this._adaptiveConfig || {
      enabled: false,
      lightMode: false,
      autoEnable: true,
      resolutionScale: 1,
      cooldownMs: 300,
    };
  }
  
  /**
   * Handle adaptive settings changes from UI
   */
  onAdaptiveSettingsChanged(config = {}) {
    const normalized = {
      enabled: config?.enabled === true, // Must be explicitly enabled
      lightMode: config?.lightMode === true, // Light mode option
      autoEnable: config?.autoEnable !== false, // Auto-enable by default
      resolutionScale: this._clamp(
        Number(config?.resolutionScale ?? 0.75),
        0.25,
        1
      ),
      cooldownMs: Math.max(50, Number(config?.cooldownMs ?? 350)),
      autoEnableThreshold: Number(config?.autoEnableThreshold ?? 20),
      autoEnableFrames: Math.max(10, Number(config?.autoEnableFrames ?? 30)),
      autoDisableThreshold: Number(config?.autoDisableThreshold ?? 16),
      autoDisableFrames: Math.max(30, Number(config?.autoDisableFrames ?? 60)),
    };

    this._adaptiveConfig = normalized;
    
    // If light mode is enabled, activate adaptive quality
    if (normalized.lightMode) {
      this._enableAdaptiveMode('light-mode');
    } else if (this._isAdaptiveActive && !normalized.enabled && !normalized.autoEnable) {
      // Disable if explicitly disabled and auto-enable is off
      this._disableAdaptiveMode('settings');
    }
    
    // Setup monitoring if auto-enable is on
    if (normalized.autoEnable) {
      this._setupPerformanceMonitoring();
    } else {
      this._performanceMonitoringActive = false;
    }
  }

  _applyDragPosition(left, top) {
    // PERFORMANCE: Use CSS left/top (already optimized by browser)
    // Batch DOM writes to reduce layout thrashing
    this.container.style.left = left + "px";
    this.container.style.top = top + "px";
    this._recordPerfWrite("drag:position");
    this.position.x = left;
    this.position.y = top;
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
    const panel = this._setPanelSize(widthPx, heightPx);
    this.container.style.width = panel.width + "px";
    this.container.style.height = panel.height + "px";
    this._recordPerfWrite("resize:container");
    // Re-fit the render into the new panel box (letterboxed, never stretched).
    this._fitCanvasToPanel(panel);
    this._updateTitle();
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


_setupParameterListeners() {
  // Debounce shader recompilation to prevent cascading updates
  
  
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

_setupParameterChangeListener() {
  // PERFORMANCE: Trigger renders on parameter changes to ensure preview updates immediately
  if (this._parameterChangeListenerSetup) return;
  this._parameterChangeListenerSetup = true;
  
  // Listen for parameter changes to trigger immediate render
  if (window.editor?.paramPanel) {
    window.editor.paramPanel.on?.('parameterChanged', () => {
      // Trigger immediate render on parameter change
      // Main loop will handle it, but this ensures responsiveness
      if (this.isVisible && typeof window.render === "function") {
        // Update tracking to indicate a render happened
        if (this._previewRenderLoopRunning) {
          this._mainLoopLastRenderTime = performance.now();
        }
        // Main loop should handle this, but trigger render to be safe
        window.render();
      }
    });
  }
}

_setupAnimationLoop() {
  // PERFORMANCE FIX: Don't create redundant render loop
  // The main render loop already handles GPU rendering efficiently
  // Only use independent loop as fallback if main loop is not running
  
  const originalShow = this.show.bind(this);
  this.show = () => {
    originalShow();
    // Only start independent loop if main loop isn't running
    // Otherwise, just setup parameter change listener
    this._startPreviewRenderLoop();
  };

  const originalHide = this.hide.bind(this);
  this.hide = () => {
    this._stopPreviewRenderLoop();
    if (this._parameterChangeListenerSetup) {
      this._parameterChangeListenerSetup = false;
    }
    originalHide();
  };
}

_startPreviewRenderLoop() {
  if (this._previewRenderLoopRunning || !this.isVisible) return;
  
  // PERFORMANCE: Register with UnifiedRAFManager instead of creating own RAF
  // This consolidates all RAF-based updates into a single loop for better performance
  // Render at the configured refresh rate to ensure smooth preview
  // The GPU renderer can handle being called multiple times per frame gracefully
  
  this._previewRenderLoopRunning = true;
  this._lastRenderTime = 0;
  
  // Register handler with UnifiedRAFManager to use unified RAF loop
  if (window.renderLoop?.rafManager) {
    window.renderLoop.rafManager.registerHandler(
      this._handlerName,
      (_frameInfo) => {
        // This handler is called every time RenderLoop._step() is called.
        // In fixed mode, _step() is called multiple times per RAF frame to achieve
        // the target refresh rate. In vsync mode, it's called once per RAF frame.
        // The actual GPU rendering happens in handleRenderFrame (called from onFrame),
        // and the FPS counter is updated there when the GPU actually renders.
        // This handler exists to ensure the preview render loop is registered and active.
      },
      PRIORITY.NORMAL,
      {
        // Condition: only execute if preview is visible and loop should be running
        condition: (frameInfo) => {
          return (
            this.isVisible &&
            this._previewRenderLoopRunning &&
            !frameInfo.paused // Skip if render loop is paused
          );
        }
      }
    );
  }
}

_stopPreviewRenderLoop() {
  this._previewRenderLoopRunning = false;
  
  // Unregister handler from UnifiedRAFManager
  if (window.renderLoop?.rafManager) {
    window.renderLoop.rafManager.unregisterHandler(this._handlerName);
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

    // Check performance and auto-enable adaptive quality if needed
    if (this._performanceMonitoringActive) {
      this._checkPerformanceAndAutoEnable();
    }

    const { width, height } = this._getEffectiveResolution();

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

    // The panel keeps whatever size the user gave it; only the fit changes.
    this._fitCanvasToPanel();

    this._updateTitle();

    // FIX: Only trigger shader rebuild if canvas size actually changed
    // This prevents black screen on every canvas click
    if (sizeChanged) {
      // Update tracked size before rebuild
      this._lastCanvasSize = { width, height };

      // Await the full rebuild so the render loop only restarts after
      // initialize() completes and new textures/bind groups are in place.
      await this._rebuildAfterResize();
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

    const { width, height } = this._getEffectiveResolution();

    // CRITICAL FIX: Use synchronized resize to prevent screen tearing
    const gpuRenderer = window.gpuRenderer;
    if (gpuRenderer && gpuRenderer.resizeCanvasSync) {
      await gpuRenderer.resizeCanvasSync(width, height);
    } else {
      // Fallback to direct resize if gpuRenderer not available
      this.gpuCanvas.width = width;
      this.gpuCanvas.height = height;
    }

    // Fit the render into the panel rather than sizing the panel to the render.
    this._fitCanvasToPanel();
    this.gpuCanvas.style.position = "relative";
    this.gpuCanvas.style.zIndex = "auto";
    // FIX: Override global canvas CSS that sets left/top to 0
    this.gpuCanvas.style.left = "auto";
    this.gpuCanvas.style.top = "auto";

    // Initialize canvas size tracking
    this._lastCanvasSize = { width, height };
    await this.updateSize();
    this._setupDragging();
    this._setupResize();

    this.isVisible = true;
    if (this.settings.settings.showFPS) {
      this.fpsCounter.start();
    }

    // Start independent preview render loop - always run to ensure 60 FPS
    // This loop ensures smooth preview rendering regardless of main loop state
    this._startPreviewRenderLoop();
    
    // Ensure loop is actually running (safety check)
    setTimeout(() => {
      if (this.isVisible && !this._previewRenderLoopRunning) {
        console.warn('[FloatingGPUPreview] Preview loop not running, restarting...');
        this._startPreviewRenderLoop();
      }
    }, 100);

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

    const perfToken = this._getPerfMonitor()?.timeSection("previewFullscreen");
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
      const { width, height, baseWidth, baseHeight } = this._getEffectiveResolution();
      // The panel size is the user's; the percentage is how large the render is
      // drawn inside it after the aspect-preserving fit.
      const box = this._getCanvasBox();
      const fitted = letterboxRect(baseWidth, baseHeight, box.width, box.height);
      const fitPercent = baseWidth > 0 ? Math.round((fitted.dw / baseWidth) * 100) : 100;
      const scaleValue = this.isDocked ? `Docked ${fitPercent}%` : `${fitPercent}%`;

      let resolutionLabel = `${baseWidth}×${baseHeight}`;
      if (this._isAdaptiveActive && (width !== baseWidth || height !== baseHeight)) {
        resolutionLabel = `${baseWidth}×${baseHeight} → ${width}×${height}`;
      }
      
      const modeLabel = this._adaptiveConfig.lightMode ? " (light mode)" : 
                       (this._isAdaptiveActive ? " (adaptive)" : "");
      title.textContent = `Preview ${resolutionLabel} (${scaleValue}${modeLabel})`;
    }
    
    // Update visual indicator badge
    this._updateAdaptiveIndicator();
  }
  
  /**
   * Update visual indicator badge when adaptive quality is active
   */
  _updateAdaptiveIndicator() {
    if (!this.container) return;
    
    let badge = this.container.querySelector(".adaptive-quality-badge");
    
    if (this._isAdaptiveActive) {
      // Create badge if it doesn't exist
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "adaptive-quality-badge";
        badge.style.cssText = `
          position: absolute;
          top: 8px;
          right: 8px;
          background: rgba(255, 165, 0, 0.9);
          color: #000;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: bold;
          z-index: 1000;
          pointer-events: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          animation: pulse 2s ease-in-out infinite;
        `;
        
        // Add pulse animation
        if (!document.getElementById('adaptive-badge-style')) {
          const style = document.createElement('style');
          style.id = 'adaptive-badge-style';
          style.textContent = `
            @keyframes pulse {
              0%, 100% { opacity: 0.9; }
              50% { opacity: 0.7; }
            }
          `;
          document.head.appendChild(style);
        }
        
        this.container.appendChild(badge);
      }
      
      // Update badge text
      const reason = this._adaptiveConfig.lightMode ? "Light Mode" : "Auto";
      badge.textContent = `⚡ ${reason}`;
      badge.title = `Adaptive quality active: ${reason === "Light Mode" ? "User enabled light mode" : "Auto-enabled due to low resources"}`;
      badge.style.display = "block";
    } else {
      // Hide badge when not active
      if (badge) {
        badge.style.display = "none";
      }
    }
  }

  _dockToWindow() {
    const panel = this._getPanelSize();

    this.container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: ${panel.width}px;
      height: ${panel.height}px;
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
      min-width: ${MIN_PANEL_WIDTH}px;
      min-height: ${MIN_PANEL_HEIGHT}px;
    `;

    document.body.appendChild(this.container);
  }

  _createContainer() {
    const headerHeight = HEADER_HEIGHT;
    const panel = this._getPanelSize();

    const container = document.createElement("div");
    container.className = "floating-gpu-preview";

    if (!this.isDocked) {
      container.style.cssText = `
        position: fixed;
        left: ${this.position.x}px;
        top: ${this.position.y}px;
        width: ${panel.width}px;
        height: ${panel.height}px;
        background: rgba(20, 20, 22, 0.98);
        /* PERFORMANCE: backdrop-filter disabled to prevent periodic FPS drops */
        /* backdrop-filter: blur(20px); */
        will-change: transform, opacity;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
        z-index: 1000;
        overflow: hidden;
        min-width: ${MIN_PANEL_WIDTH}px;
        min-height: ${MIN_PANEL_HEIGHT}px;
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

    // The panel is freely resizable in both docking modes - the render is
    // fitted into whatever size it ends up with.
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "preview-resize-handle";
    resizeHandle.title = "Drag to resize the preview panel";
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


  /**
   * Free resize: width and height move independently and the render is
   * letterboxed inside the result, so the panel is never forced back to the
   * render's aspect ratio.
   */
  _setupResize() {
    const resizeHandle = this.container.querySelector(".preview-resize-handle");
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

      const newWidth = Math.max(MIN_PANEL_WIDTH, startWidth + (e.clientX - startX));
      const newHeight = Math.max(MIN_PANEL_HEIGHT, startHeight + (e.clientY - startY));

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
    // Real GPU frame time: EMA of the interval between presented frames. Using
    // the completion interval (not submit→done) keeps it stable and equal to the
    // true frame time even if the loop over-dispatches under load.
    this._lastFrameTime = 0;
    this._frameMsEma = 0;
  }

  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.frameCount = 0;
    this.lastTime = performance.now();
    this._lastFrameTime = 0;
    this._frameMsEma = 0;

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

  // Called once per GPU-presented frame (from gpuRenderer.onFramePresented), so
  // both the count and the inter-frame interval reflect real GPU throughput.
  frame() {
    if (!this.isRunning) return;
    this.frameCount++;
    const now = performance.now();
    if (this._lastFrameTime) {
      const interval = now - this._lastFrameTime;
      // EMA so the displayed frame time is steady rather than jittery.
      this._frameMsEma = this._frameMsEma
        ? this._frameMsEma * 0.9 + interval * 0.1
        : interval;
    }
    this._lastFrameTime = now;
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
        const ms = this._frameMsEma > 0 ? `${this._frameMsEma.toFixed(1)} ms` : "-- ms";
        this.fpsOverlayElement.textContent = `FPS: ${this.fps} · ${ms}`;
      }
    }
  }
  
  // Method to refresh cached element reference (call when DOM changes)
  refreshElementCache() {
    this.fpsOverlayElement = document.querySelector(".fps-overlay");
  }
}
