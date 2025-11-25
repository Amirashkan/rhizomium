# GLSL Node Editor - Comprehensive Architecture Overview

**Last Updated:** 2025-11-08  
**Branch:** claude/shader-preview-gpu-compute-011CUwB8ncAuq8NaZgAjcA7m

---

## Executive Summary

The GLSL Node Editor is a sophisticated WebGPU-based visual shader editor with the following key characteristics:

- **GPU-Accelerated:** Uses WebGPU for compute shaders and real-time rendering
- **Modular Node Graph:** Supports fragment shaders, compute shaders, and 3D field visualization
- **Topological Execution:** Nodes execute in dependency order with proper value propagation
- **Real-Time Preview:** Small node preview thumbnails + full GPU canvas rendering
- **Unified Parameter System:** Expressions, MIDI binding, and dynamic uniforms
- **Performance Monitoring:** Built-in GPU profiler with frame rate and compute dispatch tracking
- **3D Scene Graph:** For field visualization and 3D object rendering

---

## Part 1: Current Shader/GLSL Node Implementation

### 1.1 Node Type System

The editor supports three primary node categories:

#### Fragment Nodes (CPU-side, inlined in shader)
Located: `/src/data/nodes/*.js` (FieldNodes, MathNodes, VectorNodes, etc.)

**Characteristics:**
- Execute per-pixel in the fragment shader
- Parameters baked into shader code (or dynamically updated as uniforms)
- Outputs directly to canvas
- Examples:
  - `FieldNodes` (UVMap, Gradient, PerlinNoise, etc.)
  - `MathNodes` (Add, Multiply, Max, Min, etc.)
  - `VectorNodes` (Vec3, Normalize, Dot, Cross, etc.)
  - `TransformNodes` (Rotate, Translate, Scale, etc.)

#### Compute Nodes (GPU-side, pre-process)
Located: `/src/data/nodes/ComputeNodes.js`

**Characteristics:**
- Execute in parallel workgroups before fragment shader
- Output to GPU textures (rgba8unorm format)
- Support feedback (ping-pong buffers) for temporal effects
- Examples:
  - `ComputeNoise` - Fractal Brownian Motion noise
  - `ComputeBlur` - Gaussian blur filter
  - `ComputeReactionDiffusion` - Gray-Scott patterns
  - `ComputeCellular` - Cellular automata (Game of Life)
  - `ComputeParticles` - Particle systems
  - `ComputeFluidSim` - Navier-Stokes simulation
  - `ComputeFeedback` - Feedback loops with transformations

#### Field Nodes (3D Visualization)
Located: `/src/scene/nodes/ComputeFieldMapperNode.js`

**Characteristics:**
- Maps 2D/3D scalar fields to 3D geometry
- Generates point clouds or mesh surfaces
- Supports marching cubes algorithm
- Real-time threshold-based visualization

### 1.2 Node Compilation Pipeline

```
Node Graph Definition (data/NodeDefs.js)
    ↓
GraphProcessor (codegen/processors/GraphProcessor.js)
  ├─ Topological sort: determines execution order
  ├─ Collects ordered nodes
  └─ Validates connections
    ↓
NodeCompiler (codegen/processors/NodeCompiler.js)
  ├─ Compiles each node based on type:
  │  ├─ Fragment nodes → WGSL inline code
  │  ├─ Compute nodes → Register in window.computeNodeRegistry
  │  └─ Special nodes → Texture bindings
  ├─ Type inference
  └─ Output pin definitions
    ↓
TypeConverter (codegen/processors/TypeConverter.js)
  └─ Handles type conversions (vec3 → float, etc.)
    ↓
glslBuilder.js (Main orchestrator)
  ├─ Clears uniform cache
  ├─ Processes graph
  ├─ Collects function definitions (noise, transforms, etc.)
  ├─ Generates compute texture bindings
  └─ Produces final WGSL shader
    ↓
ShaderTemplate.js (Final assembly)
  └─ Wraps shader with:
     ├─ @group/@binding declarations
     ├─ Uniform buffers
     ├─ Texture samplers
     └─ Main fragment shader entry point
    ↓
FINAL: WGSL Shader (for fragment pipeline)
      + Compute Registry (for compute execution)
```

### 1.3 Output Pin System

Each node exposes typed output pins:

**Fragment Nodes:**
```javascript
{
  expression: "let node_5 = ...",
  outputType: "vec3",
  outputPins: [
    { expression: "node_5", type: "vec3" },        // Main output
    { expression: "node_5.r", type: "f32" },       // Individual channels
    { expression: "node_5.g", type: "f32" },
    { expression: "node_5.b", type: "f32" },
    // etc.
  ]
}
```

**Compute Nodes:**
```javascript
{
  isComputeNode: true,
  outputType: "vec4",
  outputPins: [
    { expression: "node_5_rgba", type: "vec4" },   // Full RGBA
    { expression: "node_5_rgba.xyz", type: "vec3" }, // RGB
    // Individual channels from texture sample
  ]
}
```

### 1.4 Current Fragment Shader Compilation Example

**Input Graph:**
```
UVMap → Gradient → Output
```

**Generated WGSL:**
```wgsl
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var samplerTex: sampler;
@group(0) @binding(2) var<uniform> u_params: ParamUniforms;

struct FragmentInput {
  @location(0) uv: vec2<f32>,
  @location(1) pixelCoord: vec2<f32>
};

// Compiled node code
fn_node_1() {
  let uv_1 = in.uv;
  let node_1 = uv_1;  // UVMap output
  return node_1;
}

fn_node_2() {
  let input_2 = fn_node_1();
  let node_2 = mix(vec3<f32>(0.1, 0.2, 0.3), 
                    vec3<f32>(0.8, 0.5, 0.2), 
                    input_2.x);  // Gradient
  return node_2;
}

@fragment
fn main(in: FragmentInput) -> @location(0) vec4<f32> {
  let output = fn_node_2();
  return vec4<f32>(output, 1.0);
}
```

---

## Part 2: GPU Compute Infrastructure

### 2.1 ComputeNodeBase Class
**Location:** `/src/gpu/ComputeNodeBase.js`

**Purpose:** Unified API for all GPU compute operations

**Key Methods:**
```javascript
// Initialize with WGSL shader code
await node.initialize(wgslSource, width, height, supportsFeedback);

// Dispatch compute shader on GPU
node.dispatch(device, encoder, time);

// Get output texture for downstream nodes
const texture = node.getOutputTexture();

// Update shader parameters at runtime
node.setUniform('feedRate', 0.06);

// Save/load node state
const saved = node.serialize();
const restored = ComputeNodeBase.deserialize(device, saved);
```

**Internal Structure:**
```
ComputeNodeBase
├─ id, kind, params: Node identity
├─ shaderManager: ComputeShaderManager instance
├─ width, height: Texture dimensions
├─ supportsFeedback: Ping-pong buffer support
└─ wgslSource: Compiled WGSL code
```

### 2.2 ComputeShaderManager Class
**Location:** `/src/gpu/ComputeShaderManager.js`

**Purpose:** Low-level GPU resource management for compute shaders

**Responsibilities:**
- Create and manage storage textures
- Manage compute pipelines
- Handle uniform buffers
- Manage ping-pong buffers for feedback effects

**Texture Management:**
```javascript
// For feedback nodes (ping-pong):
this.storageTextureA = device.createTexture({
  usage: GPUTextureUsage.STORAGE_BINDING | 
         GPUTextureUsage.TEXTURE_BINDING
});
this.storageTextureB = device.createTexture({...});

// For non-feedback nodes:
this.storageTexture = device.createTexture({
  usage: GPUTextureUsage.STORAGE_BINDING
});
```

**Dispatch Process:**
```javascript
async dispatch(device, encoder, time) {
  // Update uniforms with current parameters
  this.updateUniforms(time);
  
  // Create bind group with textures/samplers
  this.createBindGroup();
  
  // Begin compute pass
  const pass = encoder.beginComputePass();
  pass.setPipeline(this.computePipeline);
  pass.setBindGroup(0, this.bindGroup);
  
  // Dispatch workgroups
  pass.dispatchWorkgroups(
    Math.ceil(width / workgroupSize.x),
    Math.ceil(height / workgroupSize.y)
  );
  pass.end();
  
  // For feedback: swap buffers
  if (this.supportsFeedback) {
    this.swapBuffers();
  }
}
```

### 2.3 ComputeExecutor Class
**Location:** `/src/gpu/ComputeExecutor.js`

**Purpose:** Orchestrate execution of all compute nodes with dependency awareness

**Key Features:**

1. **Topological Sort:**
   - Builds dependency graph from node connections
   - Executes compute nodes in correct order
   - Ensures input dependencies are satisfied first

2. **Output Dictionary:**
   - Maps nodeId → output texture
   - Propagates outputs to dependent compute nodes
   - Provides fallback texture for uncomputed nodes

3. **Change Detection:**
   - Tracks input/parameter changes via hash
   - Only re-dispatches nodes when necessary
   - Reduces redundant GPU work

**Execution Flow:**
```javascript
// 1. Initialize all compute nodes from registry
await executor.initialize();

// 2. Each frame:
const encoder = device.createCommandEncoder();
executor.execute(encoder, time);  // Topologically sorted dispatch
device.queue.submit([encoder.finish()]);

// 3. Fragment shader samples outputs
// computeBindings in WGSL:
@group(0) @binding(100) var compute_node_5: texture_2d<f32>;
@group(0) @binding(101) var sampler_compute_node_5: sampler;

let compute_output = textureSample(compute_node_5, sampler_compute_node_5, uv);
```

### 2.4 Compute Node Registration System
**Location:** `window.computeNodeRegistry` (global Map)

**Registration Process:**

1. **During Compilation** (in ComputeNodes compiler):
```javascript
// Register for execution
window.computeNodeRegistry.set(nodeId, {
  node: { id, kind, params },
  wgslCode: generatedShader,
  resolution: [512, 512],
  supportsFeedback: true
});
```

2. **During Rendering** (in gpuRenderer.render()):
```javascript
// Compute shaders execute BEFORE fragment shader
encoder = device.createCommandEncoder();

// 1. Compute phase
await computeExecutor.execute(encoder, time);

// 2. Fragment phase
renderFragmentShader(encoder, graph, shaderData);

device.queue.submit([encoder.finish()]);
```

### 2.5 Feedback Support (Ping-Pong Buffers)

**Supported Nodes:**
- `ComputeReactionDiffusion` - Temporal patterns
- `ComputeCellular` - Game of Life
- `ComputeFeedback` - Custom feedback loops
- `ComputeFeedbackField` - Persistent field simulations

**How It Works:**
```javascript
// Frame N:
storageTextureA (READ) → Processing → storageTextureB (WRITE)
swap()

// Frame N+1:
storageTextureB (READ) → Processing → storageTextureA (WRITE)
swap()
```

**WGSL Bindings:**
```wgsl
// Written to during this frame
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

// Previous frame's output (for reading)
@group(0) @binding(2) var prevFrame: texture_2d<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let prev = textureSample(prevFrame, sampler, uv);
  let computed = /* ... apply rules using prev ... */;
  textureStore(outputTexture, coord, computed);
}
```

---

## Part 3: Node Execution & Output Propagation

### 3.1 Execution Order Determination

**Topological Sort Algorithm:**

```javascript
// In ComputeExecutor.updateExecutionOrder()
function topologicalSort(graph, computeNodeIds) {
  // 1. Build dependency map
  const dependencies = new Map();
  for (each nodeId in computeNodeIds) {
    dependencies[nodeId] = getInputNodeIds(nodeId);
  }
  
  // 2. Depth-first traversal
  const visited = new Set();
  const order = [];
  
  function visit(nodeId) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    
    // Visit dependencies first
    for (let dep of dependencies[nodeId]) {
      if (computeNodeIds.includes(dep)) {
        visit(dep);
      }
    }
    
    order.push(nodeId);
  }
  
  for (let nodeId of computeNodeIds) {
    visit(nodeId);
  }
  
  return order; // Dependencies-first order
}
```

### 3.2 Fragment-to-Fragment Value Flow

**Direct Variable Reference:**
```
Node A (Fragment) → Node B (Fragment)
     ↓                    ↓
let node_3 = ...    let node_5 = node_3 * 2.0
```

**Compiler Inline Example:**
```javascript
// Node A generates expression
{ expression: "sin(in.uv.x * 5.0)", type: "f32" }

// Node B references it
{ expression: "node_3 * 2.0", type: "f32" }

// Result: Inlined expression in B
let node_5 = sin(in.uv.x * 5.0) * 2.0;
```

### 3.3 Compute-to-Fragment Value Flow

**Texture Sampling:**
```
Node A (Compute) → Node B (Fragment)
     ↓                    ↓
GPU Texture      textureSample(compute_node_A, ...)
```

**WGSL Generation:**
```wgsl
// Compute node output binding (generated in glslBuilder.js)
@group(0) @binding(100) var compute_node_5: texture_2d<f32>;
@group(0) @binding(101) var sampler_compute_node_5: sampler;

// Fragment shader samples
let uv_5 = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
let node_5_rgba = textureSample(compute_node_5, sampler_compute_node_5, uv_5);
let node_5 = node_5_rgba;  // Can access as vec4 or individual channels
```

**Parameter Flow:**
```javascript
// ComputeNodes compiler extracts resolution from node definition
const resolution = node.params.resolution || 512;

// Bindings created in glslBuilder.js
if (window.computeNodeRegistry && window.computeNodeRegistry.size > 0) {
  let bindingIndex = 100;
  for (const [nodeId, nodeData] of window.computeNodeRegistry) {
    computeBindings += `@group(0) @binding(${bindingIndex++}) var compute_${nodeId}: texture_2d<f32>;\n`;
  }
}
```

### 3.4 Fragment-to-Compute Value Flow

**Field Function Sampling:**
```
Node A (Fragment) → Node B (Compute)
     ↓                    ↓
Field Function   Evaluate field in compute shader
```

**Implementation:**
```javascript
// Fragment node defines shape/field function
{ kind: "PerlinNoise", params: { scale: 5.0, octaves: 4 } }

// Compute node can reference it
// (Compute shader includes field evaluation code)
let field_value = evaluate_field_function(samplePoint, params);
```

### 3.5 Compute-to-Compute Value Flow

**Texture Binding:**
```
Node A (Compute) → Node B (Compute)
     ↓                    ↓
Texture Output   Bind as input texture
```

**Execution:**
```javascript
// ComputeExecutor ensures A executes before B
executionOrder = [nodeA_id, nodeB_id];

// Dispatch A first
nodeA.dispatch(device, encoder, time);
nodeOutputs.set(nodeA_id, nodeA.getOutputTexture());

// Then B (can read A's output)
nodeB.dispatch(device, encoder, time);  // Reads from A's texture
```

---

## Part 4: Existing Preview & Visualization Components

### 4.1 Canvas 2D Preview System

**Location:** `/src/core/PreviewSystem.js`

**Components:**
- **CanvasManager:** Manages small 48x48 preview canvases
- **NodeValueComputer:** Evaluates node outputs for visualization
- **RendererRegistry:** Maps node types to preview renderers

**Renderer Types:**
- BasicRenderers (for colors, values)
- MathRenderers (operations)
- VectorRenderers (vec2, vec3)
- NoiseRenderers (Perlin, Fractal)
- TextureRenderers (samplers)
- GradientRenderers (color gradients)
- TransformRenderers (rotation, scale)

**Preview Update Flow:**
```
Node Parameter Changes
    ↓
Editor.onChange() event
    ↓
updateShaderFromGraph()
    ↓
PreviewSystem.updateNodePreviews()
    ↓
For each node with preview:
  ├─ nodeValueComputer.compute()
  ├─ Find appropriate renderer
  ├─ Render to small canvas
  └─ Update node UI thumbnail
```

### 4.2 GPU Renderer (WebGPU)

**Location:** `/src/gpu/gpuRenderer.js`

**Responsibilities:**
- Canvas WebGPU context management
- MSAA (4x antialiasing) support
- Pipeline creation and caching
- Bind group management
- Texture resource allocation

**Render Pipeline:**
```javascript
class GPURenderer {
  // Setup
  constructor(device, canvas) {
    this.device = device;
    this.canvas = canvas;
    this.context = canvas.getContext("webgpu");
    this.sampleCount = 4;  // MSAA
  }
  
  // Main render method
  render({ wgsl, uniforms, graph, timeSec }) {
    // 1. Create/update pipeline
    this._createOrUpdatePipeline(wgsl);
    
    // 2. Create bind groups for all resources
    this._createBindGroups(graph, uniforms);
    
    // 3. Create MSAA texture if needed
    if (!this.msaaTexture) this._createMSAATexture();
    
    // 4. Execute render pass
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.sampleCount > 1 ? 
          this.msaaTexture.createView() : 
          this.context.getCurrentTexture().createView(),
        clearValue: [0, 0, 0, 1],
        loadOp: "clear",
        storeOp: "store"
      }]
    });
    
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroups[0]);
    pass.draw(4, 1, 0, 0);  // Fullscreen quad
    pass.end();
    
    // Resolve MSAA if needed
    if (this.sampleCount > 1) {
      encoder.copyTextureToTexture(
        { texture: this.msaaTexture },
        { texture: this.context.getCurrentTexture() },
        [this.canvas.width, this.canvas.height]
      );
    }
    
    this.device.queue.submit([encoder.finish()]);
  }
}
```

### 4.3 ComputeProfiler & Performance Monitoring

**Location:** `/src/gpu/ComputeProfiler.js`

**Features:**
- Real-time FPS tracking
- Per-compute-dispatch timing
- GPU timestamp support (with CPU fallback)
- Memory usage estimation
- Performance warnings

**Usage:**
```javascript
// Initialize
const profiler = new ComputeProfiler(device);
window.computeProfiler = profiler;

// Frame tracking
profiler.beginFrame();
  profiler.beginDispatch('ComputeNoise');
  // ... GPU work ...
  profiler.endDispatch();
profiler.endFrame();

// Get metrics
const metrics = profiler.getMetrics();
console.log(`FPS: ${metrics.fps}, Compute: ${metrics.computeTime}ms`);
```

### 4.4 FloatingGPUPreview Component

**Location:** `/src/ui/FloatingGPUPreview.js`

**Purpose:**
- Floating window showing GPU canvas
- Separate from editor UI
- Resizable and draggable
- Toggle visibility

**Integration:**
```javascript
// Created in main.js after WebGPU init
const gpuPreview = new FloatingGPUPreview(canvas, {
  title: "GPU Shader Preview",
  width: 800,
  height: 600,
  x: 100,
  y: 100
});
gpuPreview.show();
```

### 4.5 Field Visualization System

**Location:** `/src/scene/FieldVisualizer.js`

**Visualization Modes:**
1. **Point Cloud** - Individual points where field > threshold
2. **Mesh** - Surface constructed via marching cubes algorithm
3. **Volume** - Voxel visualization

**Capabilities:**
```javascript
class FieldVisualizer {
  // Parameters
  mode: 'points' | 'mesh'
  dimensions: [width, height, depth]
  threshold: 0.5
  isoValue: 0.5
  pointSize: 0.02
  colorMode: 'field' | 'gradient' | 'solid'
  fieldBounds: { min: [x,y,z], max: [x,y,z] }
  
  // Methods
  initialize(device, fieldData)
  generatePointCloud()
  generateMesh()  // Uses MarchingCubes algorithm
  updateVisualization(fieldData)
}
```

**Integration with 3D Scene:**
```javascript
// ComputeFieldMapperNode in scene graph
const fieldMapper = new ComputeFieldMapperNode(
  'FieldVisualizer1',
  {
    inputNode: noiseNode,  // Fragment node with field function
    mode: 'points'
  }
);

scene.addNode(fieldMapper);
```

---

## Part 5: UI/Rendering Architecture

### 5.1 Main Entry Point

**Location:** `/main.js`

**Initialization Sequence:**
```javascript
// 1. Request GPU device
const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();

// 2. Initialize GPU systems
window.gpuRenderer = new GPURenderer(device, canvas);
window.textureManager = new TextureManager();

// 3. Initialize profiling
window.computeProfiler = new ComputeProfiler(device);
window.profilerOverlay = new ComputeProfilerOverlay();

// 4. Create editor
const editor = new Editor(graph, onChange, undoManager);

// 5. Start render loop
const renderLoop = new RenderLoop({
  onFrame: (frameInfo) => {
    renderFrame(frameInfo);
  },
  mode: "vsync"  // or "fixed"
});
renderLoop.start();
```

### 5.2 Editor Class

**Location:** `/src/core/Editor.js`

**Responsibilities:**
- Node graph management
- UI event handling
- Selection and editing
- Preview system coordination
- Undo/redo system

**Key Systems:**
```javascript
class Editor {
  constructor(graph, onChange, undoManager) {
    this.graph = graph;
    this.onChange = onChange;
    this.undoManager = undoManager;
    
    // Sub-systems
    this.eventHandler = new EventHandler(this);
    this.renderer = new Renderer(ctx, viewport);
    this.previewSystem = new PreviewSystem(this);
    this.previewComputer = new PreviewComputer(this);
    this.selectionManager = new SelectionManager();
    this.connectionManager = new ConnectionManager(this.graph);
    this.viewportManager = new ViewportManager();
    
    // Parameter system
    this.expressionSystem = expressionSystem;
    this.parameterEventSystem = new ParameterEventSystem();
    this.parameterBindingSystem = new ParameterBindingSystem();
    
    // State
    this.nodePreviews = new Map();
    this.isPreviewEnabled = true;
    
    // Optimization
    this._isDirty = true;
    this._dirtyReasons = new Set();
  }
}
```

### 5.3 Render Loop

**Location:** `/src/core/RenderLoop.js`

**Modes:**
- `vsync` - Sync with display refresh (default)
- `fixed` - Fixed timestep (e.g., 60 FPS)

**Frame Structure:**
```javascript
class RenderLoop {
  constructor({ onFrame, mode = "vsync", fixedFps = 60 }) {
    this.onFrame = onFrame;
    this.mode = mode;
    this.fixedFps = fixedFps;
  }
  
  start() {
    this._scheduleNextFrame();
  }
  
  _handleFrame(timestampMs) {
    // Calculate delta
    const elapsedMs = timestampMs - this._lastTimestamp;
    const rawDelta = Math.min(elapsedMs / 1000, this.maxFrameDelta);
    
    // Fixed timestep accumulation
    if (this.mode === "fixed") {
      this._accumulator += rawDelta;
      while (this._accumulator >= stepSize) {
        this._step(stepSize);
        this._accumulator -= stepSize;
      }
    } else {
      this._step(rawDelta);  // vsync: single step per frame
    }
  }
}
```

### 5.4 Complete Render Frame Flow

**In main.js:**
```javascript
async function renderFrame(frameInfo) {
  try {
    // 1. Update shader from graph (if dirty)
    if (editor._isDirty) {
      await updateShaderFromGraph();
    }
    
    // 2. Update parameters/uniforms
    if (window.nodeCompiler?.uniformManager) {
      window.nodeCompiler.uniformManager.updateValues(graph);
    }
    
    // 3. Process pending updates (scene graph, field visualization)
    if (window.visualizerManager) {
      await window.visualizerManager.processPendingUpdates(frameInfo.simTime);
    }
    
    // 4. Render GPU (computes + fragment)
    const { wgsl, uniformManager } = buildWGSL(graph);
    
    gpuRenderer.render({
      wgsl,
      graph,
      timeSec: frameInfo.simTime,
      computeExecutor: window.computeExecutor
    });
    
    // 5. Update editor canvas (2D node previews)
    if (editor.isPreviewEnabled) {
      editor.previewSystem.updateNodePreviews(graph);
    }
    
    // 6. Render editor UI
    editor.renderer.render(graph, {
      editor,
      selection: editor.selectionManager.selected,
      dragWire: editor.dragWire,
      boxSelect: editor.boxSelect
    });
    
    // 7. Update performance monitor
    if (window.gpuPerformanceMonitor) {
      window.gpuPerformanceMonitor.updateMetrics(frameInfo);
    }
    
  } catch (error) {
    window.errorHandler?.handleError(error, { context: 'renderFrame' });
  }
}
```

### 5.5 Parameter System Integration

**Parameter Change Flow:**
```
User Changes Parameter (UI Slider)
    ↓
paramPanel.onParameterChange()
    ↓
editor.handleParameterChange(nodeId, paramName, value)
    ↓
// 1. Update node data
node.params[paramName] = value;

// 2. Emit event
parameterEventSystem.emit(PARAMETER_CHANGED, {
  nodeId, paramName, newValue: value
});

// 3. Mark as dirty
editor._isDirty = true;
editor._dirtyReasons.add('parameter-change');

// 4. Next frame:
// - Recompile shader
// - Update uniforms
// - Update previews
// - Render
```

---

## Part 6: Update/Throttling Mechanisms

### 6.1 Dirty Flag Optimization

**Location:** `/src/core/Editor.js`

```javascript
// Track what changed
class Editor {
  _isDirty = true;
  _dirtyReasons = new Set();
  
  markDirty(reason) {
    this._isDirty = true;
    this._dirtyReasons.add(reason);
    console.log(`[Dirty] ${reason}`);
  }
  
  // In render frame
  if (editor._isDirty) {
    await updateShaderFromGraph();
    editor._isDirty = false;
    editor._dirtyReasons.clear();
  }
}
```

**Dirty Triggers:**
- `node-added`
- `node-removed`
- `connection-changed`
- `parameter-change`
- `graph-loaded`
- `undo-redo`

### 6.2 Preview Update Throttling

**Location:** `/src/core/PreviewSystem.js`

```javascript
updateNodePreviews(graph) {
  // Skip if preview disabled
  if (!this.editor.isPreviewEnabled) return;
  
  // Only update if graph changed
  if (!this._cacheValid) {
    // Topological sort (cached)
    const orderedNodes = this._sortCache || 
                        topologicalSort(graph);
    
    // Update each node preview
    for (const node of orderedNodes) {
      if (this.renderingNodes.has(node.id)) {
        this._updateSinglePreview(node);
      }
    }
    
    this._cacheValid = true;
  }
}

_updateSinglePreview(node) {
  // Compute output value
  const nodeValue = this.nodeValueComputer.compute(
    node, this.graph
  );
  
  // Get renderer for node type
  const renderer = this.rendererRegistry.get(node.kind);
  if (renderer) {
    renderer.render(nodeValue, canvas);
  }
}
```

### 6.3 GPU Dispatch Optimization

**Location:** `/src/gpu/ComputeExecutor.js`

```javascript
execute(encoder, time) {
  for (const nodeId of this.executionOrder) {
    const manager = this.computeManagers.get(nodeId);
    
    // Check if inputs/parameters changed
    const currentHash = hashInputs(nodeId);
    const lastHash = this.inputHashes.get(nodeId);
    
    if (currentHash !== lastHash) {
      // Inputs changed: dispatch
      manager.dispatch(device, encoder, time);
      this.inputHashes.set(nodeId, currentHash);
      
      // Update output dictionary
      this.nodeOutputs.set(nodeId, manager.getOutputTexture());
    }
    // else: skip - no changes needed
  }
}
```

### 6.4 MIDI Parameter Update Throttling

**Location:** `/src/core/Editor.js`

```javascript
// For MIDI parameters that update frequently
midiPreviewUpdateDelay = 500;  // ms
midiPreviewUpdateTimer = null;

handleMIDIParameterChange(nodeId, paramName, value) {
  // Update model immediately
  node.params[paramName] = value;
  
  // But throttle preview updates
  if (this.midiPreviewUpdateTimer) {
    clearTimeout(this.midiPreviewUpdateTimer);
  }
  
  this.midiPreviewUpdateTimer = setTimeout(() => {
    // Update previews after 500ms of inactivity
    this.previewSystem.updateNodePreviews(this.graph);
    this.midiPreviewUpdateTimer = null;
  }, this.midiPreviewUpdateDelay);
  
  // Always mark shader dirty for GPU
  this._isDirty = true;
}
```

### 6.5 Shader Recompilation Avoidance

**In buildWGSL():**
```javascript
// Clear caches at start
compiler.uniformManager.clear();
processor.clearFunctionCollection();
compiler.compilers.field.clearFunctionCache();

// Compile nodes
const compiledData = compiler.compileNodes(orderedNodes);

// Collect all function definitions (cached)
const shapeFunctions = compiler.compilers.field.getAllFunctionDefinitions();
const transformHelpers = compiler.compilers.transform.getHelperFunctions();
const noiseHelpers = compiler.compilers.noise.getHelperFunctions();

// Generate shader
const wgsl = generateShader({...}, textureBindings);

// Only create new pipeline if shader changed
if (lastShaderHash !== hash(wgsl)) {
  gpuRenderer._createOrUpdatePipeline(wgsl);
  lastShaderHash = hash(wgsl);
}
```

---

## Part 7: Data Flow Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER INPUT LAYER                             │
├─────────────────────────────────────────────────────────────────────┤
│  Parameter Panel │ MIDI Controller │ Timeline │ Undo/Redo │ Keyboard │
└────────┬─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EDITOR CORE (Editor.js)                         │
├─────────────────────────────────────────────────────────────────────┤
│  • Node Graph Management                                              │
│  • Event Handling (ConnectionManager, SelectionManager)              │
│  • Parameter Binding System                                          │
│  • Dirty Flag System                                                 │
│  • Undo/Redo Coordination                                            │
└────────┬──────────────────────────────────────────────────────────────┘
         │
    ┌────┴──────┬────────────────┬────────────────┐
    │            │                │                │
    ▼            ▼                ▼                ▼
┌─────────┐ ┌─────────────┐ ┌──────────────┐ ┌─────────────┐
│ Preview │ │ Compilation │ │ GPU Dispatch │ │  Parameter  │
│ System  │ │ System      │ │  Executor    │ │   Update    │
├─────────┤ ├─────────────┤ ├──────────────┤ ├─────────────┤
│ Canvas  │ │ GraphProc.  │ │ Topological  │ │ Uniform     │
│ Render  │ │ NodeCompile │ │ Sort         │ │ Manager     │
│ Preview │ │ Type Conv.  │ │ Dispatch in  │ │ Expression  │
│ Thumbs  │ │ glslBuilder │ │ Dependency   │ │ System      │
│         │ │ Templates   │ │ Order        │ │ Event Emit  │
└─────────┘ └──────┬──────┘ └──────┬───────┘ └─────────────┘
            │                      │
            ▼                      ▼
    ┌──────────────────┐  ┌──────────────────┐
    │  WGSL Shader     │  │ ComputeNodeBase  │
    │  + Uniforms      │  │ + ComputeShader  │
    │  + Bindings      │  │   Manager        │
    └────────┬─────────┘  └──────────┬───────┘
             │                       │
             ▼                       ▼
    ┌──────────────────────────────────────────┐
    │         GPU EXECUTION LAYER              │
    ├──────────────────────────────────────────┤
    │  1. Compute Shaders (ComputeExecutor)    │
    │     - Noise, Blur, RD, Particles, etc.   │
    │     - Store outputs in textures          │
    │                                          │
    │  2. Fragment Shader (GPURenderer)        │
    │     - Sample compute outputs             │
    │     - Execute per-pixel operations       │
    │     - Render to canvas                   │
    └─────────────────────────┬────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Canvas Output   │
                    │ (2D GPU Result)  │
                    │  + Editor UI     │
                    │  (Node Graph)    │
                    └──────────────────┘
```

---

## Part 8: Key Files Reference

### Core GPU Infrastructure
| File | Purpose |
|------|---------|
| `/src/gpu/ComputeNodeBase.js` | Unified API for compute nodes (15KB) |
| `/src/gpu/ComputeShaderManager.js` | GPU resource management (17KB) |
| `/src/gpu/ComputeExecutor.js` | Execution orchestration (18KB) |
| `/src/gpu/gpuRenderer.js` | WebGPU render pipeline (29KB) |
| `/src/gpu/ComputeProfiler.js` | Performance monitoring (9KB) |
| `/src/gpu/FeedbackManager.js` | Ping-pong buffer abstraction (11KB) |

### Compilation System
| File | Purpose |
|------|---------|
| `/src/codegen/glslBuilder.js` | Main orchestrator |
| `/src/codegen/processors/GraphProcessor.js` | Graph analysis |
| `/src/codegen/processors/NodeCompiler.js` | Node compilation |
| `/src/codegen/processors/TypeConverter.js` | Type inference |
| `/src/codegen/compilers/ComputeNodes.js` | Compute shader generation |
| `/src/codegen/compilers/FieldNodes.js` | Fragment function generation |
| `/src/codegen/templates/ShaderTemplate.js` | Final assembly |

### Node Definitions
| File | Purpose |
|------|---------|
| `/src/data/nodes/ComputeNodes.js` | Compute node metadata |
| `/src/data/nodes/FieldNodes.js` | Shape/field functions |
| `/src/data/nodes/MathNodes.js` | Math operations |
| `/src/data/nodes/VectorNodes.js` | Vector operations |
| `/src/data/nodes/InputNodes.js` | Input (Time, UV, etc.) |
| `/src/data/nodes/OutputNodes.js` | Output targets |

### Editor Core
| File | Purpose |
|------|---------|
| `/src/core/Editor.js` | Main editor logic (60KB) |
| `/src/core/Renderer.js` | 2D canvas rendering |
| `/src/core/PreviewSystem.js` | Node preview thumbnails (22KB) |
| `/src/core/PreviewComputer.js` | Preview value calculation (57KB) |
| `/src/core/RenderLoop.js` | Frame timing control (5KB) |
| `/src/core/EventHandler.js` | Input events (16KB) |

### Parameter System
| File | Purpose |
|------|---------|
| `/src/gpu/ParameterUniformManager.js` | GPU uniform management (10KB) |
| `/src/parameters/UnifiedParameterHandler.js` | Parameter handling |
| `/src/utils/ParameterEventSystem.js` | Parameter change events |
| `/src/utils/ParameterExpressionSystem.js` | Expression evaluation |
| `/src/utils/ParameterBindingSystem.js` | MIDI/Timeline binding |

### UI Components
| File | Purpose |
|------|---------|
| `/src/ui/ParameterPanel.js` | Parameter controls |
| `/src/ui/ComputeProfilerOverlay.js` | Performance display |
| `/src/utils/GPUPerformanceMonitor.js` | Performance monitoring |
| `/src/ui/FloatingGPUPreview.js` | Floating preview window |

### Scene Graph (3D)
| File | Purpose |
|------|---------|
| `/src/scene/Scene.js` | Scene management |
| `/src/scene/Viewport3D.js` | 3D camera & viewport |
| `/src/scene/FieldVisualizer.js` | Field to geometry conversion |
| `/src/scene/FieldVisualizerManager.js` | Field visualization orchestration |
| `/src/scene/nodes/ComputeFieldMapperNode.js` | Field mapper node |

### Entry Point
| File | Purpose |
|------|---------|
| `/main.js` | Application initialization |

---

## Part 9: Real-Time Shader Preview Implementation Strategy

### Current Capabilities
✅ GPU-accelerated rendering (WebGPU)
✅ Compute shader support with topological execution
✅ Real-time parameter updates via uniforms
✅ Performance monitoring with frame rate tracking
✅ Separate preview systems (2D thumbnails + 3D canvas)
✅ Dirty flag optimization to avoid unnecessary recompilation

### Recommended Enhancements for Real-Time Preview with GPU Compute

1. **Reduce Recompilation Frequency**
   - Cache compiled shaders by content hash
   - Separate parameter uniforms from shader code
   - Only recompile on structural changes

2. **Optimize Compute Dispatch**
   - Profile compute shader execution times
   - Implement adaptive resolution scaling
   - Use feedback only when necessary

3. **Parallel Rendering**
   - Update 3D scene graph in parallel with shader compilation
   - Decouple compute execution from fragment rendering
   - Pre-allocate GPU resources for common patterns

4. **Performance Monitoring Integration**
   - Track compilation times alongside GPU execution
   - Alert user when frame time exceeds 16.67ms
   - Provide suggestions for optimization

---

**End of Comprehensive Overview**

---

## Part 10: Canvas Redraw Trigger Surface (Nov 2025)

### Overview
All redraws converge on the `Editor.markDirty()` → `Editor.draw()` → `Renderer.render()` pipeline. The legacy idea of calling `Renderer.requestRedraw()` is effectively implemented via two surfaces: `EventHandler._requestDraw(reason)` (used by interactive tooling) and direct `editor.markDirty(reason)` calls (used by systems running outside the canvas controller). Understanding who calls these entry points is essential for throttling and instrumentation.

### Trigger Catalog
- **User Input (`src/core/EventHandler.js`):**  
  Panning, zooming, node dragging, box selection, connection edits, delete key operations, and preview toggle buttons all call `_requestDraw()` with descriptive reasons (`pan`, `node-drag`, `wire-drag`, `box-select`, `toggle-preview`, etc.). `_requestDraw()` now emits diagnostics before setting the dirty flag.
- **Graph Mutations:**  
  `src/core/ConnectionManager.js` (connection add/remove), `src/ui/RadialMenu.js` (node creation), `src/core/UndoManager.js` (undo/redo stacks), and `src/core/SaveLoadManager.js` (load steps & retries) call `window.editor.markDirty(<reason>)` after mutating the graph. Reasons include `connection-added`, `node-creation`, `undo-redo`, and `file-load-*`.
- **Parameter & Expression Updates:**  
  `src/ui/ParameterPanel.js`, `src/ui/components/TextInputHandler.js`, `src/ui/components/FileInputHandler.js`, `src/utils/ParameterExpressionSystem.js`, `src/midi/MIDIParameterBinding.js`, and `src/core/preview/PreviewIntegration.js` mark the editor dirty while values are typed, dragged, MIDI-driven, or recomputed. Reasons: `parameter-drag`, `parameter-change`, `dependent-update`, `midi-parameter-update`, `time-node-update`, etc.
- **Automation / Background Warmup:**  
  `EventHandler._startContinuousWarmup()` + `_checkAndWarmupAfterInactivity()` periodically mark the canvas dirty (`background-warmup`, `warmup`) to keep the 2D context hot. `PreviewIntegration` batches also emit `parameter-change-batch`. These run asynchronously and can fire even without user input.
- **Dev/Test Utilities:**  
  `src/utils/PanningTestScenarios.js` replays scripted gestures by directly calling `_requestDraw()`. These only activate when the helper is imported but will appear in diagnostics when in use.

### Propagation Diagram
```
┌───────────────┐      ┌────────────────────────┐      ┌──────────────────────┐      ┌────────────────────┐
│ Trigger Source│ ───▶ │ Dirty Flag Surfaces     │ ───▶ │ Editor.draw()        │ ───▶ │ Renderer.render()   │
│ (interaction, │      │ - EventHandler._request│      │ - checks _isDirty     │      │ - nodes, wires, UI  │
│ data, async)  │      │ - window.editor.markDirty│    │ - throttles panning   │      │ - canvas commit     │
└───────────────┘      │ - Editor.safeDraw       │      │ - clears dirty state  │      └────────────────────┘
        │              └────────────────────────┘      └──────────────────────┘
        │                         ▲
        └─────────────┬───────────┘
                      │
   User Input (EventHandler) / Graph Mutations (ConnectionManager, UndoManager) /
   Parameter + MIDI Feeds (ParameterPanel, ExpressionSystem, MIDI) /
   Data Sync (SaveLoadManager) / Background Warmup (EventHandler timers)
```

### Instrumentation
- **New helper (`src/utils/RedrawDiagnostics.js`):** opt-in logging for redraw analysis.
  - `window.enableRedrawDiagnostics(true)` turns tracing on (stores ~400 entries).
  - `window.getRedrawDiagnostics()` dumps `{type, ts, reason, detail}` samples.
- **Hook points:**
  - `EventHandler._requestDraw()` → `type: "trigger"` with `reason`, `_isPanning`, `_isCanvasInteracting`.
  - `Editor.markDirty()` → `type: "dirty"` entries showing reasons + affected regions.
  - `Editor.draw()` → `type: "commit"` entries capturing the batch of dirty regions/reasons and whether the renderer was in an interaction/throttled state.

With tracing enabled it becomes straightforward to correlate UI gestures or background jobs with actual render commits, highlight redundant dirty calls, and surface latent async triggers (e.g., delayed save/load retries) that might otherwise be mistaken for user interaction.