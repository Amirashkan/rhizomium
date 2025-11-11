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

console.log('[FragmentTextureRenderer] Module loaded');

import { NodeDefs } from '../data/NodeDefs.js';

export class FragmentTextureRenderer {
  constructor(device) {
    console.log('[FragmentTextureRenderer] Constructor called');
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

        return this._createFallbackTexture(width, height);
      }

      const nodeDef = NodeDefs[node.kind];
      if (!nodeDef) {

        return this._createFallbackTexture(width, height);
      }

      // Check if this is actually a compute node (shouldn't happen, but safety check)
      if (nodeDef.cat === 'Compute') {
        return null; // Let ComputeExecutor handle it
      }

      // Compile the node and its dependencies to a shader
      const compilationResult = await this._compileNodeToShader(node);

      if (!compilationResult) {

        return this._createFallbackTexture(width, height);
      }

      const { wgsl: shaderCode, uniformManager } = compilationResult;

      // Check cache for existing resources
      const cacheKey = `${nodeId}_${width}x${height}`;
      let cached = this.textureCache.get(cacheKey);

      // If shader changed or no cache, rebuild pipeline
      const shaderChanged = this.shaderCache.get(nodeId) !== shaderCode;
      if (shaderChanged || !cached) {
        cached = await this._buildPipeline(nodeId, shaderCode, width, height);
        // Store the uniformManager with the cached pipeline so we can write parameters correctly
        cached.uniformManager = uniformManager;
        this.textureCache.set(cacheKey, cached);
        this.shaderCache.set(nodeId, shaderCode);
      }

      if (!cached || !cached.pipeline) {

        return this._createFallbackTexture(width, height);
      }

      // Store node reference for parameter updates
      cached.node = node;

      // Render to the texture (using external encoder if provided)
      await this._renderToTexture(cached, time, width, height, audioContext, externalEncoder);


      return cached.texture;
    } catch (error) {

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
      const { wgsl, uniformManager } = buildWGSL(subgraph, { skipCacheClear: true });

      if (!wgsl || wgsl.trim() === '') {
        return null;
      }

      // Return both WGSL and uniformManager so we can write parameters in the correct order
      return { wgsl, uniformManager };
    } catch (error) {

      return null;
    }
  }

  /**
   * Extract a subgraph containing a node and all its dependencies
   * Includes compute nodes so they can be referenced as texture samplers
   * The skipCacheClear flag prevents infinite loops during compilation
   * @private
   */
  _extractSubgraph(targetNode) {
    const subgraphNodes = [];
    const visited = new Set();

    const addNodeWithDependencies = (node) => {
      if (!node || visited.has(node.id)) return;
      visited.add(node.id);

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

      // Add the node itself (including compute nodes, which will be compiled as texture samplers)
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
        height,
        bindingMap,  // Store for recreating bind groups
        layouts      // Store layouts for recreating bind groups
      };
    } catch (error) {

      return null;
    }
  }

  /**
   * Rebuild bind groups with current compute textures
   * This ensures fragment shaders get the latest compute node outputs
   * @private
   */
  _rebuildBindGroups(cached) {
    try {
      console.log('[FragmentTextureRenderer] _rebuildBindGroups called');

      if (!cached.bindingMap || !cached.layouts) {
        console.warn('[FragmentTextureRenderer] No bindingMap or layouts, skipping rebuild');
        return; // Old cached data, can't rebuild
      }

      const bindingMap = cached.bindingMap;
      const groupIndices = Object.keys(bindingMap.groups).map(Number).sort((a, b) => a - b);
      const newBindGroups = [];

      console.log('[FragmentTextureRenderer] Rebuilding', groupIndices.length, 'bind groups');

      for (let i = 0; i < groupIndices.length; i++) {
        const groupIndex = groupIndices[i];
        const bindings = bindingMap.groups[groupIndex];
        const resources = [];

        for (const bindingKey of Object.keys(bindings)) {
          const binding = parseInt(bindingKey, 10);
          const meta = bindings[binding];

          // Create resource (this will now get current compute textures)
          const resource = this._createResource(meta, cached.uniformBuffers);
          resources.push({ binding, resource });
        }

        // Create new bind group with updated resources
        const bindGroup = this.device.createBindGroup({
          layout: cached.layouts[i],
          entries: resources
        });
        newBindGroups.push(bindGroup);
      }

      // Update cached bind groups
      cached.bindGroups = newBindGroups;
      console.log('[FragmentTextureRenderer] Bind groups rebuilt successfully');
    } catch (error) {
      console.error('[FragmentTextureRenderer] Error rebuilding bind groups:', error);
    }
  }

  /**
   * Render to texture using the pipeline
   * @private
   */
  async _renderToTexture(cached, time, width, height, audioContext, externalEncoder = null) {
    try {
      // Rebuild bind groups with current compute textures BEFORE rendering
      // This ensures we use the latest compute node outputs
      this._rebuildBindGroups(cached);

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

        } else {

          // Fallback: Longer delay to give GPU time to finish
          // 100ms should be more than enough for most GPUs
          await new Promise(resolve => setTimeout(resolve, 100));

        }

        // Debug: Log texture details after render

      } else {

      }
    } catch (error) {

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
        // Reuse existing uniform buffer if available
        const existingBuffer = uniformBuffers.get(meta.varName);
        if (existingBuffer) {
          return { buffer: existingBuffer };
        }

        let size = 64; // Default size

        if (meta.varName === 'u') {
          // Aspect is a single float; allocate one vec4 (16 bytes) for alignment
          size = 16;
        } else if (meta.varName === 'g') {
          // Globals store resolution.xy, time, and 5 audio envelope values (8 floats total)
          size = 32;
        } else if (meta.varName === 'u_params') {
          // CRITICAL: Calculate parameter buffer size dynamically from uniformManager
          // This prevents "buffer too small" errors when fragment graphs have many parameters
          // Use the global uniformManager (which accumulates parameters from subgraph compilation)
          const uniformManager = window.nodeCompiler?.uniformManager;
          if (uniformManager && uniformManager.uniformValues.size > 0) {
            const numParams = uniformManager.uniformValues.size;
            // Each parameter is 4 bytes (f32), round up to 16-byte alignment
            size = Math.max(16, Math.ceil(numParams * 4 / 16) * 16);

          }
        }

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
        // Check if this is a compute node texture (format: compute_node_X or compute_node_X_Y)
        if (meta.varName && meta.varName.startsWith('compute_')) {
          // Extract node ID from variable name (e.g., "compute_node_5" -> "node_5")
          const nodeId = meta.varName.replace('compute_', '');

          console.log('[FragmentTextureRenderer] Looking for compute texture:', nodeId);
          console.log('[FragmentTextureRenderer] Available in nodeOutputs:', window.computeExecutor ? Array.from(window.computeExecutor.nodeOutputs.keys()) : 'no executor');
          console.log('[FragmentTextureRenderer] Available in computeTextures:', window.computeExecutor ? Array.from(window.computeExecutor.computeTextures.keys()) : 'no executor');

          // Try to get the actual compute node output texture from ComputeExecutor
          if (window.computeExecutor && window.computeExecutor.nodeOutputs) {
            const computeTexture = window.computeExecutor.nodeOutputs.get(nodeId);
            if (computeTexture) {
              console.log('[FragmentTextureRenderer] Found texture in nodeOutputs for', nodeId);
              return computeTexture.createView();
            }
          }

          // Fallback: try to get from computeTextures registry
          if (window.computeExecutor && window.computeExecutor.computeTextures) {
            const textureData = window.computeExecutor.computeTextures.get(nodeId);
            if (textureData && textureData.texture) {
              console.log('[FragmentTextureRenderer] Found texture in computeTextures for', nodeId);
              return textureData.texture.createView();
            }
          }

          console.warn('[FragmentTextureRenderer] Could not find compute texture for', nodeId, '- using fallback');
        }

        // Create dummy 1x1 texture for regular textures or if compute texture not found
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
    // Use the uniformManager that was stored when compiling this fragment shader
    // to ensure parameters are written in the same order the shader expects
    const paramsBuffer = uniformBuffers.get('u_params');
    if (paramsBuffer && cached.uniformManager && cached.uniformManager.uniformValues.size > 0) {
      // Get parameter values in the order uniformManager assigned them (matching the shader)
      // This is critical - using Object.entries(node.params) would give wrong order!
      const values = Array.from(cached.uniformManager.uniformValues.values());
      const data = new Float32Array(values);

      this.device.queue.writeBuffer(paramsBuffer, 0, data.buffer, 0, data.byteLength);
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
