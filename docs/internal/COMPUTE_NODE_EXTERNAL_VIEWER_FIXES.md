# Compute Node External Viewer Fixes

This document describes the fixes implemented for real-time parameter updates in the external viewer for compute nodes, and potential fixes needed for other nodes.

## Problem Statement

Compute nodes (like `ComputeTransform`, `ComputeNoise`, etc.) use their own uniform buffers instead of the shared `u_params` buffer used by fragment nodes. This means their parameters are not included in the `uniformKeys` array, so they cannot be updated in real-time during parameter dragging using the standard `uniformValuesArray` approach.

## Solution Implemented

### 1. Parameter Update Flow

**Editor Side (`main.js`):**
- When `updateUniformsOnly` is called during parameter drag, it checks if the node is a compute node
- For compute nodes, it includes the node's current `params` object in the parameter update message
- This bypasses the `uniformKeys` limitation by sending parameters directly

**Stream Side (`LiveShaderStream.js`):**
- `sendParameterUpdate` now accepts an optional `computeNodeParams` parameter
- This parameter is included in the `parameter_update` message sent to viewers

**Viewer Side (`viewer-live.html`):**
- `handleParameterUpdate` receives `computeNodeParams` and updates the compute node's `params` object directly
- `executeComputeNode` uses these updated params when packing uniforms for the compute shader

### 2. Key Code Locations

#### Editor: `main.js` (lines ~541-556)
```javascript
// CRITICAL: For compute nodes, also include the node's current params
const graph = window.editor?.graph;
let computeNodeParams = null;
if (graph) {
  let node = graph.getNode(nodeId) || graph.getNode(String(nodeId));
  if (node && node.kind && node.kind.startsWith('Compute')) {
    computeNodeParams = {
      nodeId: String(nodeId),
      params: { ...node.params }
    };
  }
}
window.liveShaderStream.sendParameterUpdate(values, timeSec, computeNodeParams);
```

#### Stream: `src/framestream/LiveShaderStream.js` (lines ~470-495)
```javascript
sendParameterUpdate(uniformValues, time, computeNodeParams = null) {
  const message = {
    type: 'parameter_update',
    uniformValues: uniformValues,
    uniformKeys: uniformKeys,
    computeNodeParams: computeNodeParams, // Include compute node params
    time: time,
    timestamp: Date.now()
  };
  this.channel.postMessage(message);
}
```

#### Viewer: `viewer-live.html` (lines ~611-650)
```javascript
handleParameterUpdate(data) {
  const { uniformValues, uniformKeys, computeNodeParams, time } = data;
  
  // Update compute node params directly from computeNodeParams
  if (computeNodeParams && computeNodeParams.nodeId && computeNodeParams.params) {
    for (const nodeData of this.computeNodes) {
      if (String(nodeData.nodeId) === String(computeNodeParams.nodeId)) {
        // Update node's params object directly
        for (const [paramName, value] of Object.entries(computeNodeParams.params)) {
          const numValue = typeof value === 'number' ? value : parseFloat(value);
          if (!isNaN(numValue)) {
            nodeData.params[paramName] = numValue;
          }
        }
      }
    }
  }
}
```

## ComputeWarp Node Fix (2024)

### Problem
The `ComputeWarp` node was not displaying its distortion effect in the external viewer, even though it worked correctly in the floating preview.

### Root Causes
1. **Missing Topological Sorting:** Compute nodes executed in arbitrary order, so the warp field (second input) might not be ready when the warp node executed.
2. **Incorrect Parameter Packing:** Parameters were packed using generic fallback (arbitrary key order) instead of matching the WGSL struct order.
3. **Input ID Matching:** Input node IDs in different formats weren't being matched correctly.

### Fixes Applied
1. Added `_topologicalSortComputeNodes()` to ensure dependencies execute before dependents.
2. Added explicit parameter packing for `ComputeWarp` matching WGSL struct order.
3. Improved input node ID matching to handle multiple ID formats.

**See:** `EXTERNAL_VIEWER_COMPUTE_WARP_FIX.md` for detailed documentation.

## Known Issues and Fixes Needed

### Issue 1: ComputeNoise → ComputeTransform Color Loss

**Problem:** When `ComputeNoise` is connected to `ComputeTransform`, the output goes black and white even if `ComputeNoise` has `colorize: true`.

**Root Cause:** 
- The `colorize` parameter might not be properly registered in the uniform manager
- Or the texture format might be getting changed when Transform is added to the graph
- Or the `colorize` parameter value might be getting reset to `false` during graph recompilation

**Potential Fixes:**

1. **Ensure `colorize` is registered in uniform manager:**
   - Check that `ParameterUniformManager.analyzeNode` is called for `ComputeNoise`
   - Verify that `colorize` parameter is included in `uniformKeys` when it's a boolean
   - The current code converts booleans to 1.0/0.0, which should work

2. **Check texture format consistency:**
   - Verify that `ComputeNoise` output texture format matches what `ComputeTransform` expects
   - Both use `rgba8unorm` format, so this should be fine
   - Check if there's any format conversion happening in the viewer

3. **Verify parameter initialization:**
   - Check if `colorize` default value is properly set when node is created
   - Ensure `colorize` is included in `nodeData.params` when compute node is serialized
   - Check if `colorize` value is preserved during graph recompilation

4. **Debug steps:**
   ```javascript
   // In viewer-live.html, add debug logging for ComputeNoise colorize
   if (nodeData.kind === 'ComputeNoise') {
     console.log('[LiveViewer] ComputeNoise params:', {
       colorize: liveParams.colorize,
       typeof: typeof liveParams.colorize,
       uniformData: uniformData[6] // colorize is at index 6
     });
   }
   ```

### Issue 2: Parameter Registration for New Compute Nodes

**Problem:** When adding a new compute node type, its parameters might not be registered in the uniform manager.

**Fix Required:**

1. **Ensure `getParam` is called for all parameters:**
   - In the compute node's shader generation function (e.g., `generateNoiseShader`), call `this.getParam(node, 'paramName', defaultValue)` for each parameter
   - This ensures parameters are registered in `uniformManager.uniformValues`

2. **Verify `analyzeNode` is called:**
   - Check that `ParameterUniformManager.analyzeNode(node)` is called during graph compilation
   - This should happen automatically, but verify it's working for new node types

3. **Add to uniform packing in viewer:**
   - In `viewer-live.html`, add the new node type to the uniform packing logic in `executeComputeNode`
   - Match the WGSL uniform struct order exactly
   - Example:
     ```javascript
     } else if (nodeData.kind === 'ComputeNewNode') {
       // Match WGSL struct order: resolution(vec2), time, param1, param2, ...
       uniformData[3] = liveParams.param1 !== undefined ? liveParams.param1 : defaultValue1;
       uniformData[4] = liveParams.param2 !== undefined ? liveParams.param2 : defaultValue2;
       // ...
     }
     ```

### Issue 3: Boolean Parameters

**Problem:** Boolean parameters (like `colorize`) need special handling.

**Fix:**
- In `ParameterUniformManager.analyzeNode`, booleans are converted to 1.0/0.0
- In `viewer-live.html`, when updating from `computeNodeParams`, ensure booleans are converted:
  ```javascript
  const numValue = typeof value === 'boolean' 
    ? (value ? 1.0 : 0.0) 
    : (typeof value === 'number' ? value : parseFloat(value));
  ```

### Issue 4: Node ID Format Consistency

**Problem:** Node IDs might be strings or numbers, causing matching issues.

**Fix:**
- Always normalize node IDs to strings when comparing:
  ```javascript
  if (String(nodeData.nodeId) === String(computeNodeParams.nodeId)) {
    // Update params
  }
  ```

## Testing Checklist

For each compute node type, verify:

- [ ] Parameters update in real-time during drag (no mouse release needed)
- [ ] Parameters are included in `uniformKeys` (check console logs)
- [ ] `computeNodeParams` is sent when dragging (check console logs)
- [ ] Viewer receives and applies `computeNodeParams` (check console logs)
- [ ] Uniform buffer is packed correctly (check uniform values in shader)
- [ ] Boolean parameters work correctly (convert to 1.0/0.0)
- [ ] Node ID matching works (string vs number)

## Debugging Tips

1. **Enable debug logging:**
   - In `main.js`, the first 3 parameter updates are logged
   - In `viewer-live.html`, the first 3 parameter updates are logged
   - Check console for `[updateUniformsOnly]` and `[LiveViewer]` messages

2. **Check uniformKeys:**
   - Log `uniformKeys` in `handleParameterUpdate` to see which parameters are registered
   - If compute node parameters are missing, check `ParameterUniformManager.analyzeNode`

3. **Verify computeNodeParams:**
   - Log `computeNodeParams` in `sendParameterUpdate` to see what's being sent
   - Log `computeNodeParams` in `handleParameterUpdate` to see what's received

4. **Check uniform packing:**
   - Log `uniformData` in `executeComputeNode` to verify values are packed correctly
   - Compare with WGSL uniform struct order

## Future Improvements

1. **Automatic parameter registration:**
   - Automatically detect compute node parameters from node definition
   - Register all parameters in uniform manager without manual `getParam` calls

2. **Unified parameter system:**
   - Make compute nodes use the same `u_params` buffer as fragment nodes
   - This would eliminate the need for `computeNodeParams` workaround

3. **Parameter validation:**
   - Validate that all compute node parameters are registered
   - Warn if parameters are missing from `uniformKeys`

