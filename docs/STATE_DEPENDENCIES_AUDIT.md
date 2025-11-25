# State Dependencies & Invalidations Audit

**Date:** 2025-01-25  
**Goal:** Identify what state changes genuinely require a redraw versus those that can be deferred or ignored.

---

## Executive Summary

This audit maps all state mutation points in the GLSL node editor to their redraw requirements. The system uses a dirty flag mechanism (`Editor._isDirty`) with region-based tracking to optimize rendering. Key findings:

- **106+ `markDirty()` call sites** across the codebase
- **6 tracked dirty regions:** `general`, `viewport`, `nodes`, `connections`, `previews`, `selection`
- **Main render loop** checks dirty flag every frame (60 FPS) via `RenderLoop` → `handleRenderFrame()` → `Editor.draw()`
- **Frame-based throttling** exists for panning (skip every 2nd frame = ~30 FPS during pan)

---

## 1. State Management Architecture

### 1.1 Core State Stores

The codebase does not use a centralized state store pattern. Instead, state is distributed across:

| Component | State Location | Mutation Methods |
|-----------|---------------|------------------|
| **Graph** | `src/data/Graph.js` | `add()`, `remove()`, `addConnection()`, `removeConnection()` |
| **Editor** | `src/core/Editor.js` | Direct property mutations, `markDirty()` |
| **Viewport** | `src/core/ViewportManager.js` | `updatePan()`, `setZoom()`, `setOffset()` |
| **Selection** | `src/core/SelectionManager.js` | `select()`, `deselect()`, `updateDrag()` |
| **Connections** | `src/core/ConnectionManager.js` | `startWireDrag()`, `endWireDrag()` |
| **Parameters** | `src/ui/ParameterPanel.js` | `updateNodeParameter()`, `setValue()` |
| **Preview** | `src/core/preview/PreviewIntegration.js` | `onParameterChange()`, `generateNodePreview()` |

### 1.2 Dirty Flag System

**Location:** `src/core/Editor.js:844-915`

```javascript
// Dirty flag tracking
this._isDirty = true; // Start as dirty for initial render
this._dirtyReasons = new Set();
this._dirtyRegionState = new Map(); // Tracks 6 regions
this._trackedDirtyRegions = ['general', 'viewport', 'nodes', 'connections', 'previews', 'selection'];
```

**Redraw Pipeline:**
```
State Mutation → markDirty(reason, region) → _isDirty = true
                                          → RenderLoop (60 FPS)
                                          → Editor.draw() [checks _isDirty]
                                          → Renderer.render()
                                          → clearDirty()
```

---

## 2. State Mutation Catalog

### 2.1 Graph Structure Mutations

| Mutation | Location | Triggers markDirty? | Region | Must Repaint? | Notes |
|----------|----------|---------------------|--------|---------------|-------|
| **Node Creation** | `SelectionManager.createNode()` | ✅ Yes | `nodes` | ✅ **MUST** | New node appears on canvas |
| **Node Deletion** | `SelectionManager.deleteSelected()` | ✅ Yes | `nodes` | ✅ **MUST** | Node removed from canvas |
| **Node Position** | `SelectionManager.updateDrag()` | ✅ Yes | `nodes` | ✅ **MUST** | Visual position changes |
| **Connection Add** | `ConnectionManager.endWireDrag()` | ✅ Yes | `connections` | ✅ **MUST** | Wire appears on canvas |
| **Connection Remove** | `ConnectionManager.removeConnection()` | ✅ Yes | `connections` | ✅ **MUST** | Wire disappears |
| **Graph Load** | `SaveLoadManager.loadGraph()` | ✅ Yes | `general` | ✅ **MUST** | Full scene replacement |

**Code References:**
- `src/core/SelectionManager.js:200-250` (node creation)
- `src/core/ConnectionManager.js:48-200` (connection creation)
- `src/core/SaveLoadManager.js:400-600` (graph loading)

### 2.2 Viewport Mutations

| Mutation | Location | Triggers markDirty? | Region | Must Repaint? | Notes |
|----------|----------|---------------------|--------|---------------|-------|
| **Pan (mousemove)** | `EventHandler._setupPanEvents()` | ✅ Yes | `viewport` | ✅ **MUST** | Camera position changes |
| **Zoom (wheel)** | `EventHandler._setupZoomEvents()` | ✅ Yes | `viewport` | ✅ **MUST** | Scale changes |
| **Zoom (Ctrl+drag)** | `EventHandler._setupDragZoomEvents()` | ✅ Yes | `viewport` | ✅ **MUST** | Scale changes |
| **Viewport Reset** | `ViewportManager.reset()` | ✅ Yes | `viewport` | ✅ **MUST** | Camera reset |

**Optimization:** Frame-based throttling during panning (skip every 2nd frame) - `Editor.draw():953-973`

**Code References:**
- `src/core/EventHandler.js:200-400` (pan/zoom handlers)
- `src/core/ViewportManager.js` (viewport state)

### 2.3 Selection Mutations

| Mutation | Location | Triggers markDirty? | Region | Must Repaint? | Notes |
|----------|----------|---------------------|--------|---------------|-------|
| **Select Node** | `SelectionManager.select()` | ✅ Yes | `selection` | ✅ **MUST** | Highlight appears |
| **Deselect** | `SelectionManager.deselect()` | ✅ Yes | `selection` | ✅ **MUST** | Highlight disappears |
| **Box Select** | `SelectionManager.updateBoxSelect()` | ✅ Yes | `selection` | ✅ **MUST** | Selection box drawn |
| **Multi-select** | `SelectionManager.selectMultiple()` | ✅ Yes | `selection` | ✅ **MUST** | Multiple highlights |

**Code References:**
- `src/core/SelectionManager.js:150-300` (selection logic)

### 2.4 Parameter Mutations

| Mutation | Location | Triggers markDirty? | Region | Must Repaint? | Notes |
|----------|----------|---------------------|--------|---------------|-------|
| **Parameter Change** | `ParameterValueManager.updateNodeParameter()` | ⚠️ **Conditional** | `previews` | ⚠️ **OPTIONAL** | Only if preview visible |
| **Parameter Drag** | `ParameterExpressionSystem.setupNumericDragSupport()` | ⚠️ **Conditional** | `previews` | ⚠️ **OPTIONAL** | Throttled during drag |
| **Expression Change** | `ParameterExpressionSystem.updateExpressionDisplay()` | ❌ No | N/A | ❌ **NO** | UI-only (input field) |
| **MIDI Parameter** | `MIDIParameterBinding.onMIDIChange()` | ⚠️ **Conditional** | `previews` | ⚠️ **OPTIONAL** | Deferred until MIDI stops |

**Critical Finding:** Parameter changes trigger `onChange()` → shader recompilation, but canvas redraw is **optional** unless:
1. Node preview is visible
2. Parameter affects node label display
3. Parameter is referenced in expressions used by visible nodes

**Code References:**
- `src/ui/components/ParameterValueManager.js:371-391` (parameter updates)
- `src/core/preview/PreviewIntegration.js:121-188` (preview updates)
- `src/utils/ParameterExpressionSystem.js:1154-1275` (drag handling)

### 2.5 Preview Mutations

| Mutation | Location | Triggers markDirty? | Region | Must Repaint? | Notes |
|----------|----------|---------------------|--------|---------------|-------|
| **Preview Generate** | `PreviewIntegration.generateNodePreview()` | ✅ Yes | `previews` | ✅ **MUST** | Preview thumbnail updates |
| **Preview Compute** | `PreviewComputer.computePreviews()` | ❌ No | N/A | ❌ **NO** | Background computation only |
| **Preview Cache Invalidate** | `PreviewSystem.canvasManager.canvasCache.delete()` | ✅ Yes | `previews` | ✅ **MUST** | Cache cleared, needs redraw |

**Optimization:** Preview updates are debounced (16ms = ~60 FPS) - `PreviewIntegration.js:134-136`

**Code References:**
- `src/core/preview/PreviewIntegration.js:188-250` (preview generation)
- `src/core/PreviewComputer.js` (computation)

### 2.6 Undo/Redo Mutations

| Mutation | Location | Triggers markDirty? | Region | Must Repaint? | Notes |
|----------|----------|---------------------|--------|---------------|-------|
| **Undo** | `UndoManager.undo()` | ✅ Yes | `general` | ✅ **MUST** | State restored, full redraw |
| **Redo** | `UndoManager.redo()` | ✅ Yes | `general` | ✅ **MUST** | State restored, full redraw |

**Code References:**
- `src/core/UndoManager.js:200-400` (undo/redo logic)

### 2.7 Wire Drag Mutations

| Mutation | Location | Triggers markDirty? | Region | Must Repaint? | Notes |
|----------|----------|---------------------|--------|---------------|-------|
| **Wire Drag Start** | `ConnectionManager.startWireDrag()` | ✅ Yes | `connections` | ✅ **MUST** | Temporary wire appears |
| **Wire Drag Update** | `ConnectionManager.updateWireDrag()` | ✅ Yes | `connections` | ✅ **MUST** | Wire follows cursor |
| **Wire Drag End** | `ConnectionManager.endWireDrag()` | ✅ Yes | `connections` | ✅ **MUST** | Connection created or cancelled |

**Code References:**
- `src/core/ConnectionManager.js:15-200` (wire drag)

### 2.8 Background/System Mutations

| Mutation | Location | Triggers markDirty? | Region | Must Repaint? | Notes |
|----------|----------|---------------------|--------|---------------|-------|
| **Background Warmup** | `EventHandler._startContinuousWarmup()` | ✅ Yes | `general` | ❌ **NO** | Unnecessary redraw |
| **Window Resize** | `Editor.resize()` | ✅ Yes | `general` | ✅ **MUST** | Canvas size changes |
| **Focus/Visibility** | `EventHandler._setupFocusHandlers()` | ✅ Yes | `general` | ❌ **NO** | Unnecessary redraw |
| **Animation Frame** | `main.js:handleRenderFrame()` | ⚠️ **Conditional** | N/A | ⚠️ **OPTIONAL** | Only if time-based expressions exist |

**Critical Finding:** Background warmup triggers unnecessary redraws every 300ms when idle.

**Code References:**
- `src/core/EventHandler.js:113-180` (background warmup)
- `main.js:2025-2077` (render loop)

---

## 3. Decision Matrix: Must Repaint vs Optional

### 3.1 Must Repaint (Visual State Changes)

| Category | State Change | Reason | Priority |
|----------|--------------|--------|----------|
| **Graph Structure** | Node add/remove | Node appears/disappears | 🔴 **CRITICAL** |
| **Graph Structure** | Connection add/remove | Wire appears/disappears | 🔴 **CRITICAL** |
| **Viewport** | Pan/zoom | Camera transform changes | 🔴 **CRITICAL** |
| **Selection** | Select/deselect | Highlight changes | 🟡 **HIGH** |
| **Wire Drag** | Drag start/update/end | Temporary wire drawn | 🔴 **CRITICAL** |
| **Node Position** | Drag node | Node moves on canvas | 🔴 **CRITICAL** |
| **Preview** | Preview thumbnail update | Preview image changes | 🟡 **HIGH** |
| **Window** | Resize | Canvas dimensions change | 🔴 **CRITICAL** |

### 3.2 Optional/Deferrable (Non-Visual or Background)

| Category | State Change | Reason | Optimization |
|----------|--------------|--------|--------------|
| **Parameter** | Parameter value change (no preview) | Only affects shader, not canvas | ✅ **Skip redraw** |
| **Parameter** | MIDI parameter (during drag) | Deferred until drag ends | ✅ **Defer 500ms** |
| **Preview** | Preview computation | Background GPU work | ✅ **No redraw** |
| **Expression** | Expression validation | UI-only (input field) | ✅ **Skip redraw** |
| **Background** | Warmup timer | Unnecessary | ✅ **Remove markDirty** |
| **Animation** | Frame (no time expressions) | No visual change | ✅ **Skip redraw** |

### 3.3 Conditional (Context-Dependent)

| Category | State Change | Condition for Redraw | Implementation |
|----------|--------------|----------------------|----------------|
| **Parameter** | Parameter change | Preview visible OR affects label | Check `nodePreviews.has(nodeId)` |
| **Animation** | Frame update | Time-based expressions exist | Check `hasActiveAnimations()` |
| **Preview** | Preview update | Node visible in viewport | Check viewport bounds |

---

## 4. Indirect Dependencies Analysis

### 4.1 Shader Uniform Dependencies

**Risk:** Parameter changes affect shader uniforms, which affect GPU rendering, but may not require canvas redraw.

**Current Behavior:**
- Parameter change → `onChange()` → shader recompilation → GPU render
- Canvas redraw triggered separately via `markDirty('previews')`

**Recommendation:** ✅ **Correct** - Canvas and GPU are separate render targets. Parameter changes should NOT trigger canvas redraw unless preview is visible.

### 4.2 Expression Dependencies

**Risk:** Parameter changes affect expression evaluations, which affect downstream node values, which affect previews.

**Current Behavior:**
- Parameter change → `PreviewIntegration.onParameterChange()` → debounced preview update → `markDirty('previews')`

**Recommendation:** ✅ **Correct** - Expression dependencies are tracked via `findDownstreamNodes()`. Preview updates are properly debounced.

### 4.3 Graph Execution Order Dependencies

**Risk:** Connection changes affect execution order, which affects preview computation order.

**Current Behavior:**
- Connection change → `Graph.markExecutionOrderDirty()` → `Graph.getExecutionOrder()` recomputes
- Preview computation uses execution order

**Recommendation:** ✅ **Correct** - Execution order is cached and only recomputed when structure changes.

### 4.4 MIDI Parameter Dependencies

**Risk:** MIDI parameter changes during drag trigger excessive preview updates.

**Current Behavior:**
- MIDI change → `Editor.handleParameterChangeForExpressions()` → deferred update (500ms)
- Updates batched until MIDI stops

**Recommendation:** ✅ **Correct** - MIDI updates are properly deferred.

---

## 5. Candidates for Throttling/Caching

### 5.1 High-Priority Optimizations

| Optimization | Current Behavior | Proposed Change | Impact |
|--------------|------------------|-----------------|--------|
| **Background Warmup** | `markDirty('background-warmup')` every 300ms | Remove `markDirty()` call | 🟢 **HIGH** - Eliminates unnecessary redraws |
| **Parameter Drag** | Redraw on every mouse move | Throttle to 30 FPS during drag | 🟢 **MEDIUM** - Smoother interaction |
| **Preview Updates** | Debounced 16ms | Increase to 33ms (30 FPS) for non-visible nodes | 🟢 **MEDIUM** - Reduces computation |
| **Animation Frame** | Always calls `editor.draw()` | Check `hasActiveAnimations()` first | 🟢 **HIGH** - Skips redraw when static |

### 5.2 Medium-Priority Optimizations

| Optimization | Current Behavior | Proposed Change | Impact |
|--------------|------------------|-----------------|--------|
| **Expression Validation** | No redraw (correct) | N/A - Already optimal | ✅ |
| **Preview Computation** | No redraw (correct) | N/A - Already optimal | ✅ |
| **Selection Box** | Redraw on every mouse move | Already throttled via RAF | ✅ |
| **Node Drag** | Redraw on every mouse move | Already throttled via RAF | ✅ |

### 5.3 Caching Opportunities

| Cache Target | Current Behavior | Proposed Change | Impact |
|--------------|------------------|-----------------|--------|
| **Grid Rendering** | Rendered every frame | ✅ **Already cached** (offscreen canvas) | ✅ |
| **Node Pin Positions** | Computed every frame | ✅ **Already cached** during panning | ✅ |
| **Topological Sort** | Cached in Graph | ✅ **Already cached** | ✅ |
| **Preview Thumbnails** | Cached in PreviewSystem | ✅ **Already cached** | ✅ |

---

## 6. Implementation Recommendations

### 6.1 Immediate Actions

1. **Remove Background Warmup Redraws**
   ```javascript
   // src/core/EventHandler.js:144
   // REMOVE: this.editor.markDirty('background-warmup');
   // Background warmup should not trigger redraws
   ```

2. **Conditional Animation Frame Redraws**
   ```javascript
   // main.js:handleRenderFrame()
   if (editor?.draw && (editor.isDirty() || editor.hasActiveAnimations())) {
     editor.draw();
   }
   ```

3. **Skip Parameter Redraws When Preview Hidden**
   ```javascript
   // src/core/preview/PreviewIntegration.js:121
   onParameterChange(node, immediate = false) {
     // Only mark dirty if preview is visible
     if (this.editor.nodePreviews.has(node.id)) {
       this.editor.markDirty('previews', 'previews');
     }
   }
   ```

### 6.2 Medium-Term Improvements

1. **Viewport-Based Preview Filtering**
   - Only update previews for nodes visible in viewport
   - Use viewport bounds to filter node list

2. **Parameter Drag Throttling**
   - Throttle preview updates to 30 FPS during drag
   - Use `requestAnimationFrame` with frame skipping

3. **Region-Based Partial Redraws**
   - Implement dirty region clipping in `Renderer.render()`
   - Only redraw affected regions (e.g., single node preview)

### 6.3 Long-Term Architecture

1. **Centralized State Store**
   - Consider implementing a state store (e.g., Redux-like pattern)
   - Centralize all state mutations and redraw triggers

2. **Render Target Separation**
   - Clearly separate canvas (UI) and GPU (shader) render targets
   - Prevent cross-contamination of dirty flags

3. **Performance Monitoring**
   - Add metrics for redraw frequency by reason
   - Track unnecessary redraws via `RedrawDiagnostics`

---

## 7. Risk Assessment

### 7.1 Missing Indirect Dependencies

**Risk Level:** 🟡 **MEDIUM**

**Potential Issues:**
1. **Shader Uniform Updates:** Parameter changes affect GPU rendering but may not be reflected in canvas previews
   - **Mitigation:** Preview system already handles this via `PreviewIntegration`

2. **Expression Chain Updates:** Parameter changes affect downstream nodes via expressions
   - **Mitigation:** `findDownstreamNodes()` tracks dependencies

3. **Execution Order Changes:** Connection changes affect computation order
   - **Mitigation:** Execution order is cached and invalidated correctly

### 7.2 Over-Optimization Risks

**Risk Level:** 🟢 **LOW**

**Potential Issues:**
1. **Skipping Required Redraws:** Over-aggressive filtering may skip necessary updates
   - **Mitigation:** Use region-based dirty tracking to ensure all visual changes are captured

2. **Stale Previews:** Deferred updates may show stale data
   - **Mitigation:** Defer only during drag, update immediately on release

---

## 8. Testing Recommendations

### 8.1 Unit Tests

1. **Dirty Flag Logic**
   - Test `markDirty()` sets correct regions
   - Test `draw()` only renders when dirty
   - Test `clearDirty()` resets all regions

2. **Conditional Redraws**
   - Test animation frame skips when no animations
   - Test parameter changes skip redraw when preview hidden

### 8.2 Integration Tests

1. **Parameter Change Flow**
   - Parameter change → preview update → canvas redraw (only if visible)

2. **Viewport Change Flow**
   - Pan/zoom → viewport dirty → canvas redraw

3. **Graph Mutation Flow**
   - Node add → nodes dirty → canvas redraw

### 8.3 Performance Tests

1. **Redraw Frequency**
   - Measure redraws per second during idle
   - Measure redraws per second during interaction
   - Target: < 1 redraw/second when idle

2. **Frame Time**
   - Measure frame time with/without optimizations
   - Target: < 16ms per frame (60 FPS)

---

## 9. Appendix: Code Reference Map

### 9.1 markDirty() Call Sites

| File | Line | Reason | Region |
|------|------|--------|--------|
| `src/core/EventHandler.js` | 144 | `background-warmup` | `general` |
| `src/core/EventHandler.js` | 198 | `user-interaction` | `general` |
| `src/core/Editor.js` | 844 | Various | Various |
| `src/core/SelectionManager.js` | 200+ | `node-creation`, `node-deletion` | `nodes` |
| `src/core/ConnectionManager.js` | 150+ | `connection-added`, `connection-removed` | `connections` |
| `src/core/preview/PreviewIntegration.js` | 160+ | `preview-update` | `previews` |
| `src/ui/ParameterPanel.js` | 1680+ | `parameter-change` | `previews` |

### 9.2 Redraw Trigger Points

| Trigger | Location | Frequency |
|---------|----------|-----------|
| **Render Loop** | `main.js:handleRenderFrame()` | 60 FPS |
| **User Interaction** | `EventHandler._requestDraw()` | Event-driven |
| **State Mutation** | Various `markDirty()` calls | Event-driven |
| **Background Warmup** | `EventHandler._startContinuousWarmup()` | Every 300ms (idle) |

---

## 10. Conclusion

The state dependency system is **generally well-architected** with proper dirty flag tracking and region-based invalidation. Key improvements:

1. ✅ **Remove background warmup redraws** (high impact, low risk)
2. ✅ **Conditional animation frame redraws** (high impact, low risk)
3. ✅ **Skip parameter redraws when preview hidden** (medium impact, low risk)

The system correctly separates canvas (UI) and GPU (shader) render targets, and expression dependencies are properly tracked. The main optimization opportunities are eliminating unnecessary redraws during idle periods and conditional redraws based on actual visual changes.

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-25  
**Next Review:** After implementing recommended optimizations

