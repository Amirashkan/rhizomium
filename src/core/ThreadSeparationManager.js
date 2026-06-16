// src/core/ThreadSeparationManager.js
// Main coordinator for two-part thread separation system

import { AsyncQueueManager, MessagePriority } from './AsyncQueueManager.js';
import { ThreadMonitor } from './ThreadMonitor.js';
import { createWorker } from './workerFactories.js';

export class ThreadSeparationManager {
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled !== false,
      enableWorkers: options.enableWorkers !== false && typeof Worker !== 'undefined',
      ...options
    };
    
    // Core components
    this.queueManager = new AsyncQueueManager();
    this.threadMonitor = new ThreadMonitor({
      enabled: this.options.enabled,
      ...options.monitorOptions
    });
    
    // Workers
    this.workers = new Map();
    
    // Fallback flags
    this.fallbackToMainThread = new Map();
    
    // Make available globally for debugging
    window.queueManager = this.queueManager;
    window.threadMonitor = this.threadMonitor;
  }
  
  /**
   * Initialize the thread separation system (deferred, non-blocking)
   */
  async initialize() {
    if (!this.options.enabled) {
      console.log('Thread separation disabled');
      return;
    }
    
    // Defer initialization until after app load using requestIdleCallback
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(async () => {
        await this._doInitialize();
      }, { timeout: 3000 }); // Start after 3 seconds max
    } else {
      // Fallback: defer with setTimeout
      setTimeout(async () => {
        await this._doInitialize();
      }, 2000);
    }
  }
  
  /**
   * Actually perform initialization
   */
  async _doInitialize() {
    try {
      // Start thread monitor (non-blocking)
      this.threadMonitor.start();
      
      // Initialize workers if enabled (async, non-blocking)
      if (this.options.enableWorkers) {
        // Initialize workers in background, don't block
        this._initializeWorkers().catch(error => {
          console.error('Worker initialization failed:', error);
          this._enableMainThreadFallback();
        });
      } else {
        console.log('Web Workers disabled, using main thread fallback');
      }
      
      // Register primary threads (deferred until they're available)
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => {
          this._registerPrimaryThreads();
        }, { timeout: 1000 });
      } else {
        setTimeout(() => {
          this._registerPrimaryThreads();
        }, 1000);
      }
    } catch (error) {
      console.error('Thread separation initialization error:', error);
      this._enableMainThreadFallback();
    }
  }
  
  /**
   * Initialize all workers
   */
  async _initializeWorkers() {
    try {
      // PreviewComputer Worker
      await this._initWorker('previewComputer');

      // ParameterExpressionSystem Worker
      await this._initWorker('parameterExpression');

      // SaveLoadManager Worker
      await this._initWorker('saveLoad');

      // UndoManager Worker
      await this._initWorker('undoManager');
      
      console.log('All workers initialized successfully');
    } catch (error) {
      console.error('Failed to initialize workers:', error);
      // Fallback to main thread
      this._enableMainThreadFallback();
    }
  }
  
  /**
   * Initialize a single worker
   */
  async _initWorker(name) {
    return new Promise((resolve, reject) => {
      let timeoutId = null;
      let resolved = false;

      try {
        const worker = createWorker(name);
        
        // Set up message handler
        worker.onmessage = (e) => {
          if (e.data.type === 'ready') {
            if (resolved) return; // Already resolved/rejected
            resolved = true;
            
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            
            // Worker is ready
            this.workers.set(name, worker);
            this.queueManager.registerWorker(name, worker);
            
            // Register with thread monitor
            this.threadMonitor.registerThread({
              name,
              type: 'secondary',
              thread: worker,
              priority: this._getWorkerPriority(name)
            });
            
            console.log(`Worker ${name} initialized`);
            resolve(worker);
          } else if (e.data.type === 'error') {
            if (resolved) return;
            resolved = true;
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
            reject(new Error(e.data.error));
          }
        };
        
        worker.onerror = (error) => {
          if (resolved) return;
          resolved = true;
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
          
          console.error(`Worker ${name} error:`, error);
          // Don't reject - fallback to main thread instead
          console.warn(`Worker ${name} failed, will use main thread fallback`);
          this.fallbackToMainThread.set(name, true);
          resolve(null); // Resolve with null to continue initialization
        };
        
        // Send init message
        worker.postMessage({ type: 'init', id: Date.now() });
        
        // Timeout after 10 seconds (increased from 5)
        timeoutId = setTimeout(() => {
          if (!resolved && !this.workers.has(name)) {
            resolved = true;
            console.warn(`Worker ${name} initialization timeout, will use main thread fallback`);
            worker.terminate(); // Clean up the worker
            this.fallbackToMainThread.set(name, true);
            resolve(null); // Resolve with null to continue initialization
          }
        }, 10000);
        
      } catch (error) {
        if (resolved) return;
        resolved = true;
        
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        
        console.error(`Failed to create worker ${name}:`, error);
        // Don't reject - fallback to main thread instead
        console.warn(`Worker ${name} creation failed, will use main thread fallback`);
        this.fallbackToMainThread.set(name, true);
        resolve(null); // Resolve with null to continue initialization
      }
    });
  }
  
  /**
   * Get worker priority
   */
  _getWorkerPriority(name) {
    const priorities = {
      'previewComputer': 'high',
      'parameterExpression': 'high',
      'saveLoad': 'normal',
      'undoManager': 'normal'
    };
    return priorities[name] || 'normal';
  }
  
  /**
   * Register primary threads with monitor
   */
  _registerPrimaryThreads() {
    // Register RenderLoop if available
    if (window.renderLoop) {
      this.threadMonitor.registerThread({
        name: 'RenderLoop',
        type: 'primary',
        thread: window.renderLoop,
        priority: 'critical',
        heartbeatCallback: () => {
          return window.renderLoop && window.renderLoop._running;
        }
      });
    }
    
    // Register ExecutionQueue if available
    if (window.executionQueue) {
      this.threadMonitor.registerThread({
        name: 'ExecutionQueue',
        type: 'primary',
        thread: window.executionQueue,
        priority: 'critical',
        heartbeatCallback: () => {
          return !!(window.executionQueue);
        }
      });
    }
  }
  
  /**
   * Enable main thread fallback for all workers
   */
  _enableMainThreadFallback() {
    for (const name of ['previewComputer', 'parameterExpression', 'saveLoad', 'undoManager']) {
      this.fallbackToMainThread.set(name, true);
    }
  }
  
  /**
   * Check if worker is available
   */
  isWorkerAvailable(name) {
    return this.workers.has(name) && !this.fallbackToMainThread.get(name);
  }
  
  /**
   * Get worker instance
   */
  getWorker(name) {
    return this.workers.get(name);
  }
  
  /**
   * Get queue manager
   */
  getQueueManager() {
    return this.queueManager;
  }
  
  /**
   * Get thread monitor
   */
  getThreadMonitor() {
    return this.threadMonitor;
  }
  
  /**
   * Cleanup
   */
  cleanup() {
    // Terminate all workers
    for (const [name, worker] of this.workers.entries()) {
      worker.terminate();
    }
    this.workers.clear();
    
    // Stop thread monitor
    this.threadMonitor.stop();
  }
}

// Export singleton instance
let threadSeparationManager = null;

export function getThreadSeparationManager() {
  if (!threadSeparationManager) {
    threadSeparationManager = new ThreadSeparationManager();
  }
  return threadSeparationManager;
}

