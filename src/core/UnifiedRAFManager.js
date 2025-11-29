// src/core/UnifiedRAFManager.js
// Central coordinator for all RAF-based updates with priority system
// Consolidates multiple RAF loops into a single, efficient loop with priority-based execution

/**
 * Priority levels for handler execution order
 * Handlers are executed in priority order: CRITICAL -> HIGH -> NORMAL -> LOW
 */
export const PRIORITY = {
  CRITICAL: 0,  // Must execute every frame (e.g., rendering)
  HIGH: 1,      // Important updates (e.g., user interactions)
  NORMAL: 2,    // Standard updates (e.g., animations)
  LOW: 3,       // Background tasks (e.g., cleanup, stats)
};

/**
 * Unified RAF Manager
 * 
 * Manages a single requestAnimationFrame loop that executes handlers
 * in priority order with support for conditional execution and frame skipping.
 */
export class UnifiedRAFManager {
  constructor() {
    // Map of handler name -> handler config
    this._handlers = new Map();
    
    // Running state
    this._running = false;
    this._rafId = null;
    
    // Frame statistics
    this._frameStats = {
      frameCount: 0,
      totalFrameTime: 0,
      averageFrameTime: 0,
      minFrameTime: Infinity,
      maxFrameTime: 0,
      lastFrameTime: 0,
      handlersExecuted: 0,
      handlersSkipped: 0,
      startTime: null,
      lastTimestamp: null,
    };
    
    // Per-handler statistics
    this._handlerStats = new Map();
    
    // Frame counter for frame skip logic
    this._frameCounter = 0;
  }

  /**
   * Register a handler to be called in the RAF loop
   * 
   * @param {string} name - Unique identifier for the handler
   * @param {Function} handler - Function to call each frame (receives frameInfo)
   * @param {number} priority - Priority level (PRIORITY.CRITICAL, HIGH, NORMAL, LOW)
   * @param {Object} options - Optional configuration
   * @param {Function} options.condition - Optional function that returns true if handler should execute
   * @param {number} options.frameSkip - Optional number of frames to skip between executions (e.g., 1 = every other frame)
   * @param {boolean} options.enabled - Whether handler is enabled (default: true)
   * @param {Function} options.onError - Optional error handler for this specific handler
   */
  registerHandler(name, handler, priority = PRIORITY.NORMAL, options = {}) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler must be a function, got ${typeof handler}`);
    }
    
    if (!Object.values(PRIORITY).includes(priority)) {
      throw new Error(`Invalid priority: ${priority}. Must be one of PRIORITY.CRITICAL, HIGH, NORMAL, LOW`);
    }
    
    const config = {
      name,
      handler,
      priority,
      condition: options.condition || null,
      frameSkip: options.frameSkip || 0,
      enabled: options.enabled !== false,
      onError: options.onError || null,
      lastExecutedFrame: -1,
      executionCount: 0,
      skipCount: 0,
      totalTime: 0,
      averageTime: 0,
      minTime: Infinity,
      maxTime: 0,
    };
    
    this._handlers.set(name, config);
    
    // Initialize handler stats
    this._handlerStats.set(name, {
      executionCount: 0,
      skipCount: 0,
      totalTime: 0,
      averageTime: 0,
      minTime: Infinity,
      maxTime: 0,
      lastExecutionTime: 0,
    });
    
    // If manager is running, ensure RAF loop continues
    if (this._running && this._rafId === null) {
      this._start();
    }
  }

  /**
   * Unregister a handler
   * 
   * @param {string} name - Handler name to unregister
   */
  unregisterHandler(name) {
    this._handlers.delete(name);
    this._handlerStats.delete(name);
  }

  /**
   * Enable or disable a handler
   * 
   * @param {string} name - Handler name
   * @param {boolean} enabled - Whether to enable the handler
   */
  setHandlerEnabled(name, enabled) {
    const handler = this._handlers.get(name);
    if (handler) {
      handler.enabled = enabled;
    }
  }

  /**
   * Update handler configuration
   * 
   * @param {string} name - Handler name
   * @param {Object} updates - Partial config updates
   */
  updateHandler(name, updates) {
    const handler = this._handlers.get(name);
    if (!handler) {
      throw new Error(`Handler "${name}" not found`);
    }
    
    if (updates.priority !== undefined) {
      if (!Object.values(PRIORITY).includes(updates.priority)) {
        throw new Error(`Invalid priority: ${updates.priority}`);
      }
      handler.priority = updates.priority;
    }
    
    if (updates.condition !== undefined) {
      handler.condition = updates.condition;
    }
    
    if (updates.frameSkip !== undefined) {
      handler.frameSkip = Math.max(0, Math.floor(updates.frameSkip));
    }
    
    if (updates.enabled !== undefined) {
      handler.enabled = updates.enabled;
    }
    
    if (updates.onError !== undefined) {
      handler.onError = updates.onError;
    }
  }

  /**
   * Start the RAF loop
   */
  start() {
    if (this._running) {
      return;
    }
    
    this._running = true;
    this._frameStats.startTime = performance.now();
    this._frameStats.lastTimestamp = null;
    this._frameCounter = 0;
    this._start();
  }

  /**
   * Stop the RAF loop
   */
  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /**
   * Internal method to start the RAF loop
   */
  _start() {
    if (!this._running || this._rafId !== null) {
      return;
    }
    
    this._rafId = requestAnimationFrame((timestamp) => this._onFrame(timestamp));
  }

  /**
   * Main frame handler
   * 
   * @param {number} timestamp - Current timestamp from RAF
   */
  _onFrame(timestamp) {
    if (!this._running) {
      this._rafId = null;
      return;
    }
    
    // Calculate frame time
    const frameStartTime = performance.now();
    let frameTime = 0;
    
    if (this._frameStats.lastTimestamp !== null) {
      frameTime = timestamp - this._frameStats.lastTimestamp;
    }
    
    this._frameStats.lastTimestamp = timestamp;
    this._frameCounter++;
    
    // Build frame info object
    const frameInfo = {
      timestamp,
      frameIndex: this._frameCounter,
      deltaTime: frameTime / 1000, // Convert to seconds
      frameTime, // In milliseconds
      realTime: performance.now() * 0.001, // Real time in seconds
    };
    
    // Get handlers sorted by priority
    const handlers = Array.from(this._handlers.values())
      .filter(h => h.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    // Execute handlers in priority order
    let handlersExecuted = 0;
    let handlersSkipped = 0;
    
    for (const handler of handlers) {
      // Check condition
      if (handler.condition && !handler.condition(frameInfo)) {
        handlersSkipped++;
        handler.skipCount++;
        continue;
      }
      
      // Check frame skip
      if (handler.frameSkip > 0) {
        const framesSinceLastExecution = this._frameCounter - handler.lastExecutedFrame - 1;
        if (framesSinceLastExecution < handler.frameSkip) {
          handlersSkipped++;
          handler.skipCount++;
          continue;
        }
      }
      
      // Execute handler
      const handlerStartTime = performance.now();
      try {
        handler.handler(frameInfo);
        handler.lastExecutedFrame = this._frameCounter;
        handler.executionCount++;
        handlersExecuted++;
        
        // Update handler timing stats
        const handlerTime = performance.now() - handlerStartTime;
        const handlerStat = this._handlerStats.get(handler.name);
        if (handlerStat) {
          handlerStat.executionCount++;
          handlerStat.totalTime += handlerTime;
          handlerStat.averageTime = handlerStat.totalTime / handlerStat.executionCount;
          handlerStat.minTime = Math.min(handlerStat.minTime, handlerTime);
          handlerStat.maxTime = Math.max(handlerStat.maxTime, handlerTime);
          handlerStat.lastExecutionTime = handlerTime;
        }
        
        handler.totalTime += handlerTime;
        handler.averageTime = handler.totalTime / handler.executionCount;
        handler.minTime = Math.min(handler.minTime, handlerTime);
        handler.maxTime = Math.max(handler.maxTime, handlerTime);
      } catch (error) {
        // Handle error
        if (handler.onError) {
          try {
            handler.onError(error, frameInfo);
          } catch (errorHandlerError) {
            console.error(`Error in error handler for "${handler.name}":`, errorHandlerError);
          }
        } else {
          console.error(`Error in RAF handler "${handler.name}":`, error);
        }
      }
    }
    
    // Update frame statistics
    const totalFrameTime = performance.now() - frameStartTime;
    this._frameStats.frameCount++;
    this._frameStats.totalFrameTime += totalFrameTime;
    this._frameStats.averageFrameTime = this._frameStats.totalFrameTime / this._frameStats.frameCount;
    this._frameStats.minFrameTime = Math.min(this._frameStats.minFrameTime, totalFrameTime);
    this._frameStats.maxFrameTime = Math.max(this._frameStats.maxFrameTime, totalFrameTime);
    this._frameStats.lastFrameTime = totalFrameTime;
    this._frameStats.handlersExecuted += handlersExecuted;
    this._frameStats.handlersSkipped += handlersSkipped;
    
    // Schedule next frame
    this._rafId = null;
    if (this._running) {
      this._start();
    }
  }

  /**
   * Get frame timing statistics
   * 
   * @returns {Object} Frame statistics object
   */
  getFrameStats() {
    const uptime = this._frameStats.startTime 
      ? (performance.now() - this._frameStats.startTime) / 1000 
      : 0;
    
    return {
      // Overall stats
      running: this._running,
      frameCount: this._frameStats.frameCount,
      uptime: uptime, // In seconds
      fps: this._frameStats.frameCount / uptime || 0,
      
      // Frame timing
      averageFrameTime: this._frameStats.averageFrameTime,
      minFrameTime: this._frameStats.minFrameTime === Infinity ? 0 : this._frameStats.minFrameTime,
      maxFrameTime: this._frameStats.maxFrameTime,
      lastFrameTime: this._frameStats.lastFrameTime,
      
      // Handler stats
      totalHandlers: this._handlers.size,
      handlersExecuted: this._frameStats.handlersExecuted,
      handlersSkipped: this._frameStats.handlersSkipped,
      averageHandlersPerFrame: this._frameStats.frameCount > 0 
        ? this._frameStats.handlersExecuted / this._frameStats.frameCount 
        : 0,
      
      // Per-handler stats
      handlerStats: Object.fromEntries(
        Array.from(this._handlerStats.entries()).map(([name, stats]) => [
          name,
          {
            executionCount: stats.executionCount,
            skipCount: this._handlers.get(name)?.skipCount || 0,
            averageTime: stats.averageTime,
            minTime: stats.minTime === Infinity ? 0 : stats.minTime,
            maxTime: stats.maxTime,
            lastExecutionTime: stats.lastExecutionTime,
            executionRate: this._frameStats.frameCount > 0 
              ? stats.executionCount / this._frameStats.frameCount 
              : 0,
          }
        ])
      ),
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this._frameStats = {
      frameCount: 0,
      totalFrameTime: 0,
      averageFrameTime: 0,
      minFrameTime: Infinity,
      maxFrameTime: 0,
      lastFrameTime: 0,
      handlersExecuted: 0,
      handlersSkipped: 0,
      startTime: this._frameStats.startTime || performance.now(),
      lastTimestamp: this._frameStats.lastTimestamp,
    };
    
    // Reset handler stats
    for (const [name, stats] of this._handlerStats.entries()) {
      stats.executionCount = 0;
      stats.skipCount = 0;
      stats.totalTime = 0;
      stats.averageTime = 0;
      stats.minTime = Infinity;
      stats.maxTime = 0;
      stats.lastExecutionTime = 0;
    }
    
    // Reset handler execution counts
    for (const handler of this._handlers.values()) {
      handler.executionCount = 0;
      handler.skipCount = 0;
      handler.totalTime = 0;
      handler.averageTime = 0;
      handler.minTime = Infinity;
      handler.maxTime = 0;
      handler.lastExecutedFrame = -1;
    }
  }

  /**
   * Get list of registered handlers
   * 
   * @returns {Array} Array of handler info objects
   */
  getHandlers() {
    return Array.from(this._handlers.values()).map(handler => ({
      name: handler.name,
      priority: handler.priority,
      enabled: handler.enabled,
      frameSkip: handler.frameSkip,
      hasCondition: handler.condition !== null,
      executionCount: handler.executionCount,
      skipCount: handler.skipCount,
    }));
  }

  /**
   * Check if manager is running
   * 
   * @returns {boolean} True if running
   */
  isRunning() {
    return this._running;
  }
}

// Export singleton instance for convenience
let _singletonInstance = null;

/**
 * Get the singleton instance of UnifiedRAFManager
 * 
 * @returns {UnifiedRAFManager} Singleton instance
 */
export function getUnifiedRAFManager() {
  if (!_singletonInstance) {
    _singletonInstance = new UnifiedRAFManager();
  }
  return _singletonInstance;
}

