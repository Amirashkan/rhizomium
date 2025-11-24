/**
 * PerformanceBenchmark.js
 * 
 * Comprehensive performance benchmarking system for measuring and comparing
 * performance before and after optimizations. Supports automated test scenarios
 * and detailed metrics collection.
 */

import { getFrameBudgetAllocator } from './FrameBudgetAllocator.js';
import { getInteractionStateManager } from './InteractionStateManager.js';

export class PerformanceBenchmark {
  constructor(options = {}) {
    this.enabled = false;
    this.isRunning = false;
    this.currentTest = null;
    this.testResults = [];
    
    // Configuration
    this.config = {
      warmupFrames: 60, // Warmup frames before starting measurement
      measurementFrames: 300, // Frames to measure (5 seconds at 60fps)
      cooldownFrames: 30, // Cooldown frames after measurement
      ...options
    };
    
    // Frame tracking
    this.frameCount = 0;
    this.frameData = [];
    this.startTime = 0;
    this.endTime = 0;
    
    // System references
    this.budgetAllocator = getFrameBudgetAllocator();
    this.interactionStateManager = getInteractionStateManager();
    
    // Performance metrics
    this.metrics = {
      fps: [],
      frameTimes: [],
      frameTimeDistribution: {
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0
      },
      systemTimes: {
        canvas: [],
        gpu: [],
        other: []
      },
      throttlingEvents: [],
      skippedFrames: 0,
      budgetExceeded: 0,
      optimizationSavings: {}
    };
    
    // Callbacks
    this.onTestStart = null;
    this.onTestProgress = null;
    this.onTestComplete = null;
    this.onFrame = null;
  }
  
  /**
   * Start a benchmark test
   */
  async runTest(testScenario, options = {}) {
    if (this.isRunning) {
      throw new Error('Benchmark already running');
    }
    
    this.isRunning = true;
    this.currentTest = {
      name: testScenario.name || 'Unnamed Test',
      scenario: testScenario,
      options: { ...this.config, ...options },
      startTime: performance.now()
    };
    
    // Reset metrics
    this._resetMetrics();
    
    // Notify test start
    if (this.onTestStart) {
      this.onTestStart(this.currentTest);
    }
    
    try {
      // Phase 1: Warmup
      await this._warmup();
      
      // Phase 2: Setup test scenario
      if (testScenario.setup) {
        await testScenario.setup();
      }
      
      // Phase 3: Run measurement
      await this._runMeasurement(testScenario);
      
      // Phase 4: Cleanup
      if (testScenario.cleanup) {
        await testScenario.cleanup();
      }
      
      // Phase 5: Calculate results
      const results = this._calculateResults();
      
      // Store results
      this.testResults.push({
        test: this.currentTest,
        results: results,
        timestamp: Date.now()
      });
      
      // Notify test complete
      if (this.onTestComplete) {
        this.onTestComplete(this.currentTest, results);
      }
      
      return results;
    } finally {
      this.isRunning = false;
      this.currentTest = null;
    }
  }
  
  /**
   * Warmup phase - let system stabilize
   */
  async _warmup() {
    return new Promise((resolve) => {
      let frames = 0;
      const raf = () => {
        frames++;
        if (frames >= this.currentTest.options.warmupFrames) {
          resolve();
        } else {
          requestAnimationFrame(raf);
        }
      };
      requestAnimationFrame(raf);
    });
  }
  
  /**
   * Run measurement phase
   */
  async _runMeasurement(testScenario) {
    return new Promise((resolve) => {
      this.startTime = performance.now();
      this.frameCount = 0;
      const targetFrames = this.currentTest.options.measurementFrames;
      
      const raf = (timestamp) => {
        // Execute test scenario action if provided
        if (testScenario.onFrame) {
          testScenario.onFrame(this.frameCount, timestamp);
        }
        
        // Record frame data
        this._recordFrame();
        
        // Notify frame callback
        if (this.onFrame) {
          this.onFrame(this.frameCount, this._getCurrentFrameData());
        }
        
        // Notify progress
        if (this.onTestProgress) {
          const progress = (this.frameCount / targetFrames) * 100;
          this.onTestProgress(progress, this.frameCount, targetFrames);
        }
        
        this.frameCount++;
        
        if (this.frameCount < targetFrames) {
          requestAnimationFrame(raf);
        } else {
          this.endTime = performance.now();
          resolve();
        }
      };
      
      requestAnimationFrame(raf);
    });
  }
  
  /**
   * Record frame data
   */
  _recordFrame() {
    const frameData = {
      frameNumber: this.frameCount,
      timestamp: performance.now(),
      frameTime: 0,
      fps: 0,
      systemTimes: {
        canvas: 0,
        gpu: 0,
        other: 0
      },
      interactionState: this.interactionStateManager.getState(),
      budgetStats: this.budgetAllocator.getStats(),
      throttling: {
        skipped: false,
        reason: null
      }
    };
    
    // Get frame time from budget allocator if available
    const stats = this.budgetAllocator.getStats();
    if (stats.avgFrameTime > 0) {
      frameData.frameTime = stats.avgFrameTime;
      frameData.fps = 1000 / frameData.frameTime;
    }
    
    // Get system times
    if (stats.avgUsage) {
      frameData.systemTimes.canvas = stats.avgUsage.canvas || 0;
      frameData.systemTimes.gpu = stats.avgUsage.gpuPreview || 0;
      frameData.systemTimes.other = stats.avgUsage.other || 0;
    }
    
    // Check for throttling
    const interactionState = frameData.interactionState;
    if (interactionState.isInteracting) {
      // Check if frame was skipped due to throttling
      // This would need to be tracked by the profiler
    }
    
    this.frameData.push(frameData);
    
    // Update metrics
    if (frameData.frameTime > 0) {
      this.metrics.fps.push(frameData.fps);
      this.metrics.frameTimes.push(frameData.frameTime);
      this.metrics.systemTimes.canvas.push(frameData.systemTimes.canvas);
      this.metrics.systemTimes.gpu.push(frameData.systemTimes.gpu);
      this.metrics.systemTimes.other.push(frameData.systemTimes.other);
    }
    
    // Track budget exceeded
    if (frameData.budgetStats && frameData.budgetStats.frameTimeExceededCount > 0) {
      this.metrics.budgetExceeded++;
    }
  }
  
  /**
   * Get current frame data
   */
  _getCurrentFrameData() {
    if (this.frameData.length === 0) return null;
    return this.frameData[this.frameData.length - 1];
  }
  
  /**
   * Calculate benchmark results
   */
  _calculateResults() {
    if (this.frameData.length === 0) {
      return null;
    }
    
    const frameTimes = this.metrics.frameTimes;
    const fps = this.metrics.fps;
    
    // Calculate statistics
    const sortedFrameTimes = [...frameTimes].sort((a, b) => a - b);
    const calculatePercentile = (arr, percentile) => {
      const index = Math.floor((percentile / 100) * arr.length);
      return arr[index] || 0;
    };
    
    const results = {
      duration: this.endTime - this.startTime,
      totalFrames: this.frameCount,
      averageFPS: fps.length > 0 ? fps.reduce((a, b) => a + b, 0) / fps.length : 0,
      minFPS: fps.length > 0 ? Math.min(...fps) : 0,
      maxFPS: fps.length > 0 ? Math.max(...fps) : 0,
      averageFrameTime: frameTimes.length > 0 ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length : 0,
      minFrameTime: frameTimes.length > 0 ? Math.min(...frameTimes) : 0,
      maxFrameTime: frameTimes.length > 0 ? Math.max(...frameTimes) : 0,
      frameTimeDistribution: {
        p50: calculatePercentile(sortedFrameTimes, 50),
        p75: calculatePercentile(sortedFrameTimes, 75),
        p90: calculatePercentile(sortedFrameTimes, 90),
        p95: calculatePercentile(sortedFrameTimes, 95),
        p99: calculatePercentile(sortedFrameTimes, 99)
      },
      systemAverages: {
        canvas: this.metrics.systemTimes.canvas.length > 0
          ? this.metrics.systemTimes.canvas.reduce((a, b) => a + b, 0) / this.metrics.systemTimes.canvas.length
          : 0,
        gpu: this.metrics.systemTimes.gpu.length > 0
          ? this.metrics.systemTimes.gpu.reduce((a, b) => a + b, 0) / this.metrics.systemTimes.gpu.length
          : 0,
        other: this.metrics.systemTimes.other.length > 0
          ? this.metrics.systemTimes.other.reduce((a, b) => a + b, 0) / this.metrics.systemTimes.other.length
          : 0
      },
      throttlingEvents: this.metrics.throttlingEvents.length,
      skippedFrames: this.metrics.skippedFrames,
      budgetExceededCount: this.metrics.budgetExceeded,
      frameData: this.frameData // Include raw frame data for detailed analysis
    };
    
    return results;
  }
  
  /**
   * Compare two benchmark results
   */
  compareResults(before, after) {
    if (!before || !after) {
      return null;
    }
    
    const comparison = {
      fps: {
        before: before.averageFPS,
        after: after.averageFPS,
        improvement: after.averageFPS - before.averageFPS,
        improvementPercent: ((after.averageFPS - before.averageFPS) / before.averageFPS) * 100
      },
      frameTime: {
        before: before.averageFrameTime,
        after: after.averageFrameTime,
        improvement: before.averageFrameTime - after.averageFrameTime,
        improvementPercent: ((before.averageFrameTime - after.averageFrameTime) / before.averageFrameTime) * 100
      },
      frameTimeP95: {
        before: before.frameTimeDistribution.p95,
        after: after.frameTimeDistribution.p95,
        improvement: before.frameTimeDistribution.p95 - after.frameTimeDistribution.p95,
        improvementPercent: ((before.frameTimeDistribution.p95 - after.frameTimeDistribution.p95) / before.frameTimeDistribution.p95) * 100
      },
      systemTimes: {
        canvas: {
          before: before.systemAverages.canvas,
          after: after.systemAverages.canvas,
          improvement: before.systemAverages.canvas - after.systemAverages.canvas,
          improvementPercent: ((before.systemAverages.canvas - after.systemAverages.canvas) / before.systemAverages.canvas) * 100
        },
        gpu: {
          before: before.systemAverages.gpu,
          after: after.systemAverages.gpu,
          improvement: before.systemAverages.gpu - after.systemAverages.gpu,
          improvementPercent: ((before.systemAverages.gpu - after.systemAverages.gpu) / before.systemAverages.gpu) * 100
        },
        other: {
          before: before.systemAverages.other,
          after: after.systemAverages.other,
          improvement: before.systemAverages.other - after.systemAverages.other,
          improvementPercent: ((before.systemAverages.other - after.systemAverages.other) / before.systemAverages.other) * 100
        }
      },
      budgetExceeded: {
        before: before.budgetExceededCount,
        after: after.budgetExceededCount,
        improvement: before.budgetExceededCount - after.budgetExceededCount
      }
    };
    
    return comparison;
  }
  
  /**
   * Reset metrics
   */
  _resetMetrics() {
    this.frameCount = 0;
    this.frameData = [];
    this.startTime = 0;
    this.endTime = 0;
    this.metrics = {
      fps: [],
      frameTimes: [],
      frameTimeDistribution: {
        p50: 0,
        p75: 0,
        p90: 0,
        p95: 0,
        p99: 0
      },
      systemTimes: {
        canvas: [],
        gpu: [],
        other: []
      },
      throttlingEvents: [],
      skippedFrames: 0,
      budgetExceeded: 0,
      optimizationSavings: {}
    };
  }
  
  /**
   * Get all test results
   */
  getTestResults() {
    return [...this.testResults];
  }
  
  /**
   * Clear test results
   */
  clearResults() {
    this.testResults = [];
  }
  
  /**
   * Export results as JSON
   */
  exportResults() {
    return JSON.stringify(this.testResults, null, 2);
  }
  
  /**
   * Import results from JSON
   */
  importResults(json) {
    try {
      this.testResults = JSON.parse(json);
      return true;
    } catch (error) {
      console.error('[PerformanceBenchmark] Failed to import results:', error);
      return false;
    }
  }
}

// Singleton instance
let instance = null;

export function getPerformanceBenchmark() {
  if (!instance) {
    instance = new PerformanceBenchmark();
  }
  return instance;
}

