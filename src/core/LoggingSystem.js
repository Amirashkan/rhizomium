// src/core/LoggingSystem.js
// Async logging system that doesn't block

export class LoggingSystem {
  constructor(monitor) {
    this.monitor = monitor;
    this.logLevel = monitor.options.logLevel;
    this.logQueue = [];
    this.isProcessing = false;
    this.maxQueueSize = 1000;
    this.logHistory = [];
    this.maxHistorySize = 1000;
    
    // Log levels
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
  }
  
  /**
   * Log a message (non-blocking)
   */
  log(level, message, ...args) {
    // Check log level
    if (this.levels[level] < this.levels[this.logLevel]) {
      return; // Skip if below log level
    }
    
    // Add to queue
    this.logQueue.push({
      level,
      message,
      args,
      timestamp: performance.now(),
      date: new Date()
    });
    
    // Limit queue size
    if (this.logQueue.length > this.maxQueueSize) {
      this.logQueue.shift(); // Remove oldest
    }
    
    // Process queue asynchronously
    this._processQueue();
  }
  
  /**
   * Process log queue (non-blocking)
   */
  _processQueue() {
    if (this.isProcessing) return;
    
    // Use requestIdleCallback to avoid blocking
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        this._doProcessQueue();
      }, { timeout: 100 });
    } else {
      // Fallback: process on next tick
      setTimeout(() => {
        this._doProcessQueue();
      }, 0);
    }
  }
  
  /**
   * Actually process log queue
   */
  _doProcessQueue() {
    this.isProcessing = true;
    
    // Process up to 10 logs at a time
    let processed = 0;
    while (this.logQueue.length > 0 && processed < 10) {
      const log = this.logQueue.shift();
      this._writeLog(log);
      processed++;
    }
    
    this.isProcessing = false;
    
    // Continue processing if queue not empty
    if (this.logQueue.length > 0) {
      this._processQueue();
    }
  }
  
  /**
   * Write log entry
   */
  _writeLog(log) {
    // Store in history
    this.logHistory.push(log);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }
    
    // Write to console (non-blocking)
    const consoleMethod = console[log.level] || console.log;
    consoleMethod(`[${log.date.toISOString()}] [${log.level.toUpperCase()}] ${log.message}`, ...log.args);
    
    // Optionally send to remote logging service
    if (this.monitor.options.remoteLogging) {
      this._sendToRemote(log);
    }
  }
  
  /**
   * Send log to remote service (async, non-blocking)
   */
  async _sendToRemote(log) {
    try {
      // Use sendBeacon for non-blocking remote logging
      if (navigator.sendBeacon) {
        const data = JSON.stringify(log);
        navigator.sendBeacon(this.monitor.options.remoteLoggingUrl, data);
      }
    } catch {
      // Silently fail - don't block on logging errors
    }
  }
  
  /**
   * Get log history
   */
  getHistory(level = null, limit = 100) {
    let history = this.logHistory;
    
    // Filter by level if specified
    if (level) {
      history = history.filter(log => log.level === level);
    }
    
    // Return last N entries
    return history.slice(-limit);
  }
  
  /**
   * Clear log history
   */
  clearHistory() {
    this.logHistory = [];
    this.logQueue = [];
  }
}

