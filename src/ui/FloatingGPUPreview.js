// src/ui/FloatingGPUPreview.js - Fixed version with proper aspect ratio handling

import { PreviewSettings } from "./PreviewSettings.js";
import { letterboxRect } from "./letterbox.js";
import { resolveResolution } from "./OutputFormat.js";
import { getInteractionStateManager } from '../utils/InteractionStateManager.js';
import { PRIORITY } from '../core/UnifiedRAFManager.js';
import { ACCENT, SEMANTIC, SURFACE, TEXT, FONT_MONO, FONT_UI, withAlpha } from '../core/theme.js';
import { getPresentedFps } from '../core/presentedFrameRate.js';
import { setIcon } from './iconSprite.js';
import { clampPanelPosition, keepPanelInBounds } from './utils/windowBounds.js';
import { makeResizable } from './utils/resizable.js';

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
    this._cleanupResizable = null;
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
    // The preview renders the 'preview' role: the output's aspect at the
    // machine's preview quality. Its panel size is separate again (see
    // _getPanelSize) - this is only how many pixels the render costs.
    const { width, height } = resolveResolution("preview");
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

    // Closing straight out of fullscreen has to put the app chrome back —
    // otherwise the panel goes away and takes the menu bar with it, leaving no
    // way to reach anything.
    if (this.isFullscreen) this._exitFullscreenChrome();

    this.fpsCounter.stop();
    
    // Stop independent preview render loop
    this._stopPreviewRenderLoop();

    // Cleanup visibility handler
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }

    // The next show() builds a fresh container and re-registers these.
    if (this._viewportResizeHandler) {
      window.removeEventListener('resize', this._viewportResizeHandler);
      this._viewportResizeHandler = null;
    }

    if (this._cleanupResizable) {
      this._cleanupResizable();
      this._cleanupResizable = null;
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

  /**
   * Chrome that only exists in fullscreen, injected once.
   *
   * The header carries an inline cssText (it is built in JS), so these state
   * rules have to out-specify it with !important — they are a mode switch on
   * top of that base, not a competing opinion about the windowed layout.
   */
  _ensureFullscreenChromeStyles() {
    if (document.getElementById("rz-preview-fullscreen-styles")) return;
    const style = document.createElement("style");
    style.id = "rz-preview-fullscreen-styles";
    style.textContent = `
      /* In fullscreen the render IS the screen, so the window chrome stops
         being a title bar across the top and becomes a small glass cluster in
         the corner that fades out while the pointer is still. */
      .floating-gpu-preview.is-fullscreen .preview-header {
        position: absolute !important;
        top: 14px !important;
        right: 14px !important;
        left: auto !important;
        width: auto !important;
        height: auto !important;
        padding: 4px 5px !important;
        gap: 2px !important;
        justify-content: flex-end !important;
        background: rgba(10, 9, 8, 0.55) !important;
        backdrop-filter: blur(8px);
        border: 1px solid ${SURFACE.line} !important;
        border-radius: 999px !important;
        z-index: 30;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease;
      }

      .floating-gpu-preview.is-fullscreen.controls-visible .preview-header {
        opacity: 1;
        pointer-events: auto;
      }

      /* The resolution readout belongs to the windowed title bar only. */
      .floating-gpu-preview.is-fullscreen .preview-title {
        display: none !important;
      }

      /* Collapsed: everything folds away behind the toggle, which stays as the
         way back. */
      .floating-gpu-preview.is-fullscreen.controls-collapsed
        .preview-controls
        > *:not(.btn-controls-toggle) {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  /** Fold the cluster down to its toggle, or unfold it. */
  _setControlsCollapsed(collapsed) {
    this._controlsCollapsed = collapsed;
    this.container?.classList.toggle("controls-collapsed", collapsed);
    const btn = this.container?.querySelector(".btn-controls-toggle");
    if (btn) {
      setIcon(btn, collapsed ? "expand" : "collapse", { size: 13 });
      btn.title = collapsed ? "Show controls" : "Hide controls";
      btn.setAttribute("aria-label", btn.title);
    }
    if (collapsed) this._revealControls();
  }

  /** Show the cluster, and restart the idle countdown that hides it again. */
  _revealControls() {
    if (!this.isFullscreen || !this.container) return;
    this.container.classList.add("controls-visible");
    clearTimeout(this._controlsHideTimer);
    this._controlsHideTimer = setTimeout(() => {
      this.container?.classList.remove("controls-visible");
    }, 2400);
  }

  /** Start/stop the pointer watch that reveals the fullscreen cluster. */
  _setFullscreenControlsActive(active) {
    this.container?.classList.toggle("is-fullscreen", !!active);

    if (active) {
      this._ensureFullscreenChromeStyles();
      if (!this._onFullscreenPointerMove) {
        this._onFullscreenPointerMove = () => this._revealControls();
      }
      document.addEventListener("pointermove", this._onFullscreenPointerMove);
      // Visible on entry, then it fades unless the pointer moves.
      this._revealControls();
    } else {
      if (this._onFullscreenPointerMove) {
        document.removeEventListener("pointermove", this._onFullscreenPointerMove);
      }
      clearTimeout(this._controlsHideTimer);
      this.container?.classList.remove("controls-visible");
      this._setControlsCollapsed(false);
    }

    const toggle = this.container?.querySelector(".btn-controls-toggle");
    if (toggle) toggle.style.display = active ? "flex" : "none";
  }

  /**
   * Undo the fullscreen presentation: put the app chrome back and drop the
   * corner-cluster mode. Safe to call when not in fullscreen.
   *
   * Split out of toggleFullscreen so closing the panel mid-fullscreen restores
   * the same things exiting normally would.
   */
  _exitFullscreenChrome() {
    this._setFullscreenControlsActive(false);
    for (const [el, display] of this.originalFullscreenStyles?.chromeDisplay || []) {
      el.style.display = display;
    }
    this.isFullscreen = false;
  }

  async toggleFullscreen() {
    if (!this.isVisible || this.isDocked) return;

    const perfToken = this._getPerfMonitor()?.timeSection("previewFullscreen");
    this.isFullscreen = !this.isFullscreen;
    const btn = this.container.querySelector(".btn-fullscreen");
    // App chrome that has to get out of the way. #hud is the old toolbar (gone
    // from the markup, kept here because a layout may still provide one);
    // #top-menu-bar is today's menu bar, and it sits ABOVE the fullscreen panel
    // in the stacking order — left visible it clipped the control cluster.
    const chrome = ["hud", "top-menu-bar"]
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (this.isFullscreen) {
      // Save original container styles before entering fullscreen
      this.originalFullscreenStyles = {
        cssText: this.container.style.cssText,
        canvasWidth: this.gpuCanvas.width,
        canvasHeight: this.gpuCanvas.height,
        canvasStyleWidth: this.gpuCanvas.style.width,
        canvasStyleHeight: this.gpuCanvas.style.height,
        chromeDisplay: chrome.map((el) => [el, el.style.display]),
      };

      // Hide the app chrome for a true fullscreen experience.
      for (const el of chrome) el.style.display = "none";

      // Fullscreen renders the preview role, letterboxed to the output aspect.
      const { width, height } = resolveResolution("preview");
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
        ";position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;border-radius:0!important;border:none!important;display:flex!important;align-items:center!important;justify-content:center!important;";
      this._setFullscreenControlsActive(true);
      setIcon(btn, "fullscreen-exit", { size: 13 });
      btn.title = "Exit fullscreen";
    } else {
      this._setFullscreenControlsActive(false);

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

        // Restore the app chrome exactly as it was.
        for (const [el, display] of this.originalFullscreenStyles.chromeDisplay || []) {
          el.style.display = display;
        }
      }

      setIcon(btn, "fullscreen-enter", { size: 13 });
      btn.title = "Fullscreen";
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
      this._setButtonOn(lockBtn, true);
      lockBtn.title = "Unlock position";
      this.container.style.pointerEvents = "none";
      this.container.querySelector(".preview-header").style.pointerEvents = "auto";
      this.container.style.opacity = "0.7";
    } else {
      this._setButtonOn(lockBtn, false);
      lockBtn.title = "Lock position (click-through)";
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
          background: rgba(245, 165, 36, 0.14);
          border: 1px solid rgba(245, 165, 36, 0.35);
          color: #f5a524;
          padding: 4px 9px;
          border-radius: 999px;
          font-family: ${FONT_MONO};
          font-size: 10px;
          font-weight: 500;
          z-index: 1000;
          pointer-events: none;
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
      background: ${SURFACE.surface};
      /* PERFORMANCE: backdrop-filter disabled to prevent periodic FPS drops */
      /* backdrop-filter: blur(20px); */
      will-change: transform, opacity;
      border: 1px solid ${SURFACE.lineStrong};
      border-radius: 14px;
      box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.75), 0 4px 16px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 244, 230, 0.06);
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
        background: ${SURFACE.surface};
        /* PERFORMANCE: backdrop-filter disabled to prevent periodic FPS drops */
        /* backdrop-filter: blur(20px); */
        will-change: transform, opacity;
        border: 1px solid ${SURFACE.lineStrong};
        border-radius: 14px;
        box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.75), 0 4px 16px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 244, 230, 0.06);
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
      padding: 0 10px;
      gap: 9px;
      background: linear-gradient(rgba(255, 244, 230, 0.05), rgba(255, 244, 230, 0.02));
      border-bottom: 1px solid ${SURFACE.line};
      cursor: ${this.isDocked ? "default" : "move"};
      user-select: none;
      height: ${headerHeight}px;
      box-sizing: border-box;
    `;

    const title = document.createElement("div");
    title.className = "preview-title";
    title.style.cssText = `color: ${TEXT.primary}; font-family: ${FONT_UI}; font-size: 12.5px; font-weight: 600;`;

    const controls = document.createElement("div");
    controls.className = "preview-controls";
    controls.style.cssText = "display: flex; gap: 2px; align-items: center;";

    const settingsBtn = this._createButton("Preview settings", "btn-settings", "preferences");
    settingsBtn.onclick = (e) => {
      e.stopPropagation();
      this.settings.showSettings();
    };

    const dockBtn = this._createButton(
      this.isDocked ? "Float this panel" : "Dock to the corner",
      "btn-dock",
      this.isDocked ? "floating-windows" : "panel-preview",
    );
    dockBtn.onclick = (e) => {
      e.stopPropagation();
      this.toggleDocked();
    };

    controls.appendChild(settingsBtn);
    controls.appendChild(dockBtn);

    if (!this.isDocked) {
      const lockBtn = this._createButton(
        "Lock position (click-through)", "btn-lock", "lock-param",
      );
      const fullscreenBtn = this._createButton(
        "Fullscreen", "btn-fullscreen", "fullscreen-enter",
      );

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

    const closeBtn = this._createButton("Close", "btn-close", "close", { danger: true });
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.hide();
    };
    controls.appendChild(closeBtn);

    // Collapses the cluster to just this chevron. Only meaningful in
    // fullscreen, where the controls float over the render — hidden otherwise,
    // since the windowed header has room for all of them.
    const collapseBtn = this._createButton(
      "Hide controls",
      "btn-controls-toggle",
      "collapse",
    );
    collapseBtn.style.display = "none";
    collapseBtn.onclick = (e) => {
      e.stopPropagation();
      this._setControlsCollapsed(!this._controlsCollapsed);
    };
    controls.appendChild(collapseBtn);

    header.appendChild(title);
    header.appendChild(controls);

const canvasWrapper = document.createElement("div");
canvasWrapper.className = "preview-canvas-wrapper";
canvasWrapper.style.cssText = `
  width: 100%; 
  height: calc(100% - ${headerHeight}px); 
  background: ${SURFACE.deep}; 
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
      background: rgba(10, 9, 8, 0.55);
      backdrop-filter: blur(6px);
      color: ${ACCENT.base};
      padding: 4px 8px;
      border-radius: 7px;
      font-family: ${FONT_MONO};
      font-size: 11px;
      font-weight: 500;
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

    container.appendChild(header);
    container.appendChild(canvasWrapper);

    this._updateTitle();

    return container;
  }

  /**
   * A window control: a 22px icon button, quiet until pointed at.
   *
   * `icon` is a sprite id (src/assets/icons-sprite.js); `label` becomes the
   * tooltip and the accessible name. Text labels made the header a row of words
   * that read louder than the render they sit above — and in fullscreen they
   * became a strip of buttons across the top of the image.
   */
  _createButton(label, className, icon, { danger = false } = {}) {
    const btn = document.createElement("button");
    btn.className = className;
    btn.type = "button";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.dataset.danger = danger ? "1" : "";
    setIcon(btn, icon, { size: 13 });
    btn.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      flex: none;
      background: transparent;
      border: none;
      color: ${TEXT.tertiary};
      cursor: pointer;
      padding: 0;
      border-radius: 6px;
      transition: background 0.15s ease, color 0.15s ease;
    `;

    // Window controls stay near-invisible until pointed at — the render is the
    // content, the chrome around it should not compete with it.
    btn.onmouseenter = () => {
      btn.style.background = danger
        ? withAlpha(SEMANTIC.error, 0.18)
        : SURFACE.hover;
      btn.style.color = danger ? SEMANTIC.error : "#ffffff";
    };
    btn.onmouseleave = () => {
      btn.style.background = "transparent";
      btn.style.color = btn.dataset.on === "1" ? ACCENT.base : TEXT.tertiary;
    };

    return btn;
  }

  /** Light a toggle button in the accent while its state is ON. */
  _setButtonOn(btn, on) {
    if (!btn) return;
    btn.dataset.on = on ? "1" : "";
    btn.style.color = on ? ACCENT.base : TEXT.tertiary;
    btn.style.background = on ? withAlpha(ACCENT.base, 0.16) : "transparent";
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

      // Keep 200x150 of the panel reachable, and its header clear of the top
      // menu bar: the bar paints above the panel, so a header dragged into it
      // is gone - no grab handle, no close button, and the clicks land on
      // File / Edit / View instead.
      this._pendingDragPosition = clampPanelPosition(
        startLeft + deltaX,
        startTop + deltaY,
        { keepVisibleX: 200, keepVisibleY: 150 },
      );
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
    this._setupViewportResizeClamp();
  }

  /**
   * Bring the panel back inside the viewport when the window is resized —
   * shrinking the browser under a panel parked near an edge would otherwise
   * strand it off screen, or leave one near the top inside the menu bar.
   *
   * Fullscreen and docked mode own the panel's geometry (fullscreen pins it to
   * the whole viewport with !important, and hides the menu bar while it does),
   * so the clamp stands aside for both.
   */
  _setupViewportResizeClamp() {
    if (this._viewportResizeHandler) {
      window.removeEventListener("resize", this._viewportResizeHandler);
    }

    this._viewportResizeHandler = () => {
      if (!this.container || this.isFullscreen || this.isDocked) return;

      const bounded = keepPanelInBounds(this.container, {
        keepVisibleX: 200,
        keepVisibleY: 150,
      });
      if (!bounded) return;

      // Keep the mirror the drag code reads on mousedown in step.
      this.position.x = bounded.left;
      this.position.y = bounded.top;
    };

    window.addEventListener("resize", this._viewportResizeHandler);
  }


  /**
   * Free resize: width and height move independently and the render is
   * letterboxed inside the result, so the panel is never forced back to the
   * render's aspect ratio. Every edge and corner is grabbable, in both docking
   * modes — docked the panel keeps its top-right anchor, so widening it grows
   * the window into the canvas rather than off the side of the screen.
   *
   * The size itself is written by the shared handler; what happens here is the
   * part that is this panel's own — re-fitting the render into the new box, on
   * a frame, and remembering the size for the next session.
   */
  _setupResize() {
    this._cleanupResizable?.();

    this._cleanupResizable = makeResizable(this.container, {
      minWidth: MIN_PANEL_WIDTH,
      minHeight: MIN_PANEL_HEIGHT,
      // Fullscreen owns the whole viewport, and a locked panel is click-through
      // scenery — neither is the user's to drag a border on.
      enabled: () => !this.isFullscreen && !this.isLocked,
      anchor: () => (this.isDocked ? { x: "right", y: "top" } : { x: "left", y: "top" }),
      onResize: ({ width, height }) => {
        this.isResizing = true;
        this._pendingResizeDimensions = { width, height };
        this._scheduleResizeFlush();
      },
      onResizeEnd: ({ width, height }) => {
        this._pendingResizeDimensions = { width, height };
        this._flushResizeDimensions();
        this.isResizing = false;
      },
    });
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
    // How fast the GPU finishes a frame: EMA of the interval between completed
    // submissions. This is a real measurement and worth showing — a heavy graph
    // pushes it up — but it is NOT the rate you see. When the GPU keeps up it
    // settles at whatever cadence the render loop dispatches at, which on the
    // default fixed timestep is 60/sec regardless of the display. It used to be
    // printed as "FPS", which is why this app claimed 60 on a 48Hz clock. The
    // fps figure now comes from presentedFrameRate; this stands beside it,
    // labelled as GPU time.
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
    // Frames presented, not frames dispatched. See presentedFrameRate.js.
    this.fps = Math.round(getPresentedFps());

    // Use cached element reference instead of DOM query
    if (!this.fpsOverlayElement) {
      this.fpsOverlayElement = document.querySelector(".fps-overlay");
    }

    if (this.fpsOverlayElement) {
      // Two numbers that answer different questions: what you are seeing, and
      // what the GPU is costing. When they disagree — 48 fps against 16.7ms of
      // GPU — the GPU is keeping up and something downstream of it is not.
      const ms = this._frameMsEma > 0 ? `${this._frameMsEma.toFixed(1)} ms GPU` : "-- ms GPU";
      this.fpsOverlayElement.textContent = `${this.fps} fps · ${ms}`;
    }
  }
  
  // Method to refresh cached element reference (call when DOM changes)
  refreshElementCache() {
    this.fpsOverlayElement = document.querySelector(".fps-overlay");
  }
}
