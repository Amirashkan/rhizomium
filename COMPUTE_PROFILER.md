# Compute Profiler

The Compute Profiler is a lightweight performance monitoring system for WebGPU compute dispatches in the GLSL Node Editor.

## Features

- **FPS Tracking**: Real-time frames per second measurement
- **Frame Time**: Millisecond timing for each frame
- **Dispatch Timing**: Per-dispatch performance metrics using WebGPU timestamp queries
- **Workgroup Tracking**: Monitor active dispatches and total workgroups
- **Visual Overlay**: Clean, terminal-style performance display

## Usage

### Keyboard Shortcuts

- **Ctrl+P**: Toggle profiler overlay visibility
- **+ Button**: Expand to see detailed per-dispatch breakdown
- **− Button**: Collapse to compact view
- **× Button**: Close overlay

### Overlay Information

#### Compact View
- **FPS**: Frames per second (color-coded: green ≥60, yellow ≥30, red <30)
- **Frame Time**: Total frame duration in milliseconds
- **Compute Time**: Total time spent in compute dispatches
- **Dispatches**: Number of active compute shader dispatches
- **Workgroups**: Total workgroups executed per frame
- **GPU Timing**: Whether hardware timestamp queries are supported

#### Expanded View
Shows detailed breakdown for each compute dispatch:
- Dispatch name (e.g., ComputeNoise, ComputeReactionDiffusion)
- Timing (GPU timestamps if supported, CPU fallback otherwise)
- Dispatch dimensions (X×Y×Z)
- Workgroup size
- Total workgroup count

## Technical Details

### Architecture

The profiler consists of two main components:

1. **ComputeProfiler** (`src/gpu/ComputeProfiler.js`)
   - Manages timestamp queries using WebGPU's `timestamp-query` feature
   - Tracks FPS and frame timing
   - Collects per-dispatch metrics
   - Falls back to CPU timing if GPU timestamps are unavailable

2. **ComputeProfilerOverlay** (`src/ui/ComputeProfilerOverlay.js`)
   - Terminal-style visual overlay
   - Real-time metrics display
   - Expandable detailed view
   - Keyboard shortcut support

### Integration Points

The profiler is integrated at several key locations:

- **GPURenderer** (`src/gpu/gpuRenderer.js`): Calls `beginFrame()` and `endFrame()`
- **ComputeExecutor** (`src/gpu/ComputeExecutor.js`): Passes profiler to compute nodes
- **ComputeShaderManager** (`src/gpu/ComputeShaderManager.js`): Instruments dispatch calls
- **main.js**: Initializes profiler and updates overlay

### Timestamp Queries

When supported, the profiler uses WebGPU timestamp queries for accurate GPU-side timing:

```javascript
// Feature check
if (device.features.has('timestamp-query')) {
  // Create query set and buffers
  querySet = device.createQuerySet({
    type: 'timestamp',
    count: maxQueries
  });
}
```

Timestamp queries provide nanosecond-precision timing directly from the GPU, eliminating CPU/GPU synchronization overhead.

### Performance Impact

The profiler is designed to be lightweight:
- Minimal overhead when enabled (~0.1-0.2ms per frame)
- Zero overhead when disabled
- Async query resolution to avoid blocking
- Efficient buffer reuse

## API Reference

### ComputeProfiler

#### Constructor
```javascript
const profiler = new ComputeProfiler(device);
```

#### Methods

**`setEnabled(enabled: boolean)`**
- Enable or disable profiling

**`beginFrame()`**
- Start frame timing (called once per frame)

**`beginDispatch(commandEncoder, label, workgroupInfo)`**
- Start timing a compute dispatch
- Returns dispatch ID for matching with `endDispatch()`
- `workgroupInfo`: `{ dispatchSize: {x,y,z}, workgroupSize: {x,y,z} }`

**`endDispatch(commandEncoder, dispatchId)`**
- End timing for a dispatch

**`endFrame(commandEncoder)`**
- Resolve timestamp queries and finalize frame metrics

**`getMetrics()`**
- Returns current metrics object:
```javascript
{
  fps: number,
  frameTime: number,
  totalDispatchTime: number,
  dispatches: Array,
  activeWorkgroups: number,
  totalWorkgroups: number,
  enabled: boolean,
  supportsTimestamps: boolean,
  frameCount: number
}
```

**`reset()`**
- Clear all metrics

**`destroy()`**
- Cleanup GPU resources

### ComputeProfilerOverlay

#### Constructor
```javascript
const overlay = new ComputeProfilerOverlay(container);
```

#### Methods

**`show()`**
- Display overlay

**`hide()`**
- Hide overlay

**`toggle()`**
- Toggle visibility

**`toggleExpanded()`**
- Toggle between compact and detailed views

**`update(metrics)`**
- Update overlay with new metrics

**`destroy()`**
- Remove overlay from DOM

## Examples

### Basic Usage

```javascript
// Profiler is automatically initialized in main.js
// Access via global:
window.computeProfiler.setEnabled(true);

// Show overlay
window.profilerOverlay.show();

// Get current metrics
const metrics = window.computeProfiler.getMetrics();
console.log('FPS:', metrics.fps);
console.log('Dispatches:', metrics.activeWorkgroups);
```

### Custom Integration

```javascript
// In your render loop
profiler.beginFrame();

const encoder = device.createCommandEncoder();

// Profile a compute dispatch
const dispatchId = profiler.beginDispatch(
  encoder,
  'MyComputeShader',
  {
    dispatchSize: { x: 64, y: 64, z: 1 },
    workgroupSize: { x: 8, y: 8, z: 1 }
  }
);

// ... dispatch compute work ...

profiler.endDispatch(encoder, dispatchId);

// Finalize frame
profiler.endFrame(encoder);

// Update UI
overlay.update(profiler.getMetrics());
```

## Browser Support

- **Timestamp Queries**: Chrome 113+, Edge 113+
  - Safari and Firefox: CPU fallback timing
- **WebGPU**: All browsers with WebGPU support

## Performance Tuning Tips

Using the profiler to optimize compute performance:

1. **Identify Hotspots**: Check which dispatches take the most time
2. **Workgroup Optimization**: Experiment with workgroup sizes (8×8, 16×16, etc.)
3. **Dispatch Reduction**: Combine multiple dispatches when possible
4. **Frame Budget**: Keep total compute time under 5-10ms for 60 FPS
5. **Conditional Dispatch**: Use ComputeExecutor's input tracking to skip unnecessary dispatches

### Color Indicators

- **Green**: Optimal performance (FPS ≥60, Frame Time ≤16.67ms, Compute ≤5ms)
- **Yellow**: Acceptable (FPS ≥30, Frame Time ≤33.33ms, Compute ≤10ms)
- **Red**: Poor performance (FPS <30, Frame Time >33.33ms, Compute >10ms)

## Troubleshooting

**Profiler not showing metrics**
- Ensure WebGPU is initialized: `window.gpuRenderer` exists
- Check console for errors
- Verify compute nodes are active

**Timestamp queries not supported**
- Check `metrics.supportsTimestamps`
- CPU fallback timing is automatically used
- Consider using Chrome/Edge for GPU timing

**High compute time**
- Check dispatch count and workgroup totals
- Profile individual dispatches in expanded view
- Consider reducing texture resolution
- Optimize compute shader code

## Future Enhancements

Potential improvements:
- GPU memory usage tracking
- Historical performance graphs
- Export metrics to CSV/JSON
- Per-node performance budgets
- Automatic performance warnings
