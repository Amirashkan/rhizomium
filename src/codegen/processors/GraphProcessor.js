// src/codegen/processors/GraphProcessor.js
// UPDATED: Orchestrates function-based compilation

export class GraphProcessor {
  // Add this method to your GraphProcessor class:

/**
 * Validate that graph has a valid output node before compilation
 * @param {Object} graph 
 * @returns {Object} { valid: boolean, message: string }
 */
validateForCompilation(graph) {
  try {
    if (!graph || !graph.nodes || !Array.isArray(graph.nodes)) {
      return {
        valid: false,
        message: 'Invalid graph structure'
      };
    }

    const outputNode = this.findActiveOutput(graph);
    
    if (!outputNode) {
      return {
        valid: false,
        message: 'No output node found in graph'
      };
    }

    // Check if output node is connected
    const hasConnection = Array.isArray(outputNode.inputs) && 
                         outputNode.inputs[0] !== null && 
                         outputNode.inputs[0] !== undefined;
    
    if (!hasConnection) {
      return {
        valid: false,
        message: 'Output node is not connected'
      };
    }

    return {
      valid: true,
      outputNode: outputNode
    };
    
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'graph-validation-for-compilation'
    });
    return {
      valid: false,
      message: 'Validation error: ' + error.message
    };
  }
}

  constructor() {
    this.functionDefinitions = []; // Collect all function definitions
    this.helperFunctions = new Set(); // Collect all helper functions needed
  }

  /**
   * Process the graph to get ordered and filtered nodes
   * @param {Object} graph 
   * @returns {Object} { orderedNodes, outputNode }
   */
  processGraph(graph) {
    try {
      if (!graph) {
        throw new Error('Graph is required for processing');
      }

      if (!graph.nodes || !Array.isArray(graph.nodes)) {
        throw new Error('Graph must have a nodes array');
      }

      let orderedNodes = this.topologicalSort(graph);
      
      this.logDebugInfo(graph, orderedNodes);
      
      const outputNode = this.findActiveOutput(graph);
      
      if (outputNode) {
        orderedNodes = this.filterUpstreamNodes(orderedNodes, outputNode, graph);
      }

      return {
        orderedNodes,
        outputNode,
        hasValidOutput: outputNode !== null
      };
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'graph-processing',
        nodeCount: graph?.nodes?.length || 0
      });

      return {
        orderedNodes: graph?.nodes || [],
        outputNode: null,
        hasValidOutput: false
      };
    }
  }

  /**
   * NEW: Collect function definitions and helper functions from compilation results
   */
  collectFunctionsFromCompilation(compiledNode) {
    if (!compiledNode) return;

    // Collect function definition if present (from shape nodes)
    if (compiledNode.functionDef) {
      this.functionDefinitions.push(compiledNode.functionDef);
    }

    // Collect helper function names if present (from transform nodes)
    if (compiledNode.helpers && Array.isArray(compiledNode.helpers)) {
      compiledNode.helpers.forEach(helper => this.helperFunctions.add(helper));
    }
  }

  /**
   * NEW: Get all collected function definitions as a single string
   */
  getAllFunctionDefinitions() {
    return this.functionDefinitions.join('\n\n');
  }

  /**
   * NEW: Get all helper function names that were used
   */
  getNeededHelpers() {
    return Array.from(this.helperFunctions);
  }

  /**
   * NEW: Clear function collection (call before each compilation)
   */
  clearFunctionCollection() {
    this.functionDefinitions = [];
    this.helperFunctions.clear();
  }
  
  /**
   * Topological sort of nodes
   * @param {Object} graph 
   * @returns {Array} Sorted nodes
   */
  topologicalSort(graph) {
    try {
      if (!graph || !graph.nodes) {
        return [];
      }

      const nodes = graph.nodes || [];
      const byId = new Map();
      const visited = new Set();
      const visiting = new Set();
      const result = [];
      
      for (const node of nodes) {
        if (!node) {

          continue;
        }
        
        if (typeof node.id === 'undefined') {

          continue;
        }
        
        
        byId.set(node.id, node);
      }
      
      const visit = (id) => {
        try {
          if (!id || visited.has(id)) return;
          
          if (visiting.has(id)) {

            return;
          }
          
          visiting.add(id);
          
          const node = byId.get(id);
          if (!node) {

            visiting.delete(id);
            return;
          }
          
          if (node.inputs && Array.isArray(node.inputs)) {
            for (const input of node.inputs) {
              if (input !== null && input !== undefined) {
                visit(input);
              }
            }
          }
          
          visiting.delete(id);
          visited.add(id);
          result.push(node);
        } catch (error) {
          window.errorHandler?.handleError(error, { 
            component: 'topological-sort-visit',
            nodeId: id
          });
          visiting.delete(id);
        }
      };
      
      for (const node of nodes) {
        if (node && node.id) {
          visit(node.id);
        }
      }

      return result;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'topological-sort',
        nodeCount: graph?.nodes?.length || 0
      });
      return graph?.nodes || [];
    }
  }
  
  /**
   * Find the active output node
   * @param {Object} graph 
   * @returns {Object|null} Output node
   */
  findActiveOutput(graph) {
    try {
      if (!graph || !graph.nodes || !Array.isArray(graph.nodes)) {
        return null;
      }

      const nodes = graph.nodes.filter(n => n && (n.kind || n.type || n.name));
      
      const outputs = nodes.filter((n) => {
        try {
          const identifier = n.kind || n.type || n.name || "";
          return /OutputFinal/i.test(identifier);
        } catch {

          return false;
        }
      });
      
      if (outputs.length === 0) {

        return null;
      }
      
      const connected = outputs.filter((o) => {
        try {
          return Array.isArray(o.inputs) && o.inputs[0] !== null && o.inputs[0] !== undefined;
        } catch {

          return false;
        }
      });
      
      let selectedOutput;
      if (connected.length > 0) {
        selectedOutput = connected[connected.length - 1];

      } else {
        selectedOutput = outputs[outputs.length - 1];

      }
      
      return selectedOutput;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'find-active-output',
        nodeCount: graph?.nodes?.length || 0
      });
      return null;
    }
  }
  
  /**
   * Filter nodes to only include those upstream from output
   * @param {Array} orderedNodes 
   * @param {Object} outputNode 
   * @param {Object} graph 
   * @returns {Array} Filtered nodes
   */
  filterUpstreamNodes(orderedNodes, outputNode, graph) {
    try {
      if (!orderedNodes || !Array.isArray(orderedNodes)) {

        return [];
      }

      if (!outputNode || !outputNode.id) {

        return orderedNodes;
      }

      if (!graph || !graph.nodes) {

        return orderedNodes;
      }

      const byId = new Map();
      for (const node of graph.nodes) {
        if (node && node.id) {
          byId.set(node.id, node);
        }
      }

      // Get initial upstream nodes from connections
      const upstreamIds = this.getUpstreamSet(outputNode.id, byId);

      // Expand the set to include nodes referenced in parameter expressions
      const expandedIds = this.collectExpressionReferencedNodes(upstreamIds, byId);

      const filteredNodes = orderedNodes.filter((n) => {
        if (!n || !n.id) {

          return false;
        }
        return expandedIds.has(n.id);
      });


      // Re-sort to ensure expression-referenced nodes come before nodes that reference them
      const resortedNodes = this.resortWithExpressionDependencies(filteredNodes, byId);

      return resortedNodes;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'filter-upstream-nodes',
        orderedCount: orderedNodes?.length || 0,
        outputNodeId: outputNode?.id
      });
      return orderedNodes || [];
    }
  }
  
  /**
   * Get all upstream node IDs from a starting node
   * @param {string} startId 
   * @param {Map} byId 
   * @returns {Set} Set of upstream node IDs
   */
  getUpstreamSet(startId, byId) {
    try {
      if (!startId) {

        return new Set();
      }
      
      if (!byId || !(byId instanceof Map)) {

        return new Set();
      }

      const visited = new Set();
      const visiting = new Set();
      
      const dfs = (id) => {
        try {
          if (!id || visited.has(id)) return;
          
          if (visiting.has(id)) {

            return;
          }
          
          visiting.add(id);
          visited.add(id);
          
          const node = byId.get(id);
          if (!node) {

            visiting.delete(id);
            return;
          }
          
          if (node.inputs && Array.isArray(node.inputs)) {
            for (const input of node.inputs) {
              if (input !== null && input !== undefined) {
                dfs(input);
              }
            }
          }
          
          visiting.delete(id);
        } catch (error) {
          window.errorHandler?.handleError(error, { 
            component: 'upstream-dfs',
            nodeId: id,
            startId: startId
          });
          visiting.delete(id);
        }
      };
      
      dfs(startId);

      return visited;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'get-upstream-set',
        startId: startId
      });
      return new Set();
    }
  }
  
  /**
   * Extract node IDs referenced in a parameter expression
   *
   * This method analyzes parameter values that contain expressions (starting with =)
   * and extracts all node references in the format "node_<id>".
   *
   * Examples:
   *   "=node_5" -> ["5"]
   *   "=sin(node_3) * 2" -> ["3"]
   *   "=node_10_x + node_20_y" -> ["10", "20"]
   *   "0.5" -> [] (not an expression)
   *
   * This enables automatic inclusion of nodes referenced in expressions during
   * shader compilation, even if they're not directly connected via node.inputs.
   *
   * @param {string} paramValue - Parameter value (e.g., "=node_5" or "=sin(node_3)")
   * @returns {Array<string>} Array of node IDs found in the expression
   */
  extractNodeReferencesFromExpression(paramValue) {
    try {
      if (!paramValue || typeof paramValue !== 'string') {
        return [];
      }

      // Check if it's an expression (starts with =)
      if (!paramValue.trim().startsWith('=')) {
        return [];
      }

      // Extract the expression part after =
      const expression = paramValue.trim().slice(1);

      // Match all node references in the format: node_<id> or node_<id>_rgba, etc.
      // This regex captures node_123, node_5, node_27_rgba, etc.
      // It extracts only the numeric ID part, stopping at suffixes like _rgba, _xyz, etc.
      const nodeRefPattern = /node_(\d+)(?:_\w+)?/g;
      const matches = expression.matchAll(nodeRefPattern);

      const nodeIds = [];
      for (const match of matches) {
        const nodeIdStr = match[1]; // Extract the captured group (the ID as string)

        // Keep IDs as strings to match how they're stored in the graph
        // Node IDs are always strings in the graph (e.g., "15", not 15)
        nodeIds.push(nodeIdStr);
      }

      return nodeIds;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'extract-node-references',
        paramValue: paramValue
      });
      return [];
    }
  }

  /**
   * Recursively collect all nodes referenced in parameter expressions
   *
   * This method expands a set of node IDs by scanning their parameters for
   * expression references to other nodes. It recursively processes newly
   * discovered nodes to ensure transitive dependencies are included.
   *
   * Algorithm:
   * 1. Start with the initial set of connected nodes
   * 2. For each node, scan all parameters for expressions
   * 3. Extract node references from those expressions
   * 4. Add newly discovered nodes to the set and queue for processing
   * 5. Repeat until no new nodes are discovered
   *
   * Example scenario:
   *   Node A (output) -> Node B (has param "strength" = "=node_C")
   *   Node C (isolated, not connected)
   *
   *   Without this method: Only A and B would be compiled
   *   With this method: A, B, and C are all compiled
   *
   * @param {Set} currentSet - Current set of node IDs to expand
   * @param {Map} byId - Map of node ID to node object
   * @returns {Set} Expanded set including expression-referenced nodes
   */
  collectExpressionReferencedNodes(currentSet, byId) {
    try {
      const expanded = new Set(currentSet);
      const toProcess = Array.from(currentSet);
      const processed = new Set();

      while (toProcess.length > 0) {
        const nodeId = toProcess.shift();

        if (processed.has(nodeId)) {
          continue;
        }
        processed.add(nodeId);

        const node = byId.get(nodeId);
        if (!node) {
          continue;
        }

        // Scan all parameters for expression references
        if (node.params && typeof node.params === 'object') {
          for (const [paramName, paramValue] of Object.entries(node.params)) {
            const referencedIds = this.extractNodeReferencesFromExpression(paramValue);

            for (const refId of referencedIds) {
              if (!expanded.has(refId)) {
                // Verify the node exists before adding
                const referencedNode = byId.get(refId);
                if (referencedNode) {
                  expanded.add(refId);
                  toProcess.push(refId);

                  // CRITICAL: Also add all upstream dependencies of this referenced node
                  // When node A references node B in an expression, we need node B AND all of B's inputs
                  const upstreamOfReferenced = this.getUpstreamSet(refId, byId);
                  for (const upstreamId of upstreamOfReferenced) {
                    if (!expanded.has(upstreamId)) {
                      expanded.add(upstreamId);
                      toProcess.push(upstreamId);
                    }
                  }
                }
              }
            }
          }
        }
      }


      return expanded;
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'collect-expression-referenced-nodes',
        currentSetSize: currentSet?.size
      });
      return currentSet;
    }
  }

  /**
   * Re-sort nodes to respect expression dependencies
   *
   * This method performs a topological sort on the filtered nodes,
   * taking into account both graph edge dependencies AND expression
   * dependencies (e.g., node A referencing node B in a parameter).
   *
   * @param {Array} nodes - Filtered nodes to re-sort
   * @param {Map} byId - Map of node ID to node object
   * @returns {Array} Nodes sorted in dependency order
   */
  resortWithExpressionDependencies(nodes, __byId) {
    try {
      if (!nodes || nodes.length === 0) {
        return nodes;
      }

      const nodeIds = new Set(nodes.map(n => n.id));

      // Build dependency map: node -> Set of nodes it depends on
      const dependencies = new Map();

      for (const node of nodes) {
        const deps = new Set();

        // Add edge-based dependencies (from inputs)
        if (node.inputs && Array.isArray(node.inputs)) {
          for (const inputId of node.inputs) {
            if (inputId && nodeIds.has(inputId)) {
              deps.add(inputId);
            }
          }
        }

        // Add expression-based dependencies
        if (node.params && typeof node.params === 'object') {
          for (const paramValue of Object.values(node.params)) {
            const referencedIds = this.extractNodeReferencesFromExpression(paramValue);
            for (const refId of referencedIds) {
              if (nodeIds.has(refId)) {
                deps.add(refId);
              }
            }
          }
        }

        dependencies.set(node.id, deps);
      }

      // Topological sort using Kahn's algorithm
      const sorted = [];
      const inDegree = new Map();

      // Calculate in-degrees
      for (const node of nodes) {
        inDegree.set(node.id, 0);
      }

      for (const [nodeId, deps] of dependencies.entries()) {
        for (const depId of deps) {
          inDegree.set(depId, (inDegree.get(depId) || 0));
          inDegree.set(nodeId, (inDegree.get(nodeId) || 0) + 1);
        }
      }

      // Queue nodes with no dependencies
      const queue = [];
      for (const node of nodes) {
        if (inDegree.get(node.id) === 0) {
          queue.push(node);
        }
      }

      // Process queue
      while (queue.length > 0) {
        const node = queue.shift();
        sorted.push(node);

        // Reduce in-degree for dependent nodes
        for (const otherNode of nodes) {
          const deps = dependencies.get(otherNode.id);
          if (deps && deps.has(node.id)) {
            const newDegree = inDegree.get(otherNode.id) - 1;
            inDegree.set(otherNode.id, newDegree);
            if (newDegree === 0) {
              queue.push(otherNode);
            }
          }
        }
      }

      // Check for cycles
      if (sorted.length !== nodes.length) {

        // Add remaining nodes in original order
        for (const node of nodes) {
          if (!sorted.includes(node)) {
            sorted.push(node);
          }
        }
      }

      return sorted;

    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'resort-with-expression-dependencies',
        nodeCount: nodes?.length
      });
      return nodes;
    }
  }

  /**
   * Find all downstream nodes that depend on a given node
   * Includes both edge-based dependencies (inputs) and expression-based dependencies
   *
   * @param {string} nodeId - The node ID to find downstream nodes for
   * @param {Array} allNodes - All nodes in the graph
   * @returns {Array} Downstream nodes
   */
  findDownstreamNodes(nodeId, allNodes) {
    try {
      if (!nodeId || !allNodes || !Array.isArray(allNodes)) {
        return [];
      }

      return allNodes.filter(node => {
        if (!node || node.id === nodeId) {
          return false;
        }

        // Check edge-based dependency (inputs)
        if (node.inputs && Array.isArray(node.inputs) && node.inputs.includes(nodeId)) {
          return true;
        }

        // Check expression-based dependency (parameters)
        if (node.params && typeof node.params === 'object') {
          for (const paramValue of Object.values(node.params)) {
            const referencedIds = this.extractNodeReferencesFromExpression(paramValue);
            if (referencedIds.includes(nodeId)) {
              return true;
            }
          }
        }

        return false;
      });
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'find-downstream-nodes',
        nodeId: nodeId
      });
      return [];
    }
  }

  /**
   * Log debug information about the graph processing
   * @param {Object} graph
   * @param {Array} orderedNodes
   */
  logDebugInfo(graph, orderedNodes) {
    try {

      if (graph && graph.nodes && Array.isArray(graph.nodes)) {
        graph.nodes.forEach((node, __index) => {
          if (!node) {

            return;
          }
          
          const id = node.id || 'NO_ID';
          const kind = node.kind || 'NO_KIND';
          const type = node.type || 'NO_TYPE';
          const name = node.name || 'NO_NAME';

        });
      }

      if (orderedNodes && Array.isArray(orderedNodes)) {
        orderedNodes.forEach((node, __index) => {
          if (!node) {

            return;
          }
          
          const id = node.id || 'NO_ID';
          const kind = node.kind || 'NO_KIND';

        });
      }
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'debug-logging',
        nodeCount: graph?.nodes?.length || 0,
        orderedCount: orderedNodes?.length || 0
      });
    }
  }
  
  /**
   * Validate graph integrity and report issues
   * @param {Object} graph 
   * @returns {Array} Array of validation issues
   */
  validateGraph(graph) {
    try {
      const issues = [];
      
      if (!graph) {
        issues.push('Graph is null or undefined');
        return issues;
      }
      
      if (!graph.nodes) {
        issues.push('Graph missing nodes property');
        return issues;
      }
      
      if (!Array.isArray(graph.nodes)) {
        issues.push('Graph nodes is not an array');
        return issues;
      }
      
      const nodeIds = new Set();
      const nullNodes = [];
      const duplicateIds = [];
      const missingIds = [];
      const invalidConnections = [];
      
      graph.nodes.forEach((node, index) => {
        if (!node) {
          nullNodes.push(index);
          return;
        }
        
        if (typeof node.id === 'undefined') {
          missingIds.push(index);
          return;
        }
        
        if (nodeIds.has(node.id)) {
          duplicateIds.push(node.id);
        } else {
          nodeIds.add(node.id);
        }
        
        if (node.inputs && Array.isArray(node.inputs)) {
          node.inputs.forEach((input, inputIndex) => {
            if (input !== null && input !== undefined && !nodeIds.has(input)) {
              invalidConnections.push({
                nodeId: node.id,
                inputIndex: inputIndex,
                referencedId: input
              });
            }
          });
        }
      });
      
      if (nullNodes.length > 0) {
        issues.push(`Found ${nullNodes.length} null nodes at indices: ${nullNodes.join(', ')}`);
      }
      
      if (missingIds.length > 0) {
        issues.push(`Found ${missingIds.length} nodes missing IDs at indices: ${missingIds.join(', ')}`);
      }
      
      if (duplicateIds.length > 0) {
        issues.push(`Found duplicate node IDs: ${duplicateIds.join(', ')}`);
      }
      
      if (invalidConnections.length > 0) {
        issues.push(`Found ${invalidConnections.length} invalid connections`);
        invalidConnections.forEach(conn => {
          issues.push(`  Node ${conn.nodeId} input[${conn.inputIndex}] references non-existent node: ${conn.referencedId}`);
        });
      }
      
      
      return issues;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'graph-validation',
        nodeCount: graph?.nodes?.length || 0
      });
      return ['Validation failed due to error: ' + error.message];
    }
  }
  
  /**
   * Get graph statistics for debugging
   * @param {Object} graph 
   * @returns {Object} Graph statistics
   */
  getGraphStats(graph) {
    try {
      if (!graph || !graph.nodes) {
        return { 
          nodeCount: 0, 
          connectionCount: 0, 
          outputNodes: 0,
          error: 'Invalid graph'
        };
      }
      
      const stats = {
        nodeCount: graph.nodes.length,
        connectionCount: 0,
        outputNodes: 0,
        nodeTypes: {},
        maxDepth: 0,
        isolatedNodes: 0
      };
      
      const validNodes = graph.nodes.filter(n => n && n.id);
      stats.validNodes = validNodes.length;
      
      validNodes.forEach(node => {
        const nodeType = node.kind || node.type || 'Unknown';
        stats.nodeTypes[nodeType] = (stats.nodeTypes[nodeType] || 0) + 1;
        
        if (node.inputs && Array.isArray(node.inputs)) {
          const validInputs = node.inputs.filter(input => input !== null && input !== undefined);
          stats.connectionCount += validInputs.length;
        }
        
        if (/OutputFinal/i.test(nodeType)) {
          stats.outputNodes++;
        }
      });
      
      return stats;
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'graph-stats',
        nodeCount: graph?.nodes?.length || 0
      });
      return { error: error.message };
    }
  }
}