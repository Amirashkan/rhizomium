// src/scene/SceneRenderer3D.js

/**
 * SceneRenderer3D - Renders a 3D scene using WebGPU
 * Integrates with Viewport3D for camera/view management
 */

export class SceneRenderer3D {
  constructor(device, canvas, scene, viewport3D, computeExecutor = null) {
    this.device = device;
    this.canvas = canvas;
    this.scene = scene;
    this.viewport3D = viewport3D;
    this.computeExecutor = computeExecutor;

    this.context = null;
    this.renderPipeline = null;
    this.depthTexture = null;
    this.uniformBuffer = null;
    this.bindGroup = null;

    this.initialized = false;
  }

  /**
   * Initialize the renderer
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Get WebGPU context
      this.context = this.canvas.getContext('webgpu');
      if (!this.context) {
        throw new Error('Failed to get WebGPU context');
      }

      // Configure context
      const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({
        device: this.device,
        format: preferredFormat,
        alphaMode: 'premultiplied'
      });

      // Create depth texture
      this.createDepthTexture();

      // Create render pipeline
      await this.createRenderPipeline(preferredFormat);

      // Create uniform buffer
      this.createUniformBuffer();

      this.initialized = true;
      console.log('[SceneRenderer3D] Initialized successfully');
    } catch (error) {
      console.error('[SceneRenderer3D] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create depth texture for 3D rendering
   */
  createDepthTexture() {
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }

    this.depthTexture = this.device.createTexture({
      size: {
        width: this.canvas.width,
        height: this.canvas.height,
        depthOrArrayLayers: 1
      },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
  }

  /**
   * Create render pipeline for 3D meshes
   */
  async createRenderPipeline(format) {
    // Simple shader for rendering meshes with compute texture mapping
    const shaderCode = `
      struct Uniforms {
        viewProjection: mat4x4<f32>,
        modelMatrix: mat4x4<f32>,
        time: f32,
        _padding: vec3<f32>,
      }

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;
      @group(0) @binding(1) var computeTexture: texture_2d<f32>;
      @group(0) @binding(2) var computeSampler: sampler;

      struct VertexInput {
        @location(0) position: vec3<f32>,
        @location(1) normal: vec3<f32>,
        @location(2) uv: vec2<f32>,
      }

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) worldPos: vec3<f32>,
        @location(1) normal: vec3<f32>,
        @location(2) uv: vec2<f32>,
      }

      @vertex
      fn vertexMain(input: VertexInput) -> VertexOutput {
        var output: VertexOutput;
        let worldPos = uniforms.modelMatrix * vec4(input.position, 1.0);
        output.position = uniforms.viewProjection * worldPos;
        output.worldPos = worldPos.xyz;
        output.normal = (uniforms.modelMatrix * vec4(input.normal, 0.0)).xyz;
        output.uv = input.uv;
        return output;
      }

      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
        // Sample compute texture if available
        let texColor = textureSample(computeTexture, computeSampler, input.uv);

        // Simple lighting
        let lightDir = normalize(vec3(1.0, 1.0, 1.0));
        let normal = normalize(input.normal);
        let diffuse = max(dot(normal, lightDir), 0.0);

        // Combine texture and lighting
        let color = texColor.rgb * (0.3 + 0.7 * diffuse);

        return vec4(color, texColor.a);
      }
    `;

    const shaderModule = this.device.createShaderModule({
      code: shaderCode,
      label: 'Scene3D Shader'
    });

    // Create pipeline layout
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' }
        }
      ]
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });

    // Create render pipeline
    this.renderPipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: 32, // 3 floats (pos) + 3 floats (normal) + 2 floats (uv)
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },  // position
              { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
              { shaderLocation: 2, offset: 24, format: 'float32x2' }  // uv
            ]
          }
        ]
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{ format }]
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back'
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less'
      }
    });

    this.bindGroupLayout = bindGroupLayout;
  }

  /**
   * Create uniform buffer for matrices
   */
  createUniformBuffer() {
    // Uniform buffer: viewProjection (64) + modelMatrix (64) + time (4) + padding (12) = 144 bytes
    this.uniformBuffer = this.device.createBuffer({
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  /**
   * Render the scene
   */
  render(time = 0) {
    if (!this.initialized) return;

    // Update viewport
    if (this.viewport3D) {
      this.viewport3D.update();
    }

    // Create command encoder
    const commandEncoder = this.device.createCommandEncoder();

    // Get current texture
    const currentTexture = this.context.getCurrentTexture();

    // Create render pass
    const renderPassDescriptor = {
      colorAttachments: [{
        view: currentTexture.createView(),
        clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store'
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store'
      }
    };

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(this.renderPipeline);

    // Render mesh nodes
    const meshNodes = this.scene.getMeshNodes();
    for (const meshNode of meshNodes) {
      this.renderMeshNode(passEncoder, meshNode, time);
    }

    // Render compute field mapper nodes
    const fieldMapperNodes = this.scene.getComputeFieldMapperNodes();
    for (const fieldNode of fieldMapperNodes) {
      this.renderFieldMapperNode(passEncoder, fieldNode, time);
    }

    passEncoder.end();

    // Submit commands
    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Render a mesh node
   */
  renderMeshNode(passEncoder, meshNode, time) {
    if (!meshNode.geometry || !meshNode.geometry.vertexBuffer) {
      return;
    }

    // Get matrices from viewport
    const viewProjection = this.viewport3D.getViewProjectionMatrix();
    const modelMatrix = meshNode.getWorldMatrix();

    // Update uniforms
    this.updateUniforms(viewProjection, modelMatrix, time);

    // Get texture from compute executor or use default
    let texture = null;
    let sampler = null;

    if (this.computeExecutor && meshNode.computeNodeId) {
      const computeTexture = this.computeExecutor.getNodeOutput(meshNode.computeNodeId);
      if (computeTexture) {
        texture = computeTexture;
        sampler = this.device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear'
        });
      }
    }

    // Create default texture if none available
    if (!texture) {
      texture = this.createDefaultTexture();
      sampler = this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear'
      });
    }

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: sampler }
      ]
    });

    // Set bind group and vertex buffer
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.setVertexBuffer(0, meshNode.geometry.vertexBuffer);

    // Draw
    const vertexCount = meshNode.geometry.vertexCount || 0;
    if (vertexCount > 0) {
      passEncoder.draw(vertexCount);
    }
  }

  /**
   * Render a compute field mapper node
   */
  renderFieldMapperNode(passEncoder, fieldNode, time) {
    // Similar to renderMeshNode but specifically for field visualization
    this.renderMeshNode(passEncoder, fieldNode, time);
  }

  /**
   * Update uniform buffer with matrices
   */
  updateUniforms(viewProjection, modelMatrix, time) {
    const uniformData = new Float32Array(36); // 144 bytes / 4 = 36 floats

    // View-projection matrix (16 floats)
    uniformData.set(viewProjection, 0);

    // Model matrix (16 floats)
    uniformData.set(modelMatrix, 16);

    // Time (1 float)
    uniformData[32] = time;

    // Padding (3 floats) - already zero

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
  }

  /**
   * Create a default 1x1 texture
   */
  createDefaultTexture() {
    const texture = this.device.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });

    const data = new Uint8Array([128, 128, 128, 255]); // Gray
    this.device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: 4 },
      { width: 1, height: 1 }
    );

    return texture;
  }

  /**
   * Handle canvas resize
   */
  resize() {
    if (!this.initialized) return;

    // Recreate depth texture
    this.createDepthTexture();

    // Update viewport
    if (this.viewport3D) {
      this.viewport3D.resize(this.canvas.width, this.canvas.height);
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    if (this.depthTexture) {
      this.depthTexture.destroy();
      this.depthTexture = null;
    }

    if (this.uniformBuffer) {
      this.uniformBuffer.destroy();
      this.uniformBuffer = null;
    }

    this.initialized = false;
  }
}
