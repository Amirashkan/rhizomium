# Field Visualization System

The Field Visualization system allows you to visualize compute shader outputs as 3D representations in the scene. It supports two main modes:

1. **Point Cloud / Particles** - Visualize field values as individual points
2. **Voxel Grid → Mesh** - Convert volumetric data to triangle meshes using marching cubes

## Quick Start

```javascript
import { ComputeFieldMapperNode } from './scene/nodes/ComputeFieldMapperNode.js';
import { ComputeNodeBase } from './gpu/ComputeNodeBase.js';

// Create a compute node (e.g., noise field)
const computeNode = new ComputeNodeBase(device, {
    id: 'NoiseField_1',
    kind: 'ComputeNoise',
    params: {
        scale: 2.0,
        octaves: 4
    }
});

// Initialize with WGSL shader
await computeNode.initialize(wgslShader, 256, 256, false);

// Create field mapper for visualization
const fieldMapper = new ComputeFieldMapperNode('VisualizationNode', {
    dimensions: [256, 256, 1],
    mappingMode: 'points',  // or 'surface', 'volume'
    fieldBounds: {
        min: [-2, -2, 0],
        max: [2, 2, 0]
    }
});

// Link compute shader
fieldMapper.setComputeShader(computeNode);

// Initialize visualizer
await fieldMapper.initializeVisualizer(device);

// Generate visualization
const encoder = device.createCommandEncoder();
computeNode.dispatch(device, encoder, time);
const texture = computeNode.getOutputTexture();
const geometry = await fieldMapper.generateVisualization(texture);
device.queue.submit([encoder.finish()]);
```

## Visualization Modes

### Point Cloud Mode

Generates particles/points from field data. Each field cell above a threshold becomes a point.

```javascript
fieldMapper.setMappingMode('points');

// Configure point cloud parameters
fieldMapper.setVisualizationParam('threshold', 0.3);
fieldMapper.setVisualizationParam('pointSize', 0.01);
fieldMapper.setVisualizationParam('sampleRate', 1);
```

**Parameters:**
- `threshold` (0.0-1.0): Minimum field value to generate a point
- `pointSize` (float): Size of points in world units
- `sampleRate` (int): Sample every N cells (1 = every cell, 2 = every other cell)

### Mesh Mode

Generates triangle mesh from volumetric data using marching cubes algorithm.

```javascript
fieldMapper.setMappingMode('surface');

// Configure mesh parameters
fieldMapper.setIsoThreshold(0.5);
```

**Parameters:**
- `isoThreshold` (0.0-1.0): Isosurface value for mesh generation

## Color Mapping

The system supports three color modes:

### Gradient Mode (Default)

Interpolates between two colors based on field value:

```javascript
fieldMapper.setVisualizationParam('colorMode', 'gradient');
fieldMapper.setVisualizationParam('colorScale', [0.0, 1.0]);
fieldMapper.setVisualizationParam('colorA', [0.1, 0.2, 0.8, 1.0]); // Blue
fieldMapper.setVisualizationParam('colorB', [0.8, 0.2, 0.1, 1.0]); // Red
```

### Solid Color Mode

All points/vertices use the same color:

```javascript
fieldMapper.setVisualizationParam('colorMode', 'solid');
fieldMapper.setVisualizationParam('solidColor', [1.0, 1.0, 1.0, 1.0]);
```

### Field Mode

Maps field values directly to color (same as gradient):

```javascript
fieldMapper.setVisualizationParam('colorMode', 'field');
```

## Displacement

Displace points/vertices along an axis based on field value:

```javascript
fieldMapper.setVisualizationParam('displacementScale', 0.5);
fieldMapper.setVisualizationParam('displacementAxis', [0, 0, 1]); // Z-axis
```

This creates a "height map" effect where field values control position.

**Parameters:**
- `displacementScale` (float): Multiplier for displacement
- `displacementAxis` ([x, y, z]): Direction of displacement

## Field Bounds

Map field coordinates to world space:

```javascript
fieldMapper.setFieldBounds(
    [-1, -1, -1],  // min
    [1, 1, 1]      // max
);
```

This maps the field from texture coordinates (0-1) to world coordinates.

## Complete Example

```javascript
import { Scene } from './scene/Scene.js';
import { ComputeFieldMapperNode } from './scene/nodes/ComputeFieldMapperNode.js';
import { ComputeNodeBase } from './gpu/ComputeNodeBase.js';
import { PointCloudRenderer } from './scene/renderers/PointCloudRenderer.js';

// Setup
const device = await navigator.gpu.requestAdapter()
    .then(adapter => adapter.requestDevice());

// Create compute shader
const noiseShader = `
    @group(0) @binding(0) var outputTexture: texture_storage_2d<rgba8unorm, write>;
    @group(0) @binding(1) var<uniform> params: Params;

    @compute @workgroup_size(8, 8)
    fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let uv = vec2<f32>(f32(global_id.x), f32(global_id.y)) / 256.0;
        let value = noise(uv);
        textureStore(outputTexture, vec2<i32>(global_id.xy), vec4<f32>(value));
    }
`;

const computeNode = new ComputeNodeBase(device, {
    id: 'NoiseField',
    kind: 'ComputeNoise'
});
await computeNode.initialize(noiseShader, 256, 256);

// Create field mapper
const fieldMapper = new ComputeFieldMapperNode('Visualization', {
    dimensions: [256, 256, 1],
    mappingMode: 'points',
    fieldBounds: { min: [-2, -2, 0], max: [2, 2, 0] }
});

fieldMapper.setComputeShader(computeNode);

// Configure visualization
fieldMapper.setVisualizationParam('threshold', 0.4);
fieldMapper.setVisualizationParam('colorMode', 'gradient');
fieldMapper.setVisualizationParam('colorA', [0.2, 0.4, 1.0, 1.0]);
fieldMapper.setVisualizationParam('colorB', [1.0, 0.4, 0.2, 1.0]);
fieldMapper.setVisualizationParam('displacementScale', 0.3);
fieldMapper.setVisualizationParam('displacementAxis', [0, 0, 1]);

await fieldMapper.initializeVisualizer(device);

// Render loop
function render(time) {
    // Update compute
    const encoder = device.createCommandEncoder();
    computeNode.setUniform('time', time * 0.001);
    computeNode.dispatch(device, encoder, time);

    // Generate visualization
    const texture = computeNode.getOutputTexture();
    await fieldMapper.generateVisualization(texture);
    const geometry = fieldMapper.getGeometry();

    // Render geometry
    const renderer = new PointCloudRenderer(device);
    await renderer.initialize();

    // ... render pass setup ...
    renderer.render(passEncoder, geometry, viewMatrix, projMatrix, modelMatrix);

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(render);
}

requestAnimationFrame(render);
```

## API Reference

### ComputeFieldMapperNode

#### Constructor Options
- `dimensions` ([width, height, depth]): Field resolution
- `mappingMode` ('points' | 'surface' | 'volume'): Visualization mode
- `fieldBounds` ({min, max}): World space bounds
- `isoThreshold` (0.0-1.0): Isosurface threshold for mesh mode

#### Methods

**`setComputeShader(shader)`**
Link a compute shader node.

**`initializeVisualizer(device)`**
Initialize the visualization system.

**`generateVisualization(texture)`**
Generate geometry from compute output texture.

**`setVisualizationParam(name, value)`**
Set a visualization parameter.

**`getGeometry()`**
Get the generated geometry for rendering.

### FieldVisualizer

Low-level API for custom visualization.

#### Constructor
```javascript
const visualizer = new FieldVisualizer(device);
await visualizer.initialize();
```

#### Methods

**`setMode(mode)`**
Set visualization mode: 'points' or 'mesh'.

**`setDimensions(dimensions)`**
Set field dimensions [w, h, d].

**`setThreshold(threshold)`**
Set point generation threshold.

**`setIsoValue(isoValue)`**
Set isosurface value for mesh.

**`setPointSize(size)`**
Set point size in world units.

**`setColorParams(params)`**
Set color mapping parameters.

**`setDisplacement(scale, axis)`**
Set displacement parameters.

**`setFieldBounds(min, max)`**
Set world space bounds.

**`generatePointCloud(texture)`**
Generate point cloud from texture.

**`generateMesh(fieldData)`**
Generate mesh from 3D field data.

**`getGeometry()`**
Get generated geometry.

## Performance Considerations

1. **Sample Rate**: Use higher sample rates (2-4) for large fields to reduce point count
2. **Threshold**: Higher thresholds reduce point count, improving performance
3. **Field Resolution**: Lower resolutions (64x64, 128x128) are faster to generate
4. **Update Frequency**: Use `updateFrequency` to regenerate visualization every N frames

```javascript
const fieldMapper = new ComputeFieldMapperNode('Field', {
    dimensions: [128, 128, 1],  // Lower resolution
    updateFrequency: 2           // Update every 2 frames
});

fieldMapper.setVisualizationParam('threshold', 0.5);  // Higher threshold
fieldMapper.setVisualizationParam('sampleRate', 2);   // Sample every other cell
```

## Integration with Scene Graph

Add field mapper nodes to the scene like any other node:

```javascript
import { Scene } from './scene/Scene.js';

const scene = new Scene();
scene.addNode(fieldMapper);

// Access all field mapper nodes
const fieldMappers = scene.getComputeFieldMapperNodes();
for (const mapper of fieldMappers) {
    if (mapper.shouldUpdate()) {
        await mapper.generateVisualization(texture);
    }
}
```

## Examples

See `/src/examples/FieldVisualizationExample.js` for complete working examples:
- Basic point cloud from noise
- Animated field with changing parameters
- 3D mesh visualization
- Integration with scene graph and camera

## Architecture

```
ComputeNode (GPU Compute Shader)
    ↓
Output Texture (Field Data)
    ↓
ComputeFieldMapperNode
    ↓
FieldVisualizer
    ├→ PointCloudGenerator → Point Geometry
    └→ MarchingCubes → Mesh Geometry
    ↓
PointCloudRenderer / MeshRenderer
    ↓
3D Scene
```

## Real-Time Reactive Updates (NEW)

The field visualization system now supports **automatic real-time updates** when parameters change. This is perfect for interactive UI controls, sliders, and dynamic parameter adjustments.

### FieldVisualizerManager

The `FieldVisualizerManager` handles automatic parameter change detection and visualization regeneration:

```javascript
import { FieldVisualizerManager } from './scene/FieldVisualizerManager.js';

// Create manager with event system
const manager = new FieldVisualizerManager(device);

// Create field mapper with event system integration
const fieldMapper = new ComputeFieldMapperNode('Field', {
    dimensions: [256, 256, 1],
    mappingMode: 'points',
    eventSystem: manager.getEventSystem()  // Enable reactive updates!
});

await fieldMapper.initializeVisualizer(device);

// Register for automatic updates
manager.registerFieldMapper('Field', fieldMapper, computeNode);

// In your render loop:
async function render(time) {
    // Update parameters - visualization will automatically regenerate!
    manager.updateParameter('Field', 'threshold', 0.3 + Math.sin(time) * 0.2);
    manager.updateParameter('Field', 'displacementScale', 0.5);

    // Process all pending updates automatically
    const updatedGeometries = await manager.processPendingUpdates(time);

    // Render...
    requestAnimationFrame(render);
}
```

### UI Integration Example

Connect UI sliders to automatically update the 3D visualization:

```javascript
// HTML:
// <input type="range" id="threshold-slider" min="0" max="1" step="0.01" value="0.3">
// <input type="range" id="pointsize-slider" min="0.001" max="0.1" step="0.001" value="0.02">

const thresholdSlider = document.getElementById('threshold-slider');
thresholdSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    // This automatically triggers 3D visualization update!
    manager.updateParameter('Field', 'threshold', value);
});

const pointSizeSlider = document.getElementById('pointsize-slider');
pointSizeSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    manager.updateParameter('Field', 'pointSize', value);
});
```

### Node Editor UI Integration

The `ComputeFieldMapper` node is now available in the node editor UI with all parameters exposed:

```javascript
// In your node editor, the ComputeFieldMapper node appears with these controls:
// - Width, Height, Depth sliders
// - Mapping Mode dropdown (points, surface, volume)
// - Threshold slider
// - Point Size slider
// - Color Mode dropdown
// - Color gradient controls (colorA, colorB)
// - Displacement controls
// - And more...
```

All parameter changes through the node editor UI will automatically trigger real-time 3D visualization updates!

### Event System Integration

The system uses `ParameterEventSystem` for reactive updates:

```javascript
import { ParameterEventSystem, ParameterEvents } from './utils/ParameterEventSystem.js';

const eventSystem = new ParameterEventSystem();

// Listen for parameter changes
eventSystem.on(ParameterEvents.PARAMETER_CHANGED, (data) => {
    console.log(`Parameter ${data.parameterName} changed to ${data.newValue}`);
});

// Emit parameter change (triggers automatic update)
eventSystem.emit(ParameterEvents.PARAMETER_CHANGED, {
    nodeId: 'Field',
    parameterName: 'threshold',
    newValue: 0.5
});
```

### Available Parameters for Dynamic Updates

All these parameters can be updated in real-time:

**Field Configuration:**
- `width`, `height`, `depth` - Field dimensions
- `boundsMinX`, `boundsMinY`, `boundsMinZ` - Minimum bounds
- `boundsMaxX`, `boundsMaxY`, `boundsMaxZ` - Maximum bounds
- `mappingMode` - Visualization mode

**Visualization:**
- `threshold` - Point generation threshold
- `isoThreshold` - Surface isosurface threshold
- `pointSize` - Point size in world units
- `sampleRate` - Sampling rate

**Colors:**
- `colorMode` - Color mode (solid, gradient, field)
- `colorAR`, `colorAG`, `colorAB`, `colorAA` - Gradient start color
- `colorBR`, `colorBG`, `colorBB`, `colorBA` - Gradient end color
- `solidColorR`, `solidColorG`, `solidColorB`, `solidColorA` - Solid color
- `colorScaleMin`, `colorScaleMax` - Color mapping range

**Displacement:**
- `displacementScale` - Displacement amount
- `displacementAxisX`, `displacementAxisY`, `displacementAxisZ` - Displacement direction

### Complete Reactive Example

```javascript
import { FieldVisualizerManager } from './scene/FieldVisualizerManager.js';
import { ComputeFieldMapperNode } from './scene/nodes/ComputeFieldMapperNode.js';
import { ReactiveFieldExample, setupUISliders } from './examples/FieldVisualizationExample.js';

// Create reactive example
const device = await navigator.gpu.requestAdapter()
    .then(a => a.requestDevice());
const canvas = document.querySelector('canvas');

const example = new ReactiveFieldExample(device, canvas);
await example.initialize();

// Setup UI sliders (optional)
setupUISliders(example);

// Render loop with automatic updates
function animate(time) {
    await example.update(time * 0.001);
    // Visualization automatically regenerates when parameters change!
    requestAnimationFrame(animate);
}
animate(0);
```

### Performance Notes

- Parameter changes are batched - multiple changes in the same frame only trigger one regeneration
- Use `updateFrequency` to limit updates: `updateFrequency: 2` updates every 2 frames
- The system tracks "dirty" state - no unnecessary regeneration
- Updates are asynchronous and non-blocking

### Manual vs Automatic Updates

**Old way (manual):**
```javascript
fieldMapper.setVisualizationParam('threshold', 0.5);
await fieldMapper.generateVisualization(texture);  // Must call manually
```

**New way (automatic):**
```javascript
manager.updateParameter('Field', 'threshold', 0.5);
await manager.processPendingUpdates();  // Automatically regenerates if needed
```

See `/src/examples/FieldVisualizationExample.js` for complete working examples with reactive updates!

## Future Enhancements

- GPU-based point cloud generation (compute shader)
- Full marching cubes triangle table (currently simplified)
- 3D texture support for volume rendering
- Instanced rendering for better performance
- Geometry shaders for point sprites
- Color mapping from custom textures
- Normal calculation improvements
- LOD system for large fields
