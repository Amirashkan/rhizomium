// workers/undo-manager-worker.js
// Web Worker for UndoManager - Offloads history management

let undoStack = [];
let redoStack = [];
let currentVersion = 0;
let maxHistorySize = 100;

self.onmessage = async (e) => {
  const { type, snapshot, version, id } = e.data;
  
  try {
    switch (type) {
      case 'init':
        undoStack = [];
        redoStack = [];
        currentVersion = 0;
        self.postMessage({ type: 'ready', id });
        startHeartbeat();
        break;
        
      case 'recordState':
        // Record state snapshot
        await recordState(snapshot, version);
        self.postMessage({
          type: 'result',
          id,
          result: { success: true, version: currentVersion }
        });
        break;
        
      case 'undo':
        // Get previous state
        const previousState = await undo(version);
        self.postMessage({
          type: 'result',
          id,
          result: previousState
        });
        break;
        
      case 'redo':
        // Get next state
        const nextState = await redo(version);
        self.postMessage({
          type: 'result',
          id,
          result: nextState
        });
        break;
        
      case 'canUndo':
        self.postMessage({
          type: 'result',
          id,
          result: { canUndo: undoStack.length > 0 }
        });
        break;
        
      case 'canRedo':
        self.postMessage({
          type: 'result',
          id,
          result: { canRedo: redoStack.length > 0 }
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
 * Record state snapshot
 */
async function recordState(snapshot, version) {
  // Clear redo stack on new action
  redoStack = [];
  
  // Add to undo stack
  undoStack.push({
    version: version || ++currentVersion,
    snapshot: JSON.parse(JSON.stringify(snapshot)), // Deep clone
    timestamp: performance.now()
  });
  
  // Limit history size
  if (undoStack.length > maxHistorySize) {
    undoStack.shift(); // Remove oldest
  }
  
  currentVersion = version || currentVersion;
}

/**
 * Undo operation
 */
async function undo(currentVersion) {
  if (undoStack.length === 0) {
    return null;
  }
  
  // Pop from undo stack
  const state = undoStack.pop();
  
  // Push current state to redo stack
  // Note: In a real implementation, we'd need the current state
  // For now, we'll just return the previous state
  
  return {
    version: state.version,
    snapshot: state.snapshot
  };
}

/**
 * Redo operation
 */
async function redo(currentVersion) {
  if (redoStack.length === 0) {
    return null;
  }
  
  // Pop from redo stack
  const state = redoStack.pop();
  
  // Push current state to undo stack
  // Note: In a real implementation, we'd need the current state
  
  return {
    version: state.version,
    snapshot: state.snapshot
  };
}

let heartbeatStarted = false;
function startHeartbeat() {
  if (heartbeatStarted) return;
  heartbeatStarted = true;
  setInterval(() => {
    self.postMessage({
      type: 'heartbeat',
      timestamp: performance.now(),
      workerTime: performance.now()
    });
  }, 1000);
}

