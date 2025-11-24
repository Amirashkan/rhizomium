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
      fps: 0,
      frameTime: 0,
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
    this.interactionStateManager.addEventListener('interactionstart', (event) => {
      this._isInteractionMode = true;
    });
    
    // Listen to interaction end events
    this.interactionStateManager.addEventListener('interactionend', (event) => {
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

    } catch (error) {

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
   */
  beginFrame() {
    if (!this.enabled) return;
    
    // Skip detailed profiling during interactions to reduce overhead
    if (this._isInteractionMode) {
      // Only track basic frame timing during interactions
      const now = performance.now();
      const deltaTime = now - this.lastFrameTime;
      this.lastFrameTime = now;
      
      // Update frame timing
      this.frameTimes.push(deltaTime);
      if (this.frameTimes.length > this.maxFrameSamples) {
        this.frameTimes.shift();
      }
      
      // Calculate FPS from average frame time
      const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.metrics.fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
      this.metrics.frameTime = avgFrameTime;
      
      // Reset dispatch tracking (skip detailed tracking during interactions)
      this.currentFrameDispatches = [];
      this.dispatchIndex = 0;
      return;
    }

    const now = performance.now();
    const deltaTime = now - this.lastFrameTime;

    // Update frame timing
    this.frameTimes.push(deltaTime);
    if (this.frameTimes.length > this.maxFrameSamples) {
      this.frameTimes.shift();
    }

    // Calculate FPS from average frame time
    const avgFrameTime = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.metrics.fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
    this.metrics.frameTime = avgFrameTime;

    this.lastFrameTime = now;
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

    // Use timestamp queries if supported
    if (this.supportsTimestamps && this.querySet && dispatchId * 2 + 1 < this.maxQueries) {
      dispatch.queryIndex = dispatchId * 2; // Two queries per dispatch (start, end)

      try {
        commandEncoder.writeTimestamp(this.querySet, dispatch.queryIndex);
      } catch (error) {

      }
    }

    this.currentFrameDispatches.push(dispatch);
    return dispatchId;
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

    // Write end timestamp
    if (this.supportsTimestamps && this.querySet && dispatch.queryIndex >= 0) {
      try {
        commandEncoder.writeTimestamp(this.querySet, dispatch.queryIndex + 1);
      } catch (error) {

      }
    }
  }

  /**
   * End frame and resolve timestamp queries
   * @param {GPUCommandEncoder} commandEncoder
   */
  async endFrame(commandEncoder) {
    if (!this.enabled) return;

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

    this.metrics.totalDispatchTime = totalDispatchTime;
    this.metrics.dispatches = [...this.currentFrameDispatches];
    this.metrics.activeWorkgroups = this.currentFrameDispatches.length;
    this.metrics.totalWorkgroups = totalWorkgroups;

    // Resolve GPU timestamp queries if available
    if (this.supportsTimestamps && this.querySet && this.currentFrameDispatches.length > 0) {
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

        // Schedule async read
        this._scheduleQueryRead(this.currentFrameDispatches.slice());
      } catch (error) {

      }
    }
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

      // Update metrics with GPU timing if available
      if (totalGPUTime > 0) {
        this.metrics.totalDispatchTime = totalGPUTime;
      }

      this.queryBuffer.unmap();
    } catch (error) {

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
    this.frameTimes = [];
    this.currentFrameDispatches = [];
    this.metrics = {
      fps: 0,
      frameTime: 0,
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
