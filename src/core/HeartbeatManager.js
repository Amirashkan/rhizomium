// src/core/HeartbeatManager.js
// Manages heartbeat system for worker threads

export class HeartbeatManager {
  constructor(monitor) {
    this.monitor = monitor;
    this.heartbeats = new Map(); // threadName -> { lastHeartbeat, interval }
    this.heartbeatInterval = monitor.options.heartbeatInterval || 5000; // Default 5 seconds (reduced from 1s)
    this.isRunning = false;
    this.intervalHandle = null;
    this.idleCallbackHandle = null;
    this.lastHeartbeatTime = 0;
    this.adaptiveInterval = this.heartbeatInterval; // Adaptive interval based on thread health
  }
  
  /**
   * Start heartbeat monitoring (non-blocking, uses requestIdleCallback)
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.lastHeartbeatTime = performance.now();
    
    // Use requestIdleCallback for non-blocking heartbeats
    this._scheduleNextHeartbeat();
  }
  
  /**
   * Stop heartbeat monitoring
   */
  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    
    if (this.idleCallbackHandle && typeof cancelIdleCallback !== 'undefined') {
      cancelIdleCallback(this.idleCallbackHandle);
      this.idleCallbackHandle = null;
    }
  }
  
  /**
   * Schedule next heartbeat using requestIdleCallback
   */
  _scheduleNextHeartbeat() {
    if (!this.isRunning) return;
    
    // Use requestIdleCallback if available, otherwise fallback to setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
      this.idleCallbackHandle = requestIdleCallback((deadline) => {
        // Only send heartbeats if we have idle time
        if (deadline.timeRemaining() > 1) {
          this._sendHeartbeats();
        }
        // Schedule next heartbeat
        this._scheduleNextHeartbeat();
      }, { timeout: this.adaptiveInterval });
    } else {
      // Fallback to setTimeout with adaptive interval
      this.intervalHandle = setTimeout(() => {
        this._sendHeartbeats();
        this._scheduleNextHeartbeat();
      }, this.adaptiveInterval);
    }
  }
  
  /**
   * Send heartbeat requests to all workers (only if needed)
   */
  _sendHeartbeats() {
    const now = performance.now();
    
    // Skip if too soon since last heartbeat
    if (now - this.lastHeartbeatTime < this.adaptiveInterval * 0.8) {
      return;
    }
    
    this.lastHeartbeatTime = now;
    
    // Only send heartbeats to threads that need checking
    let healthyThreads = 0;
    let totalThreads = 0;
    
    for (const [name, thread] of this.monitor.threads.entries()) {
      totalThreads++;
      
      // Check if thread is healthy (recent heartbeat)
      const timeSinceHeartbeat = now - thread.lastHeartbeat;
      const isHealthy = timeSinceHeartbeat < this.monitor.options.stallTimeout * 0.5;
      
      if (isHealthy) {
        healthyThreads++;
      }
      
      // Only send heartbeat if:
      // 1. Thread is secondary worker AND hasn't responded recently
      // 2. OR thread priority is critical
      // 3. OR thread is not healthy
      const shouldCheck = (thread.type === 'secondary' && thread.thread instanceof Worker) &&
                          (!isHealthy || thread.priority === 'critical' || timeSinceHeartbeat > this.adaptiveInterval);
      
      if (shouldCheck) {
        if (thread.type === 'secondary' && thread.thread instanceof Worker) {
          this._sendWorkerHeartbeat(name, thread.thread);
        } else if (thread.heartbeatCallback) {
          // Custom heartbeat for primary threads
          thread.heartbeatCallback();
        }
      }
    }
    
    // Adapt interval based on thread health
    // If all threads are healthy, increase interval (up to 10s)
    // If any thread is unhealthy, decrease interval (down to 2s)
    if (totalThreads > 0) {
      const healthRatio = healthyThreads / totalThreads;
      if (healthRatio > 0.9) {
        // All healthy - increase interval
        this.adaptiveInterval = Math.min(this.adaptiveInterval * 1.1, 10000);
      } else if (healthRatio < 0.7) {
        // Some unhealthy - decrease interval
        this.adaptiveInterval = Math.max(this.adaptiveInterval * 0.9, 2000);
      }
    }
  }
  
  /**
   * Send heartbeat request to worker (non-blocking)
   */
  _sendWorkerHeartbeat(name, worker) {
    // Use requestIdleCallback to avoid blocking
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        this._doSendWorkerHeartbeat(name, worker);
      }, { timeout: 100 });
    } else {
      // Fallback: send immediately
      this._doSendWorkerHeartbeat(name, worker);
    }
  }
  
  /**
   * Actually send heartbeat request
   */
  _doSendWorkerHeartbeat(name, worker) {
    try {
      worker.postMessage({
        type: 'heartbeat-request',
        timestamp: performance.now()
      });
      
      // Set timeout for response (non-blocking)
      setTimeout(() => {
        this._checkHeartbeatResponse(name);
      }, 2000); // 2 second timeout (increased from 1s)
    } catch (error) {
      this.monitor.crashDetector.handleError(name, error);
    }
  }
  
  /**
   * Check if heartbeat response received
   */
  _checkHeartbeatResponse(name) {
    const thread = this.monitor.threads.get(name);
    if (!thread) return;
    
    const timeSinceHeartbeat = performance.now() - thread.lastHeartbeat;
    if (timeSinceHeartbeat > this.monitor.options.stallTimeout) {
      // Heartbeat timeout - thread may be stalled
      this.monitor._handleStall(name, timeSinceHeartbeat);
    }
  }
  
  /**
   * Handle heartbeat response from worker
   */
  handleHeartbeat(name, data) {
    const thread = this.monitor.threads.get(name);
    if (!thread) return;
    
    // Update last heartbeat time
    thread.lastHeartbeat = performance.now();
    
    // Update health status
    const health = this.monitor.health.get(name);
    if (health.status !== 'healthy') {
      health.status = 'healthy';
      health.consecutiveFailures = 0;
      this.monitor.loggingSystem.log('info', `Thread ${name} recovered`);
    }
    
    // Calculate latency
    if (data.timestamp) {
      const latency = performance.now() - data.timestamp;
      this.monitor.performanceCollector.recordLatency(name, latency);
    }
  }
}

