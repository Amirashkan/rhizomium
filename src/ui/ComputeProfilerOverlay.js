import { setIcon } from './iconSprite.js';
import { ACCENT, SEMANTIC, SURFACE, TEXT, FONT_MONO, FONT_UI, withAlpha } from '../core/theme.js';
import { getPresentedFpsCeiling } from '../core/presentedFrameRate.js';
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
      background: rgba(22, 18, 15, 0.94);
      color: ${TEXT.secondary};
      font-family: ${FONT_MONO};
      font-size: 11px;
      padding: 14px;
      border-radius: 14px;
      border: 1px solid ${SURFACE.lineStrong};
      z-index: 10000;
      min-width: 280px;
      max-width: 400px;
      display: none;
      user-select: none;
      box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 244, 230, 0.06);
    `;

    // Header with title and controls
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid ${SURFACE.line};
    `;

    const title = document.createElement('div');
    title.textContent = 'COMPUTE PROFILER';
    title.style.cssText = `
      font-family: ${FONT_UI};
      font-weight: 600;
      font-size: 10px;
      letter-spacing: 1.4px;
      color: ${TEXT.faint};
    `;

    const controls = document.createElement('div');
    controls.style.cssText = 'display: flex; gap: 8px;';

    // Expand/collapse button
    this.expandButton = document.createElement('button');
    setIcon(this.expandButton, 'expand', { size: 12, label: 'Expand' });
    this.expandButton.style.cssText = `
      background: ${SURFACE.fillSoft};
      color: ${TEXT.tertiary};
      border: 1px solid ${SURFACE.line};
      border-radius: 6px;
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
    setIcon(closeButton, 'close', { size: 12, label: 'Close' });
    closeButton.style.cssText = `
      background: ${withAlpha(SEMANTIC.error, 0.14)};
      color: ${SEMANTIC.error};
      border: 1px solid ${withAlpha(SEMANTIC.error, 0.35)};
      border-radius: 6px;
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
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid ${SURFACE.line};
      max-height: 300px;
      overflow-y: auto;
    `;

    const detailsTitle = document.createElement('div');
    detailsTitle.textContent = 'DISPATCH BREAKDOWN';
    detailsTitle.style.cssText = `
      font-family: ${FONT_UI};
      font-weight: 600;
      letter-spacing: 1.4px;
      margin-bottom: 6px;
      color: ${TEXT.faint};
      font-size: 10px;
    `;
    this.detailsSection.appendChild(detailsTitle);

    this.dispatchList = document.createElement('div');
    this.dispatchList.style.cssText = 'font-size: 11px; line-height: 1.4;';
    this.detailsSection.appendChild(this.dispatchList);

    // Footer with help text
    this.footer = document.createElement('div');
    this.footer.style.cssText = `
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid ${SURFACE.line};
      font-size: 10px;
      color: ${TEXT.faint};
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
      // Ctrl/Cmd+Alt+P toggles the overlay.
      //
      // Not Ctrl+P, which this used to use and which was already taken twice
      // over: main.js binds it to the floating preview, and the browser binds
      // it to Print. Two separate document listeners meant one keypress toggled
      // the preview AND this panel, since preventDefault does not stop the
      // other listener from running.
      //
      // e.code rather than e.key, because e.key reports 'P' when Caps Lock is
      // on (which the old lowercase comparison missed entirely) and reports 'π'
      // when Alt is held on macOS. e.code is the physical key either way.
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  /**
   * Create a metric row
   */
  _createMetricRow(label, value, color = TEXT.primary) {
    const labelEl = document.createElement('div');
    labelEl.textContent = label + ':';
    labelEl.style.cssText = `
      color: ${TEXT.tertiary};
      font-weight: normal;
    `;

    const valueEl = document.createElement('div');
    valueEl.textContent = value;
    valueEl.style.cssText = `
      color: ${color};
      font-weight: 500;
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
      const fps = this._createMetricRow('FPS', '0.0', TEXT.primary);
      this.metricsSection.appendChild(fps.labelEl);
      this.metricsSection.appendChild(fps.valueEl);
      this._metricElements.fps = fps;

      // Frame time
      const frameTime = this._createMetricRow('Frame Time', '0.00 ms', TEXT.primary);
      this.metricsSection.appendChild(frameTime.labelEl);
      this.metricsSection.appendChild(frameTime.valueEl);
      this._metricElements.frameTime = frameTime;

      // Dispatch time
      const dispatchTime = this._createMetricRow('Compute Time', '0.00 ms', TEXT.primary);
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
    // Graded against the rate this window has actually managed, not a hardcoded
    // 60: on a compositor clocked at 48 a steady 48 is healthy, and on a 75Hz
    // panel 60 is not.
    const ceiling = getPresentedFpsCeiling();
    const fpsColor = metrics.fps >= ceiling * 0.85 ? TEXT.primary
      : metrics.fps >= ceiling * 0.55 ? SEMANTIC.warn : SEMANTIC.error;
    this._metricElements.fps.valueEl.textContent = metrics.fps.toFixed(1);
    this._metricElements.fps.valueEl.style.color = fpsColor;

    // Frame time
    const frameTimeColor = metrics.frameTime <= 16.67 ? TEXT.primary : metrics.frameTime <= 33.33 ? SEMANTIC.warn : SEMANTIC.error;
    this._metricElements.frameTime.valueEl.textContent = metrics.frameTime.toFixed(2) + ' ms';
    this._metricElements.frameTime.valueEl.style.color = frameTimeColor;

    // Dispatch time
    const dispatchTimeColor = metrics.totalDispatchTime <= 5 ? TEXT.primary : metrics.totalDispatchTime <= 10 ? SEMANTIC.warn : SEMANTIC.error;
    this._metricElements.dispatchTime.valueEl.textContent = metrics.totalDispatchTime.toFixed(2) + ' ms';
    this._metricElements.dispatchTime.valueEl.style.color = dispatchTimeColor;

    // Active dispatches
    this._metricElements.dispatches.valueEl.textContent = metrics.activeWorkgroups.toString();

    // Total workgroups
    this._metricElements.workgroups.valueEl.textContent = metrics.totalWorkgroups.toLocaleString();

    // Timestamp support (reuse element if exists)
    if (!this._metricElements.tsSupport) {
      const tsSupport = this._createMetricRow('GPU Timing', 'Fallback', SEMANTIC.warn);
      this.metricsSection.appendChild(tsSupport.labelEl);
      this.metricsSection.appendChild(tsSupport.valueEl);
      this._metricElements.tsSupport = tsSupport;
    }
    const tsSupportColor = metrics.supportsTimestamps ? TEXT.primary : SEMANTIC.warn;
    this._metricElements.tsSupport.valueEl.textContent = metrics.supportsTimestamps ? 'Yes' : 'Fallback';
    this._metricElements.tsSupport.valueEl.style.color = tsSupportColor;

    // Update detailed dispatch list if expanded
    if (this.expanded && metrics.dispatches && metrics.dispatches.length > 0) {
      // PERFORMANCE: Reuse dispatch list items instead of clearing and recreating
      // This reduces DOM manipulation overhead and prevents duplicate entries
      const existingRows = this.dispatchList.children;
      const dispatchCount = metrics.dispatches.length;
      
      // Remove excess rows if we have more than needed
      while (existingRows.length > dispatchCount) {
        this.dispatchList.removeChild(existingRows[existingRows.length - 1]);
      }
      
      // Update or create rows
      metrics.dispatches.forEach((dispatch, index) => {
        let row = existingRows[index];
        
        if (!row) {
          // Create new row if it doesn't exist
          row = document.createElement('div');
          row.style.cssText = `
            padding: 5px 6px;
            margin-bottom: 4px;
            border-radius: 6px;
            background: ${SURFACE.fillSoft};
            border-left: 2px solid ${SURFACE.lineStrong};
          `;
          this.dispatchList.appendChild(row);
        }
        
        // Update existing row content
        const timing = dispatch.gpuDuration !== undefined ? dispatch.gpuDuration : dispatch.duration;
        const timingLabel = dispatch.gpuDuration !== undefined ? '(GPU)' : '(CPU)';

        const { dispatchSize, workgroupSize } = dispatch.workgroupInfo || {};
        const workgroupCount = dispatchSize
          ? (dispatchSize.x || 1) * (dispatchSize.y || 1) * (dispatchSize.z || 1)
          : 0;

        row.innerHTML = `
          <div style="color: ${TEXT.primary}; font-weight: 600;">#${index + 1} ${dispatch.label}</div>
          <div style="margin-top: 2px;">
            <span style="color: ${TEXT.tertiary}">Time:</span>
            <span style="color: ${ACCENT.base}">${timing.toFixed(3)} ms ${timingLabel}</span>
          </div>
          ${dispatchSize ? `
            <div style="margin-top: 2px;">
              <span style="color: ${TEXT.tertiary}">Dispatch:</span>
              <span style="color: ${ACCENT.base}">${dispatchSize.x}×${dispatchSize.y}×${dispatchSize.z}</span>
              <span style="color: ${TEXT.tertiary}; margin-left: 8px">Workgroup:</span>
              <span style="color: ${ACCENT.base}">${workgroupSize?.x || 0}×${workgroupSize?.y || 0}×${workgroupSize?.z || 0}</span>
            </div>
            <div style="margin-top: 2px;">
              <span style="color: ${TEXT.tertiary}">Total:</span>
              <span style="color: ${ACCENT.base}">${workgroupCount.toLocaleString()} workgroups</span>
            </div>
          ` : ''}
        `;
      });
    } else if (this.expanded) {
      // Clear dispatch list if not expanded or no dispatches
      this.dispatchList.innerHTML = '';
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
      setIcon(this.expandButton, 'collapse', { size: 12, label: 'Collapse' });
      this.footer.textContent = 'Press Ctrl+P to toggle';
    } else {
      this.detailsSection.style.display = 'none';
      setIcon(this.expandButton, 'expand', { size: 12, label: 'Expand' });
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
