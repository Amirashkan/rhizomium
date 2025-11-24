import { getFrameBudgetAllocator } from './FrameBudgetAllocator.js';
import { getInteractionStateManager } from './InteractionStateManager.js';

const STORAGE_KEY = "previewPerfOverlay";
const HASH_FLAG = "previewPerf";
const QUERY_FLAG = "previewPerf";
const OVERLAY_UPDATE_MS = 250;
const OVERLAY_UPDATE_MS_INTERACTION = 100; // 10 FPS during interactions
const FRAME_THROTTLE_INTERACTION = 4; // Update every 4 frames during interactions (3-5 range)
const IDLE_CALLBACK_TIMEOUT = 100; // ms timeout for requestIdleCallback

export class PreviewPerfMonitor {
  constructor(options = {}) {
    this.enabled = this._shouldEnable(options.forceEnable);
    this.metrics = {
      frameMs: 0,
      gpuMs: 0,
      canvasMs: 0,
      previewDomMs: 0,
      rafDelta: 0,
      layoutReads: 0,
      layoutWrites: 0,
      lastLayoutRead: "-",
      lastLayoutWrite: "-",
      interactionState: "idle",
      interactionDuration: 0,
      qualityLevel: 1.0,
      interactionMetrics: null
    };
    this._lastFrameStart = 0;
    this._overlay = null;
    this._pendingOverlayUpdate = false;
    this._lastOverlayUpdate = 0;
    
    // Interaction-aware profiler mode
    this._isInteractionMode = false;
    this._frameCounter = 0;
    this._frameStarted = false; // Track if current frame was actually started
    this._pendingQueries = [];
    this._idleCallbackScheduled = false;
    this._pendingMetrics = {};
    this._batchUpdateScheduled = false;
    
    // Frame budget allocator integration
    this.budgetAllocator = getFrameBudgetAllocator();
    this.interactionStateManager = getInteractionStateManager();
    
    // Track section timings for budget allocation
    this._currentSections = new Map();
    
    // Interaction tracking
    this._interactionEvents = [];
    this._maxInteractionEvents = 50;
    this._interactionMetrics = {
      totalInteractions: 0,
      totalInteractionTime: 0,
      averageInteractionDuration: 0,
      longestInteraction: 0,
      interactionsByType: {}
    };
    
    // Setup interaction event listeners
    this._setupInteractionListeners();

    if (this.enabled) {
      this._ensureOverlay();
      this._installDebugHooks();
    }
  }
  
  /**
   * Setup listeners for interaction events
   */
  _setupInteractionListeners() {
    // Listen to interaction start events
    this.interactionStateManager.addEventListener('interactionstart', (event) => {
      this._logInteractionEvent('start', event);
      this._isInteractionMode = true;
      this.metrics.interactionState = event.type;
    });
    
    // Listen to interaction end events
    this.interactionStateManager.addEventListener('interactionend', (event) => {
      this._logInteractionEvent('end', event);
      this._updateInteractionMetrics(event);
    });
    
    // Listen to quality change events
    this.interactionStateManager.addEventListener('qualitychange', (event) => {
      this.metrics.qualityLevel = event.quality;
    });
    
    // Listen to cooldown end events
    this.interactionStateManager.addEventListener('cooldownend', (event) => {
      this._logInteractionEvent('cooldownend', event);
      if (!this.interactionStateManager.isAnyInteractionActive()) {
        this._isInteractionMode = false;
        this.metrics.interactionState = 'idle';
      }
    });
  }
  
  /**
   * Log an interaction event
   */
  _logInteractionEvent(type, event) {
    if (!this.enabled) return;
    
    const logEntry = {
      type,
      timestamp: performance.now(),
      interactionType: event.type,
      duration: event.duration || 0,
      state: event.state
    };
    
    this._interactionEvents.push(logEntry);
    
    // Limit event history
    if (this._interactionEvents.length > this._maxInteractionEvents) {
      this._interactionEvents.shift();
    }
    
    // Log to console if enabled (for debugging)
    if (window.DEBUG_INTERACTION_EVENTS) {
      console.log(`[PreviewPerfMonitor] Interaction ${type}:`, logEntry);
    }
  }
  
  /**
   * Update interaction metrics
   */
  _updateInteractionMetrics(event) {
    if (!event.duration) return;
    
    this._interactionMetrics.totalInteractions++;
    this._interactionMetrics.totalInteractionTime += event.duration;
    this._interactionMetrics.averageInteractionDuration = 
      this._interactionMetrics.totalInteractionTime / this._interactionMetrics.totalInteractions;
    
    if (event.duration > this._interactionMetrics.longestInteraction) {
      this._interactionMetrics.longestInteraction = event.duration;
    }
    
    const type = event.type || 'unknown';
    this._interactionMetrics.interactionsByType[type] = 
      (this._interactionMetrics.interactionsByType[type] || 0) + 1;
    
    // Update metrics in display
    this.metrics.interactionDuration = event.duration;
    this.metrics.interactionMetrics = { ...this._interactionMetrics };
  }
  
  /**
   * Get interaction metrics
   */
  getInteractionMetrics() {
    return {
      ...this._interactionMetrics,
      currentInteractionDuration: this.interactionStateManager.getInteractionDuration(),
      currentInteractionType: this.interactionStateManager.getInteractionType(),
      qualityLevel: this.interactionStateManager.getQualityLevel(),
      cooldownActive: this.interactionStateManager.isCooldownActive()
    };
  }
  
  /**
   * Get interaction event history
   */
  getInteractionEvents() {
    return [...this._interactionEvents];
  }

  beginFrame(frameState = {}) {
    if (!this.enabled) {
      this._frameStarted = false;
      return;
    }
    
    // Update interaction state from manager
    const interactionState = this.interactionStateManager.getState();
    this._isInteractionMode = interactionState.isInteracting;
    this.metrics.interactionDuration = interactionState.interactionDuration;
    this.metrics.qualityLevel = interactionState.currentQualityLevel;
    
    // Update budget allocator mode based on interaction state
    if (interactionState.isPanning) {
      this.budgetAllocator.setMode('panning');
    } else {
      this.budgetAllocator.setMode('normal');
    }
    
    // Start frame tracking in budget allocator
    this.budgetAllocator.beginFrame();
    
    // Throttle profiler updates during interactions (every 3-5 frames)
    if (this._isInteractionMode) {
      this._frameCounter++;
      // Only process every Nth frame during interactions
      if (this._frameCounter % FRAME_THROTTLE_INTERACTION !== 0) {
        this._frameStarted = false;
        return; // Skip this frame
      }
    } else {
      this._frameCounter = 0;
    }
    
    this._frameStarted = true;
    this._lastFrameStart = performance.now();
    this.metrics.rafDelta = Number(frameState.deltaTime) || 0;
    this.metrics.interactionState = frameState.manual ? "manual" : (interactionState.currentInteractionType || "idle");
  }

  endFrame(extra = {}) {
    if (!this.enabled || !this._frameStarted || !this._lastFrameStart) {
      this._frameStarted = false;
      return;
    }
    
    const frameTime = performance.now() - this._lastFrameStart;
    
    // Record times in budget allocator
    this.budgetAllocator.recordTime('canvas', this.metrics.canvasMs || 0);
    this.budgetAllocator.recordTime('gpuPreview', this.metrics.gpuMs || 0);
    this.budgetAllocator.recordTime('other', (this.metrics.previewDomMs || 0) + (extra.otherTime || 0));
    
    // End frame in budget allocator and get analysis
    const budgetAnalysis = this.budgetAllocator.endFrame();
    
    // During interactions, only track high-level metrics (FPS, frame time)
    if (this._isInteractionMode) {
      // Only update frame time, skip detailed metrics
      this.metrics.frameMs = frameTime;
      // Store extra metrics for later processing if not in interaction mode
      Object.keys(extra).forEach(key => {
        this._pendingMetrics[key] = extra[key];
      });
      // Store budget analysis
      this.metrics.budgetExceeded = budgetAnalysis.exceeded;
      // Throttled overlay update during interactions
      this._scheduleOverlayUpdate(false);
    } else {
      // Full profiling when not interacting
      this.metrics.frameMs = frameTime;
      Object.assign(this.metrics, extra);
      // Apply any pending metrics from interaction mode
      if (Object.keys(this._pendingMetrics).length > 0) {
        Object.assign(this.metrics, this._pendingMetrics);
        this._pendingMetrics = {};
      }
      // Store budget analysis
      this.metrics.budgetExceeded = budgetAnalysis.exceeded;
      this.metrics.budgetStats = this.budgetAllocator.getStats();
      this._scheduleOverlayUpdate(true);
    }
    
    this._frameStarted = false;
  }

  timeSection(name) {
    if (!this.enabled) return null;
    
    // Skip detailed dispatch timing during canvas interactions
    if (this._isInteractionMode && name !== "gpu" && name !== "canvas") {
      return null; // Don't track detailed sections during interactions
    }
    
    return { name, start: performance.now() };
  }

  endSection(token, extra = {}) {
    if (!this.enabled || !token) return 0;
    
    // Skip detailed dispatch timing during canvas interactions
    if (this._isInteractionMode && token.name !== "gpu" && token.name !== "canvas") {
      return 0;
    }
    
    const duration = performance.now() - token.start;
    
    // Record time in budget allocator
    if (token.name === "gpu" || token.name === "preview") {
      this.budgetAllocator.recordTime('gpuPreview', duration);
    } else if (token.name === "canvas") {
      this.budgetAllocator.recordTime('canvas', duration);
    } else {
      this.budgetAllocator.recordTime('other', duration);
    }
    
    // During interactions, defer query resolution to requestIdleCallback
    if (this._isInteractionMode) {
      // Batch queries for later resolution
      this._pendingQueries.push({
        type: 'section',
        name: token.name,
        duration,
        extra
      });
      this._scheduleIdleCallback();
      return duration;
    }
    
    // Normal processing when not in interaction mode
    if (token.name === "gpu") {
      this.metrics.gpuMs = duration;
    } else if (token.name === "canvas") {
      this.metrics.canvasMs = duration;
    } else if (token.name === "previewDom") {
      this.metrics.previewDomMs = duration;
    } else {
      this.metrics[token.name] = duration;
    }
    Object.assign(this.metrics, extra);
    this._scheduleOverlayUpdate(false);
    return duration;
  }

  recordValue(name, value) {
    if (!this.enabled) return;
    this.metrics[name] = value;
    this._scheduleOverlayUpdate(false);
  }

  recordInteractionState(state) {
    if (!this.enabled) return;
    
    const wasInteracting = this._isInteractionMode;
    let newState = "idle";
    
    if (typeof state === "string") {
      newState = state;
      this._isInteractionMode = state === "canvas-interaction" || state === "dragging" || state === "panning";
    } else if (state?.isCanvasInteracting) {
      newState = "canvas-interaction";
      this._isInteractionMode = true;
    } else if (state?.isDragging) {
      newState = "dragging";
      this._isInteractionMode = true;
    } else if (state?.isPanning) {
      newState = "panning";
      this._isInteractionMode = true;
    } else {
      newState = "idle";
      this._isInteractionMode = false;
    }
    
    this.metrics.interactionState = newState;
    
    // Update interaction state manager
    if (state?.isPanning !== undefined) {
      this.interactionStateManager.setPanning(state.isPanning);
    }
    if (state?.isDragging !== undefined) {
      this.interactionStateManager.setDragging(state.isDragging);
    }
    
    // When switching from interaction to idle, process pending queries
    if (wasInteracting && !this._isInteractionMode) {
      this._processPendingQueries();
      this._frameCounter = 0; // Reset frame counter
    }
    
    // Skip query resolution entirely if interaction is very active
    if (this._isInteractionMode && this._pendingQueries.length > 10) {
      // Too many pending queries, clear them to avoid backlog
      this._pendingQueries = [];
    }
    
    this._scheduleOverlayUpdate(false);
  }

  recordLayoutRead(reason = "") {
    if (!this.enabled) return;
    this.metrics.layoutReads += 1;
    if (reason) {
      this.metrics.lastLayoutRead = reason;
    }
    this._scheduleOverlayUpdate(false);
  }

  recordLayoutWrite(reason = "") {
    if (!this.enabled) return;
    this.metrics.layoutWrites += 1;
    if (reason) {
      this.metrics.lastLayoutWrite = reason;
    }
    this._scheduleOverlayUpdate(false);
  }

  resetLayoutCounters() {
    if (!this.enabled) return;
    this.metrics.layoutReads = 0;
    this.metrics.layoutWrites = 0;
    this.metrics.lastLayoutRead = "-";
    this.metrics.lastLayoutWrite = "-";
    this._scheduleOverlayUpdate(false);
  }

  attachAsyncMetric(name, promise) {
    if (!this.enabled || !promise || typeof promise.then !== "function") {
      return;
    }
    const start = performance.now();
    
    // During interactions, defer async metric resolution
    if (this._isInteractionMode) {
      this._pendingQueries.push({
        type: 'async',
        name,
        promise,
        start
      });
      this._scheduleIdleCallback();
      return;
    }
    
    // Normal processing when not in interaction mode
    promise
      .then(() => {
        this.metrics[name] = performance.now() - start;
        this._scheduleOverlayUpdate(false);
      })
      .catch(() => {});
  }

  toggle(enabled) {
    const shouldEnable = enabled !== undefined ? enabled : !this.enabled;
    if (shouldEnable === this.enabled) return;
    this.enabled = shouldEnable;
    if (this.enabled) {
      window.localStorage?.setItem(STORAGE_KEY, "true");
      this._ensureOverlay(true);
    } else {
      window.localStorage?.removeItem(STORAGE_KEY);
      this._destroyOverlay();
    }
  }

  _shouldEnable(forceEnable) {
    if (forceEnable !== undefined) return !!forceEnable;
    const lsFlag = window.localStorage?.getItem(STORAGE_KEY) === "true";
    const hashFlag = window.location?.hash?.includes(HASH_FLAG);
    const queryFlag = window.location?.search?.includes(QUERY_FLAG);
    return !!(lsFlag || hashFlag || queryFlag);
  }

  _ensureOverlay(force = false) {
    if (!this.enabled) return;
    if (this._overlay && !force) return;

    const create = () => {
      if (this._overlay && !force) return;
      if (this._overlay && force) {
        this._overlay.remove();
        this._overlay = null;
      }

      const overlay = document.createElement("div");
      overlay.id = "preview-perf-overlay";
      overlay.style.cssText = `
        position: fixed;
        top: 12px;
        right: 12px;
        padding: 8px 10px;
        background: rgba(5, 5, 10, 0.85);
        color: #d0f6ff;
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 11px;
        line-height: 1.35;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        border-radius: 8px;
        z-index: 1000;
        pointer-events: none;
        white-space: pre;
      `;
      overlay.textContent = "Preview Perf Overlay (no data)";
      document.body.appendChild(overlay);
      this._overlay = overlay;
      this._scheduleOverlayUpdate(true);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", create, { once: true });
    } else {
      create();
    }
  }

  _destroyOverlay() {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
  }

  _scheduleOverlayUpdate(forceImmediate) {
    if (!this.enabled || !this._overlay) return;
    
    // Throttle overlay updates during interactions (max 10 FPS)
    const updateInterval = this._isInteractionMode 
      ? OVERLAY_UPDATE_MS_INTERACTION 
      : OVERLAY_UPDATE_MS;
    
    const now = performance.now();
    if (forceImmediate || now - this._lastOverlayUpdate > updateInterval) {
      this._lastOverlayUpdate = now;
      this._pendingOverlayUpdate = false;
      this._batchUpdateOverlay();
      return;
    }

    // Batch multiple metric updates into single DOM write
    if (this._pendingOverlayUpdate) return;
    this._pendingOverlayUpdate = true;
    
    if (this._isInteractionMode && window.requestIdleCallback) {
      // Use requestIdleCallback during interactions to avoid blocking
      window.requestIdleCallback(() => {
        this._pendingOverlayUpdate = false;
        this._batchUpdateOverlay();
      }, { timeout: IDLE_CALLBACK_TIMEOUT });
    } else {
      requestAnimationFrame(() => {
        this._pendingOverlayUpdate = false;
        this._batchUpdateOverlay();
      });
    }
  }
  
  _batchUpdateOverlay() {
    if (!this._overlay) return;
    
    // Batch multiple metric updates into single DOM write
    if (this._batchUpdateScheduled) return;
    this._batchUpdateScheduled = true;
    
    // Use requestAnimationFrame to batch all pending updates
    requestAnimationFrame(() => {
      this._batchUpdateScheduled = false;
      this._updateOverlay();
    });
  }

  _updateOverlay() {
    if (!this._overlay) return;
    const {
      frameMs,
      gpuMs,
      canvasMs,
      previewDomMs,
      rafDelta,
      layoutReads,
      layoutWrites,
      lastLayoutRead,
      lastLayoutWrite,
      interactionState,
      interactionDuration,
      qualityLevel,
      interactionMetrics,
      budgetExceeded,
      budgetStats,
    } = this.metrics;
    
    const budgets = this.budgetAllocator.getBudgets();
    const qualityMultiplier = this.budgetAllocator.getQualityMultiplier();
    const interactionQuality = (qualityLevel || 1.0) * 100;

    // During interactions, show only high-level metrics (FPS, frame time)
    let lines;
    if (this._isInteractionMode) {
      const fps = frameMs > 0 ? (1000 / frameMs).toFixed(1) : "0.0";
      const budgetStatus = budgetExceeded ? "⚠ EXCEEDED" : "✓ OK";
      const duration = interactionDuration > 0 ? `${(interactionDuration / 1000).toFixed(1)}s` : "-";
      lines = [
        `Frame: ${frameMs.toFixed(1)} ms (${fps} FPS) ${budgetStatus}`,
        `GPU   : ${gpuMs.toFixed(1)} / ${budgets.gpuPreview.toFixed(1)} ms`,
        `Canvas: ${canvasMs.toFixed(1)} / ${budgets.canvas.toFixed(1)} ms`,
        `Quality: ${(qualityMultiplier * 100).toFixed(0)}% (${interactionQuality.toFixed(0)}%)`,
        `State: ${interactionState} [${duration}] [LIGHT]`,
      ];
    } else {
      // Full metrics when not interacting
      const budgetStatus = budgetExceeded ? "⚠ EXCEEDED" : "✓ OK";
      lines = [
        `Frame: ${frameMs.toFixed(1)} ms (RAF Δ ${rafDelta.toFixed(1)} ms) ${budgetStatus}`,
        `GPU   : ${gpuMs.toFixed(1)} / ${budgets.gpuPreview.toFixed(1)} ms`,
        `Canvas: ${canvasMs.toFixed(1)} / ${budgets.canvas.toFixed(1)} ms`,
        `Other : ${(previewDomMs || 0).toFixed(1)} / ${budgets.other.toFixed(1)} ms`,
        `Preview DOM: ${previewDomMs.toFixed(1)} ms`,
        `Quality: ${(qualityMultiplier * 100).toFixed(0)}% (${interactionQuality.toFixed(0)}%)`,
        `Layout R/W: ${layoutReads}/${layoutWrites}`,
        `Last Read: ${lastLayoutRead}`,
        `Last Write: ${lastLayoutWrite}`,
        `State: ${interactionState}`,
      ];
      
      if (budgetStats) {
        lines.push(`Avg Frame: ${budgetStats.avgFrameTime.toFixed(1)} ms`);
      }
      
      // Show interaction metrics if available
      if (interactionMetrics && interactionMetrics.totalInteractions > 0) {
        lines.push(``);
        lines.push(`Interactions: ${interactionMetrics.totalInteractions}`);
        lines.push(`Avg Duration: ${interactionMetrics.averageInteractionDuration.toFixed(0)}ms`);
        lines.push(`Longest: ${interactionMetrics.longestInteraction.toFixed(0)}ms`);
      }
    }

    // Use textContent for now (could be optimized with CSS transforms if needed)
    this._overlay.textContent = lines.join("\n");
  }
  
  _scheduleIdleCallback() {
    if (this._idleCallbackScheduled) return;
    if (!window.requestIdleCallback) {
      // Fallback: process immediately if requestIdleCallback not available
      this._processPendingQueries();
      return;
    }
    
    this._idleCallbackScheduled = true;
    window.requestIdleCallback(() => {
      this._idleCallbackScheduled = false;
      this._processPendingQueries();
    }, { timeout: IDLE_CALLBACK_TIMEOUT });
  }
  
  _processPendingQueries() {
    if (this._pendingQueries.length === 0) return;
    
    // Batch multiple frame queries together
    const queries = this._pendingQueries.splice(0);
    
    queries.forEach(query => {
      if (query.type === 'section') {
        // Process section timing
        if (query.name === "gpu") {
          this.metrics.gpuMs = query.duration;
        } else if (query.name === "canvas") {
          this.metrics.canvasMs = query.duration;
        } else if (query.name === "previewDom") {
          this.metrics.previewDomMs = query.duration;
        } else {
          this.metrics[query.name] = query.duration;
        }
        if (query.extra) {
          Object.assign(this.metrics, query.extra);
        }
      } else if (query.type === 'async') {
        // Process async metrics
        query.promise
          .then(() => {
            this.metrics[query.name] = performance.now() - query.start;
            this._scheduleOverlayUpdate(false);
          })
          .catch(() => {});
      }
    });
    
    // Schedule overlay update after processing queries
    this._scheduleOverlayUpdate(false);
  }

  getMetric(name) {
    return this.metrics?.[name];
  }
  
  /**
   * Get frame budget allocator instance
   */
  getBudgetAllocator() {
    return this.budgetAllocator;
  }
  
  /**
   * Get interaction state manager instance
   */
  getInteractionStateManager() {
    return this.interactionStateManager;
  }

  _installDebugHooks() {
    if (window.previewPerfToggleInstalled) return;
    window.previewPerfToggleInstalled = true;
    window.togglePreviewPerfOverlay = () => this.toggle();
    console.info(
      "[PreviewPerfMonitor] Overlay ready. Call window.togglePreviewPerfOverlay() or set localStorage.previewPerfOverlay = 'true' to persist."
    );
  }
}

