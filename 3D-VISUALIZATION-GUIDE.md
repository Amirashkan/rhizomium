# 3D Visualization Setup Guide

## Current Issue

The ComputeFieldMapper node is showing:
- **Black preview**: Because it outputs 3D geometry, not 2D shader data
- **Empty 3D viewport**: Because the node isn't integrated with the rendering loop yet

## Quick Fix

### Option 1: Manual Setup (Console Commands)

1. **Show the 3D viewport**:
```javascript
viewportPanel.show()
```

2. **Add a test cube to verify 3D rendering works**:
```javascript
// Add test cube
const testCube = addTestCubeToScene(systemIntegration.scene);
console.log('Test cube added');

// Render the scene
sceneRenderer3D.render();
```

3. **If you see a rotating cube, the 3D system works!**

### Option 2: Proper Integration (Recommended)

The ComputeFieldMapper node needs integration with the graph processor. Here's what needs to happen:

#### Step 1: Remove Connection to Output
The ComputeFieldMapper should NOT connect to OutputFinal. It's a 3D visualization node.

#### Step 2: Create the Workflow

```javascript
// 1. Create a compute shader node (e.g., ComputeNoise)
//    This generates the field data

// 2. Create ComputeFieldMapper node
//    This converts field data to 3D geometry

// 3. Connect: ComputeNoise → ComputeFieldMapper
//    (NOT connected to OutputFinal)

// 4. The FieldVisualizerManager should automatically:
//    - Detect the ComputeFieldMapper node
//    - Get texture from compute shader
//    - Generate 3D geometry
//    - Add to scene
//    - Render in viewport
```

## Integration Code Needed

The following integration is needed in the graph processor to handle ComputeFieldMapper nodes:

```javascript
// In graph processing, after compute nodes are executed:

// Find all ComputeFieldMapper nodes
const fieldMapperNodes = nodes.filter(n => n.kind === 'ComputeFieldMapper');

for (const node of fieldMapperNodes) {
  // Get input compute texture
  const inputNode = findInputNode(node);
  if (!inputNode || !inputNode.computeTexture) continue;

  // Get or create field mapper instance
  let fieldMapper = node.fieldMapperInstance;
  if (!fieldMapper) {
    fieldMapper = new ComputeFieldMapperNode(node.id, {
      dimensions: [node.params.width, node.params.height, node.params.depth],
      mappingMode: node.params.mappingMode,
      fieldBounds: {
        min: [node.params.boundsMinX, node.params.boundsMinY, node.params.boundsMinZ],
        max: [node.params.boundsMaxX, node.params.boundsMaxY, node.params.boundsMaxZ]
      },
      isoThreshold: node.params.isoThreshold
    });

    await fieldMapper.initializeVisualizer(device);
    node.fieldMapperInstance = fieldMapper;

    // Add to scene
    systemIntegration.scene.addNode(fieldMapper);

    // Register with manager
    fieldVisualizerManager.registerFieldMapper(node.id, fieldMapper);
  }

  // Update parameters from node
  updateFieldMapperParams(fieldMapper, node.params);

  // Generate visualization
  await fieldMapper.generateVisualization(inputNode.computeTexture);

  // Render in 3D viewport
  sceneRenderer3D.render();
}
```

## Testing 3D Features Work

Run this in the console to verify everything is initialized:

```javascript
// Check initialization
console.log('Device:', device ? '✓' : '✗');
console.log('Scene:', systemIntegration?.scene ? '✓' : '✗');
console.log('Viewport3D:', viewport3D ? '✓' : '✗');
console.log('ViewportPanel:', viewportPanel ? '✓' : '✗');
console.log('SceneRenderer3D:', sceneRenderer3D ? '✓' : '✗');
console.log('FieldVisualizerManager:', fieldVisualizerManager ? '✓' : '✗');

// Show viewport
viewportPanel.show();

// Add test cube
const cube = await addTestCubeToScene(systemIntegration.scene);
sceneRenderer3D.render();

// If you see a cube, 3D rendering works!
// The mesh generation we implemented (marching cubes, texture readback) is ready
// It just needs to be connected to the graph execution pipeline
```

## What Was Completed

The 3D visualization back-end is complete:
- ✅ 3D texture readback from GPU
- ✅ Point cloud generation from 3D fields
- ✅ Marching cubes mesh generation
- ✅ Complete triangle lookup table (256 configurations)
- ✅ FieldVisualizer with mesh/point cloud modes
- ✅ ComputeFieldMapperNode implementation

## What Needs Integration

- **Graph Processor**: Detect ComputeFieldMapper nodes and handle them specially
- **Compute Executor**: Pass output textures to field mappers
- **Render Loop**: Update 3D scene rendering
- **Node Compiler**: Skip ComputeFieldMapper in shader generation (don't output to 2D)

## Next Steps

1. Disconnect ComputeFieldMapper from OutputFinal
2. Connect a compute shader to it instead
3. Add integration code to handle these nodes specially
4. Show the 3D viewport with `viewportPanel.show()`
5. Verify with test cube first

The 3D mesh generation works (tested with sphere generation), it just needs to be plugged into the execution pipeline!
