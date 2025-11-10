# Architecture Diagrams & Visual Reference

## 1. High-Level Data Flow (Complete Pipeline)

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INPUT                              │
│            (Graph updates, parameter changes)                   │
└────────────────────────┬────────────────────────────────────────┘
                         ↓
    ┌────────────────────────────────────────────┐
    │   Fragment Shader Compilation Stage        │
    │        (glslBuilder.js + Node Compilers)   │
    ├────────────────────────────────────────────┤
    │ 1. GraphProcessor: topological sort        │
    │ 2. NodeCompiler: compile each node         │
    │    - Fragment nodes → WGSL expressions     │
    │    - Compute nodes → registerComputeNode() │
    │ 3. Collect helper functions                │
    │ 4. Generate compute texture bindings       │
    │ 5. ShaderTemplate: wrap final WGSL         │
    └────────────────────────────────────────────┘
                         ↓ (window.computeNodeRegistry populated)
    ┌────────────────────────────────────────────┐
    │    Compute Node Initialization             │
    │      (ComputeExecutor.initialize())        │
    ├────────────────────────────────────────────┤
    │ 1. Read computeNodeRegistry                │
    │ 2. For each compute node:                  │
    │    - Create ComputeShaderManager           │
    │    - Compile GPU shader                    │
    │    - Create output texture                 │
    │ 3. Compute topological execution order     │
    └────────────────────────────────────────────┘
                         ↓ (Shaders ready)
    ┌────────────────────────────────────────────┐
    │         Per-Frame Execution Loop           │
    ├────────────────────────────────────────────┤
    │ 1. ComputeExecutor.execute()               │
    │    - For each compute node (in order):     │
    │      * Update uniforms                     │
    │      * Dispatch compute workgroups         │
    │      * Store output in nodeOutputs Map     │
    │                                             │
    │ 2. GPURenderer.render()                    │
    │    - Create render pass                    │
    │    - Bind compute textures (100+)          │
    │    - Run fragment shader                   │
    │    - Sample compute outputs                │
    │                                             │
    │ 3. Display on canvas                       │
    └────────────────────────────────────────────┘
```

---

## 2. Fragment vs Compute Node Architecture

```
FRAGMENT NODES                          COMPUTE NODES
═════════════════════════════════════════════════════════════════════

Expression-Based                        Texture-Based
┌──────────────────┐                   ┌──────────────────┐
│  Input Node      │                   │  ComputeNoise    │
│  UVMap → vec2    │                   │  Inputs: 0       │
└────────┬─────────┘                   │  Outputs: 1      │
         ↓                             │  (Texture)       │
┌──────────────────┐                   └──────────┬───────┘
│  Math Node       │                             ↓
│  Add(a,b)        │                   ┌──────────────────────┐
│  Out: a+b (expr) │                   │  ComputeShaderMgr    │
└────────┬─────────┘                   │  - WGSL shader       │
         ↓                             │  - Storage texture   │
┌──────────────────┐                   │  - Uniforms          │
│  Field Node      │                   │  - Bind groups       │
│  Gradient(a+b)   │                   │  - Dispatch logic    │
│  Out: color      │                   └──────────┬───────────┘
└────────┬─────────┘                             ↓
         ↓                             ┌──────────────────────┐
┌──────────────────┐                   │ Output Texture       │
│  Output Node     │                   │ rgba8unorm format    │
│  Final WGSL code │                   │ (Can be sampled)     │
└────────┬─────────┘                   └──────────┬───────────┘
         ↓                                         ↓
    WGSL Fragment Shader             Can be sampled by
    Fragment shader code passed       Fragment nodes via
    to WebGPU renderer                texture binding (100+)


UNIFIED AT RUNTIME:
Fragment shader can sample all compute textures
via automatic bindings:

@group(0) @binding(100) var compute_node_1: texture_2d<f32>;
@group(0) @binding(101) var sampler_compute_node_1: sampler;
```

---

## 3. Compilation Pipeline (Fragment Focus)

```
INPUT: Node Graph
{
  nodes: [
    { id: 1, kind: 'UVMap' },
    { id: 2, kind: 'Add', inputs: [1, 3] },
    { id: 3, kind: 'Constant', value: 0.5 },
    { id: 4, kind: 'Output', inputs: [2] }
  ],
  connections: [...]
}

                    ↓

STAGE 1: GraphProcessor
  - Topological sort: [1, 3, 2, 4]
  - Validate connections
  - Extract node definitions
  - Result: orderedNodes, outputNode

                    ↓

STAGE 2: NodeCompiler.compileNodes(orderedNodes)
  For each node in order:
  
  Node 1 (UVMap):
    → fragment_compiler.compile(node)
    → { expression: "in.uv", outputType: "vec2", outputPins: [...] }
  
  Node 3 (Constant):
    → constant_compiler.compile(node)
    → { expression: "0.5", outputType: "f32", outputPins: [...] }
  
  Node 2 (Add):
    → math_compiler.compile(node)
    → { expression: "in.uv + 0.5", outputType: "f32", ... }
  
  Node 4 (Output):
    → output_compiler.compile(node)
    → Returns final output expression
  
  Result: { lines: [...], uniformStruct, uniformManager }

                    ↓

STAGE 3: TypeConverter
  - Validate type compatibility
  - Generate conversion code
  - Handle vec2 → vec3 promotions
  - Result: Typed expressions

                    ↓

STAGE 4: Collect Helpers
  - shapeFunctions (from FieldNodes)
  - transformHelpers (from TransformNodes)
  - noiseHelpers (if used)
  - colorHelpers (from UtilityNodes)

                    ↓

STAGE 5: generateComputeBindings()
  For each node in computeNodeRegistry:
    @group(0) @binding(100+) var compute_nodeId: texture_2d<f32>;
    @group(0) @binding(101+) var sampler_compute_nodeId: sampler;

                    ↓

STAGE 6: generateShader() - Final Assembly
  - Add @group/@binding declarations
  - Add struct definitions
  - Add helper functions
  - Add main @fragment function
  - Return complete WGSL

                    ↓

OUTPUT: Complete WGSL Fragment Shader
```

---

## 4. Execution Order (Topological Sort)

```
Example: ComputeNoise → Add(0.5) → ComputeBlur → Output

Node Dependencies:
┌─────────────────────────────────────────┐
│  Node  │  Inputs    │  Dependencies     │
├─────────────────────────────────────────┤
│  CN    │  none      │  none             │
│  Add   │  CN, 0.5   │  CN               │
│  CB    │  Add       │  Add, CN          │
│  Out   │  CB        │  CB, Add, CN      │
└─────────────────────────────────────────┘

Execution Order Computation:
  1. CN has no dependencies → Execute first
  2. Add depends on CN → Execute after CN
  3. CB depends on Add → Execute after Add
  4. Out depends on CB → Execute last

Result: [CN, Add, CB, Out]

Frame Execution:
  1. ComputeExecutor.execute(encoder):
     - ComputeNoise.dispatch()      → Texture in nodeOutputs
     - ComputeBlur.dispatch()       → Samples ComputeNoise texture
                                   → Outputs blur texture
     
  2. Fragment passes both compute textures to shader:
     @binding(100) var compute_CN: texture_2d<f32>;    ← Noise
     @binding(102) var compute_CB: texture_2d<f32>;    ← Blur
     
  3. Fragment can sample either or both
```

---

## 5. Memory & Binding Layout

```
GPU BIND GROUP 0 LAYOUT (WebGPU)
═══════════════════════════════════════════════════════════════

@binding(0)  ┌─────────────────────────────────────┐
             │  Uniform Buffer                     │
             │  - resolution, time, aspect         │
             │  - Camera/viewport data             │
             │  - Custom parameters                │
             └─────────────────────────────────────┘

@binding(1)  ┌─────────────────────────────────────┐
             │  Texture Sampler                    │
             │  - Standard linear sampler          │
             │  - Used for main input texture      │
             └─────────────────────────────────────┘

@binding(2)  ┌─────────────────────────────────────┐
             │  Input Texture                      │
             │  - Optional user texture            │
             │  - Sampled by fragment nodes        │
             └─────────────────────────────────────┘

@binding(3)  ┌─────────────────────────────────────┐
             │  Input Sampler                      │
             │  - For input texture sampling       │
             └─────────────────────────────────────┘

... (more texture bindings)

@binding(100) ┌──────────────────────────────────────┐
              │  Compute Texture 1 (ComputeNoise)   │
              │  texture_2d<f32>                   │
              └──────────────────────────────────────┘

@binding(101) ┌──────────────────────────────────────┐
              │  Compute Sampler 1                  │
              │  sampler                           │
              └──────────────────────────────────────┘

@binding(102) ┌──────────────────────────────────────┐
              │  Compute Texture 2 (ComputeBlur)    │
              │  texture_2d<f32>                   │
              └──────────────────────────────────────┘

@binding(103) ┌──────────────────────────────────────┐
              │  Compute Sampler 2                  │
              │  sampler                           │
              └──────────────────────────────────────┘

... (continues for each compute node pair)
```

---

## 6. Interoperability Matrix

```
                  CAN FEED INTO
            Fragment  Compute  Bridge
             ├────────┼────────┼────────┐
Fragment     │   No   │   No*  │  Yes   │  *Needs bridge
             ├────────┼────────┼────────┤
Compute      │  Yes✓  │  Yes✓  │  Yes   │
             ├────────┼────────┼────────┤
Bridge       │  Yes✓  │  Yes✓  │  Yes   │
             └────────┴────────┴────────┘

✓ = Fully implemented
No* = Technically possible but not implemented
Yes = Would work if bridge nodes exist

CURRENT WORKING PATHS:
✓ Compute → Fragment (via texture sampling)
✓ Compute → Compute (via texture passing)
✓ Fragment → Fragment (expression composition)
✗ Fragment → Compute (would need bridge)

BRIDGE NODE BENEFIT:
Fragment graph → Bridge node → Compute node
(Renders fragment to texture, feeds to compute)
```

---

## 7. Parameter Update Flow

```
USER ADJUSTS PARAMETER
    ↓
Editor.updateNodeParam(nodeId, 'scale', 8.0)
    ↓
Node in graph updated:
  graph.nodes[nodeId].params.scale = 8.0
    ↓
Graph recompiled (buildWGSL):
  ├─ Fragment nodes: Parameters baked into WGSL
  │  (const or uniform)
  │
  └─ Compute nodes: Parameters stored in registry
       window.computeNodeRegistry.get(nodeId).node.params = {...}
    ↓
Next frame:
  ComputeExecutor.execute():
    ├─ For each compute node:
    │   manager.updateUniforms(node.params)
    │   → GPU uniform buffer updated
    │   → Dispatch with new parameters
    │
    └─ Fragment shader recompiled
        → New WGSL with updated parameters
    ↓
Canvas updates with new values
```

---

## 8. Class Hierarchy (Simplified)

```
ComputeNodeBase
├─ Purpose: Unified API for all compute nodes
├─ Constructor(device, { id, kind, params, metadata })
├─ Key Methods:
│  ├─ async initialize(wgsl, w, h, supportsFeedback)
│  ├─ dispatch(device, encoder, time)
│  ├─ getOutputTexture()
│  ├─ setUniform(name, value)
│  ├─ serialize() / deserialize()
│  └─ destroy()
├─ Internal:
│  └─ shaderManager: ComputeShaderManager
│
└─ Wraps (contains):
    ComputeShaderManager
    ├─ Purpose: Low-level GPU resource management
    ├─ Manages:
    │  ├─ Storage textures
    │  ├─ Compute pipeline
    │  ├─ Uniform buffer
    │  ├─ Bind groups
    │  └─ Ping-pong buffers (for feedback)
    │
    └─ Exports:
        getOutputTexture()
        setInputTexture(texture)
        dispatch(encoder, time)
        destroy()

ComputeExecutor
├─ Purpose: Orchestrate all compute nodes
├─ Manages:
│  ├─ Map: nodeId → ComputeShaderManager
│  ├─ Map: nodeId → output texture
│  ├─ Execution order (topological)
│  └─ Input hashes (change detection)
│
└─ Key Methods:
    initialize()
    execute(encoder, time)
    addComputeNode(computeNode)
    removeComputeNode(nodeId)
    getNodeOutput(nodeId)
```

---

## 9. Type Conversion Flow

```
Fragment Node Type Inference:
  
  Input: { pinsIn: ["A", "B"], pinsOut: ["out"] }
  
  Fragment compiler detects:
    TypeSystem.inferTypeFromPinName("A") → "float"
    TypeSystem.inferTypeFromPinName("B") → "float"
    Output type: "float"
  
  Generated WGSL:
    let node_5 = add(float_a, float_b);
  
Compute Node Type System:
  
  Input: ComputeBlur { pinsIn: ["Input"], pinsOut: ["Texture", "RGB"] }
  
  Defines outputs:
    - "Texture" → vec4  (RGBA)
    - "RGB"     → vec3  (RGB only)
    - "R"       → vec3  (Red channel)
    - etc.
  
  Generated WGSL:
    let noise_rgba = textureSample(compute_node_1, sampler, uv);
    let noise_rgb = noise_rgba.xyz;

Compatibility Checking:
  
  Connection: ComputeNoise.RGB → Add.A
  
  TypeSystem.validateConnection():
    source type: vec3 (RGB output)
    target type: float (A input expects scalar)
    rules[float] includes vec3? → false
    warning: Type mismatch (can auto-convert)
```

---

## 10. Fragment to Compute Bridge Architecture (Proposed)

```
Current Problem:
Fragment nodes → WGSL expressions (no texture)
Compute nodes need → GPU textures

Proposed Solution: FragmentBridge Node

┌──────────────────────────────────────────────────────────┐
│  Fragment Graph                                          │
│  UVMap → Gradient → [output: color expression]          │
└─────────────────────────┬────────────────────────────────┘
                          ↓
         ┌────────────────────────────────────┐
         │  FragmentBridge Node               │
         ├────────────────────────────────────┤
         │ Process:                           │
         │ 1. Render fragment to texture      │
         │ 2. Register as compute texture     │
         │ 3. Return texture for downstream  │
         └────────────────────────────────────┘
                          ↓
         ┌────────────────────────────────────┐
         │  Compute Nodes can now use it      │
         │  ComputeBlur(bridge output)        │
         └────────────────────────────────────┘
                          ↓
         ┌────────────────────────────────────┐
         │  Fragment Nodes can sample result  │
         │  Sample(compute blur output)       │
         └────────────────────────────────────┘

Implementation Location:
/src/gpu/FragmentBridgeExecutor.js
  ├─ Contains RenderPipeline for fragment
  ├─ Creates intermediate texture
  ├─ Implements ComputeNodeBase interface
  └─ Integrates with ComputeExecutor

Performance:
  Add 1 render pass per bridge node
  Memory: 1 texture per bridge
```

---

## Summary Table

| Component | Type | Location | Purpose |
|-----------|------|----------|---------|
| **Fragment System** | | | |
| GraphProcessor | Class | `/src/codegen/processors/` | Topological sort |
| NodeCompiler | Class | `/src/codegen/processors/` | Compile nodes to WGSL |
| TypeConverter | Class | `/src/codegen/processors/` | Type checking |
| glslBuilder | Module | `/src/codegen/` | Orchestrator |
| ShaderTemplate | Module | `/src/codegen/templates/` | Final assembly |
| **Compute System** | | | |
| ComputeNodeBase | Class | `/src/gpu/` | Unified API |
| ComputeShaderManager | Class | `/src/gpu/` | Low-level GPU |
| ComputeExecutor | Class | `/src/gpu/` | Orchestrator |
| ComputeNodes | Object | `/src/data/nodes/` | Definitions (26) |
| **Fragment Nodes** | | | |
| MathNodes | Object | `/src/data/nodes/` | 43 nodes |
| FieldNodes | Object | `/src/data/nodes/` | 20 nodes |
| VectorNodes | Object | `/src/data/nodes/` | ~15 nodes |
| etc. | Object | `/src/data/nodes/` | Others |
| **Type System** | | | |
| TypeSystem | Class | `/src/data/` | Validation |

---

**End of Architecture Diagrams**
