# Parameter & Expression System - Quick Reference

## 1️⃣ How Parameters Are Defined

### Fragment Nodes
```javascript
params: [
  { name: 'angle', type: 'float', default: 0.0 }
]
```

### Compute Nodes
```javascript
params: [
  { name: 'scale', type: 'float', default: 8.0, min: 0.1, max: 50.0 }
]
```
Compute nodes add `min`, `max` constraints and `workgroupSize` metadata.

---

## 2️⃣ Parameter Capabilities

Both support the same 4 levels:
```
STATIC_ONLY  → Only literal values (0.5, true)
SHADER_VAR   → Shader variables (time, uv)
EXPRESSION   → Expressions (=sin(time)*2)
ALL          → All three combined
```

---

## 3️⃣ Expression Flow (Unified System)

```
User Input: "=sin(time*2)"
    ↓
UnifiedExpressionSystem.parse()
    ↓
Single AST (same for all evaluators)
    ↓
    ├─→ CPU Evaluator → JavaScript: Math.sin(actualTime * 2)
    └─→ Shader Generator → WGSL: sin(g.time * 2.0)
```

**Key Files:**
- `src/utils/UnifiedExpressionSystem.js` - Single source of truth
- `src/parameters/UnifiedParameterHandler.js` - Converts to shader code
- `src/parameters/ParameterDefs.js` - Parameter definitions

---

## 4️⃣ Fragment Shader Parameter Processing

**Files:** `NodeCompiler.js`, `FieldNodes.js`

```javascript
const getParam = (paramName, defaultValue) => {
  const paramValue = node.params[paramName];
  
  if (paramValue.startsWith('=')) {
    // Expression → Unified system → WGSL code
    return this.resolveParameterValue(paramValue);
  }
  
  // Numeric → Register as uniform
  return this.registerParameterAsUniform(node, paramName);
};
```

**Result:**
- `angle = 45` → `u_params._nodeId_angle` (uniform)
- `angle = "=sin(time)"` → `sin(g.time)` (direct code)

---

## 5️⃣ Compute Shader Parameter Processing

**File:** `ComputeNodes.js`

```javascript
getParamValue(node, paramName, defaultValue) {
  // Just returns the value - bakes it into shader generation
  return node.params[paramName] ?? defaultValue;
}
```

**Result:**
- Parameters are baked into the generated compute shader
- No expressions support (would need CPU-side evaluation)
- Uniforms passed via `ComputeShaderManager`

---

## 6️⃣ Parameter Type Conversions

**Via `TypeSystem.js`:**

| From | To | Conversion |
|------|----|----|
| int | float | `f32(value)` |
| float | int | `i32(value)` |
| float/int | bool | `value != 0` |
| vec3 | rgb | No conversion (same type) |
| vec4 | color | No conversion (same type) |
| field | value | No conversion (compatible) |

---

## 7️⃣ Key Classes

| Class | File | Purpose |
|-------|------|---------|
| `UnifiedExpressionSystem` | `src/utils/` | Parse expressions → AST |
| `UnifiedParameterHandler` | `src/parameters/` | Convert params to shader code |
| `ParameterUniformManager` | `src/gpu/` | Track & update uniforms |
| `NodeCompiler` | `src/codegen/processors/` | Compile nodes with params |
| `ComputeNodeBase` | `src/gpu/` | Manage compute node params at runtime |
| `TypeSystem` | `src/data/` | Type validation & conversion |

---

## 8️⃣ Parameter Uniform Registration

```javascript
// Fragment shader uniform management
registerParameterAsUniform(node, paramName, defaultValue) {
  // Convert param to number
  let value = parseFloat(node.params[paramName]) || defaultValue;
  
  // Register with manager
  const paramKey = `${node.id}.${paramName}`;
  this.uniformManager.uniformValues.set(paramKey, value);
  
  // Return reference
  const fieldName = paramKey.replace(/[^a-zA-Z0-9_]/g, '_');
  return `u_params.${fieldName}`;  // ← Used in shader as u_params._11_scale
}
```

---

## 9️⃣ ComputeNodeBase Runtime Updates

```javascript
// Set parameter at runtime
computeNode.setUniform('scale', 2.5);

// Update multiple
computeNode.updateParams({
  scale: 2.5,
  speed: 1.0
});

// Dispatch uses current params
computeNode.dispatch(device, encoder, time);
```

---

## 🔟 Can Compute Nodes Use Expressions?

**✅ YES! Compute nodes now support expressions as of 2025-11-10**

**Implementation:** Both fragment and compute nodes use the same `getParam()` method with:
- Expression parsing (`=time*2`, `=sin(time)`)
- UnifiedExpressionSystem for WGSL code generation
- Uniform registration for dynamic updates
- Shader variable support (`time`, `audioEnvelope`)

**Example:**
```javascript
ComputeNoise: {
  params: {
    scale: '=sin(time) * 10 + 10',  // ✅ Works!
    speed: '=time * 0.1'             // ✅ Works!
  }
}
```

---

## Parameters Are Fully Unified Between Nodes ✅

Both use:
- Same `UnifiedExpressionSystem` for expressions
- Same `TypeSystem` for type checking
- Same `ParameterCapabilities` definitions
- Same uniform registration mechanism

**The systems are unified!**
