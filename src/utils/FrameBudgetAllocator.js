/**
 * FrameBudgetAllocator.js
 * 
 * Manages frame time budgets for different system categories:
 * - Canvas rendering
 * - GPU/Preview rendering
 * - Other operations (timeline, UI panels, etc.)
 * 
 * Budgets adjust dynamically based on interaction state (normal vs panning).
 */

const TARGET_FRAME_TIME_MS = 16.67; // 60 FPS target
const BUDGET_WARNING_THRESHOLD = 0.9; // Warn if using >90% of budget
const BUDGET_EXCEEDED_THRESHOLD = 1.0; // Critical if exceeding budget
const FRAME_TIME_HISTORY_SIZE = 60; // Track last 60 frames (~1 second at 60fps)

// Budget definitions (as percentages of target frame time)
const BUDGETS = {
  normal: {
    canvas: 0.40,      // 40% = ~6.67ms
    gpuPreview: 0.40,  // 40% = ~6.67ms
    other: 0.20        // 20% = ~3.33ms
  },
  panning: {
    canvas: 0.60,      // 60% = ~10ms
    gpuPreview: 0.30,  // 30% = ~5ms
    other: 0.10        // 10% = ~1.67ms
  }
};

export class FrameBudgetAllocator {
  constructor() {
    // Current budget mode
    this.mode = 'normal'; // 'normal' or 'panning'
    
    // Time tracking for current frame
    this.currentFrame = {
      startTime: 0,
      canvasTime: 0,
      gpuPreviewTime: 0,
      otherTime: 0,
      totalTime: 0
    };
    
    // Historical frame time data
    this.frameHistory = [];
    this.budgetWarnings = {
      canvas: 0,
      gpuPreview: 0,
      other: 0,
      total: 0
    };
    
    // Quality adjustment state
    this.qualityMultiplier = 1.0; // 1.0 = full quality, <1.0 = reduced
    this.qualityAdjustmentEnabled = true;
    this.minQualityMultiplier = 0.5; // Don't go below 50% quality
    
    // Frame time monitoring
    this.frameTimeExceededCount = 0;
    this.lastWarningTime = 0;
    this.warningCooldown = 2000; // 2 seconds between warnings
  }
  
  /**
   * Set the budget mode (normal or panning)
   */
  setMode(mode) {
    if (mode !== 'normal' && mode !== 'panning') {
      console.warn(`[FrameBudgetAllocator] Invalid mode: ${mode}, using 'normal'`);
      mode = 'normal';
    }
    
    if (this.mode !== mode) {
      this.mode = mode;
      // Reset quality when switching modes
      this.qualityMultiplier = 1.0;
    }
  }
  
  /**
   * Get current budget for a category
   */
  getBudget(category) {
    const budgets = BUDGETS[this.mode];
    if (!budgets[category]) {
      console.warn(`[FrameBudgetAllocator] Unknown category: ${category}`);
      return TARGET_FRAME_TIME_MS * 0.1; // Default 10%
    }
    return TARGET_FRAME_TIME_MS * budgets[category] * this.qualityMultiplier;
  }
  
  /**
   * Get all budgets for current mode
   */
  getBudgets() {
    const budgets = BUDGETS[this.mode];
    return {
      canvas: this.getBudget('canvas'),
      gpuPreview: this.getBudget('gpuPreview'),
      other: this.getBudget('other'),
      total: TARGET_FRAME_TIME_MS * this.qualityMultiplier
    };
  }
  
  /**
   * Start tracking a new frame
   */
  beginFrame() {
    this.currentFrame = {
      startTime: performance.now(),
      canvasTime: 0,
      gpuPreviewTime: 0,
      otherTime: 0,
      totalTime: 0
    };
  }
  
  /**
   * Record time spent in a category
   */
  recordTime(category, timeMs) {
    if (category === 'canvas') {
      this.currentFrame.canvasTime += timeMs;
    } else if (category === 'gpuPreview' || category === 'gpu' || category === 'preview') {
      this.currentFrame.gpuPreviewTime += timeMs;
    } else {
      this.currentFrame.otherTime += timeMs;
    }
  }
  
  /**
   * End frame tracking and analyze budget usage
   */
  endFrame() {
    const now = performance.now();
    this.currentFrame.totalTime = now - this.currentFrame.startTime;
    
    // Add to history
    this.frameHistory.push({
      ...this.currentFrame,
      mode: this.mode,
      timestamp: now
    });
    
    // Keep only recent history
    if (this.frameHistory.length > FRAME_TIME_HISTORY_SIZE) {
      this.frameHistory.shift();
    }
    
    // Analyze budget usage
    this._analyzeBudgetUsage();
    
    // Check if frame time exceeded target
    if (this.currentFrame.totalTime > TARGET_FRAME_TIME_MS) {
      this.frameTimeExceededCount++;
      this._checkFrameTimeExceeded();
    } else {
      this.frameTimeExceededCount = Math.max(0, this.frameTimeExceededCount - 1);
    }
    
    // Adjust quality if needed
    if (this.qualityAdjustmentEnabled) {
      this._adjustQuality();
    }
    
    return {
      ...this.currentFrame,
      budgets: this.getBudgets(),
      exceeded: this.currentFrame.totalTime > TARGET_FRAME_TIME_MS
    };
  }
  
  /**
   * Analyze budget usage and track warnings
   */
  _analyzeBudgetUsage() {
    const budgets = this.getBudgets();
    const frame = this.currentFrame;
    
    // Check each category
    const categories = [
      { name: 'canvas', time: frame.canvasTime, budget: budgets.canvas },
      { name: 'gpuPreview', time: frame.gpuPreviewTime, budget: budgets.gpuPreview },
      { name: 'other', time: frame.otherTime, budget: budgets.other }
    ];
    
    categories.forEach(({ name, time, budget }) => {
      if (budget > 0) {
        const usage = time / budget;
        if (usage > BUDGET_EXCEEDED_THRESHOLD) {
          this.budgetWarnings[name]++;
        } else if (usage > BUDGET_WARNING_THRESHOLD) {
          // Track but don't increment warning count for near-misses
        }
      }
    });
    
    // Check total frame time
    if (frame.totalTime > budgets.total) {
      this.budgetWarnings.total++;
    }
  }
  
  /**
   * Check if frame time consistently exceeds target
   */
  _checkFrameTimeExceeded() {
    const now = performance.now();
    
    // Only warn if consistently exceeding and cooldown has passed
    if (this.frameTimeExceededCount >= 10 && (now - this.lastWarningTime) > this.warningCooldown) {
      const avgFrameTime = this._getAverageFrameTime();
      console.warn(
        `[FrameBudgetAllocator] Frame time consistently exceeded: ` +
        `avg ${avgFrameTime.toFixed(2)}ms (target: ${TARGET_FRAME_TIME_MS}ms) ` +
        `in ${this.mode} mode`
      );
      this.lastWarningTime = now;
    }
  }
  
  /**
   * Get average frame time from recent history
   */
  _getAverageFrameTime() {
    if (this.frameHistory.length === 0) return 0;
    
    const recent = this.frameHistory.slice(-30); // Last 30 frames
    const sum = recent.reduce((acc, frame) => acc + frame.totalTime, 0);
    return sum / recent.length;
  }
  
  /**
   * Adjust quality based on frame time performance
   */
  _adjustQuality() {
    const avgFrameTime = this._getAverageFrameTime();
    const targetTime = TARGET_FRAME_TIME_MS;
    
    // If consistently exceeding target, reduce quality
    if (avgFrameTime > targetTime * 1.1 && this.frameTimeExceededCount >= 5) {
      // Reduce quality by 10%
      this.qualityMultiplier = Math.max(
        this.minQualityMultiplier,
        this.qualityMultiplier * 0.9
      );
    }
    // If performing well, gradually increase quality
    else if (avgFrameTime < targetTime * 0.8 && this.frameTimeExceededCount === 0) {
      // Increase quality by 5%
      this.qualityMultiplier = Math.min(1.0, this.qualityMultiplier * 1.05);
    }
  }
  
  /**
   * Get current quality multiplier
   */
  getQualityMultiplier() {
    return this.qualityMultiplier;
  }
  
  /**
   * Get statistics about budget usage
   */
  getStats() {
    const avgFrameTime = this._getAverageFrameTime();
    const budgets = this.getBudgets();
    
    // Calculate average usage per category
    const recent = this.frameHistory.slice(-30);
    const avgUsage = {
      canvas: 0,
      gpuPreview: 0,
      other: 0
    };
    
    if (recent.length > 0) {
      recent.forEach(frame => {
        avgUsage.canvas += frame.canvasTime;
        avgUsage.gpuPreview += frame.gpuPreviewTime;
        avgUsage.other += frame.otherTime;
      });
      
      avgUsage.canvas /= recent.length;
      avgUsage.gpuPreview /= recent.length;
      avgUsage.other /= recent.length;
    }
    
    return {
      mode: this.mode,
      qualityMultiplier: this.qualityMultiplier,
      avgFrameTime,
      targetFrameTime: TARGET_FRAME_TIME_MS,
      budgets,
      avgUsage,
      budgetWarnings: { ...this.budgetWarnings },
      frameTimeExceededCount: this.frameTimeExceededCount
    };
  }
  
  /**
   * Reset statistics
   */
  resetStats() {
    this.budgetWarnings = {
      canvas: 0,
      gpuPreview: 0,
      other: 0,
      total: 0
    };
    this.frameTimeExceededCount = 0;
    this.frameHistory = [];
  }
  
  /**
   * Enable/disable quality adjustment
   */
  setQualityAdjustmentEnabled(enabled) {
    this.qualityAdjustmentEnabled = enabled;
    if (!enabled) {
      this.qualityMultiplier = 1.0;
    }
  }
}

// Singleton instance
let instance = null;

export function getFrameBudgetAllocator() {
  if (!instance) {
    instance = new FrameBudgetAllocator();
  }
  return instance;
}

