/**
 * Compute Pipeline Validation Tests
 *
 * Automated testing for compute pipeline operations to ensure
 * consistent compute output across devices.
 *
 * Tests cover:
 * 1. Uniform updates and propagation to GPU buffers
 * 2. Dispatch dimension calculations
 * 3. Texture content checksum validation after compute
 * 4. Pipeline creation and initialization
 * 5. Resource cleanup and state management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComputeShaderManager } from '../src/gpu/ComputeShaderManager.js';
import { ComputeNodeBase } from '../src/gpu/ComputeNodeBase.js';

/**
 * Test WGSL shader for compute pipeline validation
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

  // Simple deterministic test pattern
  let noise = fract(sin(dot(uv + params.time * params.speed, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let color = vec4<f32>(noise * params.scale, noise, noise, 1.0);

  textureStore(outputTexture, coords, color);
}
`;

/**
 * Test WGSL shader with feedback support
 */
const TEST_WGSL_FEEDBACK = `
@group(0) @binding(0) var<uniform> params: Uniforms;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var previousFrame: texture_2d<f32>;

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

  // Read previous frame
  let prev = textureLoad(previousFrame, coords, 0);

  // Simple feedback: decay previous value and add new input
  let decay = 0.95;
  let noise = fract(sin(dot(uv + params.time * params.speed, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let color = vec4<f32>(prev.rgb * decay + vec3<f32>(noise) * 0.05, 1.0);

  textureStore(outputTexture, coords, color);
}
`;

describe('Compute Pipeline Validation', () => {
  let device;

  beforeEach(async () => {
    // Setup WebGPU device for each test
    const adapter = await navigator.gpu.requestAdapter();
    device = await adapter.requestDevice();
  });

  afterEach(() => {
    // Cleanup
    if (device) {
      device.destroy();
    }
  });

  /**
   * Test 1: Verify uniform updates propagate correctly to GPU buffers
   */
  it('should correctly update and propagate uniforms to GPU buffers', async () => {
    const manager = new ComputeShaderManager(device);

    // Create a node with initial parameters
    const node = {
      kind: 'ComputeNoise',
      params: {
        scale: 8.0,
        octaves: 5,
        speed: 0.1
      }
    };
    manager.node = node;

    // Initialize with test shader
    await manager.initialize(TEST_WGSL, 256, 256, false);

    // Update uniforms with time
    const testTime = 1.5;
    manager.updateUniforms(testTime);

    // Verify uniform data is correctly set
    expect(manager.uniformData[0]).toBe(256); // resolution.x
    expect(manager.uniformData[1]).toBe(256); // resolution.y
    expect(manager.uniformData[2]).toBe(testTime); // time
    expect(manager.uniformData[3]).toBe(8.0); // scale
    expect(manager.uniformData[4]).toBe(5); // octaves
    expect(manager.uniformData[5]).toBeCloseTo(0.1, 5); // speed (floating point)

    // Verify uniform buffer is created
    expect(manager.uniformBuffer).toBeTruthy();
    expect(manager.uniformBuffer.size).toBe(128); // 32 floats * 4 bytes (expanded for parameter-rich nodes)

    // Update parameters and verify propagation
    node.params.scale = 12.0;
    node.params.speed = 0.2;
    manager.updateUniforms(testTime);

    expect(manager.uniformData[3]).toBe(12.0); // updated scale
    expect(manager.uniformData[5]).toBeCloseTo(0.2, 5); // updated speed (floating point)

    // Cleanup
    manager.destroy();
  });

  /**
   * Test 2: Verify dispatch dimensions are calculated correctly
   */
  it('should calculate correct dispatch dimensions for various texture sizes', async () => {
    const testCases = [
      { width: 256, height: 256, expectedX: 32, expectedY: 32 },  // 256/8 = 32
      { width: 512, height: 512, expectedX: 64, expectedY: 64 },  // 512/8 = 64
      { width: 1024, height: 1024, expectedX: 128, expectedY: 128 }, // 1024/8 = 128
      { width: 500, height: 300, expectedX: 63, expectedY: 38 },  // ceil(500/8), ceil(300/8)
      { width: 127, height: 127, expectedX: 16, expectedY: 16 },  // ceil(127/8) = 16
    ];

    for (const testCase of testCases) {
      const manager = new ComputeShaderManager(device);
      await manager.initialize(TEST_WGSL, testCase.width, testCase.height, false);

      // Verify workgroup size (default 8x8)
      expect(manager.workgroupSize.x).toBe(8);
      expect(manager.workgroupSize.y).toBe(8);
      expect(manager.workgroupSize.z).toBe(1);

      // Verify dispatch dimensions
      expect(manager.dispatchSize.x).toBe(testCase.expectedX);
      expect(manager.dispatchSize.y).toBe(testCase.expectedY);
      expect(manager.dispatchSize.z).toBe(1);

      // Verify dimensions are stored correctly
      expect(manager.textureWidth).toBe(testCase.width);
      expect(manager.textureHeight).toBe(testCase.height);

      // Verify we don't exceed GPU limits
      expect(manager.dispatchSize.x).toBeLessThanOrEqual(device.limits.maxComputeWorkgroupsPerDimension);
      expect(manager.dispatchSize.y).toBeLessThanOrEqual(device.limits.maxComputeWorkgroupsPerDimension);

      manager.destroy();
    }
  });

  /**
   * Test 3: Verify texture content checksum after compute execution
   */
  it('should produce consistent texture content with verifiable checksum', async () => {
    const manager = new ComputeShaderManager(device);

    const node = {
      kind: 'ComputeNoise',
      params: {
        scale: 8.0,
        octaves: 5,
        speed: 0.1
      }
    };
    manager.node = node;

    await manager.initialize(TEST_WGSL, 256, 256, false);

    // Set simulation parameters for deterministic output
    device.setSimulationParams(1.0, node.params);

    // Execute compute pass
    const encoder = device.createCommandEncoder();
    manager.dispatch(encoder, 1.0);
    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);

    // Get texture and verify checksum
    const outputTexture = manager.getOutputTexture();
    expect(outputTexture).toBeTruthy();

    const checksum1 = outputTexture.getChecksum();
    expect(checksum1).toBeGreaterThan(0);

    // Execute again with same parameters - should produce same result
    device.setSimulationParams(1.0, node.params);
    const encoder2 = device.createCommandEncoder();
    manager.dispatch(encoder2, 1.0);
    const commandBuffer2 = encoder2.finish();
    device.queue.submit([commandBuffer2]);

    const checksum2 = outputTexture.getChecksum();
    expect(checksum2).toBe(checksum1); // Deterministic output

    // Execute with different time - should produce different result
    device.setSimulationParams(2.0, node.params);
    const encoder3 = device.createCommandEncoder();
    manager.dispatch(encoder3, 2.0);
    const commandBuffer3 = encoder3.finish();
    device.queue.submit([commandBuffer3]);

    const checksum3 = outputTexture.getChecksum();
    expect(checksum3).not.toBe(checksum1); // Different time produces different output

    // Execute with different parameters - should produce different result
    const newParams = { ...node.params, scale: 16.0 };
    device.setSimulationParams(1.0, newParams);
    const encoder4 = device.createCommandEncoder();
    manager.node.params = newParams;
    manager.dispatch(encoder4, 1.0);
    const commandBuffer4 = encoder4.finish();
    device.queue.submit([commandBuffer4]);

    const checksum4 = outputTexture.getChecksum();
    expect(checksum4).not.toBe(checksum1); // Different params produce different output

    manager.destroy();
  });

  /**
   * Test 4: Verify pipeline creation and initialization with feedback support
   */
  it('should correctly initialize pipelines with and without feedback support', async () => {
    // Test without feedback
    const managerNoFeedback = new ComputeShaderManager(device);
    await managerNoFeedback.initialize(TEST_WGSL, 256, 256, false);

    expect(managerNoFeedback.supportsFeedback).toBe(false);
    expect(managerNoFeedback.storageTexture).toBeTruthy();
    expect(managerNoFeedback.outputTexture).toBeTruthy();
    expect(managerNoFeedback.storageTextureA).toBeNull();
    expect(managerNoFeedback.storageTextureB).toBeNull();
    expect(managerNoFeedback.computePipeline).toBeTruthy();
    expect(managerNoFeedback.bindGroup).toBeTruthy();

    // Test with feedback
    const managerFeedback = new ComputeShaderManager(device);

    const feedbackNode = {
      kind: 'ComputeReactionDiffusion',
      params: {
        feedRate: 0.055,
        killRate: 0.062
      }
    };
    managerFeedback.node = feedbackNode;

    await managerFeedback.initialize(TEST_WGSL_FEEDBACK, 256, 256, true);

    expect(managerFeedback.supportsFeedback).toBe(true);
    expect(managerFeedback.storageTextureA).toBeTruthy();
    expect(managerFeedback.storageTextureB).toBeTruthy();
    expect(managerFeedback.outputTexture).toBeTruthy();
    expect(managerFeedback.computePipeline).toBeTruthy();
    expect(managerFeedback.bindGroup).toBeTruthy();

    // Verify ping-pong state
    expect(managerFeedback.currentWriteTexture).toBe('A');

    // Execute once and verify swap
    const encoder = device.createCommandEncoder();
    managerFeedback.dispatch(encoder, 0.0);
    device.queue.submit([encoder.finish()]);

    expect(managerFeedback.currentWriteTexture).toBe('B'); // Should swap after dispatch

    // Cleanup
    managerNoFeedback.destroy();
    managerFeedback.destroy();
  });

  /**
   * Test 5: Verify resource cleanup and state management
   */
  it('should properly manage and cleanup GPU resources', async () => {
    const manager = new ComputeShaderManager(device);

    const node = {
      kind: 'ComputeNoise',
      params: { scale: 8.0, octaves: 5, speed: 0.1 }
    };
    manager.node = node;

    await manager.initialize(TEST_WGSL, 512, 512, false);

    // Track initial resource count
    const initialTextureCount = device.textures.length;
    const initialBufferCount = device.buffers.length;

    expect(initialTextureCount).toBeGreaterThan(0);
    expect(initialBufferCount).toBeGreaterThan(0);

    // Verify textures are created
    const storageTexture = manager.storageTexture;
    const outputTexture = manager.outputTexture;
    const uniformBuffer = manager.uniformBuffer;

    expect(storageTexture).toBeTruthy();
    expect(outputTexture).toBeTruthy();
    expect(uniformBuffer).toBeTruthy();
    expect(storageTexture.destroyed).toBe(false);
    expect(outputTexture.destroyed).toBe(false);
    expect(uniformBuffer.destroyed).toBe(false);

    // Execute compute to ensure resources are used
    device.setSimulationParams(1.0, node.params);
    const encoder = device.createCommandEncoder();
    manager.dispatch(encoder, 1.0);
    device.queue.submit([encoder.finish()]);

    // Verify dispatch occurred
    expect(device.queue.submitHistory.length).toBeGreaterThan(0);

    // Destroy manager and verify cleanup
    manager.destroy();

    expect(storageTexture.destroyed).toBe(true);
    expect(outputTexture.destroyed).toBe(true);
    expect(uniformBuffer.destroyed).toBe(true);

    // Verify resources are nulled
    expect(manager.storageTexture).toBeNull();
    expect(manager.outputTexture).toBeNull();
    expect(manager.uniformBuffer).toBeNull();
    expect(manager.computePipeline).toBeNull();
    expect(manager.bindGroup).toBeNull();
  });

  /**
   * Bonus Test: ComputeNodeBase integration
   */
  it('should work correctly with ComputeNodeBase wrapper', async () => {
    const node = new ComputeNodeBase(device, {
      id: 'test_compute_node',
      kind: 'ComputeNoise',
      params: {
        scale: 10.0,
        octaves: 6,
        speed: 0.15
      }
    });

    // Initialize node
    await node.initialize(TEST_WGSL, 256, 256, false);

    expect(node.initialized).toBe(true);
    expect(node.id).toBe('test_compute_node');
    expect(node.kind).toBe('ComputeNoise');
    expect(node.width).toBe(256);
    expect(node.height).toBe(256);
    expect(node.getOutputTexture()).toBeTruthy();

    // Test uniform update through node API
    node.setUniform('scale', 15.0);
    expect(node.params.scale).toBe(15.0);

    // Test batch parameter update
    node.updateParams({
      octaves: 8,
      speed: 0.25
    });
    expect(node.params.octaves).toBe(8);
    expect(node.params.speed).toBe(0.25);

    // Test dispatch through node
    device.setSimulationParams(1.0, node.params);
    const encoder = device.createCommandEncoder();
    node.dispatch(device, encoder, 1.0);
    device.queue.submit([encoder.finish()]);

    // Verify output texture has content
    const outputTexture = node.getOutputTexture();
    const checksum = outputTexture.getChecksum();
    expect(checksum).toBeGreaterThan(0);

    // Test serialization
    const serialized = node.serialize();
    expect(serialized.id).toBe('test_compute_node');
    expect(serialized.kind).toBe('ComputeNoise');
    expect(serialized.params.scale).toBe(15.0);
    expect(serialized.dimensions.width).toBe(256);
    expect(serialized.dimensions.height).toBe(256);

    // Cleanup
    node.destroy();
    expect(node.initialized).toBe(false);
  });
});
