/**
 * TimelineManager.js
 *
 * Core manager for timeline and keyframe functionality.
 * Handles timeline state, keyframe evaluation, and integration with the editor.
 */

import { Timeline } from '../data/Timeline.js';
import { InterpolationSystem } from '../utils/InterpolationSystem.js';
import { getInteractionStateManager } from '../utils/InteractionStateManager.js';
import { writeParameterUniform } from '../parameters/ExternalParameterControl.js';

// Record mode. While playing, a moving value is captured on a 0.1 s grid: a slider held for two
// seconds is twenty keyframes, not a hundred and twenty. Paused, the keyframe lands on the playhead.
const RECORD_STEP = 0.1;
// How long after the artist's last edit the timeline keeps its hands off that parameter, so a value
// being held still is not snapped back to the recorded curve between two mouse moves.
const RECORD_HOLD_MS = 300;

/** A literal number from a parameter value (drags write strings), or null for anything else. */
function recordableNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim().startsWith('=')) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function numericParamDef(node, paramName) {
  const def = keyframeParamDef(node, paramName, node.params?.[paramName], false);
  return def && (def.type === 'float' || def.type === 'int') ? def : null;
}

/**
 * The definition a keyframe is typed by. Usually the node's own, but the parameter panel also
 * shows a few controls of its own that no node definition lists - the Circle's Softness is
 * `epsilon`, which the shape compilers read ahead of the node's `smoothness`. A number there is
 * keyframed as a float rather than refused.
 */
function keyframeParamDef(node, paramName, value, strict = true) {
  const nodeDef = globalThis.NodeDefs?.[node.kind];
  const def = nodeDef?.params?.find((p) => p.name === paramName);
  if (def) return def;
  if (recordableNumber(value ?? node.params?.[paramName]) !== null) {
    return { name: paramName, type: 'float' };
  }
  if (!strict) return null;
  if (!nodeDef || !nodeDef.params) {
    throw new Error(`Node definition for ${node.kind} not found`);
  }
  throw new Error(`Parameter ${paramName} not found in ${node.kind}`);
}

/**
 * TimelineManager - manages timeline state and keyframe evaluation
 */
export class TimelineManager {
  constructor(editor) {
    this.editor = editor;
    this.timeline = new Timeline();
    this.enabled = false;              // Whether timeline is active
    this.evaluatedValues = new Map();   // Cache of evaluated values: "nodeId.paramName" -> value
    this.originalValues = new Map();    // Store original parameter values before timeline affects them
    this.onTimeChange = null;           // Callback when current time changes
    this.onKeyframeChange = null;       // Callback when keyframes are added/removed/modified
    this.onPlayStateChange = null;      // Callback when play state changes
    this.lastPanelUpdateTime = 0;       // Throttle parameter panel updates
    this.panelUpdateInterval = 100;     // Update panel max once per 100ms

    // Record mode: while armed, an edit to a number becomes a keyframe at the playhead.
    this.recording = false;
    this.onRecordStateChange = null;    // Callback when record is armed or disarmed
    this._recordSeen = new Map();       // "nodeId.param" -> the number last applied or observed
    this._recordTouched = new Map();    // "nodeId.param" -> performance.now() of the artist's last edit
    this._recordBefore = null;          // Tracks as they stood when the pass began, for one undo step

    // Committed edits (a typed value, the end of a drag) arrive here whether or not the
    // timeline is playing; edits mid-drag are caught by the frame loop instead (update()).
    editor?.eventSystem?.on?.('PARAMETER_CHANGED', (data) => {
      if (data?.source !== 'user' || !data.node) return;
      this.recordParameterChange(data.node.id, data.parameterName, data.newValue);
    });

    // Interaction state manager integration
    this.interactionStateManager = getInteractionStateManager();
    this._pausedForInteraction = false;
    this._wasPlayingBeforeInteraction = false;
    this._setupInteractionListeners();
  }
  
  /**
   * Setup listeners for interaction events
   */
  _setupInteractionListeners() {
    // Listen to interaction start events
    this.interactionStateManager.addEventListener('interactionstart', (event) => {
      this._onInteractionStart(event);
    });
    
    // Listen to interaction end events
    this.interactionStateManager.addEventListener('interactionend', (event) => {
      this._onInteractionEnd(event);
    });
  }
  
  /**
   * Handle interaction start - pause timeline updates
   */
  _onInteractionStart(_event) {
    if (this.enabled && this.timeline.playing) {
      this._wasPlayingBeforeInteraction = true;
      this._pausedForInteraction = true;
      // Don't actually pause playback, just skip updates
    }
  }
  
  /**
   * Handle interaction end - resume timeline updates
   */
  _onInteractionEnd(_event) {
    if (this._pausedForInteraction) {
      this._pausedForInteraction = false;
      this._wasPlayingBeforeInteraction = false;
    }
  }

  /**
   * Enable timeline (activates keyframe evaluation)
   */
  enable() {
    // Store original parameter values before timeline takes control
    this.storeOriginalValues();
    this.enabled = true;
    this.evaluateAllTracks();
  }

  /**
   * Disable timeline (deactivates keyframe evaluation)
   */
  disable() {
    this.setRecording(false);
    this.enabled = false;
    this.evaluatedValues.clear();
    // Restore original parameter values
    this.restoreOriginalValues();
  }

  /**
   * Store original parameter values for all tracks
   */
  storeOriginalValues() {
    this.originalValues.clear();
    for (const track of this.timeline.tracks) {
      const node = this.editor.graph.nodes.find(n => n.id === track.nodeId);
      if (node && node.params) {
        const key = `${track.nodeId}.${track.paramName}`;
        // Store a deep copy of the value
        const value = node.params[track.paramName];
        this.originalValues.set(key, this.cloneValue(value));
      }
    }
  }

  /**
   * Restore original parameter values for all tracks
   */
  restoreOriginalValues() {
    for (const [key, value] of this.originalValues) {
      const [nodeId, paramName] = key.split('.');
      const node = this.editor.graph.nodes.find(n => n.id === nodeId);
      if (node && node.params) {
        node.params[paramName] = this.cloneValue(value);
      }
    }

    // Trigger shader rebuild if there were any original values
    if (this.originalValues.size > 0 && this.editor.onChange) {
      this.editor.onChange('timeline-disabled');
    }

    // Update parameter panel if a node is selected
    if (this.editor.paramPanel && this.editor.paramPanel.selectedNode) {
      this.editor.paramPanel.renderParameters(this.editor.paramPanel.selectedNode);
    }

    this.originalValues.clear();
  }

  /**
   * Clone a value (handles numbers, objects, arrays)
   */
  cloneValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        return [...value];
      }
      return { ...value };
    }
    return value;
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
      this.setRecording(false);
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
    // Without a loop, playback stops at the end; pressing Play there again
    // starts over instead of stopping on the very next frame.
    if (!this.timeline.loop && this.timeline.currentTime >= this.timeline.duration) {
      this.setCurrentTime(0);
    }
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
    
    // Skip updates during interactions to reduce overhead
    if (this._pausedForInteraction || this.interactionStateManager.isAnyInteractionActive()) {
      return;
    }

    // Before the playhead moves and the tracks are applied: whatever the artist changed since
    // last frame is still sitting in node.params, at the time it was changed.
    if (this.recording) {
      this._captureRecordedChanges();
    }

    this.timeline.advanceTime(deltaTime);
    this.evaluateAllTracks();

    if (this.onTimeChange) {
      this.onTimeChange(this.timeline.currentTime);
    }

    // advanceTime() stops a non-looping timeline at its end; tell the panel so
    // the button goes back to Play.
    if (!this.timeline.playing && this.onPlayStateChange) {
      this.onPlayStateChange(false);
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
   * Convert a value to the proper type based on parameter definition
   * @param {*} value - Value to convert
   * @param {string} type - Target type
   * @returns {*} Converted value
   */
  convertValueToType(value, type) {
    // If already proper type, return as-is
    if (typeof value === 'number' && (type === 'float' || type === 'int')) {
      return type === 'int' ? Math.round(value) : value;
    }

    // Convert string to number for numeric types
    if (typeof value === 'string' && (type === 'float' || type === 'int')) {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) {
        return type === 'int' ? Math.round(parsed) : parsed;
      }
    }

    // Convert string to boolean
    if (typeof value === 'string' && type === 'bool') {
      return value === 'true' || value === '1';
    }

    // For vec2, vec3, vec4 - handle various input formats
    if (type === 'vec2' || type === 'vec3' || type === 'vec4') {
      // If already an object with x, y properties, return as-is
      if (value && typeof value === 'object' && 'x' in value) {
        return value;
      }

      // If it's a string, try to parse it
      if (typeof value === 'string') {
        const parts = value.split(',').map(s => parseFloat(s.trim()));
        if (type === 'vec2' && parts.length >= 2) {
          return { x: parts[0], y: parts[1] };
        } else if (type === 'vec3' && parts.length >= 3) {
          return { x: parts[0], y: parts[1], z: parts[2] };
        } else if (type === 'vec4' && parts.length >= 4) {
          return { x: parts[0], y: parts[1], z: parts[2], w: parts[3] };
        }
      }
    }

    // Default: return value as-is
    return value;
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

    const paramDef = keyframeParamDef(node, paramName, value);

    // Convert value to proper type
    const typedValue = this.convertValueToType(value, paramDef.type);

    // Create track if it doesn't exist
    let track = this.timeline.findTrack(nodeId, paramName);
    if (!track) {
      track = this.timeline.addTrack(nodeId, paramName, paramDef.type);
    }

    // Add keyframe at current time with properly typed value
    const keyframe = this.timeline.addKeyframe(
      nodeId,
      paramName,
      this.timeline.currentTime,
      typedValue,
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

    const paramDef = keyframeParamDef(node, paramName, value);

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
    if (!this.enabled) {
      return;
    }


    let anyChanged = false;
    let changedNodeId = null;
    // A parameter the compiler reserved no uniform for — a discrete value that
    // decides what the shader IS, a vector, something read only on the CPU.
    // Only those need the graph rebuilding; see below.
    let needsRebuild = false;

    const now = this.recording ? performance.now() : 0;

    for (const [key, value] of this.evaluatedValues) {
      // A parameter the artist is recording into right now belongs to them, not the curve.
      if (this.recording && now - (this._recordTouched.get(key) ?? -Infinity) < RECORD_HOLD_MS) {
        continue;
      }

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
          // The one performance rule (CLAUDE.md): a value change is a buffer
          // write, not a recompile. This used to call editor.onChange() for
          // any change at all, which is buildWGSL() and a new pipeline — once
          // per keyframed parameter per frame. At the desk, scrubbing, that
          // reads as a sticky playhead. Under the performer, which drives this
          // playhead from the frame loop for the length of a set, it was a
          // rebuild every frame and a show at single-figure fps.
          if (!writeParameterUniform(nodeId, paramName, value)) needsRebuild = true;
        }
      }
    }


    if (anyChanged) {
      // Only what the fast path could not carry. The canvas still redraws
      // either way, so the node's own readout follows the playhead as it did.
      if (needsRebuild && this.editor.onChange) {
        this.editor.onChange('timeline-update');
      } else if (this.editor.markDirty) {
        this.editor.markDirty('timeline-update');
      }

      // Update parameter panel if the changed node is currently selected (throttled). Not while
      // a field is being dragged: re-rendering would replace the very input under the mouse.
      const panelNow = Date.now();
      if (changedNodeId && this.editor.paramPanel && this.editor.paramPanel.selectedNode
        && !this.editor._parameterDragging) {
        if (this.editor.paramPanel.selectedNode.id === changedNodeId) {
          if (panelNow - this.lastPanelUpdateTime > this.panelUpdateInterval) {
            this.editor.paramPanel.renderParameters(this.editor.paramPanel.selectedNode);
            this.lastPanelUpdateTime = panelNow;
          }
        }
      }
    }

    if (this.recording) {
      this._rememberRecordCandidates();
    }
  }

  // --- record mode ------------------------------------------------------------

  /**
   * Arm or disarm record mode. Arming switches the timeline on, since recording into a
   * timeline that does not play back would capture keyframes nobody can see.
   * @param {boolean} on
   */
  setRecording(on) {
    on = Boolean(on);
    if (on === this.recording) return;

    if (on) {
      if (!this.enabled) this.enable();
      this.recording = true;
      this._recordBefore = this._snapshotTracks();
      this._recordTouched.clear();
      this._recordSeen.clear();
      this._rememberRecordCandidates();
    } else {
      this.recording = false;
      this._finishRecordingPass();
    }

    if (this.onRecordStateChange) {
      this.onRecordStateChange(this.recording);
    }
  }

  /** @returns {boolean} New record state */
  toggleRecording() {
    this.setRecording(!this.recording);
    return this.recording;
  }

  /** @returns {boolean} Whether record mode is armed */
  isRecording() {
    return this.recording;
  }

  /**
   * A committed edit while recording: write it as a keyframe at the playhead.
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {*} value - The new parameter value
   */
  recordParameterChange(nodeId, paramName, value) {
    if (!this.recording || !this.enabled) return;
    const number = recordableNumber(value);
    if (number === null) return;

    const key = `${nodeId}.${paramName}`;
    if (this._writeRecordedKeyframe(nodeId, paramName, number, this._recordTime())) {
      this._recordTouched.set(key, performance.now());
      this._recordSeen.set(key, number);
    }
  }

  /** Where a recorded keyframe lands: on the 0.1 s grid while playing, on the playhead when not. */
  _recordTime() {
    const time = this.timeline.currentTime;
    return this.timeline.playing ? Math.round(time / RECORD_STEP) * RECORD_STEP : time;
  }

  _writeRecordedKeyframe(nodeId, paramName, value, time) {
    const node = this.editor.graph.nodes.find(n => n.id === nodeId);
    const def = node && numericParamDef(node, paramName);
    if (!def) return false;

    if (!this.timeline.findTrack(nodeId, paramName)) {
      this.timeline.addTrack(nodeId, paramName, def.type);
    }
    if (this.timeline.snapToFrames) {
      time = this.timeline.snapToFrame(time);
    }

    // Re-recording over a keyframe replaces its value but keeps the easing chosen for it.
    const existing = this.timeline.getKeyframeAt(nodeId, paramName, time);
    const typed = def.type === 'int' ? Math.round(value) : value;
    const keyframe = this.timeline.addKeyframe(nodeId, paramName, time, typed, existing?.interpolation || 'linear');

    if (this.onKeyframeChange) {
      this.onKeyframeChange('record', { nodeId, paramName, keyframe });
    }
    return true;
  }

  /**
   * The parameters a recording pass watches: every number on the node open in the parameter
   * panel, plus everything already animated, wherever it lives.
   */
  _recordCandidates() {
    const nodes = this.editor.graph?.nodes || [];
    const selected = this.editor.paramPanel?.selectedNode || null;
    const out = [];

    if (selected) {
      for (const p of globalThis.NodeDefs?.[selected.kind]?.params || []) {
        if (p.type === 'float' || p.type === 'int') {
          out.push({ node: selected, name: p.name, key: `${selected.id}.${p.name}` });
        }
      }
    }
    for (const track of this.timeline.tracks) {
      if (selected && track.nodeId === selected.id) continue;
      const node = nodes.find(n => n.id === track.nodeId);
      if (node) out.push({ node, name: track.paramName, key: `${track.nodeId}.${track.paramName}` });
    }
    return out;
  }

  /** Keyframe whatever changed since the timeline last applied or saw it. */
  _captureRecordedChanges() {
    const now = performance.now();
    for (const { node, name, key } of this._recordCandidates()) {
      const value = recordableNumber(node.params?.[name]);
      if (value === null) continue;

      const seen = this._recordSeen.get(key);
      if (seen !== undefined && Math.abs(value - seen) > 1e-9) {
        if (this._writeRecordedKeyframe(node.id, name, value, this._recordTime())) {
          this._recordTouched.set(key, now);
        }
      }
      this._recordSeen.set(key, value);
    }
  }

  _rememberRecordCandidates() {
    for (const { node, name, key } of this._recordCandidates()) {
      const value = recordableNumber(node.params?.[name]);
      if (value !== null) this._recordSeen.set(key, value);
    }
  }

  _snapshotTracks() {
    return JSON.stringify(this.timeline.toJSON().tracks);
  }

  _restoreTracks(snapshot) {
    this.timeline.fromJSON({ ...this.timeline.toJSON(), tracks: JSON.parse(snapshot) });
    if (this.enabled) this.evaluateAllTracks();
    if (this.onKeyframeChange) {
      this.onKeyframeChange('restore', {});
    }
  }

  /** A whole recording pass undoes in one step, however many keyframes it wrote. */
  _finishRecordingPass() {
    const before = this._recordBefore;
    this._recordBefore = null;
    this._recordTouched.clear();
    if (before === null) return;

    const after = this._snapshotTracks();
    if (after === before) return;

    this.recordUndoAction({
      type: 'RECORD_KEYFRAMES',
      undo: () => this._restoreTracks(before),
      redo: () => this._restoreTracks(after),
    });
  }

  // --- interpolation ------------------------------------------------------------

  /**
   * Set how a keyframe eases into the next one.
   * @param {string} nodeId - Node ID
   * @param {string} paramName - Parameter name
   * @param {number} time - Time of the keyframe
   * @param {string} interpolation - "linear", "ease-in", "ease-out", "ease-in-out" or "step"
   * @param {boolean} recordUndo - Whether to record an undo action (default: true)
   * @returns {boolean} True if the keyframe changed
   */
  setKeyframeInterpolation(nodeId, paramName, time, interpolation, recordUndo = true) {
    const keyframe = this.timeline.getKeyframeAt(nodeId, paramName, time);
    if (!keyframe) return false;

    const previous = keyframe.interpolation || 'linear';
    if (previous === interpolation) return false;
    keyframe.interpolation = interpolation;

    if (recordUndo) {
      this.recordUndoAction({
        type: 'SET_KEYFRAME_INTERPOLATION',
        nodeId,
        paramName,
        time,
        undo: () => this.setKeyframeInterpolation(nodeId, paramName, time, previous, false),
        redo: () => this.setKeyframeInterpolation(nodeId, paramName, time, interpolation, false),
      });
    }

    if (this.enabled) {
      this.evaluateAllTracks();
    }
    if (this.onKeyframeChange) {
      this.onKeyframeChange('interpolation', { nodeId, paramName, time, interpolation });
    }
    return true;
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
    const previousDuration = this.timeline.duration;
    this.timeline.duration = Math.max(0.1, duration);
    // A loop region that spanned the whole timeline keeps spanning it. Leaving
    // loopEnd at the old duration made a lengthened timeline loop back to the
    // start during playback before it ever reached the keyframes added past it,
    // while scrubbing still showed them.
    if (this.timeline.loopEnd >= previousDuration || this.timeline.loopEnd > this.timeline.duration) {
      this.timeline.loopEnd = this.timeline.duration;
    }
    if (this.timeline.loopStart > this.timeline.loopEnd) {
      this.timeline.loopStart = 0;
    }
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
   * Set loop region start time
   * @param {number} time - Start time in seconds
   */
  setLoopStart(time) {
    this.timeline.loopStart = Math.max(0, Math.min(time, this.timeline.loopEnd));
  }

  /**
   * Get loop region start time
   * @returns {number} Start time in seconds
   */
  getLoopStart() {
    return this.timeline.loopStart;
  }

  /**
   * Set loop region end time
   * @param {number} time - End time in seconds
   */
  setLoopEnd(time) {
    this.timeline.loopEnd = Math.max(this.timeline.loopStart, Math.min(time, this.timeline.duration));
  }

  /**
   * Get loop region end time
   * @returns {number} End time in seconds
   */
  getLoopEnd() {
    return this.timeline.loopEnd;
  }

  /**
   * Set loop region (start and end)
   * @param {number} start - Start time in seconds
   * @param {number} end - End time in seconds
   */
  setLoopRegion(start, end) {
    const clampedStart = Math.max(0, Math.min(start, this.timeline.duration));
    const clampedEnd = Math.max(clampedStart, Math.min(end, this.timeline.duration));
    this.timeline.loopStart = clampedStart;
    this.timeline.loopEnd = clampedEnd;
  }

  /**
   * Reset loop region to full duration
   */
  resetLoopRegion() {
    this.timeline.loopStart = 0;
    this.timeline.loopEnd = this.timeline.duration;
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
