// scripts/redraw_trigger_detection.js
// Integration script to set up and run redraw trigger detection

import { startRedrawTriggerDetection, getRedrawTriggerDetector } from '../src/utils/RedrawTriggerDetector.js';
import { getRedrawTriggerLogger } from '../src/utils/RedrawTriggerLogger.js';
import { RedrawTriggerAnalyzer } from '../src/utils/RedrawTriggerAnalyzer.js';
import { getRedrawTriggerSimulator } from '../src/utils/RedrawTriggerSimulator.js';

/**
 * Initialize redraw trigger detection system
 */
export function initializeRedrawTriggerDetection(options = {}) {
  const defaultOptions = {
    enabled: true,
    sessionDuration: 3600000, // 1 hour
    analysisInterval: 60000, // 1 minute
    trackStackTraces: true,
    ...options
  };

  // Start detector
  const detector = startRedrawTriggerDetection(defaultOptions);
  
  // Initialize logger
  const logger = getRedrawTriggerLogger({
    sessionDuration: defaultOptions.sessionDuration,
    logInterval: defaultOptions.analysisInterval
  });

  // Initialize analyzer
  const analyzer = new RedrawTriggerAnalyzer();

  // Initialize simulator (for testing)
  const simulator = getRedrawTriggerSimulator();

  console.log('[RedrawTriggerDetection] System initialized');
  console.log('[RedrawTriggerDetection] Use window.redrawTriggerDetection for controls');

  // Expose to window for debugging
  if (typeof window !== 'undefined') {
    window.redrawTriggerDetection = {
      detector,
      logger,
      analyzer,
      simulator,
      
      // Convenience methods
      startSession: (type = 'active') => logger.startSession(type),
      endSession: () => logger.endSession(),
      getInventory: () => analyzer.generateInventory(detector, logger),
      getReport: () => detector.getReport(),
      generateHTMLReport: () => {
        const inventory = analyzer.generateInventory(detector, logger);
        return analyzer.generateHTMLReport(inventory);
      },
      exportData: () => ({
        detector: detector.exportData(),
        logger: logger.exportData()
      }),
      runTestSuite: (duration = 60000) => simulator.runTestSuite(duration)
    };
  }

  return { detector, logger, analyzer, simulator };
}

/**
 * Run a 1-hour monitoring session
 */
export async function runMonitoringSession(sessionType = 'active', duration = 3600000) {
  const { detector, logger, analyzer } = initializeRedrawTriggerDetection({
    sessionDuration: duration
  });

  // Start logging session
  const sessionId = logger.startSession(sessionType);
  console.log(`[RedrawTriggerDetection] Started ${sessionType} session: ${sessionId}`);

  // Wait for duration
  await new Promise(resolve => setTimeout(resolve, duration));

  // End session
  logger.endSession();
  
  // Generate report
  const inventory = analyzer.generateInventory(detector, logger);
  const htmlReport = analyzer.generateHTMLReport(inventory);

  console.log('[RedrawTriggerDetection] Session completed');
  console.log('[RedrawTriggerDetection] Report generated');

  return {
    sessionId,
    inventory,
    htmlReport
  };
}

/**
 * Run idle session test
 */
export async function runIdleSessionTest(duration = 3600000) {
  console.log('[RedrawTriggerDetection] Starting idle session test');
  console.log('[RedrawTriggerDetection] Please leave the application idle for the test duration');
  
  return runMonitoringSession('idle', duration);
}

/**
 * Run active session test
 */
export async function runActiveSessionTest(duration = 3600000) {
  console.log('[RedrawTriggerDetection] Starting active session test');
  console.log('[RedrawTriggerDetection] Please use the application normally during the test');
  
  return runMonitoringSession('active', duration);
}

// Auto-initialize if in browser
if (typeof window !== 'undefined' && window.document) {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Don't auto-start, let user control it
      console.log('[RedrawTriggerDetection] System ready. Call initializeRedrawTriggerDetection() to start.');
    });
  } else {
    console.log('[RedrawTriggerDetection] System ready. Call initializeRedrawTriggerDetection() to start.');
  }
}

// Export for use in main application
if (typeof window !== 'undefined') {
  window.initializeRedrawTriggerDetection = initializeRedrawTriggerDetection;
  window.runMonitoringSession = runMonitoringSession;
  window.runIdleSessionTest = runIdleSessionTest;
  window.runActiveSessionTest = runActiveSessionTest;
}

