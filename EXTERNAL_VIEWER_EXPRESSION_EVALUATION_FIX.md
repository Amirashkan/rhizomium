# External Viewer Expression Evaluation Fix

## Problem Statement

Compute node parameters with expressions (e.g., `=time*20`, `=sin(time)`, `time*10`) were not being evaluated in the external viewer (`viewer-live.html`). The expressions were being passed as strings directly to the GPU uniform buffers, causing them to be treated as static values (often 0.0 or NaN) instead of dynamic evaluated values.

### Example Issue
- **Graph**: `computeNoise > transform(rotate:time*20) > output`
- **Expected**: Rotation animates continuously based on time
- **Actual**: Rotation shows as 0.0 or static value, animation doesn't work

## Root Cause

The external viewer was using parameter values directly without evaluating expressions:

```javascript
// BEFORE (INCORRECT)
uniformData[5] = liveParams.rotation !== undefined ? liveParams.rotation : 0.0;
// If rotation = "=time*20", this would try to assign the string or fail
```

The internal editor correctly evaluates expressions using `ComputeShaderManager.evaluateParam()`, but the external viewer lacked this evaluation logic.

## Solution Implemented

### 1. Added Expression Evaluation Helper Function

Added `_evaluateParam()` method to the viewer's `LiveViewer` class (lines ~1066-1141 in `viewer-live.html`):

```javascript
_evaluateParam(value, defaultValue, time) {
    // If already a number, return it
    if (typeof value === 'number') {
        return isFinite(value) ? value : defaultValue;
    }

    // If it's a string, it might be an expression
    if (typeof value === 'string') {
        const trimmed = value.trim();
        
        // Check if it's an expression (either starts with = or contains time/audioEnvelope)
        const isExpression = trimmed.startsWith('=') || /\btime\b/.test(trimmed) || /\baudioEnvelope/.test(trimmed);
        
        if (isExpression) {
            // Evaluate expression using safe eval with Math context
            // ... (full implementation in viewer-live.html)
        }
        
        // Try to parse as number
        const parsed = parseFloat(trimmed);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    // Boolean or other types
    if (typeof value === 'boolean') {
        return value ? 1.0 : 0.0;
    }

    return defaultValue;
}
```

### 2. Fixed ComputeTransform Node

**Location**: `viewer-live.html` lines ~1350-1363

**Changed**: All transform parameters now evaluate expressions before being packed into uniforms:

```javascript
// AFTER (CORRECT)
uniformData[3] = this._evaluateParam(liveParams.translateX !== undefined ? liveParams.translateX : params?.translateX, 0.0, time);
uniformData[4] = this._evaluateParam(liveParams.translateY !== undefined ? liveParams.translateY : params?.translateY, 0.0, time);
uniformData[5] = this._evaluateParam(liveParams.rotation !== undefined ? liveParams.rotation : params?.rotation, 0.0, time); // degrees
uniformData[6] = this._evaluateParam(liveParams.scaleX !== undefined ? liveParams.scaleX : params?.scaleX, 1.0, time);
uniformData[7] = this._evaluateParam(liveParams.scaleY !== undefined ? liveParams.scaleY : params?.scaleY, 1.0, time);
uniformData[8] = this._evaluateParam(liveParams.pivotX !== undefined ? liveParams.pivotX : (liveParams.centerX !== undefined ? liveParams.centerX : (params?.pivotX || params?.centerX)), 0.5, time);
uniformData[9] = this._evaluateParam(liveParams.pivotY !== undefined ? liveParams.pivotY : (liveParams.centerY !== undefined ? liveParams.centerY : (params?.pivotY || params?.centerY)), 0.5, time);
```

**Fixed Parameters**:
- `translateX` - Can now use expressions like `=sin(time)`
- `translateY` - Can now use expressions like `=cos(time)`
- `rotation` - Can now use expressions like `=time*20` ✅ (primary fix)
- `scaleX` - Can now use expressions like `=1+sin(time)*0.5`
- `scaleY` - Can now use expressions like `=1+cos(time)*0.5`
- `pivotX` / `centerX` - Can now use expressions
- `pivotY` / `centerY` - Can now use expressions

### 3. Fixed ComputeNoise Node

**Location**: `viewer-live.html` lines ~1283-1287

**Changed**: All noise parameters now evaluate expressions:

```javascript
// AFTER (CORRECT)
uniformData[3] = this._evaluateParam(liveParams.scale !== undefined ? liveParams.scale : params?.scale, 8.0, time);
uniformData[4] = this._evaluateParam(liveParams.octaves !== undefined ? liveParams.octaves : params?.octaves, 5.0, time);
uniformData[5] = this._evaluateParam(liveParams.speed !== undefined ? liveParams.speed : params?.speed, 0.1, time);
```

**Fixed Parameters**:
- `scale` - Can now use expressions like `=10+sin(time)*5`
- `octaves` - Can now use expressions (though typically static)
- `speed` - Can now use expressions like `=time*0.1` ✅

### 4. Fixed ComputeMix Node

**Location**: `viewer-live.html` lines ~1344-1348

**Changed**: Mix parameters now evaluate expressions:

```javascript
// AFTER (CORRECT)
uniformData[3] = this._evaluateParam(liveParams.amount !== undefined ? liveParams.amount : params?.amount, 0.5, time);
uniformData[4] = this._evaluateParam(liveParams.opacity !== undefined ? liveParams.opacity : params?.opacity, 1.0, time);
```

**Fixed Parameters**:
- `amount` - Can now use expressions like `=sin(time)*0.5+0.5`
- `opacity` - Can now use expressions like `=abs(sin(time))`

### 5. Fixed Generic Fallback for Other Compute Nodes

**Location**: `viewer-live.html` lines ~1380-1401

**Changed**: Generic fallback now evaluates expressions for any compute node not explicitly handled:

```javascript
// AFTER (CORRECT)
} else {
    // Generic fallback: copy all numeric params in order they appear
    // CRITICAL: Evaluate expressions for all parameters in generic fallback
    let paramIndex = 3;
    for (const key in liveParams) {
        const value = liveParams[key];
        // Use evaluateParam to handle expressions, numbers, and booleans
        const defaultValue = params?.[key] !== undefined ? (typeof params[key] === 'number' ? params[key] : 0.0) : 0.0;
        uniformData[paramIndex++] = this._evaluateParam(value !== undefined ? value : params?.[key], defaultValue, time);
    }
    // Also handle params when liveParams is empty
    if (Object.keys(liveParams).length === 0 && params) {
        let paramIndex = 3;
        for (const key in params) {
            const value = params[key];
            if (value !== undefined && (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')) {
                const defaultValue = typeof value === 'number' ? value : 0.0;
                uniformData[paramIndex++] = this._evaluateParam(value, defaultValue, time);
            }
        }
    }
}
```

**Affected Nodes**: All compute nodes not explicitly handled, including:
- `ComputeKaleidoscope` (rotation, segments, speed, etc.)
- `ComputeFeedback` (rotation, decay, scale, etc.)
- `ComputeWarp` (strength, frequency, phase, etc.)
- `ComputeGlitch` (amount, speed, etc.)
- `ComputePattern` (rotation, scale, etc.)
- `ComputeFeedbackField` (speed, decay, etc.)
- `ComputeCellular` (speed, etc.)
- And any other compute nodes

## Supported Expression Syntax

The expression evaluator supports:

1. **Math Operators**: `+`, `-`, `*`, `/`, `%`
2. **Math Functions**: `sin()`, `cos()`, `tan()`, `abs()`, `floor()`, `ceil()`, `round()`, `sqrt()`, `pow()`, `exp()`, `log()`, `min()`, `max()`, `clamp()`, `mix()`, `fract()`, etc.
3. **Constants**: `PI` (Math.PI), `E` (Math.E)
4. **Variables**: `time` (current animation time)
5. **Audio Variables**: `audioEnvelope`, `audioEnvelopeBass`, `audioEnvelopeMids`, `audioEnvelopeHighs`, `audioEnvelopeFull` (currently default to 0.0 in external viewer)

**Expression Formats**:
- With `=` prefix: `=time*20`, `=sin(time)`, `=time*10+5`
- Without `=` prefix: `time*20`, `sin(time)` (auto-detected if contains `time` or `audioEnvelope`)

## Testing

### Test Cases

1. **ComputeTransform Rotation**
   - Expression: `rotate:time*20`
   - Expected: Continuous rotation animation
   - Status: ✅ Fixed

2. **ComputeNoise Speed**
   - Expression: `speed:time*0.1`
   - Expected: Noise animation speed increases with time
   - Status: ✅ Fixed

3. **ComputeMix Amount**
   - Expression: `amount:sin(time)*0.5+0.5`
   - Expected: Amount oscillates between 0 and 1
   - Status: ✅ Fixed

4. **ComputeKaleidoscope Rotation**
   - Expression: `rotation:time*30`
   - Expected: Kaleidoscope rotates continuously
   - Status: ✅ Fixed (via generic fallback)

5. **Complex Expressions**
   - Expression: `rotation:sin(time)*180+cos(time*2)*45`
   - Expected: Complex rotation pattern
   - Status: ✅ Fixed

## Code Locations

### Files Modified
- `viewer-live.html` - External viewer implementation

### Key Sections
1. **Expression Evaluator**: Lines ~1066-1141
2. **ComputeTransform Fix**: Lines ~1350-1363, ~1393-1401
3. **ComputeNoise Fix**: Lines ~1283-1287
4. **ComputeMix Fix**: Lines ~1344-1348
5. **Generic Fallback Fix**: Lines ~1380-1401

## Related Issues

This fix resolves issues where:
- Rotation animations don't work in external viewer
- Time-based expressions are ignored
- Dynamic parameters appear static
- Any compute node parameter with expressions doesn't update

## Comparison with Internal Editor

The internal editor uses `ComputeShaderManager.evaluateParam()` which has similar functionality but uses the full `ParameterExpressionSystem`. The external viewer implementation is a simplified version that:

1. ✅ Evaluates expressions correctly
2. ✅ Supports time and audio variables (audio defaults to 0)
3. ✅ Uses safe eval with Math context
4. ✅ Handles numeric, string, and boolean values
5. ⚠️ Does not support node references (e.g., `=node_X`) - these are not needed for external viewer

## Future Enhancements

Potential improvements:
1. Support audio envelope variables in external viewer (currently default to 0)
2. Support node references if needed
3. Add expression caching for performance (skip for time-dependent expressions)
4. Better error handling and validation

## Notes

- The fix maintains backward compatibility: numeric values work as before
- Expression evaluation happens on every frame, which is correct for time-dependent expressions
- The evaluator uses a safe `Function()` constructor with restricted scope (only Math and constants)
- All compute nodes benefit from this fix, even those not explicitly handled

