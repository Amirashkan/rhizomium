/**
 * TimelineManager.js
 *
 * Core manager for timeline and keyframe functionality.
 * Handles timeline state, keyframe evaluation, and integration with the editor.
 */

import { Timeline } from '../data/Timeline.js';
import { InterpolationSystem } from '../utils/InterpolationSystem.js';

/**
 * TimelineManager - manages timeline state and keyframe evaluation
 */
export class TimelineManager {
  constructor(editor) {
    this.editor = editor;
    this.timeline = new Timeline();
    this.enabled = false;              // Whether timeline is active
    this.evaluatedValues = new Map();   // Cache of evaluated values: "nodeId.paramName" -> value
    this.onTimeChange = null;           // Callback when current time changes
    this.onKeyframeChange = null;       // Callback when keyframes are added/removed/modified
    this.onPlayStateChange = null;      // Callback when play state changes
    this.lastPanelUpdateTime = 0;       // Throttle parameter panel updates
    this.panelUpdateInterval = 100;     // Update panel max once per 100ms
  }

  /**
   * Enable timeline (activates keyframe evaluation)
   */
  enable() {
    this.enabled = true;
    this.evaluateAllTracks();
  }

  /**
   * Disable timeline (deactivates keyframe evaluation)
   */
  disable() {
    this.enabled = false;
    this.evaluatedValues.clear();
  }

  /**
   * Toggle timeline enabled state
   * @returns {boolean} New enabled state
   */
  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) {
      this.evaluateAllTracks();
    } else {
      this.evaluatedValues.clear();
    }
    return this.enabled;
  }

  /**
   * Check if timeline is enabled
   * @returns {boolean} Enabled state
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Get the timeline object
   * @returns {Timeline} Timeline instance
   */
  getTimeline() {
    return this.timeline;
  }

  /**
   * Set current time and update evaluated values
   * @param {number} time - New time in seconds
   */
  setCurrentTime(time) {
    this.timeline.setCurrentTime(time);
    if (this.enabled) {
      this.evaluateAllTracks();
    }
    if (this.onTimeChange) {
      this.onTimeChange(this.timeline.currentTime);
    }
  }

  /**
   * Get current time
   * @returns {number} Current time in seconds
   */
  getCurrentTime() {
    return this.timeline.currentTime;
  }

  /**
   * Start playback
   */
  play() {
    this.timeline.playing = true;
    if (this.onPlayStateChange) {
      this.onPlayStateChange(true);
    }
  }

  /**
   * Pause playback
   */
  pause() {
    this.timeline.playing = false;
    if (this.onPlayStateChange) {
      this.onPlayStateChange(false);
    }
  }

  /**
   * Stop playback and reset to start
   */
  stop() {
    this.timeline.playing = false;
    this.setCurrentTime(0);
    if (this.onPlayStateChange) {
      this.onPlayStateChange(false);
    }
  }

  /**
   * Toggle play/pause
   * @returns {boolean} New playing state
   */
  togglePlay() {
    if (this.timeline.playing) {
      this.pause();
    } else {
      this.play();
    }
    return this.timeline.playing;
  }

  /**
   * Check if timeline is playing
   * @returns {boolean} Playing state
   */
  isPlaying() {
    return this.timeline.playing;
  }

  /**
   * Update timeline (called each frame)
   * @param {number} deltaTime - Time delta in seconds
   */
  update(deltaTime) {
    if (!this.enabled || !this.timeline.playing) {
      return;
    }

    this.timeline.advanceTime(deltaTime);
    this.evaluateAllTracks();

    if (this.onTimeChange) {
      this.onTimeChange(this.timeline.currentTime);
    }
  }

  /**
   * Record an undo action for timeline operations
   * @param {Object} action - Action to record
   */
  recordUndoAction(action) {
    if (this.editor && this.editor.undoManager) {
      this.editor.undoManager.recordAction(action);
    }
  }

  /**
   * Add a keyframe for a parameter at the current time
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {*} value - Keyframe value
   * @param {string} interpolation - Interpolation type (default: "linear")
   * @returns {Object} The created keyframe
   */
  addKeyframe(nodeId, paramName, value, interpolation = 'linear') {
    // Get parameter type from node definition
    const node = this.editor.graph.nodes.find(n => n.id === nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    const nodeDef = window.NodeDefs[node.kind];
    if (!nodeDef || !nodeDef.params) {
      throw new Error(`Node definition for ${node.kind} not found`);
    }

    const paramDef = nodeDef.params.find(p => p.name === paramName);
    if (!paramDef) {
      throw new Error(`Parameter ${paramName} not found in ${node.kind}`);
    }

    // Create track if it doesn't exist
    let track = this.timeline.findTrack(nodeId, paramName);
    if (!track) {
      track = this.timeline.addTrack(nodeId, paramName, paramDef.type);
    }

    // Add keyframe at current time
    const keyframe = this.timeline.addKeyframe(
      nodeId,
      paramName,
      this.timeline.currentTime,
      value,
      interpolation
    );

    // Record undo action
    this.recordUndoAction({
      type: 'ADD_KEYFRAME',
      nodeId,
      paramName,
      time: keyframe.time,
      value: keyframe.value,
      interpolation: keyframe.interpolation,
      undo: () => this.removeKeyframe(nodeId, paramName, keyframe.time),
      redo: () => this.addKeyframeAt(nodeId, paramName, keyframe.time, keyframe.value, keyframe.interpolation)
    });

    // Re-evaluate tracks
    if (this.enabled) {
      this.evaluateAllTracks();
    }

    // Notify listeners
    if (this.onKeyframeChange) {
      this.onKeyframeChange('add', { nodeId, paramName, keyframe });
    }

    return keyframe;
  }

  /**
   * Add keyframe at specific time
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {number} time - Time in seconds
   * @param {*} value - Keyframe value
   * @param {string} interpolation - Interpolation type (default: "linear")
   * @returns {Object} The created keyframe
   */
  addKeyframeAt(nodeId, paramName, time, value, interpolation = 'linear') {
    // Get parameter type from node definition
    const node = this.editor.graph.nodes.find(n => n.id === nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    const nodeDef = window.NodeDefs[node.kind];
    if (!nodeDef || !nodeDef.params) {
      throw new Error(`Node definition for ${node.kind} not found`);
    }

    const paramDef = nodeDef.params.find(p => p.name === paramName);
    if (!paramDef) {
      throw new Error(`Parameter ${paramName} not found in ${node.kind}`);
    }

    // Create track if it doesn't exist
    let track = this.timeline.findTrack(nodeId, paramName);
    if (!track) {
      track = this.timeline.addTrack(nodeId, paramName, paramDef.type);
    }

    // Add keyframe at specified time
    const keyframe = this.timeline.addKeyframe(
      nodeId,
      paramName,
      time,
      value,
      interpolation
    );

    // Re-evaluate tracks
    if (this.enabled) {
      this.evaluateAllTracks();
    }

    // Notify listeners
    if (this.onKeyframeChange) {
      this.onKeyframeChange('add', { nodeId, paramName, keyframe });
    }

    return keyframe;
  }

  /**
   * Remove a keyframe
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {number} time - Time of keyframe to remove
   * @param {boolean} recordUndo - Whether to record undo action (default: true)
   * @returns {boolean} True if keyframe was removed
   */
  removeKeyframe(nodeId, paramName, time, recordUndo = true) {
    // Get keyframe before removing for undo
    const keyframe = this.timeline.getKeyframeAt(nodeId, paramName, time);

    const success = this.timeline.removeKeyframe(nodeId, paramName, time);

    if (success && recordUndo && keyframe) {
      // Record undo action
      this.recordUndoAction({
        type: 'REMOVE_KEYFRAME',
        nodeId,
        paramName,
        time,
        value: keyframe.value,
        interpolation: keyframe.interpolation,
        undo: () => this.addKeyframeAt(nodeId, paramName, time, keyframe.value, keyframe.interpolation),
        redo: () => this.removeKeyframe(nodeId, paramName, time, false)
      });
    }

    if (success) {
      // Re-evaluate tracks
      if (this.enabled) {
        this.evaluateAllTracks();
      }

      // Notify listeners
      if (this.onKeyframeChange) {
        this.onKeyframeChange('remove', { nodeId, paramName, time });
      }
    }

    return success;
  }

  /**
   * Update a keyframe's value
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {number} time - Time of keyframe
   * @param {*} newValue - New value
   */
  updateKeyframeValue(nodeId, paramName, time, newValue) {
    this.timeline.updateKeyframeValue(nodeId, paramName, time, newValue);

    // Re-evaluate tracks
    if (this.enabled) {
      this.evaluateAllTracks();
    }

    // Notify listeners
    if (this.onKeyframeChange) {
      this.onKeyframeChange('update', { nodeId, paramName, time, value: newValue });
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
    const success = this.timeline.moveKeyframe(nodeId, paramName, oldTime, newTime);

    if (success) {
      // Re-evaluate tracks
      if (this.enabled) {
        this.evaluateAllTracks();
      }

      // Notify listeners
      if (this.onKeyframeChange) {
        this.onKeyframeChange('move', { nodeId, paramName, oldTime, newTime });
      }
    }

    return success;
  }

  /**
   * Remove all keyframes for a parameter
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @returns {boolean} True if track was removed
   */
  removeAllKeyframes(nodeId, paramName) {
    const success = this.timeline.removeTrack(nodeId, paramName);

    if (success) {
      // Clear evaluated value
      const key = `${nodeId}.${paramName}`;
      this.evaluatedValues.delete(key);

      // Notify listeners
      if (this.onKeyframeChange) {
        this.onKeyframeChange('removeAll', { nodeId, paramName });
      }
    }

    return success;
  }

  /**
   * Check if a parameter has keyframes
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @returns {boolean} True if parameter has keyframes
   */
  hasKeyframes(nodeId, paramName) {
    return this.timeline.hasKeyframes(nodeId, paramName);
  }

  /**
   * Get keyframe count for a parameter
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @returns {number} Number of keyframes
   */
  getKeyframeCount(nodeId, paramName) {
    return this.timeline.getKeyframeCount(nodeId, paramName);
  }

  /**
   * Get evaluated value for a parameter at current time
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @returns {*} Evaluated value or null if no keyframes
   */
  getEvaluatedValue(nodeId, paramName) {
    if (!this.enabled) return null;

    const key = `${nodeId}.${paramName}`;
    return this.evaluatedValues.get(key) || null;
  }

  /**
   * Evaluate all tracks at current time
   */
  evaluateAllTracks() {
    this.evaluatedValues.clear();

    for (const track of this.timeline.tracks) {
      if (!track.enabled || track.keyframes.length === 0) {
        continue;
      }

      const value = InterpolationSystem.evaluateTrack(
        track.keyframes,
        this.timeline.currentTime
      );

      if (value !== null) {
        const key = `${track.nodeId}.${track.paramName}`;
        this.evaluatedValues.set(key, value);
      }
    }

    // Apply values to node parameters
    this.applyValuesToNodes();
  }

  /**
   * Apply evaluated timeline values to node parameters
   */
  applyValuesToNodes() {
    if (!this.enabled) return;

    let anyChanged = false;
    let changedNodeId = null;

    for (const [key, value] of this.evaluatedValues) {
      const [nodeId, paramName] = key.split('.');
      const node = this.editor.graph.nodes.find(n => n.id === nodeId);

      if (node && node.params) {
        // Check if value actually changed to avoid unnecessary updates
        const currentValue = node.params[paramName];
        const hasChanged = currentValue !== value;

        if (hasChanged) {
          node.params[paramName] = value;
          anyChanged = true;
          changedNodeId = nodeId;
        }
      }
    }

    // Trigger shader rebuild if any values changed
    if (anyChanged) {
      if (this.editor.onChange) {
        this.editor.onChange('timeline-update');
      }

      // Update parameter panel if the changed node is currently selected (throttled)
      const now = Date.now();
      if (changedNodeId && this.editor.paramPanel && this.editor.paramPanel.selectedNode) {
        if (this.editor.paramPanel.selectedNode.id === changedNodeId) {
          if (now - this.lastPanelUpdateTime > this.panelUpdateInterval) {
            this.editor.paramPanel.renderParameters(this.editor.paramPanel.selectedNode);
            this.lastPanelUpdateTime = now;
          }
        }
      }
    }
  }

  /**
   * Get all tracks for a specific node
   * @param {string} nodeId - Node ID
   * @returns {Array<Track>} Array of tracks
   */
  getTracksForNode(nodeId) {
    return this.timeline.getTracksForNode(nodeId);
  }

  /**
   * Clear all timeline data
   */
  clear() {
    this.timeline.clear();
    this.evaluatedValues.clear();
    this.enabled = false;

    if (this.onKeyframeChange) {
      this.onKeyframeChange('clear', {});
    }
  }

  /**
   * Serialize timeline to JSON
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      enabled: this.enabled,
      timeline: this.timeline.toJSON()
    };
  }

  /**
   * Load timeline from JSON
   * @param {Object} json - JSON data
   */
  fromJSON(json) {
    if (!json) return;

    this.enabled = json.enabled || false;
    if (json.timeline) {
      this.timeline.fromJSON(json.timeline);
    }

    if (this.enabled) {
      this.evaluateAllTracks();
    }
  }

  /**
   * Set timeline duration
   * @param {number} duration - Duration in seconds
   */
  setDuration(duration) {
    this.timeline.duration = Math.max(0.1, duration);
  }

  /**
   * Get timeline duration
   * @returns {number} Duration in seconds
   */
  getDuration() {
    return this.timeline.duration;
  }

  /**
   * Set timeline FPS
   * @param {number} fps - Frames per second
   */
  setFPS(fps) {
    this.timeline.fps = Math.max(1, Math.min(240, fps));
  }

  /**
   * Get timeline FPS
   * @returns {number} Frames per second
   */
  getFPS() {
    return this.timeline.fps;
  }

  /**
   * Set loop mode
   * @param {boolean} loop - Whether to loop
   */
  setLoop(loop) {
    this.timeline.loop = loop;
  }

  /**
   * Get loop mode
   * @returns {boolean} Loop state
   */
  getLoop() {
    return this.timeline.loop;
  }

  /**
   * Set snap to frames mode
   * @param {boolean} snap - Whether to snap keyframes to frames
   */
  setSnapToFrames(snap) {
    this.timeline.snapToFrames = snap;
  }

  /**
   * Get snap to frames mode
   * @returns {boolean} Snap state
   */
  getSnapToFrames() {
    return this.timeline.snapToFrames;
  }
}
