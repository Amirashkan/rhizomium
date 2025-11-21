/**
 * ComputeProfilerOverlay - Visual overlay for displaying compute performance metrics
 *
 * Displays:
 * - FPS (frames per second)
 * - Frame time
 * - Total dispatch time
 * - Number of active compute dispatches
 * - Total workgroups
 * - Per-dispatch timing breakdown
 */

export class ComputeProfilerOverlay {
  constructor(container = document.body) {
    this.container = container;
    this.visible = false;
    this.expanded = false;

    this._createOverlay();
    this._setupEventListeners();
  }

  /**
   * Create the overlay DOM structure
   */
  _createOverlay() {
    // Main overlay container
    this.overlayElement = document.createElement('div');
    this.overlayElement.id = 'compute-profiler-overlay';
    this.overlayElement.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.85);
      color: #00ff00;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      padding: 12px;
      border-radius: 4px;
      border: 1px solid rgba(0, 255, 0, 0.3);
      z-index: 10000;
      min-width: 280px;
      max-width: 400px;
      display: none;
      user-select: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    `;

    // Header with title and controls
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(0, 255, 0, 0.3);
    `;

    const title = document.createElement('div');
    title.textContent = 'COMPUTE PROFILER';
    title.style.cssText = `
      font-weight: bold;
      font-size: 13px;
      color: #00ff88;
    `;

    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 8px;';

    // Expand/collapse button
    this.expandButton = document.createElement('button');
    this.expandButton.textContent = '+';
    this.expandButton.style.cssText = `
      background: rgba(0, 255, 0, 0.2);
      color: #00ff00;
      border: 1px solid rgba(0, 255, 0, 0.5);
      border-radius: 3px;
      width: 20px;
      height: 20px;
      cursor: pointer;
      font-weight: bold;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    this.expandButton.addEventListener('click', () => this.toggleExpanded());

    // Close button
    const closeButton = document.createElement('button');
    closeButton.textContent = '×';
    closeButton.style.cssText = `
      background: rgba(255, 0, 0, 0.2);
      color: #ff4444;
      border: 1px solid rgba(255, 0, 0, 0.5);
      border-radius: 3px;
      width: 20px;
      height: 20px;
      cursor: pointer;
      font-weight: bold;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    closeButton.addEventListener('click', () => this.hide());

    controls.appendChild(this.expandButton);
    controls.appendChild(closeButton);

    header.appendChild(title);
    header.appendChild(controls);

    // Main metrics section
    this.metricsSection = document.createElement('div');
    this.metricsSection.style.cssText = `
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 12px;
      margin-bottom: 8px;
    `;

    // Detailed dispatch list (hidden by default)
    this.detailsSection = document.createElement('div');
    this.detailsSection.style.cssText = `
      display: none;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(0, 255, 0, 0.3);
      max-height: 300px;
      overflow-y: auto;
    `;

    const detailsTitle = document.createElement('div');
    detailsTitle.textContent = 'DISPATCH BREAKDOWN';
    detailsTitle.style.cssText = `
      font-weight: bold;
      margin-bottom: 6px;
      color: #00ff88;
      font-size: 11px;
    `;
    this.detailsSection.appendChild(detailsTitle);

    this.dispatchList = document.createElement('div');
    this.dispatchList.style.cssText = 'font-size: 11px; line-height: 1.4;';
    this.detailsSection.appendChild(this.dispatchList);

    // Footer with help text
    this.footer = document.createElement('div');
    this.footer.style.cssText = `
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(0, 255, 0, 0.3);
      font-size: 10px;
      color: rgba(0, 255, 0, 0.6);
    `;
    this.footer.textContent = 'Press Ctrl+P to toggle | + for details';

    // Assemble overlay
    this.overlayElement.appendChild(header);
    this.overlayElement.appendChild(this.metricsSection);
    this.overlayElement.appendChild(this.detailsSection);
    this.overlayElement.appendChild(this.footer);

    this.container.appendChild(this.overlayElement);
  }

  /**
   * Setup keyboard shortcuts
   */
  _setupEventListeners() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+P to toggle overlay
      if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  /**
   * Create a metric row
   */
  _createMetricRow(label, value, color = '#00ff00') {
    const labelEl = document.createElement('div');
    labelEl.textContent = label + ':';
    labelEl.style.cssText = `
      color: rgba(0, 255, 0, 0.7);
      font-weight: normal;
    `;

    const valueEl = document.createElement('div');
    valueEl.textContent = value;
    valueEl.style.cssText = `
      color: ${color};
      font-weight: bold;
      text-align: right;
    `;

    return { labelEl, valueEl };
  }

  /**
   * Update overlay with new metrics
   * PERFORMANCE: Reuse DOM elements instead of clearing and recreating to avoid GC pressure
   */
  update(metrics) {
    if (!this.visible) return;

    // PERFORMANCE: Reuse existing metric elements instead of clearing and recreating
    // This avoids expensive DOM manipulation and reduces GC pressure
    if (!this._metricElements) {
      // First time: create elements
      this._metricElements = {};
      this.metricsSection.innerHTML = '';
      
      // FPS
      const fps = this._createMetricRow('FPS', '0.0', '#00ff00');
      this.metricsSection.appendChild(fps.labelEl);
      this.metricsSection.appendChild(fps.valueEl);
      this._metricElements.fps = fps;

      // Frame time
      const frameTime = this._createMetricRow('Frame Time', '0.00 ms', '#00ff00');
      this.metricsSection.appendChild(frameTime.labelEl);
      this.metricsSection.appendChild(frameTime.valueEl);
      this._metricElements.frameTime = frameTime;

      // Dispatch time
      const dispatchTime = this._createMetricRow('Compute Time', '0.00 ms', '#00ff00');
      this.metricsSection.appendChild(dispatchTime.labelEl);
      this.metricsSection.appendChild(dispatchTime.valueEl);
      this._metricElements.dispatchTime = dispatchTime;

      // Active dispatches
      const dispatches = this._createMetricRow('Dispatches', '0');
      this.metricsSection.appendChild(dispatches.labelEl);
      this.metricsSection.appendChild(dispatches.valueEl);
      this._metricElements.dispatches = dispatches;

      // Total workgroups
      const workgroups = this._createMetricRow('Workgroups', '0');
      this.metricsSection.appendChild(workgroups.labelEl);
      this.metricsSection.appendChild(workgroups.valueEl);
      this._metricElements.workgroups = workgroups;
    }

    // Update existing elements (much faster than recreating)
    // FPS
    const fpsColor = metrics.fps >= 60 ? '#00ff00' : metrics.fps >= 30 ? '#ffaa00' : '#ff4444';
    this._metricElements.fps.valueEl.textContent = metrics.fps.toFixed(1);
    this._metricElements.fps.valueEl.style.color = fpsColor;

    // Frame time
    const frameTimeColor = metrics.frameTime <= 16.67 ? '#00ff00' : metrics.frameTime <= 33.33 ? '#ffaa00' : '#ff4444';
    this._metricElements.frameTime.valueEl.textContent = metrics.frameTime.toFixed(2) + ' ms';
    this._metricElements.frameTime.valueEl.style.color = frameTimeColor;

    // Dispatch time
    const dispatchTimeColor = metrics.totalDispatchTime <= 5 ? '#00ff00' : metrics.totalDispatchTime <= 10 ? '#ffaa00' : '#ff4444';
    this._metricElements.dispatchTime.valueEl.textContent = metrics.totalDispatchTime.toFixed(2) + ' ms';
    this._metricElements.dispatchTime.valueEl.style.color = dispatchTimeColor;

    // Active dispatches
    this._metricElements.dispatches.valueEl.textContent = metrics.activeWorkgroups.toString();

    // Total workgroups
    this._metricElements.workgroups.valueEl.textContent = metrics.totalWorkgroups.toLocaleString();

    // Timestamp support
    const tsSupport = this._createMetricRow(
      'GPU Timing',
      metrics.supportsTimestamps ? 'Yes' : 'Fallback',
      metrics.supportsTimestamps ? '#00ff00' : '#ffaa00'
    );
    this.metricsSection.appendChild(tsSupport.labelEl);
    this.metricsSection.appendChild(tsSupport.valueEl);

    // Update detailed dispatch list if expanded
    if (this.expanded && metrics.dispatches && metrics.dispatches.length > 0) {
      this.dispatchList.innerHTML = '';

      metrics.dispatches.forEach((dispatch, index) => {
        const row = document.createElement('div');
        row.style.cssText = `
          padding: 4px;
          margin-bottom: 4px;
          background: rgba(0, 255, 0, 0.05);
          border-left: 2px solid rgba(0, 255, 0, 0.3);
          padding-left: 6px;
        `;

        const timing = dispatch.gpuDuration !== undefined ? dispatch.gpuDuration : dispatch.duration;
        const timingLabel = dispatch.gpuDuration !== undefined ? '(GPU)' : '(CPU)';

        const { dispatchSize, workgroupSize } = dispatch.workgroupInfo || {};
        const workgroupCount = dispatchSize
          ? (dispatchSize.x || 1) * (dispatchSize.y || 1) * (dispatchSize.z || 1)
          : 0;

        row.innerHTML = `
          <div style="color: #00ff88; font-weight: bold;">#${index + 1} ${dispatch.label}</div>
          <div style="margin-top: 2px;">
            <span style="color: rgba(0,255,0,0.7)">Time:</span>
            <span style="color: #00ff00">${timing.toFixed(3)} ms ${timingLabel}</span>
          </div>
          ${dispatchSize ? `
            <div style="margin-top: 2px;">
              <span style="color: rgba(0,255,0,0.7)">Dispatch:</span>
              <span style="color: #00ff00">${dispatchSize.x}×${dispatchSize.y}×${dispatchSize.z}</span>
              <span style="color: rgba(0,255,0,0.7); margin-left: 8px">Workgroup:</span>
              <span style="color: #00ff00">${workgroupSize?.x || 0}×${workgroupSize?.y || 0}×${workgroupSize?.z || 0}</span>
            </div>
            <div style="margin-top: 2px;">
              <span style="color: rgba(0,255,0,0.7)">Total:</span>
              <span style="color: #00ff00">${workgroupCount.toLocaleString()} workgroups</span>
            </div>
          ` : ''}
        `;

        this.dispatchList.appendChild(row);
      });
    }
  }

  /**
   * Show the overlay
   */
  show() {
    this.visible = true;
    this.overlayElement.style.display = 'block';
  }

  /**
   * Hide the overlay
   */
  hide() {
    this.visible = false;
    this.overlayElement.style.display = 'none';
  }

  /**
   * Toggle overlay visibility
   */
  toggle() {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Toggle expanded view
   */
  toggleExpanded() {
    this.expanded = !this.expanded;

    if (this.expanded) {
      this.detailsSection.style.display = 'block';
      this.expandButton.textContent = '−';
      this.footer.textContent = 'Press Ctrl+P to toggle | − to collapse';
    } else {
      this.detailsSection.style.display = 'none';
      this.expandButton.textContent = '+';
      this.footer.textContent = 'Press Ctrl+P to toggle | + for details';
    }
  }

  /**
   * Destroy the overlay
   */
  destroy() {
    if (this.overlayElement && this.overlayElement.parentNode) {
      this.overlayElement.parentNode.removeChild(this.overlayElement);
    }
  }
}
