/**
 * PerformanceLogger.js
 * 
 * Detailed performance logging system that tracks frame times for each system
 * during panning and other interactions. Logs throttling decisions and measures
 * actual time saved by optimizations.
 */

import { getFrameBudgetAllocator } from './FrameBudgetAllocator.js';
import { getInteractionStateManager } from './InteractionStateManager.js';

export class PerformanceLogger {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.logLevel = options.logLevel || 'info'; // 'debug', 'info', 'warn', 'error'
    
    // Log storage
    this.logs = [];
    this.maxLogs = options.maxLogs || 10000;
    
    // Frame tracking
    this.currentFrame = null;
    this.frameLogs = [];
    this.maxFrameLogs = options.maxFrameLogs || 1000;
    
    // System references
    this.budgetAllocator = getFrameBudgetAllocator();
    this.interactionStateManager = getInteractionStateManager();
    
    // Throttling tracking
    this.throttlingLogs = [];
    this.optimizationSavings = {
      throttling: 0,
      frameSkipping: 0,
      qualityReduction: 0,
      total: 0
    };
    
    // Performance markers
    this.markers = new Map();
    
    // Statistics
    this.stats = {
      totalFrames: 0,
      framesDuringPanning: 0,
      framesDuringDragging: 0,
      framesDuringZooming: 0,
      throttledFrames: 0,
      skippedFrames: 0,
      budgetExceededFrames: 0
    };
  }
  
  /**
   * Start logging a new frame
   */
  startFrame(frameNumber, timestamp) {
    if (!this.enabled) return;
    
    this.currentFrame = {
      frameNumber,
      timestamp,
      startTime: performance.now(),
      systems: {},
      throttling: [],
      skipped: false,
      interactionState: null,
      budgetStats: null,
      endTime: null,
      totalTime: 0
    };
    
    // Record interaction state
    this.currentFrame.interactionState = this.interactionStateManager.getState();
    
    // Update statistics
    this.stats.totalFrames++;
    if (this.currentFrame.interactionState.isPanning) {
      this.stats.framesDuringPanning++;
    }
    if (this.currentFrame.interactionState.isDragging) {
      this.stats.framesDuringDragging++;
    }
    if (this.currentFrame.interactionState.isZooming) {
      this.stats.framesDuringZooming++;
    }
  }
  
  /**
   * Log time for a specific system
   */
  logSystemTime(systemName, timeMs, details = {}) {
    if (!this.enabled || !this.currentFrame) return;
    
    if (!this.currentFrame.systems[systemName]) {
      this.currentFrame.systems[systemName] = {
        times: [],
        total: 0,
        count: 0,
        details: []
      };
    }
    
    const system = this.currentFrame.systems[systemName];
    system.times.push(timeMs);
    system.total += timeMs;
    system.count++;
    system.details.push({
      time: timeMs,
      timestamp: performance.now(),
      ...details
    });
  }
  
  /**
   * Log throttling decision
   */
  logThrottling(operation, reason, timeSaved = 0) {
    if (!this.enabled) return;
    
    const throttlingEvent = {
      frameNumber: this.currentFrame?.frameNumber || 0,
      timestamp: performance.now(),
      operation,
      reason,
      timeSaved,
      interactionState: this.interactionStateManager.getState()
    };
    
    if (this.currentFrame) {
      this.currentFrame.throttling.push(throttlingEvent);
    }
    
    this.throttlingLogs.push(throttlingEvent);
    
    // Track savings
    if (timeSaved > 0) {
      this.optimizationSavings.throttling += timeSaved;
      this.optimizationSavings.total += timeSaved;
    }
    
    // Limit log size
    if (this.throttlingLogs.length > this.maxLogs) {
      this.throttlingLogs.shift();
    }
    
    // Log to console if debug level
    if (this.logLevel === 'debug') {
      console.log(`[PerformanceLogger] Throttling: ${operation} - ${reason} (saved ${timeSaved.toFixed(2)}ms)`);
    }
  }
  
  /**
   * Log frame skip
   */
  logFrameSkip(reason, timeSaved = 0) {
    if (!this.enabled) return;
    
    if (this.currentFrame) {
      this.currentFrame.skipped = true;
      this.currentFrame.skipReason = reason;
      this.currentFrame.skipTimeSaved = timeSaved;
    }
    
    this.stats.skippedFrames++;
    
    if (timeSaved > 0) {
      this.optimizationSavings.frameSkipping += timeSaved;
      this.optimizationSavings.total += timeSaved;
    }
    
    if (this.logLevel === 'debug') {
      console.log(`[PerformanceLogger] Frame skipped: ${reason} (saved ${timeSaved.toFixed(2)}ms)`);
    }
  }
  
  /**
   * Log quality reduction
   */
  logQualityReduction(oldQuality, newQuality, timeSaved = 0) {
    if (!this.enabled) return;
    
    const qualityEvent = {
      frameNumber: this.currentFrame?.frameNumber || 0,
      timestamp: performance.now(),
      oldQuality,
      newQuality,
      timeSaved,
      interactionState: this.interactionStateManager.getState()
    };
    
    if (timeSaved > 0) {
      this.optimizationSavings.qualityReduction += timeSaved;
      this.optimizationSavings.total += timeSaved;
    }
    
    if (this.logLevel === 'debug') {
      console.log(`[PerformanceLogger] Quality reduced: ${(oldQuality * 100).toFixed(0)}% -> ${(newQuality * 100).toFixed(0)}% (saved ${timeSaved.toFixed(2)}ms)`);
    }
  }
  
  /**
   * End logging for current frame
   */
  endFrame() {
    if (!this.enabled || !this.currentFrame) return;
    
    this.currentFrame.endTime = performance.now();
    this.currentFrame.totalTime = this.currentFrame.endTime - this.currentFrame.startTime;
    
    // Record budget stats
    this.currentFrame.budgetStats = this.budgetAllocator.getStats();
    
    // Check if budget exceeded
    if (this.currentFrame.budgetStats.frameTimeExceededCount > 0) {
      this.stats.budgetExceededFrames++;
    }
    
    // Check if frame was throttled
    if (this.currentFrame.throttling.length > 0) {
      this.stats.throttledFrames++;
    }
    
    // Store frame log
    this.frameLogs.push({ ...this.currentFrame });
    
    // Limit frame logs
    if (this.frameLogs.length > this.maxFrameLogs) {
      this.frameLogs.shift();
    }
    
    // Add to general logs
    this._addLog('frame', this.currentFrame);
    
    this.currentFrame = null;
  }
  
  /**
   * Add a performance marker
   */
  mark(name, data = {}) {
    if (!this.enabled) return;
    
    const marker = {
      name,
      timestamp: performance.now(),
      frameNumber: this.currentFrame?.frameNumber || 0,
      ...data
    };
    
    this.markers.set(name, marker);
    this._addLog('marker', marker);
  }
  
  /**
   * Measure time between two markers
   */
  measure(markerStart, markerEnd) {
    const start = this.markers.get(markerStart);
    const end = this.markers.get(markerEnd);
    
    if (!start || !end) {
      return null;
    }
    
    return {
      duration: end.timestamp - start.timestamp,
      start,
      end
    };
  }
  
  /**
   * Get logs for a specific time range
   */
  getLogs(startTime, endTime, filter = {}) {
    return this.logs.filter(log => {
      if (log.timestamp < startTime || log.timestamp > endTime) {
        return false;
      }
      
      // Apply filters
      if (filter.type && log.type !== filter.type) {
        return false;
      }
      
      if (filter.system && log.data?.systems && !log.data.systems[filter.system]) {
        return false;
      }
      
      return true;
    });
  }
  
  /**
   * Get frame logs during panning
   */
  getPanningFrames() {
    return this.frameLogs.filter(frame => 
      frame.interactionState?.isPanning
    );
  }
  
  /**
   * Get frame logs during a specific interaction
   */
  getInteractionFrames(interactionType) {
    return this.frameLogs.filter(frame => 
      frame.interactionState?.[`is${interactionType.charAt(0).toUpperCase() + interactionType.slice(1)}`]
    );
  }
  
  /**
   * Get throttling logs
   */
  getThrottlingLogs(operation = null) {
    if (operation) {
      return this.throttlingLogs.filter(log => log.operation === operation);
    }
    return [...this.throttlingLogs];
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const panningFrames = this.getPanningFrames();
    const avgFrameTimeDuringPanning = panningFrames.length > 0
      ? panningFrames.reduce((sum, f) => sum + f.totalTime, 0) / panningFrames.length
      : 0;
    
    return {
      ...this.stats,
      optimizationSavings: { ...this.optimizationSavings },
      averageFrameTimeDuringPanning: avgFrameTimeDuringPanning,
      totalLogs: this.logs.length,
      totalFrameLogs: this.frameLogs.length,
      totalThrottlingLogs: this.throttlingLogs.length
    };
  }
  
  /**
   * Get frame time distribution
   */
  getFrameTimeDistribution(frames = null) {
    const frameList = frames || this.frameLogs;
    if (frameList.length === 0) {
      return null;
    }
    
    const frameTimes = frameList.map(f => f.totalTime).sort((a, b) => a - b);
    const calculatePercentile = (arr, percentile) => {
      const index = Math.floor((percentile / 100) * arr.length);
      return arr[index] || 0;
    };
    
    return {
      min: frameTimes[0],
      max: frameTimes[frameTimes.length - 1],
      mean: frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length,
      p50: calculatePercentile(frameTimes, 50),
      p75: calculatePercentile(frameTimes, 75),
      p90: calculatePercentile(frameTimes, 90),
      p95: calculatePercentile(frameTimes, 95),
      p99: calculatePercentile(frameTimes, 99)
    };
  }
  
  /**
   * Get system time breakdown
   */
  getSystemTimeBreakdown(frames = null) {
    const frameList = frames || this.frameLogs;
    if (frameList.length === 0) {
      return {};
    }
    
    const systems = {};
    
    frameList.forEach(frame => {
      Object.keys(frame.systems || {}).forEach(systemName => {
        if (!systems[systemName]) {
          systems[systemName] = {
            times: [],
            total: 0,
            count: 0
          };
        }
        
        const system = frame.systems[systemName];
        systems[systemName].times.push(...system.times);
        systems[systemName].total += system.total;
        systems[systemName].count += system.count;
      });
    });
    
    // Calculate averages
    Object.keys(systems).forEach(systemName => {
      const system = systems[systemName];
      system.average = system.count > 0 ? system.total / system.count : 0;
      system.min = system.times.length > 0 ? Math.min(...system.times) : 0;
      system.max = system.times.length > 0 ? Math.max(...system.times) : 0;
      
      // Calculate percentiles
      const sorted = [...system.times].sort((a, b) => a - b);
      const calculatePercentile = (arr, percentile) => {
        const index = Math.floor((percentile / 100) * arr.length);
        return arr[index] || 0;
      };
      
      system.p50 = calculatePercentile(sorted, 50);
      system.p95 = calculatePercentile(sorted, 95);
      system.p99 = calculatePercentile(sorted, 99);
    });
    
    return systems;
  }
  
  /**
   * Clear logs
   */
  clear() {
    this.logs = [];
    this.frameLogs = [];
    this.throttlingLogs = [];
    this.markers.clear();
    this.stats = {
      totalFrames: 0,
      framesDuringPanning: 0,
      framesDuringDragging: 0,
      framesDuringZooming: 0,
      throttledFrames: 0,
      skippedFrames: 0,
      budgetExceededFrames: 0
    };
    this.optimizationSavings = {
      throttling: 0,
      frameSkipping: 0,
      qualityReduction: 0,
      total: 0
    };
  }
  
  /**
   * Export logs as JSON
   */
  exportLogs() {
    return JSON.stringify({
      logs: this.logs,
      frameLogs: this.frameLogs,
      throttlingLogs: this.throttlingLogs,
      stats: this.stats,
      optimizationSavings: this.optimizationSavings
    }, null, 2);
  }
  
  /**
   * Add log entry
   */
  _addLog(type, data) {
    const log = {
      type,
      timestamp: performance.now(),
      data
    };
    
    this.logs.push(log);
    
    // Limit log size
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }
  
  /**
   * Enable/disable logging
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }
  
  /**
   * Set log level
   */
  setLogLevel(level) {
    this.logLevel = level;
  }
}

// Singleton instance
let instance = null;

export function getPerformanceLogger() {
  if (!instance) {
    instance = new PerformanceLogger();
  }
  return instance;
}

