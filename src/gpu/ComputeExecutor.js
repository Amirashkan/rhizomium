/**
 * ComputeExecutor
 * Manages execution of compute shader nodes in the node graph
 * - Tracks compute nodes and their dependencies
 * - Dispatches compute shaders before fragment shader
 * - Handles auto re-dispatch when inputs change
 * - Manages compute output textures as shader bindings
 * - Supports both ComputeNodeBase (unified API) and legacy ComputeShaderManager
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

    for (const [nodeId, nodeData] of window.computeNodeRegistry) {
      await this.initializeComputeNode(nodeId, nodeData);
    }

    this.initialized = true;
    console.log('[ComputeExecutor] ✓ Initialization complete');
  }

  /**
   * Initialize a single compute node
   */
  async initializeComputeNode(nodeId, nodeData) {
    try {
      const { node, wgslCode, resolution, supportsFeedback } = nodeData;

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

      // Store texture and sampler
      this.computeTextures.set(nodeId, {
        texture: manager.getOutputTexture(),
        sampler,
        manager
      });

      console.log(`[ComputeExecutor] ✓ Initialized compute node: ${node.kind} (${nodeId})`);
    } catch (error) {
      console.error(`[ComputeExecutor] Failed to initialize node ${nodeId}:`, error);
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

    // Dispatch all compute shaders (both legacy and unified API)
    for (const [nodeId, manager] of this.computeManagers) {
      try {
        // Check if inputs have changed
        const shouldUpdate = this.checkInputsChanged(nodeId);

        if (shouldUpdate) {
          // Check if this is a ComputeNodeBase instance or legacy ComputeShaderManager
          if (manager instanceof ComputeNodeBase) {
            manager.dispatch(this.device, commandEncoder, time);
          } else {
            manager.dispatch(commandEncoder, time, this.profiler);
          }
        }
      } catch (error) {
        console.error(`[ComputeExecutor] Error executing compute node ${nodeId}:`, error);
      }
    }
  }

  /**
   * Check if inputs to a compute node have changed
   * Returns true if node should be re-dispatched
   */
  checkInputsChanged(nodeId) {
    const nodeData = window.computeNodeRegistry?.get(nodeId);
    if (!nodeData) return true;

    // For now, always update (later we can add input tracking)
    // TODO: Hash input textures and parameters to detect changes
    return true;
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

    this.computeManagers.clear();
    this.computeTextures.clear();
    this.inputHashes.clear();
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

    // Reinitialize
    await this.initializeComputeNode(nodeId, nodeData);

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
      unifiedApiNodes: Array.from(this.computeNodes.keys())
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
