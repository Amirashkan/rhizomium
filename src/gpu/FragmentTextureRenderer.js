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
import { shaderModuleCache, hashWGSL } from './ShaderModuleCache.js';

export class FragmentTextureRenderer {
  constructor(device) {
    this.device = device;
    this.format = 'rgba8unorm'; // Standard texture format

    // Cache: nodeId -> { texture, pipeline, bindGroups, lastTime }
    this.textureCache = new Map();

    // Cache: nodeId -> shader code (for detecting changes)
    this.shaderCache = new Map();

    // PERFORMANCE: Use centralized shader module cache to avoid recompiling identical WGSL
    this.shaderModuleCache = shaderModuleCache;

    // PERFORMANCE: Track parameter hashes to avoid unnecessary renders
    // Only re-render fragment nodes when inputs/parameters actually change
    this.parameterHashes = new Map(); // nodeId -> hash string

    // SECOND MONITOR: when the second-monitor receiver re-renders a fragment node
    // that feeds compute, it injects the editor's already-evaluated u_params bytes
    // instead of letting _updateUniforms re-derive them from this window's state
    // (which differs — independent clock, no audio). Consistent with the compute
    // path's externalUniformMode / writeRawComputeUniforms. Off in the editor.
    this.externalUniformMode = false;
    this.externalUniforms = new Map(); // nodeId -> Float32Array (evaluated u_params)
  }

  /**
   * Clear fragment texture cache
   * Call this when graph structure changes (nodes added/removed, connections changed)
   */
  clearCache() {
    const textures = [...this.textureCache.values()].map(c => c.texture).filter(Boolean);
    if (textures.length) {
      const ce = window.computeExecutor;
      if (ce?._deferDestroy) {
        ce._deferDestroy(() => { for (const t of textures) { try { t.destroy(); } catch (_) {} } });
      } else {
        setTimeout(() => { for (const t of textures) { try { t.destroy(); } catch (_) {} } }, 0);
      }
    }
    this.textureCache.clear();
    this.shaderCache.clear();
    this.parameterHashes.clear();
  }

  /**
   * Render a fragment node and its dependencies to a texture
   * @param {string} nodeId - The node to render
   * @param {number} width - Texture width
   * @param {number} height - Texture height
   * @param {number} time - Current time in seconds
   * @param {Object} audioContext - Audio envelope values
   * @param {GPUCommandEncoder} externalEncoder - Optional external command encoder (for synchronization)
   * @param {boolean} force - Skip the change-detection heuristic and always re-render. Used by
   *        the per-node preview path: preview updates are event-driven (a param/connection/time
   *        change already happened), and _checkFragmentNodeNeedsRender only hashes the node's OWN
   *        params, so it would wrongly skip re-rendering a node whose UPSTREAM input changed.
   * @returns {GPUTexture} The rendered texture
   */
  async renderNodeToTexture(nodeId, width, height, time = 0, audioContext = {}, externalEncoder = null, force = false) {
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
        cached = await this._buildPipeline(nodeId, shaderCode, width, height, uniformManager);
        this.textureCache.set(cacheKey, cached);
        this.shaderCache.set(nodeId, shaderCode);
        // New texture is empty — force a render even if params haven't changed.
        // Without this, a resolution change creates a fresh empty texture but
        // _checkFragmentNodeNeedsRender returns false (same params as before) and
        // the empty texture is used as input to downstream compute nodes → black.
        this.parameterHashes.delete(nodeId);
      }

      if (!cached || !cached.pipeline) {

        return this._createFallbackTexture(width, height);
      }

      // Refresh the uniform snapshot on every call: _compileNodeToShader rebuilds
      // it each frame (detached from the shared manager), so this keeps parameter
      // values current for _updateUniforms while preserving the field order the
      // cached pipeline's struct was compiled with.
      cached.uniformManager = uniformManager;

      // Store node reference for parameter updates
      cached.node = node;

      // PERFORMANCE: Check if fragment node actually needs re-rendering
      // Only render if parameters/inputs changed or if node is time-dependent
      // (force=true bypasses this for the preview path — see param docs above)
      const needsRender = force || this._checkFragmentNodeNeedsRender(nodeId, node, time, audioContext);
      
      if (needsRender) {
        // Render to the texture (using external encoder if provided)
        await this._renderToTexture(cached, time, width, height, audioContext, externalEncoder);
      }
      // If no render needed, return cached texture (unchanged)

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
  async _buildPipeline(nodeId, shaderCode, width, height, uniformManager = null) {
    try {
      // PERFORMANCE: Use shader module cache to avoid recompiling identical WGSL
      // CRITICAL FIX: Cache is now device-specific - pass device to get/set
      const wgslHash = hashWGSL(shaderCode, false);
      let shaderModule = this.shaderModuleCache.get(this.device, wgslHash);
      
      if (!shaderModule) {
        // Create shader module if not cached
        shaderModule = this.device.createShaderModule({
          code: shaderCode,
          label: `fragment-texture-shader-${nodeId}`
        });
        this.shaderModuleCache.set(this.device, wgslHash, shaderModule);
      }

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
      const { layouts, bindGroups, uniformBuffers } = this._createBindResources(bindingMap, uniformManager);

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
   * Check if fragment node needs re-rendering
   * Only render when parameters/inputs actually change or node is time-dependent
   * @private
   */
  _checkFragmentNodeNeedsRender(nodeId, node, time, audioContext) {
    // Always render on first call (no hash exists yet)
    const previousHash = this.parameterHashes.get(nodeId);
    if (!previousHash) {
      // Build initial hash
      const hash = this._buildFragmentNodeHash(node, time, audioContext);
      this.parameterHashes.set(nodeId, hash);
      return true;
    }

    // Check if node has time-dependent parameters
    if (this._hasTimeDependentParameters(node)) {
      // Time-dependent nodes need to render every frame
      const hash = this._buildFragmentNodeHash(node, time, audioContext);
      this.parameterHashes.set(nodeId, hash);
      return true;
    }

    // Check if parameters or inputs changed
    const currentHash = this._buildFragmentNodeHash(node, time, audioContext);
    if (currentHash !== previousHash) {
      this.parameterHashes.set(nodeId, currentHash);
      return true;
    }

    // Check if compute node inputs changed (via compute executor)
    if (node.inputs && Array.isArray(node.inputs)) {
      const computeExecutor = window.computeExecutor;
      if (computeExecutor && computeExecutor.fragmentNodesRenderedThisFrame) {
        // If any compute node input was re-rendered this frame, we need to re-render
        for (const inputId of node.inputs) {
          if (inputId && computeExecutor.fragmentNodesRenderedThisFrame.has(inputId)) {
            return true;
          }
          // Check if compute node input was dispatched
          if (inputId && computeExecutor.computeManagers && computeExecutor.computeManagers.has(inputId)) {
            if (computeExecutor.dispatchedThisFrame && computeExecutor.dispatchedThisFrame.has(inputId)) {
              return true;
            }
          }
        }
      }
    }

    // No changes detected, skip render
    return false;
  }

  /**
   * Build hash of fragment node parameters and inputs
   * PERFORMANCE: Optimized to avoid expensive JSON.stringify calls
   * @private
   */
  _buildFragmentNodeHash(node, time, audioContext) {
    // PERFORMANCE: Use simple string concatenation instead of JSON.stringify
    // JSON.stringify is expensive and can cause frame time spikes
    let hash = '';

    // Bypass state changes the compiled subgraph (a bypassed node passes its input
    // straight through), so it must invalidate the per-node render cache.
    if (node.bypassed) hash += 'bypass;';

    // Hash parameters (fast string concatenation instead of JSON.stringify)
    if (node.params) {
      // Build hash from parameter values directly without JSON.stringify
      for (const key in node.params) {
        if (node.params.hasOwnProperty(key)) {
          const value = node.params[key];
          // Convert value to string quickly
          if (typeof value === 'string') {
            hash += `${key}:${value};`;
          } else if (typeof value === 'number') {
            hash += `${key}:${value};`;
          } else if (Array.isArray(value)) {
            hash += `${key}:[${value.join(',')}];`;
          } else if (value && typeof value === 'object') {
            // For objects, use a simple representation
            hash += `${key}:obj;`;
          }
        }
      }
    }

    // Hash inputs (texture references)
    if (node.inputs && Array.isArray(node.inputs)) {
      const computeExecutor = window.computeExecutor;
      for (const inputId of node.inputs) {
        if (inputId) {
          // Check if input is a compute node
          if (computeExecutor && computeExecutor.computeManagers && computeExecutor.computeManagers.has(inputId)) {
            const texture = computeExecutor.nodeOutputs?.get(inputId);
            // Use texture reference as part of hash (texture object identity)
            hash += `${inputId}:${texture ? 'computed' : 'missing'};`;
          } else {
            // Regular fragment input
            hash += `${inputId}:fragment;`;
          }
        }
      }
    }

    return hash;
  }

  /**
   * Check if fragment node has time-dependent parameters
   * @private
   */
  _hasTimeDependentParameters(node) {
    if (!node || !node.params) return false;

    for (const value of Object.values(node.params)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // Check if parameter contains time or audio envelope references
        if (/time|audioEnvelope/i.test(trimmed)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Rebuild bind groups with current compute textures
   * This ensures fragment shaders get the latest compute node outputs
   * @private
   */
  _rebuildBindGroups(cached) {
    if (!cached.bindingMap || !cached.layouts) {
      return; // Old cached data, can't rebuild
    }

    const bindingMap = cached.bindingMap;
    const groupIndices = Object.keys(bindingMap.groups).map(Number).sort((a, b) => a - b);
    const newBindGroups = [];

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

        // PERFORMANCE: Don't wait for GPU to finish - let it run asynchronously
        // The command buffer is submitted, GPU will process it
        // Waiting here causes frame time variance and stutters
        // Compute shaders will wait for dependencies via proper GPU synchronization
        // CRITICAL: Removed await to prevent blocking render loop
        // GPU command buffer submission is sufficient - GPU handles synchronization
        // If we need to wait, it should be done at the compute shader level, not here
        // NOTE: This is safe because we're using the same command encoder, so GPU
        // will execute commands in order and handle synchronization automatically

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
  _createBindResources(bindingMap, uniformManager = null) {
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
        const resource = this._createResource(meta, uniformBuffers, uniformManager);
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
  _createResource(meta, uniformBuffers, uniformManager = null) {
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
          // CRITICAL: Size from the subgraph's own uniform snapshot so the buffer
          // always matches the ParamUniforms struct compiled for THIS pipeline.
          // The global manager reflects the main graph and can be larger or smaller.
          const um = uniformManager || window.nodeCompiler?.uniformManager;
          if (um && um.uniformValues.size > 0) {
            const numParams = um.uniformValues.size;
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
        // Check if this is a sampler for a Texture2D/TextureCube node - look up actual sampler
        if (meta.varName) {
          // Extract node ID from sampler variable name (e.g., "sampler_27" or "samplerCube_27")
          const sanitizedId = meta.varName.replace(/^(sampler_|samplerCube_)/, '');

          // Try to get actual sampler from TextureManager
          const texManager = window.editor?.textureManager || window.textureManager;
          if (texManager) {
            // Try gpuTextures map first
            if (texManager.gpuTextures?.get) {
              const gpuInfo = texManager.gpuTextures.get(sanitizedId);
              if (gpuInfo && gpuInfo.sampler) {
                return gpuInfo.sampler;
              }
            }

            // Try getTexture method
            if (typeof texManager.getTexture === "function") {
              const textureInfo = texManager.getTexture(sanitizedId);
              if (textureInfo && textureInfo.sampler) {
                return textureInfo.sampler;
              }
            }

            // Try iterating through textures map
            if (texManager.textures) {
              for (const [nodeId, info] of texManager.textures.entries()) {
                const nodeSanitizedId = nodeId.replace(/[^a-zA-Z0-9_]/g, "_");
                if (nodeSanitizedId === sanitizedId && info.sampler) {
                  return info.sampler;
                }
              }
            }

            // Try iterating through gpuTextures map
            if (texManager.gpuTextures) {
              for (const [nodeId, info] of texManager.gpuTextures.entries()) {
                const nodeSanitizedId = nodeId.replace(/[^a-zA-Z0-9_]/g, "_");
                if (nodeSanitizedId === sanitizedId && info.sampler) {
                  return info.sampler;
                }
              }
            }
          }
        }

        // Create default sampler as fallback
        const sampler = this.device.createSampler({
          magFilter: 'linear',
          minFilter: 'linear'
        });
        return sampler;
      }
      case 'texture-2d':
      case 'texture-cube': {
        // Check if this is a compute node texture (format: compute_node_X)
        if (meta.varName && meta.varName.startsWith('compute_node_')) {
          // Extract sanitized node ID from variable name (e.g., "compute_node_27" -> "27")
          // Note: TextureBindings.js already stripped the "node_" prefix, so we get the raw number
          const nodeId = meta.varName.replace('compute_node_', '');

          // Try to get the actual compute node output texture from ComputeExecutor
          if (window.computeExecutor && window.computeExecutor.nodeOutputs) {
            const computeTexture = window.computeExecutor.nodeOutputs.get(nodeId);
            if (computeTexture) {
              return computeTexture.createView();
            }
          }

          // Fallback: try to get from computeTextures registry
          if (window.computeExecutor && window.computeExecutor.computeTextures) {
            const textureData = window.computeExecutor.computeTextures.get(nodeId);
            if (textureData && textureData.texture) {
              return textureData.texture.createView();
            }
          }
        }

        // Check if this is a regular Texture2D or TextureCube node - look up actual texture
        if (meta.varName) {
          // Extract node ID from texture variable name (e.g., "texture_27" -> "27")
          const sanitizedId = meta.varName.replace(/^(texture_|textureCube_)/, '');

          // Try to get actual texture from TextureManager
          const texManager = window.editor?.textureManager || window.textureManager;
          if (texManager) {
            // Try gpuTextures map first
            if (texManager.gpuTextures?.get) {
              const gpuInfo = texManager.gpuTextures.get(sanitizedId);
              if (gpuInfo && gpuInfo.textureView) {
                return gpuInfo.textureView;
              }
            }

            // Try getTexture method
            if (typeof texManager.getTexture === "function") {
              const textureInfo = texManager.getTexture(sanitizedId);
              if (textureInfo && textureInfo.textureView) {
                return textureInfo.textureView;
              }
            }

            // Try iterating through textures map
            if (texManager.textures) {
              for (const [nodeId, info] of texManager.textures.entries()) {
                const nodeSanitizedId = nodeId.replace(/[^a-zA-Z0-9_]/g, "_");
                if (nodeSanitizedId === sanitizedId && info.textureView) {
                  return info.textureView;
                }
              }
            }

            // Try iterating through gpuTextures map
            if (texManager.gpuTextures) {
              for (const [nodeId, info] of texManager.gpuTextures.entries()) {
                const nodeSanitizedId = nodeId.replace(/[^a-zA-Z0-9_]/g, "_");
                if (nodeSanitizedId === sanitizedId && info.textureView) {
                  return info.textureView;
                }
              }
            }
          }
        }

        // Create dummy 1x1 texture as fallback if texture not found
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
    if (paramsBuffer) {
      // SECOND MONITOR: prefer the editor's injected, already-evaluated bytes. They
      // are packed in the SAME field order this window's buildWGSL produced (both run
      // the same codegen over the same reconstructed subgraph), so a raw copy lines
      // up with the compiled ParamUniforms struct.
      const injected = this.externalUniformMode && cached.node
        ? this.externalUniforms.get(cached.node.id)
        : null;
      let data = null;
      if (injected && injected.length > 0) {
        data = injected;
      } else if (cached.uniformManager && cached.uniformManager.uniformValues.size > 0) {
        // Get parameter values in the order uniformManager assigned them (matching the shader)
        // This is critical - using Object.entries(node.params) would give wrong order!
        data = new Float32Array(Array.from(cached.uniformManager.uniformValues.values()));
      }
      if (data) {
        // Never write past the buffer: a transient size mismatch (snapshot updated
        // before the pipeline rebuilds) would otherwise fail validation every frame.
        const writeBytes = Math.min(data.byteLength, paramsBuffer.size);
        this.device.queue.writeBuffer(paramsBuffer, 0, data.buffer, data.byteOffset || 0, writeBytes);
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
    const textures = [...this.textureCache.values()].map(c => c.texture).filter(Boolean);
    if (textures.length) {
      const ce = window.computeExecutor;
      if (ce?._deferDestroy) {
        ce._deferDestroy(() => { for (const t of textures) { try { t.destroy(); } catch (_) {} } });
      } else {
        setTimeout(() => { for (const t of textures) { try { t.destroy(); } catch (_) {} } }, 0);
      }
    }
    this.textureCache.clear();
    this.shaderCache.clear();
  }

  /**
   * Remove a specific node from cache
   */
  invalidateNode(nodeId) {
    const keysToDelete = [];
    for (const [key] of this.textureCache.entries()) {
      if (key.startsWith(`${nodeId}_`)) keysToDelete.push(key);
    }

    const textures = keysToDelete.map(k => this.textureCache.get(k)?.texture).filter(Boolean);
    if (textures.length) {
      const ce = window.computeExecutor;
      if (ce?._deferDestroy) {
        ce._deferDestroy(() => { for (const t of textures) { try { t.destroy(); } catch (_) {} } });
      } else {
        setTimeout(() => { for (const t of textures) { try { t.destroy(); } catch (_) {} } }, 0);
      }
    }

    for (const key of keysToDelete) this.textureCache.delete(key);
    this.shaderCache.delete(nodeId);
  }
}
