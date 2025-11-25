# Redraw Trigger Detection System

## Overview

The Redraw Trigger Detection System is designed to identify non-user-driven redraws that may spam the renderer. It monitors timers, observers, worker messages, and other automated triggers to help optimize rendering performance.

## Features

- **Comprehensive Monitoring**: Tracks `setInterval`, `setTimeout`, `requestAnimationFrame`, `MutationObserver`, `IntersectionObserver`, `ResizeObserver`, `PerformanceObserver`, and Worker messages
- **Redraw Correlation**: Links redraws to their triggering sources using stack traces and timing analysis
- **Severity Ranking**: Automatically categorizes triggers by severity (critical, high, medium, low, info) based on frequency and impact
- **Session Tracking**: Supports long-term monitoring over 1-hour idle/active sessions
- **Background Simulation**: Includes tools to simulate background operations for testing
- **Detailed Reporting**: Generates HTML and JSON reports with recommendations

## Quick Start

### Basic Usage

```javascript
// Initialize the detection system
import { initializeRedrawTriggerDetection } from './scripts/redraw_trigger_detection.js';

// Start monitoring
const { detector, logger, analyzer } = initializeRedrawTriggerDetection({
  sessionDuration: 3600000, // 1 hour
  analysisInterval: 60000,  // Analyze every minute
  trackStackTraces: true
});

// Start a logging session
logger.startSession('active'); // or 'idle'

// ... use the application ...

// End session and get report
logger.endSession();
const inventory = analyzer.generateInventory(detector, logger);
const htmlReport = analyzer.generateHTMLReport(inventory);

// Save or display the report
console.log(htmlReport);
```

### Browser Console Usage

After loading the application, the system exposes a global API:

```javascript
// Initialize (if not auto-initialized)
window.initializeRedrawTriggerDetection();

// Access the detection system
const detection = window.redrawTriggerDetection;

// Start a session
detection.startSession('active');

// Get current inventory
const inventory = detection.getInventory();

// Generate HTML report
const html = detection.generateHTMLReport();

// Export all data
const data = detection.exportData();
```

## Components

### RedrawTriggerDetector

The core monitoring component that wraps browser APIs to track triggers.

**Key Methods:**
- `start()` - Begin monitoring
- `stop()` - Stop monitoring
- `getReport()` - Get current monitoring report
- `getInventory()` - Get trigger inventory with severity ranking
- `exportData()` - Export all collected data

### RedrawTriggerLogger

Manages long-term session logging and data persistence.

**Key Methods:**
- `startSession(type)` - Start a new session ('active' or 'idle')
- `endSession()` - End current session and generate summary
- `getSessions()` - Get all logged sessions
- `getCombinedAnalysis()` - Get analysis across all sessions
- `loadFromStorage()` - Load sessions from localStorage
- `exportData()` - Export all session data

### RedrawTriggerAnalyzer

Generates reports and recommendations from collected data.

**Key Methods:**
- `generateInventory(detector, logger)` - Generate comprehensive inventory
- `generateHTMLReport(inventory)` - Generate HTML report
- `generateJSONReport(inventory)` - Generate JSON report

### RedrawTriggerSimulator

Simulates background operations for testing.

**Key Methods:**
- `simulateAutoSave(interval, duration)` - Simulate auto-save operations
- `simulateBackgroundSync(interval, duration)` - Simulate background sync
- `simulateObserverUpdates(interval, duration)` - Simulate observer-triggered updates
- `simulateWorkerMessages(interval, duration)` - Simulate worker message spam
- `simulateRAFSpam(duration)` - Simulate requestAnimationFrame spam
- `runTestSuite(duration)` - Run all simulations
- `stopAll()` - Stop all simulations

## Running Tests

### Idle Session Test

Monitor the application during idle periods:

```javascript
import { runIdleSessionTest } from './scripts/redraw_trigger_detection.js';

// Run 1-hour idle test
const result = await runIdleSessionTest(3600000);
console.log(result.htmlReport);
```

### Active Session Test

Monitor during normal usage:

```javascript
import { runActiveSessionTest } from './scripts/redraw_trigger_detection.js';

// Run 1-hour active test
const result = await runActiveSessionTest(3600000);
console.log(result.htmlReport);
```

### Simulation Test

Test with simulated background operations:

```javascript
const detection = window.redrawTriggerDetection;

// Start monitoring
detection.startSession('active');

// Run test suite (1 minute)
detection.runTestSuite(60000);

// Wait for completion, then get report
setTimeout(() => {
  const inventory = detection.getInventory();
  console.log(inventory);
}, 65000);
```

## Severity Levels

Triggers are ranked by severity based on frequency and impact:

- **Critical**: 10+ redraws/second, affects 50%+ of all redraws
- **High**: 5+ redraws/second, affects 25%+ of all redraws
- **Medium**: 1+ redraws/second, affects 10%+ of all redraws
- **Low**: 0.1+ redraws/second, affects 5%+ of all redraws
- **Info**: Below low threshold

## Report Structure

The generated inventory includes:

1. **Session Information**: Duration, type (active/idle), timestamps
2. **Statistics**: Total redraws, redraw rate, active resources
3. **Triggers by Severity**: Categorized list of all triggers
4. **Triggers by Type**: Grouped by timer, observer, worker, etc.
5. **Active Resources**: Detailed information about active timers, observers, workers
6. **Recommendations**: Actionable suggestions for optimization
7. **Historical Data**: Aggregated data from multiple sessions (if available)

## Integration with Existing Systems

The system integrates with `RedrawDiagnostics`:

```javascript
import { enableRedrawDiagnostics } from './src/utils/RedrawDiagnostics.js';

// Enable both systems
enableRedrawDiagnostics(true);
window.initializeRedrawTriggerDetection();
```

## Potential Risks & Limitations

1. **Race Conditions**: Some trigger-to-redraw correlations may be missed due to timing
2. **Test Environment**: Behavior may differ from production due to different load conditions
3. **Observer Wrapping**: Wrapping observer constructors may interfere with some libraries
4. **Performance Overhead**: Monitoring adds some overhead; disable in production if needed
5. **Stack Trace Collection**: Can be expensive; disable if performance is critical

## Best Practices

1. **Run Tests in Production-like Environment**: Use similar hardware and load conditions
2. **Test Both Idle and Active Sessions**: Different triggers may appear in each
3. **Review Recommendations Carefully**: Some may be false positives
4. **Combine with Profiling**: Use browser DevTools alongside this system
5. **Monitor Over Multiple Sessions**: Patterns may only emerge over time

## Example Workflow

```javascript
// 1. Initialize
window.initializeRedrawTriggerDetection();

// 2. Start idle session
window.redrawTriggerDetection.startSession('idle');

// 3. Leave application idle for 1 hour
// (or use setTimeout to simulate)

// 4. End session
window.redrawTriggerDetection.endSession();

// 5. Generate report
const inventory = window.redrawTriggerDetection.getInventory();
const html = window.redrawTriggerDetection.generateHTMLReport();

// 6. Save report
const blob = new Blob([html], { type: 'text/html' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'redraw-trigger-report.html';
a.click();

// 7. Review and act on recommendations
console.log(inventory.recommendations);
```

## Troubleshooting

### Detection Not Working

- Ensure `initializeRedrawTriggerDetection()` is called after the editor is initialized
- Check browser console for errors
- Verify that `window.editor` exists and has `draw()` and `markDirty()` methods

### Missing Triggers

- Some triggers may be missed if they occur very quickly
- Increase `analysisInterval` for more frequent checks
- Enable `trackStackTraces` for better correlation

### Performance Issues

- Disable `trackStackTraces` if performance is impacted
- Reduce `analysisInterval` frequency
- Stop monitoring when not needed

## API Reference

See individual component files for detailed API documentation:
- `src/utils/RedrawTriggerDetector.js`
- `src/utils/RedrawTriggerLogger.js`
- `src/utils/RedrawTriggerAnalyzer.js`
- `src/utils/RedrawTriggerSimulator.js`
- `scripts/redraw_trigger_detection.js`

