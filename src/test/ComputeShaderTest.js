/**
 * ComputeShaderTest
 * Test integration for WGSL compute shaders with texture output
 */

import { ComputeShaderManager } from '../gpu/ComputeShaderManager.js';

export class ComputeShaderTest {
  constructor(device, canvas) {
    this.device = device;
    this.canvas = canvas;
    this.computeManager = null;
    this.isEnabled = false;
    this.isInitialized = false;

    // Display canvas for compute output
    this.displayContext = null;
    this.sampler = null;
    this.displayPipeline = null;
    this.displayBindGroup = null;

    // Debug overlay
    this.debugOverlay = null;
    this.fpsCounter = { frames: 0, lastTime: performance.now(), fps: 0 };

    // Test configuration
    this.textureWidth = 512;
    this.textureHeight = 512;
  }

  /**
   * Initialize compute shader test
   */
  async initialize() {
    if (this.isInitialized) {

      return;
    }

    // Load compute shader source
    const shaderSource = await this.loadComputeShader();

    // Create compute manager
    this.computeManager = new ComputeShaderManager(this.device);
    await this.computeManager.initialize(shaderSource, this.textureWidth, this.textureHeight);

    // Setup display pipeline to show compute output
    await this.setupDisplayPipeline();

    // Create debug overlay
    this.createDebugOverlay();

    this.isInitialized = true;
  }

  /**
   * Load compute shader WGSL source
   */
  async loadComputeShader() {
    const response = await fetch('/src/shaders/testCompute.wgsl');
    if (!response.ok) {
      throw new Error(`Failed to load shader: ${response.statusText}`);
    }
    const source = await response.text();

    return source;
  }

  /**
   * Setup display pipeline to render compute output to canvas
   */
  async setupDisplayPipeline() {
    // Get canvas context
    this.displayContext = this.canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();

    this.displayContext.configure({
      device: this.device,
      format: format,
      alphaMode: 'premultiplied'
    });

    // Create sampler for texture sampling
    this.sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge'
    });

    // Simple shader to display the compute output texture
    const displayShaderCode = `
      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>
      }

      @vertex
      fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        var output: VertexOutput;

        // Full-screen triangle
        let x = f32((vertexIndex << 1u) & 2u);
        let y = f32(vertexIndex & 2u);

        output.position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
        output.uv = vec2<f32>(x, y);

        return output;
      }

      @group(0) @binding(0) var texSampler: sampler;
      @group(0) @binding(1) var texInput: texture_2d<f32>;

      @fragment
      fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
        return textureSample(texInput, texSampler, input.uv);
      }
    `;

    const shaderModule = this.device.createShaderModule({
      code: displayShaderCode,
      label: 'Display Shader Module'
    });

    // Create pipeline layout
    const bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Display Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float', viewDimension: '2d' }
        }
      ]
    });

    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Display Pipeline Layout',
      bindGroupLayouts: [bindGroupLayout]
    });

    // Create render pipeline
    this.displayPipeline = this.device.createRenderPipeline({
      label: 'Display Render Pipeline',
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main'
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: format
        }]
      },
      primitive: {
        topology: 'triangle-list'
      }
    });

  }

  /**
   * Create debug overlay UI
   */
  createDebugOverlay() {
    // Check if overlay already exists
    let overlay = document.getElementById('compute-debug-overlay');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'compute-debug-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.8);
        color: #0f0;
        font-family: 'Courier New', monospace;
        font-size: 12px;
        padding: 10px 15px;
        border-radius: 5px;
        border: 1px solid #0f0;
        z-index: 10000;
        min-width: 200px;
        box-shadow: 0 0 10px rgba(0, 255, 0, 0.3);
      `;
      document.body.appendChild(overlay);
    }

    this.debugOverlay = overlay;
    this.updateDebugOverlay();

  }

  /**
   * Update debug overlay with current stats
   */
  updateDebugOverlay() {
    if (!this.debugOverlay || !this.computeManager) return;

    const info = this.computeManager.getWorkgroupInfo();

    this.debugOverlay.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 8px; color: #0ff;">⚡ COMPUTE SHADER TEST</div>
      <div>Status: <span style="color: ${this.isEnabled ? '#0f0' : '#f00'}">${this.isEnabled ? 'ACTIVE' : 'INACTIVE'}</span></div>
      <div style="margin-top: 8px; border-top: 1px solid #0f0; padding-top: 8px;">
        <div>Texture: ${info.textureSize.width}x${info.textureSize.height}</div>
        <div>Workgroup: ${info.workgroupSize.x}x${info.workgroupSize.y}</div>
        <div>Dispatch: ${info.dispatchSize.x}x${info.dispatchSize.y} groups</div>
      </div>
      <div style="margin-top: 8px; border-top: 1px solid #0f0; padding-top: 8px;">
        <div>FPS: <span style="color: #ff0; font-weight: bold;">${this.fpsCounter.fps}</span></div>
      </div>
    `;
  }

  /**
   * Update FPS counter
   */
  updateFPS() {
    this.fpsCounter.frames++;
    const now = performance.now();
    const elapsed = now - this.fpsCounter.lastTime;

    if (elapsed >= 1000) {
      this.fpsCounter.fps = Math.round((this.fpsCounter.frames * 1000) / elapsed);
      this.fpsCounter.frames = 0;
      this.fpsCounter.lastTime = now;
      this.updateDebugOverlay();
    }
  }

  /**
   * Enable compute shader test
   */
  async enable() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.isEnabled = true;
    if (this.debugOverlay) {
      this.debugOverlay.style.display = 'block';
    }
    this.updateDebugOverlay();

  }

  /**
   * Disable compute shader test
   */
  disable() {
    this.isEnabled = false;
    if (this.debugOverlay) {
      this.debugOverlay.style.display = 'none';
    }

  }

  /**
   * Render frame - dispatch compute shader and display result
   */
  render(time = 0) {
    if (!this.isEnabled || !this.isInitialized || !this.computeManager) {
      return;
    }

    try {
      // Create command encoder
      const commandEncoder = this.device.createCommandEncoder({
        label: 'Compute Test Command Encoder'
      });

      // Dispatch compute shader
      this.computeManager.dispatch(commandEncoder, time);

      // Create bind group for display (if not created yet or texture changed)
      if (!this.displayBindGroup || this._lastOutputTexture !== this.computeManager.getOutputTexture()) {
        this._lastOutputTexture = this.computeManager.getOutputTexture();

        this.displayBindGroup = this.device.createBindGroup({
          label: 'Display Bind Group',
          layout: this.displayPipeline.getBindGroupLayout(0),
          entries: [
            {
              binding: 0,
              resource: this.sampler
            },
            {
              binding: 1,
              resource: this._lastOutputTexture.createView()
            }
          ]
        });
      }

      // Render compute output to canvas
      const textureView = this.displayContext.getCurrentTexture().createView();

      const renderPass = commandEncoder.beginRenderPass({
        label: 'Display Render Pass',
        colorAttachments: [{
          view: textureView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });

      renderPass.setPipeline(this.displayPipeline);
      renderPass.setBindGroup(0, this.displayBindGroup);
      renderPass.draw(3); // Full-screen triangle
      renderPass.end();

      // Submit commands
      this.device.queue.submit([commandEncoder.finish()]);

      // Update FPS
      this.updateFPS();

    } catch (error) {

    }
  }

  /**
   * Toggle compute shader test on/off
   */
  toggle() {
    if (this.isEnabled) {
      this.disable();
    } else {
      this.enable();
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.computeManager) {
      this.computeManager.destroy();
    }

    if (this.debugOverlay && this.debugOverlay.parentNode) {
      this.debugOverlay.parentNode.removeChild(this.debugOverlay);
    }

    this.displayPipeline = null;
    this.displayBindGroup = null;
    this.sampler = null;
    this.displayContext = null;
    this.computeManager = null;
    this.isEnabled = false;
    this.isInitialized = false;

  }
}
