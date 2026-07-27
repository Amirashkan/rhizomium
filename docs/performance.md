# Performance Tips

Optimize your Rhizomium node graphs for smooth, real-time performance.

## CRITICAL PERFORMANCE REQUIREMENT FOR ALL AGENTS

**30 FPS IS NEVER ACCEPTED. ALL OPTIMIZATIONS MUST TARGET 60 FPS.**

- **Target frame time:** <16.67ms (60 FPS)
- **Throttling values:** Use 16.67ms (60 FPS), NOT 33.33ms (30 FPS)
- **Frame skipping:** Should target 60 FPS, not 30 FPS
- **Any code that limits performance to 30 FPS must be changed to 60 FPS**

This is a non-negotiable requirement. If you see any 30 FPS throttling, frame skipping that results in 30 FPS, or comments mentioning 30 FPS as acceptable, you MUST change it to 60 FPS.

---

## Understanding Performance

Rhizomium runs entirely on your GPU using WebGPU. Performance depends on:

1. **Node complexity** - How expensive each node is to compute
2. **Node count** - Total number of nodes in your graph
3. **Resolution** - Preview window size
4. **GPU power** - Your graphics card capability
5. **Browser** - Chrome/Edge perform best

---

## Quick Optimization Checklist

Use this checklist if your visuals are running slowly:

- [ ] Reduce render resolution in **View → Preview / Export Settings** (try 720p, or one of the square presets)
- [ ] Minimize noise/Voronoi nodes (most expensive operations)
- [ ] Disable node preview thumbnails (save GPU cycles)
- [ ] Close unused browser tabs/applications
- [ ] Use simpler math operations where possible
- [ ] Check GPU usage in Task Manager/Activity Monitor
- [ ] Update graphics drivers
- [ ] Try Chrome/Edge instead of other browsers

---

## Node Performance Guide

Not all nodes cost the same. Here's what you need to know:

### Expensive Nodes (Use Sparingly)

These nodes are GPU-intensive:

#### Noise Nodes
- **Perlin Noise** - Complex procedural generation
- **Simplex Noise** - Similar cost to Perlin
- **Voronoi** - VERY expensive (cellular calculations)
- **FBM (Fractal Brownian Motion)** - Multiple octaves, very slow
- **Turbulence** - Similar to FBM

**Why expensive?** These nodes compute complex mathematical functions for every pixel, every frame.

**Optimization:**
- Limit to 2-3 noise nodes per graph
- Reduce octaves in FBM/Turbulence
- Use smaller noise scales when possible
- Consider replacing with simpler gradients

#### Transform Nodes
- **Kaleidoscope** - Multiple UV samples
- **Polar Coordinates** - Trigonometric operations
- **Twist** - Per-pixel rotation calculations

**Optimization:**
- Minimize transform stacking
- Use transforms early in graph (fewer pixels to process)

### Medium Cost Nodes

These nodes have moderate impact:

#### Math Nodes
- **Trigonometry** (Sin, Cos, Tan) - Built-in GPU functions, fairly fast
- **Power** - Exponential calculations
- **Smoothstep** - Polynomial interpolation

**Optimization:**
- Fine to use multiple instances
- Prefer built-in functions over custom expressions

#### Generator Nodes
- **Gradients** - Linear calculations, efficient
- **Circles** - Distance field, reasonable
- **Shapes** - SDF operations, moderate cost

**Optimization:**
- Generally safe to use freely
- Prefer circles over complex polygons

### Cheap Nodes (Use Freely)

These nodes are very efficient:

#### Input Nodes
- **UV, Time, Mouse, Audio** - Provided by system
- **Float, Vec2, Vec3, Vec4** - Constants, no computation

#### Basic Math
- **Add, Subtract, Multiply, Divide** - Native GPU operations
- **Min, Max, Clamp** - Simple comparisons
- **Mix/Lerp** - Linear interpolation

#### Utility Nodes
- **Split/Combine** - Vector operations
- **Remap** - Linear scaling

**Why cheap?** These use built-in GPU operations that are highly optimized.

---

## Resolution Settings

Preview resolution has **massive** impact on performance:

### Resolution Impact Table

Costs are relative to 720p, the default output format.

| Preset | Pixels | Relative cost | Use case |
|--------|--------|---------------|----------|
| 512 x 512 (square) | 262K | 0.3x | Complex graphs, older GPUs |
| 720p (1280 x 720) | 922K | 1x (default) | Balanced performance |
| 1024 x 1024 (square) | 1.0M | 1.1x | Square output, stills |
| 1080p (1920 x 1080) | 2.1M | 2.2x | Modern GPUs |
| 2048 x 2048 (square) | 4.2M | 4.5x | Large square stills |
| 1440p (2560 x 1440) | 3.7M | 4x | Powerful GPUs |
| 4K (3840 x 2160) | 8.3M | 9x | High-end GPUs only |

**Performance Tip:** Every pixel computes your entire node graph, every frame!

### Choosing Resolution

**Start with 1920x1080 (FHD):**
- Good balance of quality and performance
- Works on most modern GPUs
- Standard for streaming/recording

**Drop to 1280x720 (HD) if:**
- Framerate drops below 30 FPS
- Using 5+ noise nodes
- GPU is older than 5 years
- Running on integrated graphics

**Use 512 x 512 if:**
- Still experiencing lag at HD
- Testing complex graphs
- Low-end hardware
- Battery saving on laptop

**Use 2560x1440 (QHD) or 4K if:**
- Smooth at FHD with GPU headroom
- High-end discrete GPU (RTX, RX)
- Need high-quality export
- Desktop with good cooling

---

## GPU Considerations

### Minimum Requirements

**Integrated Graphics:**
- Intel Iris Xe (11th gen+) - HD resolution
- AMD Vega (Ryzen APU) - HD resolution
- Apple M1/M2 - FHD resolution

**Discrete Graphics:**
- NVIDIA GTX 900 series - FHD resolution
- AMD RX 400 series - FHD resolution
- Modern mid-range cards - QHD+ resolution

### Checking GPU Usage

**Windows:**
1. Open Task Manager (Ctrl+Shift+Esc)
2. Performance tab → GPU
3. Watch GPU usage and temperature
4. Stay under 90% for comfortable performance

**Mac:**
1. Activity Monitor → Window → GPU History
2. Watch GPU usage percentage

**Linux:**
- Use `nvidia-smi` (NVIDIA)
- Use `radeontop` (AMD)
- Watch utilization percentage

### Thermal Throttling

If your GPU overheats, it slows down automatically:

**Symptoms:**
- Performance starts good, then drops
- Fan noise increases significantly
- Computer gets hot

**Solutions:**
- Lower resolution
- Reduce graph complexity
- Improve case cooling/airflow
- Clean dust from vents
- Use cooling pad (laptops)

---

## Node Graph Optimization

### General Strategies

1. **Minimize Noise Nodes**
   ```
   Bad: UV → Noise → FBM → Turbulence
   Good: UV → Noise → Some Math
   ```

2. **Reuse Expensive Operations**
   ```
   Bad: Same noise node duplicated 3 times
   Good: One noise node → Split to multiple outputs
   ```

3. **Simplify When Possible**
   ```
   Bad: Noise → Complex color ramp → More noise
   Good: Noise → Simple gradient → Done
   ```

4. **Use Cheap Math First**
   ```
   Good: UV → Scale → Rotate → Noise
   (Transform reduces noise sampling area)
   ```

### Specific Optimizations

**Replace FBM with Simpler Alternatives:**
- Instead of FBM (8 octaves) → Try Perlin + smaller FBM (2-3 octaves)
- Or use static textures instead of procedural noise

**Reduce Fractal Octaves:**
- Default FBM: 8 octaves (very slow)
- Try: 3-4 octaves (much faster, similar look)
- Even 2 octaves can look good

**Combine Operations:**
```
Bad:
UV → Rotate → Scale → Translate

Good:
UV → Combined Transform (one node with matrix math)
```

**Limit Color Ramp Complexity:**
- ColorRamps are relatively cheap
- But 20-stop gradients are slower than 3-stop
- Use just enough stops for your needs

---

## Preview Management

### Node Preview Thumbnails

Node previews show intermediate results but cost performance:

**When to Disable:**
- Graph has 20+ nodes
- Using multiple noise nodes
- Performance is already borderline
- You don't need to see intermediate values

**How to Disable:**
- Click eye button on each node
- Or disable preview system globally (if available)

**Performance Gain:**
- Each preview is a mini render
- Disabling 10 previews = 10× fewer renders
- Can double framerate in complex graphs

### Preview Size Impact

Preview thumbnails come in three sizes:

- **S (Small)** - 32×32 = 1,024 pixels
- **M (Medium)** - 64×64 = 4,096 pixels (4× cost)
- **L (Large)** - 128×128 = 16,384 pixels (16× cost)

Use Small size for most nodes, Large only when debugging.

---

## Audio Reactivity Performance

Good news: **Audio processing is very efficient!**

### Audio Impact

- **CPU**: ~1-2% usage for FFT analysis
- **GPU**: No additional load
- **Latency**: <10ms response time

Audio expressions are just per-frame uniform inputs - they don't slow down your graph.

### Optimization

No special optimization needed for audio. Use freely!

---

## Browser Performance

### Best Browsers

**Recommended:**
1. **Chrome 113+** - Best WebGPU performance
2. **Edge 113+** - Equal to Chrome (same engine)
3. **Opera 99+** - Chromium-based, good performance

**Not Recommended:**
- **Firefox** - WebGPU experimental, slower
- **Safari** - Limited WebGPU support
- **Older browsers** - No WebGPU at all

### Browser Optimization

1. **Close Unused Tabs**
   - Each tab uses RAM
   - GPU acceleration applies to all tabs
   - Close Twitter, YouTube, etc.

2. **Disable Extensions**
   - Some extensions slow down canvas rendering
   - Try incognito mode to test
   - Especially ad blockers, video downloaders

3. **Enable Hardware Acceleration**
   - Chrome → Settings → System
   - "Use hardware acceleration when available"
   - Should be ON

4. **Update Browser**
   - Newer versions = better WebGPU
   - Chrome updates improve GPU performance
   - Always use latest stable version

---

## Workflow Tips

### Development Strategy

1. **Build with Low Resolution**
   - Create graph at 960×540 or 1280×720
   - Fast iteration and testing
   - Easier to debug

2. **Test at Target Resolution**
   - Before finalizing, test at full resolution
   - Some effects look different at high-res
   - Ensure acceptable framerate

3. **Optimize Incrementally**
   - Add nodes one at a time
   - Notice which nodes slow things down
   - Remove or replace expensive operations

### Live Performance

For VJ sets and live visuals:

1. **Target 60 FPS minimum**
   - Smooth visuals matter for live shows
   - Test under load before performing
   - Have simpler backup scenes

2. **Prepare Multiple Versions**
   - Complex version for powerful setups
   - Optimized version for laptops
   - Minimal version for emergencies

3. **Monitor Performance**
   - Keep Task Manager / Activity Monitor open
   - Watch GPU usage during rehearsal
   - Know your limits before going live

---

## Benchmarking

### Test Your System

Create this test graph to benchmark:

```
UV → Perlin Noise → ColorRamp → Output
```

**Expected Performance:**
- Modern GPU @ FHD: 60 FPS
- Older GPU @ FHD: 30-60 FPS
- Integrated @ HD: 30-60 FPS

If you can't maintain this, reduce resolution or upgrade hardware.

### Stress Test

Add 3-4 FBM nodes to stress test:

```
UV → FBM (8 oct) → FBM (8 oct) → Output
```

**Expected Performance:**
- High-end GPU @ FHD: 30-60 FPS
- Mid-range GPU @ FHD: 15-30 FPS
- Low-end GPU @ HD: <15 FPS

This is worst-case scenario. Normal graphs should be much faster.

---

## Troubleshooting Performance Issues

### Sudden Lag After Working Fine

**Possible Causes:**
- GPU thermal throttling (overheating)
- Browser tab accumulated memory
- Other applications started using GPU

**Solutions:**
1. Check GPU temperature
2. Refresh the browser tab
3. Close other GPU-intensive apps
4. Let GPU cool down

### Specific Node Slows Everything

**Diagnosis:**
1. Toggle preview on nodes one by one
2. Identify which node causes lag
3. Replace with simpler alternative

**Common Culprits:**
- Voronoi (replace with Noise)
- High-octave FBM (reduce octaves)
- Multiple transforms (simplify chain)

### Lower Framerate Than Expected

**Check:**
1. Browser is using discrete GPU (not integrated)
2. Power plan set to High Performance (laptops)
3. Other tabs not using GPU
4. Drivers are up to date

**Windows - Force Chrome to Use NVIDIA GPU:**
1. NVIDIA Control Panel → Manage 3D Settings
2. Program Settings → Add Chrome
3. Select "High-performance NVIDIA processor"

---

## Performance Monitoring

### Frame Timing Monitoring

The application includes built-in frame timing monitoring that tracks RAF (RequestAnimationFrame) performance:

**Access via Console:**
```javascript
// Get comprehensive frame statistics
const stats = window.renderLoop?.rafManager?.getFrameStats();
console.log(stats);

// Check frame drop rate
console.log(`Frame drop rate: ${stats.frameDropRate.toFixed(2)}%`);

// Find slow handlers
Object.entries(stats.handlerStats).forEach(([name, handlerStats]) => {
  if (handlerStats.averageTime > 1.0) {
    console.log(`${name}: ${handlerStats.averageTime.toFixed(2)}ms avg`);
  }
});
```

**Key Metrics:**
- **frameDropCount**: Frames exceeding 16.67ms (60fps budget)
- **frameDropRate**: Percentage of dropped frames
- **handlerStats**: Per-handler execution times
- **executionOrder**: Which handlers ran and in what order

**Automatic Warnings:**
The system automatically logs warnings when frames exceed the 60fps budget, including details about slow handlers.

**See [Frame Timing Monitoring Guide](frame-timing-monitoring.md) for complete documentation.**

### Browser DevTools

**Check frame rate:**
1. Press `F12` (DevTools)
2. Rendering tab (may need to enable)
3. FPS meter checkbox
4. Watch real-time FPS

**Check GPU usage:**
1. DevTools → More Tools → Performance Monitor
2. Watch GPU usage percentage

### System Monitoring

Keep system monitor open while creating:
- Watch GPU usage
- Monitor temperature
- Check RAM usage
- Look for throttling

---

## Hardware Upgrades

If you hit performance limits consistently:

### Most Impact
1. **Better GPU** - #1 upgrade for Rhizomium
   - Mid-range modern card (RTX 3060, RX 6700) handles FHD easily
   - High-end (RTX 4070+, RX 7800+) for QHD/4K

2. **More VRAM** - For complex graphs with textures
   - 4GB minimum
   - 6-8GB recommended
   - 12GB+ for 4K with many textures

### Less Impact
- CPU upgrade - Rhizomium is GPU-bound
- RAM upgrade - Unless you have <8GB
- SSD upgrade - Only affects load times

---

## Summary

### Do This:
- Start with 1920×1080 resolution
- Limit noise nodes to 2-3 per graph
- Disable node previews when not needed
- Use simple math operations freely
- Close other GPU-intensive applications
- Monitor GPU temperature
- Update graphics drivers

### Avoid This:
- Don't use 5+ noise nodes
- Don't max out FBM octaves (use 3-4, not 8)
- Don't run at 4K on weak GPUs
- Don't leave many node previews enabled
- Don't use Firefox/Safari for production
- Don't ignore thermal throttling

---

## Next Steps

- **[Interface Overview](interface.md)** - Learn the UI
- **[Keyboard Shortcuts](shortcuts.md)** - Speed up workflow
- **[Node Reference](node-reference.md)** - Find efficient alternatives
- **[FAQ](faq-web.md)** - More questions answered

---

_Optimize smart, create smooth, perform flawlessly!_
