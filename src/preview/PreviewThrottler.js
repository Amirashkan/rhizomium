// src/preview/PreviewThrottler.js
// Throttling mechanism for preview updates during user interactions

export class PreviewThrottler {
  constructor() {
    // Throttle intervals (ms) for different interaction modes
    this.intervals = {
      idle: 16,      // ~60fps when idle
      edit: 100,     // 10fps during parameter editing
      drag: 50,      // 20fps during parameter dragging (improved for real-time external view)
      compile: 500   // 2fps during shader compilation
    };

    this.mode = 'idle';
    this.lastUpdate = 0;
    this.pendingUpdate = null;
    this.updateTimeout = null;

    // Track interaction state
    this.isDragging = false;
    this.isEditing = false;
    this.isCompiling = false;
  }

  /**
   * Set the current interaction mode
   * @param {string} mode - One of: idle, edit, drag, compile
   */
  setMode(mode) {
    if (this.intervals[mode] !== undefined) {
      this.mode = mode;
    }
  }

  /**
   * Request a preview update with throttling
   * @param {Function} updateFn - The update function to call
   * @param {boolean} immediate - If true, bypass throttling
   */
  requestUpdate(updateFn, immediate = false) {
    if (immediate) {
      this.cancelPending();
      updateFn();
      this.lastUpdate = performance.now();
      return;
    }

    const now = performance.now();
    const elapsed = now - this.lastUpdate;
    const interval = this.intervals[this.mode];

    if (elapsed >= interval) {
      // Enough time has passed, execute immediately
      this.cancelPending();
      updateFn();
      this.lastUpdate = now;
    } else {
      // Schedule for later
      this.pendingUpdate = updateFn;

      if (!this.updateTimeout) {
        const delay = interval - elapsed;
        this.updateTimeout = setTimeout(() => {
          if (this.pendingUpdate) {
            this.pendingUpdate();
            this.lastUpdate = performance.now();
            this.pendingUpdate = null;
          }
          this.updateTimeout = null;
        }, delay);
      }
    }
  }

  /**
   * Cancel any pending updates
   */
  cancelPending() {
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
      this.updateTimeout = null;
    }
    this.pendingUpdate = null;
  }

  /**
   * Begin dragging interaction (reduces update frequency)
   */
  beginDrag() {
    this.isDragging = true;
    this.setMode('drag');
  }

  /**
   * End dragging interaction (returns to idle)
   */
  endDrag() {
    this.isDragging = false;
    this.updateMode();
  }

  /**
   * Begin editing interaction (moderate update frequency)
   */
  beginEdit() {
    this.isEditing = true;
    this.setMode('edit');
  }

  /**
   * End editing interaction
   */
  endEdit() {
    this.isEditing = false;
    this.updateMode();
  }

  /**
   * Begin compilation (slowest update frequency)
   */
  beginCompile() {
    this.isCompiling = true;
    this.setMode('compile');
  }

  /**
   * End compilation
   */
  endCompile() {
    this.isCompiling = false;
    this.updateMode();
  }

  /**
   * Update mode based on current interaction state
   */
  updateMode() {
    if (this.isCompiling) {
      this.setMode('compile');
    } else if (this.isDragging) {
      this.setMode('drag');
    } else if (this.isEditing) {
      this.setMode('edit');
    } else {
      this.setMode('idle');
    }
  }

  /**
   * Dispose of the throttler
   */
  dispose() {
    this.cancelPending();
  }
}
