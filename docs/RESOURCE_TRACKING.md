# GPU Resource Tracking and Automatic Cleanup

This document describes the GPU resource tracking system implemented to prevent memory leaks in the GLSL Node Editor.

## Overview

The resource tracking system automatically tracks and cleans up all GPU resources (textures, buffers, samplers) associated with nodes, preventing memory leaks in large projects.

## Key Components

### 1. ResourceTracker (`src/gpu/ResourceTracker.js`)

The `ResourceTracker` class provides centralized tracking of GPU resources for individual nodes.

**Features:**
- Tracks textures, buffers, samplers, bind groups, and pipelines
- Calculates memory usage statistics
- Provides automatic cleanup on node deletion
- Prevents double-free errors with destroy state tracking

**Usage:**
```javascript
const tracker = new ResourceTracker(nodeId);

// Track resources
tracker.trackTexture(texture, { width: 512, height: 512, format: 'rgba8unorm' });
tracker.trackBuffer(buffer, 1024);

// Get statistics
const stats = tracker.getStats();
console.log(`Memory usage: ${stats.totalMemoryMB} MB`);

// Cleanup
tracker.destroy();
```

### 2. ResourceTrackerRegistry (`src/gpu/ResourceTracker.js`)

The `ResourceTrackerRegistry` manages all resource trackers globally.

**Features:**
- Centralized registry of all node resource trackers
- Get-or-create pattern for tracker access
- Bulk cleanup operations
- Global memory usage reporting

**Global Instance:**
```javascript
// Available globally
window.globalResourceRegistry

// Get total memory usage
const usage = window.globalResourceRegistry.getTotalMemoryUsage();
console.log(`Total GPU memory: ${usage.totalMemoryMB} MB`);

// Get all node statistics
const allStats = window.globalResourceRegistry.getAllStats();
```

## Integration Points

### 1. ComputeShaderManager

The `ComputeShaderManager` automatically tracks all resources it creates:

- **Storage textures** (including ping-pong textures for feedback)
- **Output textures**
- **Uniform buffers**

Resources are tracked when created and destroyed when the manager is destroyed.

**File:** `src/gpu/ComputeShaderManager.js`

**Key Changes:**
```javascript
// Constructor
this.resourceTracker = node?.id ? globalResourceRegistry.getOrCreate(node.id) : null;

// Track resources
this.resourceTracker?.trackTexture(this.storageTexture, { width, height, format: 'rgba8unorm' });
this.resourceTracker?.trackBuffer(this.uniformBuffer, 32);

// Destroy
destroy() {
  if (this.resourceTracker) {
    this.resourceTracker.destroy();
  }
  // ... cleanup
}
```

### 2. Editor Node Deletion

The `Editor` class now calls cleanup hooks when nodes are deleted:

**File:** `src/core/Editor.js`

**Methods:**
- `deleteNode()` - Cleans up single node resources
- `deleteNodesAsGroup()` - Cleans up multiple node resources
- `cleanupNodeResources(node)` - Centralized cleanup logic

**Cleanup Process:**
1. Remove from ComputeExecutor (destroys compute resources)
2. Remove from TextureManager (destroys texture resources)
3. Destroy preview textures (ShaderPreviewManager)
4. Destroy GPU preview renderer cache
5. Remove from resource tracker registry

### 3. ShaderPreviewManager

Added `destroyPreviewTexture(nodeId)` method for cleaning up preview textures.

**File:** `src/preview/ShaderPreviewManager.js`

## Resource Lifecycle

### Node Creation
1. Node created in editor
2. ComputeShaderManager created
3. ResourceTracker created and registered
4. GPU resources allocated and tracked

### Node Update
1. Old ComputeShaderManager destroyed
2. ResourceTracker destroys old resources
3. New ComputeShaderManager created
4. New ResourceTracker created
5. New GPU resources allocated and tracked

### Node Deletion
1. Node deleted from graph
2. Editor calls `cleanupNodeResources()`
3. ComputeExecutor removes compute node (destroys manager)
4. TextureManager removes textures
5. Preview textures destroyed
6. ResourceTracker destroys all remaining resources
7. Tracker removed from registry

## Memory Monitoring

### Check Current Memory Usage

```javascript
// Get memory usage for a specific node
const tracker = window.globalResourceRegistry.get(nodeId);
if (tracker) {
  console.log(tracker.getStats());
}

// Get total memory usage across all nodes
const totalUsage = window.globalResourceRegistry.getTotalMemoryUsage();
console.log(`
  Texture Memory: ${totalUsage.textureMemoryMB} MB
  Buffer Memory: ${totalUsage.bufferMemoryMB} MB
  Total Memory: ${totalUsage.totalMemoryMB} MB
  Total Resources: ${totalUsage.totalResources}
  Active Nodes: ${totalUsage.totalNodes}
`);

// Get detailed stats for all nodes
const allStats = window.globalResourceRegistry.getAllStats();
allStats.forEach(stats => {
  console.log(`Node ${stats.nodeId}: ${stats.totalMemoryMB} MB`);
});
```

### Resource Statistics

Each tracker provides the following statistics:

- `textures` - Number of tracked textures
- `buffers` - Number of tracked buffers
- `samplers` - Number of tracked samplers
- `textureMemoryMB` - Texture memory usage in MB
- `bufferMemoryMB` - Buffer memory usage in MB
- `totalMemoryMB` - Total memory usage in MB
- `totalResources` - Total number of tracked resources
- `destroyed` - Whether the tracker has been destroyed
- `lifetimeMs` - How long the tracker has existed

## Debugging

### Enable Verbose Logging

The resource tracker logs cleanup operations to the console:

```
[ResourceTracker] Node ComputeNoise_123 cleanup: {
  textures: 2,
  buffers: 1,
  textureMemoryMB: "2.00",
  bufferMemoryMB: "0.00",
  totalMemoryMB: "2.00",
  destroyedCount: 3,
  errorCount: 0,
  duration: "1.23ms"
}
```

### Check for Memory Leaks

Before and after operations:

```javascript
// Before
const before = window.globalResourceRegistry.getTotalMemoryUsage();
console.log('Before:', before);

// ... perform operations (create/delete nodes)

// After
const after = window.globalResourceRegistry.getTotalMemoryUsage();
console.log('After:', after);
console.log('Leaked:', {
  memoryMB: (parseFloat(after.totalMemoryMB) - parseFloat(before.totalMemoryMB)).toFixed(2),
  resources: after.totalResources - before.totalResources
});
```

## Benefits

1. **Automatic Cleanup** - Resources are automatically freed when nodes are deleted
2. **Memory Leak Prevention** - Prevents accumulation of GPU resources in large projects
3. **Memory Monitoring** - Track memory usage per node and globally
4. **Double-Free Protection** - Prevents crashes from destroying resources multiple times
5. **Performance** - Efficient cleanup with minimal overhead
6. **Debugging** - Detailed logging and statistics for troubleshooting

## Implementation Notes

### Thread Safety

The resource tracker is designed for single-threaded use (main thread only). It does not provide thread synchronization.

### Error Handling

The tracker catches and logs errors during resource destruction to prevent one failing resource from blocking cleanup of others.

### Memory Estimation

Texture memory is estimated based on size and format. Actual GPU memory usage may vary based on:
- Driver implementation
- Texture compression
- Memory alignment
- Mipmap generation

## Future Enhancements

Potential improvements:

1. **Resource pooling** - Reuse textures/buffers across nodes
2. **LRU cache** - Automatic eviction of least-recently-used resources
3. **Memory limits** - Enforce maximum GPU memory usage
4. **Detailed tracking** - Track pipeline memory, bind group memory
5. **Performance metrics** - Track resource allocation/deallocation performance
6. **WebGPU memory info** - Use WebGPU memory info API when available

## Related Files

- `src/gpu/ResourceTracker.js` - Core resource tracking implementation
- `src/gpu/ComputeShaderManager.js` - Compute shader resource management
- `src/gpu/ComputeNodeBase.js` - Base class for compute nodes
- `src/gpu/ComputeExecutor.js` - Compute node execution and lifecycle
- `src/core/Editor.js` - Node deletion and cleanup hooks
- `src/core/TextureManager.js` - Texture resource management
- `src/preview/ShaderPreviewManager.js` - Preview texture management
- `src/preview/GPUPreviewRenderer.js` - GPU preview rendering
- `main.js` - Global registry initialization
