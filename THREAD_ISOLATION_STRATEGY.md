# Rhizomium Thread Isolation Strategy

This document outlines a comprehensive strategy to isolate Secondary threads from Primary threads in Rhizomium, improving performance, reducing main thread blocking, and enabling better parallelization.

**Last Updated**: Generated from architecture analysis  
**Status**: Design Phase

---

## Executive Summary

### Goals
1. **Isolate CPU-intensive secondary tasks** from the main rendering thread
2. **Prevent race conditions** through proper synchronization mechanisms
3. **Maintain low-latency communication** between isolated threads and primary threads
4. **Preserve existing functionality** while improving performance

### Isolation Targets
- **Web Workers**: 4 secondary threads (PreviewComputer, ParameterExpressionSystem, SaveLoadManager, UndoManager)
- **Python Threads**: 3 secondary threads (already isolated: AudioEngine, FrameStreamServer, RhizomiumViewer)
- **Main Thread**: 9 secondary threads (must remain due to DOM/GPU/API dependencies)

---

## Thread Isolation Classification

### ✅ CAN BE ISOLATED (Web Workers)

#### 1. PreviewComputer Worker
- **Current Location**: `src/core/PreviewComputer.js`, `src/core/preview/NodeValueComputer.js`
- **Isolation Method**: Web Worker
- **Rationale**: 
  - Pure computation (no DOM/GPU access needed for computation)
  - CPU-intensive (48x48 thumbnail generation)
  - Can receive graph data via message passing
  - Results can be transferred back via Transferable Objects
- **Dependencies to Handle**:
  - Graph structure (serializable)
  - Parameter values (serializable)
  - Time context (can be passed as message)
  - Audio envelope values (can be passed as message)
- **Communication**: MessagePort with Transferable Objects for image data

#### 2. ParameterExpressionSystem Worker
- **Current Location**: `src/utils/ParameterExpressionSystem.js`
- **Isolation Method**: Web Worker
- **Rationale**:
  - Pure expression evaluation (no side effects)
  - Can be CPU-intensive for complex expressions
  - No DOM/GPU dependencies
  - Expression parsing and evaluation is thread-safe
- **Dependencies to Handle**:
  - Expression strings (serializable)
  - Evaluation context (time, audio, node values - all serializable)
  - Expression cache (can be maintained in worker)
- **Communication**: MessagePort with request/response pattern

#### 3. SaveLoadManager Worker
- **Current Location**: `src/core/SaveLoadManager.js`
- **Isolation Method**: Web Worker
- **Rationale**:
  - File I/O operations can block
  - Graph serialization/deserialization is CPU-intensive
  - No DOM dependencies (uses File API which is available in workers)
  - Backup creation can run in background
- **Dependencies to Handle**:
  - Graph data (serializable)
  - File operations (File API available in workers)
  - LocalStorage/IndexedDB (available in workers)
- **Communication**: MessagePort with progress callbacks

#### 4. UndoManager Worker
- **Current Location**: `src/core/UndoManager.js`
- **Isolation Method**: Web Worker
- **Rationale**:
  - History management is pure state manipulation
  - Serialization of undo/redo stacks is CPU-intensive
  - No DOM dependencies
  - Can maintain history state independently
- **Dependencies to Handle**:
  - Graph state snapshots (serializable)
  - Editor state snapshots (serializable)
  - Parameter change history (serializable)
- **Communication**: MessagePort with state synchronization

### ✅ ALREADY ISOLATED (Python Threads)

#### 5. AudioEngine (Python)
- **Current Location**: `audio/audio_engine.py`
- **Isolation Method**: Python Thread (already isolated)
- **Communication**: WebSocket/HTTP API
- **Status**: ✅ Already properly isolated

#### 6. FrameStreamServer (Python)
- **Current Location**: `frame_stream_server.py`, `rhizo_server.py`
- **Isolation Method**: Python Thread (already isolated)
- **Communication**: WebSocket
- **Status**: ✅ Already properly isolated

#### 7. RhizomiumViewer (Python)
- **Current Location**: `rhizo_viewer.py`
- **Isolation Method**: Python Thread (already isolated)
- **Communication**: WebSocket + SharedMemory (via `ipc_shared.py`)
- **Status**: ✅ Already properly isolated

### ❌ CANNOT BE ISOLATED (Main Thread Required)

#### 8. UI Update Thread
- **Reason**: Requires direct DOM/Canvas 2D API access
- **Mitigation**: Use dirty tracking and requestAnimationFrame batching

#### 9. PreviewIntegration
- **Reason**: Needs to coordinate with UI and trigger canvas updates
- **Mitigation**: Keep coordination logic on main thread, delegate computation to PreviewComputer Worker

#### 10. PreviewThrottler
- **Reason**: Needs to observe Editor interaction state (DOM events)
- **Mitigation**: Keep throttling logic on main thread, coordinate with PreviewComputer Worker

#### 11. TimelineManager
- **Reason**: Needs tight integration with RenderLoop timing
- **Mitigation**: Keep on main thread, use efficient data structures

#### 12. EventHandler
- **Reason**: Requires DOM event access (mouse, keyboard)
- **Mitigation**: Keep on main thread, batch event processing

#### 13. MIDIManager
- **Reason**: Requires Web MIDI API access (main thread only)
- **Mitigation**: Keep on main thread, batch MIDI updates

#### 14. GPUPerformanceMonitor
- **Reason**: Requires WebGPU Device access (main thread only)
- **Mitigation**: Keep on main thread, use async GPU queries

#### 15. ComputeProfiler
- **Reason**: Requires WebGPU Device access (main thread only)
- **Mitigation**: Keep on main thread, use async GPU queries

---

## Communication Architecture

### 1. Web Worker Communication Channels

#### MessagePort Pattern (Primary)
```javascript
// Main Thread
const worker = new Worker('workers/preview-computer-worker.js', { type: 'module' });
const channel = new MessageChannel();
worker.postMessage({ type: 'init', port: channel.port1 }, [channel.port1]);

// Worker Thread
self.onmessage = (e) => {
  if (e.data.type === 'init') {
    const port = e.data.port;
    port.onmessage = (event) => {
      // Handle messages from main thread
    };
  }
};
```

**Use Cases**:
- PreviewComputer Worker
- ParameterExpressionSystem Worker
- SaveLoadManager Worker
- UndoManager Worker

#### Transferable Objects Pattern
```javascript
// Main Thread → Worker (for large data)
const imageData = canvas.getImageData(0, 0, width, height);
worker.postMessage({
  type: 'compute',
  imageData: imageData.data.buffer
}, [imageData.data.buffer]); // Transfer ownership

// Worker → Main Thread (for results)
const resultBuffer = new ArrayBuffer(size);
self.postMessage({
  type: 'result',
  data: resultBuffer
}, [resultBuffer]); // Transfer ownership
```

**Use Cases**:
- PreviewComputer Worker (image data transfer)
- SaveLoadManager Worker (large graph serialization)

#### SharedArrayBuffer Pattern (Advanced)
```javascript
// Main Thread
const sharedBuffer = new SharedArrayBuffer(1024 * 1024); // 1MB
const view = new Int32Array(sharedBuffer);
worker.postMessage({ type: 'init', buffer: sharedBuffer });

// Worker Thread
let sharedView;
self.onmessage = (e) => {
  if (e.data.type === 'init') {
    sharedView = new Int32Array(e.data.buffer);
  }
};

// Synchronized access using Atomics
Atomics.store(sharedView, 0, value);
const value = Atomics.load(sharedView, 0);
```

**Use Cases**:
- High-frequency data sharing (time, audio envelope values)
- Real-time parameter updates
- Performance metrics

**Security Note**: SharedArrayBuffer requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers.

### 2. Python Thread Communication Channels

#### WebSocket (Already Implemented)
```python
# Python → JavaScript
websocket.send(json.dumps({
    'type': 'audio_envelope',
    'value': audio_value,
    'timestamp': time.time()
}))
```

**Use Cases**:
- AudioEngine → JavaScript (audio envelope values)
- FrameStreamServer → JavaScript (frame streaming)

#### SharedMemory (Already Implemented)
```python
# Python (via ipc_shared.py)
channel = SharedFrameChannel(create=True, size=frame_size)
channel.send_frame(frame_bytes)

# JavaScript (via WebAssembly or native module)
# Note: SharedMemory from Python requires native bridge
```

**Use Cases**:
- RhizomiumViewer frame streaming (high-performance path)

#### HTTP REST API
```javascript
// JavaScript → Python
fetch('http://localhost:8080/api/audio/envelope')
  .then(r => r.json())
  .then(data => {
    // Use audio envelope value
  });
```

**Use Cases**:
- AudioEngine status queries
- FrameStreamServer configuration

### 3. BroadcastChannel (Cross-Tab Communication)

Already implemented in `src/framestream/LiveShaderStream.js` and `src/framestream/BroadcastFrameStream.js`.

**Use Cases**:
- Multi-tab shader streaming
- Cross-tab state synchronization (optional)

---

## Shared State Management

### 1. State Synchronization Patterns

#### Immutable State Pattern
```javascript
// Main Thread
let graphState = { nodes: [...], connections: [...] };

// Send immutable snapshot to worker
worker.postMessage({
  type: 'update',
  state: JSON.parse(JSON.stringify(graphState)) // Deep clone
});
```

**Benefits**:
- No race conditions (workers receive snapshots)
- Simple to reason about
- Easy to debug

**Trade-offs**:
- Memory overhead (multiple copies)
- Serialization cost

#### Versioned State Pattern
```javascript
// Main Thread
let stateVersion = 0;
let graphState = { nodes: [...], connections: [...] };

// Send versioned update
worker.postMessage({
  type: 'update',
  version: ++stateVersion,
  state: graphState
});

// Worker tracks last processed version
let lastProcessedVersion = 0;
self.onmessage = (e) => {
  if (e.data.version > lastProcessedVersion) {
    processState(e.data.state);
    lastProcessedVersion = e.data.version;
  }
};
```

**Benefits**:
- Can skip stale updates
- Version tracking for debugging
- Handles out-of-order messages

#### Shared State with Locks (SharedArrayBuffer)
```javascript
// Main Thread
const LOCK_INDEX = 0;
const DATA_START = 1;

// Acquire lock
while (Atomics.compareExchange(sharedView, LOCK_INDEX, 0, 1) !== 0) {
  Atomics.wait(sharedView, LOCK_INDEX, 1);
}

// Write data
sharedView[DATA_START] = value;

// Release lock
Atomics.store(sharedView, LOCK_INDEX, 0);
Atomics.notify(sharedView, LOCK_INDEX);
```

**Benefits**:
- Zero-copy data sharing
- Real-time updates
- Low latency

**Trade-offs**:
- Complex synchronization
- Requires SharedArrayBuffer support
- Potential for deadlocks

### 2. Race Condition Prevention

#### Request-Response Pattern
```javascript
// Main Thread
let requestId = 0;
const pendingRequests = new Map();

function evaluateExpression(expression, context) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pendingRequests.set(id, { resolve, reject });
    
    worker.postMessage({
      type: 'evaluate',
      id: id,
      expression: expression,
      context: context
    });
  });
}

// Worker
self.onmessage = async (e) => {
  if (e.data.type === 'evaluate') {
    try {
      const result = evaluate(e.data.expression, e.data.context);
      self.postMessage({
        type: 'result',
        id: e.data.id,
        result: result
      });
    } catch (error) {
      self.postMessage({
        type: 'error',
        id: e.data.id,
        error: error.message
      });
    }
  }
};

// Main Thread (response handler)
worker.onmessage = (e) => {
  if (e.data.type === 'result') {
    const request = pendingRequests.get(e.data.id);
    if (request) {
      request.resolve(e.data.result);
      pendingRequests.delete(e.data.id);
    }
  }
};
```

**Benefits**:
- Guarantees response ordering
- Error handling
- Timeout support possible

#### Event Sourcing Pattern
```javascript
// Main Thread
const eventLog = [];

function recordEvent(event) {
  eventLog.push({
    ...event,
    timestamp: Date.now(),
    sequence: eventLog.length
  });
  
  // Broadcast to all workers
  workers.forEach(worker => {
    worker.postMessage({
      type: 'event',
      event: event
    });
  });
}

// Workers maintain their own state by replaying events
let workerState = initialState;
self.onmessage = (e) => {
  if (e.data.type === 'event') {
    workerState = applyEvent(workerState, e.data.event);
  }
};
```

**Benefits**:
- Deterministic state updates
- Can replay events for debugging
- Handles out-of-order events

#### Atomic Operations (SharedArrayBuffer)
```javascript
// Atomic compare-and-swap for safe updates
function atomicUpdate(sharedView, index, updateFn) {
  let oldValue, newValue;
  do {
    oldValue = Atomics.load(sharedView, index);
    newValue = updateFn(oldValue);
  } while (Atomics.compareExchange(sharedView, index, oldValue, newValue) !== oldValue);
  return newValue;
}
```

**Benefits**:
- Lock-free updates
- High performance
- No deadlocks

**Trade-offs**:
- Complex to implement correctly
- Limited to numeric operations

### 3. Data Consistency Strategies

#### Snapshot Isolation
- Workers receive complete state snapshots
- No partial updates
- Consistent view at point in time

#### Optimistic Locking
- Workers track state version
- Reject updates if version mismatch
- Request fresh state on conflict

#### Conflict Resolution
```javascript
// Main Thread
function mergeWorkerResult(workerResult, currentState) {
  // Check if state changed while worker was computing
  if (workerResult.baseVersion !== currentState.version) {
    // State changed, need to recompute or merge
    return handleConflict(workerResult, currentState);
  }
  return applyResult(workerResult);
}
```

---

## Implementation Roadmap

### Phase 1: PreviewComputer Worker (High Impact)
**Priority**: HIGH  
**Estimated Effort**: 2-3 days

**Tasks**:
1. Create `workers/preview-computer-worker.js`
2. Extract computation logic from `PreviewComputer.js`
3. Implement MessagePort communication
4. Add Transferable Objects for image data
5. Update `PreviewComputer.js` to delegate to worker
6. Add fallback for browsers without Web Worker support

**Expected Benefits**:
- Reduce main thread CPU usage by 20-30%
- Smoother UI during preview computation
- Better frame rate stability

### Phase 2: ParameterExpressionSystem Worker
**Priority**: MEDIUM  
**Estimated Effort**: 1-2 days

**Tasks**:
1. Create `workers/parameter-expression-worker.js`
2. Extract expression evaluation logic
3. Implement request-response pattern
4. Add expression caching in worker
5. Update `ParameterExpressionSystem.js` to use worker

**Expected Benefits**:
- Offload expression parsing/evaluation
- Reduce main thread blocking during parameter updates
- Better responsiveness during parameter dragging

### Phase 3: SaveLoadManager Worker
**Priority**: MEDIUM  
**Estimated Effort**: 1-2 days

**Tasks**:
1. Create `workers/save-load-worker.js`
2. Move serialization/deserialization to worker
3. Implement progress callbacks
4. Handle File API in worker
5. Update `SaveLoadManager.js` to use worker

**Expected Benefits**:
- Non-blocking save/load operations
- Better UI responsiveness during file operations
- Background backup creation

### Phase 4: UndoManager Worker
**Priority**: LOW  
**Estimated Effort**: 1 day

**Tasks**:
1. Create `workers/undo-manager-worker.js`
2. Move history management to worker
3. Implement state snapshot serialization
4. Add state synchronization
5. Update `UndoManager.js` to use worker

**Expected Benefits**:
- Reduce memory pressure on main thread
- Faster undo/redo operations
- Better performance with large history

### Phase 5: SharedArrayBuffer Optimization (Optional)
**Priority**: LOW  
**Estimated Effort**: 3-4 days

**Tasks**:
1. Add COOP/COEP headers to server
2. Implement SharedArrayBuffer for time/audio data
3. Add atomic operations for synchronization
4. Update workers to use shared memory
5. Add fallback for browsers without SharedArrayBuffer

**Expected Benefits**:
- Zero-copy data sharing
- Lower latency for high-frequency updates
- Better real-time performance

---

## Migration Strategy

### Step 1: Feature Flag
```javascript
// config.js
export const ENABLE_WORKERS = true; // Feature flag

// PreviewComputer.js
if (ENABLE_WORKERS && typeof Worker !== 'undefined') {
  this.worker = new PreviewComputerWorker();
} else {
  // Fallback to main thread
  this.computePreviews = this._computePreviewsMainThread;
}
```

### Step 2: Gradual Migration
1. Start with PreviewComputer (highest impact)
2. Test thoroughly with feature flag
3. Migrate other workers one at a time
4. Monitor performance metrics

### Step 3: Fallback Support
```javascript
// Always provide main thread fallback
class PreviewComputer {
  constructor() {
    if (this._supportsWorkers()) {
      this._initWorker();
    } else {
      this._initMainThread();
    }
  }
  
  _supportsWorkers() {
    return typeof Worker !== 'undefined' && 
           typeof MessageChannel !== 'undefined';
  }
}
```

### Step 4: Performance Monitoring
```javascript
// Add metrics collection
class WorkerMetrics {
  constructor() {
    this.messageLatency = [];
    this.computationTime = [];
    this.transferSize = [];
  }
  
  recordMessageLatency(startTime) {
    const latency = performance.now() - startTime;
    this.messageLatency.push(latency);
  }
}
```

---

## Testing Strategy

### Unit Tests
- Test worker message handling
- Test state serialization/deserialization
- Test error handling and recovery

### Integration Tests
- Test worker-main thread communication
- Test concurrent worker operations
- Test fallback behavior

### Performance Tests
- Measure main thread CPU usage reduction
- Measure frame rate improvement
- Measure memory usage
- Compare worker vs main thread performance

### Browser Compatibility Tests
- Test in Chrome, Firefox, Safari, Edge
- Test with/without SharedArrayBuffer support
- Test with Web Worker disabled

---

## Security Considerations

### 1. Content Security Policy (CSP)
```html
<!-- Allow Web Workers -->
<meta http-equiv="Content-Security-Policy" 
      content="worker-src 'self' blob:;">
```

### 2. SharedArrayBuffer Requirements
```javascript
// Check for SharedArrayBuffer support
if (typeof SharedArrayBuffer === 'undefined') {
  console.warn('SharedArrayBuffer not supported, using fallback');
  // Use MessagePort instead
}
```

### 3. Worker Script Validation
```javascript
// Validate worker messages
function validateWorkerMessage(message) {
  if (!message || typeof message !== 'object') {
    throw new Error('Invalid message format');
  }
  if (!message.type || typeof message.type !== 'string') {
    throw new Error('Message must have type field');
  }
  // Additional validation...
}
```

### 4. Data Sanitization
```javascript
// Sanitize data before sending to worker
function sanitizeForWorker(data) {
  // Remove functions, DOM nodes, etc.
  return JSON.parse(JSON.stringify(data, (key, value) => {
    if (typeof value === 'function') {
      return undefined; // Remove functions
    }
    if (value instanceof Node) {
      return undefined; // Remove DOM nodes
    }
    return value;
  }));
}
```

---

## Performance Monitoring

### Metrics to Track

#### Main Thread Metrics
- CPU usage percentage
- Frame rate (FPS)
- Frame time (ms)
- Long tasks (>50ms)

#### Worker Metrics
- Message latency (ms)
- Computation time (ms)
- Message queue size
- Memory usage (MB)

#### Communication Metrics
- Messages per second
- Data transfer size (KB/s)
- Transferable object usage

### Monitoring Implementation
```javascript
// Performance monitor
class ThreadIsolationMonitor {
  constructor() {
    this.metrics = {
      mainThread: {
        cpuUsage: [],
        frameRate: [],
        frameTime: []
      },
      workers: new Map()
    };
  }
  
  recordMainThreadFrame(frameTime) {
    this.metrics.mainThread.frameTime.push(frameTime);
    this.metrics.mainThread.frameRate.push(1000 / frameTime);
  }
  
  recordWorkerMessage(workerName, latency) {
    if (!this.metrics.workers.has(workerName)) {
      this.metrics.workers.set(workerName, { latency: [] });
    }
    this.metrics.workers.get(workerName).latency.push(latency);
  }
  
  getReport() {
    return {
      mainThread: {
        avgFrameRate: this._average(this.metrics.mainThread.frameRate),
        avgFrameTime: this._average(this.metrics.mainThread.frameTime)
      },
      workers: Object.fromEntries(
        Array.from(this.metrics.workers.entries()).map(([name, data]) => [
          name,
          { avgLatency: this._average(data.latency) }
        ])
      )
    };
  }
}
```

---

## Risk Assessment

### High Risk
- **State synchronization bugs**: Could cause incorrect previews or parameter values
  - **Mitigation**: Comprehensive testing, versioned state, request-response pattern

- **Performance regression**: Worker overhead might outweigh benefits
  - **Mitigation**: Performance benchmarks, feature flags, fallback support

### Medium Risk
- **Browser compatibility**: Web Workers not supported in all environments
  - **Mitigation**: Feature detection, fallback to main thread

- **Memory overhead**: Multiple state copies in workers
  - **Mitigation**: Use Transferable Objects, implement memory limits

### Low Risk
- **Development complexity**: More complex debugging
  - **Mitigation**: Comprehensive logging, dev tools support

---

## Conclusion

This isolation strategy provides a clear path to improve Rhizomium's performance by offloading CPU-intensive secondary tasks to Web Workers while maintaining thread safety and data consistency. The phased approach allows for gradual migration with minimal risk, and comprehensive fallback support ensures compatibility across all browsers.

**Key Benefits**:
- ✅ Reduced main thread blocking
- ✅ Better frame rate stability
- ✅ Improved UI responsiveness
- ✅ Scalable architecture for future enhancements

**Next Steps**:
1. Review and approve strategy
2. Implement Phase 1 (PreviewComputer Worker)
3. Measure performance improvements
4. Continue with remaining phases

