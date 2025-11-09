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

    console.log('[ComputeExecutor] Created');
  }

  /**
   * Initialize compute nodes from registry
   */
  async initialize() {
    if (!window.computeNodeRegistry || window.computeNodeRegistry.size === 0) {
      console.log('[ComputeExecutor] No compute nodes to initialize');
      return;
    }

    console.log(`[ComputeExecutor] Initializing ${window.computeNodeRegistry.size} compute nodes...`);

    // Create fallback texture
    this.createFallbackTexture();

    for (const [nodeId, nodeData] of window.computeNodeRegistry) {
      await this.initializeComputeNode(nodeId, nodeData);
    }

    // Compute execution order after all nodes are initialized
    this.updateExecutionOrder();

    this.initialized = true;
    console.log('[ComputeExecutor] ✓ Initialization complete');
  }

  /**
   * Initialize a single compute node
   */
  async initializeComputeNode(nodeId, nodeData) {
    try {
      const { node, wgslCode, resolution, supportsFeedback } = nodeData;

      console.log(`[ComputeExecutor] Initializing compute node: ${node.kind} (${nodeId})`);
      console.log(`[ComputeExecutor] Resolution: ${resolution[0]}x${resolution[1]}, Feedback: ${supportsFeedback}`);

      // Create compute shader manager with node reference for parameters
      const manager = new ComputeShaderManager(this.device, node);
      await manager.initialize(wgslCode, resolution[0], resolution[1], supportsFeedback);

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

      console.log(`[ComputeExecutor] ✓ Initialized compute node: ${node.kind} (${nodeId})`);
      console.log(`[ComputeExecutor] ✓ Registered compute texture with ID: ${nodeId}`);
      console.log(`[ComputeExecutor] Current computeTextures keys:`, Array.from(this.computeTextures.keys()));
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

    console.log('[ComputeExecutor] Created fallback texture');
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
      console.log(`[ComputeExecutor] Execution order computed: ${this.executionOrder.length} nodes`);
      console.log(`[ComputeExecutor] Order: ${this.executionOrder.join(' -> ')}`);
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
   * Execute all compute shaders
   * Should be called before fragment shader execution
   */
  execute(commandEncoder, time = 0) {
    if (!this.initialized || this.computeManagers.size === 0) {
      return;
    }

    // Execute in topological order (dependencies first)
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

        // Check if inputs have changed (for optimization)
        const shouldUpdate = this.checkInputsChanged(nodeId);

        // ALWAYS dispatch time-dependent compute nodes (they animate every frame)
        // Time-dependent nodes include: ComputeNoise, ComputeReactionDiffusion, etc.
        const isTimeDependentNode = node?.kind && (
          node.kind === 'ComputeNoise' ||
          node.kind === 'ComputeReactionDiffusion' ||
          node.kind.startsWith('Compute') // Most compute nodes are time-dependent
        );

        if (shouldUpdate || isTimeDependentNode) {
          // Check if this is a ComputeNodeBase instance or legacy ComputeShaderManager
          if (manager instanceof ComputeNodeBase) {
            manager.dispatch(this.device, commandEncoder, time);
          } else {
            manager.dispatch(commandEncoder, time, this.profiler);
          }

          // Update output dictionary after successful dispatch
          this.updateNodeOutput(nodeId, manager);
        }
      } catch (error) {
        console.error(`[ComputeExecutor] Error executing compute node ${nodeId}:`, error);
      }
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
    console.warn(`[ComputeExecutor] Node ${nodeId} not computed yet, using fallback`);
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
    console.log(`[ComputeExecutor] Generating ${bindings.length} compute texture bindings`);

    for (const binding of bindings) {
      console.log(`[ComputeExecutor] Binding: ${binding.name} at ${binding.textureBinding}, sampler at ${binding.samplerBinding}`);
      wgsl += `@group(0) @binding(${binding.textureBinding}) var ${binding.name}: texture_2d<f32>;\n`;
      wgsl += `@group(0) @binding(${binding.samplerBinding}) var sampler_${binding.name}: sampler;\n`;
    }

    console.log('[ComputeExecutor] Generated bindings:\n', wgsl);
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
