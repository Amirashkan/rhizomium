# Unified Compute Node API

## Overview

The `ComputeNodeBase` class provides a unified, consistent API for all compute nodes in the GLSL Node Editor. This API makes compute nodes reusable, serializable, and easier to integrate into the node system.

## Key Features

- **Unified Interface**: All compute nodes expose the same API methods
- **Serialization**: Save and load node state to/from JSON
- **Parameter Management**: Set and get uniforms with simple methods
- **GPU Resource Management**: Automatic handling of WebGPU resources
- **Backward Compatible**: Works alongside existing ComputeShaderManager code

## Core API

### Constructor

```javascript
const node = new ComputeNodeBase(device, {
  id: 'unique_node_id',
  kind: 'ComputeNoise',
  params: {
    scale: 8.0,
    octaves: 5,
    speed: 0.1
  },
  metadata: {
    label: 'Noise Generator',
    description: 'Generates procedural noise',
    category: 'Compute'
  }
});
```

### Required Methods

#### `initialize(wgslSource, width, height, supportsFeedback)`

Initialize the compute node with WGSL shader code and texture dimensions.

```javascript
await node.initialize(wgslSource, 512, 512, false);
```

**Parameters:**
- `wgslSource` (string): WGSL compute shader source code
- `width` (number): Output texture width
- `height` (number): Output texture height
- `supportsFeedback` (boolean): Whether this node uses ping-pong buffers

#### `dispatch(device, encoder, time)`

Dispatch the compute shader for execution.

```javascript
const encoder = device.createCommandEncoder();
const time = performance.now() / 1000;
node.dispatch(device, encoder, time);
device.queue.submit([encoder.finish()]);
```

**Parameters:**
- `device` (GPUDevice): WebGPU device
- `encoder` (GPUCommandEncoder): Command encoder
- `time` (number): Current time in seconds

#### `getOutputTexture()`

Get the output texture for rendering or sampling.

```javascript
const texture = node.getOutputTexture();
```

**Returns:** `GPUTexture` - The output texture

#### `setUniform(name, value)`

Set a uniform parameter value.

```javascript
node.setUniform('scale', 12.0);
node.setUniform('octaves', 7);
```

**Parameters:**
- `name` (string): Parameter name
- `value` (any): Parameter value

#### `serialize()`

Serialize the node to JSON.

```javascript
const data = node.serialize();
// Returns:
// {
//   id: 'node_123',
//   kind: 'ComputeNoise',
//   params: { scale: 12.0, octaves: 7, ... },
//   metadata: { ... },
//   dimensions: { width: 512, height: 512 },
//   supportsFeedback: false
// }
```

**Returns:** `Object` - Serialized node data

#### `static deserialize(device, data)`

Restore a node from serialized data.

```javascript
const node = ComputeNodeBase.deserialize(device, data);
// Note: Must call initialize() with WGSL before using
```

**Parameters:**
- `device` (GPUDevice): WebGPU device
- `data` (Object): Serialized node data

**Returns:** `ComputeNodeBase` - Deserialized node instance

### Additional Methods

#### `updateParams(params)`

Update multiple parameters at once.

```javascript
node.updateParams({
  scale: 10.0,
  octaves: 6,
  speed: 0.2
});
```

#### `getUniform(name)`

Get a uniform parameter value.

```javascript
const scale = node.getUniform('scale');
```

#### `resize(width, height)`

Resize the output textures.

```javascript
node.resize(1024, 1024);
```

#### `reset()`

Reset the simulation (for reaction-diffusion and cellular automata).

```javascript
node.reset();
```

#### `getInfo()`

Get node information for debugging.

```javascript
const info = node.getInfo();
console.log(info);
// {
//   id: 'node_123',
//   kind: 'ComputeNoise',
//   initialized: true,
//   dimensions: { width: 512, height: 512 },
//   supportsFeedback: false,
//   params: { ... },
//   metadata: { ... }
// }
```

#### `destroy()`

Clean up GPU resources.

```javascript
node.destroy();
```

## Integration with ComputeExecutor

The `ComputeExecutor` class has been updated to support both the unified API and legacy code.

### Adding Nodes Directly

```javascript
const executor = new ComputeExecutor(device);

// Create and initialize a compute node
const node = new ComputeNodeBase(device, { ... });
await node.initialize(wgslSource, 512, 512);

// Add to executor
executor.addComputeNode(node);

// Execute on each frame
const encoder = device.createCommandEncoder();
executor.execute(encoder, time);
device.queue.submit([encoder.finish()]);
```

### Managing Nodes

```javascript
// Get a node by ID
const node = executor.getComputeNode('node_123');

// Set uniform through executor
executor.setUniform('node_123', 'scale', 15.0);

// Remove a node
executor.removeComputeNode('node_123');

// Get info
const info = executor.getInfo();
console.log(info.unifiedApiNodes); // Array of node IDs
```

### Serialization

```javascript
// Serialize all nodes
const data = executor.serializeAll();
localStorage.setItem('compute_nodes', JSON.stringify(data));

// Deserialize nodes
const data = JSON.parse(localStorage.getItem('compute_nodes'));
const nodes = executor.deserializeAll(data);

// Initialize each node with WGSL and add to executor
for (const node of nodes) {
  await node.initialize(wgslSource, node.width, node.height);
  executor.addComputeNode(node);
}
```

## Factory Method

Create nodes from node definitions (from `ComputeNodes.js`):

```javascript
import { ComputeNodes } from '../data/nodes/ComputeNodes.js';

const nodeDef = ComputeNodes.ComputeNoise;
const node = ComputeNodeBase.fromDefinition(
  device,
  nodeDef,
  'ComputeNoise_123',
  { scale: 10.0 } // Override defaults
);
```

## Example: Complete Workflow

```javascript
import { ComputeNodeBase } from './gpu/ComputeNodeBase.js';
import { ComputeExecutor } from './gpu/ComputeExecutor.js';

// 1. Create executor
const executor = new ComputeExecutor(device);

// 2. Create a compute node
const noiseNode = new ComputeNodeBase(device, {
  id: 'noise_1',
  kind: 'ComputeNoise',
  params: {
    scale: 8.0,
    octaves: 5,
    speed: 0.1,
    colorize: true,
    resolution: '512'
  }
});

// 3. Initialize with WGSL (would be generated by compiler)
const wgslSource = `
  @group(0) @binding(0) var<uniform> params: Uniforms;
  @group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;

  struct Uniforms {
    resolution: vec2<f32>,
    time: f32,
    scale: f32,
    octaves: f32,
    speed: f32,
    pad0: f32,
    pad1: f32
  }

  @compute @workgroup_size(8, 8)
  fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let coords = vec2<i32>(global_id.xy);
    let uv = vec2<f32>(global_id.xy) / params.resolution;

    // Noise generation logic...
    let noise = fract(sin(dot(uv + params.time * params.speed,
                              vec2<f32>(12.9898, 78.233))) * 43758.5453);
    let color = vec4<f32>(noise, noise, noise, 1.0);

    textureStore(outputTexture, coords, color);
  }
`;

await noiseNode.initialize(wgslSource, 512, 512, false);

// 4. Add to executor
executor.addComputeNode(noiseNode);

// 5. Render loop
function render(time) {
  const encoder = device.createCommandEncoder();

  // Update parameters
  noiseNode.setUniform('speed', Math.sin(time) * 0.2 + 0.1);

  // Execute compute shaders
  executor.execute(encoder, time);

  // Get output texture for fragment shader
  const outputTexture = noiseNode.getOutputTexture();

  // ... render with fragment shader ...

  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
```

## Migration Guide

### From Legacy ComputeShaderManager

**Before:**
```javascript
const manager = new ComputeShaderManager(device, node);
await manager.initialize(wgslSource, 512, 512);
manager.dispatch(encoder, time);
const texture = manager.getOutputTexture();
```

**After:**
```javascript
const computeNode = new ComputeNodeBase(device, {
  id: node.id,
  kind: node.kind,
  params: node.params
});
await computeNode.initialize(wgslSource, 512, 512);
computeNode.dispatch(device, encoder, time); // Note: device parameter added
const texture = computeNode.getOutputTexture();
```

### Key Differences

1. **Constructor**: ComputeNodeBase takes a configuration object instead of node reference
2. **dispatch()**: Requires `device` as first parameter (for API consistency)
3. **Additional Methods**: `setUniform()`, `serialize()`, `deserialize()` are new
4. **Metadata**: ComputeNodeBase stores additional metadata for better introspection

## Architecture

```
┌─────────────────────────────────────────┐
│         ComputeNodeBase                 │
│  ┌───────────────────────────────────┐  │
│  │ - id, kind, params, metadata      │  │
│  │ - Unified API methods             │  │
│  │ - Serialization support           │  │
│  └───────────────┬───────────────────┘  │
│                  │                       │
│                  ▼                       │
│  ┌───────────────────────────────────┐  │
│  │   ComputeShaderManager            │  │
│  │  - WebGPU pipeline                │  │
│  │  - Texture management             │  │
│  │  - Uniform buffer handling        │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

ComputeNodeBase **wraps** ComputeShaderManager and adds:
- Standard interface
- Parameter management
- Serialization
- Metadata storage

## Best Practices

1. **Always initialize before dispatch**: Call `initialize()` before using the node
2. **Clean up resources**: Call `destroy()` when done with a node
3. **Use the executor**: Let `ComputeExecutor` manage multiple nodes
4. **Serialize for persistence**: Save node state for undo/redo or project files
5. **Validate parameters**: Check parameter ranges before calling `setUniform()`

## Future Extensions

Potential future enhancements:

- **Input connections**: Track which nodes feed into this node
- **Dependency resolution**: Auto-dispatch dependencies before this node
- **Parameter validation**: Type checking and range validation
- **Hot reload**: Reload WGSL without recreating GPU resources
- **Performance metrics**: Track dispatch time and GPU usage

## See Also

- [COMPUTE_NODES.md](../COMPUTE_NODES.md) - Overview of compute node system
- [ComputeNodeExample.js](../src/gpu/examples/ComputeNodeExample.js) - Code examples
- [ComputeShaderManager.js](../src/gpu/ComputeShaderManager.js) - Low-level GPU manager
