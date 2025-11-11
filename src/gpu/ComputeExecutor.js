/**
 * ComputeExecutor
 * Manages execution of compute shader nodes in the node graph with dependency-aware execution
 *
 * Features:
 * - Topological sort: Executes compute nodes in dependency order (inputs before outputs)
 * - Output dictionary: Maintains a map of node outputs for propagation to dependent nodes
 * - Fallback values: Provides default textures for nodes that haven't been computed yet
 * - Change detection: Only re-dispatches nodes when inputs or parameters change
 * - Flexible API: Supports both ComputeNodeBase (unified API) and legacy ComputeShaderManager
 *
 * Execution Flow:
 * 1. Initialize: Create fallback texture, load compute nodes, compute execution order
 * 2. Execute: Dispatch nodes in topological order, update output dictionary after each dispatch
 * 3. Propagate: Provide computed outputs (or fallbacks) to dependent nodes
 *
 * Data Structures:
 * - nodeOutputs: Map<nodeId, GPUTexture> - Stores computed outputs for propagation
 * - executionOrder: Array<nodeId> - Topologically sorted node IDs for execution
 * - fallbackTexture: GPUTexture - 1x1 black texture used when dependencies aren't ready
 * - inputHashes: Map<nodeId, string> - Tracks input/parameter changes for selective updates
 */

import { ComputeShaderManager } from './ComputeShaderManager.js';
import { ComputeNodeBase } from './ComputeNodeBase.js';
import { FragmentTextureRenderer } from './FragmentTextureRenderer.js';

export class ComputeExecutor {
  constructor(device) {
    this.device = device;

    // Map of nodeId -> ComputeShaderManager or ComputeNodeBase
    this.computeManagers = new Map();

    // Map of nodeId -> ComputeNodeBase (for unified API nodes)
    this.computeNodes = new Map();

    // Map of nodeId -> { texture, sampler, bindGroup }
    this.computeTextures = new Map();

    // Map of nodeId -> input hash for detecting changes
    this.inputHashes = new Map();

    // Output dictionary for propagation (nodeId -> output texture)
    this.nodeOutputs = new Map();

    // Fallback texture for uncomputed nodes
    this.fallbackTexture = null;

    // Cached execution order
    this.executionOrder = [];

    // Track initialization state
    this.initialized = false;

    // Profiler reference (injected)
    this.profiler = null;

    // Fragment texture renderer for auto-bridging fragment→compute connections
    this.fragmentRenderer = new FragmentTextureRenderer(device);

    // Track which fragment nodes have been rendered this frame
    this.renderedFragmentNodes = new Set();

    // Re-entrancy guard: Prevent execute() from being called while already executing
    // This prevents infinite loops when auto-bridging or other side effects trigger renders
    this._isExecuting = false;
  }

  /**
   * Clear fragment render cache
   * Call this when graph structure changes (nodes added/removed, connections changed)
   */
  clearFragmentCache() {
    this.renderedFragmentNodes.clear();
    if (this.fragmentRenderer && this.fragmentRenderer.textureCache) {
      this.fragmentRenderer.textureCache.clear();
      this.fragmentRenderer.shaderCache.clear();
    }
  }

  /**
   * Initialize compute nodes from registry
   */
  async initialize() {
    if (!window.computeNodeRegistry || window.computeNodeRegistry.size === 0) {
      return;
    }

    // Create fallback texture
    this.createFallbackTexture();

    for (const [nodeId, nodeData] of window.computeNodeRegistry) {
      await this.initializeComputeNode(nodeId, nodeData);
    }

    // Compute execution order after all nodes are initialized
    this.updateExecutionOrder();

    this.initialized = true;
  }

  /**
   * Initialize a single compute node
   */
  async initializeComputeNode(nodeId, nodeData) {
    try {
      const { node, wgslCode, resolution, supportsFeedback } = nodeData;

      // Detect if this node needs input textures from other compute nodes
      // Check both the node definition (how many inputs it's designed for) and actual connections
      // Nodes like ComputeBlur and ComputeFeedback are designed to take inputs
      //
      // IMPORTANT: When adding a new compute node that requires input textures,
      // you MUST add its name to this list. Otherwise, the bind group layout won't
      // include bindings for @binding(2) inputTexture and @binding(3) texSampler,
      // causing WebGPU validation errors like "Binding doesn't exist in BindGroupLayoutInternal"
      const nodeDesignedForInput = ['ComputeBlur', 'ComputeFeedback', 'ComputeFeedbackField',
                                     'ComputeConvolution', 'ComputeFluidSim', 'ComputeParticles',
                                     'ComputeThreshold', 'ComputeColorAdjust', 'ComputeEdgeDetect',
                                     'ComputeMorphology', 'ComputeWarp', 'ComputeKaleidoscope', 'ComputeGlitch', 'ComputeMix', 'ComputeTransform', 'ComputeChannels', 'ComputeHSV', 'ComputeHistogram', 'ComputeLuminance'].includes(node.kind);
      const needsInput = nodeDesignedForInput;

      // Create compute shader manager with node reference for parameters
      const manager = new ComputeShaderManager(this.device, node);
      await manager.initialize(wgslCode, resolution[0], resolution[1], supportsFeedback, needsInput);

      // Store manager
      this.computeManagers.set(nodeId, manager);

      // Create sampler for this texture
      const sampler = this.device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'repeat'
      });

      // Get output texture
      const outputTexture = manager.getOutputTexture();
      if (!outputTexture) {
        throw new Error(`Manager failed to create output texture for ${nodeId}`);
      }

      // Store texture and sampler
      this.computeTextures.set(nodeId, {
        texture: outputTexture,
        sampler,
        manager
      });
    } catch (error) {
      console.error(`[ComputeExecutor] ❌ FAILED to initialize node ${nodeId}:`, error);
      console.error(`[ComputeExecutor] ❌ WGSL shader code that failed:`, nodeData.wgslCode);
      // Re-throw to make the error more visible
      throw error;
    }
  }

  /**
   * Create fallback texture for uncomputed nodes
   */
  createFallbackTexture() {
    // Create a small 1x1 black texture as fallback
    const fallbackData = new Uint8Array([0, 0, 0, 255]); // Black pixel

    this.fallbackTexture = this.device.createTexture({
      size: { width: 1, height: 1, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });

    this.device.queue.writeTexture(
      { texture: this.fallbackTexture },
      fallbackData,
      { bytesPerRow: 4 },
      { width: 1, height: 1 }
    );
  }

  /**
   * Update execution order using topological sort
   */
  updateExecutionOrder() {
    if (!window.graph || !window.graph.nodes) {
      console.warn('[ComputeExecutor] No graph available for execution order');
      this.executionOrder = Array.from(this.computeManagers.keys());
      return;
    }

    try {
      // Filter to only compute nodes
      const computeNodeIds = new Set(this.computeManagers.keys());
      const computeNodes = window.graph.nodes.filter(node =>
        node && node.id && computeNodeIds.has(node.id)
      );

      if (computeNodes.length === 0) {
        this.executionOrder = [];
        return;
      }

      // Build dependency graph
      const byId = new Map();
      for (const node of computeNodes) {
        byId.set(node.id, node);
      }

      // Topological sort using DFS
      const visited = new Set();
      const visiting = new Set();
      const result = [];

      const visit = (id) => {
        if (!id || visited.has(id)) return;

        if (visiting.has(id)) {
          console.warn(`[ComputeExecutor] Circular dependency detected involving node: ${id}`);
          return;
        }

        visiting.add(id);

        const node = byId.get(id);
        if (!node) {
          visiting.delete(id);
          return;
        }

        // Visit dependencies first (inputs)
        if (node.inputs && Array.isArray(node.inputs)) {
          for (const inputId of node.inputs) {
            if (inputId !== null && inputId !== undefined && computeNodeIds.has(inputId)) {
              visit(inputId);
            }
          }
        }

        visiting.delete(id);
        visited.add(id);
        result.push(id);
      };

      // Visit all compute nodes
      for (const node of computeNodes) {
        visit(node.id);
      }

      this.executionOrder = result;
    } catch (error) {
      console.error('[ComputeExecutor] Error computing execution order:', error);
      this.executionOrder = Array.from(this.computeManagers.keys());
    }
  }

  /**
   * Set profiler for performance tracking
   */
  setProfiler(profiler) {
    this.profiler = profiler;
  }

  /**
   * Render fragment node inputs to textures (auto-bridging)
   * This enables fragment nodes to be used as inputs to compute nodes
   * @param {GPUCommandEncoder} commandEncoder - Shared command encoder for synchronization
   * @param {number} time - Current time in seconds
   * @param {Object} audioContext - Audio envelope values
   */
  async _renderFragmentInputs(commandEncoder, time, audioContext) {
    if (!window.graph || !window.graph.nodes) {
      return;
    }

    // DON'T clear renderedFragmentNodes - it causes fragment nodes to re-render every frame!
    // Fragment textures are cached by FragmentTextureRenderer and only rebuild when shaders change
    // Clearing this set every frame defeats the caching and causes infinite rendering loops
    // this.renderedFragmentNodes.clear();

    // Check each compute node for fragment inputs
    for (const nodeId of this.executionOrder) {
      const manager = this.computeManagers.get(nodeId);
      if (!manager) continue;

      // Get the node data
      const nodeData = window.computeNodeRegistry?.get(nodeId);
      const node = nodeData?.node;
      if (!node || !node.inputs || !Array.isArray(node.inputs)) continue;

      // Check each input
      for (const inputNodeId of node.inputs) {
        if (inputNodeId === null || inputNodeId === undefined) continue;

        // Skip if already rendered this frame
        if (this.renderedFragmentNodes.has(inputNodeId)) continue;

        // Check if this input is a fragment node (not a compute node)
        const isComputeNode = this.computeManagers.has(inputNodeId);
        if (isComputeNode) continue;

        // Check if the node exists in the graph
        const inputNode = window.graph.getNode(inputNodeId);
        if (!inputNode) {
          continue;
        }

        // This is a fragment node being used as compute input!
        // Log only once per node to reduce spam
        if (!this._loggedAutoBridge) this._loggedAutoBridge = new Set();
        if (!this._loggedAutoBridge.has(inputNodeId)) {
          console.log(`[ComputeExecutor] Auto-bridging: Fragment node ${inputNodeId} (${inputNode.kind}) → Compute node ${nodeId}`);
          this._loggedAutoBridge.add(inputNodeId);
        }

        try {
          // Use the same resolution as the compute node
          const resolution = nodeData.resolution || [512, 512];
          const width = resolution[0];
          const height = resolution[1];

          // Render the fragment node to a texture using the SHARED command encoder
          // This ensures fragment render and compute dispatch are in the same GPU submission
          const texture = await this.fragmentRenderer.renderNodeToTexture(
            inputNodeId,
            width,
            height,
            time,
            audioContext,
            commandEncoder  // CRITICAL: Pass the shared encoder for synchronization!
          );

          if (texture) {
            // Store in nodeOutputs so ComputeExecutor can find it
            this.nodeOutputs.set(inputNodeId, texture);
            this.renderedFragmentNodes.add(inputNodeId);
            // Success - no need to log every frame
          } else {
            console.warn(`[ComputeExecutor] Auto-bridge failed: No texture returned for fragment node ${inputNodeId}`);
          }
        } catch (error) {
          console.error(`[ComputeExecutor] Error rendering fragment input ${inputNodeId}:`, error);
        }
      }
    }
  }

  /**
   * Execute all compute shaders
   * Should be called before fragment shader execution
   * @param {GPUCommandEncoder} commandEncoder - WebGPU command encoder
   * @param {number} time - Current time in seconds
   * @param {Object} audioContext - Audio envelope values for expression evaluation
   */
  async execute(commandEncoder, time = 0, audioContext = {}) {
    // CRITICAL: Re-entrancy guard to prevent infinite loops
    // If execute() is called while already executing (e.g., from auto-bridging side effects),
    // skip this call to break the infinite loop
    if (this._isExecuting) {
      console.warn('[ComputeExecutor] ⚠️ execute() called while already executing - skipping to prevent infinite loop');
      return;
    }

    if (!this.initialized || this.computeManagers.size === 0) {
      console.log(`[ComputeExecutor] Skipping execute: initialized=${this.initialized}, managers=${this.computeManagers.size}`);
      return;
    }

    // Set the executing flag
    this._isExecuting = true;

    try {
      // Reduce logging spam - only log occasionally
      if (!this._lastExecuteLog || Date.now() - this._lastExecuteLog > 5000) {
        console.log(`[ComputeExecutor] Executing ${this.executionOrder.length} compute nodes`);
        this._lastExecuteLog = Date.now();
      }

      // STEP 1: Render fragment node inputs to textures (auto-bridging)
      // Pass the shared command encoder so fragment renders and compute dispatches
      // are in the same GPU command buffer submission (proper synchronization!)
      await this._renderFragmentInputs(commandEncoder, time, audioContext);

    // STEP 2: Execute compute nodes in topological order (dependencies first)
    for (const nodeId of this.executionOrder) {
      const manager = this.computeManagers.get(nodeId);
      if (!manager) {
        console.warn(`[ComputeExecutor] Node ${nodeId} in execution order but not in managers`);
        continue;
      }

      try {
        // Get node data to check if it's time-dependent
        const nodeData = window.computeNodeRegistry?.get(nodeId);
        const node = nodeData?.node;

        // Set input texture if this node needs it
        if (node?.inputs && Array.isArray(node.inputs) && node.inputs.length > 0) {
          const inputNodeId = node.inputs[0];
          if (inputNodeId !== null && inputNodeId !== undefined) {
            const inputTexture = this.nodeOutputs.get(inputNodeId);
            if (inputTexture) {
              if (manager.setInputTexture) {
                manager.setInputTexture(inputTexture);
                // Recreate bind group with new input texture
                if (manager.recreateBindGroup) {
                  manager.recreateBindGroup();
                }
              }
            } else if (!inputTexture) {
              // Only log missing textures once to avoid spam
              if (!this._loggedMissingTextures) this._loggedMissingTextures = new Set();
              if (!this._loggedMissingTextures.has(inputNodeId)) {
                console.warn(`[ComputeExecutor] ⚠️ Input texture not found for ${inputNodeId}, using fallback`);
                console.warn(`[ComputeExecutor] ⚠️ Available nodeOutputs keys:`, Array.from(this.nodeOutputs.keys()));
                this._loggedMissingTextures.add(inputNodeId);
              }
            }
          }

          // Special case: ComputeWarp has a second input (warp field)
          if (node.kind === 'ComputeWarp' && node.inputs.length > 1) {
            const warpFieldNodeId = node.inputs[1];
            if (warpFieldNodeId !== null && warpFieldNodeId !== undefined) {
              const warpFieldTexture = this.nodeOutputs.get(warpFieldNodeId);
              if (warpFieldTexture && manager.setWarpFieldTexture) {
                manager.setWarpFieldTexture(warpFieldTexture);
              } else if (!warpFieldTexture) {
                if (!this._loggedMissingTextures) this._loggedMissingTextures = new Set();
                if (!this._loggedMissingTextures.has(warpFieldNodeId)) {
                  console.warn(`[ComputeExecutor] ⚠️ Warp field texture not found for ${warpFieldNodeId}, using fallback`);
                  this._loggedMissingTextures.add(warpFieldNodeId);
                }
              }
            }
          }

          // Special case: ComputeMix has a second input (Input B for blending)
          if (node.kind === 'ComputeMix' && node.inputs.length > 1) {
            const inputBNodeId = node.inputs[1];
            if (inputBNodeId !== null && inputBNodeId !== undefined) {
              const inputBTexture = this.nodeOutputs.get(inputBNodeId);
              if (inputBTexture && manager.setWarpFieldTexture) {
                // Reuse setWarpFieldTexture for the second input (binding 4)
                manager.setWarpFieldTexture(inputBTexture);
              } else if (!inputBTexture) {
                if (!this._loggedMissingTextures) this._loggedMissingTextures = new Set();
                if (!this._loggedMissingTextures.has(inputBNodeId)) {
                  console.warn(`[ComputeExecutor] Input B texture not found for ${inputBNodeId}, using fallback`);
                  this._loggedMissingTextures.add(inputBNodeId);
                }
              }
            }
          }
        }

        // Check if inputs have changed (for optimization)
        const shouldUpdate = this.checkInputsChanged(nodeId);

        // ONLY dispatch truly time-dependent compute nodes every frame
        // Time-dependent nodes have animation or evolve over time without input changes
        // Most compute nodes (ColorAdjust, Blur, Threshold, etc.) should ONLY run when inputs change
        const TIME_DEPENDENT_NODES = [
          'ComputeNoise',              // Has time parameter
          'ComputeReactionDiffusion',  // Time-based evolution
          'ComputeFeedback',           // Needs every-frame feedback
          'ComputeFeedbackField',      // Needs every-frame feedback
          'ComputeFluidSim',           // Time-based physics
          'ComputeParticles'           // Time-based animation
        ];
        const isTimeDependentNode = node?.kind && TIME_DEPENDENT_NODES.includes(node.kind);

        if (shouldUpdate || isTimeDependentNode) {
          // Only log dispatches occasionally to reduce console spam
          if (!this._lastDispatchLog || Date.now() - this._lastDispatchLog > 1000) {
            console.log(`[ComputeExecutor] Dispatching ${node?.kind} (${nodeId}): shouldUpdate=${shouldUpdate}, timeDep=${isTimeDependentNode}`);
            this._lastDispatchLog = Date.now();
          }

          // Check if this is a ComputeNodeBase instance or legacy ComputeShaderManager
          if (manager instanceof ComputeNodeBase) {
            manager.dispatch(this.device, commandEncoder, time, audioContext);
          } else {
            manager.dispatch(commandEncoder, time, this.profiler, audioContext);
          }

          // Update output dictionary after successful dispatch
          this.updateNodeOutput(nodeId, manager);
        } else {
          console.log(`[ComputeExecutor] → Skipping dispatch for node ${nodeId}`);
        }
      } catch (error) {
        console.error(`[ComputeExecutor] Error executing compute node ${nodeId}:`, error);
      }
    }
    } finally {
      // CRITICAL: Always reset the executing flag, even if there was an error
      this._isExecuting = false;
    }
  }

  /**
   * Update node output in the dictionary after successful dispatch
   */
  updateNodeOutput(nodeId, manager) {
    try {
      const outputTexture = manager.getOutputTexture();
      if (outputTexture) {
        this.nodeOutputs.set(nodeId, outputTexture);
      } else {
        console.warn(`[ComputeExecutor] No output texture returned from manager for node ${nodeId}`);
      }
    } catch (error) {
      console.error(`[ComputeExecutor] Error updating output for node ${nodeId}:`, error);
    }
  }

  /**
   * Get output texture for a node (with fallback)
   * @param {string} nodeId - Node ID
   * @returns {GPUTexture} Output texture or fallback
   */
  getNodeOutput(nodeId) {
    const output = this.nodeOutputs.get(nodeId);
    if (output) {
      return output;
    }

    // Return fallback texture for uncomputed nodes
    return this.fallbackTexture;
  }

  /**
   * Check if inputs to a compute node have changed
   * Returns true if node should be re-dispatched
   */
  checkInputsChanged(nodeId) {
    const nodeData = window.computeNodeRegistry?.get(nodeId);
    if (!nodeData) return true;

    try {
      const node = nodeData.node;
      if (!node || !node.inputs) return true;

      // Build hash of inputs and parameters
      let hash = '';

      // Hash input node outputs
      for (const inputId of node.inputs) {
        if (inputId !== null && inputId !== undefined) {
          const inputTexture = this.nodeOutputs.get(inputId);
          // Use texture memory address as part of hash
          hash += inputTexture ? `${inputId}:computed;` : `${inputId}:missing;`;
        }
      }

      // Hash parameters
      if (node.params) {
        hash += JSON.stringify(node.params);
      }

      // Check if hash changed
      const previousHash = this.inputHashes.get(nodeId);
      const changed = hash !== previousHash;

      if (changed) {
        this.inputHashes.set(nodeId, hash);
      }

      return changed;
    } catch (error) {
      console.error(`[ComputeExecutor] Error checking inputs for node ${nodeId}:`, error);
      return true; // Update on error to be safe
    }
  }

  /**
   * Get texture bindings for all compute nodes
   * Returns array of { binding, resource } for WGSL @group(0) @binding(N)
   * NOTE: Binding indices MUST match those in glslBuilder.js
   */
  getTextureBindings() {
    const bindings = [];
    let bindingIndex = 100; // Start at high index to avoid conflicts

    for (const [nodeId, textureData] of this.computeTextures) {
      const { texture, sampler } = textureData;
      const sanitizedId = nodeId.replace(/[^a-zA-Z0-9_]/g, "_");

      // Add texture binding
      bindings.push({
        nodeId: sanitizedId,
        name: `compute_${sanitizedId}`,
        textureBinding: bindingIndex++,
        samplerBinding: bindingIndex++,
        texture,
        sampler
      });
    }

    return bindings;
  }

  /**
   * Generate WGSL binding declarations for compute textures
   */
  generateBindingDeclarations() {
    let wgsl = '\n// Compute Shader Texture Bindings\n';

    const bindings = this.getTextureBindings();

    for (const binding of bindings) {
      wgsl += `@group(0) @binding(${binding.textureBinding}) var ${binding.name}: texture_2d<f32>;\n`;
      wgsl += `@group(0) @binding(${binding.samplerBinding}) var sampler_${binding.name}: sampler;\n`;
    }

    return wgsl;
  }

  /**
   * Get all compute texture for creating bind groups
   */
  getBindGroupEntries(startBinding = 100) {
    const entries = [];

    for (const binding of this.getTextureBindings()) {
      entries.push({
        binding: binding.textureBinding,
        resource: binding.texture.createView()
      });
      entries.push({
        binding: binding.samplerBinding,
        resource: binding.sampler
      });
    }

    return entries;
  }

  /**
   * Clear all compute nodes and resources
   */
  clear() {
    // Destroy all compute managers
    for (const manager of this.computeManagers.values()) {
      manager.destroy();
    }

    // Destroy fallback texture
    if (this.fallbackTexture) {
      this.fallbackTexture.destroy();
      this.fallbackTexture = null;
    }

    this.computeManagers.clear();
    this.computeNodes.clear();
    this.computeTextures.clear();
    this.inputHashes.clear();
    this.nodeOutputs.clear();
    this.executionOrder = [];
    this.initialized = false;

    // Clear registry
    if (window.computeNodeRegistry) {
      window.computeNodeRegistry.clear();
    }

    console.log('[ComputeExecutor] Cleared all compute nodes');
  }

  /**
   * Update a compute node (when parameters change)
   */
  async updateNode(nodeId) {
    const nodeData = window.computeNodeRegistry?.get(nodeId);
    if (!nodeData) {
      console.warn(`[ComputeExecutor] Node ${nodeId} not found in registry`);
      return;
    }

    // Destroy existing manager
    if (this.computeManagers.has(nodeId)) {
      this.computeManagers.get(nodeId).destroy();
      this.computeManagers.delete(nodeId);
    }

    // Clean up output dictionary and hashes
    this.nodeOutputs.delete(nodeId);
    this.inputHashes.delete(nodeId);

    // Reinitialize
    await this.initializeComputeNode(nodeId, nodeData);

    // Recompute execution order
    this.updateExecutionOrder();

    console.log(`[ComputeExecutor] Updated compute node: ${nodeId}`);
  }

  /**
   * Resize compute textures
   */
  resize(nodeId, width, height) {
    const manager = this.computeManagers.get(nodeId);
    if (manager) {
      manager.resize(width, height);

      // Update texture reference
      const textureData = this.computeTextures.get(nodeId);
      if (textureData) {
        textureData.texture = manager.getOutputTexture();
      }

      console.log(`[ComputeExecutor] Resized node ${nodeId} to ${width}x${height}`);
    }
  }

  /**
   * Get info about active compute nodes
   */
  getInfo() {
    return {
      nodeCount: this.computeManagers.size,
      initialized: this.initialized,
      nodes: Array.from(this.computeManagers.keys()),
      unifiedApiNodes: Array.from(this.computeNodes.keys()),
      executionOrder: [...this.executionOrder],
      computedOutputs: Array.from(this.nodeOutputs.keys()),
      hasFallbackTexture: this.fallbackTexture !== null
    };
  }

  /**
   * Add a ComputeNodeBase instance directly (unified API)
   * This allows creating compute nodes with the unified API outside of the registry
   *
   * @param {ComputeNodeBase} computeNode - Initialized ComputeNodeBase instance
   */
  addComputeNode(computeNode) {
    if (!(computeNode instanceof ComputeNodeBase)) {
      throw new Error('[ComputeExecutor] addComputeNode requires a ComputeNodeBase instance');
    }

    if (!computeNode.initialized) {
      console.warn(`[ComputeExecutor] Adding uninitialized node ${computeNode.id}`);
    }

    const nodeId = computeNode.id;

    // Store node in both maps
    this.computeNodes.set(nodeId, computeNode);
    this.computeManagers.set(nodeId, computeNode);

    // Create sampler for this texture
    const sampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat'
    });

    // Store texture and sampler
    this.computeTextures.set(nodeId, {
      texture: computeNode.getOutputTexture(),
      sampler,
      manager: computeNode
    });

    // Recompute execution order
    this.updateExecutionOrder();

    console.log(`[ComputeExecutor] Added compute node: ${computeNode.kind} (${nodeId})`);

    return computeNode;
  }

  /**
   * Remove a compute node
   * @param {string} nodeId - Node ID to remove
   */
  removeComputeNode(nodeId) {
    const node = this.computeManagers.get(nodeId);
    if (node) {
      // Destroy resources
      if (node instanceof ComputeNodeBase) {
        node.destroy();
      } else if (typeof node.destroy === 'function') {
        node.destroy();
      }

      this.computeManagers.delete(nodeId);
      this.computeNodes.delete(nodeId);
      this.computeTextures.delete(nodeId);
      this.inputHashes.delete(nodeId);
      this.nodeOutputs.delete(nodeId);

      // Recompute execution order
      this.updateExecutionOrder();

      console.log(`[ComputeExecutor] Removed compute node: ${nodeId}`);
    }
  }

  /**
   * Get a compute node by ID
   * @param {string} nodeId - Node ID
   * @returns {ComputeNodeBase|null} The compute node or null
   */
  getComputeNode(nodeId) {
    return this.computeNodes.get(nodeId) || null;
  }

  /**
   * Set a uniform on a compute node (unified API convenience method)
   * @param {string} nodeId - Node ID
   * @param {string} uniformName - Uniform parameter name
   * @param {any} value - Parameter value
   */
  setUniform(nodeId, uniformName, value) {
    const node = this.computeNodes.get(nodeId);
    if (node) {
      node.setUniform(uniformName, value);
    } else {
      console.warn(`[ComputeExecutor] Node ${nodeId} not found or not a ComputeNodeBase instance`);
    }
  }

  /**
   * Serialize all compute nodes
   * @returns {Array<Object>} Array of serialized node data
   */
  serializeAll() {
    const serialized = [];
    for (const [nodeId, node] of this.computeNodes) {
      serialized.push(node.serialize());
    }
    return serialized;
  }

  /**
   * Deserialize and add compute nodes
   * Note: Nodes must be initialized with WGSL after deserialization
   *
   * @param {Array<Object>} data - Array of serialized node data
   * @returns {Array<ComputeNodeBase>} Array of deserialized nodes
   */
  deserializeAll(data) {
    const nodes = [];
    for (const nodeData of data) {
      const node = ComputeNodeBase.deserialize(this.device, nodeData);
      nodes.push(node);
      // Note: Caller must initialize nodes with WGSL before adding to executor
    }
    return nodes;
  }
}
