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
    
    // Quality multiplier tracking (for monitoring only - actual quality control is in FloatingGPUPreview)
    // FrameBudgetAllocator no longer controls quality - that's handled by FloatingGPUPreview's smart adaptive system
    
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
    return TARGET_FRAME_TIME_MS * budgets[category];
  }
  
  /**
   * Get all budgets for current mode
   */
  getBudgets() {
    return {
      canvas: this.getBudget('canvas'),
      gpuPreview: this.getBudget('gpuPreview'),
      other: this.getBudget('other'),
      total: TARGET_FRAME_TIME_MS
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
    
    // Quality adjustment removed - always use full quality
    
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
   * Get current quality multiplier (always 1.0 - no quality degradation)
   */
  getQualityMultiplier() {
    return 1.0; // Always full quality - see PERFORMANCE_WORKAROUND_POLICY.md
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
      qualityMultiplier: 1.0, // Always full quality
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
   * Quality adjustment is permanently disabled - always use full quality
   * See PERFORMANCE_WORKAROUND_POLICY.md
   */
  setQualityAdjustmentEnabled(_enabled) {
    // No-op: quality adjustment removed to prevent quality degradation
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

