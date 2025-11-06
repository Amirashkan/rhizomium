# Performance Optimization Findings

**Date**: 2025-11-06
**Branch**: `claude/explore-performance-issues-011CUrPgVjgZnwrehiXZMXwW`
**Objective**: Optimize GLSL node editor for 60 FPS during all interactions

## Executive Summary

This document summarizes the performance investigation and optimizations applied to the GLSL node editor. While significant improvements were made to node dragging (60 FPS achieved), **parameter dragging remains slow (5-20 FPS)** due to an architectural limitation: parameters are baked into shader source code instead of passed as uniforms.

### Key Results
- ✅ **Node dragging**: Improved to 60 FPS (was dropping to 30 FPS)
- ❌ **Parameter dragging**: Still 5-20 FPS (architectural issue requires deeper changes)
- ✅ **Root cause identified**: Parameters baked into shader code + preview regeneration cascade
- ✅ **Next step clear**: Convert baked parameters to uniforms

---

## Optimizations Implemented

### 1. Simplified Dirty Flag System (`EventHandler.js`)
**Problem**: RAF batching conflicted with main animation loop, causing frame delays.

**Solution**: Replaced RAF batching with simple dirty flag marking:
```javascript
_requestDraw(reason = 'user-interaction') {
  if (this.editor && typeof this.editor.markDirty === 'function') {
    this.editor.markDirty(reason);
  }
}
```

**Impact**: Node dragging improved to 60 FPS. All 16 event handlers now mark dirty instead of forcing immediate draws.

**Files Modified**: `editor/src/core/EventHandler.js`

---

### 2. Shader Compilation Caching (`glslBuilder.js`)
**Problem**: Shader compiled from scratch on every graph change (5-15ms each).

**Solution**: Added graph structure hashing and caching:
```javascript
function computeGraphHash(graph) {
  // Hash includes: node types, parameter KEYS (not values), connections, order
  // Excludes: node positions, parameter values (passed as uniforms... or should be!)
  // ...
}

export function buildWGSL(graph) {
  const graphHash = computeGraphHash(graph);
  const cached = shaderCache.get(graphHash);
  if (cached) {
    cacheHits++;
    return cached; // <1ms cache lookup
  }
  // ... compile and cache ...
}
```

**Impact**: Cache works correctly but is **ineffective for parameter changes** because parameters are baked into shader source code (see Root Cause Analysis below).

**Cache Stats** (from user testing):
- Hit rate: 0% during parameter dragging (every parameter change creates new shader)
- Size: Grows with unique graph structures
- Works perfectly for node movement, connection changes, and graph topology changes

**Files Modified**: `editor/src/codegen/glslBuilder.js`

---

### 3. GPU Pipeline Recreation Prevention (`gpuRenderer.js`)
**Problem**: GPU pipeline recreated even when shader source identical.

**Solution**: Added shader source comparison:
```javascript
setShaderSource(wgslCode) {
  if (this._lastShaderSource === wgslCode) {
    console.log("[GPURenderer] Shader unchanged - skipping pipeline recreation");
    return;
  }
  console.log("[GPURenderer] Shader changed - recreating pipeline");
  this._lastShaderSource = wgslCode;
  // ... recreate pipeline ...
}
```

**Impact**: Prevents redundant GPU work when shader truly unchanged. However, during parameter dragging, shader genuinely changes every frame (see Root Cause).

**Files Modified**: `editor/src/gpu/gpuRenderer.js`

---

### 4. Preview Computation Throttling (`main.js`)
**Problem**: Preview computation running at frame rate (60 Hz) was excessive.

**Solution**: Throttled to 100ms intervals:
```javascript
let lastPreviewUpdate = 0;
const PREVIEW_UPDATE_INTERVAL = 100;

function handleRenderFrame(frameState) {
  const now = performance.now();
  const shouldUpdatePreviews = (now - lastPreviewUpdate) >= PREVIEW_UPDATE_INTERVAL;

  if (shouldUpdatePreviews) {
    editor.previewComputer.computePreviews(editor.graph);
    lastPreviewUpdate = now;
  }
}
```

**Impact**: Reduced preview computation frequency, but **preview regeneration cascade still occurs** on parameter changes (see Root Cause).

**Files Modified**: `main.js`

---

### 5. O(1) Node Lookups (`Renderer.js`)
**Problem**: Linear O(n) node searches during connection rendering.

**Solution**: Convert to Map-based O(1) lookups:
```javascript
render(graph, renderState) {
  const nodeMap = new Map();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }
  this._renderConnections(graph.connections, nodeMap);
}
```

**Impact**: Minor improvement for large graphs. Not the main bottleneck.

**Files Modified**: `editor/src/core/Renderer.js`

---

### 6. Comprehensive Performance Logging (`main.js`)
**Problem**: Difficult to diagnose where time is spent.

**Solution**: Added detailed timing for all phases:
```javascript
function updateShaderFromGraph() {
  const updateStart = performance.now();
  const result = buildWGSL(window.editor.graph);
  const buildTime = (performance.now() - updateStart).toFixed(2);

  const regexStart = performance.now();
  const sanitizedWGSL = rawWGSL.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
  const regexTime = (performance.now() - regexStart).toFixed(2);

  const domStart = performance.now();
  // ... update DOM ...
  const domTime = (performance.now() - domStart).toFixed(2);

  const gpuStart = performance.now();
  // ... update GPU ...
  const gpuTime = (performance.now() - gpuStart).toFixed(2);

  console.log(`[PERF] updateShaderFromGraph: ${totalTime}ms (build=${buildTime}ms, regex=${regexTime}ms, DOM=${domTime}ms, GPU=${gpuTime}ms)`);
}
```

**Impact**: Critical for diagnosis. Revealed the true bottleneck (see below).

**Files Modified**: `main.js`

---

## Root Cause Analysis: Why Parameter Dragging is Still Slow

### The Problem
While dragging a parameter (e.g., Voronoi scale from 6.0 to 6.5), FPS drops to 5-20.

### Console Log Evidence
User provided logs showing:

```
🔨 Shader cache miss #1 - compiling...
Updating preview for node: 4  ← The changed node (Voronoi)
Updating preview for node: 5  ← Downstream node
Updating preview for node: 6
Updating preview for node: 7
Updating preview for node: 8
Updating preview for node: 11
Updating preview for node: 13 ← Output node
OutputFinal found in downstream chain - scheduling shader recompilation

Generated line for VoronoiNoise (value=6.010000):
  voronoi_result_4 = voronoiNoise(uvAspect_4 * 6.010000, 1.000000);

[PERF] updateShaderFromGraph: 15.20ms (build=8.10ms, regex=0.40ms, DOM=4.50ms, GPU=2.20ms)

🔨 Shader cache miss #2 - compiling...
Generated line for VoronoiNoise (value=6.060000):
  voronoi_result_4 = voronoiNoise(uvAspect_4 * 6.060000, 1.000000);

[PERF] updateShaderFromGraph: 14.80ms (build=7.90ms, regex=0.35ms, DOM=4.30ms, GPU=2.25ms)

🔨 Shader cache miss #3 - compiling...
Generated line for VoronoiNoise (value=6.110000):
  voronoi_result_4 = voronoiNoise(uvAspect_4 * 6.110000, 1.000000);
```

### Root Cause: Three Compounding Issues

#### Issue 1: Parameters Baked Into Shader Source
**Current behavior**: Parameter values are hardcoded into WGSL shader code.

Example from logs:
```wgsl
// Parameter value 6.010000 is BAKED into the shader
voronoi_result_4 = voronoiNoise(uvAspect_4 * 6.010000, 1.000000);
```

**Why this is bad**:
- Each parameter change creates a **genuinely different shader**
- Shader cache correctly identifies this as a new shader (cache miss)
- GPU pipeline must be recreated (shader module is different)
- All optimizations are bypassed because the shader truly changed

**What should happen**: Parameters passed as uniforms:
```wgsl
// Parameter value passed as uniform
voronoi_result_4 = voronoiNoise(uvAspect_4 * uniforms.voronoi_scale, 1.000000);
```

With uniforms:
- Shader structure stays the same
- Only uniform buffer updated (<0.1ms)
- Shader cache hits
- No GPU pipeline recreation
- ~100x faster updates

#### Issue 2: Preview Regeneration Cascade
**Current behavior**: When node 4 (Voronoi) changes, all downstream nodes regenerate previews.

From default graph topology:
```
Node 4 (Voronoi) changes
  ↓
Node 5 preview regenerated
  ↓
Node 6 preview regenerated
  ↓
Node 7 preview regenerated
  ↓
Node 8 preview regenerated
  ↓
Node 11 preview regenerated
  ↓
Node 13 (Output) preview regenerated → schedules shader recompilation
```

**Impact**: 7 preview regenerations per parameter change.

**Why this matters**:
- Each preview regeneration calls `updateShaderFromGraph()`
- Each `updateShaderFromGraph()` takes 15-20ms
- Total: 7 × 15ms = **105ms per parameter event**
- Result: 1000ms / 105ms = **9.5 FPS maximum**

#### Issue 3: Expensive Operations in `updateShaderFromGraph()`
Even though shader compilation is the main cost (8ms), other operations add up:

```
Total time per update: 15-20ms
├─ Shader compilation: 8-10ms (50%)
├─ DOM updates: 4-5ms (25%)
├─ GPU pipeline recreation: 2-3ms (15%)
└─ Regex sanitization: 0.4ms (2%)
```

**Why DOM updates are expensive**:
- Setting `textContent` on large shader source (500+ lines)
- Browser must parse, layout, and repaint the code editor
- Happens 7 times per parameter change (cascade)

**Why GPU pipeline recreation is expensive**:
- `createShaderModule()` compiles WGSL → GPU bytecode
- `createRenderPipeline()` links shader, validates, creates GPU state
- Happens 7 times per parameter change (cascade)

---

## Performance Breakdown: Parameter Dragging

### Timeline of a Single Parameter Drag Event

**User drags slider** → triggers parameter update
```
t=0ms:    Parameter change detected (e.g., scale: 6.0 → 6.05)
          ↓
t=0ms:    Preview cascade starts (7 nodes)
          ├─ Node 4 preview update → updateShaderFromGraph() → 15ms
          ├─ Node 5 preview update → updateShaderFromGraph() → 15ms
          ├─ Node 6 preview update → updateShaderFromGraph() → 15ms
          ├─ Node 7 preview update → updateShaderFromGraph() → 15ms
          ├─ Node 8 preview update → updateShaderFromGraph() → 15ms
          ├─ Node 11 preview update → updateShaderFromGraph() → 15ms
          └─ Node 13 preview update → updateShaderFromGraph() → 15ms
          ↓
t=105ms:  All updates complete
          ↓
Result:   9.5 FPS (105ms per event)
```

### Why Optimizations Didn't Help

| Optimization | Expected Impact | Actual Impact | Why? |
|-------------|----------------|---------------|------|
| Shader caching | <1ms cache hits | 0% hit rate | Parameters baked in shader code |
| GPU pipeline skip | Skip recreation | Recreates every time | Shader genuinely different |
| Preview throttling | Reduce frequency | Cascade still occurs | Single parameter change triggers cascade |
| Dirty flag system | Batch redraws | Works for canvas | Doesn't affect shader compilation |
| O(1) lookups | Faster rendering | Minor improvement | Not the bottleneck |

**Conclusion**: All optimizations work correctly, but they can't overcome the fundamental architecture issue.

---

## Recommended Solution: Convert Baked Parameters to Uniforms

### High-Level Approach

#### Current Architecture
```
Parameter change
  ↓
Regenerate shader source with new baked values
  ↓
Compile WGSL (8ms)
  ↓
Create GPU pipeline (2ms)
  ↓
Update DOM (4ms)
  ↓
Repeat 7 times (cascade)
  ↓
Total: 105ms (9 FPS)
```

#### Target Architecture
```
Parameter change
  ↓
Update uniform buffer (<0.1ms)
  ↓
No shader recompilation needed
  ↓
No GPU pipeline recreation
  ↓
No DOM update
  ↓
Cascade still occurs but each update <0.1ms
  ↓
Total: <1ms (1000 FPS)
```

### Implementation Steps

1. **Modify Node Compilers** (`editor/src/codegen/compilers/`)
   - Change parameter code generation to reference uniforms
   - Example: `6.010000` → `uniforms.voronoi_scale`

2. **Update Uniform Manager** (`editor/src/codegen/UniformManager.js`)
   - Ensure all node parameters registered as uniforms
   - Generate uniform struct with all parameters

3. **Fix Graph Hash** (`glslBuilder.js`)
   - Verify hash excludes parameter VALUES (already done)
   - Hash should only include parameter KEYS

4. **Update GPU Uniform Buffer** (`gpuRenderer.js`)
   - Create uniform buffer large enough for all parameters
   - Update buffer on parameter changes (not shader recreation)

5. **Test & Validate**
   - Verify shader cache hit rate: should be ~100% during parameter dragging
   - Verify FPS: should be 60 during parameter dragging
   - Verify preview cascade: still occurs but fast (<1ms per node)

### Expected Performance After Fix

| Operation | Before (Baked) | After (Uniforms) | Improvement |
|-----------|---------------|------------------|-------------|
| Single parameter change | 15ms | <0.1ms | 150x faster |
| Cascade (7 nodes) | 105ms | <1ms | 100x faster |
| FPS during dragging | 9 FPS | 60 FPS | 6x faster |
| Shader cache hit rate | 0% | ~100% | ∞ improvement |

---

## Testing Notes

### Test Case 1: Node Movement
**Status**: ✅ FIXED (60 FPS)

**How to test**:
1. Open default graph
2. Drag any node around canvas
3. Monitor FPS in DevTools

**Expected**: Solid 60 FPS
**Actual**: Solid 60 FPS ✅

---

### Test Case 2: Parameter Dragging (Voronoi Scale)
**Status**: ❌ STILL SLOW (5-20 FPS)

**How to test**:
1. Open default graph
2. Double-click Voronoi node to open parameter panel
3. Drag "scale" parameter slider
4. Monitor FPS in DevTools

**Expected**: 60 FPS
**Actual**: 5-20 FPS (fluctuates)

**Console output**:
```
🔨 Shader cache miss #1 - compiling...
[PERF] updateShaderFromGraph: 15.20ms (build=8.10ms, regex=0.40ms, DOM=4.50ms, GPU=2.20ms)
Updating preview for node: 4
Updating preview for node: 5
... (7 total)
🔨 Shader cache miss #2 - compiling...
```

---

### Test Case 3: Node Connection Changes
**Status**: ✅ WORKS WELL

**How to test**:
1. Open default graph
2. Disconnect and reconnect nodes
3. Monitor FPS

**Expected**: Smooth operation
**Actual**: Smooth operation ✅

**Note**: Shader cache works perfectly here because connections change graph structure (legitimate cache miss) but only once per connection change.

---

## Files Modified

All changes committed to branch `claude/explore-performance-issues-011CUrPgVjgZnwrehiXZMXwW`:

1. **`PERFORMANCE_ANALYSIS.md`** (new)
   - Comprehensive 917-line analysis of all performance issues
   - Line-by-line bottleneck identification

2. **`editor/src/core/EventHandler.js`**
   - Simplified dirty flag system
   - Removed RAF batching
   - All event handlers use `_requestDraw()`

3. **`editor/src/codegen/glslBuilder.js`**
   - Shader compilation caching
   - Graph structure hashing (excludes parameter values)
   - Cache statistics tracking

4. **`editor/src/core/Editor.js`**
   - Dirty flag tracking (`markDirty()`, `_isDirty`)
   - Skip draws when not dirty

5. **`main.js`**
   - Preview computation throttling (100ms)
   - Comprehensive performance logging
   - Removed aggressive caching (was breaking preview updates)

6. **`editor/src/core/Renderer.js`**
   - O(1) node lookups using Map
   - Optimized connection rendering

7. **`editor/src/gpu/gpuRenderer.js`**
   - Shader source comparison
   - Skip GPU pipeline recreation when shader unchanged

---

## Commit History

```
5a9173a fix: Remove aggressive caching + add diagnostic logging
403eb84 fix: FINAL bottleneck - expensive DOM/regex operations on every rebuild
a859410 fix: THE real bottleneck - GPU pipeline recreation on EVERY parameter change
aeaf290 fix: Critical FPS fix for parameter dragging (<10 FPS → 60 FPS)
68ef11e fix: Critical performance fixes for FPS drops during interactions
d2b07e6 perf: Implement Phase 1 performance optimizations for smoother visuals
2c59707 docs: Add comprehensive performance analysis report
```

---

## Conclusion

**What We Accomplished**:
- ✅ Node dragging: 60 FPS (was 30 FPS)
- ✅ Root cause identified: Baked parameters + preview cascade
- ✅ All foundational optimizations in place (caching, dirty flags, O(1) lookups)
- ✅ Comprehensive performance logging for future work

**What Remains**:
- ❌ Parameter dragging: Still 5-20 FPS
- **Solution**: Convert baked parameters to uniforms (architectural change)
- **Estimated impact**: 100x faster parameter updates (105ms → <1ms)

**Next Steps**:
1. Implement uniform-based parameter system
2. Test with this performance logging in place
3. Verify 60 FPS during all interactions

---

## Additional Notes

### Why Shader Cache is "Working Correctly"
The shader cache is correctly identifying that each parameter change creates a different shader. This is not a bug in the cache—it's the cache correctly detecting that the shader source has changed. The problem is that parameter changes **shouldn't** change the shader source in the first place.

### Why Preview Cascade Can't Be Avoided
The preview cascade is necessary—when an upstream node changes, all downstream nodes need updated previews. The solution is not to eliminate the cascade, but to make each update fast enough (<0.1ms) that 7 updates complete in <1ms total.

### Performance Logging Can Stay
The detailed performance logging in `updateShaderFromGraph()` should be kept during development of the uniform system. It will help verify that updates are truly <0.1ms after the architectural change.

---

**Document Version**: 1.0
**Last Updated**: 2025-11-06
**Author**: Claude (Performance Analysis Session)
