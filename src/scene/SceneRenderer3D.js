// src/scene/SceneRenderer3D.js

/**
 * SceneRenderer3D - Renders a 3D scene using WebGPU
 * Integrates with Viewport3D for camera/view management
 */

import { ShapeRenderer } from './renderers/ShapeRenderer.js';
import { InstanceRenderer } from './renderers/InstanceRenderer.js';
import { ShapeGeometry } from './generators/ShapeGeometry.js';

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
    this.preferredFormat = null;

    // Per-field-mapper-node renderers. Each node needs its own instances
    // because the renderers own their vertex/uniform buffers and all
    // queue.writeBuffer calls land before the render pass executes.
    this.fieldRenderers = new Map();

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

      // Configure context. COPY_DST lets us blit the offscreen scene texture
      // (which doubles as the live node-thumbnail source) onto the canvas.
      const preferredFormat = navigator.gpu.getPreferredCanvasFormat();
      this.preferredFormat = preferredFormat;
      this.context.configure({
        device: this.device,
        format: preferredFormat,
        alphaMode: 'premultiplied',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST
      });

      // Create depth texture
      this.createDepthTexture();

      // Create render pipeline
      await this.createRenderPipeline(preferredFormat);

      // Create uniform buffer
      this.createUniformBuffer();

      this.initialized = true;
    } catch (error) {

      throw error;
    }
  }

  /**
   * The resolution the 3D view renders at. Follows the final render
   * resolution (the preview/export setting the compute pipeline also uses),
   * so the node's output texture matches the rest of the graph. Falls back
   * to the viewport canvas size, then 512.
   * @returns {[number, number]}
   */
  _getRenderResolution() {
    const MAX_RES = 2048;
    const res = typeof window !== 'undefined'
      ? window.floatingPreview?.settings?.settings?.resolution
      : null;
    let width = res?.width;
    let height = res?.height;
    if (!(width > 0) || !(height > 0)) {
      width = this.canvas?.width;
      height = this.canvas?.height;
    }
    if (!(width > 0) || !(height > 0)) {
      width = 512;
      height = 512;
    }
    return [Math.min(Math.round(width), MAX_RES), Math.min(Math.round(height), MAX_RES)];
  }

  /**
   * Create the offscreen render targets at the current render resolution
   */
  createDepthTexture() {
    if (this.depthTexture) {
      this.depthTexture.destroy();
    }
    if (this.sceneTexture) {
      this.sceneTexture.destroy();
    }

    const [width, height] = this._getRenderResolution();
    this._targetWidth = width;
    this._targetHeight = height;
    const size = { width, height, depthOrArrayLayers: 1 };

    this.depthTexture = this.device.createTexture({
      size,
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });

    // Offscreen color target: the scene renders here at output resolution,
    // gets aspect-fit blitted to the viewport canvas, and stays sampleable
    // for the node's graph output and live thumbnail
    this.sceneTexture = this.device.createTexture({
      size,
      format: this.preferredFormat || navigator.gpu.getPreferredCanvasFormat(),
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
    });
  }

  /**
   * Lazily build the aspect-fit blit pipeline that presents the offscreen
   * frame on the viewport canvas (letterboxing when aspects differ - the
   * render resolution is independent of the window size).
   * @private
   */
  _ensureBlitPipeline() {
    if (this._blitPipeline) return;

    const format = this.preferredFormat || navigator.gpu.getPreferredCanvasFormat();
    const module = this.device.createShaderModule({
      label: 'viewport-blit',
      code: `
        struct BlitParams { uvScale: vec2<f32>, _pad: vec2<f32> }
        @group(0) @binding(0) var srcTex: texture_2d<f32>;
        @group(0) @binding(1) var srcSampler: sampler;
        @group(0) @binding(2) var<uniform> params: BlitParams;

        struct VsOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> }

        @vertex fn vs(@builtin(vertex_index) vid: u32) -> VsOut {
          var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
          var o: VsOut;
          o.pos = vec4<f32>(p[vid], 0.0, 1.0);
          o.uv = vec2<f32>((p[vid].x + 1.0) * 0.5, (1.0 - p[vid].y) * 0.5);
          return o;
        }

        @fragment fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
          let cuv = (uv - 0.5) * params.uvScale + 0.5;
          if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) {
            return vec4<f32>(0.0, 0.0, 0.0, 1.0); // letterbox bars
          }
          return textureSampleLevel(srcTex, srcSampler, cuv, 0.0);
        }
      `
    });

    this._blitPipeline = this.device.createRenderPipeline({
      label: 'viewport-blit',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    });
    this._blitSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this._blitUniforms = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  /**
   * The sampleable offscreen texture holding the latest rendered frame
   * @returns {GPUTexture|null}
   */
  getSceneTexture() {
    return this.sceneTexture;
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
    // Uniform buffer size with proper alignment:
    // viewProjection: mat4x4<f32> = 64 bytes (offset 0)
    // modelMatrix: mat4x4<f32> = 64 bytes (offset 64)
    // time: f32 = 4 bytes (offset 128)
    // _padding: vec3<f32> = 12 bytes but aligned to 16 bytes (offset 144)
    // Total with struct padding = 160 bytes
    this.uniformBuffer = this.device.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
  }

  /**
   * Render the scene
   */
  render(time = 0) {
    if (!this.initialized) return;

    // Recreate targets when the final render resolution setting changes
    const [targetWidth, targetHeight] = this._getRenderResolution();
    if (targetWidth !== this._targetWidth || targetHeight !== this._targetHeight) {
      this.createDepthTexture();
    }

    // Update viewport, then pin the camera aspect to the OUTPUT resolution -
    // the graph consumes this frame, so it must not distort when the panel
    // window is resized (the blit letterboxes instead)
    if (this.viewport3D) {
      this.viewport3D.update();
      const camera = this.viewport3D.getCamera?.();
      const aspect = this._targetWidth / this._targetHeight;
      if (camera && Math.abs((camera.aspect ?? 0) - aspect) > 1e-4) {
        camera.setAspect(aspect);
      }
    }

    // Create command encoder
    const commandEncoder = this.device.createCommandEncoder();

    // Render into the offscreen scene texture (blitted to the canvas below)
    const renderPassDescriptor = {
      colorAttachments: [{
        view: this.sceneTexture.createView(),
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
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

    // Render mesh nodes (if any)
    try {
      const meshNodes = this.scene.getMeshNodes();
      if (meshNodes && meshNodes.length > 0) {
        for (const meshNode of meshNodes) {
          this.renderMeshNode(passEncoder, meshNode, time);
        }
      }
    } catch (error) {

    }

    // Render compute field mapper nodes (if any)
    try {
      const fieldMapperNodes = this.scene.getComputeFieldMapperNodes();
      this.pruneFieldRenderers(fieldMapperNodes);
      if (fieldMapperNodes && fieldMapperNodes.length > 0) {
        for (const fieldNode of fieldMapperNodes) {
          this.renderFieldMapperNode(passEncoder, fieldNode, time);
        }
      }
    } catch (error) {

    }

    passEncoder.end();

    // Aspect-fit blit of the finished frame onto the viewport canvas
    try {
      const currentTexture = this.context.getCurrentTexture();
      this._ensureBlitPipeline();

      const canvasAspect = Math.max(1, this.canvas.width) / Math.max(1, this.canvas.height);
      const texAspect = this._targetWidth / this._targetHeight;
      // Fit the frame inside the canvas: expand the sampled UV range on the
      // axis where the canvas is proportionally larger (bars fill the rest)
      const uvScaleX = canvasAspect > texAspect ? canvasAspect / texAspect : 1;
      const uvScaleY = canvasAspect > texAspect ? 1 : texAspect / canvasAspect;
      this.device.queue.writeBuffer(this._blitUniforms, 0, new Float32Array([uvScaleX, uvScaleY, 0, 0]));

      const blitBindGroup = this.device.createBindGroup({
        layout: this._blitPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sceneTexture.createView() },
          { binding: 1, resource: this._blitSampler },
          { binding: 2, resource: { buffer: this._blitUniforms } }
        ]
      });

      const blitPass = commandEncoder.beginRenderPass({
        colorAttachments: [{
          view: currentTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });
      blitPass.setPipeline(this._blitPipeline);
      blitPass.setBindGroup(0, blitBindGroup);
      blitPass.draw(3, 1, 0, 0);
      blitPass.end();
    } catch {
      // Canvas texture unavailable (e.g. zero-sized while hidden) - the
      // offscreen render still completed for graph-output consumers
    }

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

    // Draw - check for index buffer
    if (meshNode.geometry.indexBuffer && meshNode.geometry.indexCount) {
      passEncoder.setIndexBuffer(meshNode.geometry.indexBuffer, 'uint16');
      passEncoder.drawIndexed(meshNode.geometry.indexCount);
    } else {
      const vertexCount = meshNode.geometry.vertexCount || 0;
      if (vertexCount > 0) {
        passEncoder.draw(vertexCount);
      }
    }
  }

  /**
   * Render a compute field mapper node.
   *
   * Field mappers carry CPU-side geometry (positions/normals/colors/uvs and
   * optional indices as typed arrays) generated by FieldVisualizer, not the
   * interleaved GPU vertex buffer the mesh-node path expects. Indexed
   * geometry is drawn as a lit vertex-colored mesh; unindexed geometry is
   * drawn as a point cloud of camera-facing quads.
   */
  renderFieldMapperNode(passEncoder, fieldNode, time) {
    const renderers = this.getFieldRenderers(fieldNode);
    const viewMatrix = this.viewport3D.getViewMatrix();
    const projectionMatrix = this.viewport3D.getProjectionMatrix();
    const modelMatrix = fieldNode.getWorldMatrix();

    const shapeParams = fieldNode.shapeParams || {};

    // The live compute texture; both modes sample it directly on the GPU
    let texture = null;
    if (this.computeExecutor && fieldNode.sourceNodeId !== null && fieldNode.sourceNodeId !== undefined) {
      const output = this.computeExecutor.getNodeOutput(fieldNode.sourceNodeId);
      if (output && output !== this.computeExecutor.fallbackTexture) {
        texture = output;
      }
    }

    if (shapeParams.mode === 'instances') {
      // Instanced field: one small mesh per field cell, positioned / sized /
      // colored per instance in the vertex shader
      const mesh = ShapeGeometry.getInstanceMesh(shapeParams.instanceShape || 'cube');
      renderers.instances.render(passEncoder, mesh, viewMatrix, projectionMatrix, modelMatrix, {
        texture,
        gridCount: shapeParams.instanceCount ?? 48,
        instanceSize: shapeParams.instanceSize ?? 0.03,
        sizeByField: shapeParams.sizeByField ?? 0.6,
        threshold: shapeParams.instanceThreshold ?? 0.15,
        heightScale: shapeParams.displacementScale ?? 0.4,
        textureAmount: shapeParams.textureAmount ?? 1.0,
        billboard: (shapeParams.instanceShape || 'cube') === 'quad'
      });
      return;
    }

    // Surface: color in the fragment stage, displacement in the vertex stage
    const geometry = ShapeGeometry.get(shapeParams.shape || 'plane', shapeParams.resolution ?? 96);
    renderers.shape.render(passEncoder, geometry, viewMatrix, projectionMatrix, modelMatrix, {
      texture,
      displacementScale: shapeParams.displacementScale ?? 0.4,
      textureAmount: shapeParams.textureAmount ?? 1.0
    });
  }

  /**
   * Get (or lazily create) the dedicated renderers for a field mapper node
   */
  getFieldRenderers(fieldNode) {
    let renderers = this.fieldRenderers.get(fieldNode);
    if (!renderers) {
      const format = this.preferredFormat || navigator.gpu.getPreferredCanvasFormat();
      renderers = {
        shape: new ShapeRenderer(this.device),
        instances: new InstanceRenderer(this.device)
      };
      // initialize() completes synchronously (no awaits inside), so the
      // renderers are usable as soon as these calls return
      renderers.shape.initialize(format);
      renderers.instances.initialize(format);
      this.fieldRenderers.set(fieldNode, renderers);
    }
    return renderers;
  }

  /**
   * Drop renderers for field mapper nodes no longer in the scene
   */
  pruneFieldRenderers(activeNodes) {
    const active = new Set(activeNodes || []);
    for (const [node, renderers] of this.fieldRenderers.entries()) {
      if (!active.has(node)) {
        renderers.shape.destroy();
        renderers.instances.destroy();
        this.fieldRenderers.delete(node);
      }
    }
  }

  /**
   * Update uniform buffer with matrices
   */
  updateUniforms(viewProjection, modelMatrix, time) {
    const uniformData = new Float32Array(40); // 160 bytes / 4 = 40 floats

    // View-projection matrix (16 floats, offset 0)
    // Mat4 has .elements property which is the array
    uniformData.set(viewProjection.elements || viewProjection, 0);

    // Model matrix (16 floats, offset 16)
    uniformData.set(modelMatrix.elements || modelMatrix, 16);

    // Time (1 float, offset 32)
    uniformData[32] = time;

    // Padding for alignment (7 floats to reach offset 40)
    // vec3<f32> _padding starts at float index 36 (byte offset 144)
    // Remaining 4 floats (33-36) pad before vec3, then vec3 takes 3 floats (36-38)
    // Final float (39) pads to 160 bytes

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
      this.viewport3D.handleResize(this.canvas.width, this.canvas.height);
    }
  }

  /**
   * Cleanup
   */
  dispose() {
    for (const renderers of this.fieldRenderers.values()) {
      renderers.shape.destroy();
      renderers.instances.destroy();
    }
    this.fieldRenderers.clear();

    if (this.depthTexture) {
      this.depthTexture.destroy();
      this.depthTexture = null;
    }

    if (this.sceneTexture) {
      this.sceneTexture.destroy();
      this.sceneTexture = null;
    }

    if (this._blitUniforms) {
      this._blitUniforms.destroy();
      this._blitUniforms = null;
      this._blitPipeline = null;
    }

    if (this.uniformBuffer) {
      this.uniformBuffer.destroy();
      this.uniformBuffer = null;
    }

    this.initialized = false;
  }
}
