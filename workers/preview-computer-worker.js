// workers/preview-computer-worker.js
// Web Worker for PreviewComputer - Offloads CPU-intensive preview computation

import { UnifiedExpressionSystem } from '../src/utils/UnifiedExpressionSystem.js';

let expressionSystem = null;
let nodeValueComputer = null;

// Initialize worker
self.onmessage = async (e) => {
  const { type, graph, timeContext, audioContext, id } = e.data;
  
  try {
    switch (type) {
      case 'init':
        // Initialize worker
        expressionSystem = new UnifiedExpressionSystem();
        // Note: NodeValueComputer would need to be adapted for worker context
        // For now, we'll implement basic computation here
        self.postMessage({ type: 'ready', id });
        break;
        
      case 'computePreviews':
        // Compute previews (CPU-intensive, runs in worker)
        const results = await computePreviews(graph, timeContext, audioContext);
        
        // Send results back (non-blocking)
        self.postMessage({
          type: 'previewResult',
          id,
          result: {
            previews: results,
            timestamp: performance.now()
          }
        });
        break;
        
      case 'heartbeat-request':
        // Respond to heartbeat immediately
        self.postMessage({
          type: 'heartbeat',
          timestamp: e.data.timestamp,
          workerTime: performance.now()
        });
        break;
        
      default:
        self.postMessage({
          type: 'error',
          id,
          error: `Unknown message type: ${type}`
        });
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      id,
      error: error.message,
      stack: error.stack
    });
  }
};

/**
 * Compute previews for all nodes in the graph
 */
async function computePreviews(graph, timeContext, audioContext) {
  const previews = new Map();
  
  // Build node map for dependency resolution
  const nodeMap = new Map();
  for (const node of graph.nodes) {
    nodeMap.set(node.id, node);
  }
  
  // Simple topological sort (basic implementation)
  const sortedNodes = topologicalSort(graph.nodes, graph.connections);
  
  // Compute preview for each node in dependency order
  const values = new Map();
  for (const node of sortedNodes) {
    try {
      const preview = await computeNodePreview(node, graph, timeContext, audioContext, values);
      values.set(node.id, preview);
      previews.set(node.id, preview);
    } catch (error) {
      console.error(`Error computing preview for node ${node.id}:`, error);
      previews.set(node.id, 0); // Default value on error
    }
  }
  
  return Object.fromEntries(previews);
}

/**
 * Compute preview for a single node
 */
async function computeNodePreview(node, graph, timeContext, audioContext, values) {
  // Build evaluation context
  const context = {
    time: timeContext.time || 0,
    frame: timeContext.frame || 0,
    deltaTime: timeContext.deltaTime || 0,
    audioEnvelope: audioContext.audioEnvelope || 0,
    audioEnvelopeBass: audioContext.audioEnvelopeBass || 0,
    audioEnvelopeMids: audioContext.audioEnvelopeMids || 0,
    audioEnvelopeHighs: audioContext.audioEnvelopeHighs || 0,
    PI: Math.PI,
    E: Math.E
  };
  
  // Add node values to context
  values.forEach((val, id) => {
    context[`node_${id}`] = val;
    if (Array.isArray(val)) {
      context[`node_${id}_x`] = val[0];
      context[`node_${id}_y`] = val[1];
      if (val.length > 2) context[`node_${id}_z`] = val[2];
      if (val.length > 3) context[`node_${id}_w`] = val[3];
    }
  });
  
  // Evaluate node parameters
  const evaluatedParams = {};
  for (const [paramName, paramValue] of Object.entries(node.params || {})) {
    evaluatedParams[paramName] = evaluateParameter(paramValue, context);
  }
  
  // Compute node output based on type
  return computeNodeOutput(node, evaluatedParams, context);
}

/**
 * Evaluate a parameter value
 */
function evaluateParameter(value, context) {
  // Already a number
  if (typeof value === 'number') {
    return value;
  }
  
  // String value
  if (typeof value !== 'string') {
    return 0;
  }
  
  const trimmed = value.trim();
  
  // Check if it's an expression
  const isExpression = trimmed.startsWith('=') || 
                       trimmed.includes('(') ||
                       trimmed.includes('time') ||
                       trimmed.includes('audioEnvelope');
  
  if (isExpression) {
    try {
      const expressionWithoutPrefix = trimmed.startsWith('=') ? trimmed.slice(1) : trimmed;
      const result = expressionSystem.evaluateCPU(expressionWithoutPrefix, context);
      return typeof result === 'number' ? result : 0;
    } catch (error) {
      return 0;
    }
  }
  
  // Try to parse as number
  const parsed = parseFloat(trimmed);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Compute node output based on node type
 */
function computeNodeOutput(node, params, context) {
  // Basic computation based on node type
  // This is a simplified version - full implementation would handle all node types
  switch (node.type) {
    case 'math_add':
      return (params.a || 0) + (params.b || 0);
    case 'math_multiply':
      return (params.a || 0) * (params.b || 0);
    case 'math_sin':
      return Math.sin(params.angle || 0);
    case 'math_cos':
      return Math.cos(params.angle || 0);
    case 'constant':
      return params.value || 0;
    default:
      // Default: return first parameter value or 0
      const firstParam = Object.values(params)[0];
      return typeof firstParam === 'number' ? firstParam : 0;
  }
}

/**
 * Simple topological sort
 */
function topologicalSort(nodes, connections) {
  const nodeMap = new Map();
  const inDegree = new Map();
  const adjList = new Map();
  
  // Initialize
  for (const node of nodes) {
    nodeMap.set(node.id, node);
    inDegree.set(node.id, 0);
    adjList.set(node.id, []);
  }
  
  // Build adjacency list and calculate in-degrees
  for (const conn of connections) {
    const from = conn.from.nodeId;
    const to = conn.to.nodeId;
    
    if (adjList.has(from) && adjList.has(to)) {
      adjList.get(from).push(to);
      inDegree.set(to, (inDegree.get(to) || 0) + 1);
    }
  }
  
  // Kahn's algorithm
  const queue = [];
  const result = [];
  
  // Find all nodes with in-degree 0
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }
  
  while (queue.length > 0) {
    const nodeId = queue.shift();
    result.push(nodeMap.get(nodeId));
    
    for (const neighbor of adjList.get(nodeId) || []) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }
  
  return result;
}

// Send periodic heartbeats
setInterval(() => {
  self.postMessage({
    type: 'heartbeat',
    timestamp: performance.now(),
    workerTime: performance.now()
  });
}, 1000); // Every second

