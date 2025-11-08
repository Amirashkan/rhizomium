# GLSL Node Editor - Quick Reference Guide

## Key File Locations & Purposes

### GPU/Compute Infrastructure
```
src/gpu/
├── ComputeNodeBase.js           (15 KB) - Unified API for compute nodes
├── ComputeShaderManager.js      (17 KB) - GPU texture & pipeline management
├── ComputeExecutor.js           (18 KB) - Topological execution orchestration
├── gpuRenderer.js               (29 KB) - WebGPU render pipeline
├── ComputeProfiler.js           ( 9 KB) - GPU performance monitoring
├── FeedbackManager.js           (11 KB) - Ping-pong buffer abstraction
├── ParameterUniformManager.js   (10 KB) - Dynamic uniform management
└── examples/                          - Usage examples
```

### Compilation & Code Generation
```
src/codegen/
├── glslBuilder.js                     - Main orchestrator
├── processors/
│   ├── GraphProcessor.js              - Graph analysis & topological sort
│   ├── NodeCompiler.js                - Node code generation
│   └── TypeConverter.js               - Type inference
├── compilers/
│   ├── ComputeNodes.js                - Compute shader generation
│   ├── FieldNodes.js                  - Shape/field functions
│   └── [Math|Vector|Transform|...]Nodes.js
├── generators/
│   └── TextureBindings.js             - Texture binding code
└── templates/
    └── ShaderTemplate.js              - Final WGSL assembly
```

### Node Definitions
```
src/data/nodes/
├── ComputeNodes.js              - Compute node metadata & parameters
├── FieldNodes.js                - Shape/field function definitions
├── MathNodes.js                 - Arithmetic operations
├── VectorNodes.js               - Vector operations
├── InputNodes.js                - Time, UV, coordinate inputs
├── OutputNodes.js               - Output targets
└── [Blend|Noise|Texture|...]Nodes.js
```

### Editor Core
```
src/core/
├── Editor.js                    (60 KB) - Main editor logic
├── Renderer.js                        - 2D canvas rendering
├── PreviewSystem.js             (22 KB) - Node preview thumbnails
├── PreviewComputer.js           (57 KB) - Preview value computation
├── RenderLoop.js                ( 5 KB) - Frame timing control
├── EventHandler.js              (16 KB) - Input event handling
├── preview/
│   ├── CanvasManager.js               - Preview canvas management
│   ├── NodeValueComputer.js           - Compute node outputs
│   ├── RendererRegistry.js            - Preview renderer mapping
│   └── renderers/                     - Preview renderer implementations
├── SaveLoadManager.js           (62 KB) - Project persistence
├── UndoManager.js               (44 KB) - Undo/redo system
└── [...other systems...]
```

### UI Components
```
src/ui/
├── ParameterPanel.js                  - Parameter controls
├── ComputeProfilerOverlay.js          - Performance display overlay
├── FloatingGPUPreview.js               - Floating preview window
└── [Menu|Parameter|...]Panel.js
```

### Parameter System
```
src/parameters/
├── ParameterDefs.js             - Parameter type definitions
└── UnifiedParameterHandler.js   - Parameter processing

src/utils/
├── ParameterEventSystem.js      - Parameter change events
├── ParameterExpressionSystem.js - Expression evaluation
├── ParameterBindingSystem.js    - MIDI/Timeline binding
└── GPUPerformanceMonitor.js     - Performance monitoring
```

### 3D Scene Graph
```
src/scene/
├── Scene.js                     - Scene graph management
├── Viewport3D.js                - 3D camera & viewport
├── FieldVisualizer.js           - Field to geometry conversion
├── FieldVisualizerManager.js    - Visualization orchestration
├── nodes/
│   ├── ComputeFieldMapperNode.js    - Field mapper
│   ├── MeshNode.js
│   ├── CameraNode.js
│   └── LightNode.js
├── renderers/
│   ├── PointCloudRenderer.js
│   └── MeshRenderer.js
└── [math|generators|algorithms]/
```

### Entry Point
```
main.js                         - Application initialization
editor/main.js                  - Editor component (React/Vue)
```

---

## Core Concepts

### 1. Node Types & Execution

**Fragment Nodes**
- Compile to inline WGSL expressions
- Execute per-pixel in fragment shader
- Parameters can be dynamic uniforms or baked
- Examples: UVMap, Gradient, PerlinNoise, Math operations

**Compute Nodes**
- Execute in GPU workgroups before fragment shader
- Store results in GPU textures (rgba8unorm)
- Can use feedback (ping-pong buffers)
- Examples: ComputeNoise, ComputeBlur, ReactionDiffusion, Cellular automata

**Output Pin Types**
- Each node can expose multiple pins (e.g., RGBA, RGB, R, G, B, A)
- Fragment nodes: inline expressions
- Compute nodes: texture sampling code

### 2. Execution Order

```javascript
// Topological sort ensures:
1. All compute nodes execute BEFORE fragment shader
2. Within compute nodes: dependencies execute first
3. Fragment shader can safely sample all compute outputs
```

### 3. Value Propagation Paths

| From | To | Mechanism |
|------|----|-----------| 
| Fragment | Fragment | Variable reference (inlined) |
| Compute | Fragment | Texture sampling |
| Fragment | Compute | Field function evaluation |
| Compute | Compute | Texture binding |

### 4. Parameter System

**Parameter Sources:**
1. UI sliders/inputs
2. MIDI controllers
3. Timeline keyframes
4. Mathematical expressions (e.g., `=sin(time * 2.0)`)

**Parameter Flow:**
```
User Input → Parameter Change Event → Editor marks dirty
→ Next frame: Recompile shader / Update uniforms
→ GPU execution → Render
```

### 5. Optimization Mechanisms

| Mechanism | Purpose | Location |
|-----------|---------|----------|
| Dirty flag | Avoid recompilation when nothing changed | Editor.js |
| Change detection | Only re-dispatch compute nodes if inputs changed | ComputeExecutor.js |
| Preview caching | Skip preview updates if graph unchanged | PreviewSystem.js |
| MIDI throttling | Batch frequent MIDI updates | Editor.js |
| Shader hash caching | Only recreate pipeline if shader changed | glslBuilder.js |

---

## Workflow Sequences

### Adding a Node

```
1. User right-clicks → "Add Node"
2. NodeFactory creates node object: { id, kind, params }
3. Editor.addNode() adds to graph
4. ConnectionManager updates connections
5. Editor._isDirty = true
6. Next frame:
   - buildWGSL() recompiles shader
   - updateShaderFromGraph() sends to GPU
   - gpuRenderer renders new result
   - PreviewSystem updates thumbnails
```

### Changing a Parameter

```
1. User drags parameter slider
2. ParameterPanel emits change event
3. Editor.handleParameterChange() updates node.params[name]
4. ParameterEventSystem.emit(PARAMETER_CHANGED)
5. Editor._isDirty = true
6. Next frame:
   - buildWGSL() may update uniforms
   - ParameterUniformManager updates GPU buffer
   - gpuRenderer renders with new values
```

### Connecting Nodes

```
1. User drags connection
2. ConnectionManager validates types
3. Adds connection to graph.connections
4. Editor._isDirty = true
5. Next frame:
   - buildWGSL() regenerates shader with new code flow
   - Type inference ensures compatibility
   - Topological sort updates execution order
   - GPU renders with new connections
```

### Compute Nodes Specifically

```
1. ComputeNode added to graph
2. buildWGSL() calls ComputeNodes compiler
3. Compiler generates WGSL compute shader
4. Compiler registers in window.computeNodeRegistry
5. buildWGSL() generates texture bindings in fragment shader
6. gpuRenderer.render() called:
   - ComputeExecutor.initialize() creates ComputeShaderManager
   - ComputeExecutor.execute() dispatches in topological order
   - ComputeShaderManager handles uniforms & ping-pong buffers
7. Fragment shader samples compute outputs
```

---

## Performance Monitoring

### Built-in Profiler

```javascript
// Access in browser console:
window.computeProfiler
  .getMetrics() → { fps, frameTime, computeTime, dispatches, workgroups }

// Toggle overlay:
window.gpuPerformanceMonitor.showOverlay()

// Run tests:
window.gpuPerformanceTest.runAllTests()

// Keyboard shortcuts:
Ctrl+P        → Toggle profiler overlay
Ctrl+Shift+P  → Run performance tests
Ctrl+Shift+R  → Reset profiler
Ctrl+Shift+E  → Toggle profiler enabled
```

### Performance Targets

| Metric | Target | Warning |
|--------|--------|---------|
| FPS | 60 | < 30 |
| Frame Time | 16.67 ms | > 33 ms |
| Compute Time | < 8 ms | > 10 ms |
| Shader Compilation | < 100 ms | (immediate warning) |

---

## Common Implementation Patterns

### Creating a Custom Compute Node

1. **Add definition** in `/src/data/nodes/ComputeNodes.js`:
```javascript
export const ComputeNodes = {
  MyCustomCompute: {
    label: "My Effect",
    cat: "Compute",
    inputs: 1,
    pinsIn: ["Input"],
    pinsOut: ["Texture", "RGB"],
    params: [
      { name: 'strength', type: 'float', default: 1.0, min: 0.0, max: 2.0 }
    ],
    workgroupSize: [8, 8, 1]
  }
};
```

2. **Implement compiler** in `/src/codegen/compilers/ComputeNodes.js`:
```javascript
case 'MyCustomCompute':
  return this.generateMyCustomShader(node, getInput);

generateMyCustomShader(node, getInput) {
  return `
    @compute @workgroup_size(8, 8)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
      // Your compute logic
    }
  `;
}
```

3. **Node automatically uses ComputeNodeBase**
   - Registered during compilation
   - Initialized by ComputeExecutor
   - Executed every frame

### Adding a Parameter Type

1. **Define in** `/src/parameters/ParameterDefs.js`
2. **Add UI in** `/src/ui/ParameterPanel.js`
3. **Handle uniforms in** `/src/gpu/ParameterUniformManager.js`
4. **Integrate expressions in** `/src/utils/ParameterExpressionSystem.js`

### Implementing a Preview Renderer

1. **Create in** `/src/core/preview/renderers/`:
```javascript
export const MyRenderer = {
  handles: (nodeKind) => nodeKind === 'MyNode',
  render: (value, canvas) => {
    const ctx = canvas.getContext('2d');
    // Draw value on small canvas
  }
};
```

2. **Register in** `/src/core/PreviewSystem.js`
3. **System automatically uses** for node thumbnails

---

## Debugging Tips

### Enable Debug Logging

```javascript
// Expression system
window.expressionSystem.setDebugMode(true);

// Parameter events
window.parameterEventSystem.enableDebug(true);

// Editor dirty tracking
editor._isDirty = true; editor._dirtyReasons.add('debug');

// GPU profiler
window.computeProfiler.setEnabled(true);
window.gpuPerformanceMonitor.initialize(device);
```

### Inspect Compiled Shader

```javascript
// Get current WGSL
const { wgsl } = buildWGSL(window.graph);
console.log(wgsl);

// Check compute registry
window.computeNodeRegistry.forEach((data, nodeId) => {
  console.log(nodeId, data);
});

// Inspect node graph
console.log(window.graph);

// Check node previews
editor.nodePreviews.forEach((canvas, nodeId) => {
  console.log(nodeId, canvas);
});
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Black canvas | Shader compilation error | Check browser console for WGSL errors |
| No compute output | ComputeExecutor not initialized | Ensure WebGPU device is ready |
| Slow previews | Preview system updating every frame | Increase update throttle delay |
| GPU stall | Too many compute dispatches | Reduce texture resolution or workgroup count |
| Parameter not updating | MIDI/timeline binding conflict | Check parameter binding system |

---

## File Size Overview

| Category | Total | Key Files |
|----------|-------|-----------|
| GPU Infrastructure | ~90 KB | ComputeShaderManager, gpuRenderer, ComputeExecutor |
| Compilation | ~50+ KB | glslBuilder, processors, compilers |
| Editor Core | ~200+ KB | Editor, Renderer, PreviewSystem, PreviewComputer |
| UI | ~50+ KB | ParameterPanel, overlays, menus |
| Data | ~30+ KB | Node definitions, graph structures |
| Utils | ~30+ KB | Parameter system, expression, events |
| Scene Graph | ~40+ KB | Scene, FieldVisualizer, renderers |

**Total Application Size:** ~500-600 KB (before compression)

---

## Architecture Layers (Bottom-Up)

```
┌─────────────────────────────────────────┐
│         User Interaction Layer           │ ← UI, mouse, keyboard, MIDI
├─────────────────────────────────────────┤
│      Application Logic Layer             │ ← Editor, graph management
├─────────────────────────────────────────┤
│      Compilation & Codegen Layer        │ ← WGSL generation
├─────────────────────────────────────────┤
│      Parameter & Expression Layer       │ ← Uniforms, bindings
├─────────────────────────────────────────┤
│         GPU Execution Layer             │ ← ComputeExecutor, dispatch
├─────────────────────────────────────────┤
│         GPU Rendering Layer             │ ← WebGPU pipelines, texture management
├─────────────────────────────────────────┤
│         Hardware Layer (GPU)            │ ← Compute/Fragment execution
└─────────────────────────────────────────┘
```

---

**For Real-Time Shader Preview Implementation:** Focus on the GPU Execution Layer (ComputeExecutor, ComputeNodeBase) and Compilation Layer (glslBuilder, NodeCompiler) to optimize shader compilation and compute dispatch times.
