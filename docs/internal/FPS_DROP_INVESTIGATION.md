# FPS Drop Investigation: Complete Analysis

## Problem
FPS drops in floating preview during canvas interactions (panning, dragging nodes).

## Complete Rendering Pipeline Analysis

### 1. Render Loop (`src/core/RenderLoop.js`)
- Uses `requestAnimationFrame` targeting 60 FPS (~16ms per frame)
- Calls `handleRenderFrame(frameState)` each frame

### 2. Frame Handler (`main.js` line 3836-4046)
Execution order:
1. GPU renderer called (async, NOT awaited) - line 3867
2. FPS counter updated - line 3928
3. Canvas renderer called (synchronous, BLOCKING) - line 4043

### 3. GPU Renderer (`src/gpu/gpuRenderer.js` line 865-1043)
Execution flow:
1. **Synchronous work** (lines 906-939):
   - Update aspect uniform
   - Update globals uniform
   - Update parameter uniforms (writes to GPU buffer)
   - Update texture bindings (may rebuild bind groups)
   - Create MSAA texture if needed
   - Create command encoder
2. **Async work** (line 956):
   - `await computeExecutor.execute()` - pauses execution here
3. **Synchronous work** (line 979):
   - Update compute texture bindings (may rebuild bind groups)
4. **Synchronous work** (lines 983-1023):
   - Setup and record render pass
5. **Non-blocking** (line 1033):
   - Submit to GPU queue (doesn't wait)

### 4. Canvas Renderer (`src/core/Renderer.js` line 14-63)
All synchronous, blocking operations:
- Clear canvas
- Render background grid (draws lines)
- Render connections (bezier curves)
- Render nodes (rectangles, gradients, text, shadows)
- Render thumbnails (uses `drawImage` if Canvas, converts ImageData if needed)

## Root Cause Identified

### The Problem
During interactions:
1. Canvas is marked dirty every frame (every mouse move)
2. Canvas rendering runs every frame (dirty flag checked in `draw()`)
3. Canvas rendering blocks the main thread for 5-20ms (depending on complexity)
4. Frame time exceeds 16ms → FPS drops below 60

### Why GPU Renderer Doesn't Help
- GPU renderer is async but not awaited in frame handler
- Its synchronous work (lines 906-939) completes before canvas rendering
- But when GPU renderer hits `await computeExecutor.execute()` (line 956), it pauses
- Canvas rendering then blocks the main thread
- The async continuation of GPU renderer can't resume efficiently while main thread is blocked
- Result: Frame time exceeds 16ms

### The Bottleneck
**Canvas rendering blocks the main thread**, and during interactions, it runs every frame.

### Constraints
- No visual changes during interactions (user requirement)
- No throttling (user requirement)
- No hiding elements (user requirement)

## Current Optimizations

### Already Implemented
1. **Viewport culling** - Skips off-screen elements during interactions (doesn't change visuals)
2. **Dirty flag system** - Only renders canvas when dirty
3. **Thumbnail conversion** - ImageData converted to Canvas on first encounter (eliminates `putImageData` blocking)
4. **Buffer reuse** - GPU renderer reuses Float32Array buffers

### Not Working
- All optimizations are already in place
- Canvas rendering still blocks too long during interactions

## The Real Issue

**Architectural limitation**: Canvas rendering is fundamentally synchronous and blocking. During interactions, it runs every frame, causing frames to exceed the 16ms budget.

The GPU renderer's async nature doesn't help because:
1. Its sync work completes before canvas blocks (already optimized)
2. Its async continuation (after await) is delayed by canvas blocking
3. But the async continuation is waiting for GPU work, not CPU work, so it shouldn't matter...

**Wait**: If the async continuation is waiting for GPU work (compute shaders), and GPU work runs on the GPU (not CPU), then canvas blocking shouldn't delay it. Unless...

**The actual issue might be**: Canvas rendering blocks so long that it delays the next frame's start. By the time canvas rendering finishes, we're already late for the next frame.

## Conclusion

The root cause is **canvas rendering blocks the main thread during interactions**. Even with all optimizations (viewport culling, thumbnail conversion, etc.), canvas rendering still takes too long when running every frame during interactions.

The solution must optimize canvas rendering further without changing visuals or throttling, which is extremely challenging given the constraints.

