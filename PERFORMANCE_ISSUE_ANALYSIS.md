# Performance Issue Analysis: FPS Drop During Canvas Interactions

## Problem Statement

When interacting with the canvas (dragging nodes, panning), the GPU renderer's FPS drops below 40 FPS in the floating preview. This happens even with moderately complex graphs, not just graphs with many nodes.

## Attempted Fixes (All Failed)

### 1. Canvas Context Optimizations
- **Attempted**: Added `desynchronized: true` and `willReadFrequently: false` to canvas context
- **Result**: No improvement
- **Why Failed**: `desynchronized` is not widely supported; even if supported, doesn't solve the blocking issue

### 2. Deferral Strategies
- **Attempted**: Used `queueMicrotask`, `setTimeout(0)`, `requestIdleCallback`, `requestAnimationFrame` to defer canvas rendering
- **Result**: Made performance worse or caused visual lag
- **Why Failed**: Deferring canvas rendering doesn't eliminate the blocking - it just moves it to a different time. The GPU renderer still gets blocked.

### 3. putImageData Optimization
- **Attempted**: Cached temporary canvases per node; tried to skip `putImageData` calls when ImageData hasn't changed
- **Result**: No improvement
- **Why Failed**: 
  - `putImageData` is synchronous and blocking regardless of caching
  - ImageData objects are likely being recreated with new buffers every frame
  - Even if cached, the `putImageData` call itself blocks the main thread

### 4. Canvas-to-Canvas Conversion During Rendering
- **Attempted**: Convert ImageData to Canvas on first encounter during rendering
- **Result**: No improvement
- **Why Failed**: The conversion still happens during rendering (blocking), just less frequently

## Root Cause Analysis

The fundamental problem is that **Canvas 2D rendering is CPU-bound and blocks the main thread**. When canvas rendering happens during interactions:

1. Canvas rendering blocks the main thread with synchronous operations:
   - `putImageData()` for ImageData thumbnails (synchronous, blocking)
   - Canvas draw operations (fillRect, stroke, drawImage, etc.)
   - Text measurement (`measureText`)
   - Grid background calculations

2. The GPU renderer needs CPU time for:
   - Synchronous setup work (updating uniforms, creating command encoders)
   - Processing async GPU commands
   - Frame presentation

3. During interactions, both are competing for CPU time:
   - Canvas rendering runs every frame (marked dirty by interactions)
   - GPU renderer runs every frame (for real-time preview)
   - Canvas blocking prevents GPU renderer from completing its setup work

The issue is **architectural**: Canvas 2D rendering and GPU rendering are both CPU-bound operations competing for the same thread.

## Required Architectural Changes

### Option 1: OffscreenCanvas (Recommended)

Move canvas rendering to an OffscreenCanvas in a Web Worker:

1. **Create a Web Worker** for canvas rendering
2. **Use OffscreenCanvas** to render the node editor UI
3. **Transfer rendered frames** from worker to main thread
4. **Main thread** only handles compositing (drawing the OffscreenCanvas onto the visible canvas)

**Benefits**:
- Canvas rendering no longer blocks GPU renderer
- Both can run in parallel (worker thread + main thread)
- No visual changes needed - same rendering pipeline

**Implementation**:
- Move `Renderer.js` logic to a Web Worker
- Use `OffscreenCanvas` and `OffscreenCanvasRenderingContext2D`
- Send rendering commands via `postMessage`
- Transfer rendered ImageBitmap back to main thread
- Draw ImageBitmap on main canvas

**Challenges**:
- Requires refactoring entire rendering pipeline
- Need to handle shared state (graph, viewport) between main thread and worker
- ImageBitmap transfer has overhead

### Option 2: GPU-Accelerated Canvas (Not Possible)

Canvas 2D API doesn't support GPU acceleration. WebGL/WebGPU could be used, but would require complete rewrite of rendering code.

### Option 3: Prioritized Rendering Queue

Implement a priority-based rendering system:

1. **GPU renderer gets priority** - always render first
2. **Canvas rendering happens after GPU setup** - use `requestIdleCallback` for canvas
3. **Skip canvas rendering** when idle time is insufficient

**Challenges**:
- Canvas rendering may lag behind during interactions
- Complex to implement correctly
- May cause visible stuttering

### Option 4: Reduce Canvas Rendering Frequency

Only render canvas when absolutely necessary:

1. **During interactions**: Render canvas at lower priority (e.g., 30 FPS)
2. **When not interacting**: Render at 60 FPS
3. **Skip rendering** non-visible elements during interactions

**Challenges**:
- User explicitly said "no change is acceptable while interacting"
- May cause visual lag or stuttering

### Option 5: Convert All Thumbnails to Canvas at Creation Time (Most Feasible)

Ensure all thumbnails are Canvas elements, never ImageData:

1. **At thumbnail creation time**: Convert ImageData to Canvas immediately
2. **Store Canvas** in `node.__thumb`, never ImageData
3. **During rendering**: Only use `drawImage` (non-blocking), never `putImageData` (blocking)

**Implementation**:
- Update `ShaderPreviewManager.renderFragmentPreview()` to always create Canvas
- Update `PreviewComputer._createNodeThumbnail()` to always return Canvas
- Update all thumbnail generation code to convert ImageData immediately
- Remove ImageData handling from `Renderer.js`

**Benefits**:
- Eliminates blocking `putImageData` calls during rendering
- Minimal architectural change
- No visual changes

**Challenges**:
- Need to find all places where ImageData thumbnails are created
- Some thumbnails may be created dynamically (GPU readbacks)

## Recommended Solution

**Option 5 (Convert Thumbnails to Canvas at Creation) + Option 1 (OffscreenCanvas in Future)**

1. **Short term**: Implement Option 5 - convert all ImageData thumbnails to Canvas when created
2. **Long term**: Migrate to OffscreenCanvas in Web Worker for complete decoupling

## Current State

All attempts to fix this without architectural changes have failed. The problem is fundamental: Canvas 2D rendering blocks the main thread, preventing the GPU renderer from running smoothly during interactions.

## Reverted Changes

- Removed canvas context optimization (`desynchronized`)
- Removed all deferral strategies
- Removed thumbnail conversion during rendering
- Reverted to simple canvas caching approach

