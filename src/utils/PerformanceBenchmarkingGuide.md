# Performance Benchmarking Guide

This guide explains how to use the comprehensive performance benchmarking system for measuring and optimizing canvas panning and overall application performance.

## Overview

The performance benchmarking system consists of several integrated components:

1. **PerformanceBenchmark** - Main benchmark runner with test scenarios
2. **PerformanceLogger** - Detailed frame time logging system
3. **PerformanceDashboard** - Visual dashboard with real-time metrics
4. **PerformanceAnalyzer** - Bottleneck identification and analysis
5. **PanningTestScenarios** - Predefined panning test scenarios

## Quick Start

### Enable Performance Monitoring

The performance logger is automatically integrated with `PreviewPerfMonitor`. To enable it:

```javascript
// Enable preview performance overlay (also enables logging)
window.togglePreviewPerfOverlay();

// Or enable logger directly
window.performanceLogger.setEnabled(true);
```

### Show Performance Dashboard

```javascript
// Show the visual dashboard
window.performanceDashboard.show();

// Hide the dashboard
window.performanceDashboard.hide();
```

## Running Benchmarks

### Basic Benchmark

```javascript
const benchmark = window.performanceBenchmark;

// Create a simple test scenario
const testScenario = {
  name: 'My Test',
  setup: async () => {
    // Setup code before measurement
  },
  onFrame: (frameNumber, timestamp) => {
    // Code to execute each frame during measurement
  },
  cleanup: async () => {
    // Cleanup code after measurement
  }
};

// Run the benchmark
const results = await benchmark.runTest(testScenario, {
  warmupFrames: 60,      // Frames to warmup (default: 60)
  measurementFrames: 300, // Frames to measure (default: 300)
  cooldownFrames: 30     // Frames to cooldown (default: 30)
});

console.log('Benchmark Results:', results);
```

### Panning Test Scenarios

Use predefined panning test scenarios:

```javascript
import { PanningTestScenarios, createPanningTestScenario } from './PanningTestScenarios.js';

// Get editor instance (adjust based on your app structure)
const editor = window.editor; // or however you access your editor

// Create a test scenario with editor context
const horizontalPanTest = createPanningTestScenario(
  PanningTestScenarios.horizontalPan,
  editor
);

// Run the benchmark
const results = await benchmark.runTest(horizontalPanTest);

// Compare with another scenario
const verticalPanTest = createPanningTestScenario(
  PanningTestScenarios.verticalPan,
  editor
);
const results2 = await benchmark.runTest(verticalPanTest);

// Compare results
const comparison = benchmark.compareResults(results, results2);
console.log('FPS Improvement:', comparison.fps.improvementPercent + '%');
```

### Available Panning Scenarios

- `PanningTestScenarios.horizontalPan` - Horizontal panning
- `PanningTestScenarios.verticalPan` - Vertical panning
- `PanningTestScenarios.diagonalPan` - Diagonal panning
- `PanningTestScenarios.circularPan` - Circular panning pattern
- `PanningTestScenarios.fastPan` - Fast panning (stress test)
- `PanningTestScenarios.slowPan` - Slow panning (precision test)
- `PanningTestScenarios.randomPan` - Random panning pattern

## Performance Logging

### Automatic Logging

The logger automatically tracks frame times when integrated with `PreviewPerfMonitor`. Manual logging:

```javascript
const logger = window.performanceLogger;

// Start a frame
logger.startFrame(frameNumber, timestamp);

// Log system times
logger.logSystemTime('canvas', 5.2);
logger.logSystemTime('gpu', 8.1);
logger.logSystemTime('other', 2.3);

// Log throttling decisions
logger.logThrottling('timeline', 'panning_active', 3.5);

// Log frame skip
logger.logFrameSkip('interaction_throttle', 16.67);

// End frame
logger.endFrame();
```

### Querying Logs

```javascript
// Get logs for a time range
const logs = logger.getLogs(startTime, endTime, {
  type: 'frame',
  system: 'canvas'
});

// Get frames during panning
const panningFrames = logger.getPanningFrames();

// Get throttling logs
const throttlingLogs = logger.getThrottlingLogs('timeline');

// Get statistics
const stats = logger.getStats();
console.log('Total frames:', stats.totalFrames);
console.log('Time saved:', stats.optimizationSavings.total, 'ms');

// Get frame time distribution
const distribution = logger.getFrameTimeDistribution(panningFrames);
console.log('P95 frame time:', distribution.p95, 'ms');

// Get system time breakdown
const breakdown = logger.getSystemTimeBreakdown();
console.log('Canvas average:', breakdown.canvas.average, 'ms');
```

## Performance Analysis

### Identify Bottlenecks

```javascript
const analyzer = window.performanceAnalyzer;

// Analyze all frames
const analysis = analyzer.analyzeBottlenecks();

// Analyze specific frames (e.g., during panning)
const panningFrames = logger.getPanningFrames();
const panningAnalysis = analyzer.analyzeBottlenecks(panningFrames);

console.log('Bottlenecks:', analysis.bottlenecks);
console.log('Recommendations:', analysis.recommendations);
```

### Get Optimization Suggestions

```javascript
// Suggest throttling thresholds
const throttlingSuggestions = analyzer.suggestThrottlingThresholds();
console.log('Panning frame skip threshold:', throttlingSuggestions.panning.frameSkipThreshold);

// Suggest frame budgets
const budgetSuggestions = analyzer.suggestFrameBudgets();
console.log('Suggested canvas budget:', budgetSuggestions.canvas.suggested, 'ms');

// Generate full report
const report = analyzer.generateReport();
console.log('Performance Report:', report);
```

## Performance Dashboard

The dashboard provides real-time visualization of performance metrics:

```javascript
const dashboard = window.performanceDashboard;

// Show dashboard
dashboard.show();

// Dashboard automatically updates every 100ms
// It displays:
// - Current FPS and frame times
// - System time breakdown (canvas, GPU, other)
// - Frame time history chart
// - Throttling decisions
// - Interaction state
// - Statistics
```

## Comparing Before/After Optimizations

```javascript
// Run benchmark before optimization
const beforeResults = await benchmark.runTest(testScenario);

// Apply optimization
// ... your optimization code ...

// Run benchmark after optimization
const afterResults = await benchmark.runTest(testScenario);

// Compare results
const comparison = benchmark.compareResults(beforeResults, afterResults);

console.log('FPS Improvement:', comparison.fps.improvementPercent + '%');
console.log('Frame Time Improvement:', comparison.frameTime.improvementPercent + '%');
console.log('Canvas Time Saved:', comparison.systemTimes.canvas.improvement, 'ms');
```

## Exporting and Importing Results

```javascript
// Export benchmark results
const json = benchmark.exportResults();
localStorage.setItem('benchmarkResults', json);

// Import benchmark results
const savedJson = localStorage.getItem('benchmarkResults');
benchmark.importResults(savedJson);

// Export performance logs
const logsJson = logger.exportLogs();
// Save to file or send to server
```

## Example: Complete Panning Performance Test

```javascript
import { PanningTestScenarios, createPanningTestScenario } from './PanningTestScenarios.js';

async function runPanningPerformanceTest(editor) {
  const benchmark = window.performanceBenchmark;
  const logger = window.performanceLogger;
  const analyzer = window.performanceAnalyzer;
  
  // Enable logging
  logger.setEnabled(true);
  
  // Test horizontal panning
  const horizontalTest = createPanningTestScenario(
    PanningTestScenarios.horizontalPan,
    editor
  );
  
  console.log('Running horizontal panning test...');
  const horizontalResults = await benchmark.runTest(horizontalTest);
  
  // Test fast panning
  const fastTest = createPanningTestScenario(
    PanningTestScenarios.fastPan,
    editor
  );
  
  console.log('Running fast panning test...');
  const fastResults = await benchmark.runTest(fastTest);
  
  // Analyze results
  const panningFrames = logger.getPanningFrames();
  const analysis = analyzer.analyzeBottlenecks(panningFrames);
  
  // Generate report
  const report = analyzer.generateReport(panningFrames);
  
  console.log('Test Complete!');
  console.log('Horizontal Pan FPS:', horizontalResults.averageFPS);
  console.log('Fast Pan FPS:', fastResults.averageFPS);
  console.log('Bottlenecks:', analysis.bottlenecks);
  console.log('Recommendations:', analysis.recommendations);
  
  return {
    horizontalResults,
    fastResults,
    analysis,
    report
  };
}

// Run the test
runPanningPerformanceTest(window.editor);
```

## Integration with Main Application

The benchmarking system is automatically integrated with `PreviewPerfMonitor`. To use it in your main application:

1. Ensure `PreviewPerfMonitor` is initialized (it's usually initialized automatically)
2. Access tools via `window.performanceBenchmark`, `window.performanceLogger`, etc.
3. Use the dashboard for real-time monitoring
4. Run benchmarks to measure performance improvements

## Tips

1. **Warmup Period**: Always include a warmup period to let the system stabilize
2. **Multiple Runs**: Run benchmarks multiple times and average results for accuracy
3. **Realistic Scenarios**: Use test scenarios that match real user interactions
4. **Monitor Dashboard**: Keep the dashboard open during development to see real-time performance
5. **Export Results**: Save benchmark results for comparison over time
6. **Analyze Bottlenecks**: Use the analyzer to identify specific performance issues
7. **Iterate**: Use analysis results to guide optimization efforts

## API Reference

See individual file documentation for detailed API reference:
- `PerformanceBenchmark.js` - Benchmark runner API
- `PerformanceLogger.js` - Logging API
- `PerformanceDashboard.js` - Dashboard API
- `PerformanceAnalyzer.js` - Analysis API
- `PanningTestScenarios.js` - Test scenario definitions

