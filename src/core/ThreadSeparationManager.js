// src/core/ThreadSeparationManager.js
// Main coordinator for two-part thread separation system

import { AsyncQueueManager, MessagePriority } from './AsyncQueueManager.js';
import { ThreadMonitor } from './ThreadMonitor.js';

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
   * Initialize the thread separation system
   */
  async initialize() {
    if (!this.options.enabled) {
      console.log('Thread separation disabled');
      return;
    }
    
    // Start thread monitor
    this.threadMonitor.start();
    
    // Initialize workers if enabled
    if (this.options.enableWorkers) {
      await this._initializeWorkers();
    } else {
      console.log('Web Workers disabled, using main thread fallback');
    }
    
    // Register primary threads
    this._registerPrimaryThreads();
  }
  
  /**
   * Initialize all workers
   */
  async _initializeWorkers() {
    try {
      // PreviewComputer Worker
      await this._initWorker('previewComputer', 'workers/preview-computer-worker.js');
      
      // ParameterExpressionSystem Worker
      await this._initWorker('parameterExpression', 'workers/parameter-expression-worker.js');
      
      // SaveLoadManager Worker
      await this._initWorker('saveLoad', 'workers/save-load-worker.js');
      
      // UndoManager Worker
      await this._initWorker('undoManager', 'workers/undo-manager-worker.js');
      
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
  async _initWorker(name, scriptPath) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(scriptPath, { type: 'module' });
        
        // Set up message handler
        worker.onmessage = (e) => {
          if (e.data.type === 'ready') {
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
            reject(new Error(e.data.error));
          }
        };
        
        worker.onerror = (error) => {
          console.error(`Worker ${name} error:`, error);
          reject(error);
        };
        
        // Send init message
        worker.postMessage({ type: 'init', id: Date.now() });
        
        // Timeout after 5 seconds
        setTimeout(() => {
          if (!this.workers.has(name)) {
            reject(new Error(`Worker ${name} initialization timeout`));
          }
        }, 5000);
        
      } catch (error) {
        console.error(`Failed to create worker ${name}:`, error);
        reject(error);
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
        priority: 'critical'
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

