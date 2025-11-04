/**
 * Timeline.js
 *
 * Data structure for managing keyframe animation timeline.
 * Stores keyframes for node parameters and provides serialization.
 */

/**
 * Keyframe data structure
 * @typedef {Object} Keyframe
 * @property {number} time - Time in seconds
 * @property {*} value - Value at this time (number, vec2, vec3, vec4, color, etc.)
 * @property {string} interpolation - Interpolation type: "linear", "ease-in", "ease-out", "ease-in-out", "step", "bezier"
 * @property {Array<number>} [bezierControlPoints] - For bezier: [x1, y1, x2, y2]
 */

/**
 * Track data structure - stores keyframes for a single parameter
 * @typedef {Object} Track
 * @property {string} nodeId - ID of the node this track belongs to
 * @property {string} paramName - Name of the parameter
 * @property {string} paramType - Type of parameter (float, vec2, vec3, vec4, color, etc.)
 * @property {Array<Keyframe>} keyframes - Array of keyframes, sorted by time
 * @property {boolean} enabled - Whether this track is active
 */

/**
 * Timeline class - manages the entire animation timeline
 */
export class Timeline {
  constructor() {
    this.duration = 10.0;           // Total duration in seconds
    this.currentTime = 0.0;         // Current playback position
    this.fps = 60;                  // Frame rate
    this.loop = true;               // Whether to loop playback
    this.loopStart = 0.0;           // Loop region start time
    this.loopEnd = 10.0;            // Loop region end time
    this.playing = false;           // Playback state
    this.tracks = [];               // Array of Track objects
    this.snapToFrames = true;       // Snap keyframes to frame boundaries
    this.selectedKeyframes = [];    // Array of {trackIndex, keyframeIndex}
  }

  /**
   * Add a new track for a parameter
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {string} paramType - Parameter type
   * @returns {Track} The created track
   */
  addTrack(nodeId, paramName, paramType) {
    // Check if track already exists
    const existing = this.findTrack(nodeId, paramName);
    if (existing) {
      return existing;
    }

    const track = {
      nodeId,
      paramName,
      paramType,
      keyframes: [],
      enabled: true
    };

    this.tracks.push(track);
    return track;
  }

  /**
   * Find a track by node ID and parameter name
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @returns {Track|null} The track or null if not found
   */
  findTrack(nodeId, paramName) {
    return this.tracks.find(t => t.nodeId === nodeId && t.paramName === paramName) || null;
  }

  /**
   * Remove a track
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @returns {boolean} True if track was removed
   */
  removeTrack(nodeId, paramName) {
    const index = this.tracks.findIndex(t => t.nodeId === nodeId && t.paramName === paramName);
    if (index >= 0) {
      this.tracks.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all tracks for a specific node
   * @param {string} nodeId - Node ID
   * @returns {Array<Track>} Array of tracks
   */
  getTracksForNode(nodeId) {
    return this.tracks.filter(t => t.nodeId === nodeId);
  }

  /**
   * Add a keyframe to a track
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {number} time - Time in seconds
   * @param {*} value - Keyframe value
   * @param {string} interpolation - Interpolation type (default: "linear")
   * @returns {Keyframe} The created keyframe
   */
  addKeyframe(nodeId, paramName, time, value, interpolation = "linear") {
    const track = this.findTrack(nodeId, paramName);
    if (!track) {
      throw new Error(`Track not found for ${nodeId}.${paramName}`);
    }

    // Snap to frame if enabled
    if (this.snapToFrames) {
      time = this.snapToFrame(time);
    }

    // Check if keyframe already exists at this time
    const existingIndex = track.keyframes.findIndex(kf => Math.abs(kf.time - time) < 0.001);
    if (existingIndex >= 0) {
      // Update existing keyframe
      track.keyframes[existingIndex].value = value;
      track.keyframes[existingIndex].interpolation = interpolation;
      return track.keyframes[existingIndex];
    }

    // Create new keyframe
    const keyframe = {
      time,
      value,
      interpolation
    };

    // Insert keyframe in sorted order
    track.keyframes.push(keyframe);
    track.keyframes.sort((a, b) => a.time - b.time);

    return keyframe;
  }

  /**
   * Remove a keyframe from a track
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {number} time - Time of keyframe to remove
   * @returns {boolean} True if keyframe was removed
   */
  removeKeyframe(nodeId, paramName, time) {
    const track = this.findTrack(nodeId, paramName);
    if (!track) return false;

    const index = track.keyframes.findIndex(kf => Math.abs(kf.time - time) < 0.001);
    if (index >= 0) {
      track.keyframes.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get keyframe at specific time (exact match)
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {number} time - Time to check
   * @returns {Keyframe|null} The keyframe or null
   */
  getKeyframeAt(nodeId, paramName, time) {
    const track = this.findTrack(nodeId, paramName);
    if (!track) return null;

    return track.keyframes.find(kf => Math.abs(kf.time - time) < 0.001) || null;
  }

  /**
   * Update a keyframe's value
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {number} time - Time of keyframe
   * @param {*} newValue - New value
   */
  updateKeyframeValue(nodeId, paramName, time, newValue) {
    const keyframe = this.getKeyframeAt(nodeId, paramName, time);
    if (keyframe) {
      keyframe.value = newValue;
    }
  }

  /**
   * Move a keyframe to a new time
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {number} oldTime - Current time
   * @param {number} newTime - New time
   * @returns {boolean} Success
   */
  moveKeyframe(nodeId, paramName, oldTime, newTime) {
    const track = this.findTrack(nodeId, paramName);
    if (!track) return false;

    const keyframe = this.getKeyframeAt(nodeId, paramName, oldTime);
    if (!keyframe) return false;

    // Snap to frame if enabled
    if (this.snapToFrames) {
      newTime = this.snapToFrame(newTime);
    }

    // Remove from old position
    this.removeKeyframe(nodeId, paramName, oldTime);

    // Add at new position
    this.addKeyframe(nodeId, paramName, newTime, keyframe.value, keyframe.interpolation);

    return true;
  }

  /**
   * Snap time to nearest frame boundary
   * @param {number} time - Time in seconds
   * @returns {number} Snapped time
   */
  snapToFrame(time) {
    const frameTime = 1.0 / this.fps;
    return Math.round(time / frameTime) * frameTime;
  }

  /**
   * Get frame number from time
   * @param {number} time - Time in seconds
   * @returns {number} Frame number
   */
  timeToFrame(time) {
    return Math.round(time * this.fps);
  }

  /**
   * Get time from frame number
   * @param {number} frame - Frame number
   * @returns {number} Time in seconds
   */
  frameToTime(frame) {
    return frame / this.fps;
  }

  /**
   * Set current time and clamp to duration
   * @param {number} time - New time
   */
  setCurrentTime(time) {
    this.currentTime = Math.max(0, Math.min(time, this.duration));
  }

  /**
   * Advance time for playback
   * @param {number} deltaTime - Time delta in seconds
   */
  advanceTime(deltaTime) {
    if (!this.playing) return;

    this.currentTime += deltaTime;

    // Use loop region if loop is enabled, otherwise use full duration
    if (this.loop) {
      const loopEnd = Math.min(this.loopEnd, this.duration);
      const loopStart = Math.max(0, Math.min(this.loopStart, loopEnd));

      if (this.currentTime > loopEnd) {
        // Wrap to loop start
        const overshoot = this.currentTime - loopEnd;
        const loopDuration = loopEnd - loopStart;
        this.currentTime = loopStart + (loopDuration > 0 ? overshoot % loopDuration : 0);
      } else if (this.currentTime < loopStart) {
        // If somehow we're before loop start, jump to loop start
        this.currentTime = loopStart;
      }
    } else {
      // No loop - stop at duration
      if (this.currentTime > this.duration) {
        this.currentTime = this.duration;
        this.playing = false;
      }
    }
  }

  /**
   * Check if a parameter has any keyframes
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @returns {boolean} True if parameter has keyframes
   */
  hasKeyframes(nodeId, paramName) {
    const track = this.findTrack(nodeId, paramName);
    return track && track.keyframes.length > 0;
  }

  /**
   * Get count of keyframes for a parameter
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @returns {number} Number of keyframes
   */
  getKeyframeCount(nodeId, paramName) {
    const track = this.findTrack(nodeId, paramName);
    return track ? track.keyframes.length : 0;
  }

  /**
   * Clear all tracks and keyframes
   */
  clear() {
    this.tracks = [];
    this.currentTime = 0.0;
    this.playing = false;
    this.selectedKeyframes = [];
  }

  /**
   * Serialize timeline to JSON
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      duration: this.duration,
      currentTime: this.currentTime,
      fps: this.fps,
      loop: this.loop,
      loopStart: this.loopStart,
      loopEnd: this.loopEnd,
      snapToFrames: this.snapToFrames,
      tracks: this.tracks.map(track => ({
        nodeId: track.nodeId,
        paramName: track.paramName,
        paramType: track.paramType,
        enabled: track.enabled,
        keyframes: track.keyframes.map(kf => ({
          time: kf.time,
          value: kf.value,
          interpolation: kf.interpolation,
          bezierControlPoints: kf.bezierControlPoints
        }))
      }))
    };
  }

  /**
   * Load timeline from JSON
   * @param {Object} json - JSON data
   */
  fromJSON(json) {
    this.duration = json.duration || 10.0;
    this.currentTime = json.currentTime || 0.0;
    this.fps = json.fps || 60;
    this.loop = json.loop !== undefined ? json.loop : true;
    this.loopStart = json.loopStart !== undefined ? json.loopStart : 0.0;
    this.loopEnd = json.loopEnd !== undefined ? json.loopEnd : this.duration;
    this.snapToFrames = json.snapToFrames !== undefined ? json.snapToFrames : true;
    this.playing = false;
    this.selectedKeyframes = [];

    this.tracks = (json.tracks || []).map(trackData => ({
      nodeId: trackData.nodeId,
      paramName: trackData.paramName,
      paramType: trackData.paramType,
      enabled: trackData.enabled !== undefined ? trackData.enabled : true,
      keyframes: (trackData.keyframes || []).map(kfData => ({
        time: kfData.time,
        value: kfData.value,
        interpolation: kfData.interpolation || "linear",
        bezierControlPoints: kfData.bezierControlPoints
      }))
    }));
  }

  /**
   * Clone the timeline
   * @returns {Timeline} Cloned timeline
   */
  clone() {
    const cloned = new Timeline();
    cloned.fromJSON(this.toJSON());
    return cloned;
  }
}
