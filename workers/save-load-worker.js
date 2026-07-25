// workers/save-load-worker.js
// Web Worker for SaveLoadManager - Offloads file I/O and serialization

self.onmessage = async (e) => {
  const { type, graph, data, id } = e.data;
  
  try {
    switch (type) {
      case 'init':
        self.postMessage({ type: 'ready', id });
        break;
        
      case 'serialize': {
        // Serialize graph to JSON
        const serialized = await serializeGraph(graph);
        self.postMessage({
          type: 'result',
          id,
          result: serialized // Return the serialized string directly
        });
        break;
      }
        
      case 'deserialize': {
        // Deserialize JSON to graph
        const deserialized = await deserializeGraph(data);
        self.postMessage({
          type: 'result',
          id,
          result: { graph: deserialized }
        });
        break;
      }
        
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
 * Serialize graph to JSON
 */
async function serializeGraph(graph) {
  // Deep clone to avoid modifying original
  const cloned = JSON.parse(JSON.stringify({
    nodes: graph.nodes || [],
    connections: graph.connections || [],
    metadata: graph.metadata || {}
  }));
  
  // Serialize to JSON string with formatting
  return JSON.stringify(cloned, null, 2);
}

/**
 * Deserialize JSON to graph
 */
async function deserializeGraph(data) {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return {
      nodes: parsed.nodes || [],
      connections: parsed.connections || [],
      metadata: parsed.metadata || {}
    };
  } catch (error) {
    throw new Error(`Failed to deserialize graph: ${error.message}`);
  }
}

// Send periodic heartbeats
setInterval(() => {
  self.postMessage({
    type: 'heartbeat',
    timestamp: performance.now(),
    workerTime: performance.now()
  });
}, 1000); // Every second

