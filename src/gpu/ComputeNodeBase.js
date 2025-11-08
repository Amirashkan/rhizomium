/**
 * ComputeNodeBase
 *
 * Unified API for all compute nodes in the node system.
 * Provides a standard interface for:
 * - Dispatching compute operations
 * - Managing uniforms and parameters
 * - Serialization/deserialization
 * - Texture output access
 *
 * All compute nodes should extend or use this base class.
 */

import { ComputeShaderManager } from './ComputeShaderManager.js';

export class ComputeNodeBase {
  /**
   * Create a new compute node
   * @param {GPUDevice} device - WebGPU device
   * @param {Object} nodeConfig - Node configuration
   * @param {string} nodeConfig.id - Unique node ID
   * @param {string} nodeConfig.kind - Node type (e.g., 'ComputeNoise', 'ComputeReactionDiffusion')
   * @param {Object} nodeConfig.params - Node parameters
   * @param {Object} nodeConfig.metadata - Additional metadata (label, description, etc.)
   */
  constructor(device, nodeConfig = {}) {
    this.device = device;

    // Node identity
    this.id = nodeConfig.id || this.generateId();
    this.kind = nodeConfig.kind || 'ComputeNodeBase';

    // Parameters
    this.params = { ...nodeConfig.params } || {};

    // Metadata
    this.metadata = {
      label: nodeConfig.metadata?.label || this.kind,
      description: nodeConfig.metadata?.description || '',
      category: nodeConfig.metadata?.category || 'Compute',
      ...nodeConfig.metadata
    };

    // Shader manager (initialized on setup)
    this.shaderManager = null;

    // Initialization state
    this.initialized = false;

    // Texture dimensions
    this.width = 0;
    this.height = 0;

    // Feedback support
    this.supportsFeedback = false;

    // WGSL source code (stored for potential recompilation)
    this.wgslSource = null;
  }

  /**
   * Generate a unique ID for this node
   */
  generateId() {
    return `compute_node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Initialize the compute node with WGSL shader code
   * @param {string} wgslSource - WGSL compute shader source code
   * @param {number} width - Texture width
   * @param {number} height - Texture height
   * @param {boolean} supportsFeedback - Whether this node uses feedback (ping-pong buffers)
   */
  async initialize(wgslSource, width, height, supportsFeedback = false) {
    if (this.initialized) {
      console.warn(`[ComputeNodeBase] Node ${this.id} already initialized`);
      return;
    }

    this.wgslSource = wgslSource;
    this.width = width;
    this.height = height;
    this.supportsFeedback = supportsFeedback;

    // Create shader manager with node reference
    const nodeRef = {
      id: this.id,
      kind: this.kind,
      params: this.params
    };

    this.shaderManager = new ComputeShaderManager(this.device, nodeRef);
    await this.shaderManager.initialize(wgslSource, width, height, supportsFeedback);

    this.initialized = true;

    console.log(`[ComputeNodeBase] Initialized ${this.kind} (${this.id}) at ${width}x${height}`);
  }

  /**
   * Dispatch the compute shader
   * @param {GPUDevice} device - WebGPU device (for API consistency, but we use this.device)
   * @param {GPUCommandEncoder} encoder - Command encoder
   * @param {number} time - Current time in seconds
   */
  dispatch(device, encoder, time) {
    if (!this.initialized || !this.shaderManager) {
      console.warn(`[ComputeNodeBase] Cannot dispatch ${this.id}: not initialized`);
      return;
    }

    // Update shader manager's node reference to ensure latest params are used
    this.shaderManager.node = {
      id: this.id,
      kind: this.kind,
      params: this.params
    };

    this.shaderManager.dispatch(encoder, time);
  }

  /**
   * Get the output texture for rendering
   * @returns {GPUTexture} The output texture
   */
  getOutputTexture() {
    if (!this.shaderManager) {
      console.warn(`[ComputeNodeBase] Cannot get output texture: ${this.id} not initialized`);
      return null;
    }

    return this.shaderManager.getOutputTexture();
  }

  /**
   * Set a uniform parameter value
   * This updates the internal params object and will be reflected in the next dispatch
   * @param {string} name - Parameter name
   * @param {any} value - Parameter value
   */
  setUniform(name, value) {
    if (!this.params.hasOwnProperty(name)) {
      console.warn(`[ComputeNodeBase] Parameter '${name}' not found in ${this.id}`);
    }

    this.params[name] = value;

    console.log(`[ComputeNodeBase] Set ${this.id}.${name} = ${value}`);
  }

  /**
   * Get a uniform parameter value
   * @param {string} name - Parameter name
   * @returns {any} Parameter value
   */
  getUniform(name) {
    return this.params[name];
  }

  /**
   * Update multiple parameters at once
   * @param {Object} params - Object with parameter name-value pairs
   */
  updateParams(params) {
    Object.entries(params).forEach(([name, value]) => {
      this.setUniform(name, value);
    });
  }

  /**
   * Serialize the node to JSON
   * @returns {Object} Serialized node data
   */
  serialize() {
    return {
      id: this.id,
      kind: this.kind,
      params: { ...this.params },
      metadata: { ...this.metadata },
      dimensions: {
        width: this.width,
        height: this.height
      },
      supportsFeedback: this.supportsFeedback,
      // Note: WGSL source is not serialized as it's generated from node definition
    };
  }

  /**
   * Deserialize a node from JSON
   * Note: This creates the node structure but does NOT initialize the GPU resources.
   * You must call initialize() with WGSL source after deserialization.
   *
   * @param {GPUDevice} device - WebGPU device
   * @param {Object} data - Serialized node data
   * @returns {ComputeNodeBase} Deserialized node instance
   */
  static deserialize(device, data) {
    const node = new ComputeNodeBase(device, {
      id: data.id,
      kind: data.kind,
      params: data.params,
      metadata: data.metadata
    });

    // Store dimensions and feedback info for later initialization
    node.width = data.dimensions?.width || 512;
    node.height = data.dimensions?.height || 512;
    node.supportsFeedback = data.supportsFeedback || false;

    console.log(`[ComputeNodeBase] Deserialized ${data.kind} (${data.id})`);

    return node;
  }

  /**
   * Resize the output textures
   * @param {number} width - New width
   * @param {number} height - New height
   */
  resize(width, height) {
    if (!this.shaderManager) {
      console.warn(`[ComputeNodeBase] Cannot resize ${this.id}: not initialized`);
      return;
    }

    this.width = width;
    this.height = height;
    this.shaderManager.resize(width, height);

    console.log(`[ComputeNodeBase] Resized ${this.id} to ${width}x${height}`);
  }

  /**
   * Reset reaction-diffusion simulation (if applicable)
   * This is node-type specific but provided for convenience
   */
  reset() {
    if (this.shaderManager && typeof this.shaderManager.resetReactionDiffusion === 'function') {
      this.shaderManager.resetReactionDiffusion();
    }
  }

  /**
   * Get workgroup information
   * @returns {Object} Workgroup size and dispatch info
   */
  getWorkgroupInfo() {
    if (!this.shaderManager) {
      return null;
    }

    return this.shaderManager.getWorkgroupInfo();
  }

  /**
   * Get node information for debugging
   * @returns {Object} Node info
   */
  getInfo() {
    return {
      id: this.id,
      kind: this.kind,
      initialized: this.initialized,
      dimensions: { width: this.width, height: this.height },
      supportsFeedback: this.supportsFeedback,
      params: { ...this.params },
      metadata: { ...this.metadata }
    };
  }

  /**
   * Clean up GPU resources
   */
  destroy() {
    if (this.shaderManager) {
      this.shaderManager.destroy();
      this.shaderManager = null;
    }

    this.initialized = false;

    console.log(`[ComputeNodeBase] Destroyed ${this.kind} (${this.id})`);
  }

  /**
   * Create a compute node from a node definition
   * This is a factory method that creates a ComputeNodeBase from node metadata
   *
   * @param {GPUDevice} device - WebGPU device
   * @param {Object} nodeDef - Node definition from ComputeNodes.js
   * @param {string} id - Node ID
   * @param {Object} initialParams - Initial parameter values
   * @returns {ComputeNodeBase} New compute node instance
   */
  static fromDefinition(device, nodeDef, id, initialParams = {}) {
    // Extract default parameters from node definition
    const defaultParams = {};
    if (nodeDef.params) {
      nodeDef.params.forEach(param => {
        defaultParams[param.name] = param.default;
      });
    }

    // Merge with initial params
    const params = { ...defaultParams, ...initialParams };

    // Create metadata from definition
    const metadata = {
      label: nodeDef.label,
      description: nodeDef.description,
      category: nodeDef.cat,
      inputs: nodeDef.inputs,
      pinsIn: nodeDef.pinsIn,
      pinsOut: nodeDef.pinsOut,
      workgroupSize: nodeDef.workgroupSize
    };

    return new ComputeNodeBase(device, {
      id,
      kind: id.split('_')[0], // Extract kind from ID (e.g., 'ComputeNoise' from 'ComputeNoise_123')
      params,
      metadata
    });
  }
}
