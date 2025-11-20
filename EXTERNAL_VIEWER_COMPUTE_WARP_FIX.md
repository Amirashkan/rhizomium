# External Viewer ComputeWarp Node Fix

## Problem

The `ComputeWarp` node was not displaying its distortion effect in the external viewer (`viewer-live.html`), even though it worked correctly in the floating preview.

## Root Causes

### 1. Missing Topological Sorting
**Issue:** Compute nodes were executing in the order they were received, not in dependency order. This meant the warp field (second input) might not be executed before the warp node tried to use it.

**Fix:** Added `_topologicalSortComputeNodes()` function that performs a topological sort using DFS to ensure dependencies execute before dependents.

**Location:** `viewer-live.html` lines ~1114-1193

### 2. Incorrect Parameter Packing
**Issue:** The warp node parameters were being packed using a generic fallback that iterates through object keys in arbitrary order. The WGSL shader expects parameters in a specific order matching the uniform struct.

**Fix:** Added explicit parameter packing for `ComputeWarp` that matches the WGSL struct order exactly:
- `strength` (index 3)
- `centerX` (index 4)
- `centerY` (index 5)
- `radius` (index 6)
- `frequency` (index 7)
- `phase` (index 8)

**Location:** `viewer-live.html` lines ~1512-1535

### 3. Input Node ID Matching
**Issue:** Input node IDs might be in different formats (string vs number, with/without prefixes), causing the warp field texture to not be found.

**Fix:** Improved input node ID matching to try multiple formats:
- Direct match
- With "node_" prefix
- Normalized IDs (removing special characters)
- Alternative formats

**Location:** `viewer-live.html` lines ~1688-1735

## Implementation Details

### Topological Sort
```javascript
_topologicalSortComputeNodes(computeNodes) {
    // Build dependency graph from node inputs
    // Perform DFS topological sort
    // Return nodes in dependency order
}
```

### Parameter Packing
```javascript
else if (nodeData.kind === 'ComputeWarp') {
    // Match WGSL struct order exactly
    uniformData[3] = this._evaluateParam(liveParams.strength ?? params?.strength, 0.5, time);
    uniformData[4] = this._evaluateParam(liveParams.centerX ?? params?.centerX, 0.5, time);
    uniformData[5] = this._evaluateParam(liveParams.centerY ?? params?.centerY, 0.5, time);
    uniformData[6] = this._evaluateParam(liveParams.radius ?? params?.radius, 0.5, time);
    uniformData[7] = this._evaluateParam(liveParams.frequency ?? params?.frequency, 4.0, time);
    uniformData[8] = this._evaluateParam(liveParams.phase ?? params?.phase, 0.0, time);
}
```

### Input Matching
```javascript
// Try multiple ID formats for matching
let computeOutput = this.computeOutputs.get(inputNodeId);
if (!computeOutput) {
    computeOutput = this.computeOutputs.get('node_' + inputNodeId);
}
if (!computeOutput) {
    const normalizedId = String(inputNodeId).replace(/[^a-zA-Z0-9_]/g, '_');
    computeOutput = this.computeOutputs.get(normalizedId);
}
```

## Related Nodes

### ComputeMix
- **Status:** ✅ Already has explicit parameter packing
- **Inputs:** 2 (Input A, Input B)
- **Note:** Uses same second input binding (4) as ComputeWarp

### ComputeParticles
- **Status:** ⚠️ Has 2 inputs but may need similar fixes
- **Inputs:** 2 (Force Field, Velocity Field)
- **Action:** Verify if it needs topological sorting and parameter packing fixes

## Testing

To verify the fix works:

1. **Create a warp node setup:**
   - Add a `ComputeNoise` node (node 28)
   - Add a `ComputePattern` node (node 29)
   - Add a `ComputeWarp` node (node 27)
   - Connect node 28 → node 27 input 0 (texture)
   - Connect node 29 → node 27 input 1 (warp field)

2. **Check console logs:**
   - Should see: `[LiveViewer] Compute node execution order: 28(ComputeNoise) -> 29(ComputePattern) -> 27(ComputeWarp)`
   - Should see: `[LiveViewer] ✓ Node 27 input 0 from compute node 28`
   - Should see: `[LiveViewer] ✓ Node 27 input 1 from compute node 29`
   - Should see: `[LiveViewer] ComputeWarp node 27: Added warp field (binding 4) from input 29, isValid: true`

3. **Verify visual effect:**
   - The warp distortion should be visible in the external viewer
   - Adjusting warp parameters (strength, mode, etc.) should update in real-time

## Debugging

If the warp effect still doesn't work:

1. **Check execution order:**
   ```javascript
   // Look for this log:
   [LiveViewer] Compute node execution order: ...
   ```

2. **Check input connections:**
   ```javascript
   // Should see both inputs connected:
   [LiveViewer] ✓ Node 27 input 0 from compute node 28
   [LiveViewer] ✓ Node 27 input 1 from compute node 29
   ```

3. **Check parameter packing:**
   ```javascript
   // Should see warp parameters logged:
   [LiveViewer] ComputeWarp packed uniforms: {strength: ..., centerX: ..., ...}
   ```

4. **Check bind group:**
   ```javascript
   // Should see warp field added:
   [LiveViewer] ComputeWarp node 27: Added warp field (binding 4) from input 29, isValid: true
   ```

## Future Improvements

1. **Automatic parameter packing:** Generate parameter packing code from WGSL struct definitions
2. **Dependency validation:** Warn if dependencies are missing or circular
3. **Input validation:** Validate that all required inputs are connected before execution

