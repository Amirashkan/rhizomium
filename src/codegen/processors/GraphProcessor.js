// src/codegen/processors/GraphProcessor.js
export class GraphProcessor {
  /**
   * Process the graph to get ordered and filtered nodes
   * @param {Object} graph 
   * @returns {Object} { orderedNodes, outputNode }
   */
  processGraph(graph) {
    let orderedNodes = this.topologicalSort(graph);
    
    this.logDebugInfo(graph, orderedNodes);
    
    const outputNode = this.findActiveOutput(graph);
    
    if (outputNode) {
      orderedNodes = this.filterUpstreamNodes(orderedNodes, outputNode, graph);
    }
    
    return { orderedNodes, outputNode };
  }
  
  /**
   * Topological sort of nodes
   * @param {Object} graph 
   * @returns {Array} Sorted nodes
   */
  topologicalSort(graph) {
    const nodes = graph.nodes || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const visited = new Set();
    const result = [];
    
    const visit = (id) => {
      if (!id || visited.has(id)) return;
      visited.add(id);
      
      const node = byId.get(id);
      if (!node) return;
      
      // Visit all inputs first
      for (const input of node.inputs || []) {
        if (input) visit(input);
      }
      
      result.push(node);
    };
    
    for (const node of nodes) {
      visit(node.id);
    }
    
    return result;
  }
  
  /**
   * Find the active output node
   * @param {Object} graph 
   * @returns {Object|null} Output node
   */
  findActiveOutput(graph) {
    const outputs = (graph.nodes || []).filter((n) =>
      /OutputFinal/i.test(n.kind || n.type || n.name || "")
    );
    
    const connected = outputs.filter(
      (o) => Array.isArray(o.inputs) && o.inputs[0]
    );
    
    if (connected.length) {
      return connected[connected.length - 1];
    }
    
    return outputs[outputs.length - 1] || null;
  }
  
  /**
   * Filter nodes to only include those upstream from output
   * @param {Array} orderedNodes 
   * @param {Object} outputNode 
   * @param {Object} graph 
   * @returns {Array} Filtered nodes
   */
  filterUpstreamNodes(orderedNodes, outputNode, graph) {
    const byId = new Map((graph.nodes || []).map((n) => [n.id, n]));
    const upstreamIds = this.getUpstreamSet(outputNode.id, byId);
    
    return orderedNodes.filter((n) => upstreamIds.has(n.id));
  }
  
  /**
   * Get all upstream node IDs from a starting node
   * @param {string} startId 
   * @param {Map} byId 
   * @returns {Set} Set of upstream node IDs
   */
  getUpstreamSet(startId, byId) {
    const visited = new Set();
    
    const dfs = (id) => {
      if (!id || visited.has(id)) return;
      visited.add(id);
      
      const node = byId.get(id);
      if (!node) return;
      
      for (const input of node.inputs || []) {
        if (input) dfs(input);
      }
    };
    
    dfs(startId);
    return visited;
  }
  
  /**
   * Log debug information about the graph processing
   * @param {Object} graph 
   * @param {Array} orderedNodes 
   */
  logDebugInfo(graph, orderedNodes) {
    console.log("=== DEBUG: All nodes before filtering ===");
    if (graph.nodes) {
      graph.nodes.forEach((node) => {
        console.log(
          `Node ${node.id}: kind="${node.kind}" type="${node.type}" name="${node.name}"`
        );
      });
    }

    console.log("=== DEBUG: Ordered nodes ===");
    orderedNodes.forEach((node) => {
      console.log(`Ordered: ${node.id} -> kind="${node.kind}"`);
    });
  }
}