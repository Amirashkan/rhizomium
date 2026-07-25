/**
 * Test suite for ComputeNodeBase
 * Verifies the unified API works correctly
 */

import { ComputeNodeBase } from '../gpu/ComputeNodeBase.js';
import { ComputeExecutor } from '../gpu/ComputeExecutor.js';

/**
 * Simple test WGSL shader for testing
 */
const TEST_WGSL = `
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

  // Simple test pattern
  let noise = fract(sin(dot(uv + params.time * params.speed, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let color = vec4<f32>(noise, noise, noise, 1.0);

  textureStore(outputTexture, coords, color);
}
`;

/**
 * Run all tests
 */
export async function runTests(device) {

  let passed = 0;
  let failed = 0;

  // Test 1: Node creation
  try {
    const node = new ComputeNodeBase(device, {
      id: 'test_node_1',
      kind: 'ComputeNoise',
      params: {
        scale: 8.0,
        octaves: 5,
        speed: 0.1
      }
    });

    assert(node.id === 'test_node_1', 'Node ID should match');
    assert(node.kind === 'ComputeNoise', 'Node kind should match');
    assert(node.params.scale === 8.0, 'Params should be set');

    passed++;
  } catch (error) {

    failed++;
  }

  // Test 2: Initialization
  try {
    const node = new ComputeNodeBase(device, {
      id: 'test_node_2',
      kind: 'ComputeNoise',
      params: { scale: 8.0, octaves: 5, speed: 0.1 }
    });

    await node.initialize(TEST_WGSL, 256, 256, false);

    assert(node.initialized === true, 'Node should be initialized');
    assert(node.width === 256, 'Width should be set');
    assert(node.height === 256, 'Height should be set');
    assert(node.getOutputTexture() !== null, 'Output texture should exist');

    node.destroy();

    passed++;
  } catch (error) {

    failed++;
  }

  // Test 3: Uniform setting
  try {
    const node = new ComputeNodeBase(device, {
      id: 'test_node_3',
      kind: 'ComputeNoise',
      params: { scale: 8.0, octaves: 5, speed: 0.1 }
    });

    node.setUniform('scale', 12.0);
    assert(node.params.scale === 12.0, 'Scale should be updated');

    node.updateParams({
      octaves: 7,
      speed: 0.5
    });
    assert(node.params.octaves === 7, 'Octaves should be updated');
    assert(node.params.speed === 0.5, 'Speed should be updated');

    passed++;
  } catch (error) {

    failed++;
  }

  // Test 4: Serialization
  try {
    const node = new ComputeNodeBase(device, {
      id: 'test_node_4',
      kind: 'ComputeNoise',
      params: { scale: 8.0, octaves: 5, speed: 0.1 },
      metadata: { label: 'Test Noise' }
    });
    await node.initialize(TEST_WGSL, 256, 256, false);

    const serialized = node.serialize();

    assert(serialized.id === 'test_node_4', 'Serialized ID should match');
    assert(serialized.kind === 'ComputeNoise', 'Serialized kind should match');
    assert(serialized.params.scale === 8.0, 'Serialized params should match');
    assert(serialized.dimensions.width === 256, 'Serialized width should match');
    assert(serialized.metadata.label === 'Test Noise', 'Serialized metadata should match');

    node.destroy();

    passed++;
  } catch (error) {

    failed++;
  }

  // Test 5: Deserialization
  try {
    const original = new ComputeNodeBase(device, {
      id: 'test_node_5',
      kind: 'ComputeNoise',
      params: { scale: 10.0, octaves: 6, speed: 0.2 },
      metadata: { label: 'Original' }
    });
    await original.initialize(TEST_WGSL, 512, 512, true);

    const serialized = original.serialize();
    const restored = ComputeNodeBase.deserialize(device, serialized);

    assert(restored.id === original.id, 'Restored ID should match');
    assert(restored.kind === original.kind, 'Restored kind should match');
    assert(restored.params.scale === original.params.scale, 'Restored params should match');
    assert(restored.width === original.width, 'Restored width should match');
    assert(restored.height === original.height, 'Restored height should match');
    assert(restored.supportsFeedback === original.supportsFeedback, 'Restored feedback flag should match');

    original.destroy();

    passed++;
  } catch (error) {

    failed++;
  }

  // Test 6: ComputeExecutor integration
  try {

    const executor = new ComputeExecutor(device);

    const node1 = new ComputeNodeBase(device, {
      id: 'exec_test_1',
      kind: 'ComputeNoise',
      params: { scale: 8.0 }
    });
    await node1.initialize(TEST_WGSL, 256, 256, false);

    const node2 = new ComputeNodeBase(device, {
      id: 'exec_test_2',
      kind: 'ComputeReactionDiffusion',
      params: { feedRate: 0.055 }
    });
    await node2.initialize(TEST_WGSL, 256, 256, true);

    executor.addComputeNode(node1);
    executor.addComputeNode(node2);

    assert(executor.computeNodes.size === 2, 'Executor should have 2 nodes');

    const retrieved = executor.getComputeNode('exec_test_1');
    assert(retrieved !== null, 'Should retrieve node');
    assert(retrieved.id === 'exec_test_1', 'Retrieved node should match');

    executor.setUniform('exec_test_2', 'feedRate', 0.065);
    assert(node2.params.feedRate === 0.065, 'Uniform should be updated via executor');

    executor.removeComputeNode('exec_test_1');
    assert(executor.computeNodes.size === 1, 'Node should be removed');

    executor.clear();

    passed++;
  } catch (error) {

    failed++;
  }

  // Test 7: Dispatch
  try {

    const node = new ComputeNodeBase(device, {
      id: 'test_node_7',
      kind: 'ComputeNoise',
      params: { scale: 8.0, octaves: 5, speed: 0.1 }
    });
    await node.initialize(TEST_WGSL, 256, 256, false);

    const encoder = device.createCommandEncoder();
    node.dispatch(device, encoder, 1.0);
    device.queue.submit([encoder.finish()]);

    // If we get here without errors, dispatch worked
    node.destroy();

    passed++;
  } catch (error) {

    failed++;
  }

  // Test 8: Executor serialization
  try {

    const executor = new ComputeExecutor(device);

    const node1 = new ComputeNodeBase(device, {
      id: 'ser_test_1',
      kind: 'ComputeNoise',
      params: { scale: 8.0 }
    });
    await node1.initialize(TEST_WGSL, 256, 256, false);

    const node2 = new ComputeNodeBase(device, {
      id: 'ser_test_2',
      kind: 'ComputeReactionDiffusion',
      params: { feedRate: 0.055 }
    });
    await node2.initialize(TEST_WGSL, 512, 512, true);

    executor.addComputeNode(node1);
    executor.addComputeNode(node2);

    const serialized = executor.serializeAll();
    assert(serialized.length === 2, 'Should serialize 2 nodes');
    assert(serialized[0].id === 'ser_test_1', 'First node should match');
    assert(serialized[1].id === 'ser_test_2', 'Second node should match');

    const restored = executor.deserializeAll(serialized);
    assert(restored.length === 2, 'Should restore 2 nodes');
    assert(restored[0].id === 'ser_test_1', 'First restored node should match');

    executor.clear();

    passed++;
  } catch (error) {

    failed++;
  }

  // Summary





  return { passed, failed };
}

/**
 * Simple assertion helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Run tests if this file is executed directly
 */
if (typeof window !== 'undefined' && window.testDevice) {
  runTests(window.testDevice).catch(error => {

  });
}
