# GPU Performance Monitoring and Testing Guide

This guide covers the GPU performance monitoring, profiling, and testing features for the GLSL Node Editor.

## Table of Contents

1. [Overview](#overview)
2. [Performance Monitoring](#performance-monitoring)
3. [Profiler Overlay](#profiler-overlay)
4. [Running Tests](#running-tests)
5. [Field Data to 3D Position Mapping](#field-data-to-3d-position-mapping)
6. [GPU Stability](#gpu-stability)
7. [Keyboard Shortcuts](#keyboard-shortcuts)
8. [API Reference](#api-reference)

---

## Overview

The GPU performance monitoring system provides:

- **Real-time FPS and frame time tracking**
- **Compute shader dispatch monitoring**
- **Workgroup statistics**
- **GPU timestamp support** (when available)
- **Automatic performance warnings**
- **Comprehensive testing suite**

### Components

1. **ComputeProfiler** (`src/gpu/ComputeProfiler.js`)
   - Collects performance metrics
   - Tracks GPU timestamps
   - Monitors compute dispatches

2. **ComputeProfilerOverlay** (`src/ui/ComputeProfilerOverlay.js`)
   - Visual overlay for metrics display
   - Terminal-style UI
   - Expandable detailed view

3. **GPUPerformanceMonitor** (`src/utils/GPUPerformanceMonitor.js`)
   - Enhanced monitoring features
   - Automatic overlay management
   - Performance warnings
   - Keyboard shortcuts

4. **GPUPerformanceTest** (`src/test/GPUPerformanceTest.js`)
   - Comprehensive test suite
   - Field mapping verification
   - GPU stability tests

---

## Performance Monitoring

### Automatic Setup

The performance monitor is **automatically initialized** when you start the application:

```javascript
// Performance monitor is created during initialization
// with these default settings:
{
  autoShowOverlay: true,        // Show overlay on startup
  enableWarnings: true,          // Enable performance warnings
  fpsWarningThreshold: 30,       // Warn if FPS < 30
  frameTimeWarningThreshold: 33.33  // Warn if frame time > 33ms
}
```

### Access via Console

You can access the monitor from the browser console:

```javascript
// Get current metrics
window.gpuPerformanceMonitor.getMetrics();

// Show/hide overlay
window.gpuPerformanceMonitor.showOverlay();
window.gpuPerformanceMonitor.hideOverlay();
window.gpuPerformanceMonitor.toggleOverlay();

// Enable/disable profiler
window.gpuPerformanceMonitor.enableProfiler();
window.gpuPerformanceMonitor.disableProfiler();

// Reset profiler
window.gpuPerformanceMonitor.resetProfiler();
```

---

## Profiler Overlay

### Display Format

```
╔════════════════════════════════════════╗
║         COMPUTE PROFILER               ║
╠════════════════════════════════════════╣
║ FPS:           60.0                    ║
║ Frame Time:    16.67 ms                ║
║ Compute Time:  2.45 ms                 ║
║ Dispatches:    3                       ║
║ Workgroups:    512                     ║
║ GPU Timing:    Yes                     ║
╚════════════════════════════════════════╝
```

### Color Coding

- **FPS**:
  - Green: ≥60 FPS
  - Yellow: 30-60 FPS
  - Red: <30 FPS

- **Frame Time**:
  - Green: ≤16.67ms (60 FPS)
  - Yellow: 16.67-33.33ms (30-60 FPS)
  - Red: >33.33ms (<30 FPS)

- **Compute Time**:
  - Green: ≤5ms
  - Yellow: 5-10ms
  - Red: >10ms

### Expanded View

Press the **+** button to see detailed dispatch information:

```
DISPATCH BREAKDOWN
──────────────────────────────────────
#1 Reaction-Diffusion
   Time: 1.234 ms (GPU)
   Dispatch: 8×8×1
   Workgroup: 8×8×1
   Total: 64 workgroups

#2 Noise Generator
   Time: 0.567 ms (GPU)
   Dispatch: 32×32×1
   Workgroup: 8×8×1
   Total: 1,024 workgroups
```

---

## Running Tests

### Console Command

Run the full test suite from the browser console:

```javascript
// Run all tests
await window.gpuPerformanceTest.runAllTests();

// Or use the monitor wrapper
await window.gpuPerformanceMonitor.runTests();
```

### Test Suite

The test suite includes:

#### 1. Profiler Display Test
- Verifies profiler is enabled
- Tests overlay toggle functionality
- Checks timestamp support
- Displays current metrics

#### 2. Field Mapping Test
- Verifies correct coordinate transformation
- Tests field space → world space conversion
- Validates corner cases
- Checks arbitrary positions

#### 3. GPU Stability Tests
- **Command Buffer Synchronization**: Tests GPU command submission
- **Memory Leak Detection**: Creates/destroys buffers to detect leaks
- **Stall Detection**: Monitors for command buffer stalls
- **Error Recovery**: Tests GPU device recovery after errors

### Expected Output

```
[GPUPerformanceTest] ========================================
[GPUPerformanceTest] TEST RESULTS SUMMARY
[GPUPerformanceTest] ========================================
[GPUPerformanceTest] 1. Profiler Display: ✓ PASS
[GPUPerformanceTest] 2. Field Mapping: ✓ PASS
[GPUPerformanceTest] 3. Scene Graph Stability: ✓ PASS
[GPUPerformanceTest] ========================================
[GPUPerformanceTest] Overall: ✓ ALL TESTS PASSED
[GPUPerformanceTest] ========================================
```

---

## Field Data to 3D Position Mapping

### Coordinate Transformation

The `ComputeFieldMapperNode` converts field indices to world positions:

```javascript
// Field space: [0, width] × [0, height] × [0, depth]
// World space: [minX, maxX] × [minY, maxY] × [minZ, maxZ]

// Example configuration
const mapper = new ComputeFieldMapperNode('field', {
  dimensions: [64, 64, 64],
  fieldBounds: {
    min: [-1, -1, -1],
    max: [1, 1, 1]
  }
});

// Convert field position to world position
const worldPos = mapper.fieldToWorld(32, 32, 32);
// Result: [0, 0, 0] (center of the field)
```

### Mapping Formula

```javascript
x = min[0] + (i / width) * (max[0] - min[0])
y = min[1] + (j / height) * (max[1] - min[1])
z = min[2] + (k / depth) * (max[2] - min[2])
```

### Test Cases

| Field Position | Expected World Position | Description |
|---------------|------------------------|-------------|
| (0, 0, 0)     | (-1, -1, -1)          | Origin corner |
| (64, 64, 64)  | (1, 1, 1)             | Max corner |
| (32, 32, 32)  | (0, 0, 0)             | Center |
| (16, 32, 48)  | (-0.5, 0, 0.5)        | Arbitrary point |

---

## GPU Stability

### Command Buffer Management

The system ensures:

1. **Proper Synchronization**: Command buffers are submitted in order
2. **No Stalls**: Command submission completes quickly (<50ms)
3. **No Memory Leaks**: Buffers are properly destroyed
4. **Error Recovery**: System remains operational after GPU errors

### Scene Graph Updates

When updating the scene graph:

```javascript
// 1. Update parameters
fieldMapper.setVisualizationParam('threshold', 0.5);

// 2. Mark as dirty (automatic with event system)
// fieldMapper.needsUpdate is set to true

// 3. Process updates (in render loop)
await visualizerManager.processPendingUpdates(time);

// 4. Render (no crashes or stalls)
renderer.render({ timeSec: time });
```

### Best Practices

✅ **DO**:
- Use the event system for parameter changes
- Wait for `onSubmittedWorkDone()` when needed
- Destroy unused buffers/textures
- Use try-catch blocks for GPU operations

❌ **DON'T**:
- Create command encoders in tight loops
- Hold references to destroyed resources
- Submit empty command buffers repeatedly
- Mix CPU/GPU timing without synchronization

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl + P** | Toggle profiler overlay |
| **Ctrl + Shift + P** | Run performance tests |
| **Ctrl + Shift + R** | Reset profiler metrics |
| **Ctrl + Shift + E** | Enable/disable profiler |
| **+** (in overlay) | Expand dispatch details |
| **−** (in overlay) | Collapse dispatch details |

---

## API Reference

### GPUPerformanceMonitor

```javascript
class GPUPerformanceMonitor {
  constructor(options)
  initialize(device)

  // Metrics
  getMetrics()

  // Overlay control
  showOverlay()
  hideOverlay()
  toggleOverlay()

  // Profiler control
  enableProfiler()
  disableProfiler()
  resetProfiler()

  // Testing
  async runTests()
}
```

### ComputeProfiler

```javascript
class ComputeProfiler {
  constructor(device)

  setEnabled(enabled)

  // Frame lifecycle
  beginFrame()
  endFrame(commandEncoder)

  // Dispatch tracking
  beginDispatch(commandEncoder, label, workgroupInfo)
  endDispatch(commandEncoder, dispatchId)

  // Metrics
  getMetrics()
  reset()

  // Cleanup
  destroy()
}
```

### GPUPerformanceTest

```javascript
class GPUPerformanceTest {
  constructor(device)

  // Individual tests
  testProfilerDisplay()
  testFieldToWorldMapping()
  async testSceneGraphUpdates()

  // Run all
  async runAllTests()

  // Results
  getResults()
  generateReport()
}
```

### ComputeFieldMapperNode

```javascript
class ComputeFieldMapperNode extends Node {
  constructor(name, options)

  // Configuration
  setDimensions(width, height, depth)
  setFieldBounds(min, max)
  setMappingMode(mode)

  // Coordinate mapping
  fieldToWorld(i, j, k)  // Returns [x, y, z]

  // Visualization
  async initializeVisualizer(device)
  async generateVisualization(fieldTexture, forceUpdate)

  // Parameters
  setVisualizationParam(name, value)
  markNeedsUpdate()
}
```

---

## Performance Tips

### Optimize Compute Dispatches

1. **Minimize Dispatch Count**: Combine operations when possible
2. **Use Appropriate Workgroup Sizes**: Typically 8×8 or 16×16 for 2D
3. **Avoid Tiny Dispatches**: Minimum 64 workgroups recommended
4. **Profile Your Shaders**: Use the profiler to identify bottlenecks

### Optimize Visualizations

1. **Use Sampling**: Set `sampleRate` < 1 for large fields
2. **Use Thresholds**: Filter points to reduce geometry
3. **Cache When Possible**: Only regenerate when needed
4. **Consider LOD**: Use different detail levels based on performance

### Monitor Performance

1. **Watch FPS**: Aim for 60 FPS
2. **Check Compute Time**: Should be <50% of frame time
3. **Monitor Workgroups**: High counts may indicate overdraw
4. **Enable Warnings**: Let the system alert you to issues

---

## Troubleshooting

### Overlay Not Showing

```javascript
// Manually show overlay
window.profilerOverlay.show();

// Or reinitialize monitor
window.gpuPerformanceMonitor.showOverlay();
```

### No Metrics

```javascript
// Check if profiler is enabled
window.computeProfiler.setEnabled(true);

// Verify profiler exists
console.log(window.computeProfiler);
```

### Tests Failing

```javascript
// Get detailed results
const results = await window.gpuPerformanceTest.runAllTests();
console.log(results);

// Check specific test
window.gpuPerformanceTest.testProfilerDisplay();
window.gpuPerformanceTest.testFieldToWorldMapping();
await window.gpuPerformanceTest.testSceneGraphUpdates();
```

### Low FPS

1. Check compute time (should be <16ms for 60 FPS)
2. Reduce workgroup count
3. Optimize shader code
4. Enable MSAA (may improve perceived quality at lower FPS)
5. Use lower sample rates for visualizations

---

## Examples

### Basic Usage

```javascript
// Monitor is automatically active
// Just press Ctrl+P to see metrics!
```

### Custom Configuration

```javascript
const monitor = new GPUPerformanceMonitor({
  autoShowOverlay: false,  // Don't show on startup
  enableWarnings: true,
  fpsWarningThreshold: 60  // Warn if FPS < 60
});
monitor.initialize(device);
```

### Run Tests Automatically

```javascript
// Add to initialization
async function initialize() {
  // ... setup code ...

  // Run tests on startup
  const results = await window.gpuPerformanceTest.runAllTests();

  if (!results.allPassed) {
    console.warn('Some performance tests failed!');
  }
}
```

---

## Additional Resources

- [COMPUTE_PROFILER.md](./COMPUTE_PROFILER.md) - Detailed profiler documentation
- [FieldVisualization.md](./docs/FieldVisualization.md) - Field visualization guide
- [REALTIME_3D_UPDATE_SUMMARY.md](./REALTIME_3D_UPDATE_SUMMARY.md) - Real-time updates

---

**Last Updated**: 2025-11-08
