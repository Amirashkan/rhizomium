// src/gpu/examples/FeedbackManagerExample.js

/**
 * Example: Using FeedbackManager for a simple reaction-diffusion simulation
 *
 * This example shows how to:
 * 1. Create a FeedbackManager instance
 * 2. Initialize with custom data
 * 3. Create a compute shader that uses ping-pong textures
 * 4. Render loop with automatic swapping
 * 5. Reset simulation state
 */

import { FeedbackManager, createReactionDiffusionInitializer } from '../FeedbackManager.js';

export class FeedbackManagerExample {
  constructor() {
    this.device = null;
    this.feedbackManager = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.uniformBuffer = null;
    this.frameCount = 0;
  }

  /**
   * Initialize WebGPU and FeedbackManager
   */
  async initialize() {
    // Get WebGPU device
    const adapter = await navigator.gpu.requestAdapter();
    this.device = await adapter.requestDevice();

    // Create FeedbackManager
    this.feedbackManager = new FeedbackManager(this.device, {
      width: 512,
      height: 512,
      format: 'rgba8unorm',
      enableHistory: false
    });

    // Initialize with reaction-diffusion pattern
    const initializer = createReactionDiffusionInitializer('spots');
    await this.feedbackManager.initialize(initializer);

    // Create compute pipeline
    await this.createComputePipeline();

    console.log('FeedbackManagerExample initialized');
  }

  /**
   * Create compute pipeline for simple RD simulation
   */
  async createComputePipeline() {
    // WGSL shader code
    const shaderCode = `
      struct Uniforms {
        resolution: vec2<f32>,
        time: f32,
        feedRate: f32,
        killRate: f32,
        diffusionA: f32,
        diffusionB: f32,
        padding: f32
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var prevFrame: texture_2d<f32>;
      @group(0) @binding(2) var outputTexture: texture_storage_2d<rgba8unorm, write>;

      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let coord = vec2<i32>(global_id.xy);
        let size = vec2<i32>(i32(uniforms.resolution.x), i32(uniforms.resolution.y));

        if (coord.x >= size.x || coord.y >= size.y) {
          return;
        }

        // Load current state
        let current = textureLoad(prevFrame, coord, 0);
        var a = current.r;
        var b = current.g;

        // Compute Laplacian
        var laplaceA = 0.0;
        var laplaceB = 0.0;

        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var samplePos = coord + vec2<i32>(dx, dy);
            samplePos.x = (samplePos.x + size.x) % size.x;
            samplePos.y = (samplePos.y + size.y) % size.y;

            let sample = textureLoad(prevFrame, samplePos, 0);

            var weight = 0.0;
            if (dx == 0 && dy == 0) {
              weight = -1.0;
            } else if (dx == 0 || dy == 0) {
              weight = 0.2;
            } else {
              weight = 0.05;
            }

            laplaceA += sample.r * weight;
            laplaceB += sample.g * weight;
          }
        }

        // Gray-Scott equations
        let f = uniforms.feedRate;
        let k = uniforms.killRate;
        let dA = uniforms.diffusionA;
        let dB = uniforms.diffusionB;
        let dt = 0.1;

        let reaction = a * b * b;
        let newA = a + (dA * laplaceA - reaction + f * (1.0 - a)) * dt;
        let newB = b + (dB * laplaceB + reaction - (k + f) * b) * dt;

        let clampedA = clamp(newA, 0.0, 1.0);
        let clampedB = clamp(newB, 0.0, 1.0);

        // Colorize
        let t = clampedB;
        var color: vec3<f32>;
        if (t < 0.5) {
          color = mix(vec3<f32>(0.0, 0.0, 0.2), vec3<f32>(0.0, 0.5, 1.0), t * 2.0);
        } else {
          color = mix(vec3<f32>(0.0, 0.5, 1.0), vec3<f32>(1.0, 1.0, 0.3), (t - 0.5) * 2.0);
        }

        textureStore(outputTexture, vec2<u32>(coord), vec4<f32>(color, 1.0));
      }
    `;

    // Create shader module
    const shaderModule = this.device.createShaderModule({
      code: shaderCode
    });

    // Create uniform buffer
    this.uniformBuffer = this.device.createBuffer({
      size: 32, // 8 floats * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // Create bind group layout
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'float' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { format: 'rgba8unorm' }
        }
      ]
    });

    // Create pipeline
    this.pipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
      }),
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    console.log('Compute pipeline created');
  }

  /**
   * Update uniforms
   */
  updateUniforms(time) {
    const uniforms = new Float32Array([
      512, 512,           // resolution
      time,               // time
      0.0545,             // feedRate (Coral pattern)
      0.062,              // killRate
      1.0,                // diffusionA
      0.5,                // diffusionB
      0.0                 // padding
    ]);

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
  }

  /**
   * Execute one frame of simulation
   */
  step(time) {
    // Update uniforms
    this.updateUniforms(time);

    // Create bind group (recreate each frame because textures swap)
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer }
        },
        {
          binding: 1,
          resource: this.feedbackManager.getReadView()  // Read from previous frame
        },
        {
          binding: 2,
          resource: this.feedbackManager.getWriteView() // Write to current frame
        }
      ]
    });

    // Create command encoder
    const encoder = this.device.createCommandEncoder();

    // Compute pass
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(64, 64); // 512 / 8 = 64
    pass.end();

    // Submit
    this.device.queue.submit([encoder.finish()]);

    // Swap ping-pong buffers for next frame
    this.feedbackManager.swap();

    this.frameCount++;
  }

  /**
   * Get current output texture for display
   */
  getOutputTexture() {
    // Return the texture we just wrote to (which is now the "read" texture after swap)
    return this.feedbackManager.getReadTexture();
  }

  /**
   * Reset simulation
   */
  async reset(pattern = 'spots') {
    const initializer = createReactionDiffusionInitializer(pattern);
    await this.feedbackManager.reset(initializer);
    this.frameCount = 0;
    console.log(`Simulation reset to pattern: ${pattern}`);
  }

  /**
   * Get simulation stats
   */
  getStats() {
    return {
      ...this.feedbackManager.getStats(),
      pipelineFrames: this.frameCount
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.uniformBuffer) {
      this.uniformBuffer.destroy();
    }
    if (this.feedbackManager) {
      this.feedbackManager.destroy();
    }
  }
}

// Usage example:
// const example = new FeedbackManagerExample();
// await example.initialize();
//
// // Render loop
// function animate(time) {
//   example.step(time / 1000);
//   requestAnimationFrame(animate);
// }
// requestAnimationFrame(animate);
//
// // Reset after 5 seconds
// setTimeout(() => example.reset('random'), 5000);
