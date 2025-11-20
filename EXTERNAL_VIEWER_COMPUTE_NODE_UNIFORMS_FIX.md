# External Viewer Compute Node Uniform Packing Fix

## Problem

When adding certain compute nodes (like `ComputeThreshold`) to the graph, the external viewer (`viewer-live.html`) would display a black screen. This was caused by missing uniform buffer packing logic in the viewer's `executeComputeNode` function.

## Root Cause

The external viewer's `executeComputeNode` function in `viewer-live.html` was missing explicit uniform packing cases for many compute node types. When a compute node's uniforms weren't explicitly packed, the uniform buffer would contain all zeros, causing the shader to receive incorrect parameter values and produce black output.

### Affected Nodes

The following compute nodes were missing uniform packing logic:
- `ComputeThreshold` (reported issue)
- `ComputeBlur`
- `ComputeColorAdjust`
- `ComputeEdgeDetect`
- `ComputeMorphology`
- `ComputeVoronoi`
- `ComputeConvolution`
- `ComputeFeedback`
- `ComputeReactionDiffusion`
- `ComputeCellular`
- `ComputeFeedbackField`
- `ComputePattern`
- `ComputeGradient`
- `ComputeChannels`
- `ComputeHSV`
- `ComputeLuminance`

### Previously Working Nodes

These nodes already had uniform packing implemented:
- `ComputeNoise`
- `ComputeMix`
- `ComputeWarp`
- `ComputeTransform`
- `ComputeGlitch`
- `ComputeKaleidoscope`

## Solution

Added explicit uniform packing cases for all missing compute node types in two locations within `viewer-live.html`:

1. **When `liveParams` is available** (lines ~1624-1770): Handles real-time parameter updates during parameter dragging
2. **When `liveParams` is empty** (lines ~1689-1810): Fallback case using default `params` from node data

### Implementation Details

Each compute node type requires:
1. **Matching the WGSL uniform struct order exactly** - The uniform buffer layout must match the shader's `Uniforms` struct
2. **Parameter evaluation** - Using `_evaluateParam()` to handle:
   - Static numeric values
   - Expression strings (e.g., `"=time*20"`)
   - Boolean values (converted to 1.0/0.0)
   - String enums (converted to numeric indices)
3. **Default values** - Providing sensible defaults matching the node definition

### Example: ComputeThreshold

```javascript
} else if (nodeData.kind === 'ComputeThreshold') {
    // ComputeThreshold uniforms: resolution(vec2), time, threshold, thresholdMin, thresholdMax, outputLow, outputHigh
    // CRITICAL: Match the WGSL struct order exactly
    uniformData[3] = this._evaluateParam(liveParams.threshold !== undefined ? liveParams.threshold : params?.threshold, 0.5, time);
    uniformData[4] = this._evaluateParam(liveParams.thresholdMin !== undefined ? liveParams.thresholdMin : params?.thresholdMin, 0.3, time);
    uniformData[5] = this._evaluateParam(liveParams.thresholdMax !== undefined ? liveParams.thresholdMax : params?.thresholdMax, 0.7, time);
    uniformData[6] = this._evaluateParam(liveParams.outputLow !== undefined ? liveParams.outputLow : params?.outputLow, 0.0, time);
    uniformData[7] = this._evaluateParam(liveParams.outputHigh !== undefined ? liveParams.outputHigh : params?.outputHigh, 1.0, time);
}
```

### Special Cases

Some nodes require special handling:

1. **String Enums to Numeric Conversion**:
   - `ComputeBlur`: `quality` ('Low'=0, 'Medium'=1, 'High'=2), `direction` ('Both'=0, 'Horizontal'=1, 'Vertical'=2)
   - `ComputeFeedbackField`: `mode` ('Flow'=0, 'Reaction-Diffusion'=1, 'Accumulate'=2, 'Custom'=3)
   - `ComputeHSV`: `operation` ('RGB to HSV'=0, 'HSV to RGB'=1, 'Adjust HSV'=2)
   - `ComputeLuminance`: `method` and `outputMode` conversions
   - `ComputeChannels`: Channel source strings ('R'=0, 'G'=1, 'B'=2, 'A'=3, '0'=4, '1'=5)

2. **Boolean to Float Conversion**:
   - `ComputeEdgeDetect.invertEdges`: `true` → 1.0, `false` → 0.0

3. **Complex Parameters**:
   - `ComputeGradient`: Requires `colorStops` array processing and `numStops` calculation

## Reference Implementation

The uniform packing logic in the viewer should match the implementation in `src/gpu/ComputeShaderManager.js` (lines 459-712), which serves as the reference for correct uniform ordering and parameter handling.

## Testing

To verify the fix:
1. Add any of the previously broken compute nodes to a graph
2. Connect it to an output node
3. Open the external viewer
4. The viewer should display correctly instead of showing a black screen

## Files Modified

- `viewer-live.html`: Added uniform packing cases for 15 missing compute node types

## Related Files

- `src/gpu/ComputeShaderManager.js`: Reference implementation for uniform packing
- `src/codegen/compilers/ComputeNodes.js`: WGSL shader generation (defines uniform struct layouts)
- `src/data/nodes/ComputeNodes.js`: Node definitions with parameter defaults

## Future Considerations

When adding new compute nodes:
1. Add uniform packing case in `viewer-live.html` `executeComputeNode()` function
2. Ensure the uniform order matches the WGSL `Uniforms` struct exactly
3. Handle string enums, booleans, and expressions appropriately
4. Add the case in both the `liveParams` branch and the fallback `params` branch
5. Test in the external viewer to ensure uniforms are packed correctly

