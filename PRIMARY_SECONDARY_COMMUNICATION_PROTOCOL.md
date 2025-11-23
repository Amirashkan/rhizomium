# Primary-Secondary Thread Communication Protocol

This document defines safe, non-blocking communication mechanisms between Primary threads (RenderLoop, ExecutionQueue, ComputeExecutor, Shader Build Pipeline, SystemIntegration) and isolated Secondary threads (PreviewComputer Worker, ParameterExpressionSystem Worker, SaveLoadManager Worker, UndoManager Worker).

**Last Updated**: Generated from architecture analysis  
**Status**: Design Specification

---

## Design Principles

### 1. Non-Blocking Communication
- Primary threads **never wait** for secondary thread responses
- All communication is **asynchronous** with callback/promise patterns
- Use **async queues** to buffer messages when workers are busy

### 2. Priority-Based Processing
- Critical operations (rendering) have highest priority
- Background operations (save/load) have lower priority
- Priority queues ensure important messages are processed first

### 3. Thread Safety
- Immutable data snapshots prevent race conditions
- Versioned state ensures consistency
- Request-response patterns guarantee ordering

### 4. Performance Optimization
- Transferable Objects for zero-copy large data transfers
- Batching to reduce message overhead
- Caching to minimize redundant computations

---

## Communication Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    PRIMARY THREADS                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  RenderLoop ──────┐                                          │
│                   │                                          │
│  ExecutionQueue ──┼───┐                                      │
│                   │   │                                      │
│  ComputeExecutor ─┼───┼───┐                                 │
│                   │   │   │                                 │
│  Shader Build ────┼───┼───┼───┐                            │
│                   │   │   │   │                            │
│  SystemIntegration┼───┼───┼───┼───┐                        │
│                   │   │   │   │   │                        │
└───────────────────┼───┼───┼───┼───┼────────────────────────┘
                    │   │   │   │   │
                    ▼   ▼   ▼   ▼   ▼
        ┌───────────┴───┴───┴───┴───┴───────────┐
        │     ASYNC MESSAGE QUEUE MANAGER        │
        │  (Priority-based, Non-blocking)        │
        └───────────┬───┬───┬───┬───┬───────────┘
                    │   │   │   │   │
                    ▼   ▼   ▼   ▼   ▼
┌───────────────────┴───┴───┴───┴───┴────────────────────────┐
│              SECONDARY THREADS (Web Workers)                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  PreviewComputer Worker                                      │
│  ParameterExpressionSystem Worker                            │
│  SaveLoadManager Worker                                      │
│  UndoManager Worker                                          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Async Queue Manager

### Core Implementation

```javascript
// src/core/AsyncQueueManager.js

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
    
    // Process queues on next tick (non-blocking)
    this._scheduleQueueProcessing();
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
    
    // Start processing queue
    this._processQueue(workerName);
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
    
    // Schedule processing (non-blocking)
    this._scheduleQueueProcessing();
    
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
      
      // Store promise resolvers
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        workerName,
        timestamp: performance.now(),
        timeout: message.timeout || 30000 // 30s default timeout
      });
      
      // Enqueue message
      this.enqueue(workerName, message, priority);
      
      // Set timeout
      if (message.timeout) {
        setTimeout(() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.delete(requestId);
            reject(new Error(`Request ${requestId} timed out after ${message.timeout}ms`));
          }
        }, message.timeout);
      }
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
    
    // Schedule next message processing (non-blocking)
    this._scheduleQueueProcessing();
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
      this._handleFireAndForgetResponse(workerName, data);
    }
    
    // Continue processing queue
    this._processQueue(workerName);
  }
  
  /**
   * Schedule queue processing (non-blocking)
   */
  _scheduleQueueProcessing() {
    // Use requestIdleCallback if available, otherwise setTimeout
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        for (const workerName of this.workers.keys()) {
          this._processQueue(workerName);
        }
      }, { timeout: 1 });
    } else {
      // Fallback: use setTimeout with minimal delay
      setTimeout(() => {
        for (const workerName of this.workers.keys()) {
          this._processQueue(workerName);
        }
      }, 0);
    }
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
```

---

## 2. RenderLoop → PreviewComputer Communication

### Communication Pattern: Fire-and-Forget with Callback

```javascript
// src/core/RenderLoop.js (modified)

import { AsyncQueueManager, MessagePriority } from './AsyncQueueManager.js';

export class RenderLoop {
  constructor({ onFrame, ...options } = {}) {
    // ... existing code ...
    
    this.queueManager = null; // Injected
    this.previewComputerWorker = null; // Injected
    this.pendingPreviewResults = new Map();
    this.lastPreviewRequestTime = 0;
    this.previewRequestThrottle = 16; // ~60 FPS max
  }
  
  /**
   * Request preview computation (non-blocking)
   */
  requestPreviewComputation(graph, timeContext, audioContext) {
    // Throttle requests to prevent queue overflow
    const now = performance.now();
    if (now - this.lastPreviewRequestTime < this.previewRequestThrottle) {
      return; // Skip this request
    }
    this.lastPreviewRequestTime = now;
    
    if (!this.queueManager || !this.previewComputerWorker) {
      // Fallback to main thread computation
      return this._computePreviewsMainThread(graph, timeContext, audioContext);
    }
    
    // Create immutable snapshot of graph state
    const graphSnapshot = this._createGraphSnapshot(graph);
    
    // Enqueue preview computation request (CRITICAL priority)
    const message = {
      type: 'computePreviews',
      graph: graphSnapshot,
      timeContext: {
        time: timeContext.time,
        frame: timeContext.frame,
        deltaTime: timeContext.deltaTime
      },
      audioContext: {
        audioEnvelope: audioContext.audioEnvelope || 0,
        audioEnvelopeBass: audioContext.audioEnvelopeBass || 0,
        audioEnvelopeMids: audioContext.audioEnvelopeMids || 0,
        audioEnvelopeHighs: audioContext.audioEnvelopeHighs || 0
      },
      timestamp: performance.now()
    };
    
    // Fire-and-forget with callback registration
    const requestId = this.queueManager.enqueue(
      'previewComputer',
      message,
      MessagePriority.CRITICAL
    );
    
    // Store callback for when result arrives
    if (requestId) {
      this.pendingPreviewResults.set(requestId, {
        timestamp: performance.now(),
        callback: (result) => this._handlePreviewResult(result)
      });
    }
  }
  
  /**
   * Handle preview computation result (called asynchronously)
   */
  _handlePreviewResult(result) {
    // Update preview textures (non-blocking)
    if (result.previews && this.onPreviewUpdate) {
      this.onPreviewUpdate(result.previews);
    }
  }
  
  /**
   * Create immutable graph snapshot
   */
  _createGraphSnapshot(graph) {
    // Deep clone to prevent race conditions
    return JSON.parse(JSON.stringify({
      nodes: graph.nodes.map(node => ({
        id: node.id,
        type: node.type,
        params: { ...node.params },
        position: { ...node.position }
      })),
      connections: graph.connections.map(conn => ({ ...conn }))
    }));
  }
  
  /**
   * Fallback: compute on main thread
   */
  _computePreviewsMainThread(graph, timeContext, audioContext) {
    // Existing synchronous computation
    if (window.editor?.previewComputer) {
      window.editor.previewComputer.computePreviews(graph);
    }
  }
}
```

### PreviewComputer Worker Implementation

```javascript
// workers/preview-computer-worker.js

import { NodeValueComputer } from '../core/preview/NodeValueComputer.js';

let nodeValueComputer = null;

self.onmessage = async (e) => {
  const { type, graph, timeContext, audioContext, id } = e.data;
  
  try {
    switch (type) {
      case 'init':
        // Initialize worker
        nodeValueComputer = new NodeValueComputer();
        self.postMessage({ type: 'ready', id });
        break;
        
      case 'computePreviews':
        // Compute previews (CPU-intensive, runs in worker)
        const results = await computePreviews(graph, timeContext, audioContext);
        
        // Send results back (non-blocking)
        self.postMessage({
          type: 'previewResult',
          id,
          result: {
            previews: results,
            timestamp: performance.now()
          }
        });
        break;
        
      default:
        self.postMessage({
          type: 'error',
          id,
          error: `Unknown message type: ${type}`
        });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      error: error.message,
      stack: error.stack
    });
  }
};

async function computePreviews(graph, timeContext, audioContext) {
  const previews = new Map();
  
  // Compute preview for each node
  for (const node of graph.nodes) {
    try {
      const preview = await nodeValueComputer.computeNodePreview(
        node,
        graph,
        timeContext,
        audioContext
      );
      previews.set(node.id, preview);
    } catch (error) {
      console.error(`Error computing preview for node ${node.id}:`, error);
    }
  }
  
  return Object.fromEntries(previews);
}
```

---

## 3. ExecutionQueue → ParameterExpressionSystem Communication

### Communication Pattern: Request-Response with Batching

```javascript
// src/core/ExecutionQueue.js (modified)

export class ExecutionQueue {
  constructor(options = {}) {
    // ... existing code ...
    
    this.queueManager = null; // Injected
    this.expressionWorker = null; // Injected
    this.expressionCache = new Map(); // Local cache
    this.pendingExpressions = new Map(); // Batch expressions
    this.expressionBatchTimer = null;
    this.expressionBatchDelay = 5; // 5ms batching window
  }
  
  /**
   * Evaluate parameter expression (non-blocking, batched)
   */
  async evaluateParameterExpression(expression, context, node) {
    if (!this.queueManager || !this.expressionWorker) {
      // Fallback to main thread
      return this._evaluateExpressionMainThread(expression, context, node);
    }
    
    // Check local cache first
    const cacheKey = this._getCacheKey(expression, context, node);
    if (this.expressionCache.has(cacheKey)) {
      const cached = this.expressionCache.get(cacheKey);
      if (this._isCacheValid(cached, context)) {
        return cached.result;
      }
    }
    
    // Batch expression evaluations
    return this._batchExpressionEvaluation(expression, context, node);
  }
  
  /**
   * Batch expression evaluations to reduce message overhead
   */
  async _batchExpressionEvaluation(expression, context, node) {
    return new Promise((resolve, reject) => {
      const cacheKey = this._getCacheKey(expression, context, node);
      
      // Add to pending batch
      if (!this.pendingExpressions.has(cacheKey)) {
        this.pendingExpressions.set(cacheKey, {
          expression,
          context,
          node,
          resolvers: []
        });
      }
      
      const pending = this.pendingExpressions.get(cacheKey);
      pending.resolvers.push({ resolve, reject });
      
      // Schedule batch processing
      if (this.expressionBatchTimer) {
        clearTimeout(this.expressionBatchTimer);
      }
      
      this.expressionBatchTimer = setTimeout(() => {
        this._processExpressionBatch();
      }, this.expressionBatchDelay);
    });
  }
  
  /**
   * Process batched expressions
   */
  async _processExpressionBatch() {
    if (this.pendingExpressions.size === 0) return;
    
    const batch = Array.from(this.pendingExpressions.entries()).map(([key, data]) => ({
      key,
      expression: data.expression,
      context: data.context,
      nodeId: data.node?.id
    }));
    
    this.pendingExpressions.clear();
    
    // Send batch request to worker
    try {
      const results = await this.queueManager.request(
        'parameterExpression',
        {
          type: 'evaluateBatch',
          expressions: batch
        },
        MessagePriority.HIGH
      );
      
      // Resolve all promises and update cache
      for (const result of results) {
        const { key, value, error } = result;
        
        if (error) {
          // Reject all resolvers for this expression
          const pending = this.pendingExpressions.get(key);
          if (pending) {
            pending.resolvers.forEach(({ reject }) => reject(new Error(error)));
          }
        } else {
          // Update cache
          this.expressionCache.set(key, {
            result: value,
            timestamp: performance.now()
          });
          
          // Resolve all resolvers
          const pending = this.pendingExpressions.get(key);
          if (pending) {
            pending.resolvers.forEach(({ resolve }) => resolve(value));
          }
        }
      }
    } catch (error) {
      // Reject all pending promises
      for (const pending of this.pendingExpressions.values()) {
        pending.resolvers.forEach(({ reject }) => reject(error));
      }
    }
  }
  
  /**
   * Get cache key for expression
   */
  _getCacheKey(expression, context, node) {
    return `${expression}|${node?.id || 'global'}|${JSON.stringify(context)}`;
  }
  
  /**
   * Check if cache is valid
   */
  _isCacheValid(cached, context) {
    // Cache valid for 16ms (one frame)
    return (performance.now() - cached.timestamp) < 16;
  }
}
```

### ParameterExpressionSystem Worker Implementation

```javascript
// workers/parameter-expression-worker.js

import { UnifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';

let expressionSystem = null;
let expressionCache = new Map();

self.onmessage = async (e) => {
  const { type, expressions, id } = e.data;
  
  try {
    switch (type) {
      case 'init':
        expressionSystem = new UnifiedExpressionSystem();
        self.postMessage({ type: 'ready', id });
        break;
        
      case 'evaluateBatch':
        // Evaluate batch of expressions
        const results = await evaluateExpressionBatch(expressions);
        self.postMessage({
          type: 'result',
          id,
          result: results
        });
        break;
        
      case 'evaluate':
        // Single expression evaluation
        const result = await evaluateExpression(
          e.data.expression,
          e.data.context,
          e.data.nodeId
        );
        self.postMessage({
          type: 'result',
          id,
          result: result
        });
        break;
        
      default:
        self.postMessage({
          type: 'error',
          id,
          error: `Unknown message type: ${type}`
        });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      error: error.message
    });
  }
};

async function evaluateExpressionBatch(expressions) {
  const results = [];
  
  for (const expr of expressions) {
    try {
      const value = await evaluateExpression(
        expr.expression,
        expr.context,
        expr.nodeId
      );
      results.push({
        key: expr.key,
        value,
        error: null
      });
    } catch (error) {
      results.push({
        key: expr.key,
        value: null,
        error: error.message
      });
    }
  }
  
  return results;
}

async function evaluateExpression(expression, context, nodeId) {
  // Check cache
  const cacheKey = `${expression}|${nodeId}|${JSON.stringify(context)}`;
  if (expressionCache.has(cacheKey)) {
    return expressionCache.get(cacheKey);
  }
  
  // Evaluate expression
  const result = expressionSystem.evaluateCPU(expression, context);
  
  // Cache result (only for non-time-dependent expressions)
  if (!expression.includes('time') && !expression.includes('audioEnvelope')) {
    expressionCache.set(cacheKey, result);
  }
  
  return result;
}
```

---

## 4. SystemIntegration → UndoManager Communication

### Communication Pattern: Versioned State Snapshots

```javascript
// src/core/SystemIntegration.js (modified)

export class SystemIntegration {
  constructor() {
    // ... existing code ...
    
    this.queueManager = null; // Injected
    this.undoManagerWorker = null; // Injected
    this.stateVersion = 0;
    this.lastSnapshotTime = 0;
    this.snapshotThrottle = 100; // 100ms between snapshots
  }
  
  /**
   * Record state change for undo/redo (non-blocking)
   */
  recordStateChange(changeType, changeData) {
    if (!this.queueManager || !this.undoManagerWorker) {
      // Fallback to main thread
      return this._recordStateChangeMainThread(changeType, changeData);
    }
    
    // Throttle snapshots to prevent queue overflow
    const now = performance.now();
    if (now - this.lastSnapshotTime < this.snapshotThrottle) {
      return; // Skip this snapshot
    }
    this.lastSnapshotTime = now;
    
    // Create state snapshot
    const snapshot = this._createStateSnapshot();
    this.stateVersion++;
    
    // Send to undo manager worker (LOW priority - background operation)
    this.queueManager.enqueue(
      'undoManager',
      {
        type: 'recordState',
        version: this.stateVersion,
        changeType,
        changeData,
        snapshot,
        timestamp: performance.now()
      },
      MessagePriority.LOW
    );
  }
  
  /**
   * Request undo operation (non-blocking)
   */
  async undo() {
    if (!this.queueManager || !this.undoManagerWorker) {
      return this._undoMainThread();
    }
    
    try {
      const previousState = await this.queueManager.request(
        'undoManager',
        {
          type: 'undo',
          currentVersion: this.stateVersion
        },
        MessagePriority.HIGH
      );
      
      if (previousState) {
        // Apply state snapshot
        this._applyStateSnapshot(previousState.snapshot);
        this.stateVersion = previousState.version;
      }
    } catch (error) {
      console.error('Undo failed:', error);
    }
  }
  
  /**
   * Request redo operation (non-blocking)
   */
  async redo() {
    if (!this.queueManager || !this.undoManagerWorker) {
      return this._redoMainThread();
    }
    
    try {
      const nextState = await this.queueManager.request(
        'undoManager',
        {
          type: 'redo',
          currentVersion: this.stateVersion
        },
        MessagePriority.HIGH
      );
      
      if (nextState) {
        // Apply state snapshot
        this._applyStateSnapshot(nextState.snapshot);
        this.stateVersion = nextState.version;
      }
    } catch (error) {
      console.error('Redo failed:', error);
    }
  }
  
  /**
   * Create immutable state snapshot
   */
  _createStateSnapshot() {
    return {
      graph: this._serializeGraph(this.graph),
      editor: this._serializeEditorState(this.editor),
      timestamp: performance.now()
    };
  }
  
  /**
   * Apply state snapshot
   */
  _applyStateSnapshot(snapshot) {
    // Deserialize and apply state
    this.graph = this._deserializeGraph(snapshot.graph);
    this._deserializeEditorState(snapshot.editor);
    
    // Trigger update events
    this._notifyStateChange();
  }
}
```

---

## 5. ComputeExecutor → ParameterExpressionSystem Communication

### Communication Pattern: Synchronous Cache with Async Fallback

```javascript
// src/gpu/ComputeExecutor.js (modified)

export class ComputeExecutor {
  constructor(device) {
    // ... existing code ...
    
    this.queueManager = null; // Injected
    this.expressionWorker = null; // Injected
    this.expressionCache = new Map(); // Fast local cache
    this.pendingExpressions = new Map(); // Pending async evaluations
  }
  
  /**
   * Evaluate parameter (with fast cache, async fallback)
   */
  async evaluateParam(value, defaultValue, time, audioContext) {
    // Fast path: check local cache first
    const cacheKey = `${value}|${time}|${JSON.stringify(audioContext)}`;
    if (this.expressionCache.has(cacheKey)) {
      const cached = this.expressionCache.get(cacheKey);
      if (this._isCacheValid(cached, time)) {
        return cached.value;
      }
    }
    
    // If not a number, evaluate expression
    if (typeof value === 'string' && (value.startsWith('=') || /time|audioEnvelope/.test(value))) {
      // Try async evaluation (non-blocking)
      return this._evaluateExpressionAsync(value, time, audioContext, cacheKey);
    }
    
    // Fallback to synchronous evaluation
    return this._evaluateExpressionSync(value, defaultValue, time, audioContext);
  }
  
  /**
   * Evaluate expression asynchronously (non-blocking)
   */
  async _evaluateExpressionAsync(expression, time, audioContext, cacheKey) {
    // Check if already pending
    if (this.pendingExpressions.has(cacheKey)) {
      return this.pendingExpressions.get(cacheKey);
    }
    
    // Create promise for async evaluation
    const promise = this.queueManager.request(
      'parameterExpression',
      {
        type: 'evaluate',
        expression,
        context: {
          time,
          ...audioContext
        }
      },
      MessagePriority.HIGH
    ).then(result => {
      // Update cache
      this.expressionCache.set(cacheKey, {
        value: result,
        timestamp: performance.now()
      });
      
      // Remove from pending
      this.pendingExpressions.delete(cacheKey);
      
      return result;
    }).catch(error => {
      // Remove from pending on error
      this.pendingExpressions.delete(cacheKey);
      
      // Fallback to sync evaluation
      return this._evaluateExpressionSync(expression, 0, time, audioContext);
    });
    
    // Store pending promise
    this.pendingExpressions.set(cacheKey, promise);
    
    return promise;
  }
  
  /**
   * Fallback: synchronous evaluation
   */
  _evaluateExpressionSync(expression, defaultValue, time, audioContext) {
    // Use main thread expression system as fallback
    if (window.expressionSystem) {
      try {
        const context = {
          time,
          ...audioContext
        };
        return window.expressionSystem.evaluateExpression(expression, context);
      } catch (error) {
        return defaultValue;
      }
    }
    return defaultValue;
  }
  
  /**
   * Check if cache is valid
   */
  _isCacheValid(cached, currentTime) {
    // Cache valid for 16ms (one frame)
    return (performance.now() - cached.timestamp) < 16;
  }
}
```

---

## 6. Shader Build Pipeline → ParameterExpressionSystem Communication

### Communication Pattern: Pre-compilation Expression Evaluation

```javascript
// src/codegen/glslBuilder.js (modified)

export class GLSLBuilder {
  constructor() {
    // ... existing code ...
    
    this.queueManager = null; // Injected
    this.expressionWorker = null; // Injected
    this.compilationCache = new Map();
  }
  
  /**
   * Build shader from graph (with async expression evaluation)
   */
  async buildShader(graph, options = {}) {
    // Pre-evaluate all expressions in graph (async, non-blocking)
    const evaluatedGraph = await this._evaluateGraphExpressions(graph);
    
    // Build shader with evaluated values
    return this._buildShaderFromEvaluatedGraph(evaluatedGraph, options);
  }
  
  /**
   * Evaluate all expressions in graph (batched, async)
   */
  async _evaluateGraphExpressions(graph) {
    // Collect all expressions
    const expressions = [];
    const expressionMap = new Map();
    
    for (const node of graph.nodes) {
      for (const [paramName, paramValue] of Object.entries(node.params || {})) {
        if (typeof paramValue === 'string' && paramValue.startsWith('=')) {
          const key = `${node.id}.${paramName}`;
          expressions.push({
            key,
            expression: paramValue,
            nodeId: node.id,
            paramName
          });
          expressionMap.set(key, { node, paramName });
        }
      }
    }
    
    if (expressions.length === 0) {
      return graph; // No expressions to evaluate
    }
    
    // Batch evaluate all expressions
    try {
      const results = await this.queueManager.request(
        'parameterExpression',
        {
          type: 'evaluateBatch',
          expressions: expressions.map(e => ({
            key: e.key,
            expression: e.expression,
            context: {},
            nodeId: e.nodeId
          }))
        },
        MessagePriority.HIGH
      );
      
      // Apply evaluated values to graph
      const evaluatedGraph = JSON.parse(JSON.stringify(graph)); // Clone
      
      for (const result of results) {
        if (result.error) continue;
        
        const { node, paramName } = expressionMap.get(result.key);
        const nodeInGraph = evaluatedGraph.nodes.find(n => n.id === node.id);
        if (nodeInGraph) {
          nodeInGraph.params[paramName] = result.value;
        }
      }
      
      return evaluatedGraph;
    } catch (error) {
      console.warn('Expression evaluation failed, using original graph:', error);
      return graph; // Fallback to original graph
    }
  }
}
```

---

## 7. Shared State Synchronization

### Versioned State Manager

```javascript
// src/core/VersionedStateManager.js

/**
 * Versioned State Manager - Ensures state consistency across threads
 */
export class VersionedStateManager {
  constructor() {
    this.stateVersion = 0;
    this.stateSnapshots = new Map(); // version -> snapshot
    this.maxSnapshots = 100; // Limit memory usage
    this.subscribers = new Set();
  }
  
  /**
   * Create state snapshot with version
   */
  createSnapshot(state) {
    this.stateVersion++;
    const snapshot = {
      version: this.stateVersion,
      state: JSON.parse(JSON.stringify(state)), // Deep clone
      timestamp: performance.now()
    };
    
    // Store snapshot
    this.stateSnapshots.set(this.stateVersion, snapshot);
    
    // Limit snapshot history
    if (this.stateSnapshots.size > this.maxSnapshots) {
      const oldestVersion = Math.min(...this.stateSnapshots.keys());
      this.stateSnapshots.delete(oldestVersion);
    }
    
    // Notify subscribers
    this._notifySubscribers(snapshot);
    
    return snapshot;
  }
  
  /**
   * Get state snapshot by version
   */
  getSnapshot(version) {
    return this.stateSnapshots.get(version);
  }
  
  /**
   * Get latest state snapshot
   */
  getLatestSnapshot() {
    return this.stateSnapshots.get(this.stateVersion);
  }
  
  /**
   * Check if version is current
   */
  isVersionCurrent(version) {
    return version === this.stateVersion;
  }
  
  /**
   * Subscribe to state changes
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }
  
  /**
   * Notify subscribers
   */
  _notifySubscribers(snapshot) {
    for (const callback of this.subscribers) {
      try {
        callback(snapshot);
      } catch (error) {
        console.error('Error in state subscriber:', error);
      }
    }
  }
}
```

---

## 8. Lock-Free Data Structures

### Atomic Counter (for SharedArrayBuffer)

```javascript
// src/core/AtomicCounter.js

/**
 * Atomic Counter - Lock-free counter using SharedArrayBuffer
 */
export class AtomicCounter {
  constructor(sharedBuffer, offset = 0) {
    if (!(sharedBuffer instanceof SharedArrayBuffer)) {
      throw new Error('AtomicCounter requires SharedArrayBuffer');
    }
    
    this.view = new Int32Array(sharedBuffer, offset, 1);
    this.offset = offset;
  }
  
  /**
   * Increment counter atomically
   */
  increment() {
    return Atomics.add(this.view, 0, 1);
  }
  
  /**
   * Decrement counter atomically
   */
  decrement() {
    return Atomics.sub(this.view, 0, 1);
  }
  
  /**
   * Get current value
   */
  get() {
    return Atomics.load(this.view, 0);
  }
  
  /**
   * Set value atomically
   */
  set(value) {
    Atomics.store(this.view, 0, value);
  }
  
  /**
   * Compare and swap
   */
  compareAndSwap(expected, newValue) {
    return Atomics.compareExchange(this.view, 0, expected, newValue);
  }
}
```

---

## 9. Performance Monitoring

### Communication Metrics Collector

```javascript
// src/core/CommunicationMetrics.js

/**
 * Communication Metrics - Track performance of thread communication
 */
export class CommunicationMetrics {
  constructor() {
    this.metrics = {
      messages: {
        sent: 0,
        received: 0,
        failed: 0
      },
      latency: {
        min: Infinity,
        max: 0,
        sum: 0,
        count: 0,
        average: 0
      },
      queue: {
        maxSize: 0,
        currentSize: 0,
        overflows: 0
      },
      workers: new Map()
    };
  }
  
  /**
   * Record message sent
   */
  recordMessageSent(workerName, priority) {
    this.metrics.messages.sent++;
    this._updateWorkerMetrics(workerName, 'sent', 1);
  }
  
  /**
   * Record message received
   */
  recordMessageReceived(workerName, latency) {
    this.metrics.messages.received++;
    this._updateLatency(latency);
    this._updateWorkerMetrics(workerName, 'received', 1);
    this._updateWorkerMetrics(workerName, 'latency', latency);
  }
  
  /**
   * Record message failed
   */
  recordMessageFailed(workerName, error) {
    this.metrics.messages.failed++;
    this._updateWorkerMetrics(workerName, 'failed', 1);
  }
  
  /**
   * Record queue size
   */
  recordQueueSize(workerName, size) {
    if (size > this.metrics.queue.maxSize) {
      this.metrics.queue.maxSize = size;
    }
    this.metrics.queue.currentSize = size;
    
    if (size > 100) {
      this.metrics.queue.overflows++;
    }
  }
  
  /**
   * Update latency metrics
   */
  _updateLatency(latency) {
    const { latency: lat } = this.metrics;
    lat.min = Math.min(lat.min, latency);
    lat.max = Math.max(lat.max, latency);
    lat.sum += latency;
    lat.count++;
    lat.average = lat.sum / lat.count;
  }
  
  /**
   * Update worker-specific metrics
   */
  _updateWorkerMetrics(workerName, metric, value) {
    if (!this.metrics.workers.has(workerName)) {
      this.metrics.workers.set(workerName, {
        sent: 0,
        received: 0,
        failed: 0,
        latency: { sum: 0, count: 0, average: 0 }
      });
    }
    
    const worker = this.metrics.workers.get(workerName);
    
    if (metric === 'latency') {
      worker.latency.sum += value;
      worker.latency.count++;
      worker.latency.average = worker.latency.sum / worker.latency.count;
    } else {
      worker[metric] += value;
    }
  }
  
  /**
   * Get metrics report
   */
  getReport() {
    return {
      ...this.metrics,
      workers: Object.fromEntries(this.metrics.workers)
    };
  }
  
  /**
   * Reset metrics
   */
  reset() {
    this.metrics = {
      messages: { sent: 0, received: 0, failed: 0 },
      latency: { min: Infinity, max: 0, sum: 0, count: 0, average: 0 },
      queue: { maxSize: 0, currentSize: 0, overflows: 0 },
      workers: new Map()
    };
  }
}
```

---

## 10. Error Handling and Recovery

### Worker Error Recovery

```javascript
// src/core/WorkerErrorRecovery.js

/**
 * Worker Error Recovery - Handle worker failures gracefully
 */
export class WorkerErrorRecovery {
  constructor(queueManager) {
    this.queueManager = queueManager;
    this.workerHealth = new Map();
    this.fallbackHandlers = new Map();
    this.maxFailures = 5;
    this.recoveryDelay = 1000;
  }
  
  /**
   * Register fallback handler for worker
   */
  registerFallback(workerName, fallbackHandler) {
    this.fallbackHandlers.set(workerName, fallbackHandler);
  }
  
  /**
   * Handle worker error
   */
  handleWorkerError(workerName, error) {
    // Track worker health
    if (!this.workerHealth.has(workerName)) {
      this.workerHealth.set(workerName, {
        failures: 0,
        lastFailure: null,
        isHealthy: true
      });
    }
    
    const health = this.workerHealth.get(workerName);
    health.failures++;
    health.lastFailure = performance.now();
    
    // Check if worker should be marked unhealthy
    if (health.failures >= this.maxFailures) {
      health.isHealthy = false;
      console.warn(`Worker ${workerName} marked as unhealthy after ${health.failures} failures`);
      
      // Attempt recovery
      this._attemptRecovery(workerName);
    }
    
    // Use fallback handler if available
    if (this.fallbackHandlers.has(workerName)) {
      const fallback = this.fallbackHandlers.get(workerName);
      return fallback(error);
    }
  }
  
  /**
   * Attempt worker recovery
   */
  async _attemptRecovery(workerName) {
    // Wait before attempting recovery
    await new Promise(resolve => setTimeout(resolve, this.recoveryDelay));
    
    // Reset worker (implementation depends on queue manager)
    if (this.queueManager.resetWorker) {
      try {
        await this.queueManager.resetWorker(workerName);
        
        // Reset health
        const health = this.workerHealth.get(workerName);
        health.failures = 0;
        health.isHealthy = true;
        
        console.log(`Worker ${workerName} recovered successfully`);
      } catch (error) {
        console.error(`Failed to recover worker ${workerName}:`, error);
      }
    }
  }
  
  /**
   * Check if worker is healthy
   */
  isWorkerHealthy(workerName) {
    const health = this.workerHealth.get(workerName);
    return health ? health.isHealthy : true;
  }
}
```

---

## Summary

This communication protocol ensures:

1. **Non-Blocking Operations**: All Primary → Secondary communication is asynchronous
2. **Priority-Based Processing**: Critical operations (rendering) processed first
3. **Thread Safety**: Immutable snapshots and versioned state prevent race conditions
4. **Performance Optimization**: Batching, caching, and Transferable Objects minimize overhead
5. **Error Recovery**: Graceful fallback to main thread when workers fail
6. **Performance Monitoring**: Comprehensive metrics for optimization

**Key Benefits**:
- ✅ Main thread never blocks waiting for worker responses
- ✅ Priority queues ensure rendering operations are processed first
- ✅ Batching reduces message overhead
- ✅ Caching minimizes redundant computations
- ✅ Fallback mechanisms ensure reliability

