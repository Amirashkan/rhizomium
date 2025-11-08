# 3D Scene Graph System

A minimal, independent 3D scene graph system for organizing and managing 3D objects with hierarchical transforms.

## Overview

The scene graph system provides a hierarchical structure for organizing 3D objects in a scene. It's designed to be independent from the GPUCanvas rendering pipeline, making it flexible and reusable.

## Features

- **Hierarchical Scene Organization**: Parent-child relationships with transform inheritance
- **Transform System**: Position, rotation (quaternion), and scale support for all nodes
- **Multiple Node Types**: Mesh, Camera, Light, and ComputeFieldMapper nodes
- **3D Math Library**: Vec3, Quaternion, and Mat4 implementations
- **Scene Management**: Scene class for managing node collections and queries
- **Independent Architecture**: Decoupled from rendering pipeline

## Installation

```javascript
import { Scene, MeshNode, CameraNode, Vec3 } from './src/scene/index.js';
```

## Quick Start

### Creating a Scene

```javascript
import { Scene, MeshNode, CameraNode, LightNode } from './src/scene/index.js';

// Create a scene
const scene = new Scene('MyScene');

// Create a camera
const camera = new CameraNode('MainCamera');
camera.transform.setPosition(0, 0, 5);
scene.addNode(camera);
scene.setActiveCamera(camera);

// Create a mesh
const mesh = new MeshNode('Cube', {
    geometry: {
        vertices: new Float32Array([/* ... */]),
        indices: new Uint16Array([/* ... */])
    },
    material: {
        color: [1, 0, 0, 1] // Red
    }
});
scene.addNode(mesh);

// Create a light
const light = new LightNode('Light', {
    lightType: 'point',
    intensity: 1.0
});
light.transform.setPosition(2, 2, 2);
scene.addNode(light);
```

### Working with Transforms

```javascript
import { MeshNode, Vec3, Quaternion } from './src/scene/index.js';

const node = new MeshNode('MyMesh');

// Set position
node.transform.setPosition(1, 2, 3);

// Set rotation from Euler angles (radians)
node.transform.setRotationFromEuler(0, Math.PI / 4, 0);

// Set scale
node.transform.setScale(2, 2, 2);

// Or set uniform scale
node.transform.setUniformScale(2);

// Translate
node.transform.translate(1, 0, 0);

// Rotate around axis
const axis = new Vec3(0, 1, 0);
node.transform.rotate(axis, Math.PI / 4);
```

### Hierarchical Transforms

```javascript
// Create parent-child relationships
const parent = new MeshNode('Parent');
const child = new MeshNode('Child');

parent.addChild(child);

// Child inherits parent's transform
parent.transform.setPosition(5, 0, 0);
child.transform.setPosition(2, 0, 0); // Local position

// World position will be (7, 0, 0)
const worldPos = child.getWorldPosition();
```

### Scene Queries

```javascript
// Find node by name
const node = scene.findNodeByName('MyMesh');

// Get all meshes
const meshes = scene.getMeshNodes();

// Get all cameras
const cameras = scene.getCameraNodes();

// Get all lights
const lights = scene.getLightNodes();

// Get all compute field mappers
const mappers = scene.getComputeFieldMapperNodes();

// Traverse all nodes
scene.traverse(node => {
    console.log(node.name);
});
```

## Node Types

### Node (Base Class)

The base class for all scene graph nodes. Provides:
- Transform (position, rotation, scale)
- Parent-child hierarchy
- Visibility flag
- User data storage

### MeshNode

Represents a 3D mesh with geometry and material.

```javascript
const mesh = new MeshNode('MyMesh', {
    geometry: {
        vertices: Float32Array,  // [x, y, z, ...]
        normals: Float32Array,   // [nx, ny, nz, ...]
        uvs: Float32Array,       // [u, v, ...]
        indices: Uint16Array     // [i1, i2, i3, ...]
    },
    material: {
        color: [1, 1, 1, 1],
        shader: null,
        textures: {}
    },
    castShadows: true,
    receiveShadows: true
});
```

### CameraNode

Represents a camera with perspective or orthographic projection.

```javascript
// Perspective camera
const camera = new CameraNode('Camera', {
    type: 'perspective',
    fov: 60,        // degrees
    aspect: 16/9,
    near: 0.1,
    far: 1000
});

// Orthographic camera
const orthoCamera = new CameraNode('OrthoCamera', {
    type: 'orthographic',
    left: -10,
    right: 10,
    top: 10,
    bottom: -10,
    near: 0.1,
    far: 1000
});

// Get matrices
const projectionMatrix = camera.getProjectionMatrix();
const viewMatrix = camera.getViewMatrix();

// Look at target
camera.lookAt(new Vec3(0, 0, 0), new Vec3(0, 1, 0));
```

### LightNode

Placeholder for light sources (directional, point, spot, ambient).

```javascript
const light = new LightNode('Light', {
    lightType: 'point',      // 'directional', 'point', 'spot', 'ambient'
    color: [1, 1, 1],        // RGB
    intensity: 1.0,
    range: 10,
    castShadows: false
});

// Spot light
const spotLight = new LightNode('SpotLight', {
    lightType: 'spot',
    color: [1, 1, 0],
    intensity: 2.0,
    innerConeAngle: Math.PI / 6,
    outerConeAngle: Math.PI / 4
});
```

### ComputeFieldMapperNode

Maps compute shader outputs to 3D space.

```javascript
const mapper = new ComputeFieldMapperNode('FieldMapper', {
    dimensions: [64, 64, 64],          // Field resolution
    mappingMode: 'volume',              // 'volume', 'surface', 'points'
    fieldBounds: {
        min: [-1, -1, -1],
        max: [1, 1, 1]
    },
    isoThreshold: 0.5,
    updateFrequency: 0                  // 0 = every frame
});

mapper.setComputeShader(myComputeShader);
```

## 3D Math Library

### Vec3

```javascript
import { Vec3 } from './src/scene/math/Vec3.js';

const v1 = new Vec3(1, 2, 3);
const v2 = new Vec3(4, 5, 6);

v1.add(v2);              // Add vectors
v1.subtract(v2);         // Subtract vectors
v1.multiplyScalar(2);    // Multiply by scalar
const dot = v1.dot(v2);  // Dot product
v1.cross(v2);            // Cross product
v1.normalize();          // Normalize to unit length
const len = v1.length(); // Get length
```

### Quaternion

```javascript
import { Quaternion, Vec3 } from './src/scene/math/index.js';

// From Euler angles
const q = Quaternion.fromEuler(0, Math.PI / 2, 0);

// From axis-angle
const axis = new Vec3(0, 1, 0);
const q2 = Quaternion.fromAxisAngle(axis, Math.PI / 4);

// Operations
q.multiply(q2);          // Multiply quaternions
q.slerp(q2, 0.5);       // Spherical interpolation
q.normalize();           // Normalize
```

### Mat4

```javascript
import { Mat4, Vec3 } from './src/scene/math/index.js';

// Projection matrices
const perspective = Mat4.perspective(
    Math.PI / 3,  // fov
    16/9,         // aspect
    0.1,          // near
    1000          // far
);

const orthographic = Mat4.orthographic(
    -10, 10,      // left, right
    -10, 10,      // bottom, top
    0.1, 1000     // near, far
);

// View matrix
const eye = new Vec3(0, 0, 5);
const target = new Vec3(0, 0, 0);
const up = new Vec3(0, 1, 0);
const viewMatrix = Mat4.lookAt(eye, target, up);

// Transform operations
const mat = new Mat4();
mat.compose(position, rotation, scale);
mat.decompose(position, rotation, scale);
mat.multiply(otherMatrix);
mat.invert();
mat.transpose();
```

## Scene Management

### Scene Statistics

```javascript
const stats = scene.getStatistics();
console.log(stats);
// {
//     totalNodes: 10,
//     meshes: 5,
//     cameras: 1,
//     lights: 2,
//     computeFieldMappers: 1,
//     triangles: 1500,
//     vertices: 800
// }
```

### Serialization

```javascript
// Export scene to JSON
const json = scene.toJSON();

// Import scene from JSON (placeholder)
const loadedScene = Scene.fromJSON(json);
```

### Scene Operations

```javascript
// Clear scene
scene.clear();

// Clone scene
const clonedScene = scene.clone();

// Set background
scene.setBackgroundColor(0.1, 0.1, 0.2, 1.0);

// Update world matrices
scene.updateWorldMatrices();
```

## Testing

The scene graph system includes comprehensive tests:

```bash
npm test -- tests/scene
```

Tests cover:
- Vec3 operations
- Transform system
- Node hierarchy
- Scene management
- All node types

## Architecture

The scene graph system is designed to be independent from the rendering pipeline:

1. **Math Layer** (`src/scene/math/`): Pure math utilities
2. **Transform Layer** (`src/scene/Transform.js`): Transform management
3. **Node Layer** (`src/scene/nodes/`): Scene graph nodes
4. **Scene Layer** (`src/scene/Scene.js`): Scene management

This separation allows the scene graph to be used with any rendering system, including the existing GPUCanvas pipeline or other renderers.

## Integration with GPUCanvas

While the scene graph is independent, it can be integrated with the GPUCanvas rendering pipeline:

```javascript
// Render loop example
function render() {
    const camera = scene.getActiveCamera();
    if (!camera) return;

    // Get camera matrices
    const viewMatrix = camera.getViewMatrix();
    const projectionMatrix = camera.getProjectionMatrix();

    // Render meshes
    const meshes = scene.getMeshNodes();
    for (const mesh of meshes) {
        if (!mesh.visible) continue;

        const worldMatrix = mesh.getWorldMatrix();

        // Pass matrices to your renderer
        renderer.drawMesh(mesh, {
            world: worldMatrix,
            view: viewMatrix,
            projection: projectionMatrix
        });
    }
}
```

## Future Enhancements

Potential future additions:
- Animation system
- Physics integration
- Culling and frustum tests
- Bounding volume hierarchy
- Full JSON deserialization
- Light shadow map support
- Material system expansion

## License

Part of the GLSL Node Editor project.
