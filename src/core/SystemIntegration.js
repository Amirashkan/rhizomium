// src/core/SystemIntegration.js

/**
 * System Integration Module
 *
 * Central hub that connects all major systems:
 * - Graph execution and validation
 * - Type propagation
 * - GPU resource management
 * - 3D scene management
 * - Execution queue
 * - Event system
 *
 * Provides a unified API for the complete compute node and 3D graph system
 */

import { Graph } from '../data/Graph.js';
import { TypeSystem, globalTypeSystem } from '../data/TypeSystem.js';
import { ExecutionQueue, Priority, globalExecutionQueue } from './ExecutionQueue.js';
import { ParameterEventSystem } from '../utils/ParameterEventSystem.js';
import { Scene } from '../scene/Scene.js';

/**
 * System status
 */
export const SystemStatus = {
  INITIALIZING: 'initializing',
  READY: 'ready',
  EXECUTING: 'executing',
  ERROR: 'error',
  DISPOSED: 'disposed'
};

/**
 * System Integration class
 * Main coordinator for all subsystems
 */
export class SystemIntegration {
  constructor(options = {}) {
    this.options = {
      enableAutoValidation: options.enableAutoValidation !== false,
      enableTypePropagation: options.enableTypePropagation !== false,
      enableAutoExecution: options.enableAutoExecution !== false,
      maxConcurrentTasks: options.maxConcurrentTasks || 4,
      ...options
    };

    // Core systems
    this.graph = new Graph();
    this.typeSystem = globalTypeSystem;
    this.executionQueue = globalExecutionQueue;
    this.eventSystem = new ParameterEventSystem();
    this.scene = new Scene('Main Scene');

    // GPU execution
    this.computeExecutor = null;

    // Status
    this.status = SystemStatus.INITIALIZING;
    this.lastError = null;

    // Statistics
    this.stats = {
      nodesCreated: 0,
      connectionsCreated: 0,
      executionsCompleted: 0,
      validationErrors: 0,
      typeErrors: 0
    };

    // Initialize
    this._initialize();
  }

  // ============ Initialization ============

  /**
   * Initialize the system
   * @private
   */
  _initialize() {

    // Set up event listeners
    this._setupEventListeners();

    // Initialize subsystems
    this.status = SystemStatus.READY;

  }

  /**
   * Set up event listeners between systems
   * @private
   */
  _setupEventListeners() {
    // Listen to parameter changes
    this.eventSystem.on('PARAMETER_CHANGED', (data) => {
      this.handleParameterChange(data);
    });

    // Listen to node dirty events
    this.eventSystem.on('NODE_DIRTY', (data) => {
      this.handleNodeDirty(data);
    });

    // Listen to execution queue events
    this.executionQueue.on('complete', (_data) => {
      this.stats.executionsCompleted++;
    });

    this.executionQueue.on('error', (data) => {

      this.lastError = data.error;
    });
  }

  // ============ Node Management ============

  /**
   * Add a node to the graph
   * @param {object} nodeData - Node data
   * @returns {string} Node ID
   */
  addNode(nodeData) {
    try {
      this.graph.add(nodeData);
      this.stats.nodesCreated++;

      // Register with type system if node has type information
      if (nodeData.id && (nodeData.pinsIn || nodeData.pinsOut)) {
        this.typeSystem.registerNode(nodeData.id, {
          pinsIn: nodeData.pinsIn || [],
          pinsOut: nodeData.pinsOut || []
        });
      }

      // Emit event
      this.eventSystem.emit('NODE_ADDED', { nodeId: nodeData.id });

      // Auto-validate if enabled
      if (this.options.enableAutoValidation) {
        this.validate();
      }

      return nodeData.id;
    } catch (error) {

      this.lastError = error;
      throw error;
    }
  }

  /**
   * Remove a node from the graph
   * @param {string} nodeId - Node ID
   */
  removeNode(nodeId) {
    try {
      const node = this.graph.getNode(nodeId);
      if (!node) {
        throw new Error(`Node ${nodeId} not found`);
      }

      this.graph.remove(node);
      this.typeSystem.unregisterNode(nodeId);

      // Cancel any pending tasks for this node
      this.executionQueue.cancelGroup(`node-${nodeId}`);

      // Emit event
      this.eventSystem.emit('NODE_REMOVED', { nodeId });

      // Auto-validate if enabled
      if (this.options.enableAutoValidation) {
        this.validate();
      }
    } catch (error) {

      this.lastError = error;
      throw error;
    }
  }

  /**
   * Get node by ID
   * @param {string} nodeId - Node ID
   * @returns {object|null} Node data
   */
  getNode(nodeId) {
    return this.graph.getNode(nodeId);
  }

  // ============ Connection Management ============

  /**
   * Create a connection between two nodes
   * @param {string} fromNodeId - Source node ID
   * @param {string} fromPin - Source pin name
   * @param {string} toNodeId - Target node ID
   * @param {string} toPin - Target pin name
   * @returns {object} Result {success, error, connection}
   */
  addConnection(fromNodeId, fromPin, toNodeId, toPin) {
    try {
      // Validate types if enabled
      if (this.options.enableTypePropagation) {
        const typeValidation = this.typeSystem.validateConnection(
          fromNodeId, fromPin, toNodeId, toPin
        );

        if (!typeValidation.valid) {
          this.stats.typeErrors++;
          return {
            success: false,
            error: typeValidation.error,
            warning: typeValidation.warning
          };
        }
      }

      // Add connection to graph
      const result = this.graph.addConnection(fromNodeId, fromPin, toNodeId, toPin);

      if (result.success) {
        this.stats.connectionsCreated++;

        // Propagate types if enabled
        if (this.options.enableTypePropagation) {
          this.typeSystem.propagateTypes(this.graph);
        }

        // Emit event
        this.eventSystem.emit('CONNECTION_ADDED', {
          fromNodeId, fromPin, toNodeId, toPin
        });

        // Auto-execute if enabled
        if (this.options.enableAutoExecution) {
          this.executeNode(toNodeId);
        }
      } else {
        this.stats.validationErrors++;
      }

      return result;
    } catch (error) {

      this.lastError = error;
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove a connection
   * @param {string} fromNodeId - Source node ID
   * @param {string} fromPin - Source pin name
   * @param {string} toNodeId - Target node ID
   * @param {string} toPin - Target pin name
   * @returns {boolean} Success
   */
  removeConnection(fromNodeId, fromPin, toNodeId, toPin) {
    try {
      const success = this.graph.removeConnection(fromNodeId, fromPin, toNodeId, toPin);

      if (success) {
        // Emit event
        this.eventSystem.emit('CONNECTION_REMOVED', {
          fromNodeId, fromPin, toNodeId, toPin
        });

        // Mark target node as dirty
        this.graph.markNodeDirty(toNodeId);
      }

      return success;
    } catch (error) {

      this.lastError = error;
      return false;
    }
  }

  // ============ Validation ============

  /**
   * Validate the entire system
   * @returns {object} Validation result {valid, errors, warnings}
   */
  validate() {
    const results = {
      valid: true,
      errors: [],
      warnings: []
    };

    // Validate graph structure
    const graphValidation = this.graph.validate();
    if (!graphValidation.valid) {
      results.valid = false;
      results.errors.push(...graphValidation.errors);
    }
    results.warnings.push(...graphValidation.warnings);

    // Validate types
    if (this.options.enableTypePropagation) {
      const typeValidation = this.typeSystem.validateGraph(this.graph);
      if (!typeValidation.valid) {
        results.valid = false;
        results.errors.push(...typeValidation.errors);
      }
      results.warnings.push(...typeValidation.warnings);
    }

    // Update statistics
    if (!results.valid) {
      this.stats.validationErrors += results.errors.length;
    }

    // Emit event
    this.eventSystem.emit('VALIDATION_COMPLETE', results);

    return results;
  }

  // ============ Execution ============

  /**
   * Execute a single node
   * @param {string} nodeId - Node ID
   * @param {number} priority - Execution priority
   * @returns {Promise<any>} Execution result
   */
  async executeNode(nodeId, priority = Priority.NORMAL) {
    const taskId = `execute-node-${nodeId}-${Date.now()}`;

    return new Promise((resolve, reject) => {
      this.executionQueue.enqueue(
        taskId,
        async () => {
          try {
            // Get node dependencies
            const dependencies = this.graph.getDependencies(nodeId);

            // Execute dependencies first
            for (const depId of dependencies) {
              if (this.graph.isNodeDirty(depId)) {
                await this.executeNode(depId, Priority.HIGH);
              }
            }

            // Execute this node
            // (Actual execution logic would be provided by the compute executor)
            const result = await this._executeNodeLogic(nodeId);

            // Mark node as clean
            this.graph.markNodeClean(nodeId);

            // Emit event
            this.eventSystem.emit('NODE_EXECUTED', { nodeId, result });

            return result;
          } catch (error) {

            this.lastError = error;
            throw error;
          }
        },
        priority,
        { group: `node-${nodeId}`, cancelable: true }
      );

      // Wait for task completion
      this.executionQueue.waitFor(taskId)
        .then(resolve)
        .catch(reject);
    });
  }

  /**
   * Execute the entire graph
   * @returns {Promise<void>}
   */
  async executeGraph() {
    this.status = SystemStatus.EXECUTING;

    try {
      // Get execution order
      const executionOrder = this.graph.getExecutionOrder();

      // Execute nodes in order
      for (const nodeId of executionOrder) {
        if (this.graph.isNodeDirty(nodeId)) {
          await this.executeNode(nodeId, Priority.HIGH);
        }
      }

      this.status = SystemStatus.READY;

      // Emit event
      this.eventSystem.emit('GRAPH_EXECUTED', {
        nodeCount: executionOrder.length
      });
    } catch (error) {
      this.status = SystemStatus.ERROR;
      this.lastError = error;
      throw error;
    }
  }

  /**
   * Set the compute executor for GPU-based node execution
   * @param {ComputeExecutor} executor - The compute executor instance
   */
  setComputeExecutor(executor) {
    this.computeExecutor = executor;

  }

  /**
   * Execute node logic using ComputeExecutor if available
   * @private
   */
  async _executeNodeLogic(nodeId) {
    const node = this.graph.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    // If ComputeExecutor is available and node is a compute node, use GPU execution
    if (this.computeExecutor && node.type && node.type.startsWith('compute')) {
      // Ensure node is initialized in compute executor
      if (!this.computeExecutor.computeManagers.has(nodeId)) {
        await this.computeExecutor.initializeComputeNode(nodeId, node);
      }

      // Update node parameters/uniforms if needed
      if (node.params) {
        for (const [paramName, paramValue] of Object.entries(node.params)) {
          this.computeExecutor.setUniform(nodeId, paramName, paramValue);
        }
      }

      // Get output texture
      const output = this.computeExecutor.getNodeOutput(nodeId);

      return {
        nodeId,
        executed: true,
        output,
        type: 'compute'
      };
    }

    // Fallback for non-compute nodes
    return { nodeId, executed: true, type: 'standard' };
  }

  // ============ Event Handling ============

  /**
   * Handle parameter change
   */
  handleParameterChange(data) {
    const { nodeId, parameter, value } = data;

    // Mark node as dirty
    this.graph.markNodeDirty(nodeId);

    // Auto-execute if enabled
    if (this.options.enableAutoExecution) {
      this.executeNode(nodeId, Priority.HIGH);
    }
  }

  /**
   * Handle node dirty event
   */
  handleNodeDirty(data) {
    const { nodeId } = data;
    this.graph.markNodeDirty(nodeId);
  }

  // ============ Serialization ============

  /**
   * Serialize entire system to JSON
   * @returns {object} System state
   */
  toJSON() {
    return {
      version: '1.0.0',
      graph: this.graph.toJSON(),
      scene: this.scene.toJSON(),
      stats: this.stats,
      timestamp: Date.now()
    };
  }

  /**
   * Load system from JSON
   * @param {object} json - System state
   */
  static fromJSON(json) {
    const system = new SystemIntegration();

    // Load graph
    if (json.graph) {
      system.graph = Graph.fromJSON(json.graph);
    }

    // Load scene
    if (json.scene) {
      system.scene = Scene.fromJSON(json.scene);
    }

    // Restore statistics
    if (json.stats) {
      system.stats = json.stats;
    }

    // Register all nodes with type system
    for (const node of system.graph.nodes) {
      if (node.id && (node.pinsIn || node.pinsOut)) {
        system.typeSystem.registerNode(node.id, {
          pinsIn: node.pinsIn || [],
          pinsOut: node.pinsOut || []
        });
      }
    }

    // Validate and propagate types
    if (system.options.enableTypePropagation) {
      system.typeSystem.propagateTypes(system.graph);
    }

    if (system.options.enableAutoValidation) {
      system.validate();
    }

    return system;
  }

  // ============ Statistics ============

  /**
   * Get comprehensive system statistics
   * @returns {object} Statistics
   */
  getStats() {
    return {
      ...this.stats,
      graph: this.graph.getStats(),
      executionQueue: this.executionQueue.getStats(),
      scene: this.scene.getStatistics(),
      status: this.status,
      lastError: this.lastError ? this.lastError.message : null
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      nodesCreated: 0,
      connectionsCreated: 0,
      executionsCompleted: 0,
      validationErrors: 0,
      typeErrors: 0
    };
  }

  // ============ Cleanup ============

  /**
   * Clear all data
   */
  clear() {
    this.graph.clear();
    this.scene.clear();
    this.executionQueue.cancelAll();
    this.executionQueue.clearCompleted();
    this.typeSystem.clear();
    this.resetStats();
    this.lastError = null;

    // Emit event
    this.eventSystem.emit('SYSTEM_CLEARED', {});
  }

  /**
   * Dispose of the system
   */
  dispose() {

    this.clear();
    this.executionQueue.dispose();
    this.status = SystemStatus.DISPOSED;

  }
}

/**
 * Create and export a global system integration instance
 */
export const globalSystemIntegration = new SystemIntegration({
  enableAutoValidation: true,
  enableTypePropagation: true,
  enableAutoExecution: false, // Manual execution by default
  maxConcurrentTasks: 4
});
