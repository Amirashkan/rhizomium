// Vercel Speed Insights initialization
// This module initializes Speed Insights tracking for the application.
// It's imported by the main entry points to track performance metrics.

import { injectSpeedInsights } from "@vercel/speed-insights";

// Initialize Speed Insights immediately when this module is imported
// This will track Web Vitals and other performance metrics
injectSpeedInsights();

export { injectSpeedInsights };
