# Secondary Thread Task Decomposition & Concurrency Analysis

This document breaks down each Secondary thread's tasks into atomic units, identifies concurrency opportunities, sequential dependencies, critical sections, and thread-safe execution methods to maintain real-time performance.

**Last Updated**: Generated from architecture analysis  
**Status**: Design Specification

---

## Overview

### Concurrency Principles

1. **Atomic Units**: Smallest indivisible operations that must complete without interruption
2. **Concurrent Execution**: Operations that can run in parallel without dependencies
3. **Sequential Execution**: Operations that must run in order due to data dependencies
4. **Critical Sections**: Code regions requiring exclusive access to shared resources
5. **Thread Safety**: Mechanisms to prevent race conditions and ensure data consistency

---

## 1. PreviewComputer Worker

### Task Overview
Computes preview values (48x48 thumbnails) for all nodes in the graph. Processes nodes in topological order to respect dependencies.

### Atomic Unit Breakdown

#### A. Graph Analysis Phase (Sequential)
```
A1. Parse graph structure
A2. Build node ID map (byId)
A3. Topological sort (dependency resolution)
A4. Create values map (output storage)
```

**Concurrency**: ❌ Sequential (each step depends on previous)  
**Critical Section**: Graph structure access  
**Thread Safety**: Immutable snapshot (no locking needed)

#### B. Node Processing Phase (Hybrid: Sequential + Concurrent)
```
B1. Iterate nodes in topological order (SEQUENTIAL)
  └─ For each node:
     B1.1. Check time budget (every 10 nodes)
     B1.2. Evaluate input parameters (CONCURRENT per node)
     B1.3. Compute node output (CONCURRENT per node)
     B1.4. Store result in values map (CRITICAL SECTION)
```

**Concurrency**: ✅ Nodes at same dependency level can be processed concurrently  
**Critical Section**: Values map write access  
**Thread Safety**: Per-node locking or lock-free map with atomic operations

#### C. Parameter Evaluation Sub-Phase (Concurrent)
```
C1. Extract parameter value
C2. Check if expression (string check)
C3. Build evaluation context
C4. Evaluate expression (if needed)
C5. Parse numeric value
```

**Concurrency**: ✅ Can run concurrently for different parameters  
**Critical Section**: None (pure computation)  
**Thread Safety**: Immutable context, no shared state

#### D. Node Type Computation (Concurrent)
```
D1. Switch on node.kind
D2. Execute node-specific computation
D3. Return computed value
```

**Concurrency**: ✅ Different node types can compute concurrently  
**Critical Section**: None (node-specific logic)  
**Thread Safety**: Read-only node data, write to local result

### Detailed Concurrency Analysis

#### Concurrent Opportunities

**1. Independent Node Computation**
```javascript
// Nodes at same dependency level can compute in parallel
const dependencyLevels = topologicalSort(graph);
for (const level of dependencyLevels) {
  // All nodes in this level can compute concurrently
  await Promise.all(level.map(node => computeNode(node)));
}
```

**2. Parameter Evaluation Batching**
```javascript
// Evaluate all parameters for a node concurrently
const paramPromises = Object.entries(node.params).map(([key, value]) =>
  evaluateParameter(value, context)
);
const evaluatedParams = await Promise.all(paramPromises);
```

**3. Expression Evaluation (if delegated)**
```javascript
// Multiple expressions can evaluate concurrently
const expressionPromises = expressions.map(expr =>
  expressionWorker.evaluate(expr, context)
);
const results = await Promise.all(expressionPromises);
```

#### Sequential Dependencies

**1. Topological Order Enforcement**
```javascript
// CRITICAL: Must process nodes in dependency order
// Node B depends on Node A → A must complete before B starts
for (const node of topologicalOrder) {
  // Wait for dependencies
  await waitForDependencies(node, values);
  // Then compute
  const result = await computeNode(node);
  values.set(node.id, result);
}
```

**2. Values Map Updates**
```javascript
// CRITICAL SECTION: Values map write access
// Must be atomic to prevent race conditions
function storeNodeValue(nodeId, value) {
  // Use atomic operation or lock
  valuesMap.set(nodeId, value); // Must be thread-safe
}
```

### Critical Sections

#### 1. Values Map Write Access
```javascript
// CRITICAL SECTION: Shared state write
class ThreadSafeValuesMap {
  constructor() {
    this.map = new Map();
    this.lock = new AsyncLock(); // Or use atomic operations
  }
  
  async set(nodeId, value) {
    await this.lock.acquire();
    try {
      this.map.set(nodeId, value);
    } finally {
      this.lock.release();
    }
  }
  
  get(nodeId) {
    return this.map.get(nodeId); // Read is safe
  }
}
```

#### 2. Time Budget Checking
```javascript
// CRITICAL SECTION: Shared time budget state
class TimeBudgetManager {
  constructor(budget) {
    this.budget = budget;
    this.startTime = performance.now();
    this.processedCount = 0;
    this.lock = new AsyncLock();
  }
  
  async checkBudget() {
    await this.lock.acquire();
    try {
      this.processedCount++;
      if (this.processedCount % 10 === 0) {
        const elapsed = performance.now() - this.startTime;
        if (elapsed > this.budget) {
          return false; // Budget exceeded
        }
      }
      return true;
    } finally {
      this.lock.release();
    }
  }
}
```

### Thread-Safe Implementation

#### Option 1: Lock-Free with Atomic Operations (Recommended)
```javascript
// Use SharedArrayBuffer with atomic operations for values map
class LockFreeValuesMap {
  constructor(size) {
    // Pre-allocate array for node values
    this.values = new SharedArrayBuffer(size * 8); // 8 bytes per value pointer
    this.atomic = new Int32Array(this.values);
  }
  
  set(nodeId, value) {
    // Use atomic compare-and-swap
    const index = this.getIndex(nodeId);
    const valuePtr = this.allocateValue(value);
    Atomics.store(this.atomic, index, valuePtr);
  }
  
  get(nodeId) {
    const index = this.getIndex(nodeId);
    const valuePtr = Atomics.load(this.atomic, index);
    return this.dereferenceValue(valuePtr);
  }
}
```

#### Option 2: Async Lock (Simpler, Slightly Slower)
```javascript
// Use async lock for critical sections
import { AsyncLock } from 'async-lock';

class ThreadSafePreviewComputer {
  constructor() {
    this.values = new Map();
    this.lock = new AsyncLock();
  }
  
  async computeNode(node) {
    // Compute result (no lock needed - pure computation)
    const result = await this.computeNodeValue(node);
    
    // Store result (critical section - requires lock)
    await this.lock.acquire('values', async () => {
      this.values.set(node.id, result);
    });
    
    return result;
  }
}
```

#### Option 3: Message Passing (Web Worker Native)
```javascript
// Use message passing to avoid shared state
// Each node computation is isolated
async function computeNodeIsolated(node, dependencies) {
  // Create isolated context
  const context = {
    node: JSON.parse(JSON.stringify(node)), // Deep clone
    dependencies: new Map(dependencies) // Copy dependencies
  };
  
  // Compute in isolation
  const result = await computeNodeValue(context.node, context.dependencies);
  
  // Return result (no shared state)
  return { nodeId: node.id, value: result };
}
```

### Performance Optimization

#### 1. Dependency Level Parallelization
```javascript
// Process nodes by dependency level (max concurrency)
async function computePreviewsParallel(graph) {
  const levels = getDependencyLevels(graph);
  const values = new Map();
  
  for (const level of levels) {
    // Process all nodes in this level concurrently
    const results = await Promise.all(
      level.map(node => computeNode(node, values))
    );
    
    // Store results (sequential, but fast)
    for (const { nodeId, value } of results) {
      values.set(nodeId, value);
    }
  }
  
  return values;
}
```

#### 2. Work Stealing for Load Balancing
```javascript
// Distribute node computation across worker threads
class WorkStealingScheduler {
  constructor(workers) {
    this.workers = workers;
    this.queue = [];
  }
  
  async schedule(nodes) {
    // Distribute nodes to workers
    const chunks = this.chunkArray(nodes, this.workers.length);
    const promises = chunks.map((chunk, i) =>
      this.workers[i].compute(chunk)
    );
    
    return Promise.all(promises);
  }
}
```

---

## 2. ParameterExpressionSystem Worker

### Task Overview
Evaluates parameter expressions (e.g., `=time * 2`), handles time-based and audio-based expressions, manages expression caching.

### Atomic Unit Breakdown

#### A. Expression Parsing Phase (Concurrent)
```
A1. Check if expression (string starts with '=')
A2. Extract expression string
A3. Parse expression tokens
A4. Build AST (Abstract Syntax Tree)
```

**Concurrency**: ✅ Multiple expressions can parse concurrently  
**Critical Section**: None (pure parsing)  
**Thread Safety**: Immutable input, local AST

#### B. Context Building Phase (Concurrent)
```
B1. Extract time context
B2. Extract audio context
B3. Extract node reference values
B4. Build evaluation context object
```

**Concurrency**: ✅ Can build contexts concurrently  
**Critical Section**: Node value access (read-only)  
**Thread Safety**: Immutable context snapshot

#### C. Expression Evaluation Phase (Concurrent)
```
C1. Resolve variables from context
C2. Execute math operations
C3. Call built-in functions
C4. Return computed value
```

**Concurrency**: ✅ Multiple expressions can evaluate concurrently  
**Critical Section**: None (pure computation)  
**Thread Safety**: Immutable context, no side effects

#### D. Cache Management Phase (Critical Section)
```
D1. Generate cache key
D2. Check cache for existing result
D3. Store result in cache (if cacheable)
D4. Update cache metadata
```

**Concurrency**: ⚠️ Cache access requires synchronization  
**Critical Section**: Cache read/write  
**Thread Safety**: Lock or lock-free cache

### Detailed Concurrency Analysis

#### Concurrent Opportunities

**1. Batch Expression Evaluation**
```javascript
// Evaluate multiple expressions concurrently
async function evaluateBatch(expressions, context) {
  const promises = expressions.map(expr =>
    evaluateExpression(expr, context)
  );
  return Promise.all(promises);
}
```

**2. Independent Expression Parsing**
```javascript
// Parse expressions in parallel
const parsePromises = expressions.map(expr =>
  parseExpression(expr)
);
const asts = await Promise.all(parsePromises);
```

**3. Context Building (if node values available)**
```javascript
// Build contexts concurrently
const contextPromises = expressions.map(expr =>
  buildContext(expr, nodeValues)
);
const contexts = await Promise.all(contextPromises);
```

#### Sequential Dependencies

**1. Cache Check Before Evaluation**
```javascript
// Must check cache before evaluating
async function evaluateWithCache(expression, context) {
  // Sequential: Check cache first
  const cacheKey = generateCacheKey(expression, context);
  const cached = await cache.get(cacheKey);
  if (cached) return cached;
  
  // Then evaluate if not cached
  const result = await evaluateExpression(expression, context);
  
  // Finally store in cache
  await cache.set(cacheKey, result);
  return result;
}
```

**2. Node Reference Resolution**
```javascript
// Must resolve node references before evaluation
async function evaluateWithNodeRefs(expression, nodeRefs) {
  // Sequential: Resolve references first
  const resolvedRefs = await resolveNodeReferences(nodeRefs);
  
  // Then evaluate with resolved values
  return evaluateExpression(expression, { ...context, ...resolvedRefs });
}
```

### Critical Sections

#### 1. Expression Cache Access
```javascript
// CRITICAL SECTION: Cache read/write
class ThreadSafeExpressionCache {
  constructor() {
    this.cache = new Map();
    this.lock = new AsyncLock();
  }
  
  async get(key) {
    await this.lock.acquire('cache', async () => {
      return this.cache.get(key);
    });
  }
  
  async set(key, value) {
    await this.lock.acquire('cache', async () => {
      this.cache.set(key, {
        value,
        timestamp: performance.now()
      });
    });
  }
}
```

#### 2. Dependency Graph Updates
```javascript
// CRITICAL SECTION: Dependency tracking
class DependencyTracker {
  constructor() {
    this.dependencies = new Map();
    this.lock = new AsyncLock();
  }
  
  async addDependency(nodeId, expression, dependencies) {
    await this.lock.acquire('dependencies', async () => {
      if (!this.dependencies.has(nodeId)) {
        this.dependencies.set(nodeId, new Set());
      }
      this.dependencies.get(nodeId).add(...dependencies);
    });
  }
}
```

### Thread-Safe Implementation

#### Option 1: Lock-Free Cache with Atomic Operations
```javascript
// Use lock-free hash table for cache
class LockFreeExpressionCache {
  constructor(size = 1024) {
    this.buckets = new Array(size);
    this.size = size;
  }
  
  get(key) {
    const bucket = this.getBucket(key);
    // Use atomic operations for bucket access
    return this.atomicGet(bucket, key);
  }
  
  set(key, value) {
    const bucket = this.getBucket(key);
    // Use atomic compare-and-swap
    this.atomicSet(bucket, key, value);
  }
}
```

#### Option 2: Read-Write Lock (Optimized for Read-Heavy)
```javascript
// Use read-write lock for cache (many reads, few writes)
class ReadWriteCache {
  constructor() {
    this.cache = new Map();
    this.rwLock = new ReadWriteLock();
  }
  
  async get(key) {
    // Multiple readers allowed
    await this.rwLock.readLock();
    try {
      return this.cache.get(key);
    } finally {
      this.rwLock.readUnlock();
    }
  }
  
  async set(key, value) {
    // Exclusive write access
    await this.rwLock.writeLock();
    try {
      this.cache.set(key, value);
    } finally {
      this.rwLock.writeUnlock();
    }
  }
}
```

#### Option 3: Per-Expression Isolation (No Shared State)
```javascript
// Each expression evaluation is completely isolated
async function evaluateExpressionIsolated(expression, context) {
  // Deep clone context to avoid shared state
  const isolatedContext = JSON.parse(JSON.stringify(context));
  
  // Evaluate in isolation
  const result = evaluateExpression(expression, isolatedContext);
  
  // Return result (no shared state modified)
  return result;
}
```

### Performance Optimization

#### 1. Expression Batching
```javascript
// Batch evaluate expressions to reduce overhead
class ExpressionBatcher {
  constructor() {
    this.batch = [];
    this.batchTimer = null;
    this.batchDelay = 5; // 5ms batching window
  }
  
  async evaluate(expression, context) {
    return new Promise((resolve) => {
      this.batch.push({ expression, context, resolve });
      
      if (this.batchTimer) clearTimeout(this.batchTimer);
      this.batchTimer = setTimeout(() => {
        this.processBatch();
      }, this.batchDelay);
    });
  }
  
  async processBatch() {
    const batch = this.batch.splice(0);
    const results = await Promise.all(
      batch.map(({ expression, context }) =>
        evaluateExpression(expression, context)
      )
    );
    batch.forEach(({ resolve }, i) => resolve(results[i]));
  }
}
```

#### 2. Cache Warming
```javascript
// Pre-evaluate common expressions
class CacheWarmer {
  async warmCache(commonExpressions, context) {
    // Evaluate common expressions in parallel
    const promises = commonExpressions.map(expr =>
      evaluateExpression(expr, context)
    );
    await Promise.all(promises);
  }
}
```

---

## 3. SaveLoadManager Worker

### Task Overview
Handles graph serialization/deserialization, file save/load operations, backup creation, import/export operations.

### Atomic Unit Breakdown

#### A. Graph Serialization Phase (Sequential)
```
A1. Extract node data
A2. Extract connection data
A3. Extract parameter values
A4. Serialize to JSON string
A5. Compress (optional)
```

**Concurrency**: ⚠️ Partial (nodes can serialize concurrently, but final assembly is sequential)  
**Critical Section**: Final JSON assembly  
**Thread Safety**: Immutable graph snapshot

#### B. File I/O Phase (Sequential)
```
B1. Open file handle
B2. Write data to file
B3. Flush to disk
B4. Close file handle
```

**Concurrency**: ❌ Sequential (file system operations)  
**Critical Section**: File access  
**Thread Safety**: File system locks

#### C. Backup Management Phase (Concurrent)
```
C1. List existing backups
C2. Check backup count
C3. Delete old backups (if needed)
C4. Create new backup
```

**Concurrency**: ⚠️ Partial (backup creation can be concurrent, deletion is sequential)  
**Critical Section**: Backup list access  
**Thread Safety**: File system or database locks

#### D. Deserialization Phase (Hybrid)
```
D1. Parse JSON string
D2. Validate structure
D3. Restore nodes (CONCURRENT per node)
D4. Restore connections (SEQUENTIAL - depends on nodes)
D5. Restore parameters (CONCURRENT per node)
```

**Concurrency**: ✅ Nodes can restore concurrently  
**Critical Section**: Graph structure updates  
**Thread Safety**: Immutable graph construction

### Detailed Concurrency Analysis

#### Concurrent Opportunities

**1. Node Serialization**
```javascript
// Serialize nodes in parallel
async function serializeNodes(nodes) {
  const promises = nodes.map(node => serializeNode(node));
  return Promise.all(promises);
}
```

**2. Node Deserialization**
```javascript
// Deserialize nodes in parallel
async function deserializeNodes(nodeData) {
  const promises = nodeData.map(data => deserializeNode(data));
  return Promise.all(promises);
}
```

**3. Parameter Restoration**
```javascript
// Restore parameters concurrently
async function restoreParameters(nodes, paramData) {
  const promises = nodes.map(node =>
    restoreNodeParameters(node, paramData[node.id])
  );
  await Promise.all(promises);
}
```

#### Sequential Dependencies

**1. Graph Serialization Assembly**
```javascript
// Must assemble serialized data sequentially
async function serializeGraph(graph) {
  // Concurrent: Serialize components
  const [nodes, connections, params] = await Promise.all([
    serializeNodes(graph.nodes),
    serializeConnections(graph.connections),
    serializeParameters(graph.nodes)
  ]);
  
  // Sequential: Assemble final JSON
  return JSON.stringify({ nodes, connections, params });
}
```

**2. Connection Restoration (Depends on Nodes)**
```javascript
// Must restore nodes before connections
async function deserializeGraph(data) {
  // Sequential: Restore nodes first
  const nodes = await deserializeNodes(data.nodes);
  
  // Then restore connections (depends on nodes)
  const connections = await deserializeConnections(data.connections, nodes);
  
  return { nodes, connections };
}
```

**3. File I/O Operations**
```javascript
// File operations must be sequential
async function saveToFile(data, filename) {
  // Sequential: Open, write, close
  const handle = await fileSystem.open(filename, 'w');
  await fileSystem.write(handle, data);
  await fileSystem.close(handle);
}
```

### Critical Sections

#### 1. File Access
```javascript
// CRITICAL SECTION: File system access
class ThreadSafeFileManager {
  constructor() {
    this.fileLocks = new Map();
    this.lock = new AsyncLock();
  }
  
  async writeFile(filename, data) {
    await this.lock.acquire(filename, async () => {
      // Exclusive file access
      await fileSystem.writeFile(filename, data);
    });
  }
  
  async readFile(filename) {
    await this.lock.acquire(filename, async () => {
      // Exclusive file access
      return await fileSystem.readFile(filename);
    });
  }
}
```

#### 2. Backup List Management
```javascript
// CRITICAL SECTION: Backup list access
class BackupManager {
  constructor() {
    this.backups = [];
    this.lock = new AsyncLock();
  }
  
  async addBackup(backup) {
    await this.lock.acquire('backups', async () => {
      this.backups.push(backup);
      // Clean old backups
      if (this.backups.length > this.maxBackups) {
        const old = this.backups.shift();
        await this.deleteBackup(old);
      }
    });
  }
}
```

#### 3. Graph State Updates
```javascript
// CRITICAL SECTION: Graph structure updates
class GraphDeserializer {
  constructor() {
    this.graph = { nodes: [], connections: [] };
    this.lock = new AsyncLock();
  }
  
  async addNode(node) {
    await this.lock.acquire('graph', async () => {
      this.graph.nodes.push(node);
    });
  }
  
  async addConnection(connection) {
    await this.lock.acquire('graph', async () => {
      this.graph.connections.push(connection);
    });
  }
}
```

### Thread-Safe Implementation

#### Option 1: Immutable Graph Construction
```javascript
// Build graph immutably, then swap atomically
class ImmutableGraphBuilder {
  constructor() {
    this.builder = { nodes: [], connections: [] };
  }
  
  async deserializeGraph(data) {
    // Build new graph immutably
    const newGraph = {
      nodes: await Promise.all(data.nodes.map(d => deserializeNode(d))),
      connections: await Promise.all(
        data.connections.map(d => deserializeConnection(d))
      )
    };
    
    // Atomic swap (single assignment)
    this.graph = newGraph;
    return newGraph;
  }
}
```

#### Option 2: Transaction-Based Updates
```javascript
// Use transactions for graph updates
class TransactionalGraphManager {
  async deserializeGraph(data) {
    const transaction = this.beginTransaction();
    try {
      // All updates are part of transaction
      for (const nodeData of data.nodes) {
        await transaction.addNode(deserializeNode(nodeData));
      }
      for (const connData of data.connections) {
        await transaction.addConnection(deserializeConnection(connData));
      }
      
      // Commit transaction (atomic)
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
```

### Performance Optimization

#### 1. Streaming Serialization
```javascript
// Stream large graphs to avoid memory issues
async function* serializeGraphStream(graph) {
  // Stream nodes
  yield '{"nodes":[';
  let first = true;
  for (const node of graph.nodes) {
    if (!first) yield ',';
    yield JSON.stringify(serializeNode(node));
    first = false;
  }
  yield '],';
  
  // Stream connections
  yield '"connections":[';
  first = true;
  for (const conn of graph.connections) {
    if (!first) yield ',';
    yield JSON.stringify(conn);
    first = false;
  }
  yield ']}';
}
```

#### 2. Incremental Backup
```javascript
// Only backup changed nodes
class IncrementalBackup {
  async createBackup(graph, previousBackup) {
    // Only serialize changed nodes
    const changedNodes = graph.nodes.filter(node =>
      !previousBackup || node.modified > previousBackup.timestamp
    );
    
    // Serialize changed nodes in parallel
    const nodeData = await Promise.all(
      changedNodes.map(node => serializeNode(node))
    );
    
    return { changedNodes: nodeData, timestamp: Date.now() };
  }
}
```

---

## 4. UndoManager Worker

### Task Overview
Manages undo/redo history, tracks graph state changes, handles undo/redo operations.

### Atomic Unit Breakdown

#### A. State Snapshot Creation (Sequential)
```
A1. Capture graph state
A2. Capture editor state
A3. Serialize state to snapshot
A4. Assign version number
A5. Store in undo stack
```

**Concurrency**: ❌ Sequential (version numbers must be sequential)  
**Critical Section**: Undo stack access  
**Thread Safety**: Lock or atomic version counter

#### B. Undo Operation (Sequential)
```
B1. Pop from undo stack
B2. Push to redo stack
B3. Deserialize state snapshot
B4. Apply state to graph
```

**Concurrency**: ❌ Sequential (must maintain stack order)  
**Critical Section**: Stack operations  
**Thread Safety**: Lock on stack operations

#### C. Redo Operation (Sequential)
```
C1. Pop from redo stack
C2. Push to undo stack
C3. Deserialize state snapshot
C4. Apply state to graph
```

**Concurrency**: ❌ Sequential (must maintain stack order)  
**Critical Section**: Stack operations  
**Thread Safety**: Lock on stack operations

#### D. State Comparison (Concurrent)
```
D1. Compare graph structures
D2. Compare node states
D3. Compare parameter values
D4. Determine if state changed
```

**Concurrency**: ✅ Can compare different aspects concurrently  
**Critical Section**: None (read-only comparison)  
**Thread Safety**: Immutable snapshots

### Detailed Concurrency Analysis

#### Concurrent Opportunities

**1. State Comparison**
```javascript
// Compare different aspects of state concurrently
async function compareStates(state1, state2) {
  const [graphEqual, editorEqual, paramsEqual] = await Promise.all([
    compareGraphs(state1.graph, state2.graph),
    compareEditors(state1.editor, state2.editor),
    compareParameters(state1.params, state2.params)
  ]);
  
  return graphEqual && editorEqual && paramsEqual;
}
```

**2. Snapshot Serialization**
```javascript
// Serialize different parts of state concurrently
async function createSnapshot(graph, editor) {
  const [graphData, editorData] = await Promise.all([
    serializeGraph(graph),
    serializeEditor(editor)
  ]);
  
  return { graph: graphData, editor: editorData };
}
```

#### Sequential Dependencies

**1. Version Number Assignment**
```javascript
// Version numbers must be sequential
class VersionManager {
  constructor() {
    this.version = 0;
    this.lock = new AsyncLock();
  }
  
  async getNextVersion() {
    await this.lock.acquire('version', async () => {
      this.version++;
      return this.version;
    });
  }
}
```

**2. Stack Operations**
```javascript
// Stack operations must be atomic
class ThreadSafeStack {
  constructor() {
    this.stack = [];
    this.lock = new AsyncLock();
  }
  
  async push(item) {
    await this.lock.acquire('stack', async () => {
      this.stack.push(item);
    });
  }
  
  async pop() {
    await this.lock.acquire('stack', async () => {
      return this.stack.pop();
    });
  }
}
```

### Critical Sections

#### 1. Undo/Redo Stack Access
```javascript
// CRITICAL SECTION: Stack operations
class ThreadSafeUndoManager {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.lock = new AsyncLock();
  }
  
  async recordState(state) {
    await this.lock.acquire('stacks', async () => {
      this.undoStack.push(state);
      this.redoStack = []; // Clear redo on new action
    });
  }
  
  async undo() {
    await this.lock.acquire('stacks', async () => {
      if (this.undoStack.length === 0) return null;
      
      const state = this.undoStack.pop();
      this.redoStack.push(this.currentState);
      return state;
    });
  }
  
  async redo() {
    await this.lock.acquire('stacks', async () => {
      if (this.redoStack.length === 0) return null;
      
      const state = this.redoStack.pop();
      this.undoStack.push(this.currentState);
      return state;
    });
  }
}
```

#### 2. Version Counter
```javascript
// CRITICAL SECTION: Version assignment
class VersionCounter {
  constructor() {
    this.version = 0;
    // Use atomic counter if SharedArrayBuffer available
    if (typeof SharedArrayBuffer !== 'undefined') {
      this.atomicVersion = new Int32Array(new SharedArrayBuffer(4));
    }
  }
  
  getNextVersion() {
    if (this.atomicVersion) {
      return Atomics.add(this.atomicVersion, 0, 1);
    } else {
      // Fallback to lock
      return ++this.version; // Must be protected by lock
    }
  }
}
```

### Thread-Safe Implementation

#### Option 1: Lock-Free Stack (Complex)
```javascript
// Use lock-free stack with atomic operations
class LockFreeStack {
  constructor() {
    // Use atomic compare-and-swap for stack operations
    this.head = new SharedArrayBuffer(8); // Pointer to head node
  }
  
  push(item) {
    const newNode = this.allocateNode(item);
    let head = Atomics.load(this.head, 0);
    do {
      newNode.next = head;
    } while (Atomics.compareExchange(this.head, 0, head, newNode) !== head);
  }
  
  pop() {
    let head = Atomics.load(this.head, 0);
    do {
      if (head === null) return null;
      const next = head.next;
    } while (Atomics.compareExchange(this.head, 0, head, next) !== head);
    return head.value;
  }
}
```

#### Option 2: Async Lock (Simpler, Recommended)
```javascript
// Use async lock for stack operations
class AsyncLockUndoManager {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.lock = new AsyncLock();
  }
  
  async recordState(state) {
    await this.lock.acquire('undo', async () => {
      this.undoStack.push(state);
      this.redoStack = [];
    });
  }
  
  async undo() {
    return await this.lock.acquire('undo', async () => {
      if (this.undoStack.length === 0) return null;
      const state = this.undoStack.pop();
      this.redoStack.push(this.currentState);
      return state;
    });
  }
}
```

### Performance Optimization

#### 1. Incremental Snapshots
```javascript
// Only store differences between states
class IncrementalUndoManager {
  async recordState(newState, previousState) {
    // Compute diff instead of full snapshot
    const diff = this.computeDiff(previousState, newState);
    
    // Store diff (much smaller than full snapshot)
    this.undoStack.push({
      version: this.getNextVersion(),
      diff: diff,
      timestamp: Date.now()
    });
  }
  
  async applyDiff(state, diff) {
    // Apply diff to state
    return this.applyStateDiff(state, diff);
  }
}
```

#### 2. Snapshot Compression
```javascript
// Compress snapshots to save memory
class CompressedUndoManager {
  async recordState(state) {
    // Serialize and compress
    const serialized = JSON.stringify(state);
    const compressed = await this.compress(serialized);
    
    this.undoStack.push({
      version: this.getNextVersion(),
      data: compressed,
      timestamp: Date.now()
    });
  }
  
  async getState(version) {
    const snapshot = this.undoStack.find(s => s.version === version);
    const decompressed = await this.decompress(snapshot.data);
    return JSON.parse(decompressed);
  }
}
```

---

## Summary: Thread-Safe Execution Methods

### Recommended Approaches by Thread

#### PreviewComputer Worker
- **Method**: Dependency-level parallelization with lock-free values map
- **Critical Sections**: Values map writes (use atomic operations)
- **Concurrency**: High (nodes at same level can compute concurrently)

#### ParameterExpressionSystem Worker
- **Method**: Batch evaluation with read-write lock on cache
- **Critical Sections**: Expression cache (use read-write lock)
- **Concurrency**: Very High (expressions are independent)

#### SaveLoadManager Worker
- **Method**: Immutable graph construction with file system locks
- **Critical Sections**: File access, graph updates (use locks)
- **Concurrency**: Medium (nodes can serialize/deserialize concurrently)

#### UndoManager Worker
- **Method**: Async lock on stack operations with incremental snapshots
- **Critical Sections**: Stack operations, version counter (use locks)
- **Concurrency**: Low (stack operations must be sequential)

### General Thread Safety Principles

1. **Immutable Data**: Use deep cloning for shared data
2. **Atomic Operations**: Use SharedArrayBuffer + Atomics where possible
3. **Async Locks**: Use locks for complex critical sections
4. **Message Passing**: Prefer message passing over shared state
5. **Version Numbers**: Use atomic counters for versioning
6. **Read-Write Locks**: Optimize for read-heavy workloads

### Performance Targets

- **PreviewComputer**: Process 1000 nodes in <50ms with parallelization
- **ParameterExpressionSystem**: Evaluate 100 expressions in <10ms with batching
- **SaveLoadManager**: Serialize 1000-node graph in <100ms with streaming
- **UndoManager**: Record state snapshot in <5ms with incremental diffs

