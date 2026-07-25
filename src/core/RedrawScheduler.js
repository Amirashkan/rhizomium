// src/core/RedrawScheduler.js
// Throttling and debouncing scheduler for canvas redraws

/**
 * Default throttling configuration per trigger type
 * See REDRAW_THROTTLING_POLICY.md for detailed documentation
 */
const DEFAULT_TRIGGER_CONFIG = {
  // User Interaction Events
  'mouse-move': { throttle: 16.67, debounce: null, priority: 'high' },
  'mouse-drag': { throttle: 16.67, debounce: null, priority: 'high' },
  'pan': { throttle: 16.67, debounce: null, priority: 'normal' },
  'zoom': { throttle: 16.67, debounce: null, priority: 'high' },
  'selection': { throttle: null, debounce: null, priority: 'critical' },
  'box-select': { throttle: 16.67, debounce: null, priority: 'normal' },
  
  // Graph Structure Changes
  'node-add': { throttle: null, debounce: null, priority: 'high' },
  'node-remove': { throttle: null, debounce: null, priority: 'high' },
  'node-move': { throttle: 16.67, debounce: null, priority: 'normal' },
  'connection-add': { throttle: null, debounce: 100, priority: 'normal' },
  'connection-remove': { throttle: null, debounce: null, priority: 'high' },
  'graph-change': { throttle: null, debounce: 150, priority: 'normal' },
  
  // Parameter Updates
  'parameter-change': { throttle: 16.67, debounce: 200, priority: 'normal' },
  'parameter-drag': { throttle: 16.67, debounce: null, priority: 'normal' },
  'midi-input': { throttle: 16.67, debounce: 100, priority: 'normal' },
  'expression-update': { throttle: null, debounce: 300, priority: 'normal' },
  
  // Preview Updates
  'preview-update': { throttle: 66.67, debounce: 500, priority: 'low' },
  'preview-compute': { throttle: 100, debounce: 1000, priority: 'low' },
  'thumbnail-update': { throttle: 50, debounce: 300, priority: 'low' },
  
  // Animation & Time-Based
  'animation-frame': { throttle: 16.67, debounce: null, priority: 'high' },
  'time-update': { throttle: 16.67, debounce: null, priority: 'high' },
  'audio-envelope': { throttle: 16.67, debounce: null, priority: 'normal' },
  
  // Background & System Events
  'autosave': { throttle: null, debounce: 2000, priority: 'idle' },
  'background-warmup': { throttle: 1000, debounce: null, priority: 'idle' },
  'worker-message': { throttle: null, debounce: 100, priority: 'low' },
  'observer-update': { throttle: null, debounce: 200, priority: 'low' },
  
  // Fallback for unknown triggers
  'unknown': { throttle: 16.67, debounce: null, priority: 'normal' }
};


/**
 * RedrawScheduler - Manages throttling and debouncing of redraw requests
 */
export class RedrawScheduler {
  constructor(config = {}) {
    // Configuration
    this.config = {
      enabled: config.enabled !== false, // Default: enabled
      maxFPS: config.maxFPS || 60,
      minFrameTime: config.minFrameTime || (1000 / (config.maxFPS || 60)),
      respectAnimationLoop: config.respectAnimationLoop !== false,
      skipFramesDuringPan: config.skipFramesDuringPan !== false,
      logThrottled: config.logThrottled || false,
      logStats: config.logStats || false,
      ...config
    };
    
    // Per-trigger configuration (merge with defaults)
    this.triggerConfig = { ...DEFAULT_TRIGGER_CONFIG, ...(config.triggers || {}) };
    
    // Throttle state per trigger type
    this.throttleState = new Map();
    
    // Debounce timers per trigger type
    this.debounceTimers = new Map();
    
    // Pending redraw callback
    this.pendingRedraw = null;
    this.redrawCallback = null;
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      executed: 0,
      throttled: 0,
      debounced: 0,
      byTrigger: new Map(),
      averageDelay: 0,
      delaySum: 0,
      delayCount: 0
    };
    
    // Last execution time (for global rate limiting)
    this.lastExecutionTime = 0;
    
    // RAF handle for scheduling
    this.rafHandle = null;
    this.scheduled = false;
  }
  
  /**
   * Set the callback function to execute when redraw is approved
   */
  setRedrawCallback(callback) {
    this.redrawCallback = callback;
  }
  
  /**
   * Request a redraw with optional trigger type and options
   * @param {string} triggerType - Type of trigger (e.g., 'mouse-move', 'pan', 'parameter-change')
   * @param {object} options - Additional options
   * @param {boolean} options.immediate - Bypass throttling (for critical updates)
   * @param {string} options.reason - Human-readable reason for debugging
   */
  requestRedraw(triggerType = 'unknown', options = {}) {
    if (!this.config.enabled) {
      // Throttling disabled - execute immediately
      this._executeRedraw(triggerType, options);
      return;
    }
    
    // Normalize trigger type
    const normalizedTrigger = triggerType || 'unknown';
    const config = this.triggerConfig[normalizedTrigger] || this.triggerConfig['unknown'];
    
    // Update statistics
    this._updateStats(normalizedTrigger, 'request');
    
    // Critical priority or immediate flag bypasses throttling
    if (options.immediate || config.priority === 'critical') {
      this._cancelDebounce(normalizedTrigger);
      this._executeRedraw(normalizedTrigger, options);
      return;
    }
    
    // Check global rate limit
    const now = this._now();
    const timeSinceLastExecution = now - this.lastExecutionTime;
    const minFrameTime = this.config.minFrameTime;
    
    if (timeSinceLastExecution < minFrameTime && !options.immediate) {
      // Global rate limit exceeded - throttle
      this._updateStats(normalizedTrigger, 'throttled');
      if (this.config.logThrottled) {
        console.log(`[RedrawScheduler] Throttled ${normalizedTrigger} (global rate limit)`);
      }
      // Schedule for later
      this._scheduleRedraw(normalizedTrigger, options, minFrameTime - timeSinceLastExecution);
      return;
    }
    
    // Apply trigger-specific throttling
    if (config.throttle !== null && config.throttle > 0) {
      if (!this._checkThrottle(normalizedTrigger, config.throttle)) {
        // Throttled - schedule for later
        this._updateStats(normalizedTrigger, 'throttled');
        if (this.config.logThrottled) {
          console.log(`[RedrawScheduler] Throttled ${normalizedTrigger} (${config.throttle}ms)`);
        }
        this._scheduleRedraw(normalizedTrigger, options, config.throttle);
        return;
      }
    }
    
    // Apply debouncing
    if (config.debounce !== null && config.debounce > 0) {
      this._scheduleDebounce(normalizedTrigger, options, config.debounce);
      this._updateStats(normalizedTrigger, 'debounced');
      return;
    }
    
    // No throttling/debouncing - execute immediately
    this._executeRedraw(normalizedTrigger, options);
  }
  
  /**
   * Check if trigger is within throttle window
   */
  _checkThrottle(triggerType, throttleMs) {
    const now = this._now();
    const state = this.throttleState.get(triggerType);
    
    if (!state || (now - state.lastExecution) >= throttleMs) {
      // Update throttle state
      this.throttleState.set(triggerType, {
        lastExecution: now,
        count: (state?.count || 0) + 1
      });
      return true; // Allowed
    }
    
    return false; // Throttled
  }
  
  /**
   * Schedule a debounced redraw
   */
  _scheduleDebounce(triggerType, options, debounceMs) {
    // Cancel existing debounce timer
    this._cancelDebounce(triggerType);
    
    // Set new debounce timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(triggerType);
      this._executeRedraw(triggerType, options);
    }, debounceMs);
    
    this.debounceTimers.set(triggerType, timer);
  }
  
  /**
   * Cancel debounce timer for trigger
   */
  _cancelDebounce(triggerType) {
    const timer = this.debounceTimers.get(triggerType);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(triggerType);
    }
  }
  
  /**
   * Schedule a redraw for later execution
   */
  _scheduleRedraw(triggerType, options, delayMs) {
    // Store pending redraw (overwrites previous if exists)
    this.pendingRedraw = { triggerType, options, delayMs };
    
    if (!this.scheduled) {
      this.scheduled = true;
      
      if (this.config.respectAnimationLoop && typeof requestAnimationFrame !== 'undefined') {
        // Use RAF for smooth scheduling
        this.rafHandle = requestAnimationFrame(() => {
          this.scheduled = false;
          if (this.pendingRedraw) {
            const { triggerType: pendingTrigger, options: pendingOptions } = this.pendingRedraw;
            this.pendingRedraw = null;
            this.requestRedraw(pendingTrigger, { ...pendingOptions, immediate: false });
          }
        });
      } else {
        // Fallback to setTimeout
        setTimeout(() => {
          this.scheduled = false;
          if (this.pendingRedraw) {
            const { triggerType: pendingTrigger, options: pendingOptions } = this.pendingRedraw;
            this.pendingRedraw = null;
            this.requestRedraw(pendingTrigger, { ...pendingOptions, immediate: false });
          }
        }, Math.max(0, delayMs));
      }
    }
  }
  
  /**
   * Execute the redraw callback
   */
  _executeRedraw(triggerType, options) {
    const startTime = this._now();
    
    // Update last execution time
    this.lastExecutionTime = startTime;
    
    // Update throttle state
    const state = this.throttleState.get(triggerType);
    this.throttleState.set(triggerType, {
      lastExecution: startTime,
      count: (state?.count || 0) + 1
    });
    
    // Cancel any pending debounce for this trigger
    this._cancelDebounce(triggerType);
    
    // Update statistics
    this._updateStats(triggerType, 'executed');
    
    // Execute callback
    if (this.redrawCallback) {
      try {
        this.redrawCallback(triggerType, options);
      } catch (error) {
        console.error('[RedrawScheduler] Error in redraw callback:', error);
      }
    }
    
    // Calculate delay (for statistics)
    const delay = this._now() - startTime;
    this.stats.delaySum += delay;
    this.stats.delayCount++;
    this.stats.averageDelay = this.stats.delaySum / this.stats.delayCount;
  }
  
  /**
   * Update statistics
   */
  _updateStats(triggerType, action) {
    this.stats.totalRequests++;
    
    if (!this.stats.byTrigger.has(triggerType)) {
      this.stats.byTrigger.set(triggerType, {
        requests: 0,
        executed: 0,
        throttled: 0,
        debounced: 0
      });
    }
    
    const triggerStats = this.stats.byTrigger.get(triggerType);
    triggerStats.requests++;
    
    switch (action) {
      case 'executed':
        this.stats.executed++;
        triggerStats.executed++;
        break;
      case 'throttled':
        this.stats.throttled++;
        triggerStats.throttled++;
        break;
      case 'debounced':
        this.stats.debounced++;
        triggerStats.debounced++;
        break;
    }
  }
  
  /**
   * Get current timestamp
   */
  _now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      byTrigger: Object.fromEntries(this.stats.byTrigger),
      throttleRate: this.stats.totalRequests > 0 
        ? (this.stats.throttled / this.stats.totalRequests) * 100 
        : 0,
      debounceRate: this.stats.totalRequests > 0 
        ? (this.stats.debounced / this.stats.totalRequests) * 100 
        : 0,
      executionRate: this.stats.totalRequests > 0 
        ? (this.stats.executed / this.stats.totalRequests) * 100 
        : 0
    };
  }
  
  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      executed: 0,
      throttled: 0,
      debounced: 0,
      byTrigger: new Map(),
      averageDelay: 0,
      delaySum: 0,
      delayCount: 0
    };
  }
  
  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Update trigger configs if provided
    if (newConfig.triggers) {
      this.triggerConfig = { ...this.triggerConfig, ...newConfig.triggers };
    }
    
    // Recalculate minFrameTime if maxFPS changed
    if (newConfig.maxFPS) {
      this.config.minFrameTime = 1000 / newConfig.maxFPS;
    }
  }
  
  /**
   * Enable/disable throttling
   */
  setEnabled(enabled) {
    this.config.enabled = enabled;
    
    // If disabling, cancel all pending timers
    if (!enabled) {
      for (const timer of this.debounceTimers.values()) {
        clearTimeout(timer);
      }
      this.debounceTimers.clear();
      
      if (this.rafHandle !== null) {
        cancelAnimationFrame(this.rafHandle);
        this.rafHandle = null;
      }
      this.scheduled = false;
      this.pendingRedraw = null;
    }
  }
  
  /**
   * Cleanup - cancel all timers
   */
  destroy() {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    
    this.scheduled = false;
    this.pendingRedraw = null;
    this.redrawCallback = null;
  }
}

