// src/core/CrashDetector.js
// Detects and handles thread crashes

export class CrashDetector {
  constructor(monitor) {
    this.monitor = monitor;
    this.crashHistory = new Map(); // threadName -> CrashInfo[]
    this.maxCrashHistory = 10;
  }
  
  /**
   * Start crash detection
   */
  start() {
    // Crash detection is event-driven, no polling needed
    // Set up global error handlers
    this._setupGlobalErrorHandlers();
  }
  
  /**
   * Stop crash detection
   */
  stop() {
    // Remove global error handlers
    this._removeGlobalErrorHandlers();
  }
  
  /**
   * Handle error from a thread
   */
  handleError(name, error) {
    const thread = this.monitor.threads.get(name);
    if (!thread) return;
    
    // Record crash
    this._recordCrash(name, error);
    
    // Update health
    const health = this.monitor.health.get(name);
    health.status = 'crashed';
    health.consecutiveFailures++;
    
    // Log error
    this.monitor.loggingSystem.log('error', `Thread ${name} crashed:`, error);
    
    // Trigger recovery
    if (this.monitor.options.enableRecovery) {
      this.monitor.recoveryManager.handleCrash(name, thread, error);
    }
    
    // Emit event
    this.monitor._emit('crash', { name, error });
  }
  
  /**
   * Record crash in history
   */
  _recordCrash(name, error) {
    if (!this.crashHistory.has(name)) {
      this.crashHistory.set(name, []);
    }
    
    const history = this.crashHistory.get(name);
    history.push({
      timestamp: performance.now(),
      error: error.message || String(error),
      stack: error.stack
    });
    
    // Limit history size
    if (history.length > this.maxCrashHistory) {
      history.shift();
    }
  }
  
  /**
   * Get crash history
   */
  getCrashHistory(name) {
    return this.crashHistory.get(name) || [];
  }
  
  /**
   * Setup global error handlers
   */
  _setupGlobalErrorHandlers() {
    // Window error handler
    this._originalWindowError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      // Try to identify which thread caused the error
      const threadName = this._identifyThreadFromError(source, error);
      if (threadName) {
        this.handleError(threadName, error || new Error(message));
      }
      
      // Call original handler
      if (this._originalWindowError) {
        this._originalWindowError.call(window, message, source, lineno, colno, error);
      }
    };
    
    // Unhandled promise rejection handler
    this._originalUnhandledRejection = window.onunhandledrejection;
    window.onunhandledrejection = (event) => {
      // Try to identify thread from promise rejection
      const threadName = this._identifyThreadFromPromise(event.reason);
      if (threadName) {
        this.handleError(threadName, event.reason);
      }
      
      // Call original handler
      if (this._originalUnhandledRejection) {
        this._originalUnhandledRejection.call(window, event);
      }
    };
  }
  
  /**
   * Remove global error handlers
   */
  _removeGlobalErrorHandlers() {
    if (this._originalWindowError) {
      window.onerror = this._originalWindowError;
    }
    if (this._originalUnhandledRejection) {
      window.onunhandledrejection = this._originalUnhandledRejection;
    }
  }
  
  /**
   * Identify thread from error source
   */
  _identifyThreadFromError(source, error) {
    // Check if error is from a worker
    for (const [name, thread] of this.monitor.threads.entries()) {
      if (thread.type === 'secondary' && thread.thread instanceof Worker) {
        // Check if error source matches worker script
        if (source && source.includes(name)) {
          return name;
        }
      }
    }
    
    return null;
  }
  
  /**
   * Identify thread from promise rejection
   */
  _identifyThreadFromPromise(reason) {
    // Check if rejection is from a worker operation
    if (reason && reason.threadName) {
      return reason.threadName;
    }
    
    return null;
  }
}

