# Render Cache System

## Overview

The Render Cache system caches intermediate render artifacts (textures, framebuffers) to avoid full rerenders. It integrates with the InvalidationManager (Subtask D2.B) to automatically invalidate cache entries when nodes or regions change.

## Architecture

### Core Components

1. **RenderCache** (`src/gpu/RenderCache.js`)
   - LRU (Least Recently Used) eviction policy
   - Memory and entry count limits
   - Lifetime-based expiration
   - Metrics tracking (hits, misses, evictions, memory usage)

2. **GPURenderer Integration** (`src/gpu/gpuRenderer.js`)
   - MSAA texture caching
   - Automatic cache invalidation hooks
   - Metrics exposure

3. **InvalidationManager Integration** (D2.B)
   - Cache entries automatically invalidated when nodes are invalidated
   - Static node support (nodes that don't change unless explicitly invalidated)

## Cacheable Elements

Based on D1 findings, the following elements are cacheable:

### 1. MSAA Textures
- **What**: Multi-sample anti-aliasing render targets
- **Cache Key**: `msaa_{width}x{height}_{sampleCount}`
- **Lifetime**: Managed by canvas resize (no expiration)
- **Invalidation**: On canvas resize or device loss

### 2. Static Node Outputs
- **What**: Fragment node textures that don't change unless inputs change
- **Cache Key**: `{nodeId}_{width}x{height}`
- **Lifetime**: 60 seconds default (configurable)
- **Invalidation**: On node invalidation, parameter changes, or input changes

### 3. Intermediate Render Targets
- **What**: Framebuffers used for multi-pass rendering
- **Cache Key**: Custom (based on render pass)
- **Lifetime**: Configurable per entry
- **Invalidation**: On render pass changes or explicit invalidation

## Cache Lifetimes

### Default Lifetime
- **Default**: 60 seconds
- **Configurable**: Per-entry via options
- **Infinite**: Set `lifetime: 0` for entries that should never expire

### Lifetime Scenarios

| Scenario | Lifetime | Reason |
|----------|----------|--------|
| MSAA textures | 0 (infinite) | Managed by resize events |
| Static nodes | 0 (infinite) | Only invalidated on explicit changes |
| Dynamic nodes | 60s | Balance between memory and performance |
| Intermediate passes | 30s | Short-lived, frequently recreated |

## Usage

### Basic Usage

```javascript
// In gpuRenderer.js
const texture = this.renderCache.getOrCreateTexture(
  'node_1_512x512',
  { width: 512, height: 512, format: 'rgba8unorm' },
  () => {
    return this.device.createTexture({
      size: [512, 512, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    });
  },
  {
    nodeId: 'node_1',
    lifetime: 60000, // 60 seconds
    static: false
  }
);
```

### Static Node Caching

```javascript
// Mark a node as static (won't be invalidated automatically)
this.renderCache.markStatic('node_1');

// Force invalidate when user explicitly changes it
this.renderCache.forceInvalidateNode('node_1', 'user-edit');
```

### Cache Invalidation

```javascript
// Invalidate specific node (automatic via InvalidationManager)
editor.invalidationManager.invalidateNode(node, 'parameter-change');
// Cache is automatically invalidated via hooks

// Manual invalidation
gpuRenderer.renderCache.invalidateNode('node_1', 'manual');
gpuRenderer.renderCache.invalidateKey('node_1_512x512', 'manual');
```

## Metrics

### Available Metrics

```javascript
const metrics = gpuRenderer.getCacheMetrics();
// Returns:
// {
//   hits: 1234,           // Cache hits
//   misses: 567,          // Cache misses
//   evictions: 12,        // LRU evictions
//   invalidations: 45,    // Invalidations
//   hitRate: "68.52%",    // Hit rate percentage
//   entries: 23,          // Current cache entries
//   staticNodes: 5,       // Number of static nodes
//   totalMemoryMB: 45.2,  // Current memory usage
//   peakMemoryMB: 67.8    // Peak memory usage
// }
```

### Global Access

```javascript
// Access metrics from console
window.renderCacheMetrics();
```

### Monitoring

```javascript
// Periodic cleanup (call every 60 seconds)
setInterval(() => {
  gpuRenderer.cleanupCache();
}, 60000);

// Log metrics periodically
setInterval(() => {
  const metrics = gpuRenderer.getCacheMetrics();
  console.log('Cache metrics:', metrics);
}, 5000);
```

## Configuration

### Memory Limits

```javascript
// Set maximum memory (default: 256MB)
renderCache.setMaxMemory(512); // 512MB

// Set maximum entries (default: 100)
renderCache.setMaxEntries(200);
```

### Cache Initialization

```javascript
const renderCache = new RenderCache(device, {
  maxMemoryMB: 256,      // Maximum memory in MB
  maxEntries: 100,       // Maximum cache entries
  defaultLifetime: 60000 // Default lifetime in ms (60s)
});
```

## Integration with InvalidationManager (D2.B)

The cache automatically integrates with InvalidationManager:

1. **Node Invalidation**: When `invalidationManager.invalidateNode()` is called, associated cache entries are automatically invalidated.

2. **Full Invalidation**: Full invalidations can optionally clear the cache (currently disabled to preserve valid entries).

3. **Static Nodes**: Nodes marked as static are not invalidated automatically, only on explicit `forceInvalidateNode()` calls.

### Hook Implementation

```javascript
// In GPURenderer._setupInvalidationHooks()
window.editor.invalidationManager.invalidateNode = (node, reason) => {
  originalInvalidateNode(node, reason);
  // Automatically invalidate cache
  if (node && node.id) {
    this.renderCache.invalidateNode(node.id, reason);
  }
};
```

## Performance Impact

### Expected Improvements

- **Reduced texture creation**: 60-80% reduction in texture allocations
- **Lower GPU memory churn**: Fewer allocations/deallocations
- **Faster renders**: Cache hits avoid expensive texture creation
- **Better frame rates**: Especially for static or infrequently changing nodes

### Memory Management

- **LRU Eviction**: Prevents unbounded memory growth
- **Memory Limits**: Configurable limits prevent memory bloat
- **Automatic Cleanup**: Expired entries are cleaned up automatically

## Potential Risks & Mitigations

### Risk: Memory Bloat
**Mitigation**: 
- LRU eviction policy
- Configurable memory limits
- Automatic cleanup of expired entries
- Metrics monitoring

### Risk: Stale Cache Invalidation
**Mitigation**:
- Integration with InvalidationManager
- Static node support for explicit control
- Force invalidation API
- Lifetime-based expiration

### Risk: Cache Thrashing
**Mitigation**:
- LRU policy prevents frequent evictions
- Memory limits prevent excessive cache size
- Metrics help identify thrashing patterns

## Best Practices

1. **Use static caching for nodes that rarely change**
   ```javascript
   renderCache.getOrCreateTexture(key, metadata, createFn, {
     static: true,
     nodeId: nodeId
   });
   ```

2. **Set appropriate lifetimes**
   - Short lifetimes (30s) for frequently changing nodes
   - Long lifetimes (5min) for stable nodes
   - Infinite (0) for MSAA textures

3. **Monitor metrics regularly**
   ```javascript
   // Check hit rate - should be >50% for good performance
   const metrics = renderCache.getMetrics();
   if (parseFloat(metrics.hitRate) < 50) {
     console.warn('Low cache hit rate - consider tuning');
   }
   ```

4. **Cleanup periodically**
   ```javascript
   // Cleanup expired entries every 60 seconds
   setInterval(() => renderCache.cleanup(), 60000);
   ```

5. **Invalidate explicitly when needed**
   ```javascript
   // When user explicitly changes a static node
   renderCache.forceInvalidateNode(nodeId, 'user-edit');
   ```

## Future Enhancements

1. **FragmentTextureRenderer Integration**: Integrate RenderCache into FragmentTextureRenderer for unified caching
2. **Predictive Caching**: Pre-cache likely-to-be-used textures
3. **Adaptive Lifetimes**: Adjust lifetimes based on access patterns
4. **Cache Warming**: Pre-populate cache on graph load
5. **Multi-Level Caching**: Separate caches for different texture types

## Testing

### Manual Testing

```javascript
// Test cache hit/miss
const texture1 = renderCache.getOrCreateTexture('test', {...}, createFn);
const texture2 = renderCache.getOrCreateTexture('test', {...}, createFn);
// texture1 === texture2 (cache hit)

// Test invalidation
renderCache.invalidateKey('test');
const texture3 = renderCache.getOrCreateTexture('test', {...}, createFn);
// texture3 !== texture1 (cache miss after invalidation)

// Test metrics
const metrics = renderCache.getMetrics();
console.assert(metrics.hits > 0, 'Should have cache hits');
```

### Performance Testing

```javascript
// Measure cache impact
const start = performance.now();
for (let i = 0; i < 1000; i++) {
  renderCache.getOrCreateTexture('test', {...}, createFn);
}
const end = performance.now();
console.log(`1000 lookups: ${end - start}ms`);
```

## Files Modified

- `src/gpu/RenderCache.js` (new)
- `src/gpu/gpuRenderer.js` (updated)
- `docs/RENDER_CACHE.md` (new)

## References

- D1 Findings: `PERFORMANCE_FINDINGS.md`, `PERFORMANCE_ANALYSIS.md`
- InvalidationManager: `src/core/InvalidationManager.js`
- Subtask D2.B: `INVALIDATION_IMPLEMENTATION.md`

