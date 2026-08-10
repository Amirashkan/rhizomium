/**
 * Scene Graph System
 *
 * A minimal 3D scene graph system independent from the GPUCanvas rendering pipeline.
 * Provides hierarchical organization of 3D objects with transform support.
 */

// Math utilities
export { Vec3 } from './math/Vec3.js';
export { Quaternion } from './math/Quaternion.js';
export { Mat4 } from './math/Mat4.js';

// Transform
export { Transform } from './Transform.js';

// Node types
export { Node } from './nodes/Node.js';
export { MeshNode } from './nodes/MeshNode.js';
export { CameraNode } from './nodes/CameraNode.js';
export { LightNode } from './nodes/LightNode.js';
export { ComputeFieldMapperNode } from './nodes/ComputeFieldMapperNode.js';

// Scene management
export { Scene } from './Scene.js';
export { Viewport3D } from './Viewport3D.js';
export { CameraController } from './CameraController.js';
export { NodeCamera3D } from './NodeCamera3D.js';

// Field Visualization
export { FieldVisualizer } from './FieldVisualizer.js';

// Generators
export { PointCloudGenerator } from './generators/PointCloudGenerator.js';

// Algorithms
export { MarchingCubes } from './algorithms/MarchingCubes.js';

// Renderers
export { PointCloudRenderer } from './renderers/PointCloudRenderer.js';
export { MeshRenderer } from './renderers/MeshRenderer.js';
