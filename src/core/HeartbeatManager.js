// src/core/HeartbeatManager.js
// Manages heartbeat system for worker threads

export class HeartbeatManager {
  constructor(monitor) {
    this.monitor = monitor;
    this.heartbeats = new Map(); // threadName -> { lastHeartbeat, interval }
    this.heartbeatInterval = monitor.options.heartbeatInterval;
    this.isRunning = false;
    this.intervalHandle = null;
  }
  
  /**
   * Start heartbeat monitoring
   */
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    
    // Send heartbeat requests to all workers
    this.intervalHandle = setInterval(() => {
      this._sendHeartbeats();
    }, this.heartbeatInterval);
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
  }
  
  /**
   * Send heartbeat requests to all workers
   */
  _sendHeartbeats() {
    for (const [name, thread] of this.monitor.threads.entries()) {
      if (thread.type === 'secondary' && thread.thread instanceof Worker) {
        this._sendWorkerHeartbeat(name, thread.thread);
      } else if (thread.heartbeatCallback) {
        // Custom heartbeat for primary threads
        thread.heartbeatCallback();
      }
    }
  }
  
  /**
   * Send heartbeat request to worker
   */
  _sendWorkerHeartbeat(name, worker) {
    try {
      worker.postMessage({
        type: 'heartbeat-request',
        timestamp: performance.now()
      });
      
      // Set timeout for response
      setTimeout(() => {
        this._checkHeartbeatResponse(name);
      }, 1000); // 1 second timeout
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

