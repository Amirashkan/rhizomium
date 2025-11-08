# ComputeNodeBase Architecture

## Overview

The `ComputeNodeBase` class provides a unified API for managing compute shader operations in the GLSL Node Editor. It supports **all node types** (compute, fragment, field) and ensures **proper value propagation** between nodes through a sophisticated dual-pipeline architecture.

## Core Architecture

### Class: `ComputeNodeBase`

**Location:** `/src/gpu/ComputeNodeBase.js`

**Purpose:** Unified interface for all GPU compute operations with standard methods for execution, parameter management, and serialization.

### Required Methods (All Implemented ✅)

#### 1. `dispatch(device, encoder, time)`

Executes the compute shader on the GPU.

```javascript
const encoder = device.createCommandEncoder();
const time = performance.now() / 1000;
computeNode.dispatch(device, encoder, time);
device.queue.submit([encoder.finish()]);
```

**Implementation:**
- Updates shader manager with latest node parameters
- Delegates to `ComputeShaderManager.dispatch()`
- Handles uniform buffer updates
- Manages ping-pong buffer swapping for feedback nodes

**Location:** `ComputeNodeBase.js:107-121`

---

#### 2. `getOutputTexture()`

Returns the output texture for rendering or node connections.

```javascript
const outputTexture = computeNode.getOutputTexture();
// Used by fragment shader nodes to sample compute results
```

**Implementation:**
- Returns `ComputeShaderManager.outputTexture`
- For feedback nodes, returns the current write target
- Texture format: `rgba8unorm` with `TEXTURE_BINDING` usage

**Location:** `ComputeNodeBase.js:127-134`

---

#### 3. `setUniform(name, value)`

Sets shader parameter values at runtime.

```javascript
computeNode.setUniform('scale', 12.0);
computeNode.setUniform('feedRate', 0.055);
```

**Implementation:**
- Updates `this.params[name]`
- Changes take effect on next `dispatch()`
- Uniform buffer automatically updated during dispatch

**Location:** `ComputeNodeBase.js:142-150`

---

#### 4. `serialize()` / `deserialize()`

Saves and loads node state to/from JSON.

```javascript
// Save
const savedState = computeNode.serialize();
// Returns:
// {
//   id: "node_123",
//   kind: "ComputeReactionDiffusion",
//   params: { feedRate: 0.0545, killRate: 0.062, ... },
//   dimensions: { width: 512, height: 512 },
//   supportsFeedback: true
// }

// Load
const restored = ComputeNodeBase.deserialize(device, savedState);
await restored.initialize(wgslSource, 512, 512, true);
```

**Implementation:**
- Serializes all parameters, dimensions, and metadata
- WGSL source NOT saved (regenerated from node definition)
- Preserves node ID for connection integrity

**Location:** `ComputeNodeBase.js:175-215`

---

## Supporting All Node Types

### 1. Compute Nodes

**Examples:** `ComputeNoise`, `ComputeBlur`, `ComputeReactionDiffusion`, `ComputeCellular`

**Pipeline:**
```
Node Graph → ComputeNodes Compiler → WGSL Compute Shader
           ↓
      ComputeNodeBase.initialize(wgslSource)
           ↓
      ComputeShaderManager (GPU resources)
           ↓
      dispatch() → GPU Execution → Output Texture
```

**Characteristics:**
- Execute on GPU before fragment shader
- Output stored in texture
- Can use feedback (ping-pong buffers)
- Support parameter uniforms

**Integration:** `src/codegen/compilers/ComputeNodes.js`

---

### 2. Fragment Nodes

**Examples:** `FieldNodes` (Gradients, Noise), `MathNodes`, `VectorNodes`, `TransformNodes`

**Pipeline:**
```
Node Graph → Fragment Compiler → Inline WGSL code
           ↓
      Combined into Fragment Shader
           ↓
      Rendered to canvas
```

**Characteristics:**
- Compile to inline WGSL expressions
- Execute in fragment shader (per-pixel)
- No separate GPU dispatch
- Can **sample from compute node outputs**

**Connection to Compute:**
```wgsl
// Compute node binding (generated in glslBuilder.js)
@group(0) @binding(100) var compute_node_5: texture_2d<f32>;
@group(0) @binding(101) var sampler_compute_node_5: sampler;

// Fragment node samples compute output
let node_5_rgba = textureSample(compute_node_5, sampler_compute_node_5, uv);
```

**Integration:** `src/codegen/glslBuilder.js:66-82`

---

### 3. Field Nodes (3D Compute)

**Examples:** `ComputeFieldMapper` (3D field visualization)

**Pipeline:**
```
3D Field Input (fragment node) → ComputeFieldMapper → 3D Geometry
                                       ↓
                              Point Cloud / Surface Mesh
                                       ↓
                              Rendered in 3D Scene
```

**Characteristics:**
- Reads from fragment shader field functions
- Generates 3D geometry on GPU
- Updates reactively to parameter changes
- Supports multiple visualization modes (points, surface, volume)

**Implementation Details:**
- Uses compute shader to evaluate 3D field at grid points
- Generates vertex data based on field values
- Threshold-based point generation
- Real-time updates via `updateFrequency` parameter

**Integration:** See `ComputeFieldMapperNode` in `src/scene/nodes/`

---

## Value Propagation Between Nodes

### How Connections Work

#### 1. **Fragment → Fragment**
```
Node A (Fragment) → Node B (Fragment)
         ↓               ↓
    let node_3 = ...   let node_5 = node_3 * 2.0
```
Direct variable reference in WGSL code.

#### 2. **Compute → Fragment**
```
Node A (Compute) → Node B (Fragment)
         ↓               ↓
    Texture Output   textureSample(compute_node_A, ...)
```
Fragment shader samples compute output texture.

#### 3. **Fragment → Compute**
```
Node A (Fragment) → Node B (Compute)
         ↓               ↓
    Field Function   Evaluate field in compute shader
```
Compute shader evaluates fragment shader's field function.

#### 4. **Compute → Compute**
```
Node A (Compute) → Node B (Compute)
         ↓               ↓
    Texture Output   Bind as input texture
```
Second compute shader reads first's output texture as input.

---

### Execution Order

The `ComputeExecutor` ensures proper execution order:

```javascript
// 1. Initialize all compute nodes
await computeExecutor.initialize();

// 2. Every frame:
const encoder = device.createCommandEncoder();

// 3. Execute ALL compute shaders FIRST
computeExecutor.execute(encoder, time);
// This calls dispatch() on all ComputeNodeBase instances

// 4. Then execute fragment shader
// Fragment shader can now sample compute outputs
renderFragmentShader(encoder);

device.queue.submit([encoder.finish()]);
```

**Order matters:**
- Compute shaders must complete before fragment shader
- Within compute nodes, execution follows dependency graph
- Feedback nodes use previous frame's output

**Implementation:** `src/gpu/ComputeExecutor.js`

---

## Feedback & Ping-Pong Buffers

### Supported Nodes

Nodes that support feedback (temporal effects):
- `ComputeReactionDiffusion` - Reaction-diffusion patterns
- `ComputeCellular` - Game of Life, cellular automata
- `ComputeFeedback` - Custom feedback loops
- `ComputeFeedbackField` - Persistent simulation fields

### How It Works

**Ping-Pong Pattern:**
```
Frame N:
  Read:  textureB (previous frame)
  Write: textureA (current frame)
  swap()

Frame N+1:
  Read:  textureA (previous frame)
  Write: textureB (current frame)
  swap()
```

**ComputeShaderManager Implementation:**
```javascript
// Create two textures
this.storageTextureA = device.createTexture({
  usage: GPUTextureUsage.STORAGE_BINDING |
         GPUTextureUsage.TEXTURE_BINDING
});

this.storageTextureB = device.createTexture({
  usage: GPUTextureUsage.STORAGE_BINDING |
         GPUTextureUsage.TEXTURE_BINDING
});

// Bind correct textures each frame
@binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>; // Write target
@binding(2) var prevFrame: texture_2d<f32>; // Read source

// After dispatch
swapBuffers(); // A ↔ B
```

**Location:** `ComputeShaderManager.js:69-94`

---

## Complete Integration Flow

### Node Creation → Execution

```
1. User adds ComputeReactionDiffusion node to graph

2. Graph compilation (glslBuilder.js):
   - ComputeNodes compiler handles the node
   - Generates WGSL compute shader code
   - Registers in window.computeNodeRegistry

3. Initialization (ComputeExecutor.initialize()):
   - Creates ComputeShaderManager for the node
   - Allocates GPU textures (ping-pong if needed)
   - Compiles compute pipeline

4. Each Frame (RenderLoop):
   a. ComputeExecutor.execute(encoder, time)
      - For each compute node:
        - shaderManager.dispatch(encoder, time)
        - Updates uniforms
        - Dispatches workgroups
        - Swaps feedback buffers

   b. Fragment Shader Execution
      - Samples compute output textures
      - Renders final result

5. User changes parameter:
   - computeNode.setUniform('feedRate', 0.06)
   - Takes effect next dispatch (no recompilation)

6. Save Project:
   - computeNode.serialize() → JSON
   - Textures saved as data URLs

7. Load Project:
   - ComputeNodeBase.deserialize(data)
   - Regenerate WGSL from node definition
   - Reinitialize GPU resources
```

---

## File Structure

### Core Files

| File | Purpose |
|------|---------|
| `src/gpu/ComputeNodeBase.js` | Main unified API class |
| `src/gpu/ComputeShaderManager.js` | Low-level GPU resource management |
| `src/gpu/ComputeExecutor.js` | Orchestrates all compute node execution |
| `src/gpu/FeedbackManager.js` | High-level feedback buffer abstraction |

### Compilers

| File | Purpose |
|------|---------|
| `src/codegen/compilers/ComputeNodes.js` | Compiles compute nodes to WGSL |
| `src/codegen/compilers/FieldNodes.js` | Compiles fragment field nodes |
| `src/codegen/processors/NodeCompiler.js` | Main compilation orchestrator |
| `src/codegen/glslBuilder.js` | Assembles final WGSL shader |

### Node Definitions

| File | Purpose |
|------|---------|
| `src/data/nodes/ComputeNodes.js` | Compute node definitions & parameters |
| `src/data/nodes/FieldNodes.js` | Fragment field node definitions |
| `src/data/nodes/MathNodes.js` | Math operation nodes |

### Documentation

| File | Purpose |
|------|---------|
| `docs/COMPUTE_NODE_API.md` | Full API reference |
| `UNIFIED_COMPUTE_API.md` | Implementation summary |
| `COMPUTE_NODE_BASE_ARCHITECTURE.md` | This document |

---

## API Usage Examples

### Creating a Custom Compute Node

```javascript
// 1. Define node in ComputeNodes.js
export const ComputeNodes = {
  MyCustomNode: {
    label: "My Custom Effect",
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB"],
    params: [
      { name: 'strength', type: 'float', default: 1.0, min: 0.0, max: 2.0 },
      { name: 'mode', type: 'select', options: ['A', 'B', 'C'], default: 'A' }
    ],
    workgroupSize: [8, 8, 1]
  }
};

// 2. Implement compiler in ComputeNodes compiler
generateMyCustomShader(node, getInput) {
  return `
    @group(0) @binding(0) var<uniform> uniforms: Uniforms;
    @group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

    @compute @workgroup_size(8, 8)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
      // Your compute logic here
    }
  `;
}

// 3. Node automatically uses ComputeNodeBase
// - Registered during compilation
// - Initialized by ComputeExecutor
// - Executed every frame
// - Parameters accessible via setUniform()
```

### Using ComputeNodeBase Directly

```javascript
// Create a compute node programmatically
const device = await navigator.gpu.requestAdapter().then(a => a.requestDevice());

const node = new ComputeNodeBase(device, {
  id: 'custom_1',
  kind: 'ComputeNoise',
  params: {
    scale: 10.0,
    octaves: 6,
    speed: 0.2
  }
});

// Initialize with WGSL
const wgslSource = generateNoiseShader(node);
await node.initialize(wgslSource, 512, 512, false);

// Runtime parameter updates
node.setUniform('scale', 15.0);

// Execute
const encoder = device.createCommandEncoder();
node.dispatch(device, encoder, performance.now() / 1000);
device.queue.submit([encoder.finish()]);

// Get output
const texture = node.getOutputTexture();

// Save state
const saved = node.serialize();

// Cleanup
node.destroy();
```

---

## Key Design Principles

### 1. **Unified API**
All compute operations use the same interface regardless of shader complexity.

### 2. **Separation of Concerns**
- `ComputeNodeBase` - High-level node management
- `ComputeShaderManager` - GPU resource management
- `ComputeExecutor` - Execution orchestration

### 3. **Backward Compatibility**
Existing `ComputeShaderManager` code works unchanged. `ComputeNodeBase` is additive.

### 4. **Serialization-First**
All node state can be saved/loaded for project persistence.

### 5. **Performance**
- Minimal overhead
- GPU resources reused
- Smart dirty checking for re-dispatch
- Profiling support via ComputeProfiler

---

## Testing

### Test File
`src/test/ComputeNodeBaseTest.js`

### Run Tests
```javascript
import { runTests } from './src/test/ComputeNodeBaseTest.js';
const device = await getGPUDevice();
await runTests(device);
```

### Coverage
- ✅ Node creation & initialization
- ✅ Parameter management (setUniform/getUniform)
- ✅ Dispatch operations
- ✅ Output texture access
- ✅ Serialization/deserialization
- ✅ ComputeExecutor integration
- ✅ Feedback buffer support
- ✅ Resource cleanup

---

## Performance Monitoring

### GPU Profiler Integration

```javascript
import { ComputeProfiler } from './src/gpu/ComputeProfiler.js';

const profiler = new ComputeProfiler(device);
computeExecutor.setProfiler(profiler);

// Profiler tracks:
// - Dispatch times per node
// - GPU memory usage
// - Workgroup efficiency
// - Bind group recreation count

profiler.getReport(); // Get performance metrics
```

**Location:** `src/gpu/ComputeProfiler.js`

---

## Summary

The `ComputeNodeBase` class provides a **complete, production-ready** system for GPU compute operations that:

✅ **Supports all node types**: compute, fragment, and field nodes
✅ **Proper value propagation**: Through texture sampling and variable references
✅ **Full API**: dispatch(), getOutputTexture(), setUniform(), serialize()/deserialize()
✅ **Feedback support**: Ping-pong buffers for temporal effects
✅ **Well-tested**: Comprehensive test suite
✅ **Well-documented**: Full API docs and examples
✅ **Backward compatible**: Works with existing code
✅ **Performance-optimized**: Minimal overhead, smart caching

The architecture enables seamless integration of GPU compute operations into the visual node editor, making complex effects like reaction-diffusion, cellular automata, and 3D field visualization accessible through a simple, consistent API.

---

## References

- [COMPUTE_NODE_API.md](./docs/COMPUTE_NODE_API.md) - Complete API reference
- [UNIFIED_COMPUTE_API.md](./UNIFIED_COMPUTE_API.md) - Implementation summary
- [ComputeNodeExample.js](./src/gpu/examples/ComputeNodeExample.js) - Usage examples
- [WGSL Specification](https://www.w3.org/TR/WGSL/) - WebGPU Shading Language
