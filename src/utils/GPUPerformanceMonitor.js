/**
 * GPUPerformanceMonitor - Enhanced GPU performance monitoring and display
 *
 * Features:
 * - Auto-show profiler overlay on startup
 * - Enhanced keyboard shortcuts
 * - Performance warnings
 * - Test runner integration
 */

import { GPUPerformanceTest } from '../test/GPUPerformanceTest.js';

export class GPUPerformanceMonitor {
  constructor(options = {}) {
    this.options = {
      autoShowOverlay: options.autoShowOverlay !== false,
      enableWarnings: options.enableWarnings !== false,
      fpsWarningThreshold: options.fpsWarningThreshold || 30,
      frameTimeWarningThreshold: options.frameTimeWarningThreshold || 33.33,
      ...options
    };

    this.profiler = null;
    this.overlay = null;
    this.testRunner = null;
    this.warningShown = false;
    this.lastWarningTime = 0;
    this.warningCooldown = 5000; // 5 seconds between warnings
  }

  /**
   * Initialize the performance monitor
   */
  initialize(device) {

    this.profiler = window.computeProfiler;
    this.overlay = window.profilerOverlay;

    if (!this.profiler || !this.overlay) {
      return false;
    }

    // Show overlay if auto-show is enabled
    if (this.options.autoShowOverlay) {
      this.overlay.show();
    }

    // Setup enhanced keyboard shortcuts
    this._setupKeyboardShortcuts();

    // Create test runner
    if (device) {
      this.testRunner = new GPUPerformanceTest(device);
      window.gpuPerformanceTest = this.testRunner;
    }

    // Setup performance monitoring
    if (this.options.enableWarnings) {
      this._setupPerformanceWarnings();
    }

    return true;
  }

  /**
   * Setup enhanced keyboard shortcuts
   */
  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+P - Run performance tests
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        this.runTests();
      }

      // Ctrl+Shift+R - Reset profiler
      if (e.ctrlKey && e.shiftKey && e.key === 'R') {
        e.preventDefault();
        if (this.profiler) {
          this.profiler.reset();
        }
      }

      // Ctrl+Shift+E - Toggle profiler enabled/disabled
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        if (this.profiler) {
          const metrics = this.profiler.getMetrics();
          this.profiler.setEnabled(!metrics.enabled);
        }
      }
    });

  }

  /**
   * Setup performance warning system
   */
  _setupPerformanceWarnings() {
    // Check performance metrics periodically
    setInterval(() => {
      if (!this.profiler) return;

      const metrics = this.profiler.getMetrics();
      const now = Date.now();

      // Only show warnings if enough time has passed since last warning
      if (now - this.lastWarningTime < this.warningCooldown) return;

      // Check FPS
      if (metrics.fps > 0 && metrics.fps < this.options.fpsWarningThreshold) {
        this._showPerformanceWarning(`Low FPS: ${metrics.fps.toFixed(1)} (threshold: ${this.options.fpsWarningThreshold})`);
        this.lastWarningTime = now;
        return;
      }

      // Check frame time
      if (metrics.frameTime > this.options.frameTimeWarningThreshold) {
        this._showPerformanceWarning(`High frame time: ${metrics.frameTime.toFixed(2)}ms (threshold: ${this.options.frameTimeWarningThreshold}ms)`);
        this.lastWarningTime = now;
        return;
      }

      // Check compute time (should not exceed frame time)
      if (metrics.totalDispatchTime > metrics.frameTime * 0.8) {
        this._showPerformanceWarning(`Compute time high: ${metrics.totalDispatchTime.toFixed(2)}ms (${(metrics.totalDispatchTime / metrics.frameTime * 100).toFixed(1)}% of frame time)`);
        this.lastWarningTime = now;
        return;
      }
    }, 1000); // Check every second
  }

  /**
   * Show performance warning
   */
  _showPerformanceWarning(message) {

    // Show overlay if it's hidden
    if (this.overlay && !this.overlay.visible) {
      this.overlay.show();
    }
  }

  /**
   * Run performance tests
   */
  async runTests() {
    if (!this.testRunner) {

      return null;
    }

    const results = await this.testRunner.runAllTests();

    // Generate and save report
    const report = this.testRunner.generateReport();

    return results;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    if (!this.profiler) return null;
    return this.profiler.getMetrics();
  }

  /**
   * Show overlay
   */
  showOverlay() {
    if (this.overlay) {
      this.overlay.show();
    }
  }

  /**
   * Hide overlay
   */
  hideOverlay() {
    if (this.overlay) {
      this.overlay.hide();
    }
  }

  /**
   * Toggle overlay
   */
  toggleOverlay() {
    if (this.overlay) {
      this.overlay.toggle();
    }
  }

  /**
   * Enable profiler
   */
  enableProfiler() {
    if (this.profiler) {
      this.profiler.setEnabled(true);
    }
  }

  /**
   * Disable profiler
   */
  disableProfiler() {
    if (this.profiler) {
      this.profiler.setEnabled(false);
    }
  }

  /**
   * Reset profiler
   */
  resetProfiler() {
    if (this.profiler) {
      this.profiler.reset();
    }
  }
}

// Auto-register for global access
if (typeof window !== 'undefined') {
  window.GPUPerformanceMonitor = GPUPerformanceMonitor;
}
