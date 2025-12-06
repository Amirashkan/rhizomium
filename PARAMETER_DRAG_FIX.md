# Parameter Drag Performance Fix

## Problem
Parameter dragging caused severe FPS drops (12.1 FPS min, 82.52ms max frame time) due to excessive canvas redraws.

## Root Cause
During parameter drag, `window.editor.draw()` was being called on **every mouse move event**. Mouse move events can fire 100+ times per second, causing:
- 100+ canvas redraws per second (target: 60 FPS)
- Frame time spikes up to 82ms
- Severe performance degradation

## Solution
Removed direct `draw()` calls during parameter drag. Instead:
1. Only mark the editor as dirty with `markDirty('parameter-drag')`
2. Let the render loop handle drawing at 60 FPS automatically
3. The render loop checks `editor.isDirty()` and draws when needed

## Files Modified

### 1. `src/ui/components/TextInputHandler.js`
**Line 448-456**: Removed direct `draw()` call during drag
- Before: Called `window.editor.draw()` on every mouse move
- After: Only calls `window.editor.markDirty('parameter-drag')`

### 2. `src/utils/ParameterExpressionSystem.js`
**Line 1209-1217**: Removed direct `draw()` call during drag
- Before: Called `window.editor.draw()` on every mouse move
- After: Only calls `window.editor.markDirty('parameter-drag')`

**Line 1568-1579**: Removed debounced `draw()` call
- Before: Debounced `draw()` calls to 50ms intervals
- After: Only marks dirty, render loop handles drawing

## Expected Performance Improvement

| Metric | Before | After (Expected) | Target |
|--------|--------|------------------|--------|
| Min FPS during drag | 12.1 | 55-60 | 60+ |
| Max Frame Time | 82.52ms | <16.67ms | <16.67ms |
| Avg Frame Time | 29.99ms | <16.67ms | <16.67ms |

## Testing

Run the optimization test suite to verify the fix:

```javascript
// Test parameter drag performance
(async function() {
  const profiler = window.computeProfiler;
  if (!profiler) {
    console.log('Profiler not available');
    return;
  }
  
  console.log('Testing parameter drag performance...');
  console.log('1. Start dragging a parameter slider');
  console.log('2. Watch the metrics below');
  
  const metrics = [];
  let frameCount = 0;
  const targetFrames = 60;
  
  const measureFrame = () => {
    if (frameCount < targetFrames) {
      const m = profiler.getMetrics();
      metrics.push({
        fps: m.fps,
        frameTime: m.frameTime
      });
      frameCount++;
      requestAnimationFrame(measureFrame);
    } else {
      const avgFPS = metrics.reduce((sum, m) => sum + m.fps, 0) / metrics.length;
      const avgFrameTime = metrics.reduce((sum, m) => sum + m.frameTime, 0) / metrics.length;
      const minFPS = Math.min(...metrics.map(m => m.fps));
      const maxFrameTime = Math.max(...metrics.map(m => m.frameTime));
      
      console.log('\n=== Parameter Drag Performance ===');
      console.log(`Avg FPS: ${avgFPS.toFixed(1)} (target: >55)`);
      console.log(`Min FPS: ${minFPS.toFixed(1)} (target: >50)`);
      console.log(`Avg Frame Time: ${avgFrameTime.toFixed(2)}ms (target: <16.67ms)`);
      console.log(`Max Frame Time: ${maxFrameTime.toFixed(2)}ms (target: <20ms)`);
      
      const status = avgFrameTime < 16.67 && minFPS > 50 ? '✅ PASS' : '⚠️ NEEDS WORK';
      console.log(`Status: ${status}`);
    }
  };
  
  requestAnimationFrame(measureFrame);
})();
```

## Additional Notes

- GPU uniforms are still updated immediately during drag (via `updateUniformsOnly`)
- Canvas labels update smoothly at 60 FPS via the render loop
- Preview computations are skipped during drag (handled on mouseup)
- Shader rebuilds are skipped during drag (handled on mouseup)

## Related Optimizations

This fix is part of **Phase 1.2: Optimize Preview Computation Frequency** from the performance optimization plan:
- ✅ Throttle preview updates during parameter drag
- ✅ Skip expensive operations during drag
- ✅ Batch updates on mouseup
