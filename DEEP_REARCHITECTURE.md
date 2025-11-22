# Deep Re-Architecture: FPS Drop During Canvas Interactions

## Problem Statement

During canvas interactions (panning, dragging nodes), the FPS in the floating preview drops significantly. The requirement is: **no visual changes are acceptable during interactions** (no throttling, no hiding elements, no quality reduction).

## Root Cause Analysis

### The Fundamental Issue

JavaScript is **single-threaded**. Both GPU rendering and Canvas 2D rendering run on the main thread. When Canvas 2D rendering blocks for 5-20ms during interactions, it prevents GPU work from progressing, causing frames to exceed the 16ms budget (60 FPS).

### Current Execution Flow

```
Frame Start (requestAnimationFrame)
├─ GPU Renderer.render() [async, not awaited]
│  ├─ Sync work: uniforms, bind groups (~1-2ms) ✓
│  ├─ await computeExecutor.execute() [BLOCKS HERE]
│  │  ├─ Fragment input rendering
│  │  └─ Compute node execution
│  └─ Fragment shader render pass
│
└─ Canvas Renderer.draw() [SYNCHRONOUS, BLOCKING]
   ├─ Grid rendering (~1-3ms)
   ├─ Connection rendering (~2-5ms)
   ├─ Node rendering (~5-15ms)
   │  ├─ Gradients (createLinearGradient per node)
   │  ├─ Shadows (shadowBlur per pin/node)
   │  ├─ Bezier curves
   │  └─ Text rendering
   └─ Total: 8-23ms [EXCEEDS 16ms BUDGET]
```

### Why Previous Attempts Failed

1. **Yield Points (`await Promise.resolve()`)** - Don't help because Canvas 2D operations are inherently blocking. Yielding only helps if the work itself can be split, but `fillRect()`, `stroke()`, `drawImage()` are atomic blocking operations.

2. **Throttling/Deferring** - Violates the "no visual changes" requirement.

3. **Viewport Culling** - Already implemented, helps but doesn't solve the fundamental blocking issue.

4. **Grid Caching** - Helps reduce grid rendering time, but node rendering is still the main bottleneck.

## Real Solutions (Architectural Changes Required)

### Option 1: WebGPU-Based UI Rendering (RECOMMENDED)

**Replace Canvas 2D with WebGPU for UI rendering.**

**Why WebGPU, not WebGL?**
- WebGPU is the modern successor to WebGL
- Better performance and lower overhead
- More efficient command buffer system
- Better suited for modern GPUs
- Already using WebGPU for shader rendering, so consistent API

**Pros:**
- WebGL rendering is non-blocking (GPU-based)
- Can render thousands of nodes efficiently
- Maintains all visual elements (gradients, shadows, etc.)
- No visual changes required

**Cons:**
- Significant refactoring required
- Need to implement 2D rendering primitives in WebGL
- Text rendering more complex

**Implementation:**
- Create `WebGLUIRenderer` class
- Implement 2D primitives (rectangles, circles, lines, bezier curves)
- Implement text rendering using texture atlases
- Implement gradient and shadow effects using shaders
- Port existing `Renderer.js` logic to WebGL

**Estimated Impact:** 90% reduction in blocking time (from 10-20ms to 1-2ms)

---

### Option 2: Layered Canvas Architecture

**Use multiple canvas layers with different update frequencies.**

**Pros:**
- Static elements (grid, connections) on separate canvas, updated less frequently
- Interactive elements (nodes, selection) on separate canvas, updated every frame
- Reduces work per frame

**Cons:**
- Still uses Canvas 2D (blocking)
- Complex layer management
- May cause visual artifacts if layers desync

**Implementation:**
- Create 3 canvas layers:
  1. Background layer (grid) - updates only on pan/zoom
  2. Connection layer - updates only when connections change
  3. Node layer - updates every frame
- Composite layers using CSS or single canvas

**Estimated Impact:** 40-50% reduction in blocking time (from 10-20ms to 5-10ms)

---

### Option 3: CSS Transforms for Node Positioning

**Use DOM elements for nodes, CSS transforms for positioning.**

**Pros:**
- CSS transforms are GPU-accelerated
- Non-blocking positioning
- Can use CSS for gradients, shadows

**Cons:**
- Major architectural change
- Connections still need canvas
- Performance issues with many DOM elements
- Complex event handling

**Implementation:**
- Convert nodes to DOM elements
- Use CSS transforms for positioning
- Keep connections on canvas
- Use CSS filters for effects

**Estimated Impact:** 60-70% reduction in blocking time, but introduces new complexity

---

### Option 4: OffscreenCanvas + Web Workers (REJECTED)

**User explicitly rejected this approach.**

---

### Option 5: Dirty Region Rendering

**Only re-render changed regions of the canvas.**

**Pros:**
- Reduces work per frame
- Maintains all visual elements

**Cons:**
- Complex implementation
- Still uses Canvas 2D (blocking)
- Difficult to track dirty regions accurately

**Implementation:**
- Track which regions changed
- Only clear and redraw those regions
- Composite with previous frame

**Estimated Impact:** 30-40% reduction in blocking time (from 10-20ms to 6-12ms)

---

### Option 6: Hybrid Approach: Critical Path Optimization

**Optimize the critical path without changing architecture.**

**Pros:**
- Minimal changes
- Maintains current architecture

**Cons:**
- Limited impact
- Still fundamentally blocked by Canvas 2D

**Implementation:**
- Pre-compute and cache expensive operations:
  - Cache gradient objects (reuse per node type)
  - Pre-render node backgrounds to textures
  - Cache bezier curve paths
  - Use `drawImage()` instead of redrawing
- Reduce shadow operations (combine multiple shadows)
- Use `Path2D` objects for repeated shapes

**Estimated Impact:** 20-30% reduction in blocking time (from 10-20ms to 7-14ms)

---

## Recommended Solution: WebGL-Based UI Rendering

### Why WebGL?

1. **Non-blocking**: WebGL rendering happens on GPU, doesn't block main thread
2. **Performance**: Can render thousands of elements efficiently
3. **Visual Fidelity**: Can implement all current visual effects (gradients, shadows, etc.)
4. **Future-proof**: Better foundation for complex UIs

### Implementation Plan

#### Phase 1: WebGL Renderer Foundation
1. Create `WebGLUIRenderer` class
2. Implement basic 2D primitives:
   - Rectangles with rounded corners
   - Circles/arcs
   - Lines and bezier curves
   - Text rendering (using texture atlases)

#### Phase 2: Visual Effects
1. Implement gradients (using shaders)
2. Implement shadows (using shaders)
3. Implement transparency and blending

#### Phase 3: Port Existing Logic
1. Port grid rendering
2. Port connection rendering
3. Port node rendering
4. Port selection and interaction rendering

#### Phase 4: Optimization
1. Batch rendering operations
2. Use instancing for repeated elements
3. Implement efficient text rendering

### Code Structure

```
src/core/
├── Renderer.js (current Canvas 2D - keep for fallback)
├── WebGLUIRenderer.js (new WebGL-based renderer)
├── UIRenderer.js (abstraction layer, switches between Canvas/WebGL)
└── primitives/
    ├── Rectangle.js
    ├── Circle.js
    ├── BezierCurve.js
    └── Text.js
```

### Migration Strategy

1. Implement WebGL renderer alongside existing Canvas renderer
2. Add feature flag to switch between renderers
3. Test thoroughly
4. Switch default to WebGL
5. Keep Canvas renderer as fallback for older browsers

---

## Alternative: Accept the Limitation

If architectural changes are not feasible, the only option is to **accept that Canvas 2D rendering will block during interactions**. The FPS drop is a fundamental limitation of Canvas 2D in a single-threaded environment.

**Mitigation strategies (without solving the root cause):**
- Optimize Canvas 2D operations (caching, batching)
- Reduce number of nodes/connections
- Accept lower FPS during interactions
- Use lower resolution during interactions (violates requirement)

---

## Conclusion

The FPS drop during canvas interactions is a **fundamental architectural limitation** of using Canvas 2D in a single-threaded JavaScript environment. The only real solution is to **move UI rendering to WebGL**, which is GPU-accelerated and non-blocking.

All other approaches (throttling, deferring, yield points) are workarounds that either:
1. Violate the "no visual changes" requirement
2. Don't solve the fundamental blocking issue
3. Provide minimal improvement

**Recommended Action:** Implement WebGL-based UI rendering for a long-term solution.

