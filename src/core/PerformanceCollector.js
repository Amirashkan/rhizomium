// src/core/PerformanceCollector.js
// Collects performance metrics for all threads

export class PerformanceCollector {
  constructor(monitor) {
    this.monitor = monitor;
    this.metrics = new Map(); // threadName -> Metrics
    this.history = new Map(); // threadName -> History[]
    this.maxHistorySize = 100; // Keep last 100 samples
    this.isCollecting = false;
    this.collectionHandle = null;
  }
  
  /**
   * Start collecting metrics
   */
  start() {
    if (this.isCollecting) return;
    
    this.isCollecting = true;
    
    // Collect metrics periodically (non-blocking)
    this.collectionHandle = setInterval(() => {
      this._collectMetrics();
    }, this.monitor.options.metricsInterval);
  }
  
  /**
   * Stop collecting metrics
   */
  stop() {
    if (!this.isCollecting) return;
    
    this.isCollecting = false;
    
    if (this.collectionHandle) {
      clearInterval(this.collectionHandle);
      this.collectionHandle = null;
    }
  }
  
  /**
   * Collect metrics for all threads
   */
  _collectMetrics() {
    // Use requestIdleCallback to avoid blocking
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        this._doCollectMetrics();
      }, { timeout: 10 });
    } else {
      // Fallback: collect synchronously (should be fast)
      this._doCollectMetrics();
    }
  }
  
  /**
   * Actually collect metrics
   */
  _doCollectMetrics() {
    for (const [name, thread] of this.monitor.threads.entries()) {
      this.collectMetrics(name, thread);
    }
  }
  
  /**
   * Collect metrics for a specific thread
   */
  collectMetrics(name, thread) {
    const metrics = this.monitor.metrics.get(name);
    if (!metrics) return;
    
    // Collect different metrics based on thread type
    switch (thread.type) {
      case 'primary':
        this._collectPrimaryMetrics(name, thread, metrics);
        break;
      case 'secondary':
        this._collectSecondaryMetrics(name, thread, metrics);
        break;
      case 'python':
        this._collectPythonMetrics(name, thread, metrics);
        break;
    }
    
    // Store in history
    this._storeHistory(name, metrics);
  }
  
  /**
   * Collect metrics for primary thread
   */
  _collectPrimaryMetrics(name, thread, metrics) {
    // For primary threads, we can measure frame time, etc.
    if (name === 'RenderLoop') {
      // Frame time is collected by RenderLoop itself
      // We just read it here
      if (window.renderLoop && window.renderLoop.getFrameTime) {
        const frameTime = window.renderLoop.getFrameTime();
        metrics.latency.push(frameTime);
        if (metrics.latency.length > 100) {
          metrics.latency.shift(); // Keep last 100
        }
      }
    }
  }
  
  /**
   * Collect metrics for secondary thread (worker)
   */
  _collectSecondaryMetrics(name, thread, metrics) {
    // Queue size (if available from queue manager)
    if (window.queueManager) {
      const queueSize = window.queueManager.getQueueSize(name);
      metrics.queueSize = queueSize;
    }
    
    // Memory usage (if available)
    if (performance.memory) {
      metrics.memoryUsage = performance.memory.usedJSHeapSize;
    }
  }
  
  /**
   * Collect metrics for Python thread
   */
  _collectPythonMetrics(name, thread, metrics) {
    // Python threads are monitored via API
    // Metrics collected asynchronously
  }
  
  /**
   * Record latency for a thread
   */
  recordLatency(name, latency) {
    const metrics = this.monitor.metrics.get(name);
    if (!metrics) return;
    
    metrics.latency.push(latency);
    if (metrics.latency.length > 100) {
      metrics.latency.shift(); // Keep last 100 samples
    }
  }
  
  /**
   * Record throughput for a thread
   */
  recordThroughput(name, count) {
    const metrics = this.monitor.metrics.get(name);
    if (!metrics) return;
    
    metrics.throughput = count;
  }
  
  /**
   * Record error for a thread
   */
  recordError(name) {
    const metrics = this.monitor.metrics.get(name);
    if (!metrics) return;
    
    metrics.errorCount++;
  }
  
  /**
   * Store metrics in history
   */
  _storeHistory(name, metrics) {
    if (!this.history.has(name)) {
      this.history.set(name, []);
    }
    
    const history = this.history.get(name);
    history.push({
      timestamp: performance.now(),
      ...this._cloneMetrics(metrics)
    });
    
    // Limit history size
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
  }
  
  /**
   * Get metrics history
   */
  getHistory(name, duration = 60000) {
    // Return metrics from last N milliseconds
    const history = this.history.get(name);
    if (!history) return [];
    
    const cutoff = performance.now() - duration;
    return history.filter(h => h.timestamp >= cutoff);
  }
  
  /**
   * Clone metrics object
   */
  _cloneMetrics(metrics) {
    return {
      latency: [...metrics.latency],
      throughput: metrics.throughput,
      errorCount: metrics.errorCount,
      queueSize: metrics.queueSize,
      memoryUsage: metrics.memoryUsage
    };
  }
}

