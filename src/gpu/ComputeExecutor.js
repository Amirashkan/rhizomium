/**
 * ComputeExecutor
 * Manages execution of compute shader nodes in the node graph
 * - Tracks compute nodes and their dependencies
 * - Dispatches compute shaders before fragment shader
 * - Handles auto re-dispatch when inputs change
 * - Manages compute output textures as shader bindings
 */

import { ComputeShaderManager } from './ComputeShaderManager.js';

export class ComputeExecutor {
  constructor(device) {
    this.device = device;

    // Map of nodeId -> ComputeShaderManager
    this.computeManagers = new Map();

    // Map of nodeId -> { texture, sampler, bindGroup }
    this.computeTextures = new Map();

    // Map of nodeId -> input hash for detecting changes
    this.inputHashes = new Map();

    // Track initialization state
    this.initialized = false;

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
      const { node, wgslCode, resolution } = nodeData;

      // Create compute shader manager
      const manager = new ComputeShaderManager(this.device);
      await manager.initialize(wgslCode, resolution[0], resolution[1]);

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
   * Execute all compute shaders
   * Should be called before fragment shader execution
   */
  execute(commandEncoder, time = 0) {
    if (!this.initialized || this.computeManagers.size === 0) {
      return;
    }

    // Dispatch all compute shaders
    for (const [nodeId, manager] of this.computeManagers) {
      try {
        // Check if inputs have changed
        const shouldUpdate = this.checkInputsChanged(nodeId);

        if (shouldUpdate) {
          manager.dispatch(commandEncoder, time);
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
      nodes: Array.from(this.computeManagers.keys())
    };
  }
}
