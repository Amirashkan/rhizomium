# FeedbackManager - Persistent Texture System

## Overview

The `FeedbackManager` class provides a high-level abstraction for managing ping-pong texture systems in feedback-based compute simulations. It automatically handles texture swapping, state persistence, and resource management.

## Features

- **Ping-Pong Textures**: Maintains two GPUTextures that swap each frame
- **Auto-Swap**: Automatically switches read/write textures after each frame
- **State Reset**: `.reset()` method to clear simulation state
- **Custom Initialization**: Support for custom texture initialization functions
- **History Tracking**: Optional history recording for playback/analysis
- **Serialization**: Save and restore simulation state

## Use Cases

The FeedbackManager enables simulations that require persistent state across frames:

- **Reaction-Diffusion**: Pattern formation (corals, spots, waves)
- **Flow Fields**: Fluid-like motion and advection
- **Cellular Automata**: Game of Life and similar systems
- **Accumulation**: Trail effects and motion blur
- **Custom Simulations**: Any multi-pass GPU computation

## API Reference

### Constructor

```javascript
import { FeedbackManager } from './src/gpu/FeedbackManager.js';

const feedbackManager = new FeedbackManager(device, {
  width: 512,           // Texture width
  height: 512,          // Texture height
  format: 'rgba8unorm', // Texture format
  enableHistory: false  // Track history snapshots
});
```

### Core Methods

#### initialize(initializerFn)

Initialize the ping-pong textures. Optionally provide a custom initializer function.

```javascript
// Initialize with default (black)
await feedbackManager.initialize();

// Initialize with custom data
await feedbackManager.initialize((width, height) => {
  const data = new Uint8Array(width * height * 4);
  // Fill data...
  return data;
});
```

#### getReadTexture() / getWriteTexture()

Get the current read or write texture.

```javascript
const readTexture = feedbackManager.getReadTexture();   // Previous frame
const writeTexture = feedbackManager.getWriteTexture(); // Current frame
```

#### getReadView() / getWriteView()

Get texture views for binding to shaders.

```javascript
const readView = feedbackManager.getReadView();
const writeView = feedbackManager.getWriteView();
```

#### swap()

Swap the ping-pong buffers (call once per frame after rendering).

```javascript
feedbackManager.swap();
```

#### reset(initializerFn)

Reset the simulation to initial state.

```javascript
// Reset to black
await feedbackManager.reset();

// Reset with custom initializer
await feedbackManager.reset(createReactionDiffusionInitializer('spots'));
```

#### resize(width, height)

Resize textures (destroys current state).

```javascript
await feedbackManager.resize(1024, 1024);
```

#### destroy()

Clean up GPU resources.

```javascript
feedbackManager.destroy();
```

### Helper Functions

#### createReactionDiffusionInitializer(pattern)

Create an initializer for reaction-diffusion simulations.

**Patterns**: `'center'`, `'random'`, `'spots'`

```javascript
import { createReactionDiffusionInitializer } from './src/gpu/FeedbackManager.js';

const initializer = createReactionDiffusionInitializer('spots');
await feedbackManager.reset(initializer);
```

#### createFlowFieldInitializer(type)

Create an initializer for flow field simulations.

**Types**: `'zero'`, `'vortex'`, `'turbulence'`

```javascript
import { createFlowFieldInitializer } from './src/gpu/FeedbackManager.js';

const initializer = createFlowFieldInitializer('vortex');
await feedbackManager.reset(initializer);
```

## Usage Examples

### Basic Feedback Loop

```javascript
import { FeedbackManager } from './src/gpu/FeedbackManager.js';

// Create manager
const manager = new FeedbackManager(device, {
  width: 512,
  height: 512
});

await manager.initialize();

// Render loop
function render(encoder) {
  // Bind textures in compute shader
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: manager.getReadView() },   // Read from previous
      { binding: 2, resource: manager.getWriteView() }   // Write to current
    ]
  });

  // Dispatch compute shader
  const pass = encoder.beginComputePass();
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(64, 64);
  pass.end();

  // Swap for next frame
  manager.swap();
}
```

### Reaction-Diffusion Simulation

```javascript
import { FeedbackManager, createReactionDiffusionInitializer } from './src/gpu/FeedbackManager.js';

const manager = new FeedbackManager(device, { width: 512, height: 512 });

// Initialize with spots pattern
const initializer = createReactionDiffusionInitializer('spots');
await manager.initialize(initializer);

// Use in shader (see ComputeReactionDiffusion node)
// The shader reads from previous frame and writes to current frame
```

### Flow Field Simulation

```javascript
import { FeedbackManager, createFlowFieldInitializer } from './src/gpu/FeedbackManager.js';

const manager = new FeedbackManager(device, { width: 512, height: 512 });

// Initialize with vortex flow
const initializer = createFlowFieldInitializer('vortex');
await manager.initialize(initializer);

// Render loop advects particles along the flow field
```

### State Management

```javascript
// Get simulation statistics
const stats = manager.getStats();
console.log(`Frame: ${stats.frameCount}, Resolution: ${stats.resolution}`);

// Save state
const state = manager.serialize();
localStorage.setItem('simulation', JSON.stringify(state));

// Restore state
const savedState = JSON.parse(localStorage.getItem('simulation'));
await manager.deserialize(savedState);
```

## Integration with ComputeFeedbackField Node

The `ComputeFeedbackField` node uses the FeedbackManager system internally. When you add this node to your graph:

1. **Node Setup**: Add a `ComputeFeedbackField` node
2. **Connect Input**: Connect any texture/field output to the input pin
3. **Configure Mode**: Choose from `Flow`, `Reaction-Diffusion`, `Accumulate`, or `Custom`
4. **Adjust Parameters**:
   - `decay`: How quickly the feedback fades (0.0-1.0)
   - `diffusion`: Strength of diffusion blur (0.0-1.0)
   - `feedback`: Strength of new input mixing (0.0-1.0)
   - `speed`: Simulation speed multiplier (0.0-5.0)
   - `reset`: Click to reset simulation state

### Mode Descriptions

- **Flow**: Advects previous frame along input velocity field (RG channels)
- **Reaction-Diffusion**: Simplified RD simulation driven by input activation
- **Accumulate**: Simple additive feedback with diffusion
- **Custom**: Non-linear mix of all behaviors

## Technical Details

### Texture Format

By default, textures use `rgba8unorm` format (8-bit per channel, normalized).

For higher precision simulations, you can use:
- `rgba16float` - 16-bit floating point per channel
- `rgba32float` - 32-bit floating point per channel

```javascript
const manager = new FeedbackManager(device, {
  width: 512,
  height: 512,
  format: 'rgba16float'
});
```

### Memory Usage

Each FeedbackManager instance creates two textures:

- `rgba8unorm` @ 512x512: ~1 MB total
- `rgba16float` @ 512x512: ~2 MB total
- `rgba32float` @ 512x512: ~4 MB total

### Performance Considerations

1. **Resolution**: Lower resolutions (256x256) run faster but less detailed
2. **Diffusion**: Higher diffusion values increase neighbor samples (slower)
3. **Format**: `rgba8unorm` is fastest, `rgba32float` is most accurate
4. **History**: Disable history tracking for better performance

## Shader Integration

To use FeedbackManager in a custom compute shader:

```wgsl
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var prevFrame: texture_2d<f32>;        // Read texture
@group(0) @binding(3) var outputTexture: texture_storage_2d<rgba8unorm, write>; // Write texture

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let coord = vec2<i32>(global_id.xy);

  // Read from previous frame
  let prev = textureLoad(prevFrame, coord, 0);

  // Read from input
  let input = textureLoad(inputTexture, coord, 0);

  // Compute new value
  let result = prev * 0.95 + input * 0.1;

  // Write to output
  textureStore(outputTexture, vec2<u32>(coord), result);
}
```

## Troubleshooting

### Simulation not updating

- Ensure you're calling `manager.swap()` after each frame
- Check that read/write textures are bound correctly
- Verify compute shader is being dispatched

### Black/frozen output

- Call `manager.reset()` to reinitialize
- Check texture format matches shader expectations
- Verify bind group layout matches texture bindings

### Performance issues

- Reduce resolution (512→256)
- Disable history tracking
- Use `rgba8unorm` instead of float formats
- Reduce diffusion parameter value

## See Also

- [ComputeShaderManager.js](../src/gpu/ComputeShaderManager.js) - Low-level compute shader wrapper
- [ComputeNodes.js](../src/data/nodes/ComputeNodes.js) - Compute node definitions
- [COMPUTE_NODE_API.md](./COMPUTE_NODE_API.md) - Compute node API documentation
