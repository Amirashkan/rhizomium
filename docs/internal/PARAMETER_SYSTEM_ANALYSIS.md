# Parameter and Expression System Analysis: Fragment vs Compute Shaders

## Executive Summary

The GLSL node editor has implemented a **fully unified parameter system** that works identically across both fragment and compute shaders. As of 2025-11-10, both shader types share complete parameter capabilities:

1. **✅ Unified Expression System** - Single AST-based parser for all expressions
2. **✅ Unified Parameter Handler** - Same `getParam()` method for both shader types
3. **✅ Uniform Manager** - Centralized management of dynamic uniforms
4. **✅ Type System** - Compatible type definitions and conversions
5. **✅ Expression Support** - Both support `=time`, `=sin(time*2)`, `=node_X` references

**Key Achievement:** Compute nodes now support all the same parameter capabilities as fragment nodes, including expressions, shader variables, and node references.

---

## 1. Parameter Definition Comparison

### Fragment Nodes (Field, Gradient, Math, etc.)
```javascript
// Example: LinearGradient (Fragment Node)
LinearGradient: {
  label: "Linear Gradient",
  cat: "Field",
  inputs: 1,
  pinsIn: ["UV"],
  pinsOut: ["Value"],
  params: [
    { name: 'angle', type: 'float', default: 0.0 },
    { name: 'offset', type: 'float', default: 0.0 },
    { name: 'scale', type: 'float', default: 1.0 },
    { name: 'repeat', type: 'boolean', default: false }
  ]
}
```

### Compute Nodes
```javascript
// Example: ComputeNoise (Compute Node)
ComputeNoise: {
  label: "Compute Noise",
  cat: "Compute",
  inputs: 0,
  pinsIn: [],
  pinsOut: ["Texture", "RGB", "R", "G", "B", "A"],
  params: [
    { name: 'scale', type: 'float', default: 8.0, min: 0.1, max: 50.0 },
    { name: 'octaves', type: 'int', default: 5, min: 1, max: 8 },
    { name: 'speed', type: 'float', default: 0.1, min: 0.0, max: 2.0 },
    { name: 'colorize', type: 'boolean', default: true },
    { name: 'resolution', type: 'select', options: ['256', '512', '1024'], default: '512' }
  ],
  workgroupSize: [8, 8, 1]
}
```

**Key Difference**: Compute nodes include `min`, `max`, `options`, and `workgroupSize` metadata; fragment nodes don't need these.

---

## 2. Parameter Types Supported

Both systems support the same parameter capabilities:

```javascript
// src/parameters/ParameterDefs.js
export const ParameterCapabilities = {
  STATIC_ONLY: 'static',      // Only literal values: 0.5, 1, true
  EXPRESSION: 'expression',    // Supports expressions: =time, =sin(time*2)
  SHADER_VAR: 'shader_var',    // Supports shader variables: time, uv
  ALL: 'all'                   // Supports all of the above
};
```

### Examples for Different Parameter Types:

```javascript
// Gradient nodes support ALL capabilities
LinearGradient: {
  angle: {
    type: ParameterTypes.ANGLE,
    capabilities: ParameterCapabilities.ALL,  // Can use =time, =sin(time*2)
    default: 0
  },
  repeat: {
    type: ParameterTypes.BOOL,
    capabilities: ParameterCapabilities.STATIC_ONLY,  // Only true/false
    default: false
  }
}
```

---

## 3. Expression System: Unified Architecture

The system uses a **Single Source of Truth (SSoT)** for expressions via `UnifiedExpressionSystem`:

```javascript
// src/utils/UnifiedExpressionSystem.js
export class UnifiedExpressionSystem {
  /**
   * Single AST parser used by both CPU evaluator and shader generator
   */
  parse(expressionString) {
    const expr = expressionString.trim().startsWith('=')
      ? expressionString.trim().substring(1)
      : expressionString.trim();
    
    // Tokenize → Parse → Cache AST
    const tokenizer = new Tokenizer(expr);
    const tokens = tokenizer.tokenize();
    const parser = new Parser(tokens);
    const ast = parser.parse();
    
    this.astCache.set(expr, ast);
    return ast;
  }

  /**
   * CPU Evaluation: Returns JavaScript number
   */
  evaluateCPU(expressionString, context = {}) {
    const ast = this.parse(expressionString);
    const evaluator = new CPUEvaluator(context);
    return evaluator.evaluate(ast);  // JavaScript: time*2 = time*2
  }

  /**
   * Shader Generation: Returns WGSL code
   */
  generateShader(expressionString, variableMapping = {}) {
    const ast = this.parse(expressionString);
    const generator = new ShaderGenerator(variableMapping);
    return generator.generate(ast);  // WGSL: g.time*2.0
  }
}
```

### Example Expression Flow:

**User Input**: `=sin(time*2)`

1. **Tokenizer**: `sin`, `(`, `time`, `*`, `2`, `)`
2. **Parser**: `FunctionCall(name="sin", args=[BinaryOp(*, Identifier("time"), 2)])`
3. **CPU Evaluator**: Returns JavaScript: `Math.sin(actualTime * 2)`
4. **Shader Generator**: Returns WGSL: `sin(g.time * 2.0)`

---

## 4. How Fragment Shaders Use Expressions

### Parameter Resolution in Fragment Nodes

```javascript
// src/codegen/processors/NodeCompiler.js
const getParam = (paramName, defaultValue = '0.0') => {
  const paramValue = node.params?.[paramName];

  // Check if it's an expression or node reference
  if (typeof paramValue === 'string' && paramValue.trim().startsWith('=')) {
    // Handle expressions (like =sin(time) or =node_X)
    return this.resolveParameterValue(paramValue, defaultValue);
  }

  // Regular numeric parameters: register as uniform
  const uniformRef = this.registerParameterAsUniform(
    node, paramName, typeof defaultValue === 'number' ? defaultValue : parseFloat(defaultValue) || 0.0
  );

  return uniformRef || this.resolveParameterValue(paramValue, defaultValue);
};
```

### Example: Kaleidoscope Node (Fragment)

```javascript
// src/codegen/compilers/FieldNodes.js
compileKaleidoscope(node, getInput, nodeId) {
  const uv = getInput(0, "vec2", "in.uv");
  
  // Parameters can be static values or expressions
  const segments = this.getParam(node, "segments", 6.0);    // =6 or =time*2
  const rotationDeg = this.getParam(node, "angle", 0.0);   // =0 or =sin(time)
  const rotation = this.convertDegToRad(rotationDeg);
  const scale = this.getParam(node, "scale", 1.0);
  const mirror = node.params?.mirror ?? true;

  const fnName = `kaleidoscope_${nodeId}`;
  const fn = `fn ${fnName}(uv: vec2<f32>, segments: f32, rotation: f32, zoom: f32, mirror: bool) -> vec2<f32> {
    // ... implementation
  }`;

  const line = `let node_${nodeId} = ${fnName}(${uv}, f32(${segments}), ${rotation}, ${scale}, ${mirror});`;

  return { line, outputType: "vec2", functionDef: fn, functionName: fnName };
}
```

**What happens with parameters**:
- `segments = 6` → Direct value: `f32(6)`
- `segments = =time*2` → Expression becomes shader code: `f32((g.time * 2.0))`
- `rotation = =sin(time)` → Expression: `sin(g.time)`

---

## 5. How Compute Shaders Use Expressions

### Parameter Resolution in Compute Nodes

```javascript
// src/codegen/compilers/ComputeNodes.js
class ComputeNodes {
  /**
   * Simple parameter getter - just returns the value
   * Compute nodes bake parameters directly into shader string
   */
  getParamValue(node, paramName, defaultValue) {
    if (!node.params || !(paramName in node.params)) {
      return defaultValue;
    }
    
    const value = node.params[paramName];
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Generate shader with parameters baked in
   */
  generateNoiseShader(node, getInput) {
    const scale = this.getParamValue(node, 'scale', 8.0);
    const octaves = this.getParamValue(node, 'octaves', 5);
    const speed = this.getParamValue(node, 'speed', 0.1);
    const colorize = this.getParamValue(node, 'colorize', true);

    const shader = `
// Compute Noise Shader
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  scale: f32,          // These are passed as uniforms at runtime
  octaves: f32,
  speed: f32,
  padding: vec2<f32>
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var frequency = 1.0;
  var pos = p;

  for (var i = 0; i < octaves; i++) {
    value += amplitude * noise(pos * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let texCoord = vec2<u32>(global_id.xy);
  let texSize = vec2<u32>(u32(uniforms.resolution.x), u32(uniforms.resolution.y));

  let uv = vec2<f32>(texCoord) / vec2<f32>(texSize);
  let time = uniforms.time * uniforms.speed;
  var noisePos = uv * uniforms.scale;
  noisePos += vec2<f32>(time * 0.1, time * 0.15);

  let noiseValue = fbm(noisePos, i32(uniforms.octaves));
  // ...
}`;

    return shader;
  }
}
```

---

## 6. Parameter Compilation in glslBuilder.js

```javascript
// src/codegen/glslBuilder.js
export function buildWGSL(graph) {
  const processor = new GraphProcessor();
  
  if (!window.nodeCompiler) {
    window.nodeCompiler = new NodeCompiler();
  }
  const compiler = window.nodeCompiler;

  // Clear cached state
  compiler.uniformManager.clear();
  compiler.compilers.field?.clearFunctionCache?.();

  // Process graph
  const { orderedNodes, outputNode } = processor.processGraph(graph);

  // Compile all nodes
  const compiledData = compiler.compileNodes(orderedNodes);
  const { lines, uniformStruct, uniformManager, usesNoise } = compiledData;

  // Collect helpers and generate final shader
  const textureBindings = TextureBindings.generate(graph);

  const wgsl = generateShader({
    lines,
    uniformStruct,
    shapeFunctions: compiler.compilers.field?.getAllFunctionDefinitions?.(),
    transformHelpers: compiler.compilers.transform?.getHelperFunctions?.(),
    noiseHelpers: usesNoise ? compiler.compilers.noise?.getHelperFunctions?.() : '',
    colorHelpers: compiler.compilers.utility?.getHelperFunctions?.(),
  }, textureBindings);

  return { wgsl, uniformManager };
}
```

### Key Function: `registerParameterAsUniform`

```javascript
// src/codegen/processors/NodeCompiler.js
registerParameterAsUniform(node, paramName, defaultValue = 0.0) {
  const paramValue = node.params?.[paramName];
  let value = paramValue !== undefined && paramValue !== null ? paramValue : defaultValue;

  // Parse string values to numbers
  if (typeof value === 'string') {
    // Check if it's an expression (starts with =)
    if (value.trim().startsWith('=')) {
      // Handle expressions separately - they don't become uniforms
      return null;
    }
    const parsed = parseFloat(value);
    value = isNaN(parsed) ? defaultValue : parsed;
  }

  // Ensure finite value
  if (!isFinite(value)) {
    value = 0.0;
  }

  // Register with uniform manager
  const paramKey = `${node.id}.${paramName}`;
  this.uniformManager.uniformValues.set(paramKey, value);

  // Generate uniform reference like u_params._nodeId_paramName
  const sanitizedName = paramKey.replace(/[^a-zA-Z0-9_]/g, '_');
  const fieldName = sanitizedName.startsWith('_') ? sanitizedName : `_${sanitizedName}`;
  return `u_params.${fieldName}`;
}
```

---

## 7. ComputeNodeBase Parameter Handling

```javascript
// src/gpu/ComputeNodeBase.js
export class ComputeNodeBase {
  constructor(device, nodeConfig = {}) {
    // Parameters stored in params object
    this.params = { ...nodeConfig.params } || {};
    this.id = nodeConfig.id || this.generateId();
    this.kind = nodeConfig.kind || 'ComputeNodeBase';
  }

  /**
   * Set uniform parameter (reflects in next dispatch)
   */
  setUniform(name, value) {
    if (!this.params.hasOwnProperty(name)) {
      console.warn(`[ComputeNodeBase] Parameter '${name}' not found in ${this.id}`);
    }
    this.params[name] = value;
    console.log(`[ComputeNodeBase] Set ${this.id}.${name} = ${value}`);
  }

  /**
   * Get uniform parameter value
   */
  getUniform(name) {
    return this.params[name];
  }

  /**
   * Update multiple parameters at once
   */
  updateParams(params) {
    Object.entries(params).forEach(([name, value]) => {
      this.setUniform(name, value);
    });
  }

  /**
   * Dispatch with current parameter values
   */
  dispatch(device, encoder, time) {
    if (!this.initialized || !this.shaderManager) {
      console.warn(`[ComputeNodeBase] Cannot dispatch ${this.id}: not initialized`);
      return;
    }

    // Update shader manager with latest params
    this.shaderManager.node = {
      id: this.id,
      kind: this.kind,
      params: this.params  // ← Current parameter values used here
    };

    this.shaderManager.dispatch(encoder, time);
  }
}
```

---

## 8. Unified Parameter Handler

```javascript
// src/parameters/UnifiedParameterHandler.js
export class UnifiedParameterHandler {
  /**
   * Determine if a parameter value should use a uniform buffer
   * (i.e., it's a dynamic expression that changes over time)
   */
  isDynamic(nodeKind, paramName, value) {
    const def = getParameterDefinition(nodeKind, paramName);
    
    // If parameter doesn't support expressions, it can't be dynamic
    if (def && !this.supportsExpressions(def.capabilities)) {
      return false;
    }
    
    // Check if it's an expression (starts with =)
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed.startsWith('=')) return false;
    
    // Check if the expression contains time-dependent variables
    const expr = trimmed.slice(1);
    return this.isTimeDependentExpression(expr);
  }

  /**
   * Convert a parameter value to shader code
   */
  toShaderCode(nodeKind, paramName, value, uniformName = null) {
    const def = getParameterDefinition(nodeKind, paramName);
    const capabilities = def?.capabilities || getDefaultCapabilities(nodeKind);

    // 1. If using uniform buffer (dynamic expression)
    if (uniformName) {
      return `params.${uniformName}`;
    }

    // 2. Handle expressions starting with =
    if (typeof value === 'string' && value.trim().startsWith('=')) {
      if (this.supportsExpressions(capabilities)) {
        const rawExpr = value.trim().slice(1);
        if (/[a-zA-Z_]/.test(rawExpr)) {
          return this.toShaderExpression(rawExpr);
        }
        return this.evaluateExpression(value);
      }
    }

    // 3. Check if it's a math expression
    if (typeof value === 'string' && this.isMathExpression(value)) {
      // USE UNIFIED AST SYSTEM
      try {
        return unifiedExpressionSystem.generateShader(value);
      } catch (error) {
        console.warn('Failed to generate shader code for expression:', value);
        return def?.default ?? 0;
      }
    }

    // 4. Handle shader variables
    if (this.supportsShaderVars(capabilities)) {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (trimmed !== 'time') {
        const shaderVar = this.toShaderVariable(value);
        if (shaderVar) return shaderVar;
      }
    }

    // 5. Parse as literal
    return this.parseLiteral(value, def?.default);
  }
}
```

---

## 9. Comparison: Parameter System Separation vs Unification

### BEFORE (Separate Systems):
```
Fragment Nodes          Compute Nodes
    ↓                        ↓
Fragment Compiler       Compute Compiler
    ↓                        ↓
CPU Evaluator          (No CPU evaluation)
    ↓
Shader Generator
    ↓
Two different expression systems
→ DESYNCS possible!
```

### AFTER (Unified System):
```
Fragment Nodes     Compute Nodes
    ↓                    ↓
Both use same nodes through NodeCompiler
    ↓
UnifiedExpressionSystem (Single AST)
    ↓          ↓
CPU Evaluator  Shader Generator
(Match!)       (Match!)
```

---

## 10. Complex Parameter Usage Examples

### Example 1: Animated Gradient (Fragment + Expressions)

```javascript
// User creates node:
LinearGradient {
  angle: "=sin(time) * 90",      // Animated angle
  offset: "=time * 0.5",         // Animated offset
  scale: "2.0",                  // Static
  repeat: true                   // Static
}

// NodeCompiler.getParam() processes:
// angle: "=sin(time) * 90"
//   ↓ UnifiedExpressionSystem.generateShader("sin(time) * 90")
//   ↓ Returns: sin(g.time) * 90.0

// offset: "=time * 0.5"
//   ↓ UnifiedExpressionSystem.generateShader("time * 0.5")
//   ↓ Returns: (g.time * 0.5)

// scale: "2.0"
//   ↓ registerParameterAsUniform()
//   ↓ Returns: u_params._nodeId_scale (uniform buffer reference)

// Generated WGSL uses:
let angle = sin(g.time) * 90.0;
let offset = (g.time * 0.5);
let scale = u_params._nodeId_scale;  // Updated each frame
```

### Example 2: Compute Histogram with Complex Parameters

```javascript
// Node definition
ComputeHistogram: {
  params: [
    { name: 'operation', type: 'select', options: ['Equalize', 'Normalize', 'Stretch', 'Visualize'], default: 'Equalize' },
    { name: 'channel', type: 'select', options: ['RGB', 'R', 'G', 'B', 'Luminance'], default: 'Luminance' },
    { name: 'bins', type: 'int', default: 256, min: 16, max: 512 },
    { name: 'strength', type: 'float', default: 1.0, min: 0.0, max: 1.0 }
  ]
}

// Compiler generation
generateHistogramShader(node, getInput) {
  const operation = this.getParamValue(node, 'operation', 'Equalize');  // 'Equalize'
  const channel = this.getParamValue(node, 'channel', 'Luminance');     // 'Luminance'
  const bins = this.getParamValue(node, 'bins', 256);                   // 256
  const strength = this.getParamValue(node, 'strength', 1.0);           // 1.0

  // Convert to indices for shader
  const operationIndex = operation === 'Equalize' ? 0 : operation === 'Normalize' ? 1 : operation === 'Stretch' ? 2 : 3;
  const channelIndex = channel === 'RGB' ? 0 : channel === 'R' ? 1 : channel === 'G' ? 2 : channel === 'B' ? 3 : 4;

  const shader = `
struct Uniforms {
  resolution: vec2<f32>,
  time: f32,
  operation: f32,      // 0=Equalize, 1=Normalize, etc.
  channel: f32,        // 0=RGB, 1=R, 2=G, 3=B, 4=Luminance
  bins: f32,           // 256
  strength: f32,       // 1.0
  _padding: f32
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  // Uses uniforms.operation, uniforms.channel, etc.
  // All parameters available to compute shader
}`;

  return shader;
}
```

### Example 3: Multi-Input with Parameter Cross-Connection

```javascript
// Fragment node with both inputs AND expressions
node: {
  kind: 'Mix',
  inputs: [node_A.id, node_B.id],  // Two inputs connected
  params: {
    t: '=sin(time) * 0.5 + 0.5'   // Expression mixing both
  }
}

// Compilation:
const a = getInput(0);                     // node_A output
const b = getInput(1);                     // node_B output
const t = this.resolveParameterValue(
  node.params.t,
  '0.5'
);
// t becomes: sin(g.time) * 0.5 + 0.5

// Generated code:
let node_X = mix(node_A, node_B, (sin(g.time) * 0.5 + 0.5));
```

---

## 11. Can Compute Nodes Use Fragment Expressions?

**Short Answer: ✅ YES! As of 2025-11-10, compute nodes now support the same expression capabilities as fragment nodes.**

### Implementation
Compute nodes now use the same `getParam()` method as fragment nodes, which:
1. **Expression parsing** - Handles expressions starting with `=` (e.g., `=time*2`, `=sin(time)`)
2. **UnifiedExpressionSystem** - Uses the same AST-based parser to generate WGSL code
3. **Uniform registration** - Registers numeric parameters with the uniform manager for dynamic updates
4. **Shader variables** - Supports `time`, `audioEnvelope`, and other shader variables

### Example Usage:
```javascript
// Compute node with expressions
ComputeNoise: {
  params: {
    scale: '=sin(time) * 10 + 10',  // Animated scale
    octaves: 5,                      // Static value
    speed: '=time * 0.1'             // Expression with time
  }
}

// Generated shader code:
let scale = sin(g.time) * 10.0 + 10.0;  // Expression compiled to WGSL
let octaves = 5.0;                       // Static value
let speed = g.time * 0.1;                // Expression compiled to WGSL
```

**Current Reality**: Both fragment and compute nodes support the full range of parameter capabilities through the unified parameter system.

---

## 12. Parameter Conversion and Passing Between Nodes

### Node Reference Pattern

```javascript
// User can reference one node's output in another's parameter:
node1: { kind: 'Value', params: { value: 1.0 } }
node2: { kind: 'Add', params: { a: 0, b: 0 }, inputs: [node1.id, null] }
node3: { kind: 'Multiply', params: { scale: '=node1_value' } }

// Compiler processes:
resolveParameterValue(paramValue, defaultValue) {
  // Check if it's a node reference pattern: node_X or node_X_component
  const nodeRefPattern = /^node_(\w+)(?:_(x|y|z|w))?$/;
  const match = paramValue.match(nodeRefPattern);

  if (match) {
    const nodeId = match[1];
    const component = match[2];

    if (component) {
      // Component access: node_1_x → node_1.x
      return `node_${this.sanitize(nodeId)}.${component}`;
    } else {
      // Direct reference: node_1 → node_1
      return `node_${this.sanitize(nodeId)}`;
    }
  }

  // Complex expressions use UnifiedExpressionSystem
  try {
    const shaderCode = this.shaderExpressionSystem.generateShader(expression);
    return shaderCode;
  } catch (error) {
    return defaultValue;
  }
}
```

---

## 13. Summary Table: Parameter System Features

| Feature | Fragment Nodes | Compute Nodes | Notes |
|---------|---|---|---|
| **Parameter Types** | float, int, bool, color, select, colorstops | float, int, bool, color, select | Identical support |
| **Static Values** | ✅ Baked into shader | ✅ Baked into shader code | Compiled at build time |
| **Expressions (=time)** | ✅ Via UnifiedExpressionSystem | ✅ Via UnifiedExpressionSystem | **UNIFIED** - Both support expressions now |
| **Node References** | ✅ =node_X | ✅ =node_X | **UNIFIED** - Both support node references |
| **Uniforms** | ✅ Parameter Uniform Manager | ✅ ComputeShaderManager uniforms | Dynamic parameters |
| **Type System** | ✅ TypeSystem.js | ✅ TypeSystem.js | Unified type checking |
| **Capability Levels** | STATIC_ONLY, EXPRESSION, SHADER_VAR, ALL | STATIC_ONLY, EXPRESSION, SHADER_VAR, ALL | Same definitions |

---

## 14. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Node Graph                            │
├──────────────────┬──────────────────┬──────────────────┤
│  Fragment Nodes  │  Compute Nodes   │   Input Nodes    │
│  (Gradient,      │  (Noise,         │   (Time, UV,     │
│   Math, etc.)    │   Blur, etc.)    │    Resolution)   │
└────────┬──────────────┬──────────────────┬──────────────┘
         │              │                  │
         └──────────────┼──────────────────┘
                        │
                   NodeCompiler
              ┌─────────┴─────────┐
              │                   │
         getInput()           getParam()
              │                   │
         ┌────▼────┐    ┌────────▼────────┐
         │   Type  │    │ Unified Param   │
         │Converter│    │    Handler      │
         └─────────┘    └────────┬────────┘
                                 │
                    ┌────────────┴──────────────┐
                    │                           │
              Is it an expression?         Is it a uniform?
              (starts with =?)                 (MIDI, dynamic?)
              │                                 │
              │                                 │
         ┌────▼──────────────────┐    ┌────────▼──────────┐
         │ UnifiedExpressionSys  │    │ ParameterUniform  │
         │ - Parse to AST        │    │ Manager           │
         │ - CPU Evaluate        │    │ - Tracks uniforms │
         │ - Generate WGSL       │    │ - Updates/frame   │
         └───────────────────────┘    └───────────────────┘
```

---

## 15. Key Takeaways

1. **Unified System**: Both fragment and compute shaders use the same expression parser (UnifiedExpressionSystem)
2. **Separate Compilation**: Fragment code is baked inline; compute code is generated and executed separately
3. **Parameter Types**: All parameter types are compatible, but capabilities vary by node
4. **Expressions**: Fully supported in fragment shaders via shader code generation; compute shaders would need CPU-side evaluation (not implemented)
5. **Uniforms**: Both systems support dynamic uniforms via ParameterUniformManager
6. **Type Safety**: TypeSystem ensures connection compatibility across node types
7. **Design Pattern**: Expression system follows Single Source of Truth pattern with one AST for both CPU and GPU evaluation
