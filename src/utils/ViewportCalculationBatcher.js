/**
 * ViewportCalculationBatcher.js
 * 
 * Batches viewport-dependent calculations and executes them once per frame
 * using requestAnimationFrame. This prevents multiple recalculations during
 * the same frame and improves performance during panning.
 */

export class ViewportCalculationBatcher {
  constructor() {
    // Pending calculations to execute
    this._pendingCalculations = new Set();
    
    // RAF callback scheduled flag
    this._rafScheduled = false;
    
    // Callbacks registered for batched execution
    this._callbacks = new Set();
    
    // Frame counter for debugging
    this._frameCount = 0;
  }
  
  /**
   * Register a callback to be executed once per frame
   * @param {Function} callback - Function to call with viewport state
   * @param {string} id - Unique identifier for this calculation (optional)
   * @returns {Function} Unregister function
   */
  register(callback, id = null) {
    if (typeof callback !== 'function') {
      throw new Error('Callback must be a function');
    }
    
    const entry = { callback, id };
    this._callbacks.add(entry);
    
    // Schedule execution if not already scheduled
    this._scheduleExecution();
    
    // Return unregister function
    return () => {
      this._callbacks.delete(entry);
    };
  }
  
  /**
   * Add a one-time calculation to the batch
   * @param {Function} calculation - Function to execute
   * @param {string} id - Unique identifier (optional, for deduplication)
   */
  add(calculation, id = null) {
    if (typeof calculation !== 'function') {
      throw new Error('Calculation must be a function');
    }
    
    // If id provided and already exists, replace it
    if (id) {
      // Remove existing calculation with same id
      for (const calc of this._pendingCalculations) {
        if (calc.id === id) {
          this._pendingCalculations.delete(calc);
          break;
        }
      }
    }
    
    this._pendingCalculations.add({ calculation, id });
    this._scheduleExecution();
  }
  
  /**
   * Schedule execution for next frame
   */
  _scheduleExecution() {
    if (this._rafScheduled) return;
    
    this._rafScheduled = true;
    requestAnimationFrame(() => {
      this._execute();
    });
  }
  
  /**
   * Execute all pending calculations
   */
  _execute() {
    this._rafScheduled = false;
    this._frameCount++;
    
    // Execute all registered callbacks
    for (const entry of this._callbacks) {
      try {
        entry.callback();
      } catch (error) {
        console.error('[ViewportCalculationBatcher] Callback error:', error);
      }
    }
    
    // Execute all pending one-time calculations
    const calculations = Array.from(this._pendingCalculations);
    this._pendingCalculations.clear();
    
    for (const { calculation } of calculations) {
      try {
        calculation();
      } catch (error) {
        console.error('[ViewportCalculationBatcher] Calculation error:', error);
      }
    }
  }
  
  /**
   * Force immediate execution (use sparingly)
   */
  flush() {
    if (this._rafScheduled) {
      // Cancel scheduled RAF and execute immediately
      this._rafScheduled = false;
    }
    this._execute();
  }
  
  /**
   * Clear all pending calculations and callbacks
   */
  clear() {
    this._pendingCalculations.clear();
    this._callbacks.clear();
    this._rafScheduled = false;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      pendingCalculations: this._pendingCalculations.size,
      registeredCallbacks: this._callbacks.size,
      frameCount: this._frameCount
    };
  }
}

// Singleton instance
let instance = null;

export function getViewportCalculationBatcher() {
  if (!instance) {
    instance = new ViewportCalculationBatcher();
  }
  return instance;
}

