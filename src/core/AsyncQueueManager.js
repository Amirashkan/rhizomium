// src/core/AsyncQueueManager.js
// Non-blocking message queue with priority support for Primary-Secondary thread communication

/**
 * Priority levels for message queues
 */
export const MessagePriority = {
  CRITICAL: 0,  // Render-critical operations (must process immediately)
  HIGH: 1,      // Important operations (process within frame)
  NORMAL: 2,    // Standard operations (process when available)
  LOW: 3,       // Background operations (process when idle)
  IDLE: 4       // Non-urgent operations (process during idle time)
};

/**
 * Async Queue Manager - Non-blocking message queue with priority support
 */
export class AsyncQueueManager {
  constructor() {
    // Priority queues for each worker
    this.queues = new Map();
    this.workers = new Map();
    this.pendingRequests = new Map();
    this.requestIdCounter = 0;
    
    // Performance metrics
    this.metrics = {
      messagesSent: 0,
      messagesProcessed: 0,
      averageLatency: 0,
      queueSizes: new Map()
    };
    
    // Process queues using requestIdleCallback (non-blocking)
    this._scheduleQueueProcessing();
    this.isProcessing = false;
    this.processingHandle = null;
  }
  
  /**
   * Register a worker with the queue manager
   */
  registerWorker(workerName, worker, options = {}) {
    this.workers.set(workerName, worker);
    
    // Initialize priority queues for this worker
    const queues = new Map();
    for (let priority = 0; priority <= 4; priority++) {
      queues.set(priority, []);
    }
    this.queues.set(workerName, queues);
    
    // Set up message handler
    worker.onmessage = (e) => {
      this._handleWorkerResponse(workerName, e.data);
    };
    
    // Set up error handler
    worker.onerror = (error) => {
      console.error(`Worker ${workerName} error:`, error);
      this._handleWorkerError(workerName, error);
    };
    
    // Schedule queue processing (non-blocking)
    this._scheduleQueueProcessing();
  }
  
  /**
   * Enqueue a message to a worker (non-blocking)
   */
  enqueue(workerName, message, priority = MessagePriority.NORMAL) {
    if (!this.queues.has(workerName)) {
      throw new Error(`Worker ${workerName} not registered`);
    }
    
    const queues = this.queues.get(workerName);
    const queue = queues.get(priority);
    
    // Add timestamp for latency tracking
    message._enqueueTime = performance.now();
    message._priority = priority;
    
    queue.push(message);
    this.metrics.messagesSent++;
    this.metrics.queueSizes.set(workerName, this._getTotalQueueSize(workerName));
    
    // Schedule processing only if not already scheduled (non-blocking)
    if (!this.isProcessing) {
      this._scheduleQueueProcessing();
    }
    
    return message.id || null;
  }
  
  /**
   * Send a request and return a promise (non-blocking)
   */
  async request(workerName, message, priority = MessagePriority.NORMAL) {
    return new Promise((resolve, reject) => {
      const requestId = ++this.requestIdCounter;
      
      message.id = requestId;
      message.type = message.type || 'request';
      
      // Store promise resolvers with timeout (use default if not provided)
      const timeout = message.timeout || 30000; // 30s default timeout
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        workerName,
        timestamp: performance.now(),
        timeout: timeout
      });
      
      // Enqueue message
      this.enqueue(workerName, message, priority);
      
      // Set timeout timer (always set, using stored timeout value)
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          const pending = this.pendingRequests.get(requestId);
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request ${requestId} timed out after ${pending.timeout}ms`));
        }
      }, timeout);
    });
  }
  
  /**
   * Process queue for a worker (non-blocking, processes one message at a time)
   */
  _processQueue(workerName) {
    if (!this.workers.has(workerName)) return;
    
    const queues = this.queues.get(workerName);
    const worker = this.workers.get(workerName);
    
    // Find highest priority message
    let message = null;
    let priority = -1;
    
    for (let p = 0; p <= 4; p++) {
      const queue = queues.get(p);
      if (queue.length > 0) {
        message = queue.shift();
        priority = p;
        break;
      }
    }
    
    if (!message) {
      // Queue empty, schedule next check
      this._scheduleQueueProcessing();
      return;
    }
    
    // Send message to worker (non-blocking)
    try {
      const transferables = message._transferables || [];
      worker.postMessage(message, transferables);
      
      // Update metrics
      const latency = performance.now() - message._enqueueTime;
      this._updateLatencyMetrics(workerName, latency);
      
    } catch (error) {
      console.error(`Error sending message to ${workerName}:`, error);
      // Reject pending request if exists
      if (message.id && this.pendingRequests.has(message.id)) {
        const pending = this.pendingRequests.get(message.id);
        this.pendingRequests.delete(message.id);
        pending.reject(error);
      }
    }
    
    // Schedule next message processing only if there are more messages (non-blocking)
    if (this._getTotalQueueSize(workerName) > 0) {
      this._scheduleQueueProcessing();
    }
  }
  
  /**
   * Handle worker response
   */
  _handleWorkerResponse(workerName, data) {
    if (data.id && this.pendingRequests.has(data.id)) {
      const pending = this.pendingRequests.get(data.id);
      this.pendingRequests.delete(data.id);
      
      // Calculate latency
      const latency = performance.now() - pending.timestamp;
      this._updateLatencyMetrics(workerName, latency);
      
      if (data.error) {
        pending.reject(new Error(data.error));
      } else {
        pending.resolve(data.result || data);
      }
    } else {
      // Fire-and-forget response (no pending request)
      // This could be a response to a fire-and-forget message with a callback
      // registered elsewhere (e.g., in PreviewComputer)
      this._handleFireAndForgetResponse(workerName, data);
    }
    
    // Continue processing queue
    this._processQueue(workerName);
  }
  
  /**
   * Schedule queue processing (non-blocking, optimized)
   */
  _scheduleQueueProcessing() {
    // Skip if already processing
    if (this.isProcessing) return;
    
    // Check if there are any messages to process
    let hasMessages = false;
    for (const workerName of this.workers.keys()) {
      if (this._getTotalQueueSize(workerName) > 0) {
        hasMessages = true;
        break;
      }
    }
    
    // Only schedule if there are messages
    if (!hasMessages) return;
    
    this.isProcessing = true;
    
    // Use requestIdleCallback if available, otherwise setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
      this.processingHandle = requestIdleCallback((deadline) => {
        this.isProcessing = false;
        
        // Process queues only if we have idle time
        if (deadline.timeRemaining() > 1) {
          for (const workerName of this.workers.keys()) {
            if (this._getTotalQueueSize(workerName) > 0) {
              this._processQueue(workerName);
              // Check if we still have time
              if (deadline.timeRemaining() < 1) break;
            }
          }
        }
        
        // Schedule next processing if there are still messages
        if (this._hasAnyMessages()) {
          this._scheduleQueueProcessing();
        }
      }, { timeout: 100 }); // 100ms timeout
    } else {
      // Fallback: use setTimeout with minimal delay
      this.processingHandle = setTimeout(() => {
        this.isProcessing = false;
        for (const workerName of this.workers.keys()) {
          if (this._getTotalQueueSize(workerName) > 0) {
            this._processQueue(workerName);
          }
        }
        // Schedule next processing if there are still messages
        if (this._hasAnyMessages()) {
          this._scheduleQueueProcessing();
        }
      }, 0);
    }
  }
  
  /**
   * Check if there are any messages in any queue
   */
  _hasAnyMessages() {
    for (const workerName of this.workers.keys()) {
      if (this._getTotalQueueSize(workerName) > 0) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Get total queue size for a worker
   */
  _getTotalQueueSize(workerName) {
    const queues = this.queues.get(workerName);
    if (!queues) return 0;
    
    let total = 0;
    for (const queue of queues.values()) {
      total += queue.length;
    }
    return total;
  }
  
  /**
   * Update latency metrics
   */
  _updateLatencyMetrics(workerName, latency) {
    this.metrics.messagesProcessed++;
    
    // Exponential moving average
    const alpha = 0.1;
    this.metrics.averageLatency = 
      (1 - alpha) * this.metrics.averageLatency + alpha * latency;
  }
  
  /**
   * Handle fire-and-forget responses
   */
  _handleFireAndForgetResponse(workerName, data) {
    // Override in subclasses or register handlers
    if (this.onFireAndForgetResponse) {
      this.onFireAndForgetResponse(workerName, data);
    }
  }
  
  /**
   * Handle worker errors
   */
  _handleWorkerError(workerName, error) {
    // Reject all pending requests for this worker
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      if (pending.workerName === workerName) {
        this.pendingRequests.delete(requestId);
        pending.reject(error);
      }
    }
  }
  
  /**
   * Get queue size for a worker
   */
  getQueueSize(workerName) {
    return this._getTotalQueueSize(workerName);
  }
  
  /**
   * Get metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      queueSizes: Object.fromEntries(this.metrics.queueSizes),
      pendingRequests: this.pendingRequests.size
    };
  }
}

