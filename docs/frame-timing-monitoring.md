# Frame Timing Monitoring

The Frame Timing Monitoring system provides comprehensive visibility into RAF (RequestAnimationFrame) performance, helping identify bottlenecks and frame drops in real-time.

## ⚠️ CRITICAL PERFORMANCE REQUIREMENT ⚠️

**30 FPS IS NEVER ACCEPTED. ALL OPTIMIZATIONS MUST TARGET 60 FPS.**

- **Target frame time:** <16.67ms (60 FPS)
- **Throttling values:** Use 16.67ms (60 FPS), NOT 33.33ms (30 FPS)
- **Frame skipping:** Should target 60 FPS, not 30 FPS
- **Any code that limits performance to 30 FPS must be changed to 60 FPS**

---

## Overview

The Frame Timing Monitoring system is built into the `UnifiedRAFManager`, which coordinates all RAF-based handlers in the application. It automatically tracks:

- **Handler execution times** - How long each handler takes to execute
- **Total frame time** - Complete frame processing duration
- **Frame drops** - Frames exceeding the 60fps budget (16.67ms)
- **Execution order** - Which handlers ran and in what order
- **Performance warnings** - Automatic alerts when frames exceed budget

---

## Accessing Frame Stats

### Via Browser Console

```javascript
// Get comprehensive frame statistics
const stats = window.renderLoop?.rafManager?.getFrameStats();
console.log(stats);
```

### Example Output

```javascript
{
  // Overall stats
  running: true,
  frameCount: 1234,
  uptime: 20.5,              // seconds
  fps: 60.2,                 // calculated FPS
  
  // Frame timing
  averageFrameTime: 12.5,    // ms
  minFrameTime: 8.2,         // ms
  maxFrameTime: 45.3,        // ms
  lastFrameTime: 14.1,       // ms
  
  // Frame drop tracking
  frameDropCount: 23,        // frames exceeding 16.67ms
  frameDropRate: 1.86,       // percentage
  targetFrameTime: 16.67,    // 60fps budget in ms
  
  // Handler stats
  totalHandlers: 5,
  handlersExecuted: 6170,
  handlersSkipped: 0,
  averageHandlersPerFrame: 5.0,
  
  // Execution order (most recent frame)
  lastExecutionOrder: {
    frameIndex: 1234,
    frameTime: 14.1,
    handlerOrder: [
      "editorAnimationContext",
      "floatingGPUPreview",
      "previewIntegration",
      "browserAudioCapture"
    ],
    handlerTimings: [
      { name: "editorAnimationContext", time: 0.5 },
      { name: "floatingGPUPreview", time: 8.2 },
      { name: "previewIntegration", time: 2.1 },
      { name: "browserAudioCapture", time: 0.3 }
    ]
  },
  
  // Execution order history (last 10 frames)
  executionOrderHistory: [ /* ... */ ],
  
  // Per-handler statistics
  handlerStats: {
    "editorAnimationContext": {
      executionCount: 1234,
      skipCount: 0,
      averageTime: 0.5,      // ms
      minTime: 0.2,
      maxTime: 2.1,
      lastExecutionTime: 0.5,
      executionRate: 1.0,    // executed every frame
      totalTime: 617.0       // ms total
    },
    // ... other handlers
  }
}
```

---

## Understanding the Metrics

### Frame Timing Metrics

- **averageFrameTime**: Average time to process a frame (lower is better)
- **minFrameTime**: Fastest frame time (shows best-case performance)
- **maxFrameTime**: Slowest frame time (identifies worst-case spikes)
- **lastFrameTime**: Most recent frame time (current performance)

**Target Values:**
- ✅ **Good**: <16.67ms (60+ FPS)
- ⚠️ **Acceptable**: 16.67-33.33ms (30-60 FPS)
- ❌ **Poor**: >33.33ms (<30 FPS)

### Frame Drop Tracking

- **frameDropCount**: Total number of frames that exceeded 16.67ms
- **frameDropRate**: Percentage of frames that dropped (lower is better)

**Target Values:**
- ✅ **Good**: <1% drop rate
- ⚠️ **Acceptable**: 1-5% drop rate
- ❌ **Poor**: >5% drop rate

### Handler Statistics

Each handler has detailed timing information:

- **averageTime**: Average execution time per frame
- **minTime / maxTime**: Best and worst execution times
- **lastExecutionTime**: Most recent execution time
- **executionRate**: How often the handler runs (1.0 = every frame)
- **totalTime**: Cumulative time spent in this handler

**Identifying Slow Handlers:**
- Look for handlers with high `averageTime` (>1ms)
- Check `maxTime` for occasional spikes
- Compare `executionRate` to see if handlers are running unnecessarily

---

## Automatic Warnings

The system automatically logs warnings to the console when frames exceed the 60fps budget:

```
[UnifiedRAFManager] Frame time exceeded 60fps budget: 23.45ms (target: 16.67ms)
{
  frameIndex: 1234,
  totalFrameTime: "23.45",
  handlersExecuted: 5,
  handlersSkipped: 0,
  slowHandlers: [
    { name: "floatingGPUPreview", time: "15.2ms", priority: 2 },
    { name: "previewIntegration", time: "5.1ms", priority: 2 },
    { name: "editorAnimationContext", time: "2.1ms", priority: 1 }
  ]
}
```

### Warning Details

Warnings include:
- **Frame index** - Which frame exceeded the budget
- **Total frame time** - How long the frame took
- **Handler counts** - How many handlers executed/skipped
- **Slow handlers** - Top 5 handlers taking >1ms, sorted by execution time

### Interpreting Warnings

1. **Check slowHandlers**: These are the bottlenecks
2. **Look for patterns**: If the same handler appears frequently, it needs optimization
3. **Check priority**: High-priority handlers should be fast
4. **Monitor trends**: Occasional spikes are normal, consistent drops indicate a problem

---

## Execution Order Tracking

The system tracks the execution order of handlers for the last 10 frames:

```javascript
const stats = window.renderLoop?.rafManager?.getFrameStats();

// Most recent frame
console.log(stats.lastExecutionOrder);

// Last 10 frames
stats.executionOrderHistory.forEach(entry => {
  console.log(`Frame ${entry.frameIndex}: ${entry.frameTime.toFixed(2)}ms`);
  console.log(`  Handlers: ${entry.handlerOrder.join(' → ')}`);
  entry.handlerTimings.forEach(timing => {
    console.log(`    ${timing.name}: ${timing.time.toFixed(2)}ms`);
  });
});
```

### Use Cases

- **Debugging**: See which handlers ran before a problem occurred
- **Optimization**: Identify handler execution patterns
- **Performance analysis**: Correlate frame drops with specific handler sequences

---

## Performance Analysis Workflow

### Step 1: Get Baseline Stats

```javascript
// Reset stats to get clean baseline
window.renderLoop?.rafManager?.resetStats();

// Wait 10 seconds, then check
setTimeout(() => {
  const stats = window.renderLoop?.rafManager?.getFrameStats();
  console.log('Baseline:', stats);
}, 10000);
```

### Step 2: Identify Problem Areas

```javascript
const stats = window.renderLoop?.rafManager?.getFrameStats();

// Check frame drop rate
if (stats.frameDropRate > 5) {
  console.warn(`High frame drop rate: ${stats.frameDropRate.toFixed(2)}%`);
}

// Find slow handlers
Object.entries(stats.handlerStats).forEach(([name, handlerStats]) => {
  if (handlerStats.averageTime > 1.0) {
    console.warn(`Slow handler: ${name} (avg: ${handlerStats.averageTime.toFixed(2)}ms)`);
  }
});
```

### Step 3: Analyze Execution Order

```javascript
// Check if specific handler combinations cause drops
const slowFrames = stats.executionOrderHistory.filter(
  entry => entry.frameTime > 16.67
);

console.log(`Found ${slowFrames.length} slow frames`);
slowFrames.forEach(entry => {
  console.log(`Frame ${entry.frameIndex}: ${entry.frameTime.toFixed(2)}ms`);
  const slowHandlers = entry.handlerTimings.filter(h => h.time > 1.0);
  if (slowHandlers.length > 0) {
    console.log('  Slow handlers:', slowHandlers.map(h => h.name));
  }
});
```

### Step 4: Monitor in Real-Time

```javascript
// Set up continuous monitoring
setInterval(() => {
  const stats = window.renderLoop?.rafManager?.getFrameStats();
  
  // Log summary every 5 seconds
  console.log({
    fps: stats.fps.toFixed(1),
    avgFrameTime: stats.averageFrameTime.toFixed(2) + 'ms',
    dropRate: stats.frameDropRate.toFixed(2) + '%',
    maxFrameTime: stats.maxFrameTime.toFixed(2) + 'ms'
  });
}, 5000);
```

---

## Common Performance Issues

### Issue: High Frame Drop Rate

**Symptoms:**
- `frameDropRate` > 5%
- Frequent console warnings
- Visual stuttering

**Solutions:**
1. Check `handlerStats` for slow handlers
2. Look at `executionOrderHistory` for patterns
3. Optimize handlers with high `averageTime`
4. Consider reducing handler execution frequency

### Issue: Specific Handler is Slow

**Symptoms:**
- One handler has high `averageTime` or `maxTime`
- Handler appears in `slowHandlers` frequently

**Solutions:**
1. Profile the handler code
2. Check if handler is doing unnecessary work
3. Consider optimizing the handler's logic
4. Use frame skipping if handler doesn't need to run every frame

### Issue: Occasional Frame Spikes

**Symptoms:**
- Low `averageFrameTime` but high `maxFrameTime`
- Occasional warnings but good overall performance

**Solutions:**
1. Check `executionOrderHistory` for spike patterns
2. Look for handlers with high `maxTime` but low `averageTime`
3. These are likely one-time operations (e.g., shader compilation)
4. Consider deferring non-critical operations

---

## API Reference

### `getFrameStats()`

Returns comprehensive frame timing statistics.

**Returns:** `Object` with frame stats (see example output above)

**Example:**
```javascript
const stats = window.renderLoop?.rafManager?.getFrameStats();
```

### `resetStats()`

Resets all frame statistics to start fresh measurements.

**Example:**
```javascript
window.renderLoop?.rafManager?.resetStats();
```

### `getHandlers()`

Returns list of all registered handlers with their configuration.

**Returns:** `Array` of handler info objects

**Example:**
```javascript
const handlers = window.renderLoop?.rafManager?.getHandlers();
handlers.forEach(handler => {
  console.log(`${handler.name}: priority=${handler.priority}, enabled=${handler.enabled}`);
});
```

---

## Integration with Other Tools

### Browser DevTools Performance Tab

The frame timing monitoring complements browser DevTools:

1. **DevTools** shows overall frame rendering
2. **Frame Timing** shows RAF handler execution
3. **Together** they provide complete performance picture

### GPU Performance Monitor

Works alongside the GPU Performance Monitor:

- **GPU Monitor**: Tracks GPU rendering performance
- **Frame Timing**: Tracks CPU-side RAF handler performance
- **Combined**: Identifies whether bottlenecks are CPU or GPU

---

## Best Practices

1. **Monitor Regularly**: Check stats during development
2. **Reset Before Testing**: Use `resetStats()` for clean measurements
3. **Watch Warnings**: Pay attention to console warnings
4. **Profile Slow Handlers**: Use execution order to identify bottlenecks
5. **Track Trends**: Monitor frame drop rate over time
6. **Optimize Incrementally**: Fix one handler at a time

---

## Troubleshooting

### No Stats Available

**Problem:** `getFrameStats()` returns empty or undefined

**Solution:**
- Ensure `window.renderLoop` exists
- Check that `rafManager` is initialized
- Verify handlers are registered

### Stats Not Updating

**Problem:** Frame count doesn't increase

**Solution:**
- Check if render loop is running
- Verify handlers are enabled
- Check for errors in handler execution

### Warnings Too Frequent

**Problem:** Console flooded with warnings

**Solution:**
- This indicates real performance issues
- Use warnings to identify slow handlers
- Optimize the handlers causing drops
- Consider throttling warning frequency (future enhancement)

---

## Related Documentation

- **[Performance Tips](performance.md)** - General performance optimization
- **[GPU Performance Guide](https://github.com/Amirashkan/glsl-node-editor/blob/main/GPU_PERFORMANCE_GUIDE.md)** - GPU-specific monitoring
- **[UnifiedRAFManager Source](https://github.com/Amirashkan/glsl-node-editor/blob/main/src/core/UnifiedRAFManager.js)** - Implementation details

---

_Use frame timing monitoring to achieve smooth 60 FPS performance!_

