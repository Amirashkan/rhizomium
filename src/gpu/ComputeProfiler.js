/**
 * ComputeProfiler - Lightweight profiler for WebGPU compute dispatches
 *
 * Features:
 * - Timestamp queries for measuring dispatch times
 * - FPS tracking
 * - Active workgroup counting
 * - Per-dispatch timing information
 */

import { getInteractionStateManager } from '../utils/InteractionStateManager.js';
import { getPresentedFps, getPresentedFrameMs } from '../core/presentedFrameRate.js';

export class ComputeProfiler {
  constructor(device) {
    this.device = device;
    this.enabled = false;
    this.supportsTimestamps = false;
    this.interactionStateManager = getInteractionStateManager();
    this._isInteractionMode = false;

    // Timestamp query support
    this.querySet = null;
    this.queryBuffer = null;
    this.resolveBuffer = null;

    // Performance metrics
    this.metrics = {
      // Presented, not dispatched — see presentedFrameRate.js.
      fps: 0,
      frameTime: 0,
      // The render loop's dispatch cadence. Related but not the same thing:
      // on a fixed timestep this holds at the target rate while fps follows
      // the display.
      dispatchInterval: 0,
      totalDispatchTime: 0,
      dispatches: [],
      activeWorkgroups: 0,
      totalWorkgroups: 0
    };

    // Frame timing
    this.frameCount = 0;
    this.lastFrameTime = performance.now();
    this.frameTimes = [];
    this.maxFrameSamples = 60;
    // PERFORMANCE: Cache sum of frame times to avoid O(n) reduce() every frame
    this._frameTimeSum = 0;

    // Dispatch tracking
    this.currentFrameDispatches = [];
    this.dispatchIndex = 0;

    // Query management
    this.maxQueries = 128; // Max query slots
    this.pendingReads = [];
    
    // Setup interaction listeners
    this._setupInteractionListeners();

    this._initialize();
  }
  
  /**
   * Setup listeners for interaction events
   */
  _setupInteractionListeners() {
    // Listen to interaction start events
    this.interactionStateManager.addEventListener('interactionstart', (_event) => {
      this._isInteractionMode = true;
    });
    
    // Listen to interaction end events
    this.interactionStateManager.addEventListener('interactionend', (_event) => {
      this._isInteractionMode = false;
    });
  }

  /**
   * Initialize timestamp query support if available
   */
  async _initialize() {
    try {
      // Check if timestamp queries are supported
      if (!this.device.features.has('timestamp-query')) {

        this.supportsTimestamps = false;
        return;
      }

      this.supportsTimestamps = true;

      // Create query set for timestamp queries
      this.querySet = this.device.createQuerySet({
        type: 'timestamp',
        count: this.maxQueries
      });

      // Create buffer to resolve query results
      const queryBufferSize = this.maxQueries * 8; // 8 bytes per timestamp
      this.resolveBuffer = this.device.createBuffer({
        size: queryBufferSize,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC
      });

      // Create buffer to read query results on CPU
      this.queryBuffer = this.device.createBuffer({
        size: queryBufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      });

    } catch {

      this.supportsTimestamps = false;
    }
  }

  /**
   * Enable or disable profiling
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      // Clear metrics when disabled
      this.currentFrameDispatches = [];
      this.dispatchIndex = 0;
    }
  }

  /**
   * Begin frame profiling
   * PERFORMANCE: Optimized to use cached sum instead of reduce() for O(1) FPS calculation
   */
  beginFrame() {
    if (!this.enabled) return;
    
    const now = performance.now();
    let deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;
    
    // Safeguard: Handle edge cases (clock adjustment, tab inactive)
    // Clamp deltaTime to reasonable range (0-1000ms) to prevent FPS calculation errors
    if (deltaTime < 0) {
      // Clock went backwards (system clock adjustment) - skip this frame
      return;
    }
    if (deltaTime > 1000) {
      // Tab was inactive for >1 second - cap at 1000ms to prevent skewing average
      deltaTime = 1000;
    }
    
    // Update dispatch timing with incremental sum update (O(1) instead of O(n))
    this.frameTimes.push(deltaTime);
    this._frameTimeSum += deltaTime;

    if (this.frameTimes.length > this.maxFrameSamples) {
      // Remove oldest interval from sum
      const removed = this.frameTimes.shift();
      this._frameTimeSum -= removed;
    }

    // How often this profiler is being handed a frame to time. That is the
    // render loop's dispatch cadence, which on the default fixed timestep is
    // 60/sec no matter what the display does — so it is reported under its own
    // name and never as FPS.
    const sampleCount = this.frameTimes.length;
    this.metrics.dispatchInterval = sampleCount > 0 ? this._frameTimeSum / sampleCount : 0;

    // FPS and frame time mean frames the window presented. See
    // presentedFrameRate.js for why they cannot come from the count above.
    this.metrics.fps = getPresentedFps();
    this.metrics.frameTime = getPresentedFrameMs();
    
    // Skip detailed profiling during interactions to reduce overhead
    if (this._isInteractionMode) {
      // Reset dispatch tracking (skip detailed tracking during interactions)
      this.currentFrameDispatches = [];
      this.dispatchIndex = 0;
      return;
    }

    this.frameCount++;

    // Reset dispatch tracking for new frame
    this.currentFrameDispatches = [];
    this.dispatchIndex = 0;
  }

  /**
   * Begin timing a compute dispatch
   * @param {GPUCommandEncoder} commandEncoder
   * @param {string} label - Identifier for this dispatch
   * @param {Object} workgroupInfo - { dispatchSize: {x,y,z}, workgroupSize: {x,y,z} }
   * @returns {number} dispatchId for ending the timing
   */
  beginDispatch(commandEncoder, label, workgroupInfo) {
    if (!this.enabled) return -1;

    const dispatchId = this.dispatchIndex++;
    const startTime = performance.now();

    const dispatch = {
      id: dispatchId,
      label,
      workgroupInfo,
      startTime,
      endTime: 0,
      duration: 0,
      queryIndex: -1
    };

    // Two query slots per dispatch (start, end), written by the pass itself:
    // see timestampWrites().
    if (this.supportsTimestamps && this.querySet && dispatchId * 2 + 1 < this.maxQueries) {
      dispatch.queryIndex = dispatchId * 2;
    }

    this.currentFrameDispatches.push(dispatch);
    return dispatchId;
  }

  /**
   * The `timestampWrites` for the compute pass that runs this dispatch, or
   * undefined when it isn't being GPU-timed.
   *
   * Timestamps are written by the pass, not the encoder: Chrome removed
   * GPUCommandEncoder.writeTimestamp(), and calling it throws.
   */
  timestampWrites(dispatchId) {
    if (!this.enabled || dispatchId < 0 || !this.querySet) return undefined;
    const dispatch = this.currentFrameDispatches.find(d => d.id === dispatchId);
    if (!dispatch || dispatch.queryIndex < 0) return undefined;
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex: dispatch.queryIndex,
      endOfPassWriteIndex: dispatch.queryIndex + 1,
    };
  }

  /**
   * End timing a compute dispatch
   * @param {GPUCommandEncoder} commandEncoder
   * @param {number} dispatchId
   */
  endDispatch(commandEncoder, dispatchId) {
    if (!this.enabled || dispatchId < 0) return;

    const dispatch = this.currentFrameDispatches.find(d => d.id === dispatchId);
    if (!dispatch) return;

    dispatch.endTime = performance.now();
    dispatch.duration = dispatch.endTime - dispatch.startTime;
  }

  /**
   * End frame and resolve timestamp queries
   * @param {GPUCommandEncoder} commandEncoder
   */
  async endFrame(commandEncoder) {
    if (!this.enabled) return;

    // A read still queued here means its frame's submit failed, so the copy
    // it would map never happened.
    if (this._toRead) {
      this._toRead = null;
      this._readPending = false;
    }

    // Calculate total dispatch time and workgroups from CPU timing (fallback)
    let totalDispatchTime = 0;
    let totalWorkgroups = 0;

    for (const dispatch of this.currentFrameDispatches) {
      totalDispatchTime += dispatch.duration;

      if (dispatch.workgroupInfo) {
        const { dispatchSize } = dispatch.workgroupInfo;
        totalWorkgroups += (dispatchSize.x || 1) * (dispatchSize.y || 1) * (dispatchSize.z || 1);
      }
    }

    this.metrics.activeWorkgroups = this.currentFrameDispatches.length;
    this.metrics.totalWorkgroups = totalWorkgroups;

    // With GPU timing, the times shown are the last frame whose timestamps
    // have been read back. Replacing them with this frame's CPU times would
    // show ~0 for every dispatch until the read lands, which is every frame.
    const timed = this.currentFrameDispatches.some(d => d.queryIndex >= 0);
    if (!timed) {
      this.metrics.totalDispatchTime = totalDispatchTime;
      this.metrics.dispatches = [...this.currentFrameDispatches];
    }

    // Resolve this frame's timestamps, unless the readback buffer is still
    // mapped (or waiting to be) for an earlier frame: copying into it then is
    // a validation error that fails the whole submit.
    if (timed && !this._readPending) {
      try {
        const queryCount = this.dispatchIndex * 2; // Two timestamps per dispatch

        // Resolve queries to buffer
        commandEncoder.resolveQuerySet(
          this.querySet,
          0,
          Math.min(queryCount, this.maxQueries),
          this.resolveBuffer,
          0
        );

        // Copy to readable buffer
        commandEncoder.copyBufferToBuffer(
          this.resolveBuffer,
          0,
          this.queryBuffer,
          0,
          Math.min(queryCount * 8, this.queryBuffer.size)
        );

        // Read once the frame is submitted: see afterSubmit().
        this._readPending = true;
        this._toRead = this.currentFrameDispatches.slice();
      } catch {

      }
    }
  }

  /**
   * Call right after submitting the encoder endFrame() was given. Mapping the
   * readback buffer has to wait until then: a buffer with a map pending can't
   * be used by the submit that fills it.
   */
  afterSubmit() {
    const dispatches = this._toRead;
    if (!dispatches) return;
    this._toRead = null;
    this._scheduleQueryRead(dispatches).finally(() => { this._readPending = false; });
  }

  /**
   * Schedule async read of timestamp query results
   */
  async _scheduleQueryRead(dispatches) {
    try {
      await this.queryBuffer.mapAsync(GPUMapMode.READ);

      const queryData = new BigInt64Array(this.queryBuffer.getMappedRange());

      // Update dispatch timings with GPU timestamps
      let totalGPUTime = 0;

      for (const dispatch of dispatches) {
        if (dispatch.queryIndex >= 0 && dispatch.queryIndex + 1 < queryData.length) {
          const startNs = queryData[dispatch.queryIndex];
          const endNs = queryData[dispatch.queryIndex + 1];
          const durationNs = endNs - startNs;

          // Convert nanoseconds to milliseconds
          dispatch.gpuDuration = Number(durationNs) / 1_000_000;
          totalGPUTime += dispatch.gpuDuration;
        }
      }

      this.queryBuffer.unmap();

      if (this.enabled) {
        this.metrics.totalDispatchTime = totalGPUTime;
        this.metrics.dispatches = dispatches;
      }
    } catch {

      // Buffer might still be mapped, try to unmap
      try {
        this.queryBuffer.unmap();
      } catch {}
    }
  }

  /**
   * Get current profiling metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      enabled: this.enabled,
      supportsTimestamps: this.supportsTimestamps,
      frameCount: this.frameCount
    };
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.frameCount = 0;
    this.lastFrameTime = performance.now();
    this.frameTimes = [];
    this._frameTimeSum = 0;
    this.currentFrameDispatches = [];
    this.metrics = {
      // Presented, not dispatched — see presentedFrameRate.js.
      fps: 0,
      frameTime: 0,
      // The render loop's dispatch cadence. Related but not the same thing:
      // on a fixed timestep this holds at the target rate while fps follows
      // the display.
      dispatchInterval: 0,
      totalDispatchTime: 0,
      dispatches: [],
      activeWorkgroups: 0,
      totalWorkgroups: 0
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.querySet) {
      this.querySet.destroy();
      this.querySet = null;
    }
    if (this.queryBuffer) {
      this.queryBuffer.destroy();
      this.queryBuffer = null;
    }
    if (this.resolveBuffer) {
      this.resolveBuffer.destroy();
      this.resolveBuffer = null;
    }
  }
}
