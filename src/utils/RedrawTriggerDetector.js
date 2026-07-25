// src/utils/RedrawTriggerDetector.js
// Detects non-user-driven redraws (auto-saving, background sync, observers, timers, workers)
// Tracks frequency and severity over time

import { logRedrawTriggerEvent } from './RedrawDiagnostics.js';

const DEFAULT_SESSION_DURATION = 3600000; // 1 hour in ms
const DEFAULT_ANALYSIS_INTERVAL = 60000; // Analyze every minute

export class RedrawTriggerDetector {
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled !== false,
      sessionDuration: options.sessionDuration || DEFAULT_SESSION_DURATION,
      analysisInterval: options.analysisInterval || DEFAULT_ANALYSIS_INTERVAL,
      trackStackTraces: options.trackStackTraces !== false,
      maxStackDepth: options.maxStackDepth || 10,
      ...options
    };

    // Tracking state
    this.isActive = false;
    this.sessionStartTime = null;
    this.sessionEndTime = null;
    this.isIdle = false; // Tracks if user is idle (no input for 30s)

    // Trigger inventory
    this.triggers = new Map(); // triggerId -> TriggerInfo
    this.triggerEvents = []; // All trigger events with timestamps
    this.redrawEvents = []; // All redraw events with triggers

    // Wrapped functions
    this.originalSetInterval = null;
    this.originalSetTimeout = null;
    this.originalRequestAnimationFrame = null;
    this.originalClearInterval = null;
    this.originalClearTimeout = null;
    this.originalCancelAnimationFrame = null;

    // Active timers/observers tracking
    this.activeTimers = new Map(); // timerId -> TimerInfo
    this.activeObservers = new Map(); // observerId -> ObserverInfo
    this.activeWorkers = new Map(); // workerId -> WorkerInfo
    this.activeRAF = new Map(); // rafId -> RAFInfo

    // User interaction tracking
    this.lastUserInteraction = null;
    this.idleTimeout = null;
    this.idleThreshold = 30000; // 30 seconds

    // Redraw function tracking
    this.redrawFunctions = new Set(); // Functions that trigger redraws
    this.redrawCallStack = null; // Current redraw call stack

    // Analysis
    this.analysisIntervalId = null;
    this.severityThresholds = {
      critical: { frequency: 10, impact: 0.5 }, // 10+ per second, 50%+ of redraws
      high: { frequency: 5, impact: 0.25 }, // 5+ per second, 25%+ of redraws
      medium: { frequency: 1, impact: 0.1 }, // 1+ per second, 10%+ of redraws
      low: { frequency: 0.1, impact: 0.05 } // 0.1+ per second, 5%+ of redraws
    };
  }

  /**
   * Start monitoring
   */
  start() {
    if (this.isActive) return;
    this.isActive = true;
    this.sessionStartTime = performance.now();
    this.sessionEndTime = this.sessionStartTime + this.options.sessionDuration;

    // Wrap timers
    this._wrapTimers();
    
    // Wrap observers
    this._wrapObservers();
    
    // Wrap worker messages
    this._wrapWorkers();
    
    // Track user interactions
    this._trackUserInteractions();
    
    // Track redraw functions
    this._trackRedrawFunctions();
    
    // Start periodic analysis
    this._startAnalysis();

    console.log('[RedrawTriggerDetector] Started monitoring');
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (!this.isActive) return;
    this.isActive = false;

    // Restore original functions
    this._restoreTimers();
    this._restoreObservers();
    this._restoreWorkers();

    // Clear intervals
    if (this.analysisIntervalId) {
      clearInterval(this.analysisIntervalId);
      this.analysisIntervalId = null;
    }
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }

    console.log('[RedrawTriggerDetector] Stopped monitoring');
  }

  /**
   * Wrap setInterval and setTimeout
   */
  _wrapTimers() {
    this.originalSetInterval = window.setInterval;
    this.originalSetTimeout = window.setTimeout;
    this.originalClearInterval = window.clearInterval;
    this.originalClearTimeout = window.clearTimeout;

    const self = this;
    
    window.setInterval = function(callback, delay, ...args) {
      const timerId = self.originalSetInterval.call(window, (...cbArgs) => {
        self._onTimerTick(timerId, 'setInterval', delay);
        return callback(...cbArgs);
      }, delay, ...args);

      self._registerTimer(timerId, 'setInterval', delay, callback, self._getStackTrace());
      return timerId;
    };

    window.setTimeout = function(callback, delay, ...args) {
      const timerId = self.originalSetTimeout.call(window, (...cbArgs) => {
        self._onTimerTick(timerId, 'setTimeout', delay);
        return callback(...cbArgs);
      }, delay, ...args);

      self._registerTimer(timerId, 'setTimeout', delay, callback, self._getStackTrace());
      return timerId;
    };

    window.clearInterval = function(timerId) {
      self._unregisterTimer(timerId);
      return self.originalClearInterval.call(window, timerId);
    };

    window.clearTimeout = function(timerId) {
      self._unregisterTimer(timerId);
      return self.originalClearTimeout.call(window, timerId);
    };
  }

  /**
   * Restore original timer functions
   */
  _restoreTimers() {
    if (this.originalSetInterval) {
      window.setInterval = this.originalSetInterval;
    }
    if (this.originalSetTimeout) {
      window.setTimeout = this.originalSetTimeout;
    }
    if (this.originalClearInterval) {
      window.clearInterval = this.originalClearInterval;
    }
    if (this.originalClearTimeout) {
      window.clearTimeout = this.originalClearTimeout;
    }
  }

  /**
   * Wrap observers
   */
  _wrapObservers() {
    const self = this;
    
    // Wrap MutationObserver
    const OriginalMutationObserver = window.MutationObserver;
    if (OriginalMutationObserver) {
      window.MutationObserver = class extends OriginalMutationObserver {
        constructor(callback) {
          const wrappedCallback = (mutations, observer) => {
            self._onObserverCallback('MutationObserver', callback, self._getStackTrace());
            return callback(mutations, observer);
          };
          super(wrappedCallback);
          self._registerObserver(this, 'MutationObserver', callback, self._getStackTrace());
        }
      };
    }

    // Wrap IntersectionObserver
    const OriginalIntersectionObserver = window.IntersectionObserver;
    if (OriginalIntersectionObserver) {
      window.IntersectionObserver = class extends OriginalIntersectionObserver {
        constructor(callback, options) {
          const wrappedCallback = (entries, observer) => {
            self._onObserverCallback('IntersectionObserver', callback, self._getStackTrace());
            return callback(entries, observer);
          };
          super(wrappedCallback, options);
          self._registerObserver(this, 'IntersectionObserver', callback, self._getStackTrace());
        }
      };
    }

    // Wrap ResizeObserver
    const OriginalResizeObserver = window.ResizeObserver;
    if (OriginalResizeObserver) {
      window.ResizeObserver = class extends OriginalResizeObserver {
        constructor(callback) {
          const wrappedCallback = (entries, observer) => {
            self._onObserverCallback('ResizeObserver', callback, self._getStackTrace());
            return callback(entries, observer);
          };
          super(wrappedCallback);
          self._registerObserver(this, 'ResizeObserver', callback, self._getStackTrace());
        }
      };
    }

    // Wrap PerformanceObserver
    const OriginalPerformanceObserver = window.PerformanceObserver;
    if (OriginalPerformanceObserver) {
      window.PerformanceObserver = class extends OriginalPerformanceObserver {
        constructor(callback) {
          const wrappedCallback = (list, observer) => {
            self._onObserverCallback('PerformanceObserver', callback, self._getStackTrace());
            return callback(list, observer);
          };
          super(wrappedCallback);
          self._registerObserver(this, 'PerformanceObserver', callback, self._getStackTrace());
        }
      };
    }
  }

  /**
   * Restore original observer constructors
   */
  _restoreObservers() {
    // Note: This is tricky - we'd need to store originals before wrapping
    // For now, we'll just log that restoration isn't fully supported
    console.warn('[RedrawTriggerDetector] Observer restoration not fully supported');
  }

  /**
   * Wrap worker message handlers
   */
  _wrapWorkers() {
    const self = this;
    const OriginalWorker = window.Worker;
    
    if (OriginalWorker) {
      window.Worker = class extends OriginalWorker {
        constructor(scriptURL, options) {
          super(scriptURL, options);
          
          const originalOnMessage = this.onmessage;
          this.onmessage = (event) => {
            self._onWorkerMessage(this, event);
            if (originalOnMessage) {
              originalOnMessage.call(this, event);
            }
          };

          const originalAddEventListener = this.addEventListener;
          this.addEventListener = function(type, listener, options) {
            if (type === 'message') {
              const wrappedListener = (event) => {
                self._onWorkerMessage(this, event);
                return listener(event);
              };
              return originalAddEventListener.call(this, type, wrappedListener, options);
            }
            return originalAddEventListener.call(this, type, listener, options);
          };

          self._registerWorker(this, scriptURL, self._getStackTrace());
        }
      };
    }
  }

  /**
   * Restore original Worker constructor
   */
  _restoreWorkers() {
    // Similar to observers, full restoration is complex
    console.warn('[RedrawTriggerDetector] Worker restoration not fully supported');
  }

  /**
   * Track user interactions to detect idle state
   */
  _trackUserInteractions() {
    const events = ['mousedown', 'mousemove', 'keydown', 'keypress', 'touchstart', 'click', 'wheel'];
    const self = this;

    events.forEach(eventType => {
      document.addEventListener(eventType, () => {
        self.lastUserInteraction = performance.now();
        if (self.isIdle) {
          self.isIdle = false;
          self._logEvent('user-interaction', { type: eventType });
        }
        self._resetIdleTimer();
      }, { passive: true });
    });

    this._resetIdleTimer();
  }

  /**
   * Reset idle timer
   */
  _resetIdleTimer() {
    if (this.idleTimeout) {
      clearTimeout(this.idleTimeout);
    }
    this.idleTimeout = setTimeout(() => {
      this.isIdle = true;
      this._logEvent('idle-state', { isIdle: true });
    }, this.idleThreshold);
  }

  /**
   * Track redraw functions (editor.draw, render, etc.)
   */
  _trackRedrawFunctions() {
    const self = this;
    
    // Wrap common redraw functions
    
    // Monitor window.editor.draw
    if (window.editor && typeof window.editor.draw === 'function') {
      const originalDraw = window.editor.draw;
      window.editor.draw = function(...args) {
        self._onRedraw('editor.draw', self._getStackTrace());
        return originalDraw.apply(this, args);
      };
      this.redrawFunctions.add('editor.draw');
    }

    // Monitor window.render
    if (typeof window.render === 'function') {
      const originalRender = window.render;
      window.render = function(...args) {
        self._onRedraw('window.render', self._getStackTrace());
        return originalRender.apply(this, args);
      };
      this.redrawFunctions.add('window.render');
    }

    // Monitor editor.markDirty
    if (window.editor && typeof window.editor.markDirty === 'function') {
      const originalMarkDirty = window.editor.markDirty;
      window.editor.markDirty = function(...args) {
        self._onRedrawTrigger('markDirty', args[0] || 'unknown', self._getStackTrace());
        return originalMarkDirty.apply(this, args);
      };
    }
  }

  /**
   * Register a timer
   */
  _registerTimer(timerId, type, delay, callback, stackTrace) {
    const info = {
      id: timerId,
      type,
      delay,
      callback: callback.toString().substring(0, 200), // First 200 chars
      stackTrace: this.options.trackStackTraces ? stackTrace : null,
      createdAt: performance.now(),
      tickCount: 0,
      lastTick: null,
      redrawCount: 0
    };
    this.activeTimers.set(timerId, info);
    this._logEvent('timer-registered', info);
  }

  /**
   * Unregister a timer
   */
  _unregisterTimer(timerId) {
    const info = this.activeTimers.get(timerId);
    if (info) {
      this.activeTimers.delete(timerId);
      this._logEvent('timer-unregistered', { id: timerId, ...info });
    }
  }

  /**
   * Handle timer tick
   */
  _onTimerTick(timerId, type, delay) {
    const info = this.activeTimers.get(timerId);
    if (info) {
      info.tickCount++;
      info.lastTick = performance.now();
      
      // Store stack trace for potential redraw detection
      
      // Check if a redraw happens shortly after this tick
      // Use a short timeout to detect redraws triggered by this timer
      const checkTimeout = setTimeout(() => {
        // If redrawCallStack is still set, it means a redraw happened
        // This is a heuristic - not perfect but helps identify timer->redraw links
        if (this.redrawCallStack && (performance.now() - info.lastTick) < 100) {
          info.redrawCount++;
          this._logTrigger('timer', {
            timerId,
            type,
            delay,
            tickCount: info.tickCount,
            stackTrace: this.redrawCallStack
          });
        }
        this.redrawCallStack = null;
      }, 100); // Check within 100ms
      
      // Store timeout for cleanup if needed
      if (!info.checkTimeouts) {
        info.checkTimeouts = [];
      }
      info.checkTimeouts.push(checkTimeout);
    }
  }

  /**
   * Register an observer
   */
  _registerObserver(observer, type, callback, stackTrace) {
    const observerId = `observer_${performance.now()}_${Math.random()}`;
    const info = {
      id: observerId,
      type,
      callback: callback.toString().substring(0, 200),
      stackTrace: this.options.trackStackTraces ? stackTrace : null,
      createdAt: performance.now(),
      callbackCount: 0,
      lastCallback: null,
      redrawCount: 0
    };
    this.activeObservers.set(observerId, info);
    this._logEvent('observer-registered', info);
  }

  /**
   * Handle observer callback
   */
  _onObserverCallback(type, callback, stackTrace) {
    const observerId = Array.from(this.activeObservers.entries())
      .find(([_, info]) => info.callback === callback.toString().substring(0, 200))?.[0];
    
    if (observerId) {
      const info = this.activeObservers.get(observerId);
      if (info) {
        info.callbackCount++;
        info.lastCallback = performance.now();
        
        this.redrawCallStack = stackTrace;
        setTimeout(() => {
          if (this.redrawCallStack) {
            info.redrawCount++;
            this._logTrigger('observer', {
              observerId,
              type,
              callbackCount: info.callbackCount,
              stackTrace: this.redrawCallStack
            });
            this.redrawCallStack = null;
          }
        }, 50);
      }
    }
  }

  /**
   * Register a worker
   */
  _registerWorker(worker, scriptURL, stackTrace) {
    const workerId = `worker_${performance.now()}_${Math.random()}`;
    const info = {
      id: workerId,
      scriptURL,
      stackTrace: this.options.trackStackTraces ? stackTrace : null,
      createdAt: performance.now(),
      messageCount: 0,
      lastMessage: null,
      redrawCount: 0
    };
    this.activeWorkers.set(workerId, info);
    this._logEvent('worker-registered', info);
  }

  /**
   * Handle worker message
   */
  _onWorkerMessage(worker, event) {
    const workerId = Array.from(this.activeWorkers.entries())
      .find(([_, info]) => info.worker === worker)?.[0];
    
    if (workerId) {
      const info = this.activeWorkers.get(workerId);
      if (info) {
        info.worker = worker; // Store reference
        info.messageCount++;
        info.lastMessage = performance.now();
        
        this.redrawCallStack = this._getStackTrace();
        setTimeout(() => {
          if (this.redrawCallStack) {
            info.redrawCount++;
            this._logTrigger('worker', {
              workerId,
              messageType: event.data?.type || 'unknown',
              messageCount: info.messageCount,
              stackTrace: this.redrawCallStack
            });
            this.redrawCallStack = null;
          }
        }, 50);
      }
    }
  }

  /**
   * Handle redraw
   */
  _onRedraw(functionName, stackTrace) {
    const now = performance.now();
    
    // Store stack trace for timer/observer/worker detection
    this.redrawCallStack = this.options.trackStackTraces ? stackTrace : null;
    
    const event = {
      timestamp: now,
      functionName,
      stackTrace: this.redrawCallStack,
      isIdle: this.isIdle,
      sessionTime: now - this.sessionStartTime
    };
    
    this.redrawEvents.push(event);
    
    // Check if this redraw was triggered by a known trigger
    // Look for recent trigger events
    if (this.triggerEvents.length > 0) {
      const recentTriggers = this.triggerEvents.filter(te => (now - te.timestamp) < 100);
      if (recentTriggers.length > 0) {
        const triggerEvent = recentTriggers[recentTriggers.length - 1];
        event.triggerId = triggerEvent.id;
        event.triggerType = triggerEvent.type;
        
        // Update trigger redraw count
        const triggerKey = `${triggerEvent.type}_${triggerEvent.timerId || triggerEvent.observerId || triggerEvent.workerId || triggerEvent.source || 'unknown'}`;
        const trigger = this.triggers.get(triggerKey);
        if (trigger) {
          trigger.redrawCount++;
        }
      }
    }

    logRedrawTriggerEvent({
      source: 'redraw-trigger-detector',
      reason: functionName,
      detail: { isIdle: this.isIdle, triggerType: event.triggerType }
    });
  }

  /**
   * Handle redraw trigger
   */
  _onRedrawTrigger(source, reason, stackTrace) {
    this._logTrigger('markDirty', {
      source,
      reason,
      stackTrace: this.options.trackStackTraces ? stackTrace : null
    });
  }

  /**
   * Log a trigger event
   */
  _logTrigger(type, details) {
    const now = performance.now();
    const triggerId = `trigger_${now}_${Math.random()}`;
    
    const event = {
      id: triggerId,
      type,
      timestamp: now,
      isIdle: this.isIdle,
      sessionTime: now - this.sessionStartTime,
      ...details
    };
    
    this.triggerEvents.push(event);
    
    // Update trigger inventory
    const triggerKey = `${type}_${details.source || details.timerId || details.observerId || details.workerId || 'unknown'}`;
    if (!this.triggers.has(triggerKey)) {
      this.triggers.set(triggerKey, {
        key: triggerKey,
        type,
        source: details.source || details.timerId || details.observerId || details.workerId || 'unknown',
        firstSeen: now,
        lastSeen: now,
        count: 0,
        redrawCount: 0,
        stackTraces: []
      });
    }
    
    const trigger = this.triggers.get(triggerKey);
    trigger.lastSeen = now;
    trigger.count++;
    if (details.stackTrace && this.options.trackStackTraces) {
      trigger.stackTraces.push(details.stackTrace);
      if (trigger.stackTraces.length > 10) {
        trigger.stackTraces.shift(); // Keep last 10
      }
    }
  }

  /**
   * Log a general event
   */
  _logEvent(type, data) {
    // For now, just store in trigger events
    this.triggerEvents.push({
      id: `event_${performance.now()}_${Math.random()}`,
      type,
      timestamp: performance.now(),
      isIdle: this.isIdle,
      sessionTime: performance.now() - this.sessionStartTime,
      ...data
    });
  }

  /**
   * Get stack trace
   */
  _getStackTrace() {
    if (!this.options.trackStackTraces) return null;
    
    try {
      throw new Error();
    } catch (e) {
      const stack = e.stack || e.stacktrace || '';
      const lines = stack.split('\n').slice(2, 2 + this.options.maxStackDepth);
      return lines.map(line => line.trim()).filter(line => line);
    }
  }

  /**
   * Start periodic analysis
   */
  _startAnalysis() {
    this.analysisIntervalId = setInterval(() => {
      this._analyze();
    }, this.options.analysisInterval);
  }

  /**
   * Analyze triggers and generate report
   */
  _analyze() {
    const now = performance.now();
    const sessionTime = now - this.sessionStartTime;
    const sessionDuration = now - this.sessionStartTime;
    
    // Calculate frequencies
    const analysis = {
      sessionTime,
      sessionDuration,
      isIdle: this.isIdle,
      totalTriggers: this.triggerEvents.length,
      totalRedraws: this.redrawEvents.length,
      activeTimers: this.activeTimers.size,
      activeObservers: this.activeObservers.size,
      activeWorkers: this.activeWorkers.size,
      triggers: []
    };

    // Analyze each trigger
    for (const [, trigger] of this.triggers.entries()) {
      const timeWindow = now - trigger.firstSeen;
      const frequency = timeWindow > 0 ? (trigger.count / timeWindow) * 1000 : 0; // per second
      const impact = this.redrawEvents.length > 0 
        ? trigger.redrawCount / this.redrawEvents.length 
        : 0;
      
      const severity = this._calculateSeverity(frequency, impact);
      
      analysis.triggers.push({
        ...trigger,
        frequency,
        impact,
        severity,
        timeWindow
      });
    }

    // Sort by severity
    analysis.triggers.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    return analysis;
  }

  /**
   * Calculate severity based on frequency and impact
   */
  _calculateSeverity(frequency, impact) {
    if (frequency >= this.severityThresholds.critical.frequency && 
        impact >= this.severityThresholds.critical.impact) {
      return 'critical';
    }
    if (frequency >= this.severityThresholds.high.frequency && 
        impact >= this.severityThresholds.high.impact) {
      return 'high';
    }
    if (frequency >= this.severityThresholds.medium.frequency && 
        impact >= this.severityThresholds.medium.impact) {
      return 'medium';
    }
    if (frequency >= this.severityThresholds.low.frequency && 
        impact >= this.severityThresholds.low.impact) {
      return 'low';
    }
    return 'info';
  }

  /**
   * Get current inventory with severity ranking
   */
  getInventory() {
    return this._analyze();
  }

  /**
   * Get detailed report
   */
  getReport() {
    const analysis = this._analyze();
    const now = performance.now();
    
    return {
      session: {
        startTime: this.sessionStartTime,
        endTime: this.sessionEndTime,
        duration: now - this.sessionStartTime,
        isIdle: this.isIdle,
        lastUserInteraction: this.lastUserInteraction
      },
      statistics: {
        totalTriggers: analysis.totalTriggers,
        totalRedraws: analysis.totalRedraws,
        redrawRate: analysis.totalRedraws / ((now - this.sessionStartTime) / 1000), // per second
        activeTimers: analysis.activeTimers,
        activeObservers: analysis.activeObservers,
        activeWorkers: analysis.activeWorkers
      },
      triggers: analysis.triggers,
      activeTimers: Array.from(this.activeTimers.values()),
      activeObservers: Array.from(this.activeObservers.values()),
      activeWorkers: Array.from(this.activeWorkers.values())
    };
  }

  /**
   * Export data for analysis
   */
  exportData() {
    return {
      session: {
        startTime: this.sessionStartTime,
        endTime: this.sessionEndTime,
        duration: performance.now() - this.sessionStartTime
      },
      triggerEvents: this.triggerEvents,
      redrawEvents: this.redrawEvents,
      triggers: Array.from(this.triggers.values()),
      activeTimers: Array.from(this.activeTimers.values()),
      activeObservers: Array.from(this.activeObservers.values()),
      activeWorkers: Array.from(this.activeWorkers.values())
    };
  }
}

// Global instance
let globalDetector = null;

/**
 * Get or create global detector instance
 */
export function getRedrawTriggerDetector(options) {
  if (!globalDetector) {
    globalDetector = new RedrawTriggerDetector(options);
  }
  return globalDetector;
}

/**
 * Start global monitoring
 */
export function startRedrawTriggerDetection(options) {
  const detector = getRedrawTriggerDetector(options);
  detector.start();
  return detector;
}

/**
 * Stop global monitoring
 */
export function stopRedrawTriggerDetection() {
  if (globalDetector) {
    globalDetector.stop();
  }
}

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.RedrawTriggerDetector = RedrawTriggerDetector;
  window.startRedrawTriggerDetection = startRedrawTriggerDetection;
  window.stopRedrawTriggerDetection = stopRedrawTriggerDetection;
  window.getRedrawTriggerDetector = getRedrawTriggerDetector;
}

