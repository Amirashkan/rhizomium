# Actual Fix Needed for FPS Drop

## Problem
Canvas rendering blocks the main thread for 5-20ms during interactions, causing frames to exceed 16ms budget.

## Root Cause
Canvas 2D rendering is fundamentally synchronous and blocking. During interactions, it runs every frame and blocks the main thread.

## Current State
- GPU renderer is called first (async, not awaited) ✓
- GPU renderer's sync work completes before canvas rendering ✓
- Viewport culling skips off-screen elements ✓
- Thumbnail conversion eliminates blocking `putImageData` ✓
- Dirty flag prevents unnecessary redraws ✓

## The Real Issue
Even with all optimizations, canvas rendering still takes 5-20ms per frame during interactions. This exceeds the 16ms frame budget, causing FPS drops.

## Actual Fix Required
The only way to fix this without changing visuals is to **make canvas rendering operations faster**. The bottleneck is likely:

1. **Grid rendering** - Drawing many lines every frame
2. **Node rendering** - Drawing gradients, shadows, text
3. **Connection rendering** - Drawing bezier curves
4. **Thumbnail rendering** - Even with Canvas, `drawImage()` is synchronous

## Solution
Optimize canvas operations themselves:
- Cache grid rendering to a texture (only redraw on zoom/pan)
- Use CSS transforms for node movement instead of redrawing
- Batch canvas operations
- Use `will-change` CSS hint
- Use `desynchronized: true` canvas context (if supported)

But these require architectural changes that may not be feasible given the constraints.

