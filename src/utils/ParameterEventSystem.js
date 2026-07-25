// src/utils/ParameterEventSystem.js
export class ParameterEventSystem {
  constructor() {
    this.listeners = new Map();
    this.debugMode = false; // Set to true for debugging
  }

  // Subscribe to parameter change events
  on(eventType, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType).add(callback);
    
    return () => {
      // Return unsubscribe function
      if (this.listeners.has(eventType)) {
        this.listeners.get(eventType).delete(callback);
      }
    };
  }

  // Emit parameter change events
  emit(eventType, data) {
    
    if (this.listeners.has(eventType)) {
      this.listeners.get(eventType).forEach(callback => {
        try {
          callback(data);
        } catch (error) {

        }
      });
    }
  }

  // NEW: Emit with immediate execution (no debouncing)
  emitImmediate(eventType, data) {
    this.emit(eventType, { ...data, immediate: true });
  }

  // Remove all listeners for an event type
  off(eventType) {
    if (this.listeners.has(eventType)) {
      this.listeners.get(eventType).clear();
    }
  }

  // Clear all listeners
  clear() {
    this.listeners.clear();
  }

  // NEW: Enable debug logging
  enableDebug(enabled = true) {
    this.debugMode = enabled;
  }
}

// Event types
export const ParameterEvents = {
  PARAMETER_CHANGED: 'parameter_changed',
  PARAMETER_UNDONE: 'parameter_undone',
  PARAMETER_REDONE: 'parameter_redone',
  NODE_PARAMETERS_RESET: 'node_parameters_reset',
  
  // NEW: Expression-specific events
  EXPRESSION_EVALUATING: 'expression_evaluating',
  EXPRESSION_EVALUATED: 'expression_evaluated',
  EXPRESSION_ERROR: 'expression_error',
  
  // NEW: Preview-specific events
  PREVIEW_UPDATE_REQUESTED: 'preview_update_requested',
  PREVIEW_UPDATE_COMPLETE: 'preview_update_complete',
  
  // NEW: Node state events
  NODE_DIRTY: 'node_dirty',
  NODE_CLEAN: 'node_clean'
};