const STORAGE_KEY = "previewPerfOverlay";
const HASH_FLAG = "previewPerf";
const QUERY_FLAG = "previewPerf";
const OVERLAY_UPDATE_MS = 250;

export class PreviewPerfMonitor {
  constructor(options = {}) {
    this.enabled = this._shouldEnable(options.forceEnable);
    this.metrics = {
      frameMs: 0,
      gpuMs: 0,
      canvasMs: 0,
      previewDomMs: 0,
      rafDelta: 0,
      layoutReads: 0,
      layoutWrites: 0,
      lastLayoutRead: "-",
      lastLayoutWrite: "-",
      interactionState: "idle",
    };
    this._lastFrameStart = 0;
    this._overlay = null;
    this._pendingOverlayUpdate = false;
    this._lastOverlayUpdate = 0;

    if (this.enabled) {
      this._ensureOverlay();
      this._installDebugHooks();
    }
  }

  beginFrame(frameState = {}) {
    if (!this.enabled) return;
    this._lastFrameStart = performance.now();
    this.metrics.rafDelta = Number(frameState.deltaTime) || 0;
    this.metrics.interactionState = frameState.manual ? "manual" : this.metrics.interactionState;
  }

  endFrame(extra = {}) {
    if (!this.enabled || !this._lastFrameStart) return;
    this.metrics.frameMs = performance.now() - this._lastFrameStart;
    Object.assign(this.metrics, extra);
    this._scheduleOverlayUpdate(true);
  }

  timeSection(name) {
    if (!this.enabled) return null;
    return { name, start: performance.now() };
  }

  endSection(token, extra = {}) {
    if (!this.enabled || !token) return 0;
    const duration = performance.now() - token.start;
    if (token.name === "gpu") {
      this.metrics.gpuMs = duration;
    } else if (token.name === "canvas") {
      this.metrics.canvasMs = duration;
    } else if (token.name === "previewDom") {
      this.metrics.previewDomMs = duration;
    } else {
      this.metrics[token.name] = duration;
    }
    Object.assign(this.metrics, extra);
    this._scheduleOverlayUpdate(false);
    return duration;
  }

  recordValue(name, value) {
    if (!this.enabled) return;
    this.metrics[name] = value;
    this._scheduleOverlayUpdate(false);
  }

  recordInteractionState(state) {
    if (!this.enabled) return;
    if (typeof state === "string") {
      this.metrics.interactionState = state;
    } else if (state?.isCanvasInteracting) {
      this.metrics.interactionState = "canvas-interaction";
    } else if (state?.isDragging) {
      this.metrics.interactionState = "dragging";
    } else {
      this.metrics.interactionState = "idle";
    }
    this._scheduleOverlayUpdate(false);
  }

  recordLayoutRead(reason = "") {
    if (!this.enabled) return;
    this.metrics.layoutReads += 1;
    if (reason) {
      this.metrics.lastLayoutRead = reason;
    }
    this._scheduleOverlayUpdate(false);
  }

  recordLayoutWrite(reason = "") {
    if (!this.enabled) return;
    this.metrics.layoutWrites += 1;
    if (reason) {
      this.metrics.lastLayoutWrite = reason;
    }
    this._scheduleOverlayUpdate(false);
  }

  resetLayoutCounters() {
    if (!this.enabled) return;
    this.metrics.layoutReads = 0;
    this.metrics.layoutWrites = 0;
    this.metrics.lastLayoutRead = "-";
    this.metrics.lastLayoutWrite = "-";
    this._scheduleOverlayUpdate(false);
  }

  attachAsyncMetric(name, promise) {
    if (!this.enabled || !promise || typeof promise.then !== "function") {
      return;
    }
    const start = performance.now();
    promise
      .then(() => {
        this.metrics[name] = performance.now() - start;
        this._scheduleOverlayUpdate(false);
      })
      .catch(() => {});
  }

  toggle(enabled) {
    const shouldEnable = enabled !== undefined ? enabled : !this.enabled;
    if (shouldEnable === this.enabled) return;
    this.enabled = shouldEnable;
    if (this.enabled) {
      window.localStorage?.setItem(STORAGE_KEY, "true");
      this._ensureOverlay(true);
    } else {
      window.localStorage?.removeItem(STORAGE_KEY);
      this._destroyOverlay();
    }
  }

  _shouldEnable(forceEnable) {
    if (forceEnable !== undefined) return !!forceEnable;
    const lsFlag = window.localStorage?.getItem(STORAGE_KEY) === "true";
    const hashFlag = window.location?.hash?.includes(HASH_FLAG);
    const queryFlag = window.location?.search?.includes(QUERY_FLAG);
    return !!(lsFlag || hashFlag || queryFlag);
  }

  _ensureOverlay(force = false) {
    if (!this.enabled) return;
    if (this._overlay && !force) return;

    const create = () => {
      if (this._overlay && !force) return;
      if (this._overlay && force) {
        this._overlay.remove();
        this._overlay = null;
      }

      const overlay = document.createElement("div");
      overlay.id = "preview-perf-overlay";
      overlay.style.cssText = `
        position: fixed;
        top: 12px;
        right: 12px;
        padding: 8px 10px;
        background: rgba(5, 5, 10, 0.85);
        color: #d0f6ff;
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 11px;
        line-height: 1.35;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        border-radius: 8px;
        z-index: 1000;
        pointer-events: none;
        white-space: pre;
      `;
      overlay.textContent = "Preview Perf Overlay (no data)";
      document.body.appendChild(overlay);
      this._overlay = overlay;
      this._scheduleOverlayUpdate(true);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", create, { once: true });
    } else {
      create();
    }
  }

  _destroyOverlay() {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
  }

  _scheduleOverlayUpdate(forceImmediate) {
    if (!this.enabled || !this._overlay) return;
    const now = performance.now();
    if (forceImmediate || now - this._lastOverlayUpdate > OVERLAY_UPDATE_MS) {
      this._lastOverlayUpdate = now;
      this._pendingOverlayUpdate = false;
      this._updateOverlay();
      return;
    }

    if (this._pendingOverlayUpdate) return;
    this._pendingOverlayUpdate = true;
    requestAnimationFrame(() => {
      this._pendingOverlayUpdate = false;
      this._updateOverlay();
    });
  }

  _updateOverlay() {
    if (!this._overlay) return;
    const {
      frameMs,
      gpuMs,
      canvasMs,
      previewDomMs,
      rafDelta,
      layoutReads,
      layoutWrites,
      lastLayoutRead,
      lastLayoutWrite,
      interactionState,
    } = this.metrics;

    const lines = [
      `Frame: ${frameMs.toFixed(1)} ms (RAF Δ ${rafDelta.toFixed(1)} ms)`,
      `GPU   : ${gpuMs.toFixed(1)} ms`,
      `Canvas: ${canvasMs.toFixed(1)} ms`,
      `Preview DOM: ${previewDomMs.toFixed(1)} ms`,
      `Layout R/W: ${layoutReads}/${layoutWrites}`,
      `Last Read: ${lastLayoutRead}`,
      `Last Write: ${lastLayoutWrite}`,
      `State: ${interactionState}`,
    ];

    this._overlay.textContent = lines.join("\n");
  }

  getMetric(name) {
    return this.metrics?.[name];
  }

  _installDebugHooks() {
    if (window.previewPerfToggleInstalled) return;
    window.previewPerfToggleInstalled = true;
    window.togglePreviewPerfOverlay = () => this.toggle();
    console.info(
      "[PreviewPerfMonitor] Overlay ready. Call window.togglePreviewPerfOverlay() or set localStorage.previewPerfOverlay = 'true' to persist."
    );
  }
}

