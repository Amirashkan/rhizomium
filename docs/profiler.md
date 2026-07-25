# Performance Profiler

Monitor your visual's performance in real-time! Track frame rate, GPU usage, and identify performance bottlenecks.

---

## Quick Start

### Step 1: Open the Profiler

**Keyboard shortcut:** Press **Ctrl+P**

Or click the **Profiler** button in the toolbar (if available).

### Step 2: View Metrics

The profiler overlay appears showing:
- **FPS** - Frames per second (target: 60)
- **Frame Time** - Milliseconds per frame (target: <16.67ms)
- **Compute Time** - Time spent in compute shaders
- **Dispatches** - Number of compute shader dispatches

### Step 3: Analyze Performance

- **Green** = Good performance (60 FPS)
- **Yellow** = Acceptable (30-60 FPS)
- **Red** = Poor performance (<30 FPS)

---

## Profiler Display

### Compact View

Shows essential metrics at a glance:

```
╔══════════════════════════════════╗
║      COMPUTE PROFILER            ║
╠══════════════════════════════════╣
║ FPS: 60                          ║
║ Frame Time: 16.5ms               ║
║ Compute Time: 2.3ms              ║
║ Dispatches: 2                    ║
║ Workgroups: 1024                 ║
║ GPU Timing: Yes                  ║
╚══════════════════════════════════╝
```

### Expanded View

Click **+** button to see detailed breakdown:

```
╔══════════════════════════════════╗
║      COMPUTE PROFILER            ║
╠══════════════════════════════════╣
║ FPS: 60                          ║
║ Frame Time: 16.5ms               ║
║ Compute Time: 2.3ms              ║
║                                  ║
║ Dispatch Breakdown:             ║
║ • ComputeNoise: 1.2ms (512×512) ║
║ • ComputeBlur: 1.1ms (512×512)  ║
╚══════════════════════════════════╝
```

---

## Understanding Metrics

### FPS (Frames Per Second)

**Target: 60 FPS**

- **60 FPS** = Smooth, ideal performance
- **30-60 FPS** = Acceptable, minor stuttering
- **<30 FPS** = Poor, noticeable lag

**Color coding:**
- **Green** (≥60) - Excellent
- **Yellow** (30-59) - Acceptable
- **Red** (<30) - Poor

### Frame Time

**Target: <16.67ms** (for 60 FPS)

Time to render one complete frame:
- **<16.67ms** = 60 FPS or better
- **16.67-33.33ms** = 30-60 FPS
- **>33.33ms** = Less than 30 FPS

### Compute Time

Time spent executing compute shaders:
- **<5ms** = Excellent
- **5-10ms** = Good
- **>10ms** = May impact performance

### Dispatches

Number of compute shader dispatches per frame:
- **1-5** = Typical
- **5-10** = Many (may impact performance)
- **>10** = Very many (likely performance issue)

### Workgroups

Total GPU workgroups executed:
- Varies by resolution and node count
- Higher = more GPU work
- Monitor for sudden increases

---

## Performance Targets

### Ideal Performance

| Metric | Target | Warning |
|--------|--------|---------|
| FPS | 60 | <30 |
| Frame Time | <16.67ms | >33.33ms |
| Compute Time | <5ms | >10ms |
| Dispatches | 1-5 | >10 |

### Performance Warnings

The profiler automatically warns when:
- FPS drops below 30
- Frame time exceeds 33ms
- Compute time exceeds 10ms
- Multiple performance issues detected

---

## Using the Profiler

### Toggle Display

**Show/Hide:**
- Press **Ctrl+P** to toggle overlay
- Click **×** button to close
- Click **+** to expand details

### Reset Metrics

**Clear statistics:**
- Press **Ctrl+Shift+R** to reset
- Clears min/max/average values
- Starts fresh measurement

### Enable/Disable Profiling

**Turn profiling on/off:**
- Press **Ctrl+Shift+E** to toggle
- Disabling improves performance slightly
- Metrics stop updating when disabled

---

## Identifying Issues

### Low FPS

**Problem:** FPS below 60

**Check:**
1. Frame Time - Is it >16.67ms?
2. Compute Time - Are compute shaders slow?
3. Dispatches - Too many compute nodes?
4. Resolution - Is preview resolution too high?

**Solutions:**
- Reduce compute node count
- Lower resolution
- Simplify shader complexity
- Close other applications

### High Frame Time

**Problem:** Frame time >16.67ms

**Check:**
1. Compute Time - Main contributor?
2. Fragment shader - Complex operations?
3. Node count - Too many nodes?

**Solutions:**
- Optimize compute shaders
- Reduce node complexity
- Lower resolution
- Simplify math operations

### High Compute Time

**Problem:** Compute time >10ms

**Check:**
1. Dispatch breakdown - Which node is slow?
2. Resolution - Are textures too large?
3. Iterations - Too many passes?

**Solutions:**
- Reduce compute node resolution
- Lower octaves/iterations
- Simplify compute shaders
- Use fewer compute nodes

### Too Many Dispatches

**Problem:** Dispatches >10 per frame

**Check:**
1. Compute node count - How many nodes?
2. Update frequency - Updating every frame?
3. Dependencies - Unnecessary re-execution?

**Solutions:**
- Reduce compute node count
- Use "On Change" update frequency
- Optimize dependency graph
- Cache static computations

---

## Profiler Controls

### Keyboard Shortcuts

- **Ctrl+P** - Toggle profiler overlay
- **Ctrl+Shift+P** - Run performance tests
- **Ctrl+Shift+R** - Reset profiler statistics
- **Ctrl+Shift+E** - Enable/disable profiling
- **+** (in overlay) - Expand dispatch details
- **−** (in overlay) - Collapse dispatch details

### Overlay Buttons

- **+** - Expand to show detailed breakdown
- **−** - Collapse to compact view
- **×** - Close overlay
- **Reset** - Clear statistics (if available)

---

## Performance Testing

### Run Performance Tests

**Automated testing:**
1. Press **Ctrl+Shift+P**
2. Tests run automatically
3. Results displayed in console
4. Check for warnings/errors

### Test Coverage

Tests verify:
- Profiler display functionality
- Frame rate accuracy
- Compute dispatch tracking
- GPU timestamp support
- Performance warnings

---

## GPU Timing

### Hardware Timestamps

**When available:**
- Uses GPU hardware timestamps
- Nanosecond precision
- Most accurate timing

**Indicators:**
- **GPU Timing: Yes** - Hardware timestamps enabled
- **GPU Timing: Fallback** - Using CPU fallback

### CPU Fallback

**When GPU timestamps unavailable:**
- Falls back to CPU timing
- Still accurate for most cases
- Slightly less precise

---

## Best Practices

### During Development

1. **Keep profiler open** - Monitor performance as you build
2. **Check frequently** - Catch issues early
3. **Test changes** - Verify optimizations work
4. **Compare before/after** - Measure improvements

### Performance Optimization

1. **Identify bottlenecks** - Use dispatch breakdown
2. **Optimize slow nodes** - Focus on worst performers
3. **Test incrementally** - One change at a time
4. **Verify improvements** - Check profiler after changes

### Production

1. **Target 60 FPS** - Always aim for smooth performance
2. **Monitor on target hardware** - Test on actual devices
3. **Set performance budgets** - Define acceptable limits
4. **Document optimizations** - Note what works

---

## Troubleshooting

### Profiler Not Showing

**Problem:** Overlay doesn't appear

**Solutions:**
- Press Ctrl+P to toggle
- Check if profiler is enabled
- Verify browser supports required features
- Try refreshing page

### Metrics Not Updating

**Problem:** Values stay the same

**Solutions:**
- Check if profiling is enabled (Ctrl+Shift+E)
- Verify graph is rendering
- Check for errors in console
- Try resetting profiler (Ctrl+Shift+R)

### Inaccurate Readings

**Problem:** Metrics seem wrong

**Solutions:**
- Check GPU timing support
- Verify frame rate isn't capped
- Check browser performance settings
- Test in different browser

### Profiler Impacting Performance

**Problem:** Profiler itself causes slowdown

**Solutions:**
- Disable when not needed (Ctrl+Shift+E)
- Use compact view (less overhead)
- Close expanded breakdown
- Check CPU usage

---

## Advanced Usage

### Performance Budgets

**Set targets:**
- Frame Time: <16.67ms
- Compute Time: <5ms
- Dispatches: <5 per frame

**Monitor:**
- Keep profiler open during development
- Alert when budgets exceeded
- Optimize before release

### Profiling Workflow

1. **Baseline** - Measure initial performance
2. **Identify** - Find bottlenecks
3. **Optimize** - Fix issues
4. **Verify** - Confirm improvements
5. **Repeat** - Iterate until target met

### Performance Regression Testing

**Track over time:**
- Record performance metrics
- Compare versions
- Detect regressions early
- Maintain performance standards

---

## See Also

- [Performance Tips](performance.md) - Optimization strategies
- [Compute Nodes](compute-nodes.md) - Optimize compute shaders
- [Frame Timing Monitoring](frame-timing-monitoring.md) - Detailed timing analysis

