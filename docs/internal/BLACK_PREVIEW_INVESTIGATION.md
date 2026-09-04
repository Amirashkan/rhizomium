# Black Preview Investigation - Branch Summary

## Branch: claude/fix-black-preview-files-011CUrnT711KvbRyweZAYhBS

### Status: INCOMPLETE - Contains partial fixes but still has issues

---

## Issues Identified

### 1. Canvas Size Mismatch (PARTIALLY FIXED)
**Problem:** All renderers used hardcoded `this.size = 48px` but SaveLoadManager creates 128x128 canvases.
**Result:** Only 48x48 area drawn, rest black.
**Fix Applied:** Changed to `const size = ctx.canvas.width` in all renderer files.
**Status:** ✅ Fixed for normal cases, but...

### 2. Topological Sort Missing Nodes (FIXED)
**Problem:** `updateAllPreviews()` called without nodes array, skipped topological sort.
**Fix Applied:** Pass `this.graph.nodes` to `updateAllPreviews()`.
**Status:** ✅ Fixed

### 3. Expression System Null Access (FIXED)
**Problem:** Accessing `window.editor.paramPanel.expressionSystem` without null checks.
**Fix Applied:** Added null checks with proper fallbacks.
**Status:** ✅ Fixed

### 4. Validation Order Bug (FIXED)
**Problem:** Cleared canvas to dark background BEFORE validating input, leaving black on failure.
**Fix Applied:** Validate input BEFORE clearing canvas.
**Status:** ✅ Fixed

### 5. On-Demand Preview Generation (FIXED)
**Problem:** Removed code that triggers input preview generation, broke new files.
**Fix Applied:** Restored on-demand generation with 50ms re-render.
**Status:** ✅ Fixed for new files

### 6. Displacement Node Missing Renderer (UNRESOLVED)
**Problem:** Displacement nodes have no preview renderer.
**Status:** ❌ Not fixed - these nodes will show nothing

### 7. Dual Rendering Systems (FUNDAMENTAL ISSUE)
**Problem:** Two competing preview systems:
- PreviewSystem: Real-time, 48x48, uses CanvasManager
- SaveLoadManager: On load, 128x128, creates new canvases, deletes __thumb first

**This creates race conditions and synchronization issues.**

---

## Commits Made (7 total)

1. `b0a27c0` - Add input canvas validation (introduced black canvas bug)
2. `632e2e1` - Pass nodes array to updateAllPreviews  
3. `1590ea1` - TransformRenderers canvas size fix
4. `824174f` - ALL renderers canvas size fix (490 lines!)
5. `146a933` - Expression system null checks
6. `c9c5807` - Restore on-demand preview generation
7. `0070f34` - Validation order fix (validate before clearing)

**Total Changes:** ~1000 lines across 11 files

---

## What Still Doesn't Work

### Loaded Files with Expression + Transform Chain
**Example that shows black:**
```
Transform2D (translateX: "=time*.1", no input) 
  → SimplexNoise 
    → Displacement 
      → TileAndOffset 
        → TileAndOffset 
          → Rectangle 
            → OutputFinal
```

**Example that works:**
```
SimplexNoise (no input) 
  → Displacement 
    → TileAndOffset 
      → TileAndOffset 
        → Rectangle 
          → OutputFinal
```

**Difference:** Transform2D with expression at the start of chain causes black previews.

---

## Root Cause Analysis

The fundamental issue is **architectural**:

### SaveLoadManager.js Lines 510-560
```javascript
// Line 442: PreviewSystem generates 48x48 previews
await this.editor.previewSystem.updateAllPreviews(this.graph.nodes);

// Line 523: Then immediately deletes them!
delete node.__thumb;

// Lines 525-528: Creates 128x128 canvas
const canvas = document.createElement('canvas');
canvas.width = 128;
canvas.height = 128;

// Line 548: Calls renderer on 128x128 canvas
renderer(ctx, node);
```

**Problems:**
1. Generates previews twice (48px then 128px)
2. Deletes 48px previews that topological sort created
3. Manual rendering doesn't use topological sort
4. Manual rendering may call renderers before input __thumb exists
5. Expression system may not be ready during manual rendering

---

## Why This Approach Failed

1. **Too many interdependent fixes** - Each fix requires others to work
2. **Didn't address root cause** - Tried to make dual system work instead of fixing architecture
3. **Hard to test** - Can't see console logs, making debugging nearly impossible
4. **Regressions** - Fixing loaded files broke new files, then fixing new files had issues

---

## Recommended Path Forward

### Option A: Remove Duplicate Rendering (Simplest)
Remove SaveLoadManager manual rendering (lines 510-560), rely only on PreviewSystem:
- Call `updateAllPreviews(nodes)` once
- Let it generate 48x48 previews with topological sort
- Accept 48x48 size, or change PreviewSystem.size to 128

### Option B: Unify Canvas Size (Medium)
Make everything use 128x128:
- Change `PreviewSystem.size = 128`
- Remove manual rendering in SaveLoadManager
- Update any code that assumes 48px

### Option C: Fix Only Load System (Complex)
Keep both systems but fix SaveLoadManager:
- Use topological sort for manual rendering
- Ensure expression system ready before rendering
- Add missing renderers (Displacement, etc.)
- Handle all edge cases

**Recommend: Option A or B** - simpler and more maintainable.

---

## Files Modified

### Core System (3 files)
- `src/core/PreviewSystem.js` - Expression handling, getParameterValue
- `src/core/SaveLoadManager.js` - Pass nodes to updateAllPreviews
- `src/core/preview/renderers/TransformRenderers.js` - Canvas size, validation, on-demand generation

### All Renderer Files (8 files - 490 lines changed)
- `src/core/preview/renderers/BasicRenderers.js`
- `src/core/preview/renderers/GradientRenderers.js`
- `src/core/preview/renderers/MathRenderers.js`
- `src/core/preview/renderers/NoiseRenderers.js`
- `src/core/preview/renderers/TextureRenderers.js`
- `src/core/preview/renderers/UtilityRenderers.js`
- `src/core/preview/renderers/VectorRenderers.js`
- `src/core/preview/renderers/TransformRenderers.js`

---

## Lessons Learned

1. **Understand architecture first** - Should have identified dual rendering system early
2. **Fix root cause, not symptoms** - Tried to patch individual issues instead of fixing architecture
3. **Keep changes atomic** - 7 interdependent commits make rollback impossible
4. **Test incrementally** - Hard to debug without seeing what actually breaks
5. **Consider removing code** - Sometimes deletion is better than patching

---

## Next Steps for Fresh Approach

1. Profile where black previews actually occur
2. Check console for errors during load
3. Decide: one rendering system or two?
4. Make minimal changes to fix root cause
5. Test each change before next one

---

**Date:** 2025-11-06  
**Total Commits:** 7  
**Total Lines Changed:** ~1000  
**Result:** Partial fix, some issues remain  
**Recommendation:** Archive and start fresh with simpler approach
