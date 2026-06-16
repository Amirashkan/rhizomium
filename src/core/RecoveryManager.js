// src/core/RecoveryManager.js
// Handles automatic recovery from thread failures

export class RecoveryManager {
  constructor(monitor) {
    this.monitor = monitor;
    this.recoveryStrategies = new Map(); // threadName -> Strategy
    this.recoveryHistory = new Map(); // threadName -> RecoveryAttempt[]
  }
  
  /**
   * Handle thread crash
   */
  async handleCrash(name, thread, error) {
    if (thread.recoveryAttempts >= this.monitor.options.maxRecoveryAttempts) {
      this.monitor.loggingSystem.log('error', `Thread ${name} exceeded max recovery attempts, disabling`);
      return;
    }
    
    thread.recoveryAttempts++;
    
    this.monitor.loggingSystem.log('info', `Attempting to recover thread ${name} (attempt ${thread.recoveryAttempts})`);
    
    // Get recovery strategy
    const strategy = this.recoveryStrategies.get(name) || this._getDefaultStrategy(thread.type);
    
    try {
      // Attempt recovery
      await strategy.recover(name, thread, error);
      
      // Record successful recovery
      this._recordRecovery(name, true);
      
      this.monitor.loggingSystem.log('info', `Thread ${name} recovered successfully`);
    } catch (recoveryError) {
      // Recovery failed
      this._recordRecovery(name, false);
      
      this.monitor.loggingSystem.log('error', `Failed to recover thread ${name}:`, recoveryError);
      
      // Try fallback strategy
      await this._tryFallbackStrategy(name, thread, error);
    }
  }
  
  /**
   * Handle thread stall
   */
  async handleStall(name, thread, stallLogDecision = null) {
    if (thread.recoveryAttempts >= this.monitor.options.maxRecoveryAttempts) {
      return;
    }
    
    const shouldLog =
      !stallLogDecision || stallLogDecision.shouldLog !== false;
    if (shouldLog) {
      this.monitor.loggingSystem.log('warn', `Thread ${name} stalled, attempting recovery`);
    }
    
    // For stalls, try to restart the thread
    if (thread.type === 'secondary' && thread.thread instanceof Worker) {
      await this._restartWorker(name, thread);
    }
  }
  
  /**
   * Restart worker thread
   */
  async _restartWorker(name, thread) {
    try {
      // Terminate old worker
      thread.thread.terminate();
      
      // Create new worker
      const workerScript = this._getWorkerScript(name);
      const newWorker = new Worker(workerScript, { type: 'module' });
      
      // Re-register with monitor
      this.monitor.registerThread({
        name,
        type: 'secondary',
        thread: newWorker,
        priority: thread.priority
      });
      
      this.monitor.loggingSystem.log('info', `Worker ${name} restarted`);
    } catch (error) {
      this.monitor.loggingSystem.log('error', `Failed to restart worker ${name}:`, error);
      throw error;
    }
  }
  
  /**
   * Get default recovery strategy
   */
  _getDefaultStrategy(type) {
    switch (type) {
      case 'secondary':
        return {
          recover: async (name, thread, error) => {
            // Default: restart worker
            await this._restartWorker(name, thread);
          }
        };
      case 'primary':
        return {
          recover: async (name, thread, error) => {
            // Primary threads can't be restarted, use fallback
            await this._enableFallback(name, thread);
          }
        };
      case 'python':
        return {
          recover: async (name, thread, error) => {
            // Try to reconnect to Python thread
            await this._reconnectPythonThread(name, thread);
          }
        };
      default:
        return {
          recover: async () => {
            // No recovery strategy
          }
        };
    }
  }
  
  /**
   * Enable fallback for primary thread
   */
  async _enableFallback(name, thread) {
    // For primary threads, we can't restart them
    // Instead, we enable fallback mechanisms
    this.monitor.loggingSystem.log('warn', `Enabling fallback for primary thread ${name}`);
    
    // Emit event so application can handle fallback
    this.monitor._emit('fallback-enabled', { name, thread });
  }
  
  /**
   * Try fallback strategy
   */
  async _tryFallbackStrategy(name, thread, error) {
    // Fallback: disable worker and use main thread
    if (thread.type === 'secondary') {
      this.monitor.loggingSystem.log('warn', `Enabling main thread fallback for ${name}`);
      this.monitor._emit('fallback-enabled', { name, thread });
    }
  }
  
  /**
   * Record recovery attempt
   */
  _recordRecovery(name, success) {
    if (!this.recoveryHistory.has(name)) {
      this.recoveryHistory.set(name, []);
    }
    
    this.recoveryHistory.get(name).push({
      timestamp: performance.now(),
      success
    });
  }
  
  /**
   * Get worker script path
   */
  _getWorkerScript(name) {
    // Map thread names to worker scripts. Root-absolute so they resolve the
    // same whether the editor page is served at /studio (web) or /editor/
    // (Tauri / static file host).
    const workerScripts = {
      'previewComputer': '/workers/preview-computer-worker.js',
      'parameterExpression': '/workers/parameter-expression-worker.js',
      'saveLoad': '/workers/save-load-worker.js',
      'undoManager': '/workers/undo-manager-worker.js'
    };

    return workerScripts[name] || `/workers/${name}-worker.js`;
  }
  
  /**
   * Reconnect to Python thread
   */
  async _reconnectPythonThread(name, thread) {
    // Implementation depends on Python thread API
    // This is a placeholder
    this.monitor.loggingSystem.log('info', `Attempting to reconnect to Python thread ${name}`);
  }
}

