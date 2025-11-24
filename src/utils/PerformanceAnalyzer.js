/**
 * PerformanceAnalyzer.js
 * 
 * Analyzes performance data to identify bottlenecks, suggest optimizations,
 * and fine-tune frame budgets and throttling thresholds.
 */

import { getPerformanceLogger } from './PerformanceLogger.js';
import { getFrameBudgetAllocator } from './FrameBudgetAllocator.js';

export class PerformanceAnalyzer {
  constructor() {
    this.logger = getPerformanceLogger();
    this.budgetAllocator = getFrameBudgetAllocator();
  }
  
  /**
   * Analyze performance and identify bottlenecks
   */
  analyzeBottlenecks(frames = null) {
    const frameList = frames || this.logger.frameLogs;
    if (frameList.length === 0) {
      return {
        error: 'No frame data available'
      };
    }
    
    const analysis = {
      bottlenecks: [],
      recommendations: [],
      systemBreakdown: this.logger.getSystemTimeBreakdown(frameList),
      frameTimeDistribution: this.logger.getFrameTimeDistribution(frameList),
      budgetAnalysis: this._analyzeBudgetUsage(frameList),
      throttlingAnalysis: this._analyzeThrottling(frameList)
    };
    
    // Identify bottlenecks
    analysis.bottlenecks = this._identifyBottlenecks(analysis);
    
    // Generate recommendations
    analysis.recommendations = this._generateRecommendations(analysis);
    
    return analysis;
  }
  
  /**
   * Identify specific bottlenecks
   */
  _identifyBottlenecks(analysis) {
    const bottlenecks = [];
    const targetFrameTime = 16.67; // 60 FPS
    
    // Check average frame time
    if (analysis.frameTimeDistribution && analysis.frameTimeDistribution.mean > targetFrameTime) {
      bottlenecks.push({
        type: 'high_frame_time',
        severity: analysis.frameTimeDistribution.mean > targetFrameTime * 1.5 ? 'high' : 'medium',
        description: `Average frame time (${analysis.frameTimeDistribution.mean.toFixed(2)}ms) exceeds target (${targetFrameTime}ms)`,
        impact: ((analysis.frameTimeDistribution.mean - targetFrameTime) / targetFrameTime * 100).toFixed(1) + '%'
      });
    }
    
    // Check P95 frame time
    if (analysis.frameTimeDistribution && analysis.frameTimeDistribution.p95 > targetFrameTime * 1.2) {
      bottlenecks.push({
        type: 'high_p95_frame_time',
        severity: 'high',
        description: `P95 frame time (${analysis.frameTimeDistribution.p95.toFixed(2)}ms) is significantly above target`,
        impact: 'Causes noticeable stuttering'
      });
    }
    
    // Check system times
    if (analysis.systemBreakdown) {
      Object.keys(analysis.systemBreakdown).forEach(systemName => {
        const system = analysis.systemBreakdown[systemName];
        const systemBudget = this._getSystemBudget(systemName);
        
        if (system.average > systemBudget) {
          bottlenecks.push({
            type: 'system_over_budget',
            system: systemName,
            severity: system.average > systemBudget * 1.5 ? 'high' : 'medium',
            description: `${systemName} average time (${system.average.toFixed(2)}ms) exceeds budget (${systemBudget.toFixed(2)}ms)`,
            impact: ((system.average - systemBudget) / systemBudget * 100).toFixed(1) + '% over budget'
          });
        }
        
        // Check for high variance (indicates inconsistent performance)
        if (system.max - system.min > system.average * 2) {
          bottlenecks.push({
            type: 'high_variance',
            system: systemName,
            severity: 'medium',
            description: `${systemName} shows high variance (${system.min.toFixed(2)}ms - ${system.max.toFixed(2)}ms)`,
            impact: 'Inconsistent frame times'
          });
        }
      });
    }
    
    // Check budget exceeded frames
    if (analysis.budgetAnalysis && analysis.budgetAnalysis.exceededCount > 0) {
      const exceededPercent = (analysis.budgetAnalysis.exceededCount / analysis.budgetAnalysis.totalFrames) * 100;
      if (exceededPercent > 10) {
        bottlenecks.push({
          type: 'frequent_budget_exceeded',
          severity: exceededPercent > 30 ? 'high' : 'medium',
          description: `${exceededPercent.toFixed(1)}% of frames exceeded budget`,
          impact: `${analysis.budgetAnalysis.exceededCount} frames`
        });
      }
    }
    
    return bottlenecks;
  }
  
  /**
   * Generate optimization recommendations
   */
  _generateRecommendations(analysis) {
    const recommendations = [];
    
    // Analyze bottlenecks and generate recommendations
    analysis.bottlenecks.forEach(bottleneck => {
      switch (bottleneck.type) {
        case 'high_frame_time':
          recommendations.push({
            type: 'reduce_quality',
            priority: bottleneck.severity === 'high' ? 'high' : 'medium',
            description: 'Consider reducing rendering quality or resolution',
            action: 'Adjust quality multiplier or reduce viewport resolution'
          });
          break;
          
        case 'system_over_budget':
          recommendations.push({
            type: 'optimize_system',
            system: bottleneck.system,
            priority: bottleneck.severity,
            description: `Optimize ${bottleneck.system} rendering`,
            action: this._getSystemOptimizationAction(bottleneck.system)
          });
          break;
          
        case 'high_variance':
          recommendations.push({
            type: 'stabilize_performance',
            system: bottleneck.system,
            priority: 'medium',
            description: `Stabilize ${bottleneck.system} performance`,
            action: 'Consider caching, batching, or reducing dynamic calculations'
          });
          break;
          
        case 'frequent_budget_exceeded':
          recommendations.push({
            type: 'adjust_budgets',
            priority: 'high',
            description: 'Adjust frame budgets or increase throttling',
            action: 'Review and adjust budget allocations or throttling thresholds'
          });
          break;
      }
    });
    
    // Check throttling effectiveness
    if (analysis.throttlingAnalysis) {
      if (analysis.throttlingAnalysis.effectiveness < 0.5) {
        recommendations.push({
          type: 'improve_throttling',
          priority: 'medium',
          description: 'Throttling is not effectively reducing frame times',
          action: 'Review throttling thresholds and consider more aggressive throttling'
        });
      }
    }
    
    return recommendations;
  }
  
  /**
   * Analyze budget usage
   */
  _analyzeBudgetUsage(frames) {
    if (frames.length === 0) return null;
    
    let exceededCount = 0;
    const budgets = this.budgetAllocator.getBudgets();
    const targetFrameTime = 16.67;
    
    frames.forEach(frame => {
      if (frame.totalTime > targetFrameTime) {
        exceededCount++;
      }
    });
    
    return {
      totalFrames: frames.length,
      exceededCount,
      exceededPercent: (exceededCount / frames.length) * 100,
      targetFrameTime,
      budgets
    };
  }
  
  /**
   * Analyze throttling effectiveness
   */
  _analyzeThrottling(frames) {
    const throttledFrames = frames.filter(f => f.throttling && f.throttling.length > 0);
    const skippedFrames = frames.filter(f => f.skipped);
    
    // Calculate average frame time for throttled vs non-throttled frames
    const throttledAvg = throttledFrames.length > 0
      ? throttledFrames.reduce((sum, f) => sum + f.totalTime, 0) / throttledFrames.length
      : 0;
    
    const nonThrottledFrames = frames.filter(f => !f.throttling || f.throttling.length === 0);
    const nonThrottledAvg = nonThrottledFrames.length > 0
      ? nonThrottledFrames.reduce((sum, f) => sum + f.totalTime, 0) / nonThrottledFrames.length
      : 0;
    
    // Calculate effectiveness (how much throttling reduced frame time)
    const effectiveness = throttledAvg > 0 && nonThrottledAvg > 0
      ? (nonThrottledAvg - throttledAvg) / nonThrottledAvg
      : 0;
    
    return {
      throttledFrames: throttledFrames.length,
      skippedFrames: skippedFrames.length,
      throttledAvgFrameTime: throttledAvg,
      nonThrottledAvgFrameTime: nonThrottledAvg,
      effectiveness,
      totalTimeSaved: this.logger.optimizationSavings.total
    };
  }
  
  /**
   * Suggest optimal throttling thresholds
   */
  suggestThrottlingThresholds(frames = null) {
    const frameList = frames || this.logger.frameLogs;
    if (frameList.length === 0) {
      return null;
    }
    
    const panningFrames = frameList.filter(f => f.interactionState?.isPanning);
    const idleFrames = frameList.filter(f => !f.interactionState?.isInteracting);
    
    const suggestions = {
      panning: {
        frameSkipThreshold: this._calculateOptimalThreshold(panningFrames, 'frameTime', 0.9),
        qualityReductionThreshold: this._calculateOptimalThreshold(panningFrames, 'frameTime', 0.8)
      },
      idle: {
        frameSkipThreshold: this._calculateOptimalThreshold(idleFrames, 'frameTime', 0.95),
        qualityReductionThreshold: this._calculateOptimalThreshold(idleFrames, 'frameTime', 0.9)
      }
    };
    
    return suggestions;
  }
  
  /**
   * Suggest optimal frame budgets
   */
  suggestFrameBudgets(frames = null) {
    const frameList = frames || this.logger.frameLogs;
    if (frameList.length === 0) {
      return null;
    }
    
    const systemBreakdown = this.logger.getSystemTimeBreakdown(frameList);
    const targetFrameTime = 16.67;
    
    const suggestions = {
      canvas: this._calculateOptimalBudget(systemBreakdown.canvas, targetFrameTime, 0.4),
      gpu: this._calculateOptimalBudget(systemBreakdown.gpu, targetFrameTime, 0.4),
      other: this._calculateOptimalBudget(systemBreakdown.other, targetFrameTime, 0.2)
    };
    
    return suggestions;
  }
  
  /**
   * Calculate optimal threshold
   */
  _calculateOptimalThreshold(frames, metric, percentile) {
    if (frames.length === 0) return null;
    
    const values = frames.map(f => f[metric] || f.totalTime).sort((a, b) => a - b);
    const index = Math.floor(percentile * values.length);
    return values[index] || 0;
  }
  
  /**
   * Calculate optimal budget
   */
  _calculateOptimalBudget(system, targetFrameTime, defaultRatio) {
    if (!system) {
      return targetFrameTime * defaultRatio;
    }
    
    // Use P95 as basis for budget to account for variance
    const p95 = system.p95 || system.average;
    const suggested = Math.min(p95 * 1.2, targetFrameTime * defaultRatio);
    
    return {
      current: targetFrameTime * defaultRatio,
      suggested,
      basedOn: system.p95 ? 'P95' : 'average',
      reasoning: system.p95 > targetFrameTime * defaultRatio
        ? 'System consistently exceeds current budget'
        : 'System performs within budget'
    };
  }
  
  /**
   * Get system budget
   */
  _getSystemBudget(systemName) {
    const budgets = this.budgetAllocator.getBudgets();
    switch (systemName) {
      case 'canvas':
        return budgets.canvas;
      case 'gpu':
      case 'gpuPreview':
        return budgets.gpuPreview;
      case 'other':
        return budgets.other;
      default:
        return 16.67 * 0.1; // Default 10%
    }
  }
  
  /**
   * Get system optimization action
   */
  _getSystemOptimizationAction(systemName) {
    const actions = {
      canvas: 'Optimize canvas rendering: reduce draw calls, use caching, batch operations',
      gpu: 'Optimize GPU rendering: reduce shader complexity, lower resolution, use LOD',
      gpuPreview: 'Optimize GPU preview: reduce resolution, skip frames, lower quality',
      other: 'Optimize other operations: defer non-critical work, use requestIdleCallback'
    };
    
    return actions[systemName] || 'Review and optimize system performance';
  }
  
  /**
   * Generate performance report
   */
  generateReport(frames = null) {
    const analysis = this.analyzeBottlenecks(frames);
    const throttlingSuggestions = this.suggestThrottlingThresholds(frames);
    const budgetSuggestions = this.suggestFrameBudgets(frames);
    const stats = this.logger.getStats();
    
    return {
      timestamp: new Date().toISOString(),
      summary: {
        totalFrames: stats.totalFrames,
        averageFPS: analysis.frameTimeDistribution 
          ? (1000 / analysis.frameTimeDistribution.mean).toFixed(1)
          : 'N/A',
        averageFrameTime: analysis.frameTimeDistribution?.mean.toFixed(2) || 'N/A'
      },
      bottlenecks: analysis.bottlenecks,
      recommendations: analysis.recommendations,
      throttlingSuggestions,
      budgetSuggestions,
      statistics: stats,
      optimizationSavings: stats.optimizationSavings
    };
  }
}

// Singleton instance
let instance = null;

export function getPerformanceAnalyzer() {
  if (!instance) {
    instance = new PerformanceAnalyzer();
  }
  return instance;
}

