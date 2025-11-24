# Performance Optimization Quick Reference

## Top 5 High-Impact Optimizations (Do These First)

### 1. ✅ Eliminate Unnecessary Canvas Redraws
**File**: `main.js` (handleRenderFrame), `src/core/Editor.js`
**Change**: Only call `editor.draw()` when `editor.isDirty()` is true
**Impact**: 20-30% FPS improvement
**Risk**: Low

### 2. ✅ Optimize Preview Computation Frequency  
**File**: `main.js` (handleRenderFrame), `src/core/PreviewComputer.js`
**Change**: Only compute previews when inputs change, throttle to 10 FPS max
**Impact**: 15-25% FPS improvement
**Risk**: Medium

### 3. ✅ Simplify Pan Update Logic
**File**: `src/core/EventHandler.js` (_setupPanEvents)
**Change**: Remove immediate updates, always use RAF batching
**Impact**: 10-15% FPS improvement
**Risk**: Low

### 4. ✅ Implement Shader Compilation Caching
**File**: `src/gpu/gpuRenderer.js`
**Change**: Cache compiled shader modules by source hash
**Impact**: 20-40% improvement during shader changes
**Risk**: Medium

### 5. ✅ Optimize Bind Group Updates
**File**: `src/gpu/gpuRenderer.js` (_updateComputeTextureBindings)
**Change**: Only rebuild bind groups when resources actually change
**Impact**: 5-10% FPS improvement
**Risk**: Low

---

## Performance Budget (Target Frame Time: 16.67ms)

| Component | Budget | Current (est.) | Target |
|-----------|--------|----------------|--------|
| Canvas Rendering | <5ms | 10-15ms | <5ms |
| GPU Rendering | <8ms | 8-12ms | <8ms |
| Preview Computation | <3ms | 5-10ms | <3ms |
| Other | <1ms | 2-5ms | <1ms |
| **Total** | **<16.67ms** | **25-42ms** | **<16.67ms** |

---

## Quick Wins (Can Implement in <1 Hour Each)

1. **Add dirty check in render loop** (`main.js`)
   ```javascript
   // Change from:
   if (editor?.draw) {
     editor.draw();
   }
   // To:
   if (editor?.draw && editor?.isDirty?.()) {
     editor.draw();
   }
   ```

2. **Throttle preview computation** (`main.js`)
   ```javascript
   // Only compute if time changed or parameters changed
   const now = performance.now();
   if ((now - lastPreviewUpdate) >= 100) { // 10 FPS max
     if (hasTimeBasedExpressions() || previewsDirty) {
       editor.previewComputer.computePreviews(editor.graph);
       lastPreviewUpdate = now;
     }
   }
   ```

3. **Remove immediate pan updates** (`src/core/EventHandler.js`)
   - Remove `shouldUseImmediate` logic
   - Always use RAF batching

---

## Testing Checklist

- [ ] Panning maintains 60 FPS
- [ ] Node dragging maintains 60 FPS  
- [ ] Parameter editing is responsive
- [ ] No visible stuttering
- [ ] Frame time consistently <16.67ms
- [ ] Performance dashboard shows improvements
- [ ] No regressions in functionality

---

## Performance Monitoring Commands

```javascript
// Show performance overlay
window.togglePreviewPerfOverlay();

// Show performance dashboard
window.performanceDashboard.show();

// Run benchmark
const results = await window.performanceBenchmark.runTest(testScenario);

// Get performance stats
const stats = window.performanceLogger.getStats();
console.log('FPS:', 1000 / stats.avgFrameTime);
```

---

## Common Performance Issues and Fixes

| Issue | Symptom | Fix |
|-------|---------|-----|
| Canvas redraws every frame | High CPU, low FPS when idle | Add dirty flag check |
| Preview computation every frame | High CPU, lag during editing | Throttle to 10 FPS, add dirty tracking |
| Shader recompilation | Frame drops on parameter change | Implement shader cache |
| Panning lag | Stuttering during pan | Simplify pan update logic, use RAF |
| Memory leaks | Increasing memory over time | Profile and fix object allocations |

---

## Files to Monitor

- `main.js` - Render loop (handleRenderFrame)
- `src/core/Editor.js` - Canvas rendering (draw method)
- `src/core/EventHandler.js` - Event handling (pan, drag)
- `src/core/PreviewComputer.js` - Preview computation
- `src/gpu/gpuRenderer.js` - GPU rendering
- `src/core/Renderer.js` - Canvas 2D rendering

---

## Performance Metrics to Track

1. **Frame Time** (target: <16.67ms)
   - Average
   - P95 (95th percentile)
   - P99 (99th percentile)

2. **FPS** (target: 60 FPS)
   - During panning
   - During dragging
   - During editing
   - When idle

3. **CPU Usage** (target: <50%)
   - Main thread
   - Worker threads

4. **Memory Usage** (target: <500MB)
   - Heap size
   - Texture memory

---

## Next Steps

1. Start with Phase 1 optimizations (highest impact)
2. Test each optimization individually
3. Use performance dashboard to verify improvements
4. Document any regressions
5. Iterate based on results

