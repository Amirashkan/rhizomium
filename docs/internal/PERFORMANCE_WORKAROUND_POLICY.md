# Performance Workaround Policy

## ⚠️ CRITICAL: No Quality Degradation Workarounds

**This document serves as a permanent reminder to avoid workarounds that degrade user experience.**

### ⚠️ Smart Adaptive Quality (NEW APPROACH)

**Adaptive quality is now implemented as a safety net, not a default behavior:**

1. **Disabled by Default**
   - ✅ Adaptive quality is OFF by default
   - ✅ Only activates automatically when resources are actually running low
   - ✅ Users can enable "Light Mode" if they want it always on

2. **Automatic Activation (When Needed)**
   - ✅ Monitors frame times continuously
   - ✅ Only enables when average frame time consistently exceeds 20ms for 30+ frames
   - ✅ Automatically disables when performance recovers (<16ms for 60+ frames)
   - ✅ This is a safety net, not a default behavior

3. **Light Mode Option**
   - ✅ Users can enable "Light Mode" in settings for always-on adaptive quality
   - ✅ Disabled by default - users must explicitly opt-in
   - ✅ Clear labeling that it reduces quality

### ❌ FORBIDDEN Workarounds

**NEVER implement these "optimizations" as default behavior:**

1. **Resolution Reduction During Interactions (as default)**
   - ❌ Reducing canvas/preview resolution to 50%, 75%, or any value < 100% during EVERY interaction
   - ❌ Scaling down preview window size during ALL interactions
   - ❌ Reducing render quality during user interactions as a default
   - **Why:** Users need to see what they're working on at full quality. Degrading quality should only happen when resources are actually low, not preemptively.

2. **Quality Multipliers**
   - ❌ `qualityMultiplier < 1.0` for visible rendering
   - ❌ `minQualityMultiplier = 0.5` or any value < 1.0
   - ❌ Adaptive quality that reduces resolution/quality
   - **Why:** The preview must always show full quality. If performance can't handle it, fix the performance issues.

3. **Throttling Visible Rendering**
   - ❌ Throttling canvas redraws below 60 FPS for visible content
   - ❌ Frame skipping for visible previews
   - ❌ Reducing update frequency for visible UI elements
   - **Why:** Users expect smooth 60 FPS. Throttling visible content is a workaround, not a solution.

4. **Interaction-Based Degradation**
   - ❌ Reducing quality when user starts panning/dragging
   - ❌ "Adaptive quality" that degrades during interactions
   - ❌ Cooldown timers that gradually restore quality
   - **Why:** This is when users need full quality the most - they're actively working!

### ✅ ACCEPTABLE Optimizations

**These are real optimizations that don't degrade user experience:**

1. **Dirty Flag Tracking**
   - ✅ Only redraw when content actually changes
   - ✅ Skip redraws when scene is static
   - ✅ Track dirty regions and only update what changed

2. **Smart Caching**
   - ✅ Cache compiled shaders
   - ✅ Cache computed preview values
   - ✅ Reuse textures when inputs unchanged

3. **Efficient Algorithms**
   - ✅ Viewport culling (don't render off-screen nodes)
   - ✅ Incremental updates (only recompute changed nodes)
   - ✅ Batch operations (combine multiple updates)

4. **Background/Non-Visible Optimizations**
   - ✅ Throttle background worker operations
   - ✅ Defer non-critical computations
   - ✅ Skip updates for hidden/invisible elements

5. **Proper Batching**
   - ✅ Use requestAnimationFrame to batch updates
   - ✅ Accumulate state changes, render once per frame
   - ✅ Deduplicate draw requests

### 🎯 Performance Goals

**The code must achieve these targets WITHOUT quality degradation:**

- **60 FPS** during all interactions (panning, dragging, editing)
- **Full resolution** at all times (no scaling down)
- **Full quality** at all times (no quality multipliers)
- **<16.67ms** frame time consistently

### 📋 When Performance Issues Arise

**If performance targets aren't met, do this:**

1. **Profile first** - Use browser DevTools Performance tab
2. **Identify bottlenecks** - Find the actual slow code
3. **Fix the root cause** - Optimize the slow code
4. **Never degrade quality** - If you can't fix it, document it as a known issue

**DO NOT:**
- Add quality degradation as a "fix"
- Reduce resolution as a "workaround"
- Throttle visible rendering as an "optimization"

### 🔍 Code Review Checklist

Before merging any performance-related code, verify:

- [ ] No resolution reduction for visible content
- [ ] No quality multipliers < 1.0 for visible rendering
- [ ] No throttling of visible UI below 60 FPS
- [ ] No adaptive quality that degrades during interactions
- [ ] All optimizations use dirty flags, caching, or algorithmic improvements
- [ ] Performance improvements don't sacrifice visual quality

### 📝 Historical Context

**Removed workarounds (as examples of what NOT to do):**

- `FloatingGPUPreview` adaptive quality system (removed 2024)
- `FrameBudgetAllocator` quality multiplier (removed 2024)
- `InteractionStateManager` quality level reduction (removed 2024)
- Resolution scaling during interactions (removed 2024)

These were removed because they degraded user experience instead of fixing performance issues.

---

**Remember: If you can't make it fast, make it correct. Never make it fast by making it worse.**

