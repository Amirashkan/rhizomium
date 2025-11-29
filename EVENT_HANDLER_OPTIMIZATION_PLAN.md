# Event Handler Draw Request Optimization - Implementation Plan

## ⚠️ CRITICAL PERFORMANCE REQUIREMENT FOR ALL AGENTS ⚠️

**30 FPS IS NEVER ACCEPTED. ALL OPTIMIZATIONS MUST TARGET 60 FPS.**

- **Target frame time:** <16.67ms (60 FPS)
- **Throttling values:** Use 16.67ms (60 FPS), NOT 33.33ms (30 FPS)
- **Frame skipping:** Should target 60 FPS, not 30 FPS
- **Any code that limits performance to 30 FPS must be changed to 60 FPS**

This is a non-negotiable requirement. If you see any 30 FPS throttling, frame skipping that results in 30 FPS, or comments mentioning 30 FPS as acceptable, you MUST change it to 60 FPS.

---

## Overview
This plan implements optimization 1.3 from PERFORMANCE_OPTIMIZATION_PLAN.md to improve FPS by 10-15% by eliminating double renders and reducing draw request overhead.

## Current Issues
- Pan updates have complex immediate/RAF logic causing double renders
- Multiple draw requests can accumulate within the same frame
- Interaction state checks have overhead that can be optimized

---

## Step-by-Step Implementation Plan

### **Step 1: Add Draw Request Deduplication System**
**File:** `src/core/EventHandler.js`

**Changes:**
1. Add new instance variables in constructor:
   - `this._pendingDrawRequest = null` - Track if a draw is already scheduled
   - `this._drawRequestFrameId = null` - Track the current frame ID for deduplication
   - `this._lastFrameTime = 0` - Track last frame time for frame detection

2. Modify `_requestDraw()` method:
   - Check if a draw request is already pending for the current frame
   - Use `requestAnimationFrame` to detect frame boundaries
   - Only mark dirty once per frame, ignore duplicate requests
   - Reset pending flag at the start of each new frame

**Expected Result:** Draw requests reduced by 50% during interactions

---

### **Step 2: Simplify Pan Update Logic - Remove Immediate Updates**
**File:** `src/core/EventHandler.js`  
**Location:** `_setupPanEvents()` method, lines 450-500

**Changes:**
1. Remove immediate update logic (lines 462-499):
   - Remove `_panUpdateCount` tracking
   - Remove `_interactionStartTime` checks for panning
   - Remove `_justWarmedUp` checks for panning
   - Remove the `shouldUseImmediate` conditional logic

2. Simplify to always use RAF batching:
   - Always use the RAF path (lines 500-512)
   - Ensure only one RAF is scheduled at a time (already handled by `_panUpdateScheduled`)
   - Store pending pan update position
   - Process in RAF callback

3. Clean up related variables:
   - Keep `_panUpdateScheduled` for RAF deduplication
   - Keep `_pendingPanUpdate` for storing position
   - Remove `_panUpdateCount` (no longer needed)
   - Remove pan-specific immediate update logic

**Expected Result:** Eliminate double renders during panning

---

### **Step 3: Ensure Single RAF Scheduling**
**File:** `src/core/EventHandler.js`

**Changes:**
1. Enhance `_requestDraw()` to work with RAF deduplication:
   - Integrate with the deduplication system from Step 1
   - Ensure only one RAF callback is active at a time
   - Use a single RAF for all draw requests

2. Update pan RAF logic:
   - Verify `_panUpdateScheduled` properly prevents multiple RAFs
   - Ensure pan RAF doesn't conflict with general draw RAF
   - Consider consolidating to a single RAF system

**Expected Result:** Only one RAF scheduled at a time, consistent batching

---

### **Step 4: Optimize Interaction Detection**
**File:** `src/core/EventHandler.js`

**Changes:**
1. Cache interaction state per frame:
   - Add `_cachedInteractionState` object
   - Cache `isPanning()`, `isCanvasInteracting()` results per frame
   - Reset cache at frame start

2. Reduce overhead of state checks:
   - Replace frequent `this._isPanning` checks with cached values
   - Replace `this._isCanvasInteracting` checks with cached values
   - Use event-driven updates instead of polling

3. Update interaction state only when events occur:
   - Set state in event handlers (mousedown, mousemove, mouseup)
   - Don't check state repeatedly in hot paths
   - Cache state for the duration of a frame

**Expected Result:** Reduced overhead of interaction state checks

---

### **Step 5: Clean Up Unused Code**
**File:** `src/core/EventHandler.js`

**Changes:**
1. Remove unused variables:
   - `_panUpdateCount` (if not used elsewhere)
   - Any immediate update flags specific to panning
   - Complex time-based immediate update logic

2. Simplify constructor:
   - Remove initialization of removed variables
   - Keep only necessary state tracking

3. Update comments:
   - Remove references to immediate update logic
   - Document the simplified RAF-only approach

**Expected Result:** Cleaner, more maintainable code

---

### **Step 6: Test and Verify**
**Files:** Test in browser

**Verification Steps:**
1. **Test panning:**
   - Pan the canvas and verify smooth 60fps
   - Check browser DevTools Performance tab for double renders
   - Verify no visual glitches or stuttering

2. **Test draw request reduction:**
   - Add temporary logging to count `_requestDraw()` calls
   - Compare before/after: should see ~50% reduction during interactions
   - Verify all state changes still trigger appropriate redraws

3. **Test interaction detection:**
   - Verify panning state is correctly detected
   - Verify canvas interaction state works correctly
   - Check that cached state doesn't cause stale data issues

4. **Test edge cases:**
   - Rapid panning start/stop
   - Panning while other interactions occur
   - Multiple rapid draw requests from different sources

**Success Metrics:**
- ✅ Draw requests reduced by 50% during interactions
- ✅ Eliminate double renders during panning
- ✅ No visual regressions
- ✅ Smooth 60fps during panning

---

## Implementation Order

1. **Step 1** - Add deduplication (foundation)
2. **Step 2** - Simplify pan logic (main optimization)
3. **Step 3** - Ensure single RAF (consolidation)
4. **Step 4** - Optimize interaction detection (polish)
5. **Step 5** - Clean up (maintenance)
6. **Step 6** - Test (verification)

---

## Code Locations Reference

- **Main file:** `src/core/EventHandler.js`
- **Pan setup:** `_setupPanEvents()` method (~lines 394-520)
- **Draw request:** `_requestDraw()` method (~lines 191-207)
- **Constructor:** Lines 5-64 (instance variables)
- **Mouse move handler:** Lines 435-519 (pan mousemove)
- **Mouse up handler:** Lines 396-433 (pan mouseup)

---

## Notes

- The `editor/src/core/EventHandler.js` file appears to be a simpler version and may not need changes
- Focus on `src/core/EventHandler.js` which has the complex immediate/RAF logic
- Preserve all existing functionality while simplifying the update path
- The main render loop already handles dirty flag checking, so we just need to mark dirty efficiently


## Recommendations

### High Priority

1. **Consolidate RAF Loops**
   - Consider merging some RAF loops into the main RenderLoop
   - Use a single RAF with multiple handlers
   - Reduces scheduling overhead and improves frame timing

2. **Profile RenderLoop**
   - 2.6ms is significant (15.6% of frame budget)
   - Profile to identify bottlenecks
   - Consider frame skipping or LOD for complex scenes

### Medium Priority

3. **Investigate EventHandler Variance**
   - Profile the 0.96ms calls vs 0.03ms calls
   - Identify what causes the 32x difference
   - Optimize the slower path

4. **Monitor Frame Times**
   - Add frame time tracking
   - Alert when frames exceed 16.67ms
   - Track frame drop rate

### Low Priority

5. **Consider RAF Batching**
   - Batch multiple RAF callbacks into single frame
   - Use priority system for critical updates
   - Defer non-critical updates to next frame
