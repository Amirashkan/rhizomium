// src/core/ThreadMonitor.js
// Central monitoring system for all threads

import { HeartbeatManager } from './HeartbeatManager.js';
import { PerformanceCollector } from './PerformanceCollector.js';
import { CrashDetector } from './CrashDetector.js';
import { LoggingSystem } from './LoggingSystem.js';
import { RecoveryManager } from './RecoveryManager.js';

export class ThreadMonitor {
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled !== false,
      heartbeatInterval: options.heartbeatInterval || 5000, // 5 seconds (reduced frequency)
      stallTimeout: options.stallTimeout || 10000, // 10 seconds (increased tolerance)
      metricsInterval: options.metricsInterval || 500, // 500ms (reduced frequency)
      logLevel: options.logLevel || 'warn', // 'debug', 'info', 'warn', 'error' (default to warn to reduce logging)
      enableRecovery: options.enableRecovery !== false,
      maxRecoveryAttempts: options.maxRecoveryAttempts || 3,
      stallLogThrottleMs: Number.isFinite(options.stallLogThrottleMs)
        ? Math.max(0, options.stallLogThrottleMs)
        : 15000, // limit stall spam to one log every 15s
      ...options
    };
    
    // Component managers
    this.heartbeatManager = new HeartbeatManager(this);
    this.performanceCollector = new PerformanceCollector(this);
    this.crashDetector = new CrashDetector(this);
    this.loggingSystem = new LoggingSystem(this);
    this.recoveryManager = new RecoveryManager(this);
    
    // Thread registry
    this.threads = new Map(); // threadName -> ThreadInfo
    this.metrics = new Map(); // threadName -> Metrics
    this.health = new Map(); // threadName -> HealthStatus
    
    // Monitoring state
    this.isMonitoring = false;
    this.monitoringHandle = null;
    this.lastMonitoringTime = 0;
    
    // Event listeners
    this.listeners = new Map();

    // Stall logging throttle (per thread)
    this.stallLogState = new Map(); // threadName -> { lastLogTime, suppressed }
  }
  
  /**
   * Start monitoring (non-blocking)
   */
  start() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.loggingSystem.log('info', 'ThreadMonitor started');
    
    // Start component managers
    this.heartbeatManager.start();
    this.performanceCollector.start();
    this.crashDetector.start();
    
    // Start main monitoring loop (runs on idle time)
    this._startMonitoringLoop();
  }
  
  /**
   * Stop monitoring
   */
  stop() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    
    // Stop component managers
    this.heartbeatManager.stop();
    this.performanceCollector.stop();
    this.crashDetector.stop();
    
    // Cancel monitoring loop
    if (this.monitoringHandle) {
      if (typeof cancelIdleCallback !== 'undefined') {
        cancelIdleCallback(this.monitoringHandle);
      }
      this.monitoringHandle = null;
    }
    
    this.loggingSystem.log('info', 'ThreadMonitor stopped');
  }
  
  /**
   * Register a thread for monitoring
   */
  registerThread(threadInfo) {
    const {
      name,
      type, // 'primary', 'secondary', 'python'
      thread, // Thread object (Worker, or reference for primary threads)
      heartbeatCallback, // Optional: custom heartbeat function
      recoveryCallback, // Optional: custom recovery function
      priority = 'normal' // 'critical', 'high', 'normal', 'low'
    } = threadInfo;
    
    this.threads.set(name, {
      name,
      type,
      thread,
      heartbeatCallback,
      recoveryCallback,
      priority,
      registeredAt: performance.now(),
      lastHeartbeat: performance.now(),
      status: 'healthy',
      recoveryAttempts: 0
    });
    
    // Initialize metrics
    this.metrics.set(name, {
      latency: [],
      throughput: 0,
      errorCount: 0,
      queueSize: 0,
      memoryUsage: 0,
      cpuUsage: 0
    });
    
    // Initialize health
    this.health.set(name, {
      status: 'healthy',
      lastCheck: performance.now(),
      consecutiveFailures: 0
    });
    
    // Set up monitoring based on type
    if (type === 'secondary' && thread instanceof Worker) {
      this._setupWorkerMonitoring(name, thread);
    } else if (type === 'python') {
      this._setupPythonMonitoring(name, thread);
    } else {
      this._setupPrimaryMonitoring(name, thread);
    }
    
    this.loggingSystem.log('info', `Thread registered: ${name} (${type})`);
  }
  
  /**
   * Unregister a thread
   */
  unregisterThread(name) {
    this.threads.delete(name);
    this.metrics.delete(name);
    this.health.delete(name);
    this.loggingSystem.log('info', `Thread unregistered: ${name}`);
  }
  
  /**
   * Get thread status
   */
  getThreadStatus(name) {
    const thread = this.threads.get(name);
    const health = this.health.get(name);
    const metrics = this.metrics.get(name);
    
    if (!thread) return null;
    
    return {
      name,
      type: thread.type,
      status: health.status,
      lastHeartbeat: thread.lastHeartbeat,
      metrics: this._getMetricsSummary(metrics),
      uptime: performance.now() - thread.registeredAt
    };
  }
  
  /**
   * Get all thread statuses
   */
  getAllThreadStatuses() {
    const statuses = {};
    for (const name of this.threads.keys()) {
      statuses[name] = this.getThreadStatus(name);
    }
    return statuses;
  }
  
  /**
   * Main monitoring loop (runs on idle time, optimized)
   */
  _startMonitoringLoop() {
    let lastMonitoringTime = 0;
    const minMonitoringInterval = 1000; // Minimum 1 second between monitoring cycles
    
    const monitor = (deadline) => {
      if (!this.isMonitoring) return;
      
      const now = performance.now();
      
      // Only monitor if we have idle time AND enough time has passed
      if (deadline.timeRemaining() > 2 && (now - lastMonitoringTime) >= minMonitoringInterval) {
        this._performMonitoring(deadline);
        lastMonitoringTime = now;
      }
      
      // Schedule next monitoring cycle with longer timeout
      if (typeof requestIdleCallback !== 'undefined') {
        this.monitoringHandle = requestIdleCallback(monitor, { timeout: 2000 }); // 2 second timeout
      } else {
        // Fallback: use setTimeout with longer delay
        this.monitoringHandle = setTimeout(() => {
          monitor({ timeRemaining: () => 16 }); // Assume 16ms available
        }, minMonitoringInterval);
      }
    };
    
    // Start monitoring loop (defer initial start)
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        this.monitoringHandle = requestIdleCallback(monitor, { timeout: 2000 });
      }, { timeout: 1000 });
    } else {
      setTimeout(() => {
        this.monitoringHandle = setTimeout(() => monitor({ timeRemaining: () => 16 }), minMonitoringInterval);
      }, 1000);
    }
  }
  
  /**
   * Perform monitoring checks (non-blocking, respects deadline)
   */
  _performMonitoring(deadline) {
    const startTime = performance.now();
    const maxTime = deadline ? Math.min(deadline.timeRemaining() * 0.8, 5) : 5; // Use 80% of available time, max 5ms
    
    // Check thread health (only critical threads if time is limited)
    let processed = 0;
    for (const [name, thread] of this.threads.entries()) {
      // Check if we're out of time
      if (performance.now() - startTime > maxTime) {
        break; // Out of time, continue next cycle
      }
      
      // For primary threads with a heartbeatCallback, call it to refresh lastHeartbeat
      if (thread.heartbeatCallback) {
        try {
          if (thread.heartbeatCallback()) {
            thread.lastHeartbeat = performance.now();
          }
        } catch { /* ignore */ }
      }

      // Check for stalls (only if significant time has passed)
      const timeSinceHeartbeat = performance.now() - thread.lastHeartbeat;
      if (timeSinceHeartbeat > this.options.stallTimeout) {
        this._handleStall(name, timeSinceHeartbeat);
      }
      
      // Update metrics (lightweight operation)
      this.performanceCollector.collectMetrics(name, thread);
      processed++;
    }
    
    // Check for performance degradation (only if we have time)
    if (performance.now() - startTime < maxTime * 0.5) {
      this._checkPerformanceDegradation();
    }
    
    // Limit monitoring time to prevent blocking
    const elapsed = performance.now() - startTime;
    if (elapsed > maxTime) {
      this.loggingSystem.log('debug', `Monitoring took ${elapsed.toFixed(2)}ms (processed ${processed}/${this.threads.size} threads)`);
    }
  }
  
  /**
   * Handle thread stall
   */
  _handleStall(name, timeSinceHeartbeat) {
    const thread = this.threads.get(name);
    if (!thread) return;
    
    const health = this.health.get(name);
    health.status = 'stalled';
    health.consecutiveFailures++;
    
    const throttleDecision = this._updateStallLogState(name);
    if (throttleDecision.summary) {
      this.loggingSystem.log(
        'info',
        `Thread ${name} stall repeated ${throttleDecision.summary.count}x over ${(throttleDecision.summary.duration / 1000).toFixed(1)}s`
      );
    }

    if (throttleDecision.shouldLog) {
      this.loggingSystem.log('warn', `Thread ${name} stalled (${timeSinceHeartbeat.toFixed(0)}ms since last heartbeat)`);
    }
    
    // Trigger recovery if enabled
    if (this.options.enableRecovery) {
      this.recoveryManager.handleStall(name, thread, throttleDecision);
    }
    
    // Emit event
    this._emit('stall', { name, timeSinceHeartbeat });
  }

  /**
   * Decide whether to log a stall warning (per-thread throttle)
   */
  _updateStallLogState(name) {
    const throttleMs = this.options.stallLogThrottleMs;
    if (!throttleMs) {
      return { shouldLog: true, summary: null };
    }

    const now = performance.now();
    const state = this.stallLogState.get(name) || { lastLogTime: 0, suppressed: 0 };
    const elapsed = state.lastLogTime > 0 ? now - state.lastLogTime : Infinity;
    let summary = null;
    let shouldLog = true;

    if (state.lastLogTime > 0 && elapsed < throttleMs) {
      // Suppress this log, increment counter
      state.suppressed += 1;
      shouldLog = false;
    } else {
      if (state.suppressed > 0 && Number.isFinite(elapsed)) {
        summary = { count: state.suppressed, duration: elapsed };
        state.suppressed = 0;
      }
      state.lastLogTime = now;
    }

    this.stallLogState.set(name, state);
    return { shouldLog, summary };
  }
  
  /**
   * Check for performance degradation
   */
  _checkPerformanceDegradation() {
    for (const [name, metrics] of this.metrics.entries()) {
      const thread = this.threads.get(name);
      if (!thread || thread.priority !== 'critical') continue;
      
      // Check latency
      if (metrics.latency.length > 0) {
        const avgLatency = metrics.latency.reduce((a, b) => a + b, 0) / metrics.latency.length;
        if (avgLatency > 100) { // 100ms threshold
          this.loggingSystem.log('warn', `Thread ${name} high latency: ${avgLatency.toFixed(2)}ms`);
          this._emit('performance-degradation', { name, metric: 'latency', value: avgLatency });
        }
      }
      
      // Check error rate
      if (metrics.errorCount > 10) {
        this.loggingSystem.log('warn', `Thread ${name} high error count: ${metrics.errorCount}`);
        this._emit('performance-degradation', { name, metric: 'errors', value: metrics.errorCount });
      }
    }
  }
  
  /**
   * Setup worker monitoring
   */
  _setupWorkerMonitoring(name, worker) {
    // Set up error handler
    worker.onerror = (error) => {
      this.crashDetector.handleError(name, error);
    };
    
    // Set up message handler for heartbeat
    const originalOnMessage = worker.onmessage;
    worker.onmessage = (e) => {
      // Handle heartbeat messages
      if (e.data && e.data.type === 'heartbeat') {
        this.heartbeatManager.handleHeartbeat(name, e.data);
      }
      
      // Call original handler
      if (originalOnMessage) {
        originalOnMessage.call(worker, e);
      }
    };
  }
  
  /**
   * Setup primary thread monitoring
   */
  _setupPrimaryMonitoring(_name, _thread) {
    // Primary threads are monitored via performance hooks
    // No special setup needed
  }
  
  /**
   * Setup Python thread monitoring
   */
  _setupPythonMonitoring(name, thread) {
    // Python threads are monitored via WebSocket/HTTP health checks
    // Set up periodic health check
    setInterval(() => {
      this._checkPythonThreadHealth(name, thread);
    }, this.options.heartbeatInterval);
  }
  
  /**
   * Check Python thread health
   */
  async _checkPythonThreadHealth(name, _thread) {
    try {
      // Try to ping Python thread (implementation depends on API)
      const response = await fetch(`http://localhost:8080/api/health/${name}`);
      if (response.ok) {
        const threadInfo = this.threads.get(name);
        if (threadInfo) {
          threadInfo.lastHeartbeat = performance.now();
        }
      }
    } catch (error) {
      this.crashDetector.handleError(name, error);
    }
  }
  
  /**
   * Get metrics summary
   */
  _getMetricsSummary(metrics) {
    if (!metrics) return null;
    
    const avgLatency = metrics.latency.length > 0
      ? metrics.latency.reduce((a, b) => a + b, 0) / metrics.latency.length
      : 0;
    
    return {
      averageLatency: avgLatency,
      throughput: metrics.throughput,
      errorCount: metrics.errorCount,
      queueSize: metrics.queueSize
    };
  }
  
  /**
   * Event system
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }
  
  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }
  
  _emit(event, data) {
    if (!this.listeners.has(event)) return;
    for (const callback of this.listeners.get(event)) {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event listener for ${event}:`, error);
      }
    }
  }
}

