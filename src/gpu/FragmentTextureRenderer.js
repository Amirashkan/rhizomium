/**
 * FragmentTextureRenderer
 *
 * Renders fragment shader expressions to GPU textures.
 * This enables fragment nodes to be used as inputs to compute nodes
 * by "materializing" their expression outputs into concrete textures.
 *
 * Key features:
 * - Compiles single fragment node + dependencies to WGSL shader
 * - Renders to intermediate GPU texture
 * - Caches textures per node for reuse across frames
 * - Automatically handles resolution matching
 *
 * Usage:
 * const renderer = new FragmentTextureRenderer(device);
 * const texture = await renderer.renderNodeToTexture(nodeId, 512, 512, time);
 * // texture can now be used as compute shader input
 */

import { NodeDefs } from '../data/NodeDefs.js';

export class FragmentTextureRenderer {
  constructor(device) {
    this.device = device;
    this.format = 'rgba8unorm'; // Standard texture format

    // Cache: nodeId -> { texture, pipeline, bindGroups, lastTime }
    this.textureCache = new Map();

    // Cache: nodeId -> shader code (for detecting changes)
    this.shaderCache = new Map();

  }

  /**
   * Render a fragment node and its dependencies to a texture
   * @param {string} nodeId - The node to render
   * @param {number} width - Texture width
   * @param {number} height - Texture height
   * @param {number} time - Current time in seconds
   * @param {Object} audioContext - Audio envelope values
   * @param {GPUCommandEncoder} externalEncoder - Optional external command encoder (for synchronization)
   * @returns {GPUTexture} The rendered texture
   */
  async renderNodeToTexture(nodeId, width, height, time = 0, audioContext = {}, externalEncoder = null) {
    try {
      // Get the node from the graph
      const node = window.graph?.getNode(nodeId);
      if (!node) {
        console.error(`[FragmentTextureRenderer] Node ${nodeId} not found`);
        return this._createFallbackTexture(width, height);
      }

      const nodeDef = NodeDefs[node.kind];
      if (!nodeDef) {
        console.error(`[FragmentTextureRenderer] Node definition not found for ${node.kind}`);
        return this._createFallbackTexture(width, height);
      }

      // Check if this is actually a compute node (shouldn't happen, but safety check)
      if (nodeDef.cat === 'Compute') {
        return null; // Let ComputeExecutor handle it
      }

      // Compile the node and its dependencies to a shader
      const shaderCode = await this._compileNodeToShader(node);

      if (!shaderCode) {
        console.error(`[FragmentTextureRenderer] Failed to compile shader for node ${nodeId}`);
        return this._createFallbackTexture(width, height);
      }

      // Check cache for existing resources
      const cacheKey = `${nodeId}_${width}x${height}`;
      let cached = this.textureCache.get(cacheKey);

      // If shader changed or no cache, rebuild pipeline
      const shaderChanged = this.shaderCache.get(nodeId) !== shaderCode;
      if (shaderChanged || !cached) {
        cached = await this._buildPipeline(nodeId, shaderCode, width, height);
        this.textureCache.set(cacheKey, cached);
        this.shaderCache.set(nodeId, shaderCode);
      }

      if (!cached || !cached.pipeline) {
        console.error(`[FragmentTextureRenderer] Failed to build pipeline for node ${nodeId}`);
        return this._createFallbackTexture(width, height);
      }

      // Store node reference for parameter updates
      cached.node = node;

      // Render to the texture (using external encoder if provided)
      await this._renderToTexture(cached, time, width, height, audioContext, externalEncoder);


      return cached.texture;
    } catch (error) {
      console.error(`[FragmentTextureRenderer] Error rendering node ${nodeId}:`, error);
      return this._createFallbackTexture(width, height);
    }
  }

  /**
   * Compile a fragment node to a complete WGSL shader
   * @private
   */
  async _compileNodeToShader(targetNode) {
    try {
      // Create a minimal subgraph containing just this node and its dependencies
      const subgraph = this._extractSubgraph(targetNode);

      // Create a fake OutputFinal node to make buildWGSL happy
      const outputNode = {
        id: `output_for_${targetNode.id}`,
        kind: 'OutputFinal',
        inputs: [targetNode.id],
        params: {}
      };
      subgraph.nodes.push(outputNode);

      // Use the existing buildWGSL infrastructure
      // CRITICAL: skipCacheClear=true prevents clearing the main shader's caches,
      // which would trigger infinite rebuild loops during auto-bridging
      const { buildWGSL } = await import('../codegen/glslBuilder.js');
      const { wgsl } = buildWGSL(subgraph, { skipCacheClear: true });

      if (!wgsl || wgsl.trim() === '') {
        return null;
      }

      return wgsl;
    } catch (error) {
      console.error('[FragmentTextureRenderer] Shader compilation error:', error);
      return null;
    }
  }

  /**
   * Extract a subgraph containing a node and all its dependencies
   * CRITICAL: Excludes compute nodes from the subgraph to prevent infinite loops
   * Compute nodes are rendered separately by ComputeExecutor and should only be
   * referenced as texture samplers in fragment shaders, not compiled inline.
   * @private
   */
  _extractSubgraph(targetNode) {
    const subgraphNodes = [];
    const visited = new Set();

    const addNodeWithDependencies = (node) => {
      if (!node || visited.has(node.id)) return;
      visited.add(node.id);

      // CRITICAL: Check if this is a compute node and skip it
      // Compute nodes should be executed by ComputeExecutor, not compiled into fragment shaders
      // Including them causes infinite loops: execute() -> _renderFragmentInputs() -> buildWGSL(compute node) -> side effects -> execute()
      const isComputeNode = node.kind && node.kind.startsWith('Compute');
      if (isComputeNode) {
        console.log(`[FragmentTextureRenderer] Skipping compute node ${node.kind} (${node.id}) in fragment subgraph - will be sampled as texture instead`);
        return; // Don't add compute nodes to fragment subgraphs
      }

      // Add input dependencies first
      if (node.inputs && Array.isArray(node.inputs)) {
        for (const inputId of node.inputs) {
          if (inputId !== null && inputId !== undefined) {
            const inputNode = window.graph?.getNode(inputId);
            if (inputNode) {
              addNodeWithDependencies(inputNode);
            }
          }
        }
      }

      // Add the node itself
      subgraphNodes.push(node);
    };

    addNodeWithDependencies(targetNode);

    // Create connections array from node inputs
    const connections = [];
    for (const node of subgraphNodes) {
      if (node.inputs && Array.isArray(node.inputs)) {
        for (let pinIndex = 0; pinIndex < node.inputs.length; pinIndex++) {
          const inputId = node.inputs[pinIndex];
          if (inputId !== null && inputId !== undefined) {
            connections.push({
              from: { nodeId: inputId, pin: 0 },
              to: { nodeId: node.id, pin: pinIndex }
            });
          }
        }
      }
    }

    return {
      nodes: subgraphNodes,
      connections: connections,
      getNode: (id) => subgraphNodes.find(n => n.id === id)
    };
  }

  /**
   * Build WebGPU pipeline for rendering
   * @private
   */
  async _buildPipeline(nodeId, shaderCode, width, height) {
    try {
      // Create shader module
      const shaderModule = this.device.createShaderModule({
        code: shaderCode,
        label: `fragment-texture-shader-${nodeId}`
      });

      // Create output texture
      const texture = this.device.createTexture({
        size: { width, height, depthOrArrayLayers: 1 },
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
        label: `fragment-texture-${nodeId}`
      });

      // Analyze bindings from shader (reuse from gpuRenderer)
      const bindingMap = this._analyzeBindings(shaderCode);

      // Create bind group layouts and bind groups
      const { layouts, bindGroups, uniformBuffers } = this._createBindResources(bindingMap);

      // Create pipeline layout
      const pipelineLayout = this.device.createPipelineLayout({
        bindGroupLayouts: layouts
      });

      // Create render pipeline
      const pipeline = this.device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: 'vs_main'
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs_main',
          targets: [{ format: this.format }]
        },
        primitive: {
          topology: 'triangle-list'
        }
      });

      return {
        texture,
        pipeline,
        bindGroups,
        uniformBuffers,
        shaderModule,
        width,
        height
      };
    } catch (error) {
      console.error('[FragmentTextureRenderer] Pipeline build error:', error);
      return null;
    }
  }

  /**
   * Render to texture using the pipeline
   * @private
   */
  async _renderToTexture(cached, time, width, height, audioContext, externalEncoder = null) {
    try {
      // Update uniforms (time, resolution, audio, etc.)
      this._updateUniforms(cached, time, width, height, audioContext);

      // Use external encoder if provided, otherwise create our own
      const encoder = externalEncoder || this.device.createCommandEncoder({
        label: 'fragment-texture-render'
      });
      const shouldSubmit = !externalEncoder; // Only submit if we created the encoder

      // Begin render pass
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: cached.texture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      });

      pass.setPipeline(cached.pipeline);

      // Bind all bind groups
      for (let i = 0; i < cached.bindGroups.length; i++) {
        pass.setBindGroup(i, cached.bindGroups[i]);
      }

      // Draw fullscreen triangle
      pass.draw(3, 1, 0, 0);
      pass.end();

      // Only submit if we created the encoder ourselves
      if (shouldSubmit) {
        this.device.queue.submit([encoder.finish()]);

        // CRITICAL: Wait for GPU to finish rendering before returning
        // Without this, compute shaders may try to read from incomplete textures
        if (this.device.queue.onSubmittedWorkDone) {
          await this.device.queue.onSubmittedWorkDone();
          console.log(`[FragmentTextureRenderer] GPU work completed for fragment render`);
        } else {
          console.warn(`[FragmentTextureRenderer] onSubmittedWorkDone not available, using 100ms fallback delay`);
          // Fallback: Longer delay to give GPU time to finish
          // 100ms should be more than enough for most GPUs
          await new Promise(resolve => setTimeout(resolve, 100));
          console.log(`[FragmentTextureRenderer] Fallback delay completed`);
        }

        // Debug: Log texture details after render
        console.log(`[FragmentTextureRenderer] Rendered to texture: ${cached.texture.width}x${cached.texture.height}, format=${cached.texture.format}, usage=${cached.texture.usage}`);
      } else {
        console.log(`[FragmentTextureRenderer] Using external encoder - fragment render added to shared command buffer`);
      }
    } catch (error) {
      console.error('[FragmentTextureRenderer] Render error:', error);
      throw error;
    }
  }

  /**
   * Analyze @group/@binding declarations in WGSL
   * @private
   */
  _analyzeBindings(wgsl) {
    const groups = {};
    const re = /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<(\w+)>)?\s+([\w_]+)\s*:\s*([^;]+);/g;

    let match;
    while ((match = re.exec(wgsl)) !== null) {
      const groupIndex = parseInt(match[1], 10);
      const bindingIndex = parseInt(match[2], 10);
      const varName = match[4];
      const typeStr = match[5].trim();

      let kind = 'uniform-buffer';
      if (/^sampler/.test(typeStr)) kind = 'sampler';
      else if (/^texture_2d/.test(typeStr)) kind = 'texture-2d';
      else if (/^texture_cube/.test(typeStr)) kind = 'texture-cube';

      if (!groups[groupIndex]) groups[groupIndex] = {};
      groups[groupIndex][bindingIndex] = { kind, varName, typeStr };
    }

    return { groups };
  }

  /**
   * Create bind group layouts and bind groups
   * @private
   */
  _createBindResources(bindingMap) {
    const groupIndices = Object.keys(bindingMap.groups).map(Number).sort((a, b) => a - b);

    const layouts = [];
    const bindGroups = [];
    const uniformBuffers = new Map();

    for (const groupIndex of groupIndices) {
      const bindings = bindingMap.groups[groupIndex];
      const entries = [];
      const resources = [];

      for (const bindingKey of Object.keys(bindings)) {
        const binding = parseInt(bindingKey, 10);
        const meta = bindings[binding];

        // Create layout entry
        const layoutEntry = this._createLayoutEntry(meta.kind, binding);
        entries.push(layoutEntry);

        // Create resource
        const resource = this._createResource(meta, uniformBuffers);
        resources.push({ binding, resource });
      }

      // Create layout
      const layout = this.device.createBindGroupLayout({ entries });
      layouts.push(layout);

      // Create bind group
      const bindGroup = this.device.createBindGroup({
        layout,
        entries: resources
      });
      bindGroups.push({ bindGroup, uniformBuffers });
    }

    return { layouts, bindGroups: bindGroups.map(bg => bg.bindGroup), uniformBuffers };
  }

  /**
   * Create bind group layout entry
   * @private
   */
  _createLayoutEntry(kind, binding) {
    const stages = GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX;

    switch (kind) {
      case 'uniform-buffer':
        return { binding, visibility: stages, buffer: { type: 'uniform' } };
      case 'sampler':
        return { binding, visibility: stages, sampler: {} };
      case 'texture-2d':
        return { binding, visibility: stages, texture: {} };
      case 'texture-cube':
        return { binding, visibility: stages, texture: { viewDimension: 'cube' } };
      default:
        return { binding, visibility: stages, buffer: { type: 'uniform' } };
    }
  }

  /**
   * Create resource for binding
   * @private
   */
  _createResource(meta, uniformBuffers) {
    switch (meta.kind) {
      case 'uniform-buffer': {
        const size = meta.varName === 'u' ? 16 : (meta.varName === 'g' ? 32 : 64);
        const buffer = this.device.createBuffer({
          size,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          label: `uniform-${meta.varName}`
        });
        uniformBuffers.set(meta.varName, buffer);
        return { buffer };
      }
      case 'sampler': {
        const sampler = this.device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear'
        });
        return sampler;
      }
      case 'texture-2d':
      case 'texture-cube': {
        // Create dummy 1x1 texture
        const texture = this.device.createTexture({
          size: [1, 1, 1],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });
        const color = new Uint8Array([255, 255, 255, 255]);
        this.device.queue.writeTexture({ texture }, color, { bytesPerRow: 4 }, [1, 1]);
        return texture.createView();
      }
      default:
        throw new Error(`Unknown resource kind: ${meta.kind}`);
    }
  }

  /**
   * Update uniform buffers with current values
   * @private
   */
  _updateUniforms(cached, time, width, height, audioContext) {
    if (!cached || !cached.uniformBuffers) {
      return;
    }

    const uniformBuffers = cached.uniformBuffers;

    // Update aspect uniform (u)
    const aspectBuffer = uniformBuffers.get('u');
    if (aspectBuffer) {
      const aspectData = new Float32Array([width / height, 0, 0, 0]);
      this.device.queue.writeBuffer(aspectBuffer, 0, aspectData);
    }

    // Update globals uniform (g)
    const globalsBuffer = uniformBuffers.get('g');
    if (globalsBuffer) {
      const globalsData = new Float32Array([
        width,
        height,
        time,
        audioContext.audioEnvelope || 0,
        audioContext.audioEnvelopeBass || 0,
        audioContext.audioEnvelopeMids || 0,
        audioContext.audioEnvelopeHighs || 0,
        audioContext.audioEnvelopeFull || 0
      ]);
      this.device.queue.writeBuffer(globalsBuffer, 0, globalsData);
    }

    // Update parameter uniforms (u_params) - CRITICAL for node parameters like SimplexNoise scale
    const paramsBuffer = uniformBuffers.get('u_params');
    if (paramsBuffer && cached.node) {
      // Get the node to access its parameters
      const node = cached.node;

      // Build parameter data array based on what the shader expects
      // The uniform struct in the shader has all parameters in order
      const paramData = [];

      if (node.params) {
        // Add all numeric parameters in a consistent order
        // This matches the UniformManager's parameter ordering
        for (const [key, value] of Object.entries(node.params)) {
          if (typeof value === 'number') {
            paramData.push(value);
          } else if (typeof value === 'boolean') {
            paramData.push(value ? 1.0 : 0.0);
          }
        }
      }

      // Pad to vec4 alignment if needed (WGSL struct alignment requirement)
      while (paramData.length % 4 !== 0) {
        paramData.push(0.0);
      }

      if (paramData.length > 0) {
        const paramsArray = new Float32Array(paramData);
        this.device.queue.writeBuffer(paramsBuffer, 0, paramsArray);
      }
    }
  }

  /**
   * Create a fallback texture (solid color)
   * @private
   */
  _createFallbackTexture(width, height) {
    const texture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: 1 },
      format: this.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      label: 'fragment-fallback-texture'
    });

    // Fill with magenta to indicate error
    const size = width * height * 4;
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i += 4) {
      data[i] = 255;     // R
      data[i + 1] = 0;   // G
      data[i + 2] = 255; // B
      data[i + 3] = 255; // A
    }

    this.device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: width * 4 },
      { width, height }
    );

    return texture;
  }

  /**
   * Sanitize node ID for use in shader variable names
   * @private
   */
  _sanitize(id) {
    return String(id).replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Clear the texture cache
   */
  clearCache() {
    // Destroy all cached textures
    for (const cached of this.textureCache.values()) {
      if (cached.texture) {
        cached.texture.destroy();
      }
    }
    this.textureCache.clear();
    this.shaderCache.clear();
  }

  /**
   * Remove a specific node from cache
   */
  invalidateNode(nodeId) {
    // Remove all cache entries for this node
    const keysToDelete = [];
    for (const [key, _] of this.textureCache.entries()) {
      if (key.startsWith(`${nodeId}_`)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const cached = this.textureCache.get(key);
      if (cached?.texture) {
        cached.texture.destroy();
      }
      this.textureCache.delete(key);
    }

    this.shaderCache.delete(nodeId);
  }
}
