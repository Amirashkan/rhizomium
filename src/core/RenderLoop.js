// src/core/RenderLoop.js
// Centralized render loop controller supporting display V-Sync and fixed timestep modes.

import { UnifiedRAFManager } from './UnifiedRAFManager.js';

const DEFAULT_FIXED_FPS = 60;
const MIN_FIXED_FPS = 1;
const MAX_FIXED_FPS = 240;

export class RenderLoop {
  constructor({
    onFrame,
    mode = "vsync",
    fixedFps = DEFAULT_FIXED_FPS,
    timeScale = 1,
    paused = false,
    maxFrameDelta = 0.25,
    maxSubSteps = 5,
  } = {}) {
    if (typeof onFrame !== "function") {
      throw new Error("RenderLoop requires an onFrame callback");
    }

    this.onFrame = onFrame;
    this.mode = mode === "fixed" ? "fixed" : "vsync";
    this.fixedFps = this._normalizeFps(fixedFps);
    this.timeScale = Math.max(0, Number.isFinite(timeScale) ? timeScale : 1);
    this.paused = !!paused;

    this.maxFrameDelta = Math.max(0.001, maxFrameDelta);
    this.maxSubSteps = Math.max(1, Math.floor(maxSubSteps));

    this._running = false;
    this._frameHandle = null;
    this._lastTimestamp = null;
    this._accumulator = 0;
    this._simTime = 0;
    this._frameIndex = 0;
    this._lastFrameErrorMessage = null;
    this._lastFrameErrorAt = 0;
    // Window whose requestAnimationFrame drives the loop; null = this window.
    // The preview pop-out swaps in its own window so rendering keeps going
    // while the editor tab is hidden (a hidden document's rAF stops).
    this._frameSource = null;
    
    // Unified RAF Manager for coordinating all RAF-based handlers
    // RenderLoop becomes the single RAF coordinator
    this.rafManager = new UnifiedRAFManager();
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._frameIndex = 0;
    this._accumulator = 0;
    this._lastTimestamp = null;
    this._scheduleNextFrame();
  }

  stop() {
    this._running = false;
    this._cancelPendingFrame();
    this._lastTimestamp = null;
    this._accumulator = 0;
  }

  /**
   * Drive the loop from another same-agent window's requestAnimationFrame
   * (null to go back to this window). Takes effect on the next frame.
   */
  setFrameSource(win) {
    const next = win || null;
    if (this._frameSource === next) return;
    this._cancelPendingFrame();
    this._frameSource = next;
    // Each window's rAF timestamps count from its own time origin.
    this._lastTimestamp = null;
    this._scheduleNextFrame();
  }

  _getFrameSource() {
    const src = this._frameSource;
    return src && !src.closed ? src : globalThis;
  }

  _cancelPendingFrame() {
    if (this._frameHandle === null) return;
    const { win, id } = this._frameHandle;
    try { win.cancelAnimationFrame(id); } catch { /* window already gone */ }
    this._frameHandle = null;
  }

  setMode(mode) {
    const normalized = mode === "fixed" ? "fixed" : "vsync";
    if (this.mode === normalized) return;
    this.mode = normalized;
    this._restartIfRunning();
  }

  setFixedFps(fps) {
    const normalized = this._normalizeFps(fps);
    if (this.fixedFps === normalized) return;
    this.fixedFps = normalized;
    if (this.mode === "fixed") {
      this._restartIfRunning();
    }
  }

  setTimeScale(scale) {
    const nextScale = Math.max(0, Number.isFinite(scale) ? scale : this.timeScale);
    this.timeScale = nextScale;
  }

  setPaused(paused) {
    const next = !!paused;
    if (this.paused === next) return;
    this.paused = next;
    // Reset timestamp so we do not accumulate a huge delta when resuming.
    if (!this.paused) {
      this._lastTimestamp = null;
    }
  }

  togglePaused() {
    this.setPaused(!this.paused);
  }

  renderNow({ advance = false, deltaOverride = 0, timeOverride } = {}) {
    const rawDelta = Math.max(0, Number.isFinite(deltaOverride) ? deltaOverride : 0);
    const deltaTime =
      advance && !this.paused
        ? rawDelta || this._getFixedStep()
        : 0;

    if (deltaTime > 0) {
      this._simTime += deltaTime * this.timeScale;
    }

    const info = this._buildFrameInfo({
      deltaTime: deltaTime * this.timeScale,
      rawDeltaTime: deltaTime,
      manual: true,
      timeOverride,
    });

    this.onFrame(info);
  }

  getState() {
    return {
      mode: this.mode,
      fixedFps: this.fixedFps,
      timeScale: this.timeScale,
      paused: this.paused,
      running: this._running,
      frameIndex: this._frameIndex,
      simTime: this._simTime,
    };
  }

  _restartIfRunning() {
    if (!this._running) return;
    this.stop();
    this.start();
  }

  _scheduleNextFrame() {
    if (!this._running) return;
    const win = this._getFrameSource();
    const id = win.requestAnimationFrame((ts) => this._handleFrame(ts, win));
    this._frameHandle = { win, id };
  }

  _handleFrame(timestampMs, win = globalThis) {
    if (!this._running) return;
    // A frame booked on a source that has since been swapped out.
    if (this._frameHandle && this._frameHandle.win !== win) return;
    this._frameHandle = null;

    // Book the next frame whatever this one does. The loop is a chain of
    // requestAnimationFrame calls, so a single throw from a frame handler used
    // to end it for good: the output froze, videos stopped, and the node canvas
    // stopped redrawing, so dragging and selecting nodes looked dead.
    try {
      this._runFrame(timestampMs);
    } catch (err) {
      this._reportFrameError(err);
    } finally {
      this._scheduleNextFrame();
    }
  }

  _runFrame(timestampMs) {
    if (this._lastTimestamp === null) {
      this._lastTimestamp = timestampMs;
    }

    const elapsedMs = timestampMs - this._lastTimestamp;
    this._lastTimestamp = timestampMs;
    const rawDelta = Math.min(elapsedMs / 1000, this.maxFrameDelta);

    if (this.mode === "vsync") {
      this._step(rawDelta);
    } else {
      this._accumulator += rawDelta;
      const stepSize = this._getFixedStep();
      let steps = 0;

      while (this._accumulator >= stepSize && steps < this.maxSubSteps) {
        this._accumulator -= stepSize;
        this._step(stepSize);
        steps++;
      }

      if (steps === this.maxSubSteps) {
        // Drop any extreme remainder to avoid spiraling.
        this._accumulator = 0;
      }

      // When paused ensure the renderer still sees frames at the fixed cadence.
      if (steps === 0 && this.paused) {
        this._step(0);
      }
    }
  }

  _step(rawDeltaTime) {
    const appliedDelta = this.paused ? 0 : rawDeltaTime * this.timeScale;
    if (appliedDelta > 0) {
      this._simTime += appliedDelta;
    }

    const frameInfo = this._buildFrameInfo({
      deltaTime: appliedDelta,
      rawDeltaTime,
    });

    // Process all registered RAF handlers before the main onFrame callback
    // This makes RenderLoop the single RAF coordinator. A failure in one must
    // not cost the frame its main callback, which draws the output and canvas.
    try {
      this.rafManager.processFrame(frameInfo);
    } catch (err) {
      this._reportFrameError(err);
    }

    this.onFrame(frameInfo);
  }

  // Log a frame error without flooding the console: a fault that repeats every
  // frame is reported once, then again only if the message changes or a few
  // seconds have passed.
  _reportFrameError(err) {
    const message = err?.message || String(err);
    const now = performance.now();
    if (message === this._lastFrameErrorMessage && now - this._lastFrameErrorAt < 5000) {
      return;
    }
    this._lastFrameErrorMessage = message;
    this._lastFrameErrorAt = now;
    console.error("[RenderLoop] Frame handler threw; the loop keeps running:", err);
  }

  _buildFrameInfo({
    deltaTime,
    rawDeltaTime,
    manual = false,
    timeOverride,
  }) {
    return {
      deltaTime,
      rawDeltaTime,
      simTime: typeof timeOverride === "number" ? timeOverride : this._simTime,
      mode: this.mode,
      paused: this.paused,
      timeScale: this.timeScale,
      manual,
      frameIndex: this._frameIndex++,
      realTime: performance.now() * 0.001,
    };
  }

  _getFixedStep() {
    return 1 / this.fixedFps;
  }

  _normalizeFps(fps) {
    if (!Number.isFinite(fps)) {
      return DEFAULT_FIXED_FPS;
    }
    const clamped = Math.min(Math.max(fps, MIN_FIXED_FPS), MAX_FIXED_FPS);
    return clamped;
  }
}

