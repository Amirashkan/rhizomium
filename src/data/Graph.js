// src/data/Graph.js

/**
 * Enhanced Graph system with execution order, validation, and dependency tracking
 * Manages nodes, connections, and provides execution orchestration
 */
export class Graph {
  constructor() {
    this.nodes = [];
    this.connections = [];
    this.selection = new Set();
    this.dirtyNodes = new Set();
    this.dirtyInputs = new Map(); // nodeId -> Set<inputNodeId>
    this.lastComputedInputs = new Map(); // nodeId -> serialized inputs snapshot
    this.computedValueCache = new Map(); // nodeId -> last computed value
    this.graphStructureHash = null;
    this.nodeMap = new Map(); // id -> node for fast lookup
    this.executionOrder = []; // cached topological sort
    this.isExecutionOrderDirty = true;
  }

  // ============ Node Management ============

  add(node) {
    this.nodes.push(node);
    if (node.id) {
      this.nodeMap.set(node.id, node);
    }
    this.markExecutionOrderDirty();
    this.markNodeDirty(node.id);
  }

  remove(node) {
    const index = this.nodes.indexOf(node);
    if (index >= 0) {
      this.nodes.splice(index, 1);
      if (node.id) {
        this.nodeMap.delete(node.id);
      }

      // Remove all connections to/from this node
      this.connections = this.connections.filter(conn =>
        conn.fromNode !== node.id && conn.toNode !== node.id
      );

      this.markExecutionOrderDirty();
    }
  }

  getNode(id) {
    return this.nodeMap.get(id) || this.nodes.find(n => n.id === id);
  }

  getNodesByType(type) {
    return this.nodes.filter(n => n.kind === type);
  }

  // ============ Connection Management ============

  addConnection(fromNodeId, fromPin, toNodeId, toPin) {
    // Validate connection doesn't already exist
    const exists = this.connections.some(conn =>
      conn.fromNode === fromNodeId &&
      conn.fromPin === fromPin &&
      conn.toNode === toNodeId &&
      conn.toPin === toPin
    );

    if (exists) {
      return { success: false, error: 'Connection already exists' };
    }

    // Validate nodes exist
    const fromNode = this.getNode(fromNodeId);
    const toNode = this.getNode(toNodeId);

    if (!fromNode || !toNode) {
      return { success: false, error: 'Node not found' };
    }

    // Create connection
    const connection = {
      fromNode: fromNodeId,
      fromPin,
      toNode: toNodeId,
      toPin
    };

    this.connections.push(connection);
    this.markExecutionOrderDirty();
    this.markNodeDirty(toNodeId);

    // Validate for cycles
    const cycleResult = this.detectCycles();
    if (!cycleResult.hasCycle) {
      return { success: true, connection };
    } else {
      // Rollback connection
      this.connections.pop();
      this.markExecutionOrderDirty();
      return { success: false, error: 'Connection would create a cycle', cycle: cycleResult.cycle };
    }
  }

  removeConnection(fromNodeId, fromPin, toNodeId, toPin) {
    const index = this.connections.findIndex(conn =>
      conn.fromNode === fromNodeId &&
      conn.fromPin === fromPin &&
      conn.toNode === toNodeId &&
      conn.toPin === toPin
    );

    if (index >= 0) {
      this.connections.splice(index, 1);
      this.markExecutionOrderDirty();
      this.markNodeDirty(toNodeId);
      return true;
    }
    return false;
  }

  getConnectionsTo(nodeId) {
    return this.connections.filter(conn => conn.toNode === nodeId);
  }

  getConnectionsFrom(nodeId) {
    return this.connections.filter(conn => conn.fromNode === nodeId);
  }

  getInputConnections(nodeId, pinName) {
    return this.connections.filter(conn =>
      conn.toNode === nodeId && conn.toPin === pinName
    );
  }

  getOutputConnections(nodeId, pinName) {
    return this.connections.filter(conn =>
      conn.fromNode === nodeId && conn.fromPin === pinName
    );
  }

  // ============ Execution Order & Dependency Tracking ============

  /**
   * Get execution order using topological sort
   * Returns array of node IDs in dependency order
   */
  getExecutionOrder() {
    if (!this.isExecutionOrderDirty) {
      return this.executionOrder;
    }

    const sorted = this.topologicalSort();
    if (sorted.success) {
      this.executionOrder = sorted.order;
      this.isExecutionOrderDirty = false;
      return this.executionOrder;
    } else {

      return [];
    }
  }

  /**
   * Topological sort using Kahn's algorithm
   * Returns nodes in dependency order (dependencies first)
   */
  topologicalSort() {
    // Build adjacency list and in-degree map
    const adjacency = new Map(); // nodeId -> [dependent node IDs]
    const inDegree = new Map();  // nodeId -> number of dependencies

    // Initialize
    for (const node of this.nodes) {
      if (!node.id) continue;
      adjacency.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    // Build graph
    for (const conn of this.connections) {
      if (!adjacency.has(conn.fromNode)) adjacency.set(conn.fromNode, []);
      if (!adjacency.has(conn.toNode)) adjacency.set(conn.toNode, []);

      adjacency.get(conn.fromNode).push(conn.toNode);
      inDegree.set(conn.toNode, (inDegree.get(conn.toNode) || 0) + 1);
    }

    // Find all nodes with no dependencies
    const queue = [];
    for (const [nodeId, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    const sorted = [];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      sorted.push(nodeId);

      // Process dependents
      const dependents = adjacency.get(nodeId) || [];
      for (const depId of dependents) {
        inDegree.set(depId, inDegree.get(depId) - 1);
        if (inDegree.get(depId) === 0) {
          queue.push(depId);
        }
      }
    }

    // Check if all nodes were sorted (no cycles)
    if (sorted.length !== this.nodes.filter(n => n.id).length) {
      return {
        success: false,
        error: 'Graph contains cycles',
        order: []
      };
    }

    return {
      success: true,
      order: sorted
    };
  }

  /**
   * Detect cycles in the graph using DFS
   */
  detectCycles() {
    const visited = new Set();
    const recStack = new Set();
    let cycle = null;

    const dfs = (nodeId, path = []) => {
      visited.add(nodeId);
      recStack.add(nodeId);
      path.push(nodeId);

      const connections = this.getConnectionsFrom(nodeId);
      for (const conn of connections) {
        const nextId = conn.toNode;

        if (!visited.has(nextId)) {
          if (dfs(nextId, [...path])) {
            return true;
          }
        } else if (recStack.has(nextId)) {
          // Found cycle
          cycle = [...path, nextId];
          return true;
        }
      }

      recStack.delete(nodeId);
      return false;
    };

    for (const node of this.nodes) {
      if (node.id && !visited.has(node.id)) {
        if (dfs(node.id)) {
          return { hasCycle: true, cycle };
        }
      }
    }

    return { hasCycle: false, cycle: null };
  }

  /**
   * Get all dependencies of a node (recursive)
   */
  getDependencies(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);

    const dependencies = [];
    const connections = this.getConnectionsTo(nodeId);

    for (const conn of connections) {
      dependencies.push(conn.fromNode);
      dependencies.push(...this.getDependencies(conn.fromNode, visited));
    }

    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Get all dependents of a node (recursive)
   */
  getDependents(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);

    const dependents = [];
    const connections = this.getConnectionsFrom(nodeId);

    for (const conn of connections) {
      dependents.push(conn.toNode);
      dependents.push(...this.getDependents(conn.toNode, visited));
    }

    return [...new Set(dependents)]; // Remove duplicates
  }

  // ============ Dirty Tracking ============

  markNodeDirty(nodeId, reason = 'unspecified') {
    if (!nodeId) return;

    this.dirtyNodes.add(nodeId);

    // Mark all dependents as dirty too
    const dependents = this.getDependents(nodeId);
    for (const depId of dependents) {
      this.dirtyNodes.add(depId);
    }
  }

  markInputDirty(nodeId, inputNodeId) {
    if (!nodeId || !inputNodeId) return;

    if (!this.dirtyInputs.has(nodeId)) {
      this.dirtyInputs.set(nodeId, new Set());
    }

    this.dirtyInputs.get(nodeId).add(inputNodeId);
    this.markNodeDirty(nodeId, `input:${inputNodeId}`);
  }

  markNodeClean(nodeId) {
    this.dirtyNodes.delete(nodeId);
    this.dirtyInputs.delete(nodeId);
  }

  isNodeDirty(nodeId) {
    return this.dirtyNodes.has(nodeId) || this.dirtyInputs.has(nodeId);
  }

  getDirtyNodes() {
    return new Set(this.dirtyNodes);
  }

  clearDirtyFlags() {
    this.dirtyNodes.clear();
    this.dirtyInputs.clear();
  }

  markExecutionOrderDirty() {
    this.isExecutionOrderDirty = true;
  }

  // ============ Validation ============

  /**
   * Validate the entire graph
   */
  validate() {
    const errors = [];
    const warnings = [];

    // Check for cycles
    const cycleResult = this.detectCycles();
    if (cycleResult.hasCycle) {
      errors.push({
        type: 'CYCLE',
        message: 'Graph contains cycles',
        cycle: cycleResult.cycle
      });
    }

    // Check for missing nodes in connections
    for (const conn of this.connections) {
      const fromNode = this.getNode(conn.fromNode);
      const toNode = this.getNode(conn.toNode);

      if (!fromNode) {
        errors.push({
          type: 'MISSING_NODE',
          message: `Connection references missing source node: ${conn.fromNode}`,
          connection: conn
        });
      }

      if (!toNode) {
        errors.push({
          type: 'MISSING_NODE',
          message: `Connection references missing target node: ${conn.toNode}`,
          connection: conn
        });
      }
    }

    // Check for orphaned nodes
    const connectedNodes = new Set();
    for (const conn of this.connections) {
      connectedNodes.add(conn.fromNode);
      connectedNodes.add(conn.toNode);
    }

    for (const node of this.nodes) {
      if (node.id && !connectedNodes.has(node.id) && this.connections.length > 0) {
        warnings.push({
          type: 'ORPHANED_NODE',
          message: `Node is not connected: ${node.label || node.id}`,
          nodeId: node.id
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  // ============ Serialization ============

  toJSON() {
    return {
      version: 2, // Increment version for enhanced format
      nodes: this.nodes,
      connections: this.connections,
    };
  }

  static fromJSON(obj) {
    const g = new Graph();
    g.nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
    g.connections = Array.isArray(obj.connections) ? obj.connections : [];

    // Rebuild node map
    for (const node of g.nodes) {
      if (node && node.id) {
        g.nodeMap.set(node.id, node);
      }

      // Ensure defaults for CircleField nodes loaded from JSON
      if (node && node.kind === "CircleField") {
        node.props = node.props || {};
        if (typeof node.props.radius !== "number") node.props.radius = 0.25;
        if (typeof node.props.epsilon !== "number") node.props.epsilon = 0.01;
      }
    }

    // Mark all nodes as dirty initially
    for (const node of g.nodes) {
      if (node.id) {
        g.dirtyNodes.add(node.id);
      }
    }

    g.markExecutionOrderDirty();

    return g;
  }

  // ============ Utility Methods ============

  /**
   * Get graph statistics
   */
  getStats() {
    return {
      nodeCount: this.nodes.length,
      connectionCount: this.connections.length,
      dirtyNodeCount: this.dirtyNodes.size,
      hasCycles: this.detectCycles().hasCycle,
      executionOrderLength: this.getExecutionOrder().length
    };
  }

  /**
   * Clear the entire graph
   */
  clear() {
    this.nodes = [];
    this.connections = [];
    this.selection.clear();
    this.dirtyNodes.clear();
    this.dirtyInputs.clear();
    this.lastComputedInputs.clear();
    this.computedValueCache.clear();
    this.graphStructureHash = null;
    this.nodeMap.clear();
    this.executionOrder = [];
    this.isExecutionOrderDirty = true;
  }

  /**
   * Clone the graph
   */
  clone() {
    const cloned = new Graph();
    cloned.nodes = JSON.parse(JSON.stringify(this.nodes));
    cloned.connections = JSON.parse(JSON.stringify(this.connections));

    // Rebuild node map
    for (const node of cloned.nodes) {
      if (node.id) {
        cloned.nodeMap.set(node.id, node);
      }
    }

    cloned.markExecutionOrderDirty();
    return cloned;
  }
}
