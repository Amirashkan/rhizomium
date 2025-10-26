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

// Also modify processGraph to return validation info:
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
    
    console.log(`Graph processing completed: ${orderedNodes.length} nodes ordered, output node: ${outputNode?.id || 'none'}`);
    
    return { 
      orderedNodes, 
      outputNode,
      hasValidOutput: outputNode !== null // NEW
    };
  } catch (error) {
    window.errorHandler?.handleError(error, { 
      component: 'graph-processing',
      nodeCount: graph?.nodes?.length || 0
    });
    
    return { 
      orderedNodes: graph?.nodes || [], 
      outputNode: null,
      hasValidOutput: false // NEW
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
      
      console.log(`Graph processing completed: ${orderedNodes.length} nodes ordered, output node: ${outputNode?.id || 'none'}`);
      
      return { orderedNodes, outputNode };
    } catch (error) {
      window.errorHandler?.handleError(error, { 
        component: 'graph-processing',
        nodeCount: graph?.nodes?.length || 0
      });
      
      return { 
        orderedNodes: graph?.nodes || [], 
        outputNode: null 
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
          console.warn('Null node found in graph');
          continue;
        }
        
        if (typeof node.id === 'undefined') {
          console.warn('Node missing ID:', node);
          continue;
        }
        
        if (byId.has(node.id)) {
          console.warn(`Duplicate node ID found: ${node.id}`);
        }
        
        byId.set(node.id, node);
      }
      
      const visit = (id) => {
        try {
          if (!id || visited.has(id)) return;
          
          if (visiting.has(id)) {
            console.warn(`Circular dependency detected involving node: ${id}`);
            return;
          }
          
          visiting.add(id);
          
          const node = byId.get(id);
          if (!node) {
            console.warn(`Referenced node not found: ${id}`);
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
      
      console.log(`Topological sort completed: ${result.length} nodes ordered`);
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
        } catch (error) {
          console.warn('Error checking node for output pattern:', error);
          return false;
        }
      });
      
      if (outputs.length === 0) {
        console.log('No output nodes found in graph');
        return null;
      }
      
      const connected = outputs.filter((o) => {
        try {
          return Array.isArray(o.inputs) && o.inputs[0] !== null && o.inputs[0] !== undefined;
        } catch (error) {
          console.warn('Error checking output node connections:', error);
          return false;
        }
      });
      
      let selectedOutput;
      if (connected.length > 0) {
        selectedOutput = connected[connected.length - 1];
        console.log(`Selected connected output node: ${selectedOutput.id}`);
      } else {
        selectedOutput = outputs[outputs.length - 1];
        console.log(`Selected unconnected output node: ${selectedOutput.id}`);
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
        console.warn('Invalid ordered nodes array for filtering');
        return [];
      }
      
      if (!outputNode || !outputNode.id) {
        console.warn('Invalid output node for filtering');
        return orderedNodes;
      }
      
      if (!graph || !graph.nodes) {
        console.warn('Invalid graph for upstream filtering');
        return orderedNodes;
      }

      const byId = new Map();
      for (const node of graph.nodes) {
        if (node && node.id) {
          byId.set(node.id, node);
        }
      }
      
      const upstreamIds = this.getUpstreamSet(outputNode.id, byId);
      
      const filteredNodes = orderedNodes.filter((n) => {
        if (!n || !n.id) {
          console.warn('Invalid node in ordered nodes list');
          return false;
        }
        return upstreamIds.has(n.id);
      });
      
      console.log(`Filtered to ${filteredNodes.length} upstream nodes from ${orderedNodes.length} total`);
      return filteredNodes;
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
        console.warn('No start ID provided for upstream search');
        return new Set();
      }
      
      if (!byId || !(byId instanceof Map)) {
        console.warn('Invalid node lookup map for upstream search');
        return new Set();
      }

      const visited = new Set();
      const visiting = new Set();
      
      const dfs = (id) => {
        try {
          if (!id || visited.has(id)) return;
          
          if (visiting.has(id)) {
            console.warn(`Circular dependency detected in upstream search: ${id}`);
            return;
          }
          
          visiting.add(id);
          visited.add(id);
          
          const node = byId.get(id);
          if (!node) {
            console.warn(`Node not found in upstream search: ${id}`);
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
      
      console.log(`Found ${visited.size} upstream nodes from ${startId}`);
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
   * Log debug information about the graph processing
   * @param {Object} graph 
   * @param {Array} orderedNodes 
   */
  logDebugInfo(graph, orderedNodes) {
    try {
      console.log("=== DEBUG: All nodes before filtering ===");
      if (graph && graph.nodes && Array.isArray(graph.nodes)) {
        graph.nodes.forEach((node, index) => {
          if (!node) {
            console.log(`Node ${index}: NULL NODE`);
            return;
          }
          
          const id = node.id || 'NO_ID';
          const kind = node.kind || 'NO_KIND';
          const type = node.type || 'NO_TYPE';
          const name = node.name || 'NO_NAME';
          
          console.log(`Node ${id}: kind="${kind}" type="${type}" name="${name}"`);
        });
      } else {
        console.log("No valid nodes array found in graph");
      }

      console.log("=== DEBUG: Ordered nodes ===");
      if (orderedNodes && Array.isArray(orderedNodes)) {
        orderedNodes.forEach((node, index) => {
          if (!node) {
            console.log(`Ordered ${index}: NULL NODE`);
            return;
          }
          
          const id = node.id || 'NO_ID';
          const kind = node.kind || 'NO_KIND';
          
          console.log(`Ordered: ${id} -> kind="${kind}"`);
        });
      } else {
        console.log("No valid ordered nodes array");
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
      
      if (issues.length === 0) {
        console.log(`Graph validation passed: ${graph.nodes.length} nodes, ${nodeIds.size} unique IDs`);
      } else {
        console.warn(`Graph validation found ${issues.length} issues:`, issues);
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