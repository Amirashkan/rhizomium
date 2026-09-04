/**
 * InteractionStateManager.js
 * 
 * Centralized manager for interaction state across the application.
 * Single source of truth for interaction state with event emission,
 * duration tracking, and cooldown mechanism.
 */

export class InteractionStateManager {
  constructor() {
    // Interaction states
    this.isPanning = false;
    this.isDragging = false;
    this.isZooming = false;
    this.isEditing = false;
    this.isInteracting = false; // Any interaction active
    
    // Interaction tracking
    this.currentInteractionType = null; // 'panning', 'dragging', 'zooming', or null
    this.interactionStartTime = null;
    this.interactionDuration = 0;
    this.lastInteractionEndTime = null;
    
    // Interaction history for metrics
    this.interactionHistory = [];
    this.maxHistorySize = 100;
    
    // Cooldown mechanism
    this.cooldownActive = false;
    this.cooldownStartTime = null;
    this.cooldownDuration = 500; // ms
    this.qualityRestoreSteps = 5; // Number of steps to restore quality
    this.qualityRestoreInterval = 100; // ms between steps
    this.currentQualityLevel = 1.0; // 0.0 to 1.0
    this.targetQualityLevel = 1.0;
    this.qualityRestoreTimer = null;
    
    // Event listeners
    this.eventListeners = new Map(); // eventType -> Set of callbacks
    this.callbacks = new Set(); // Legacy callback support
    
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
      if (isPanning) {
        this._startInteraction('panning');
      } else {
        this._endInteraction('panning');
      }
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
      if (isDragging) {
        this._startInteraction('dragging');
      } else {
        this._endInteraction('dragging');
      }
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
      if (isZooming) {
        this._startInteraction('zooming');
      } else {
        this._endInteraction('zooming');
      }
    }
  }

  /**
   * Set editing state
   */
  setEditing(isEditing) {
    if (this.isEditing !== isEditing) {
      this.isEditing = isEditing;
      this._updateInteractionState();
      this._updateThrottling();
      this._notifyCallbacks('editing', isEditing);
      if (isEditing) {
        this._startInteraction('editing');
      } else {
        this._endInteraction('editing');
      }
    }
  }
  
  /**
   * Start an interaction
   */
  _startInteraction(type) {
    const wasInteracting = this.isInteracting;
    
    // Cancel any ongoing cooldown
    if (this.qualityRestoreTimer) {
      clearInterval(this.qualityRestoreTimer);
      this.qualityRestoreTimer = null;
    }
    this.cooldownActive = false;
    
    // Set interaction type and start time
    if (!this.isInteracting) {
      this.currentInteractionType = type;
      this.interactionStartTime = performance.now();
      this.interactionDuration = 0;
      // Quality reduction removed - always use full quality
      // See docs/internal/PERFORMANCE_WORKAROUND_POLICY.md
    }
    
    // Emit interaction start event
    if (!wasInteracting) {
      this._emitEvent('interactionstart', {
        type: type,
        timestamp: this.interactionStartTime
      });
    }
  }
  
  /**
   * End an interaction
   */
  _endInteraction(_type) {
    if (!this.isInteracting) return;
    
    // Calculate duration
    if (this.interactionStartTime) {
      this.interactionDuration = performance.now() - this.interactionStartTime;
      this.lastInteractionEndTime = performance.now();
      
      // Record in history
      this.interactionHistory.push({
        type: this.currentInteractionType,
        duration: this.interactionDuration,
        startTime: this.interactionStartTime,
        endTime: this.lastInteractionEndTime
      });
      
      // Limit history size
      if (this.interactionHistory.length > this.maxHistorySize) {
        this.interactionHistory.shift();
      }
    }
    
    // Emit interaction end event
    this._emitEvent('interactionend', {
      type: this.currentInteractionType,
      duration: this.interactionDuration,
      timestamp: this.lastInteractionEndTime
    });
    
    // Reset interaction tracking
    this.currentInteractionType = null;
    this.interactionStartTime = null;
    const duration = this.interactionDuration;
    this.interactionDuration = 0;
    
    // Start cooldown with gradual quality restoration
    this._startCooldown(duration);
  }
  
  /**
   * Start cooldown period with gradual quality restoration
   */
  _startCooldown(interactionDuration) {
    this.cooldownActive = true;
    this.cooldownStartTime = performance.now();
    
    // Adjust cooldown duration based on interaction duration
    // Longer interactions = longer cooldown
    const baseCooldown = this.cooldownDuration;
    const extendedCooldown = Math.min(baseCooldown + interactionDuration * 0.5, 2000);
    
    // Calculate step size for quality restoration
    const startQuality = this.currentQualityLevel;
    const endQuality = 1.0;
    const stepSize = (endQuality - startQuality) / this.qualityRestoreSteps;
    let currentStep = 0;
    
    // Gradually restore quality
    this.qualityRestoreTimer = setInterval(() => {
      currentStep++;
      const newQuality = Math.min(
        startQuality + (stepSize * currentStep),
        endQuality
      );
      
      this.currentQualityLevel = newQuality;
      this.targetQualityLevel = newQuality;
      
      // Emit quality change event
      this._emitEvent('qualitychange', {
        quality: newQuality,
        step: currentStep,
        totalSteps: this.qualityRestoreSteps
      });
      
      // Complete cooldown
      if (currentStep >= this.qualityRestoreSteps) {
        this._endCooldown();
      }
    }, this.qualityRestoreInterval);
    
    // Safety timeout to ensure cooldown ends
    setTimeout(() => {
      if (this.cooldownActive) {
        this._endCooldown();
      }
    }, extendedCooldown);
  }
  
  /**
   * End cooldown period
   */
  _endCooldown() {
    if (this.qualityRestoreTimer) {
      clearInterval(this.qualityRestoreTimer);
      this.qualityRestoreTimer = null;
    }
    
    this.cooldownActive = false;
    this.currentQualityLevel = 1.0;
    this.targetQualityLevel = 1.0;
    
    this._emitEvent('cooldownend', {
      timestamp: performance.now()
    });
  }
  
  /**
   * Update overall interaction state
   */
  _updateInteractionState() {
    const wasInteracting = this.isInteracting;
    this.isInteracting = this.isPanning || this.isDragging || this.isZooming || this.isEditing;
    
    // Update current interaction type
    if (this.isInteracting) {
      if (this.isPanning) this.currentInteractionType = 'panning';
      else if (this.isDragging) this.currentInteractionType = 'dragging';
      else if (this.isZooming) this.currentInteractionType = 'zooming';
      else if (this.isEditing) this.currentInteractionType = 'editing';
      
      // Update duration if interaction is ongoing
      if (this.interactionStartTime) {
        this.interactionDuration = performance.now() - this.interactionStartTime;
      }
    } else {
      this.currentInteractionType = null;
    }
    
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
    // During editing: moderate throttling
    else if (this.isEditing) {
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
      isEditing: this.isEditing,
      isInteracting: this.isInteracting,
      currentInteractionType: this.currentInteractionType,
      interactionDuration: this.interactionDuration,
      cooldownActive: this.cooldownActive,
      currentQualityLevel: this.currentQualityLevel,
      shouldThrottle: { ...this.shouldThrottle }
    };
  }
  
  /**
   * Get current interaction type
   * @returns {string|null} 'panning', 'dragging', 'zooming', or null
   */
  getInteractionType() {
    return this.currentInteractionType;
  }
  
  /**
   * Get current interaction duration in milliseconds
   * @returns {number} Duration in ms, or 0 if not interacting
   */
  getInteractionDuration() {
    if (!this.isInteracting || !this.interactionStartTime) {
      return 0;
    }
    return performance.now() - this.interactionStartTime;
  }
  
  /**
   * Get interaction history
   * @returns {Array} Array of interaction records
   */
  getInteractionHistory() {
    return [...this.interactionHistory];
  }
  
  /**
   * Get interaction metrics
   * @returns {Object} Metrics about interactions
   */
  getInteractionMetrics() {
    if (this.interactionHistory.length === 0) {
      return {
        totalInteractions: 0,
        averageDuration: 0,
        totalDuration: 0,
        longestDuration: 0,
        interactionsByType: {}
      };
    }
    
    const totalDuration = this.interactionHistory.reduce((sum, record) => sum + record.duration, 0);
    const averageDuration = totalDuration / this.interactionHistory.length;
    const longestDuration = Math.max(...this.interactionHistory.map(r => r.duration));
    
    const interactionsByType = {};
    this.interactionHistory.forEach(record => {
      interactionsByType[record.type] = (interactionsByType[record.type] || 0) + 1;
    });
    
    return {
      totalInteractions: this.interactionHistory.length,
      averageDuration,
      totalDuration,
      longestDuration,
      interactionsByType
    };
  }
  
  /**
   * Get current quality level (0.0 to 1.0)
   * @returns {number} Quality level
   */
  getQualityLevel() {
    return this.currentQualityLevel;
  }
  
  /**
   * Check if cooldown is active
   * @returns {boolean}
   */
  isCooldownActive() {
    return this.cooldownActive;
  }
  
  /**
   * Add event listener for interaction events
   * @param {string} eventType - 'interactionstart', 'interactionend', 'qualitychange', 'cooldownend'
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  addEventListener(eventType, callback) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType).add(callback);
    
    return () => {
      const listeners = this.eventListeners.get(eventType);
      if (listeners) {
        listeners.delete(callback);
      }
    };
  }
  
  /**
   * Remove event listener
   * @param {string} eventType
   * @param {Function} callback
   */
  removeEventListener(eventType, callback) {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.delete(callback);
    }
  }
  
  /**
   * Emit an event to all listeners
   */
  _emitEvent(eventType, data) {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback({
            type: eventType,
            ...data,
            state: this.getState()
          });
        } catch (error) {
          console.error(`[InteractionStateManager] Event listener error for ${eventType}:`, error);
        }
      });
    }
  }
  
  /**
   * Register a callback for state changes (legacy support)
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

  /**
   * Reset all interaction state to initial values
   */
  reset() {
    // Cancel any ongoing timers
    if (this.qualityRestoreTimer) {
      clearInterval(this.qualityRestoreTimer);
      this.qualityRestoreTimer = null;
    }

    // Reset interaction states
    this.isPanning = false;
    this.isDragging = false;
    this.isZooming = false;
    this.isEditing = false;
    this.isInteracting = false;
    
    // Reset interaction tracking
    this.currentInteractionType = null;
    this.interactionStartTime = null;
    this.interactionDuration = 0;
    this.lastInteractionEndTime = null;
    
    // Reset cooldown
    this.cooldownActive = false;
    this.cooldownStartTime = null;
    this.currentQualityLevel = 1.0;
    this.targetQualityLevel = 1.0;
    
    // Reset throttling decisions
    this.shouldThrottle = {
      timeline: false,
      uiPanels: false,
      backgroundWarmup: false,
      preview: false
    };
    
    // Clear interaction history
    this.interactionHistory = [];
    
    // Notify callbacks of reset
    this._notifyCallbacks('reset', true);
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

