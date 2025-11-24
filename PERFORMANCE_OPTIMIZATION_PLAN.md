# Multi-Step Performance Optimization Plan

## Executive Summary

This document outlines a comprehensive, prioritized optimization plan to eliminate FPS drops and lag in the GLSL Node Editor. The plan is organized into phases, with each phase building on the previous one.

**Current State:**
- Performance monitoring infrastructure exists (PreviewPerfMonitor, PerformanceLogger, PerformanceDashboard)
- Some optimizations already in place (dirty flags, RAF batching, throttling)
- Thread separation infrastructure exists but needs better integration
- Known bottlenecks: excessive redraws, unnecessary preview computation, unoptimized shader compilation

**Target Goals:**
- Maintain 60 FPS during all interactions (panning, dragging, editing)
- Reduce frame time from current ~20-30ms to <16.67ms (60 FPS target)
- Eliminate visible stuttering and lag spikes
- Reduce CPU usage by 30-40%

---

## Phase 1: Critical Rendering Optimizations (High Impact, Low Risk)

### 1.1 Eliminate Unnecessary Canvas Redraws
**Priority: CRITICAL** | **Estimated Impact: 20-30% FPS improvement**

**Current Issue:**
- Canvas is redrawn every frame even when static
- `editor.draw()` called unconditionally in render loop
- Dirty flag system exists but not fully utilized

**Implementation:**
1. **Enforce dirty flag checking in render loop** (`main.js:3950+`)
   - Only call `editor.draw()` when `editor.isDirty()` returns true
   - Remove unconditional `editor.draw()` calls

2. **Improve dirty flag granularity** (`src/core/Editor.js`)
   - Track dirty regions (viewport, nodes, connections separately)
   - Only redraw changed regions when possible
   - Add dirty reason tracking for debugging

3. **Optimize static scene detection**
   - Track last change timestamp
   - Skip redraws if no changes for >100ms and no animations

**Files to Modify:**
- `main.js` (handleRenderFrame function)
- `src/core/Editor.js` (draw method, dirty flag system)
- `editor/src/core/Editor.js` (if different)

**Success Metrics:**
- Canvas redraws reduced from 60/sec to <10/sec when idle
- Frame time reduced by 5-10ms when static

---

### 1.2 Optimize Preview Computation Frequency
**Priority: CRITICAL** | **Estimated Impact: 15-25% FPS improvement**

**Current Issue:**
- `computePreviews()` called every frame (60 FPS)
- No dirty tracking for preview values
- Recomputes entire graph even when inputs unchanged

**Implementation:**
1. **Add preview dirty tracking** (`src/core/PreviewComputer.js`)
   - Track which nodes have changed inputs
   - Only recompute affected nodes and their dependents
   - Cache computed values until inputs change

2. **Throttle preview updates** (`main.js:3950+`)
   - Only compute previews when:
     - Time-based expressions exist AND time changed
     - Parameter values changed
     - Graph structure changed
   - Use 10 FPS max for preview updates (100ms interval)

3. **Implement incremental preview updates**
   - Batch multiple parameter changes
   - Update previews once per frame maximum
   - Use topological sort cache (already exists, ensure it's used)

**Files to Modify:**
- `main.js` (handleRenderFrame function)
- `src/core/PreviewComputer.js` (add dirty tracking)
- `src/core/preview/NodeValueComputer.js` (add caching)

**Success Metrics:**
- Preview computation reduced from 60/sec to <10/sec
- Preview computation time reduced by 50%+ through caching

---

### 1.3 Optimize Event Handler Draw Requests
**Priority: HIGH** | **Estimated Impact: 10-15% FPS improvement**

**Current Issue:**
- Some immediate updates bypass RAF batching
- Pan updates have complex immediate/RAF logic that may cause double renders
- Multiple draw requests can accumulate

**Implementation:**
1. **Simplify pan update logic** (`src/core/EventHandler.js:450-500`)
   - Remove immediate update logic (causes double renders)
   - Always use RAF batching for consistency
   - Ensure only one RAF scheduled at a time

2. **Add draw request deduplication**
   - Track pending draw request
   - Ignore duplicate requests within same frame
   - Batch all state changes, render once

3. **Optimize interaction detection**
   - Reduce overhead of interaction state checks
   - Cache interaction state per frame
   - Use event-driven updates instead of polling

**Files to Modify:**
- `src/core/EventHandler.js` (_setupPanEvents, _requestDraw)
- `editor/src/core/EventHandler.js` (if different)

**Success Metrics:**
- Draw requests reduced by 50% during interactions
- Eliminate double renders during panning

---

## Phase 2: GPU and Shader Optimizations (High Impact, Medium Risk)

### 2.1 Implement Shader Compilation Caching
**Priority: HIGH** | **Estimated Impact: 20-40% improvement during shader changes**

**Current Issue:**
- Shaders recompiled on every graph change
- No caching of compiled shader modules
- Full recompilation even for minor changes

**Implementation:**
1. **Add shader module cache** (`src/gpu/gpuRenderer.js`)
   - Cache compiled shader modules by source hash
   - Reuse modules when source unchanged
   - Invalidate cache only when shader code changes

2. **Optimize shader compilation pipeline**
   - Compile shaders asynchronously when possible
   - Use incremental compilation (compile changed nodes only)
   - Batch multiple shader compilations

3. **Add shader compilation throttling**
   - Debounce rapid shader changes
   - Queue compilation requests
   - Prioritize visible/active shaders

**Files to Modify:**
- `src/gpu/gpuRenderer.js` (compilation logic)
- `src/gpu/ComputeExecutor.js` (if handles compilation)

**Success Metrics:**
- Shader compilation time reduced by 60-80% for unchanged shaders
- Eliminate compilation-related frame drops

---

### 2.2 Optimize GPU Render Pipeline
**Priority: MEDIUM** | **Estimated Impact: 5-10% FPS improvement**

**Current Issue:**
- GPU rendering happens every frame
- Some unnecessary GPU work during interactions
- Bind group rebuilds on every frame

**Implementation:**
1. **Optimize bind group updates** (`src/gpu/gpuRenderer.js:806-884`)
   - Only rebuild bind groups when resources actually change
   - Cache bind groups by resource hash
   - Reuse bind groups across frames when possible

2. **Implement GPU work batching**
   - Batch multiple compute dispatches
   - Reduce GPU command buffer overhead
   - Use GPU timestamps for better profiling

3. **Add GPU frame skipping during heavy interactions**
   - Skip GPU work during rapid panning (already partially implemented)
   - Use lower quality during interactions
   - Resume full quality after interaction ends

**Files to Modify:**
- `src/gpu/gpuRenderer.js` (render, bind group updates)
- `main.js` (GPU render throttling)

**Success Metrics:**
- GPU frame time reduced by 10-20%
- Eliminate GPU-related frame drops during interactions

---

## Phase 3: Advanced Optimizations (Medium Impact, Higher Risk)

### 3.1 Implement Viewport Culling
**Priority: MEDIUM** | **Estimated Impact: 10-20% improvement with many nodes**

**Current Issue:**
- All nodes rendered even when off-screen
- Connections drawn for invisible nodes
- No spatial optimization

**Implementation:**
1. **Add viewport culling** (`src/core/Renderer.js`)
   - Only render nodes within viewport + margin
   - Skip connections between off-screen nodes
   - Use spatial index (quadtree/grid) for fast culling

2. **Optimize grid rendering**
   - Only draw grid lines within viewport
   - Cache grid calculations
   - Use lower detail grid when zoomed out

3. **Implement level-of-detail (LOD)**
   - Simplified rendering for off-screen nodes
   - Full detail only for visible nodes
   - Progressive detail loading

**Files to Modify:**
- `src/core/Renderer.js` (render method)
- `editor/src/core/Renderer.js` (if different)

**Success Metrics:**
- Render time scales linearly with visible nodes (not total nodes)
- 50%+ improvement with 100+ nodes

---

### 3.2 Optimize Topological Sort and Graph Processing
**Priority: MEDIUM** | **Estimated Impact: 5-10% improvement with complex graphs**

**Current Issue:**
- Topological sort runs frequently
- Graph processing happens every frame
- No incremental updates

**Implementation:**
1. **Improve topological sort cache** (`src/core/PreviewComputer.js`)
   - Cache is already implemented, ensure it's working correctly
   - Invalidate cache only on structure changes
   - Use incremental topological sort when possible

2. **Optimize graph traversal**
   - Cache node dependencies
   - Use memoization for expensive calculations
   - Batch graph updates

3. **Implement incremental graph processing**
   - Only process changed subgraphs
   - Track dirty nodes and propagate changes
   - Skip processing for unchanged subgraphs

**Files to Modify:**
- `src/core/PreviewComputer.js` (graph processing)
- `src/core/preview/NodeValueComputer.js` (computation)

**Success Metrics:**
- Graph processing time reduced by 30-50%
- Scales better with graph complexity

---

### 3.3 Enhance Thread Separation Integration
**Priority: LOW-MEDIUM** | **Estimated Impact: 10-20% CPU reduction**

**Current Issue:**
- Thread separation infrastructure exists but underutilized
- Some work still on main thread that could be offloaded
- Worker communication overhead not optimized

**Implementation:**
1. **Optimize worker communication** (`src/core/AsyncQueueManager.js`)
   - Batch multiple messages
   - Reduce message overhead
   - Use shared memory where possible (SharedArrayBuffer)

2. **Move more work to workers**
   - Preview computation (already implemented, ensure it's used)
   - Expression evaluation (already implemented, optimize)
   - Graph processing for large graphs

3. **Implement worker result caching**
   - Cache worker computation results
   - Reuse results when inputs unchanged
   - Invalidate cache appropriately

**Files to Modify:**
- `src/core/AsyncQueueManager.js` (message batching)
- `src/core/PreviewComputer.js` (ensure worker usage)
- `src/utils/ParameterExpressionSystem.js` (optimize worker usage)

**Success Metrics:**
- Main thread CPU usage reduced by 20-30%
- Worker utilization increased

---

## Phase 4: Memory and Garbage Collection Optimizations (Low Impact, Low Risk)

### 4.1 Reduce Object Allocations
**Priority: LOW** | **Estimated Impact: 5-10% improvement, smoother frame times**

**Implementation:**
1. **Object pooling for frequently allocated objects**
   - Reuse vector/point objects
   - Pool event objects
   - Reuse calculation result objects

2. **Reduce array allocations**
   - Pre-allocate arrays where size is known
   - Reuse arrays instead of creating new ones
   - Use typed arrays where appropriate

3. **Optimize string operations**
   - Cache frequently used strings
   - Avoid string concatenation in hot paths
   - Use template literals efficiently

**Files to Modify:**
- `src/core/Renderer.js` (rendering objects)
- `src/core/EventHandler.js` (event objects)
- Various computation files

**Success Metrics:**
- GC pauses reduced by 50%+
- More consistent frame times

---

### 4.2 Optimize Memory Usage
**Priority: LOW** | **Estimated Impact: Better performance on low-memory devices**

**Implementation:**
1. **Implement texture memory management**
   - Release unused textures
   - Use texture atlases
   - Compress textures where possible

2. **Optimize data structures**
   - Use Maps/Sets efficiently
   - Avoid deep object copies
   - Use weak references where appropriate

3. **Add memory profiling**
   - Track memory usage
   - Identify memory leaks
   - Optimize hot paths

**Files to Modify:**
- `src/gpu/gpuRenderer.js` (texture management)
- Various files (data structures)

**Success Metrics:**
- Memory usage reduced by 20-30%
- No memory leaks

---

## Implementation Priority and Timeline

### Week 1: Phase 1 (Critical Rendering Optimizations)
- **Day 1-2**: 1.1 Eliminate Unnecessary Canvas Redraws
- **Day 3-4**: 1.2 Optimize Preview Computation Frequency
- **Day 5**: 1.3 Optimize Event Handler Draw Requests
- **Day 6-7**: Testing and validation

**Expected Result**: 30-50% FPS improvement, elimination of most visible lag

### Week 2: Phase 2 (GPU and Shader Optimizations)
- **Day 1-3**: 2.1 Implement Shader Compilation Caching
- **Day 4-5**: 2.2 Optimize GPU Render Pipeline
- **Day 6-7**: Testing and validation

**Expected Result**: Smooth shader compilation, better GPU utilization

### Week 3: Phase 3 (Advanced Optimizations)
- **Day 1-2**: 3.1 Implement Viewport Culling
- **Day 3-4**: 3.2 Optimize Topological Sort and Graph Processing
- **Day 5**: 3.3 Enhance Thread Separation Integration
- **Day 6-7**: Testing and validation

**Expected Result**: Better scaling with complex graphs, lower CPU usage

### Week 4: Phase 4 (Memory Optimizations) + Polish
- **Day 1-3**: 4.1 Reduce Object Allocations
- **Day 4-5**: 4.2 Optimize Memory Usage
- **Day 6-7**: Final testing, profiling, documentation

**Expected Result**: Smoother performance, better memory efficiency

---

## Testing and Validation Strategy

### Performance Benchmarks
1. **Frame Time Metrics**
   - Average frame time (target: <16.67ms)
   - P95 frame time (target: <20ms)
   - P99 frame time (target: <25ms)
   - Frame time variance (target: <5ms)

2. **Interaction Performance**
   - Panning FPS (target: 60 FPS)
   - Dragging FPS (target: 60 FPS)
   - Parameter editing responsiveness (target: <50ms latency)

3. **Resource Usage**
   - CPU usage (target: <50% on mid-range hardware)
   - Memory usage (target: <500MB for typical graphs)
   - GPU usage (target: efficient utilization)

### Test Scenarios
1. **Simple Graph** (<10 nodes)
   - Baseline performance
   - Should maintain 60 FPS easily

2. **Medium Graph** (50-100 nodes)
   - Real-world usage
   - Target: 60 FPS with optimizations

3. **Complex Graph** (200+ nodes)
   - Stress test
   - Target: 30+ FPS minimum

4. **Interaction Scenarios**
   - Rapid panning
   - Node dragging
   - Parameter editing
   - Shader compilation

### Tools
- Use existing `PerformanceDashboard` for real-time monitoring
- Use `PerformanceBenchmark` for automated testing
- Use browser DevTools Performance profiler
- Use `PreviewPerfMonitor` overlay for development

---

## Risk Assessment and Mitigation

### High Risk Items
1. **Shader Compilation Caching** (Phase 2.1)
   - Risk: Cache invalidation bugs, stale shaders
   - Mitigation: Comprehensive testing, clear cache on errors, version shader cache

2. **Viewport Culling** (Phase 3.1)
   - Risk: Missing visible nodes, incorrect culling
   - Mitigation: Conservative culling margins, extensive visual testing

### Medium Risk Items
1. **Preview Computation Optimization** (Phase 1.2)
   - Risk: Stale preview values, incorrect dirty tracking
   - Mitigation: Careful dependency tracking, fallback to full recompute

2. **Event Handler Changes** (Phase 1.3)
   - Risk: Input lag, missed interactions
   - Mitigation: Preserve immediate updates for critical interactions, extensive UX testing

### Low Risk Items
1. **Canvas Redraw Optimization** (Phase 1.1)
   - Risk: Missing updates, stale UI
   - Mitigation: Conservative dirty flag usage, easy to revert

2. **Memory Optimizations** (Phase 4)
   - Risk: Memory leaks, incorrect pooling
   - Mitigation: Careful testing, memory profiling

---

## Success Criteria

### Must Have (Phase 1)
- ✅ 60 FPS maintained during panning
- ✅ 60 FPS maintained during node dragging
- ✅ No visible stuttering or lag
- ✅ Frame time consistently <16.67ms

### Should Have (Phase 2)
- ✅ Smooth shader compilation (no frame drops)
- ✅ Efficient GPU utilization
- ✅ Preview updates feel responsive

### Nice to Have (Phase 3-4)
- ✅ Scales well with 200+ nodes
- ✅ Low memory usage
- ✅ Smooth performance on low-end hardware

---

## Monitoring and Iteration

### Continuous Monitoring
- Use `PerformanceDashboard` during development
- Monitor frame times in real-time
- Track performance regressions

### Iteration Process
1. Implement optimization
2. Test with performance benchmarks
3. Profile to verify improvements
4. Fix any regressions
5. Document changes

### Performance Budget
- **Frame Budget**: 16.67ms per frame (60 FPS)
  - Canvas rendering: <5ms
  - GPU rendering: <8ms
  - Preview computation: <3ms
  - Other: <1ms

---

## Notes

- Start with Phase 1 optimizations for maximum impact
- Test each phase before moving to next
- Use feature flags to enable/disable optimizations for A/B testing
- Document all changes for future reference
- Keep performance monitoring enabled during development

