import { getFrameBudgetAllocator } from './FrameBudgetAllocator.js';
import { getInteractionStateManager } from './InteractionStateManager.js';
import { getPerformanceLogger } from './PerformanceLogger.js';
import { getPerformanceBenchmark } from './PerformanceBenchmark.js';
import { getPerformanceDashboard } from './PerformanceDashboard.js';
import { getPerformanceAnalyzer } from './PerformanceAnalyzer.js';

const STORAGE_KEY = "previewPerfOverlay";
const HASH_FLAG = "previewPerf";
const QUERY_FLAG = "previewPerf";
const OVERLAY_UPDATE_MS = 250;
const OVERLAY_UPDATE_MS_INTERACTION = 100; // 10 FPS during interactions
const FRAME_THROTTLE_INTERACTION = 2; // Update every 2 frames during interactions (less aggressive)
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
    this.performanceLogger = getPerformanceLogger();
    
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
    
    // Alert system for performance spikes
    this._alertConfig = {
      enabled: true,
      redrawSpikeThreshold: 50, // ms - frame time threshold
      redrawSpikeWindow: 5, // frames - window to check for spikes
      consecutiveSpikesThreshold: 3, // consecutive spikes before alert
      alertCooldown: 5000, // ms - minimum time between alerts
      onAlert: null // Callback for alerts
    };
    this._frameTimeHistory = [];
    this._lastAlertTime = 0;
    this._spikeCount = 0;
    this._alerts = [];
    this._maxAlerts = 100;
    
    // Setup interaction event listeners
    this._setupInteractionListeners();

    // Always install debug hooks so they're available even when monitor is disabled
    this._installDebugHooks();

    if (this.enabled) {
      this._ensureOverlay();
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
    
    // Start performance logger frame
    this.performanceLogger.startFrame(this._frameCounter, performance.now());
    
    // CRITICAL FIX: Always start frame timing, even during interactions
    // Only skip detailed metric collection, not frame timing itself
    this._frameStarted = true;
    this._lastFrameStart = performance.now();
    this.metrics.rafDelta = Number(frameState.deltaTime) || 0;
    this.metrics.interactionState = frameState.manual ? "manual" : (interactionState.currentInteractionType || "idle");
    
    // Track if this frame should collect detailed metrics
    if (this._isInteractionMode) {
      this._frameCounter++;
      // Only collect detailed metrics every Nth frame, but always measure frame time
      this._collectDetailedMetrics = (this._frameCounter % FRAME_THROTTLE_INTERACTION === 0);
    } else {
      this._frameCounter = 0;
      this._collectDetailedMetrics = true;
    }
  }

  endFrame(extra = {}) {
    if (!this.enabled || !this._frameStarted || !this._lastFrameStart) {
      this._frameStarted = false;
      // End logger frame even if not started
      if (this.performanceLogger.currentFrame) {
        this.performanceLogger.endFrame();
      }
      return;
    }
    
    const frameTime = performance.now() - this._lastFrameStart;
    
    // Record times in budget allocator
    this.budgetAllocator.recordTime('canvas', this.metrics.canvasMs || 0);
    this.budgetAllocator.recordTime('gpuPreview', this.metrics.gpuMs || 0);
    this.budgetAllocator.recordTime('other', (this.metrics.previewDomMs || 0) + (extra.otherTime || 0));
    
    // Log system times to performance logger
    this.performanceLogger.logSystemTime('canvas', this.metrics.canvasMs || 0);
    this.performanceLogger.logSystemTime('gpu', this.metrics.gpuMs || 0);
    this.performanceLogger.logSystemTime('other', (this.metrics.previewDomMs || 0) + (extra.otherTime || 0));
    
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
    
    // End performance logger frame
    this.performanceLogger.endFrame();
    
    // Check for redraw spikes
    this._checkRedrawSpikes(frameTime);
    
    this._frameStarted = false;
  }

  /**
   * Check for redraw spikes and trigger alerts
   * @private
   */
  _checkRedrawSpikes(frameTime) {
    if (!this._alertConfig.enabled) return;
    
    // Add to history
    this._frameTimeHistory.push(frameTime);
    if (this._frameTimeHistory.length > this._alertConfig.redrawSpikeWindow) {
      this._frameTimeHistory.shift();
    }
    
    // Check if current frame is a spike
    const isSpike = frameTime > this._alertConfig.redrawSpikeThreshold;
    
    if (isSpike) {
      this._spikeCount++;
      
      // Check if we have consecutive spikes
      if (this._spikeCount >= this._alertConfig.consecutiveSpikesThreshold) {
        const now = performance.now();
        const timeSinceLastAlert = now - this._lastAlertTime;
        
        // Only alert if cooldown has passed
        if (timeSinceLastAlert >= this._alertConfig.alertCooldown) {
          this._triggerRedrawSpikeAlert(frameTime);
          this._lastAlertTime = now;
        }
      }
    } else {
      // Reset spike count if frame is normal
      this._spikeCount = 0;
    }
  }

  /**
   * Trigger a redraw spike alert
   * @private
   */
  _triggerRedrawSpikeAlert(frameTime) {
    const alert = {
      type: 'redraw-spike',
      timestamp: performance.now(),
      frameTime: frameTime,
      threshold: this._alertConfig.redrawSpikeThreshold,
      consecutiveSpikes: this._spikeCount,
      interactionState: this.metrics.interactionState,
      metrics: {
        gpu: this.metrics.gpuMs,
        canvas: this.metrics.canvasMs,
        other: this.metrics.previewDomMs || 0
      },
      frameTimeHistory: [...this._frameTimeHistory]
    };
    
    // Store alert
    this._alerts.push(alert);
    if (this._alerts.length > this._maxAlerts) {
      this._alerts.shift();
    }
    
    // Log to console
    console.warn('[PreviewPerfMonitor] Redraw spike detected:', {
      frameTime: `${frameTime.toFixed(1)}ms`,
      threshold: `${this._alertConfig.redrawSpikeThreshold}ms`,
      consecutiveSpikes: this._spikeCount,
      state: this.metrics.interactionState
    });
    
    // Call alert callback if provided
    if (this._alertConfig.onAlert) {
      try {
        this._alertConfig.onAlert(alert);
      } catch (error) {
        console.error('[PreviewPerfMonitor] Alert callback error:', error);
      }
    }
    
    // Emit event for external listeners
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      window.dispatchEvent(new CustomEvent('perf-alert', { detail: alert }));
    }
  }

  /**
   * Configure alert system
   * @param {Object} config - Alert configuration
   */
  configureAlerts(config) {
    this._alertConfig = { ...this._alertConfig, ...config };
  }

  /**
   * Get recent alerts
   * @param {number} count - Number of recent alerts to return
   * @returns {Array} Array of alerts
   */
  getAlerts(count = 10) {
    return this._alerts.slice(-count);
  }

  /**
   * Clear alerts
   */
  clearAlerts() {
    this._alerts = [];
  }

  /**
   * Get alert statistics
   * @returns {Object} Alert statistics
   */
  getAlertStats() {
    const recentAlerts = this._alerts.filter(
      a => performance.now() - a.timestamp < 60000 // Last minute
    );
    
    return {
      totalAlerts: this._alerts.length,
      recentAlerts: recentAlerts.length,
      averageSpikeFrameTime: recentAlerts.length > 0
        ? recentAlerts.reduce((sum, a) => sum + a.frameTime, 0) / recentAlerts.length
        : 0,
      maxSpikeFrameTime: recentAlerts.length > 0
        ? Math.max(...recentAlerts.map(a => a.frameTime))
        : 0,
      alertsByState: recentAlerts.reduce((acc, a) => {
        const state = a.interactionState || 'unknown';
        acc[state] = (acc[state] || 0) + 1;
        return acc;
      }, {})
    };
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
    
    const duration = performance.now() - token.start;
    
    // Record time in budget allocator (always do this)
    if (token.name === "gpu" || token.name === "preview") {
      this.budgetAllocator.recordTime('gpuPreview', duration);
    } else if (token.name === "canvas") {
      this.budgetAllocator.recordTime('canvas', duration);
    } else {
      this.budgetAllocator.recordTime('other', duration);
    }
    
    // Skip detailed dispatch timing during interactions (but still track GPU/Canvas)
    if (this._isInteractionMode && !this._collectDetailedMetrics) {
      // Still record GPU and Canvas times even when throttling
      if (token.name === "gpu") {
        this.metrics.gpuMs = duration;
      } else if (token.name === "canvas") {
        this.metrics.canvasMs = duration;
      }
      // Skip other detailed metrics
      return duration;
    }
    
    // Normal processing when collecting detailed metrics
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
    
    const budgets = this.budgetAllocator.getBudgets();
    const qualityMultiplier = this.budgetAllocator.getQualityMultiplier();
    const interactionQuality = (this.metrics.qualityLevel || 1.0) * 100;

    // During interactions, show only high-level metrics (FPS, frame time)
    let lines;
    if (this._isInteractionMode) {
      const fps = this.metrics.frameMs > 0 ? (1000 / this.metrics.frameMs).toFixed(1) : "0.0";
      const budgetStatus = this.metrics.budgetExceeded ? "⚠ EXCEEDED" : "✓ OK";
      const duration = this.metrics.interactionDuration > 0 ? `${(this.metrics.interactionDuration / 1000).toFixed(1)}s` : "-";
      lines = [
        `Frame: ${this.metrics.frameMs.toFixed(1)} ms (${fps} FPS) ${budgetStatus}`,
        `GPU   : ${this.metrics.gpuMs.toFixed(1)} / ${budgets.gpuPreview.toFixed(1)} ms`,
        `Canvas: ${this.metrics.canvasMs.toFixed(1)} / ${budgets.canvas.toFixed(1)} ms`,
        `Quality: ${(qualityMultiplier * 100).toFixed(0)}% (${interactionQuality.toFixed(0)}%)`,
        `State: ${this.metrics.interactionState} [${duration}] [LIGHT]`,
      ];
    } else {
      // Full metrics when not interacting
      const budgetStatus = this.metrics.budgetExceeded ? "⚠ EXCEEDED" : "✓ OK";
      lines = [
        `Frame: ${this.metrics.frameMs.toFixed(1)} ms (RAF Δ ${this.metrics.rafDelta.toFixed(1)} ms) ${budgetStatus}`,
        `GPU   : ${this.metrics.gpuMs.toFixed(1)} / ${budgets.gpuPreview.toFixed(1)} ms`,
        `Canvas: ${this.metrics.canvasMs.toFixed(1)} / ${budgets.canvas.toFixed(1)} ms`,
        `Other : ${(this.metrics.previewDomMs || 0).toFixed(1)} / ${budgets.other.toFixed(1)} ms`,
        `Preview DOM: ${this.metrics.previewDomMs.toFixed(1)} ms`,
        `Quality: ${(qualityMultiplier * 100).toFixed(0)}% (${interactionQuality.toFixed(0)}%)`,
        `Layout R/W: ${this.metrics.layoutReads}/${this.metrics.layoutWrites}`,
        `Last Read: ${this.metrics.lastLayoutRead}`,
        `Last Write: ${this.metrics.lastLayoutWrite}`,
        `State: ${this.metrics.interactionState}`,
      ];
      
      if (this.metrics.budgetStats) {
        lines.push(`Avg Frame: ${this.metrics.budgetStats.avgFrameTime.toFixed(1)} ms`);
      }
      
      // Show interaction metrics if available
      if (this.metrics.interactionMetrics && this.metrics.interactionMetrics.totalInteractions > 0) {
        lines.push(``);
        lines.push(`Interactions: ${this.metrics.interactionMetrics.totalInteractions}`);
        lines.push(`Avg Duration: ${this.metrics.interactionMetrics.averageInteractionDuration.toFixed(0)}ms`);
        lines.push(`Longest: ${this.metrics.interactionMetrics.longestInteraction.toFixed(0)}ms`);
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
    
    // Store reference to this instance
    const instance = this;
    
    // Install toggle function
    window.togglePreviewPerfOverlay = () => {
      if (instance) {
        instance.toggle();
      } else if (window.previewPerfMonitor) {
        window.previewPerfMonitor.toggle();
      } else {
        console.warn("[PreviewPerfMonitor] Instance not available. PreviewPerfMonitor may not be initialized.");
      }
    };
    
    // Expose benchmarking tools (always available)
    try {
      window.performanceBenchmark = getPerformanceBenchmark();
      window.performanceLogger = getPerformanceLogger();
      window.performanceDashboard = getPerformanceDashboard();
      window.performanceAnalyzer = getPerformanceAnalyzer();
    } catch (error) {
      console.error("[PreviewPerfMonitor] Failed to initialize performance tools:", error);
    }
    
    console.info(
      "[PreviewPerfMonitor] Overlay ready. Call window.togglePreviewPerfOverlay() or set localStorage.previewPerfOverlay = 'true' to persist."
    );
    console.info(
      "[PreviewPerfMonitor] Performance tools available:",
      "window.performanceBenchmark, window.performanceLogger, window.performanceDashboard, window.performanceAnalyzer"
    );
  }
}

