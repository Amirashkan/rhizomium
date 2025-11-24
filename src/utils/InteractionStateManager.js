/**
 * InteractionStateManager.js
 * 
 * Centralized manager for interaction state across the application.
 * All systems check this manager before performing expensive operations.
 */

export class InteractionStateManager {
  constructor() {
    // Interaction states
    this.isPanning = false;
    this.isDragging = false;
    this.isZooming = false;
    this.isInteracting = false; // Any interaction active
    
    // State change callbacks
    this.callbacks = new Set();
    
    // Throttling decisions
    this.shouldThrottle = {
      timeline: false,
      uiPanels: false,
      backgroundWarmup: false,
      preview: false
    };
  }
  
  /**
   * Set panning state
   */
  setPanning(isPanning) {
    if (this.isPanning !== isPanning) {
      this.isPanning = isPanning;
      this._updateInteractionState();
      this._updateThrottling();
      this._notifyCallbacks('panning', isPanning);
    }
  }
  
  /**
   * Set dragging state
   */
  setDragging(isDragging) {
    if (this.isDragging !== isDragging) {
      this.isDragging = isDragging;
      this._updateInteractionState();
      this._updateThrottling();
      this._notifyCallbacks('dragging', isDragging);
    }
  }
  
  /**
   * Set zooming state
   */
  setZooming(isZooming) {
    if (this.isZooming !== isZooming) {
      this.isZooming = isZooming;
      this._updateInteractionState();
      this._updateThrottling();
      this._notifyCallbacks('zooming', isZooming);
    }
  }
  
  /**
   * Update overall interaction state
   */
  _updateInteractionState() {
    const wasInteracting = this.isInteracting;
    this.isInteracting = this.isPanning || this.isDragging || this.isZooming;
    
    if (wasInteracting !== this.isInteracting) {
      this._notifyCallbacks('interaction', this.isInteracting);
    }
  }
  
  /**
   * Update throttling decisions based on current state
   */
  _updateThrottling() {
    // During panning: skip non-critical updates
    if (this.isPanning) {
      this.shouldThrottle.timeline = true;
      this.shouldThrottle.uiPanels = true;
      this.shouldThrottle.backgroundWarmup = true;
      this.shouldThrottle.preview = false; // Keep preview running but at lower quality
    }
    // During dragging: similar to panning
    else if (this.isDragging) {
      this.shouldThrottle.timeline = true;
      this.shouldThrottle.uiPanels = true;
      this.shouldThrottle.backgroundWarmup = true;
      this.shouldThrottle.preview = false;
    }
    // During zooming: less aggressive throttling
    else if (this.isZooming) {
      this.shouldThrottle.timeline = false;
      this.shouldThrottle.uiPanels = false;
      this.shouldThrottle.backgroundWarmup = true;
      this.shouldThrottle.preview = false;
    }
    // No interaction: no throttling
    else {
      this.shouldThrottle.timeline = false;
      this.shouldThrottle.uiPanels = false;
      this.shouldThrottle.backgroundWarmup = false;
      this.shouldThrottle.preview = false;
    }
  }
  
  /**
   * Check if a specific operation should be throttled
   */
  shouldThrottleOperation(operation) {
    return this.shouldThrottle[operation] || false;
  }
  
  /**
   * Check if any interaction is active
   */
  isAnyInteractionActive() {
    return this.isInteracting;
  }
  
  /**
   * Get current interaction state
   */
  getState() {
    return {
      isPanning: this.isPanning,
      isDragging: this.isDragging,
      isZooming: this.isZooming,
      isInteracting: this.isInteracting,
      shouldThrottle: { ...this.shouldThrottle }
    };
  }
  
  /**
   * Register a callback for state changes
   */
  onStateChange(callback) {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }
  
  /**
   * Notify all callbacks of state change
   */
  _notifyCallbacks(type, value) {
    this.callbacks.forEach(callback => {
      try {
        callback(type, value, this.getState());
      } catch (error) {
        console.error('[InteractionStateManager] Callback error:', error);
      }
    });
  }
}

// Singleton instance
let instance = null;

export function getInteractionStateManager() {
  if (!instance) {
    instance = new InteractionStateManager();
  }
  return instance;
}

