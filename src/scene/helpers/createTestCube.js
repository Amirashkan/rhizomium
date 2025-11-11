// src/scene/helpers/createTestCube.js

import { MeshNode } from '../nodes/MeshNode.js';

/**
 * Create a simple test cube mesh
 * @param {GPUDevice} device - WebGPU device
 * @param {string} name - Name for the mesh node
 * @returns {MeshNode} Cube mesh node
 */
export function createTestCube(device, name = 'Test Cube') {
  // Create cube vertices (position, normal, uv)
  // 8 vertices * 3 floats (pos) + 3 floats (normal) + 2 floats (uv) = 8 floats per vertex
  const vertices = new Float32Array([
    // Front face
    -1, -1,  1,   0,  0,  1,  0, 0, // 0
     1, -1,  1,   0,  0,  1,  1, 0, // 1
     1,  1,  1,   0,  0,  1,  1, 1, // 2
    -1,  1,  1,   0,  0,  1,  0, 1, // 3

    // Back face
    -1, -1, -1,   0,  0, -1,  1, 0, // 4
    -1,  1, -1,   0,  0, -1,  1, 1, // 5
     1,  1, -1,   0,  0, -1,  0, 1, // 6
     1, -1, -1,   0,  0, -1,  0, 0, // 7

    // Top face
    -1,  1, -1,   0,  1,  0,  0, 1, // 8
    -1,  1,  1,   0,  1,  0,  0, 0, // 9
     1,  1,  1,   0,  1,  0,  1, 0, // 10
     1,  1, -1,   0,  1,  0,  1, 1, // 11

    // Bottom face
    -1, -1, -1,   0, -1,  0,  0, 0, // 12
     1, -1, -1,   0, -1,  0,  1, 0, // 13
     1, -1,  1,   0, -1,  0,  1, 1, // 14
    -1, -1,  1,   0, -1,  0,  0, 1, // 15

    // Right face
     1, -1, -1,   1,  0,  0,  1, 0, // 16
     1,  1, -1,   1,  0,  0,  1, 1, // 17
     1,  1,  1,   1,  0,  0,  0, 1, // 18
     1, -1,  1,   1,  0,  0,  0, 0, // 19

    // Left face
    -1, -1, -1,  -1,  0,  0,  0, 0, // 20
    -1, -1,  1,  -1,  0,  0,  1, 0, // 21
    -1,  1,  1,  -1,  0,  0,  1, 1, // 22
    -1,  1, -1,  -1,  0,  0,  0, 1, // 23
  ]);

  // Create indices for triangles
  const indices = new Uint16Array([
    0,  1,  2,   0,  2,  3,  // front
    4,  5,  6,   4,  6,  7,  // back
    8,  9, 10,   8, 10, 11,  // top
   12, 13, 14,  12, 14, 15,  // bottom
   16, 17, 18,  16, 18, 19,  // right
   20, 21, 22,  20, 22, 23   // left
  ]);

  // Create vertex buffer
  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    label: 'Cube Vertex Buffer'
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices);

  // Create index buffer
  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    label: 'Cube Index Buffer'
  });
  device.queue.writeBuffer(indexBuffer, 0, indices);

  // Create geometry object
  const geometry = {
    vertexBuffer,
    indexBuffer,
    vertexCount: vertices.length / 8, // 8 floats per vertex
    indexCount: indices.length,
    primitiveType: 'triangle-list'
  };

  // Create mesh node
  const meshNode = new MeshNode(name);
  meshNode.geometry = geometry;

  // Set initial transform
  // Camera is looking at origin from distance 5, so place cube at origin
  meshNode.transform.position = { x: 0, y: 0, z: 0 };
  meshNode.transform.rotation = { x: 0.3, y: 0.3, z: 0 }; // Slight rotation for visibility
  meshNode.transform.scale = { x: 1, y: 1, z: 1 };

  return meshNode;
}

/**
 * Add a test cube to the scene (convenience function)
 * @param {Scene} scene - Scene to add cube to
 * @param {GPUDevice} device - WebGPU device
 * @param {string} name - Name for the cube
 * @returns {MeshNode} The created cube node
 */
export function addTestCubeToScene(scene, device, name = 'Test Cube') {
  const cube = createTestCube(device, name);
  scene.addNode(cube);



  return cube;
}
