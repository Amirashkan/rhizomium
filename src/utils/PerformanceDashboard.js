/**
 * PerformanceDashboard.js
 * 
 * Visual performance dashboard that displays real-time performance metrics,
 * frame time breakdowns, throttling decisions, and interaction states.
 */

import { getPerformanceLogger } from './PerformanceLogger.js';
import { getFrameBudgetAllocator } from './FrameBudgetAllocator.js';
import { getInteractionStateManager } from './InteractionStateManager.js';

export class PerformanceDashboard {
  constructor(options = {}) {
    this.enabled = false;
    this.container = null;
    this.updateInterval = options.updateInterval || 100; // Update every 100ms
    this.updateTimer = null;
    
    // System references
    this.logger = getPerformanceLogger();
    this.budgetAllocator = getFrameBudgetAllocator();
    this.interactionStateManager = getInteractionStateManager();
    
    // Chart data
    this.chartData = {
      frameTime: {
        maxPoints: 100,
        points: []
      },
      fps: {
        maxPoints: 100,
        points: []
      },
      systemTimes: {
        maxPoints: 100,
        points: []
      }
    };
    
    // UI elements
    this.elements = {};
  }
  
  /**
   * Create and show the dashboard
   */
  show(container = null) {
    if (this.enabled) {
      return; // Already shown
    }
    
    this.container = container || this._createContainer();
    this._createDashboard();
    this.enabled = true;
    this._startUpdates();
  }
  
  /**
   * Hide the dashboard
   */
  hide() {
    if (!this.enabled) return;
    
    this._stopUpdates();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.enabled = false;
  }
  
  /**
   * Create container element
   */
  _createContainer() {
    const container = document.createElement('div');
    container.id = 'performance-dashboard';
    container.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      width: 600px;
      max-height: 90vh;
      background: rgba(10, 10, 20, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      padding: 16px;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 12px;
      color: #d0f6ff;
      z-index: 10000;
      overflow-y: auto;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    `;
    document.body.appendChild(container);
    return container;
  }
  
  /**
   * Create dashboard UI
   */
  _createDashboard() {
    if (!this.container) return;
    
    this.container.innerHTML = '';
    
    // Header
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;';
    header.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <h2 style="margin: 0; font-size: 16px; color: #fff;">Performance Dashboard</h2>
        <button id="dashboard-close" style="background: rgba(255,0,0,0.3); border: 1px solid rgba(255,0,0,0.5); color: #fff; padding: 4px 8px; border-radius: 4px; cursor: pointer;">Close</button>
      </div>
    `;
    this.container.appendChild(header);
    
    // Close button handler
    header.querySelector('#dashboard-close').addEventListener('click', () => {
      this.hide();
    });
    
    // Metrics section
    this._createMetricsSection();
    
    // Frame time chart
    this._createFrameTimeChart();
    
    // System breakdown
    this._createSystemBreakdown();
    
    // Throttling section
    this._createThrottlingSection();
    
    // Interaction state section
    this._createInteractionStateSection();
    
    // Statistics section
    this._createStatisticsSection();
  }
  
  /**
   * Create metrics section
   */
  _createMetricsSection() {
    const section = document.createElement('div');
    section.id = 'metrics-section';
    section.style.cssText = 'margin-bottom: 16px;';
    section.innerHTML = `
      <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #fff;">Current Metrics</h3>
      <div id="metrics-content" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <div>FPS: <span id="metric-fps">-</span></div>
        <div>Frame Time: <span id="metric-frame-time">-</span> ms</div>
        <div>Canvas: <span id="metric-canvas">-</span> ms</div>
        <div>GPU: <span id="metric-gpu">-</span> ms</div>
        <div>Other: <span id="metric-other">-</span> ms</div>
        <div>Budget: <span id="metric-budget">-</span></div>
      </div>
    `;
    this.container.appendChild(section);
    this.elements.metrics = section;
  }
  
  /**
   * Create frame time chart
   */
  _createFrameTimeChart() {
    const section = document.createElement('div');
    section.id = 'frame-time-chart';
    section.style.cssText = 'margin-bottom: 16px;';
    section.innerHTML = `
      <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #fff;">Frame Time History</h3>
      <canvas id="frame-time-canvas" width="560" height="100" style="width: 100%; height: 100px; background: rgba(0,0,0,0.3); border-radius: 4px;"></canvas>
    `;
    this.container.appendChild(section);
    this.elements.frameTimeChart = section.querySelector('#frame-time-canvas');
  }
  
  /**
   * Create system breakdown section
   */
  _createSystemBreakdown() {
    const section = document.createElement('div');
    section.id = 'system-breakdown';
    section.style.cssText = 'margin-bottom: 16px;';
    section.innerHTML = `
      <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #fff;">System Time Breakdown</h3>
      <div id="system-breakdown-content">
        <div>Canvas: <span id="system-canvas">-</span> ms</div>
        <div>GPU: <span id="system-gpu">-</span> ms</div>
        <div>Other: <span id="system-other">-</span> ms</div>
      </div>
    `;
    this.container.appendChild(section);
    this.elements.systemBreakdown = section;
  }
  
  /**
   * Create throttling section
   */
  _createThrottlingSection() {
    const section = document.createElement('div');
    section.id = 'throttling-section';
    section.style.cssText = 'margin-bottom: 16px;';
    section.innerHTML = `
      <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #fff;">Throttling Decisions</h3>
      <div id="throttling-content" style="max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; font-size: 11px;">
        <div>No throttling events</div>
      </div>
    `;
    this.container.appendChild(section);
    this.elements.throttling = section.querySelector('#throttling-content');
  }
  
  /**
   * Create interaction state section
   */
  _createInteractionStateSection() {
    const section = document.createElement('div');
    section.id = 'interaction-state';
    section.style.cssText = 'margin-bottom: 16px;';
    section.innerHTML = `
      <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #fff;">Interaction State</h3>
      <div id="interaction-state-content">
        <div>State: <span id="interaction-state-value">idle</span></div>
        <div>Duration: <span id="interaction-duration">-</span> ms</div>
        <div>Quality: <span id="interaction-quality">-</span>%</div>
      </div>
    `;
    this.container.appendChild(section);
    this.elements.interactionState = section;
  }
  
  /**
   * Create statistics section
   */
  _createStatisticsSection() {
    const section = document.createElement('div');
    section.id = 'statistics-section';
    section.style.cssText = 'margin-bottom: 16px;';
    section.innerHTML = `
      <h3 style="margin: 0 0 8px 0; font-size: 14px; color: #fff;">Statistics</h3>
      <div id="statistics-content" style="font-size: 11px;">
        <div>Total Frames: <span id="stat-total-frames">0</span></div>
        <div>Frames During Panning: <span id="stat-panning-frames">0</span></div>
        <div>Throttled Frames: <span id="stat-throttled-frames">0</span></div>
        <div>Skipped Frames: <span id="stat-skipped-frames">0</span></div>
        <div>Budget Exceeded: <span id="stat-budget-exceeded">0</span></div>
        <div>Time Saved: <span id="stat-time-saved">0</span> ms</div>
      </div>
    `;
    this.container.appendChild(section);
    this.elements.statistics = section;
  }
  
  /**
   * Start update loop
   */
  _startUpdates() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    
    this.updateTimer = setInterval(() => {
      this._update();
    }, this.updateInterval);
    
    // Initial update
    this._update();
  }
  
  /**
   * Stop update loop
   */
  _stopUpdates() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }
  
  /**
   * Update dashboard
   */
  _update() {
    if (!this.enabled || !this.container) return;
    
    // Update metrics
    this._updateMetrics();
    
    // Update charts
    this._updateFrameTimeChart();
    
    // Update system breakdown
    this._updateSystemBreakdown();
    
    // Update throttling
    this._updateThrottling();
    
    // Update interaction state
    this._updateInteractionState();
    
    // Update statistics
    this._updateStatistics();
  }
  
  /**
   * Update metrics display
   */
  _updateMetrics() {
    const stats = this.budgetAllocator.getStats();
    const frameLogs = this.logger.frameLogs;
    const latestFrame = frameLogs.length > 0 ? frameLogs[frameLogs.length - 1] : null;
    
    const fps = latestFrame && latestFrame.totalTime > 0 
      ? (1000 / latestFrame.totalTime).toFixed(1) 
      : stats.avgFrameTime > 0 
        ? (1000 / stats.avgFrameTime).toFixed(1) 
        : '-';
    
    const frameTime = latestFrame 
      ? latestFrame.totalTime.toFixed(2) 
      : stats.avgFrameTime > 0 
        ? stats.avgFrameTime.toFixed(2) 
        : '-';
    
    const canvas = latestFrame && latestFrame.systems?.canvas
      ? (latestFrame.systems.canvas.total / latestFrame.systems.canvas.count).toFixed(2)
      : stats.avgUsage?.canvas?.toFixed(2) || '-';
    
    const gpu = latestFrame && latestFrame.systems?.gpu
      ? (latestFrame.systems.gpu.total / latestFrame.systems.gpu.count).toFixed(2)
      : stats.avgUsage?.gpuPreview?.toFixed(2) || '-';
    
    const other = latestFrame && latestFrame.systems?.other
      ? (latestFrame.systems.other.total / latestFrame.systems.other.count).toFixed(2)
      : stats.avgUsage?.other?.toFixed(2) || '-';
    
    const budget = stats.budgets 
      ? `${stats.budgets.total.toFixed(1)} ms`
      : '-';
    
    this._setText('metric-fps', fps);
    this._setText('metric-frame-time', frameTime);
    this._setText('metric-canvas', canvas);
    this._setText('metric-gpu', gpu);
    this._setText('metric-other', other);
    this._setText('metric-budget', budget);
  }
  
  /**
   * Update frame time chart
   */
  _updateFrameTimeChart() {
    const canvas = this.elements.frameTimeChart;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, width, height);
    
    // Get recent frame times
    const frameLogs = this.logger.frameLogs;
    const recentFrames = frameLogs.slice(-this.chartData.frameTime.maxPoints);
    
    if (recentFrames.length === 0) return;
    
    // Find max frame time for scaling
    const maxFrameTime = Math.max(...recentFrames.map(f => f.totalTime), 16.67);
    
    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    const targetFrameTime = 16.67;
    const targetY = height - (targetFrameTime / maxFrameTime) * height;
    ctx.beginPath();
    ctx.moveTo(0, targetY);
    ctx.lineTo(width, targetY);
    ctx.stroke();
    
    // Draw frame time line
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    recentFrames.forEach((frame, index) => {
      const x = (index / (this.chartData.frameTime.maxPoints - 1)) * width;
      const y = height - (frame.totalTime / maxFrameTime) * height;
      
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    
    ctx.stroke();
  }
  
  /**
   * Update system breakdown
   */
  _updateSystemBreakdown() {
    const breakdown = this.logger.getSystemTimeBreakdown();
    
    const canvas = breakdown.canvas 
      ? breakdown.canvas.average.toFixed(2) 
      : '-';
    const gpu = breakdown.gpu 
      ? breakdown.gpu.average.toFixed(2) 
      : '-';
    const other = breakdown.other 
      ? breakdown.other.average.toFixed(2) 
      : '-';
    
    this._setText('system-canvas', canvas);
    this._setText('system-gpu', gpu);
    this._setText('system-other', other);
  }
  
  /**
   * Update throttling display
   */
  _updateThrottling() {
    const throttlingLogs = this.logger.getThrottlingLogs();
    const recent = throttlingLogs.slice(-10).reverse();
    
    if (recent.length === 0) {
      this.elements.throttling.innerHTML = '<div>No throttling events</div>';
      return;
    }
    
    const html = recent.map(log => {
      const time = new Date(log.timestamp).toLocaleTimeString();
      return `<div style="margin-bottom: 4px;">
        <span style="color: #ff9800;">[${time}]</span> 
        ${log.operation}: ${log.reason} 
        <span style="color: #4CAF50;">(${log.timeSaved.toFixed(2)}ms saved)</span>
      </div>`;
    }).join('');
    
    this.elements.throttling.innerHTML = html;
  }
  
  /**
   * Update interaction state
   */
  _updateInteractionState() {
    const state = this.interactionStateManager.getState();
    
    const stateValue = state.isInteracting 
      ? state.currentInteractionType || 'interacting'
      : 'idle';
    
    const duration = state.interactionDuration > 0
      ? state.interactionDuration.toFixed(0)
      : '-';
    
    const quality = (state.currentQualityLevel * 100).toFixed(0);
    
    this._setText('interaction-state-value', stateValue);
    this._setText('interaction-duration', duration);
    this._setText('interaction-quality', quality);
  }
  
  /**
   * Update statistics
   */
  _updateStatistics() {
    const stats = this.logger.getStats();
    const savings = stats.optimizationSavings;
    
    this._setText('stat-total-frames', stats.totalFrames);
    this._setText('stat-panning-frames', stats.framesDuringPanning);
    this._setText('stat-throttled-frames', stats.throttledFrames);
    this._setText('stat-skipped-frames', stats.skippedFrames);
    this._setText('stat-budget-exceeded', stats.budgetExceededFrames);
    this._setText('stat-time-saved', savings.total.toFixed(2));
  }
  
  /**
   * Helper to set text content
   */
  _setText(id, text) {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = text;
    }
  }
}

// Singleton instance
let instance = null;

export function getPerformanceDashboard() {
  if (!instance) {
    instance = new PerformanceDashboard();
  }
  return instance;
}

