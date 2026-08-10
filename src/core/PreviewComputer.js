// src/core/PreviewComputer.js
import { UnifiedExpressionSystem } from '../utils/UnifiedExpressionSystem.js';
import { getBrowserAudioCapture } from '../audio/BrowserAudioCapture.js';
import { getInteractionStateManager } from '../utils/InteractionStateManager.js';
import { NodeDefs } from '../data/NodeDefs.js';
import { getInputCount } from '../data/nodeInputs.js';
import { AUDIO_ANALYSIS_PINS, audioAnalysisPinValue } from './audioAnalysisPins.js';
import { isTriggerChangeMode, triggerChangePulse } from './triggerMode.js';
import { evaluateWave, isWaveUnipolar } from './waveform.js';

export class PreviewComputer {
  constructor() {
    this.previewSize = 32;
    this.animationTime = 0;
    this.lastFrameTime = 0;
    this.lastComputedValues = new Map(); // Store computed values for expression system
    this.lastComputedInputs = new Map(); // Track last known inputs per node
    this.lastParameterHashes = new Map(); // Track last known parameter hashes per node
    this._manualDirtyNodes = new Set(); // Dirty flags requested externally
    this.graphStructureHash = null; // Track graph structure changes
    this._cachedTopologicalSort = null; // Cached topological sort result
    this._cachedSortStructureHash = null; // Structure hash when sort was cached
    this._cachedSortById = null; // Map of node ID to index in cached sort
    this.expressionSystem = new UnifiedExpressionSystem(); // For CPU evaluation of expressions
    
    // Worker support
    this.queueManager = null;
    this.pendingPreviewResults = new Map();
    this.lastPreviewRequestTime = 0;
    this.previewRequestThrottle = 16; // ~60 FPS max
    this.useWorker = false;
    this.previewRequestTimeout = 5000; // 5 second timeout for preview requests
    this.cachedPreviews = null;
    this.lastPreviewComputeTime = 0;
    this.interactionCacheWindow = 250;
    this._interactionMode = false;
    
    // Interaction state manager integration
    this.interactionStateManager = getInteractionStateManager();
    this._setupInteractionListeners();
    
    // Initialize worker support (deferred, non-blocking)
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        this._initWorkerSupport();
      }, { timeout: 2000 });
    } else {
      setTimeout(() => {
        this._initWorkerSupport();
      }, 2000);
    }
  }
  
  /**
   * Setup listeners for interaction events
   */
  _setupInteractionListeners() {
    // Listen to interaction start events
    this.interactionStateManager.addEventListener('interactionstart', (_event) => {
      this._interactionMode = true;
      this.interactionCacheWindow = 400; // Longer cache window during interactions
    });
    
    // Listen to interaction end events
    this.interactionStateManager.addEventListener('interactionend', (_event) => {
      this._interactionMode = false;
      this.interactionCacheWindow = 250; // Shorter cache window when not interacting
    });
  }
  
  /**
   * Initialize worker support
   */
  _initWorkerSupport() {
    // Force disable worker usage
    this.useWorker = false;
    // Worker support is disabled - computation runs synchronously on main thread
  }
  
  /**
   * Handle preview computation result from worker
   */
  _handlePreviewResult(data) {
    if (data.id && this.pendingPreviewResults.has(data.id)) {
      const { callback } = this.pendingPreviewResults.get(data.id);
      this.pendingPreviewResults.delete(data.id);
      
      if (callback && data.result) {
        callback(data.result.previews);
      }
    }
  }
  
  /**
   * Request preview computation (synchronous)
   */
  async requestPreviewComputation(graph, timeContext, audioContext, callback) {
    // Skip computation during interactions if we have cached previews
    if (this._interactionMode) {
      if (this.cachedPreviews && performance.now() - this.lastPreviewComputeTime < this.interactionCacheWindow) {
        if (callback) {
          callback(this.cachedPreviews);
        }
        return;
      }
      // If no cache or cache expired, still skip computation during active interactions
      // to avoid blocking the UI
      if (callback) {
        callback(this.cachedPreviews || {});
      }
      return;
    }

    // Use provided time context if available, otherwise use current time
    // This ensures time-based expressions use the correct time value
    if (timeContext?.time !== undefined) {
      this.animationTime = timeContext.time;
    }

    // Run computation synchronously. Pass the caller's time through so it is honored when the
    // render loop's sim clock isn't available yet (computePreviews prefers the sim clock).
    const startTime = performance.now();
    const result = this.computePreviews(graph, { time: timeContext?.time });
    const duration = performance.now() - startTime;
    
    // Log duration if >16ms
    if (duration > 16) {
      console.log(`Preview computation took ${duration.toFixed(2)}ms (>16ms)`);
    }
    
    // Invoke callback immediately
    if (callback) {
      const previews = result?.previews || {};
      this.cachedPreviews = previews;
      this.lastPreviewComputeTime = performance.now();
      callback(previews);
    }
  }

  setInteractionMode(active) {
    this._interactionMode = !!active;
    if (!this._interactionMode) {
      this.interactionCacheWindow = 250;
    } else {
      this.interactionCacheWindow = 400;
    }
  }
  
  /**
   * Create immutable graph snapshot
   */
  _createGraphSnapshot(graph) {
    const snapshot = {
      nodes: graph.nodes.map(node => ({
        id: node.id,
        type: node.type,
        kind: node.kind,
        params: { ...node.params },
        inputs: node.inputs ? [...node.inputs] : [],
        position: { ...node.position }
      })),
      connections: graph.connections.map(conn => ({ ...conn }))
    };
    
    // Use structuredClone when available, otherwise return shallow copy
    if (typeof structuredClone !== 'undefined') {
      return structuredClone(snapshot);
    }
    
    // Fallback: return shallow-copied structure
    return snapshot;
  }

  markNodeDirty(nodeId, _reason = 'manual') {
    if (!nodeId) {
      return;
    }
    this._manualDirtyNodes.add(nodeId);
    
    // Invalidate NodeValueComputer cache for this node and its dependents
    this._invalidateNodeValueComputerCacheForNode(nodeId);
  }

  /**
   * Evaluate a parameter value, handling expressions
   * @param {*} value - The parameter value (could be number, string, or expression)
   * @param {Map} values - Map of computed node values
   * @param {*} defaultValue - Default value if evaluation fails
   * @returns {number} - Evaluated number value
   */
  // Populate `context` with every computed node value as node_<id>, exposing each vector component
  // under BOTH its letter (node_5_x) and its numeric channel index (node_5_0) — the editor stores a
  // vector-node pin reference in the numeric form. A Split node's value is a
  // { type:'split', values:[...] } object rather than a bare array, so unwrap it; otherwise a
  // reference like "=node_<split>_0" resolves to nothing and the consuming value freezes at 0.
  _addNodeRefsToContext(context, values) {
    const comps = ['x', 'y', 'z', 'w'];
    values.forEach((val, id) => {
      const channels = Array.isArray(val)
        ? val
        : (val && typeof val === 'object' && val.type === 'split' && Array.isArray(val.values))
          ? val.values
          : null;
      if (channels) {
        context[`node_${id}`] = channels;
        channels.forEach((v, i) => {
          if (comps[i]) context[`node_${id}_${comps[i]}`] = v;
          context[`node_${id}_${i}`] = v;
        });
      } else {
        context[`node_${id}`] = val;
      }
    });
  }

  _evaluateParam(value, values, defaultValue = 0) {
    // Already a number
    if (typeof value === 'number') {
      return value;
    }

    // Not a string, return default
    if (typeof value !== 'string') {
      return defaultValue;
    }

    const trimmed = value.trim();

    // Check if it looks like an expression
    const isExpression = trimmed.startsWith('=') ||
                        /[a-zA-Z_]/.test(trimmed) ||
                        trimmed.includes('(');

    if (isExpression) {
      try {
        // Get audio capture instance
        let audioCapture = null;
        try {
          audioCapture = getBrowserAudioCapture();
        } catch {
          // Audio system not available
        }

        // Build context with time, frame, and audio envelope values
        const context = {
          time: this.animationTime,
          frame: Math.floor(this.animationTime * 60),
          // Get audio envelope values from audio system if available
          audioEnvelope: audioCapture?.getValue?.() ?? 0,
          audioEnvelopeBass: audioCapture?.getAudioEnvelopeBass?.() ?? 0,
          audioEnvelopeMids: audioCapture?.getAudioEnvelopeMids?.() ?? 0,
          audioEnvelopeHighs: audioCapture?.getAudioEnvelopeHighs?.() ?? 0,
          audioEnvelopeFull: audioCapture?.getAudioEnvelopeFull?.() ?? 0,
          // Constants
          PI: Math.PI,
          E: Math.E,
        };

        // Add other node values to context (handles split objects + numeric channel suffixes).
        this._addNodeRefsToContext(context, values);

        // Remove = prefix if present
        const expressionWithoutPrefix = trimmed.startsWith('=') ? trimmed.slice(1) : trimmed;

        // Evaluate using expression system
        const result = this.expressionSystem.evaluateCPU(expressionWithoutPrefix, context);
        return typeof result === 'number' ? result : defaultValue;
      } catch {

        return defaultValue;
      }
    }

    // Try to parse as number
    const parsed = parseFloat(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  computePreviews(graph, options = {}) {
    try {
      const startTime = performance.now();
      const maxTime = options.maxTime || 50; // Default 50ms max
      const timeBudget = options.timeBudget || maxTime;

      // Drive time-based expressions from the render loop's sim time — the SAME clock the GPU
      // shader and node thumbnails use — so numeric pin previews stay in lock-step with the
      // visuals and freeze when playback is paused/scrubbed. Previously this unconditionally used
      // performance.now()/1000, ignoring both the time the render loop passes in and the sim clock.
      // That wall-clock ran on a different phase than the GPU (offset by app start-up time and
      // unaffected by pause/timeScale), so a time-driven value like a Compare fed by sin(time)
      // flipped at a moment unrelated to the animation on screen. Honor an explicit options.time
      // next, and only fall back to wall-clock before the render loop exists (e.g. in tests).
      const simTime = (typeof window !== 'undefined') ? window.renderLoop?._simTime : undefined;
      if (Number.isFinite(simTime)) {
        this.animationTime = simTime;
      } else if (typeof options.time === 'number' && Number.isFinite(options.time)) {
        this.animationTime = options.time;
      } else {
        this.animationTime = performance.now() / 1000;
      }

      // PERFORMANCE: Limit graph size to prevent excessive computation
      // If graph is too large, only process a subset to stay within time budget
      const maxNodes = options.maxNodes || 1000; // Limit to 1000 nodes max
      const nodesToProcess = graph.nodes.length > maxNodes 
        ? graph.nodes.slice(0, maxNodes) 
        : graph.nodes;

      const byId = new Map(nodesToProcess.map((n) => [n.id, n]));

      // node.inputs[] only records the SOURCE node id, not which of its output pins
      // a wire came from. For multi-output nodes (Split2/3/4) that loses the channel,
      // so a downstream scalar consumer (e.g. Remap fed by Split.x) would receive the
      // whole split object instead of the component. Rebuild the source-pin lookup from
      // the connection list (which does carry from.pin) so _resolveInputValue can index
      // the right channel. Keyed "<toNodeId>|<toPin>" -> fromPin.
      this._inputSourcePins = new Map();
      const _conns = graph?.connections || [];
      for (const c of _conns) {
        const toId = c?.to?.nodeId ?? c?.toNode;
        if (toId == null) continue;
        const toPin = c?.to?.pin ?? c?.toPin ?? 0;
        const fromPin = c?.from?.pin ?? c?.fromPin ?? 0;
        this._inputSourcePins.set(`${toId}|${toPin}`, fromPin);
      }

      // Evaluate dirty nodes first to determine what needs computation
      const { dirtyNodes, parameterHashes, structureChanged } = this._evaluateDirtyNodes(graph, nodesToProcess, byId);
      
      // EARLY RETURN: If no dirty nodes and graph structure unchanged, return cached results
      if (dirtyNodes.size === 0 && !structureChanged) {
        // Return cached previews
        const cachedPreviews = {};
        for (const node of nodesToProcess) {
          if (this.lastComputedValues.has(node.id)) {
            cachedPreviews[node.id] = this.lastComputedValues.get(node.id);
            node.__preview = cachedPreviews[node.id];
          }
        }
        return { previews: cachedPreviews };
      }

      // Filter topological sort to only include dirty nodes and their dependencies
      // This ensures we only process nodes that need recomputation
      const nodesToCompute = this._filterNodesToCompute(nodesToProcess, dirtyNodes, byId);
      const ordered = this._topologicalSort(nodesToCompute, byId, {
        dirtyNodes,
        structureChanged,
        allNodes: nodesToProcess
      });
      
      const values = new Map(this.lastComputedValues);
      const updatedInputSnapshots = new Map();

      let processedCount = 0;
      for (const node of ordered) {
        // Skip nodes that aren't dirty and have unchanged inputs
        const hasCachedValue = this.lastComputedValues.has(node.id);
        const isDirty = dirtyNodes.has(node.id);
        const needsRecompute = isDirty || !hasCachedValue;

        if (!needsRecompute) {
          // Use cached value for non-dirty nodes
          const cachedValue = this.lastComputedValues.get(node.id);
          values.set(node.id, cachedValue);
          node.__preview = cachedValue;
          continue;
        }

        // CRITICAL: Check time budget periodically to prevent lag spikes
        // If we've exceeded the time budget, stop processing to avoid blocking
        if (processedCount % 10 === 0) { // Check every 10 dirty nodes
          const elapsed = performance.now() - startTime;
          if (elapsed > timeBudget) {
            // Time budget exceeded - stop processing to avoid blocking
            // Remaining nodes will be processed on next update
            break;
          }
        }
        processedCount++;

        let result = null;

        try {
          if (needsRecompute) {
            switch (node.kind) {


            // Input Nodes
            case "UV":
              result = [0.5, 0.5];
              break;

            case "Time":
              result = this.animationTime;
              break;

            case "Trigger": {
              if (isTriggerChangeMode(node)) {
                // "On value change" compares against the PREVIOUS frame, which this preview pass —
                // throttled to ~10fps — can't track on its own. TriggerNodeProcessor advances the
                // pulse every frame on the CPU; mirror its value so the node readout matches what
                // the shader renders (same arrangement as Hold and Count below).
                result = triggerChangePulse(node);
                break;
              }
              const inputValue = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const threshold = this._evaluateParam(node.params?.threshold, values, 0.5);
              result = inputValue >= threshold ? 1.0 : 0.0;
              break;
            }

            case "Hold": {
              // The sample-and-hold latch lives on the CPU in HoldNodeProcessor (it runs every
              // frame and survives the pulse falling to 0, which this preview pass — throttled to
              // ~10fps — can't track on its own). Mirror its held value here so the node thumbnail
              // matches what the shader renders.
              result = typeof node.__holdValue === 'number' ? node.__holdValue : 0.0;
              break;
            }

            case "Count": {
              // The running counter lives on the CPU in CountNodeProcessor (advanced every frame so
              // brief pulses aren't missed). Mirror its current value here so the thumbnail matches
              // the shader.
              result = typeof node.__countValue === 'number' ? node.__countValue : 0.0;
              break;
            }

            case "AudioAnalysis": {
              // Many independent outputs (band meters, per-drum envelopes and triggers, spectral
              // descriptors), advanced every frame on the CPU by AudioAnalysisProcessor. Exposed as
              // a multi-output split — the same shape a Split node produces — so every downstream
              // surface reads the RIGHT pin instead of collapsing to one value: the per-pin value
              // tags (Renderer), a wire from any pin (_resolveInputValue indexes the split by source
              // pin), and `=node_<id>_N` references (_addNodeRefsToContext unwraps the split). Pin 0
              // (level) stays the node's on-canvas readout.
              result = {
                type: 'split',
                values: AUDIO_ANALYSIS_PINS.map((_, i) => audioAnalysisPinValue(node, i)),
              };
              break;
            }

            case "Wave": {
              // Free-running LFO; same curve the shader gets (see core/waveform.js).
              result = evaluateWave({
                shape: node.params?.shape,
                time: this.animationTime,
                frequency: this._evaluateParam(node.params?.frequency, values, 1.0),
                phase: this._evaluateParam(node.params?.phase, values, 0.0),
                amplitude: this._evaluateParam(node.params?.amplitude, values, 1.0),
                offset: this._evaluateParam(node.params?.offset, values, 0.0),
                pulseWidth: this._evaluateParam(node.params?.pulseWidth, values, 0.5),
                unipolar: isWaveUnipolar(node),
              });
              break;
            }

            case "RandomValue": {
              // Clock-driven pseudo-random noise in [0, 1]; mirror the shader's fract(sin(...)) hash.
              const speed = this._evaluateParam(node.params?.speed, values, 1.0);
              const s = Math.sin(this.animationTime * speed * 12.9898) * 43758.5453;
              result = s - Math.floor(s);
              break;
            }

            case "ConstFloat": {
              // Prefer params.value (where ParameterExpressionSystem stores it), fall back to node.value
              let value = node.params?.value ?? node.value;

              // Check if value is an expression (with or without = prefix)
              // The = prefix may have been stripped by ParameterExpressionSystem
              if (typeof value === 'string') {
                const trimmed = value.trim();
                const isExpression = trimmed.startsWith('=') ||
                                    /[a-zA-Z_]/.test(trimmed) || // Contains letters (functions, variables)
                                    trimmed.includes('(');        // Contains function calls

                if (isExpression) {
                  try {
                    // Get audio capture instance
                    let audioCapture = null;
                    try {
                      audioCapture = getBrowserAudioCapture();
                    } catch {
                      // Audio system not available
                    }

                    // Build context with time, frame, and audio envelope values
                    const context = {
                      time: this.animationTime,
                      frame: Math.floor(this.animationTime * 60),
                      // Get audio envelope values from audio system if available
                      audioEnvelope: audioCapture?.getValue?.() ?? 0,
                      audioEnvelopeBass: audioCapture?.getAudioEnvelopeBass?.() ?? 0,
                      audioEnvelopeMids: audioCapture?.getAudioEnvelopeMids?.() ?? 0,
                      audioEnvelopeHighs: audioCapture?.getAudioEnvelopeHighs?.() ?? 0,
                      audioEnvelopeFull: audioCapture?.getAudioEnvelopeFull?.() ?? 0,
                      // Constants
                      PI: Math.PI,
                      E: Math.E,
                    };

                    // Add other node values to context (handles split objects + numeric suffixes).
                    this._addNodeRefsToContext(context, values);

                    // Remove = prefix if present before evaluation
                    const expressionWithoutPrefix = trimmed.startsWith('=') ? trimmed.slice(1) : trimmed;

                    // Evaluate using UnifiedExpressionSystem (has proper math function support)
                    value = this.expressionSystem.evaluateCPU(expressionWithoutPrefix, context);
                  } catch {


                    value = 0;
                  }
                } else {
                  // Not an expression, parse as number
                  const parsed = parseFloat(value);
                  value = isNaN(parsed) ? 0 : parsed;
                }
              }

              // Ensure result is a number
              if (typeof value === 'string') {
                const parsed = parseFloat(value);
                result = isNaN(parsed) ? 0 : parsed;
              } else {
                result = value ?? 0;
              }
              break;
            }

            case "ConstVec2": {
              const x = this._evaluateParam(node.params?.x, values, 0);
              const y = this._evaluateParam(node.params?.y, values, 0);
              result = [x, y];
              break;
            }

            case "ConstVec3": {
              const x = this._evaluateParam(node.params?.x, values, 0);
              const y = this._evaluateParam(node.params?.y, values, 0);
              const z = this._evaluateParam(node.params?.z, values, 0);
              result = [x, y, z];
              break;
            }

            case "ConstVec4": {
              const x = this._evaluateParam(node.params?.x, values, 0);
              const y = this._evaluateParam(node.params?.y, values, 0);
              const z = this._evaluateParam(node.params?.z, values, 0);
              const w = this._evaluateParam(node.params?.w, values, 1);
              result = [x, y, z, w];
              break;
            }

            case "Mouse": {
              // Live cursor state tracked by the GPU renderer (iMouse layout):
              // xy = position (normalized 0..1), z = held, w = click. Falls back
              // to screen center, not pressed, before any input.
              const m = (typeof window !== "undefined" && window._mousePosition) || null;
              result = m ? [m[0], m[1], m[2] || 0, m[3] || 0] : [0.5, 0.5, 0, 0];
              break;
            }

            case "Resolution":
              result = [1920, 1080]; // Default resolution
              break;

            case "Pi":
              result = Math.PI;
              break;

            // Math Nodes - Arithmetic
            case "Add": {
              const a = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : this._evaluateParam(node.params?.a, values, 0);
              const b = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : this._evaluateParam(node.params?.b, values, 0);
              result = a + b;
              break;
            }

            case "Subtract": {
              const a = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : this._evaluateParam(node.params?.a, values, 0);
              const b = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : this._evaluateParam(node.params?.b, values, 0);
              result = a - b;
              break;
            }

            case "Multiply": {
              const a = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : this._evaluateParam(node.params?.a, values, 1);
              const b = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : this._evaluateParam(node.params?.b, values, 1);
              result = a * b;
              break;
            }

            case "Divide": {
              const a = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : this._evaluateParam(node.params?.a, values, 1);
              const b = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : this._evaluateParam(node.params?.b, values, 1);
              result = b !== 0 ? a / b : 0;
              break;
            }

            case "Power": {
              const base = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : this._evaluateParam(node.params?.base, values, 1);
              const exp = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : this._evaluateParam(node.params?.exp, values, 2);
              result = Math.pow(base, exp);
              break;
            }

            // Math Nodes - Trigonometry
            case "Sin": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.sin(x);
              break;
            }

            case "Cos": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.cos(x);
              break;
            }

            case "Tan": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.tan(x);
              break;
            }

            case "Asin": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.asin(Math.max(-1, Math.min(1, x)));
              break;
            }

            case "Acos": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.acos(Math.max(-1, Math.min(1, x)));
              break;
            }

            case "Atan": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.atan(x);
              break;
            }

            case "Atan2": {
              const y = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const x = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 1;
              result = Math.atan2(y, x);
              break;
            }

            // Math Nodes - Functions
            case "Floor": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.floor(x);
              break;
            }

            case "Ceil": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.ceil(x);
              break;
            }

            case "Round": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.round(x);
              break;
            }

            case "Fract": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = x - Math.floor(x);
              break;
            }

            case "Abs": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.abs(x);
              break;
            }

            case "Sqrt": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.sqrt(Math.max(0, x));
              break;
            }

            case "Sign": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.sign(x);
              break;
            }

            case "Mod": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const y = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 1;
              result = y !== 0 ? x % y : 0;
              break;
            }

            case "Exp": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.exp(x);
              break;
            }

            case "Exp2": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.pow(2, x);
              break;
            }

            case "Log": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 1;
              result = x > 0 ? Math.log(x) : 0;
              break;
            }

            case "Log2": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 1;
              result = x > 0 ? Math.log2(x) : 0;
              break;
            }

            // Math Nodes - Range/Comparison
            case "Min": {
              const a = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const b = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 0;
              result = Math.min(a, b);
              break;
            }

            case "Max": {
              const a = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const b = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 0;
              result = Math.max(a, b);
              break;
            }

            case "Clamp": {
              const value = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const min = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 0;
              const max = node.inputs?.[2] ? this._toF32(this._resolveInputValue(node, 2, values)) : 1;
              result = Math.max(min, Math.min(max, value));
              break;
            }

            // Math Nodes - Interpolation
            case "Smoothstep": {
              const edge0 = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const edge1 = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 1;
              const x = node.inputs?.[2] ? this._toF32(this._resolveInputValue(node, 2, values)) : 0.5;
              const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(0.0001, edge1 - edge0)));
              result = t * t * (3 - 2 * t);
              break;
            }

            case "Step": {
              const edge = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0.5;
              const x = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 0;
              result = x < edge ? 0 : 1;
              break;
            }

            case "Compare": {
              // Mirror compileCompare(): output is select(0.0, 1.0, comparison),
              // i.e. 1.0 when the comparison holds, 0.0 otherwise. Without this case
              // Compare fell through to the default (result = 0), so the numeric pin
              // preview always showed 0.00 even though the thumbnail rendered correctly.
              const a = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const b = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 0;
              const operator = node.params?.operator || "greater";
              const epsilon = Math.max(0.0001, this._evaluateParam(node.params?.epsilon, values, 0.001));

              let comparison;
              switch (operator) {
                case "equal":        comparison = Math.abs(a - b) < epsilon; break;
                case "notEqual":     comparison = Math.abs(a - b) >= epsilon; break;
                case "greater":      comparison = a > b; break;
                case "greaterEqual": comparison = a >= b; break;
                case "less":         comparison = a < b; break;
                case "lessEqual":    comparison = a <= b; break;
                default:             comparison = a > b;
              }
              result = comparison ? 1 : 0;
              break;
            }

            case "Mix":
            case "Lerp": {
              const a = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const b = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 1;
              const t = node.inputs?.[2] ? this._toF32(this._resolveInputValue(node, 2, values)) : 0.5;
              result = a * (1 - t) + b * t;
              break;
            }

            case "InverseLerp": {
              const a = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const b = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 1;
              const value = node.inputs?.[2] ? this._toF32(this._resolveInputValue(node, 2, values)) : 0.5;
              result = b !== a ? (value - a) / (b - a) : 0;
              break;
            }

            case "Saturate": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = Math.max(0, Math.min(1, x));
              break;
            }

            // Math Nodes - Utilities
            case "OneMinus": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = 1.0 - x;
              break;
            }

            case "Negate": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = -x;
              break;
            }

            case "Reciprocal": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 1;
              result = x !== 0 ? 1.0 / x : 0;
              break;
            }

            // Math Nodes - Boolean logic
            // Mirrors compileLogicGate()/compileNot(): inputs are thresholded into booleans
            // (true when >= threshold) and the gate outputs exactly 0.0 or 1.0. An unconnected
            // input reads as false, same as the shader's default of 0.0.
            case "And":
            case "Or":
            case "Xor":
            case "Nand":
            case "Nor":
            case "Xnor": {
              const threshold = this._evaluateParam(node.params?.threshold, values, 0.5);
              const a = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const b = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 0;
              const boolA = a >= threshold;
              const boolB = b >= threshold;

              let gate;
              switch (node.kind) {
                case "And":  gate = boolA && boolB; break;
                case "Or":   gate = boolA || boolB; break;
                case "Xor":  gate = boolA !== boolB; break;
                case "Nand": gate = !(boolA && boolB); break;
                case "Nor":  gate = !(boolA || boolB); break;
                case "Xnor": gate = boolA === boolB; break;
                default:     gate = boolA && boolB;
              }
              result = gate ? 1 : 0;
              break;
            }

            case "Not": {
              const threshold = this._evaluateParam(node.params?.threshold, values, 0.5);
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              result = x >= threshold ? 0 : 1;
              break;
            }

            // Vector Nodes
            case "Dot": {
              const a = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [1, 0, 0];
              const b = node.inputs?.[1] ? this._toVec3(this._resolveInputValue(node, 1, values)) : [0, 1, 0];
              result = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
              break;
            }

            case "Cross": {
              const a = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [1, 0, 0];
              const b = node.inputs?.[1] ? this._toVec3(this._resolveInputValue(node, 1, values)) : [0, 1, 0];
              result = [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
              ];
              break;
            }

            case "Normalize": {
              const vec = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [1, 0, 0];
              const length = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]);
              result = length > 1e-6 ? [vec[0] / length, vec[1] / length, vec[2] / length] : [0, 0, 0];
              break;
            }

            case "Length": {
              const vec = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [0, 0, 0];
              result = Math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2]);
              break;
            }

            case "Distance": {
              const a = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [0, 0, 0];
              const b = node.inputs?.[1] ? this._toVec3(this._resolveInputValue(node, 1, values)) : [0, 0, 0];
              const diff = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
              result = Math.sqrt(diff[0] * diff[0] + diff[1] * diff[1] + diff[2] * diff[2]);
              break;
            }

            case "Reflect": {
              const incident = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [1, -1, 0];
              const normal = node.inputs?.[1] ? this._toVec3(this._resolveInputValue(node, 1, values)) : [0, 1, 0];
              const nLength = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
              const n = nLength > 1e-6 ? [normal[0] / nLength, normal[1] / nLength, normal[2] / nLength] : [0, 1, 0];
              const dotNI = n[0] * incident[0] + n[1] * incident[1] + n[2] * incident[2];
              result = [
                incident[0] - 2 * dotNI * n[0],
                incident[1] - 2 * dotNI * n[1],
                incident[2] - 2 * dotNI * n[2],
              ];
              break;
            }

            case "Refract": {
              const incident = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [1, -1, 0];
              const normal = node.inputs?.[1] ? this._toVec3(this._resolveInputValue(node, 1, values)) : [0, 1, 0];
              const eta = node.inputs?.[2] ? this._toF32(this._resolveInputValue(node, 2, values)) : 1.5;
              const nLength = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
              const n = nLength > 1e-6 ? [normal[0] / nLength, normal[1] / nLength, normal[2] / nLength] : [0, 1, 0];
              const iLength = Math.sqrt(incident[0] * incident[0] + incident[1] * incident[1] + incident[2] * incident[2]);
              const i = iLength > 1e-6 ? [incident[0] / iLength, incident[1] / iLength, incident[2] / iLength] : [0, 0, 0];
              const dotNI = n[0] * i[0] + n[1] * i[1] + n[2] * i[2];
              const k = 1.0 - eta * eta * (1.0 - dotNI * dotNI);
              if (k < 0.0) {
                result = [0, 0, 0];
              } else {
                const sqrtK = Math.sqrt(k);
                result = [
                  eta * i[0] - (eta * dotNI + sqrtK) * n[0],
                  eta * i[1] - (eta * dotNI + sqrtK) * n[1],
                  eta * i[2] - (eta * dotNI + sqrtK) * n[2],
                ];
              }
              break;
            }

            case "Split2": {
              const v = node.inputs?.[0] ? this._toVec2(this._resolveInputValue(node, 0, values)) : [0, 0];
              result = { type: "split", values: v };
              break;
            }

            case "Split3": {
              const v = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [0, 0, 0];
              result = { type: "split", values: v };
              break;
            }

            case "Split4": {
              const v = node.inputs?.[0] ? this._toVec4(this._resolveInputValue(node, 0, values)) : [0, 0, 0, 1];
              result = { type: "split", values: v };
              break;
            }

            case "Combine2": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const y = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 0;
              result = [x, y];
              break;
            }

            case "Combine3": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const y = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 0;
              const z = node.inputs?.[2] ? this._toF32(this._resolveInputValue(node, 2, values)) : 0;
              result = [x, y, z];
              break;
            }

            case "Combine4": {
              const x = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0;
              const y = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 0;
              const z = node.inputs?.[2] ? this._toF32(this._resolveInputValue(node, 2, values)) : 0;
              const w = node.inputs?.[3] ? this._toF32(this._resolveInputValue(node, 3, values)) : 1;
              result = [x, y, z, w];
              break;
            }

            case "VectorAdd": {
              const a = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [0, 0, 0];
              const b = node.inputs?.[1] ? this._toVec3(this._resolveInputValue(node, 1, values)) : [0, 0, 0];
              result = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
              break;
            }

            case "VectorSubtract": {
              const a = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [0, 0, 0];
              const b = node.inputs?.[1] ? this._toVec3(this._resolveInputValue(node, 1, values)) : [0, 0, 0];
              result = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
              break;
            }

            case "VectorMultiply": {
              const a = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [1, 1, 1];
              const b = node.inputs?.[1] ? this._toVec3(this._resolveInputValue(node, 1, values)) : [1, 1, 1];
              result = [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
              break;
            }

            case "VectorDivide": {
              const a = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [1, 1, 1];
              const b = node.inputs?.[1] ? this._toVec3(this._resolveInputValue(node, 1, values)) : [1, 1, 1];
              result = [
                b[0] !== 0 ? a[0] / b[0] : 0,
                b[1] !== 0 ? a[1] / b[1] : 0,
                b[2] !== 0 ? a[2] / b[2] : 0,
              ];
              break;
            }

            case "VectorScale": {
              const vec = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [1, 1, 1];
              const scale = node.inputs?.[1] ? this._toF32(this._resolveInputValue(node, 1, values)) : 1;
              result = [vec[0] * scale, vec[1] * scale, vec[2] * scale];
              break;
            }

            case "Swizzle": {
              const vec = node.inputs?.[0] ? this._toVec3(this._resolveInputValue(node, 0, values)) : [0, 0, 0];
              const pattern = node.params?.pattern || "xyz";
              const swizzled = [];
              for (const char of pattern) {
                switch (char) {
                  case 'x': swizzled.push(vec[0]); break;
                  case 'y': swizzled.push(vec[1]); break;
                  case 'z': swizzled.push(vec[2]); break;
                  default: swizzled.push(0);
                }
              }
              result = swizzled.slice(0, 3);
              break;
            }

            // Utility Nodes
            case "Expr": {
              const expr = (node.expr || "a").toString();

              // One scope entry per input pin (a, b, c, …). The pin list is expandable, so the
              // scope must follow the node's live count or the CPU preview would disagree with the
              // shader about what `c` means.
              const scope = { u_time: this.animationTime };
              const exprInputCount = Math.max(1, getInputCount(node));
              for (let i = 0; i < exprInputCount; i++) {
                scope[String.fromCharCode(97 + i)] = node.inputs?.[i]
                  ? this._toF32(this._resolveInputValue(node, i, values))
                  : 0;
              }

              try {
                // Math functions come from the evaluator's builtin table, so the
                // scope only carries this node's values.
                result = this.expressionSystem.evaluateCPUOrThrow(expr, scope);
                if (!Number.isFinite(result)) result = 0;
              } catch (error) {
                window.errorHandler?.handleError(error, {
                  component: 'expression-evaluation',
                  nodeId: node.id,
                  expression: expr,
                });
                result = 0;
              }
              break;
            }

            case "Remap": {
              const input = node.inputs?.[0] ? this._toF32(this._resolveInputValue(node, 0, values)) : 0.5;
              const inMin = this._evaluateParam(node.params?.inMin, values, 0.0);
              const inMax = this._evaluateParam(node.params?.inMax, values, 1.0);
              const outMin = this._evaluateParam(node.params?.outMin, values, 0.0);
              const outMax = this._evaluateParam(node.params?.outMax, values, 1.0);
              const shouldClamp = node.params?.clamp ?? false;

              // Remap formula: ((input - inMin) / (inMax - inMin)) * (outMax - outMin) + outMin
              const inRange = Math.max(0.0001, inMax - inMin);
              const normalized = (input - inMin) / inRange;
              const remapped = normalized * (outMax - outMin) + outMin;

              result = shouldClamp ? Math.max(outMin, Math.min(outMax, remapped)) : remapped;
              break;
            }

            // Field Nodes
            case "Circle": {
              const radius = this._evaluateParam(node.params?.radius, values, 0.25);
              const epsilon = Math.max(0.0001, this._evaluateParam(node.params?.epsilon, values, 0.02));
              result = { type: "circle", radius, epsilon };
              break;
            }
case "Rectangle": {
  const centerX = this._evaluateParam(node.params?.centerX, values, 0.5);
  const centerY = this._evaluateParam(node.params?.centerY, values, 0.5);
  const width = this._evaluateParam(node.params?.width, values, 0.5);
  const height = this._evaluateParam(node.params?.height, values, 0.5);
  const epsilon = Math.max(0.0001, this._evaluateParam(node.params?.epsilon, values, 0.02));
  result = { type: "rectangle", centerX, centerY, width, height, epsilon };
  break;
}
            // Output
            case "OutputFinal": {
              const c = node.inputs?.[0] ? this._resolveInputValue(node, 0, values) : [0, 0, 0];
              result = this._toVec3(c);
              break;
            }

            default:
              result = 0;
            }
          }
        } catch (error) {
          window.errorHandler?.handleError(error, {
            component: 'node-computation',
            nodeType: node.kind,
            nodeId: node.id
          });
          result = 0;
        }

        // Update cache immediately after computing each node
        values.set(node.id, result);
        node.__preview = result;
        updatedInputSnapshots.set(node.id, this._snapshotNodeInputs(node));
        
        // Update cache immediately so subsequent nodes can use the updated value
        this.lastComputedValues.set(node.id, result);
      }

      // Store computed values for expression system access (ensure all are saved)
      // Merge with existing cache to preserve non-dirty nodes
      for (const [nodeId, value] of values.entries()) {
        this.lastComputedValues.set(nodeId, value);
      }
      
      if (updatedInputSnapshots.size) {
        const nextInputs = new Map(this.lastComputedInputs);
        updatedInputSnapshots.forEach((inputs, nodeId) => {
          nextInputs.set(nodeId, inputs);
        });
        this.lastComputedInputs = nextInputs;
      }

      this._generateEnhancedThumbnails(graph.nodes, values);
      if (parameterHashes) {
        this.lastParameterHashes = new Map(parameterHashes);
      }

      // Return computed previews
      const previews = {};
      for (const node of nodesToProcess) {
        if (values.has(node.id)) {
          previews[node.id] = values.get(node.id);
        }
      }
      return { previews };
    } catch (error) {
      window.errorHandler?.handleError(error, {
        component: 'preview-computation',
      });
      // Return empty previews on error
      return { previews: {} };
    }
  }

// In PreviewComputer.js, replace the _generateEnhancedThumbnails method:

_generateEnhancedThumbnails(nodes, values) {
  try {
    // Use topological sort to ensure dependencies are processed first
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // Use cache if structure hasn't changed (no dirty nodes context, so full sort)
    const ordered = this._topologicalSort(nodes, byId, {
      allNodes: nodes
    });
    
    // Process nodes in dependency order
    for (const node of ordered) {
      // Don't clobber GPU-rendered thumbnails. The GPU preview system (ShaderPreviewManager via
      // PreviewSystem.generateNodePreview) owns thumbnails for compute and vector-output nodes;
      // overwriting them here with a CPU thumbnail on every preview computation (e.g. on each
      // parameter change) is what made GPU previews "disappear". Only (re)generate CPU thumbnails
      // for the scalar/numeric nodes the GPU path intentionally leaves to the CPU.
      const spm = window.shaderPreviewManager;
      if (spm?.enableGPUPreview && (spm.isComputeNode(node) || spm.isVisualNode(node))) {
        continue;
      }
      // Respect the per-node preview toggle (the eye button) AND the per-kind default — numeric
      // nodes are hidden by default. The GPU path already honors this in
      // PreviewSystem.generateNodePreview and _refreshNodePreview, but this CPU thumbnail path runs
      // on every computePreviews() (each parameter change and the render loop), so without the same
      // guard a hidden node gets its thumbnail regenerated on the next computation — the toggle
      // "won't stay off". Clear any stale thumbnail and skip the (re)render.
      const editor = window.editor;
      if (editor?.isNodePreviewEnabled && !editor.isNodePreviewEnabled(node)) {
        node.__thumb = null;
        continue;
      }
      node.__thumb = this._createNodeThumbnail(node, values);
    }
  } catch (error) {
    window.errorHandler?.handleError(error, {
      component: 'thumbnail-generation'
    });
  }
}
// In PreviewComputer.js, update _createNodeThumbnail to pass the node to _renderOutputThumbnail:

_createNodeThumbnail(node, values) {
  try {
    const size = this.previewSize;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      throw new Error("Failed to get 2D canvas context");
    }

    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, size, size);

    switch (node.kind) {
      // ... other cases ...
      case "Expr":
  this._renderExpressionThumbnail(ctx, size, node.expr || "a");
  break;
case "Remap":
  this._renderRemapThumbnail(ctx, size, node);
  break;

case "Posterize":
  this._renderPosterizeThumbnail(ctx, size, node);
  break;

case "ColorToGrayscale":
  this._renderGrayscaleThumbnail(ctx, size);
  break;

case "ColorInvert":
  this._renderInvertThumbnail(ctx, size);
  break;

case "Select":
  this._renderSelectThumbnail(ctx, size);
  break;

case "Compare":
  this._renderCompareThumbnail(ctx, size, node);
  break;
      case "OutputFinal":
        this._renderOutputThumbnail(ctx, size, node.__preview, node); // Pass node here
        break;
        
      default: {
        // ENHANCEMENT: For nodes without specific thumbnail rendering, use preview value
        // Check node output type to determine appropriate thumbnail rendering
        const nodeDef = NodeDefs[node.kind];
        const outputType = nodeDef?.pinsOut?.[0]?.type;
        const previewValue = values.get(node.id) ?? node.__preview;
        
        if (previewValue !== undefined && previewValue !== null) {
          if (outputType === 'f32' && typeof previewValue === 'number' && !Array.isArray(previewValue)) {
            // Only render float thumbnail for scalar (f32) outputs
            this._renderFloatThumbnail(ctx, size, previewValue);
          } else if (Array.isArray(previewValue)) {
            // Render vector/array value
            if (previewValue.length >= 3) {
              this._renderColorThumbnail(ctx, size, previewValue);
            } else if (previewValue.length === 2) {
              this._renderVec2Thumbnail(ctx, size, previewValue);
            } else {
              this._renderDefaultThumbnail(ctx, size, previewValue);
            }
          } else {
            // For non-scalar outputs, use default thumbnail rendering
            this._renderDefaultThumbnail(ctx, size, previewValue);
          }
        } else {
          // Fallback: render generic thumbnail
          this._renderDefaultThumbnail(ctx, size, 0);
        }
        break;
      }
    }

    return canvas;
  } catch (error) {
    window.errorHandler?.handleError(error, {
      component: 'thumbnail-creation',
      nodeId: node?.id,
      nodeKind: node?.kind
    });
    // Return error thumbnail
    const size = this.previewSize;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#2d1b1b";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#ff4444";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ERR", size / 2, size / 2);
    return canvas;
  }
}
_renderStripeThumbnail(ctx, size, node) {
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, size, size);
  const freq = node.params?.frequency ?? 5;
  const thick = node.params?.thickness ?? 0.5;
  const stripeWidth = size / (freq * 2);
  ctx.fillStyle = "#fff";
  for (let i = 0; i < freq * 2; i += 2) {
    ctx.fillRect(i * stripeWidth, 0, stripeWidth * thick * 2, size);
  }
}

_renderCheckerThumbnail(ctx, size, node) {
  const sx = node.params?.scaleX ?? 8;
  const sy = node.params?.scaleY ?? 8;
  const cellW = size / sx;
  const cellH = size / sy;
  for (let y = 0; y < sy; y++) {
    for (let x = 0; x < sx; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? "#fff" : "#000";
      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    }
  }
}

// Then update _renderOutputThumbnail to accept and use the node parameter:

_renderRemapThumbnail(ctx, size, _node) {
  ctx.fillStyle = "#8b5cf620";
  ctx.fillRect(0, 0, size, size);
  
  ctx.fillStyle = "#8b5cf6";
  ctx.font = "bold 10px monospace";
  ctx.textAlign = "center";
  ctx.fillText("REMAP", size / 2, size / 2 - 2);
  
  // Draw remap visualization
  ctx.strokeStyle = "#8b5cf6";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(4, size - 4);
  ctx.lineTo(size / 2, size / 2);
  ctx.lineTo(size - 4, 4);
  ctx.stroke();
}

_renderPosterizeThumbnail(ctx, size, node) {
  const steps = node.params?.steps || 8;
  
  ctx.fillStyle = "#f59e0b20";
  ctx.fillRect(0, 0, size, size);
  
  ctx.fillStyle = "#f59e0b";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("POST", size / 2, size / 2 - 4);
  
  ctx.font = "7px monospace";
  ctx.fillText(`${Math.round(steps)}`, size / 2, size / 2 + 6);
  
  // Draw steps
  const stepHeight = size / Math.min(steps, 8);
  for (let i = 0; i < Math.min(steps, 8); i++) {
    const brightness = i / steps;
    ctx.fillStyle = `rgba(245, 158, 11, ${0.3 + brightness * 0.7})`;
    ctx.fillRect(2, i * stepHeight, size - 4, stepHeight);
  }
}

_renderGrayscaleThumbnail(ctx, size) {
  ctx.fillStyle = "#6b728020";
  ctx.fillRect(0, 0, size, size);
  
  ctx.fillStyle = "#6b7280";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("GRAY", size / 2, size / 2);
  
  // Draw gradient
  const gradient = ctx.createLinearGradient(0, 0, size, 0);
  gradient.addColorStop(0, "#000000");
  gradient.addColorStop(1, "#ffffff");
  ctx.fillStyle = gradient;
  ctx.fillRect(2, size - 8, size - 4, 5);
}

_renderInvertThumbnail(ctx, size) {
  ctx.fillStyle = "#ec489920";
  ctx.fillRect(0, 0, size, size);
  
  ctx.fillStyle = "#ec4899";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.fillText("INV", size / 2, size / 2 + 2);
}

_renderColorSaturateThumbnail(ctx, size) {
  ctx.fillStyle = "#10b98120";
  ctx.fillRect(0, 0, size, size);
  
  ctx.fillStyle = "#10b981";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("SAT", size / 2, size / 2 + 1);
}

_renderContrastThumbnail(ctx, size) {
  ctx.fillStyle = "#3b82f620";
  ctx.fillRect(0, 0, size, size);
  
  ctx.fillStyle = "#3b82f6";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("CONT", size / 2, size / 2 + 1);
}

_renderBrightnessThumbnail(ctx, size) {
  ctx.fillStyle = "#f59e0b20";
  ctx.fillRect(0, 0, size, size);
  
  ctx.fillStyle = "#f59e0b";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("BRIT", size / 2, size / 2 + 1);
}

_renderColorConversionThumbnail(ctx, size, label) {
  ctx.fillStyle = "#a855f720";
  ctx.fillRect(0, 0, size, size);
  
  ctx.fillStyle = "#a855f7";
  ctx.font = "bold 7px monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, size / 2, size / 2 + 1);
}

_renderSelectThumbnail(ctx, size) {
  ctx.fillStyle = "#06b6d420";
  ctx.fillRect(0, 0, size, size);
  
  ctx.fillStyle = "#06b6d4";
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.fillText("SEL", size / 2, size / 2 + 2);
  
  // Draw selection visualization
  ctx.strokeStyle = "#06b6d4";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(8, 8);
  ctx.lineTo(size / 2, size / 2);
  ctx.moveTo(8, size - 8);
  ctx.lineTo(size / 2, size / 2);
  ctx.lineTo(size - 8, size / 2);
  ctx.stroke();
}

_renderCompareThumbnail(ctx, size, node) {
  const operator = node.params?.operator || "greater";
  const symbols = {
    equal: "=",
    notEqual: "≠",
    greater: ">",
    greaterEqual: "≥",
    less: "<",
    lessEqual: "≤"
  };
  
  ctx.fillStyle = "#14b8a620";
  ctx.fillRect(0, 0, size, size);
  
  ctx.fillStyle = "#14b8a6";
  ctx.font = "bold 14px monospace";
  ctx.textAlign = "center";
  ctx.fillText(symbols[operator] || ">", size / 2, size / 2 + 3);
}
_renderOutputThumbnail(ctx, size, color, node) {
  // If we have a connected input node, try to copy its thumbnail
  if (node && node.inputs && node.inputs[0]) {
    const inputNodeId = node.inputs[0];

    // Find the input node
    if (window.editor && window.editor.graph && window.editor.graph.nodes) {
      const inputNode = window.editor.graph.nodes.find(n => n.id === inputNodeId);

        if (inputNode && inputNode.__thumb) {
        try {
          if (inputNode.__thumb instanceof HTMLCanvasElement) {
            ctx.drawImage(inputNode.__thumb, 0, 0, size, size);
          } else if (inputNode.__thumb instanceof ImageData) {
            // ARCHITECTURAL FIX: Convert ImageData to Canvas immediately and replace on node
            // This ensures thumbnails are always Canvas, eliminating blocking putImageData during rendering
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = inputNode.__thumb.width;
            tempCanvas.height = inputNode.__thumb.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(inputNode.__thumb, 0, 0);
            // Replace ImageData with Canvas on the node - future renders will use Canvas
            inputNode.__thumb = tempCanvas;
            ctx.drawImage(tempCanvas, 0, 0, size, size);
          } else {
            ctx.drawImage(inputNode.__thumb, 0, 0, size, size);
          }

          // Add green border
          ctx.strokeStyle = "rgba(76, 175, 80, 0.6)";
          ctx.lineWidth = 2;
          ctx.strokeRect(1, 1, size - 2, size - 2);
          return;
        } catch {

        }
      }
    }
  }

  // Fallback
  this._renderColorThumbnail(ctx, size, color);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.strokeRect(2, 2, size - 4, size - 4);
}

// Thumbnail rendering methods (continued)
  _renderUVThumbnail(ctx, size) {
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, "#ff0080");
    gradient.addColorStop(1, "#0080ff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 1;
    const step = size / 4;
    for (let i = 0; i <= 4; i++) {
      const pos = i * step;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, size);
      ctx.moveTo(0, pos);
      ctx.lineTo(size, pos);
      ctx.stroke();
    }
  }

  _renderTimeThumbnail(ctx, size, time) {
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size * 0.3;

    ctx.fillStyle = "#333";
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "#666";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    const angle = (time % 2) * Math.PI;
    const handLength = radius * 0.8;
    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(
      centerX + Math.sin(angle) * handLength,
      centerY - Math.cos(angle) * handLength
    );
    ctx.stroke();
  }

  _renderFloatThumbnail(ctx, size, value) {
    const normalizedValue = Math.max(0, Math.min(1, Math.abs(value)));
    const hue = value >= 0 ? 120 : 0;

    ctx.fillStyle = `hsl(${hue}, 70%, ${30 + normalizedValue * 40}%)`;
    ctx.fillRect(0, 0, size, size);

    const barHeight = size * normalizedValue;
    ctx.fillStyle = `hsl(${hue}, 90%, 60%)`;
    ctx.fillRect(size * 0.1, size - barHeight, size * 0.8, barHeight);

    // ENHANCEMENT: Display numeric value prominently with better formatting
    let displayText;
    if (Math.abs(value) < 0.01 && value !== 0) {
      displayText = value.toExponential(2);
    } else if (Math.abs(value) >= 1000) {
      displayText = value.toExponential(2);
    } else {
      displayText = value.toFixed(3);
    }

    // Draw background for better readability
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    const fontSize = Math.max(10, Math.min(size * 0.25, 14));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const textMetrics = ctx.measureText(displayText);
    const textWidth = textMetrics.width;
    const textHeight = fontSize;
    const padding = 3;
    const bgX = (size - textWidth) / 2 - padding;
    const bgY = size / 2 - textHeight / 2 - padding;
    const bgWidth = textWidth + padding * 2;
    const bgHeight = textHeight + padding * 2;
    ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

    // Draw text with high contrast
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 2;
    ctx.fillText(displayText, size / 2, size / 2);
    ctx.shadowBlur = 0; // Reset shadow
  }

  _renderVec2Thumbnail(ctx, size, vec) {
    const [x, y] = this._toVec2(vec);

    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, `hsl(${x * 180}, 60%, 30%)`);
    gradient.addColorStop(1, `hsl(${y * 180 + 180}, 60%, 30%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const centerX = size / 2;
    const centerY = size / 2;
    const scale = size * 0.3;
    const endX = centerX + x * scale;
    const endY = centerY - y * scale;

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    const angle = Math.atan2(endY - centerY, endX - centerX);
    const headLength = 6;
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLength * Math.cos(angle - 0.5),
      endY - headLength * Math.sin(angle - 0.5)
    );
    ctx.moveTo(endX, endY);
    ctx.lineTo(
      endX - headLength * Math.cos(angle + 0.5),
      endY - headLength * Math.sin(angle + 0.5)
    );
    ctx.stroke();
  }

  _renderColorThumbnail(ctx, size, color) {
    const [r, g, b] = this._toVec3(color);
    const clampedR = Math.max(0, Math.min(1, r)) * 255;
    const clampedG = Math.max(0, Math.min(1, g)) * 255;
    const clampedB = Math.max(0, Math.min(1, b)) * 255;

    ctx.fillStyle = `rgb(${clampedR}, ${clampedG}, ${clampedB})`;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "rgba(255,255,255,0.1)";
    for (let i = 0; i < size; i += 4) {
      for (let j = 0; j < size; j += 4) {
        if ((i + j) % 8 === 0) {
          ctx.fillRect(i, j, 2, 2);
        }
      }
    }
  }

  _renderCircleThumbnail(ctx, size, circleData) {
    if (!circleData || typeof circleData !== "object") {
      this._renderDefaultThumbnail(ctx, size, circleData);
      return;
    }

    const { radius = 0.25, epsilon = 0.02 } = circleData;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, size, size);

    const imageData = ctx.createImageData(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const dist = Math.sqrt((u - 0.5) * (u - 0.5) + (v - 0.5) * (v - 0.5));
        const safeEpsilon = Math.max(epsilon, 0.0001);
        const field = 1.0 - this._smoothstep(radius - safeEpsilon, radius + safeEpsilon, dist);

        const intensity = Math.max(0, Math.min(1, field)) * 255;
        const idx = (y * size + x) * 4;
        imageData.data[idx + 0] = intensity;
        imageData.data[idx + 1] = intensity;
        imageData.data[idx + 2] = intensity;
        imageData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
  }

  _renderWaveThumbnail(ctx, size, waveType) {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "#00ff88";
    ctx.lineWidth = 2;
    ctx.beginPath();

    const amplitude = size * 0.3;
    const frequency = 2;
    const centerY = size / 2;

    for (let x = 0; x < size; x++) {
      const t = (x / size) * frequency * Math.PI * 2;
      const y = waveType === "Sin"
        ? centerY - Math.sin(t) * amplitude
        : centerY - Math.cos(t) * amplitude;

      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _renderExpressionThumbnail(ctx, size, expr) {
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "#fff";
    ctx.font = "8px monospace";
    ctx.textAlign = "center";

    const shortExpr = expr.length > 6 ? expr.substring(0, 6) + "..." : expr;
    ctx.fillText(shortExpr, size / 2, size / 2 + 2);
  }

  _renderMathThumbnail(ctx, size, kind) {
    ctx.fillStyle = "#2a2a2a";
    ctx.fillRect(0, 0, size, size);

    const symbols = {
      'Multiply': '×',
      'Add': '+',
      'Subtract': '−',
      'Divide': '÷'
    };

    ctx.fillStyle = "#ffaa00";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "center";
    ctx.fillText(symbols[kind] || kind.substring(0, 3), size / 2, size / 2 + 5);
  }

  _renderMixThumbnail(ctx, size) {
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, "#ff0000");
    gradient.addColorStop(1, "#0000ff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("MIX", size / 2, size / 2 + 3);
  }

  _renderSplitThumbnail(ctx, size, splitData) {
    if (splitData && splitData.type === "split") {
      const values = splitData.values;
      const third = size / values.length;

      values.forEach((val, i) => {
        const brightness = Math.max(0, Math.min(255, val * 255));
        ctx.fillStyle = `rgb(${brightness}, ${brightness}, ${brightness})`;
        ctx.fillRect(i * third, 0, third, size);
      });
    } else {
      this._renderDefaultThumbnail(ctx, size, splitData);
    }
  }

  _renderCombineThumbnail(ctx, size) {
    const third = size / 3;

    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, third, size);

    ctx.fillStyle = "#00ff00";
    ctx.fillRect(third, 0, third, size);

    ctx.fillStyle = "#0000ff";
    ctx.fillRect(third * 2, 0, third, size);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "center";
    ctx.fillText("→", size / 2, size / 2 + 3);
  }

  _renderSaturateThumbnail(ctx, size) {
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, "#000");
    gradient.addColorStop(0.5, "#888");
    gradient.addColorStop(1, "#fff");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "#ff0";
    ctx.font = "bold 8px Arial";
    ctx.textAlign = "center";
    ctx.fillText("SAT", size / 2, size / 2 + 2);
  }

  _renderDefaultThumbnail(ctx, size, value) {
    const isVector = Array.isArray(value) && value.length >= 3;

    if (isVector) {
      this._renderColorThumbnail(ctx, size, value);
    } else {
      // Don't render float thumbnail for default - use a generic pattern instead
      // Float thumbnails should only be used for scalar (f32) outputs explicitly
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, size, size);
      
      // Draw a subtle pattern to indicate generic output
      ctx.strokeStyle = "#444";
      ctx.lineWidth = 1;
      for (let i = 0; i < size; i += 4) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(size, i);
        ctx.stroke();
      }
    }
  }

  _evaluateDirtyNodes(graph, nodes, _byId) {
    const dirtyNodes = new Set();
    const dependentsMap = this._buildDependentsMap(nodes);
    const currentStructureHash = this._computeGraphStructureHash(graph);
    const parameterHashes = new Map();
    const manualDirtyNodes = new Set(this._manualDirtyNodes);
    this._manualDirtyNodes.clear();

    const structureChanged = currentStructureHash !== this.graphStructureHash;
    if (structureChanged) {
      this.graphStructureHash = currentStructureHash;
      // Invalidate topological sort cache when structure changes
      this._cachedTopologicalSort = null;
      this._cachedSortStructureHash = null;
      this._cachedSortById = null;
      
      // Invalidate NodeValueComputer cache when structure changes
      this._invalidateNodeValueComputerCache();
    }

    for (const node of nodes) {
      const currentInputs = this._snapshotNodeInputs(node);
      const previousInputs = this.lastComputedInputs.get(node.id);
      const currentParamHash = this._computeParameterHash(node);
      parameterHashes.set(node.id, currentParamHash);

      if (structureChanged) {
        dirtyNodes.add(node.id);
        continue;
      }

      const previousParamHash = this.lastParameterHashes.get(node.id);
      const paramsChanged = previousParamHash !== currentParamHash;
      if (paramsChanged || !this._areInputsEqual(previousInputs, currentInputs)) {
        this._markNodeAndDependentsDirty(node.id, dependentsMap, dirtyNodes);
        // Invalidate NodeValueComputer cache for this node and dependents
        this._invalidateNodeValueComputerCacheForNode(node.id);
      }

      // Audio Analysis nodes change every frame from the live audio signal — not from params or
      // wired inputs — so the param-hash/input checks above never flag them and the early-return
      // above would serve a stale cached value, freezing the numeric preview and any =node_<id>
      // readout while the GPU output keeps reacting. Force the node (and its dependents, e.g. a
      // downstream Remap) dirty whenever any of its live outputs (band meters, drum triggers and
      // the rest, advanced every frame by AudioAnalysisProcessor) differ from the last split.
      if (node.kind === 'AudioAnalysis') {
        const live = AUDIO_ANALYSIS_PINS.map((_, i) => audioAnalysisPinValue(node, i));
        const prev = this.lastComputedValues.get(node.id);
        const prevVals = prev && prev.type === 'split' ? prev.values : null;
        const changed = !prevVals || prevVals.length !== live.length
          || live.some((v, i) => prevVals[i] !== v);
        if (changed) {
          this._markNodeAndDependentsDirty(node.id, dependentsMap, dirtyNodes);
          this._invalidateNodeValueComputerCacheForNode(node.id);
        }
      }
    }

    if (structureChanged) {
      return { dirtyNodes, parameterHashes, structureChanged };
    }

    if (manualDirtyNodes.size) {
      manualDirtyNodes.forEach((nodeId) => {
        this._markNodeAndDependentsDirty(nodeId, dependentsMap, dirtyNodes);
        // Invalidate NodeValueComputer cache for manually marked dirty nodes
        this._invalidateNodeValueComputerCacheForNode(nodeId);
      });
    }

    return { dirtyNodes, parameterHashes, structureChanged: false };
  }

  _computeGraphStructureHash(graph) {
    if (!graph) return null;
    const nodeSignature = graph.nodes
      .map((node) => {
        const inputs = (node.inputs || []).map((input) => input ?? 'null').join(',');
        return `${node.id}:${node.kind}:${inputs}`;
      })
      .sort()
      .join('|');
    const connections = (graph.connections || [])
      .map((conn) => `${conn.from?.nodeId ?? conn.source ?? 'x'}>${conn.to?.nodeId ?? conn.target ?? 'y'}:${conn.to?.input ?? conn.input ?? '0'}`)
      .sort()
      .join('|');
    return `${graph.nodes.length}:${graph.connections?.length ?? 0}:${nodeSignature}:${connections}`;
  }

  _snapshotNodeInputs(node) {
    if (!node || !Array.isArray(node.inputs)) {
      return [];
    }
    return node.inputs.map((input) => input ?? null);
  }

  _computeParameterHash(node) {
    if (!node || typeof node.params === 'undefined') {
      return 'no-params';
    }
    try {
      return JSON.stringify(node.params);
    } catch {
      return 'param-hash-error';
    }
  }

  _areInputsEqual(prevInputs, nextInputs) {
    const a = prevInputs || [];
    const b = nextInputs || [];
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  _buildDependentsMap(nodes) {
    const map = new Map();
    const addEdge = (sourceId, dependentId) => {
      if (sourceId === undefined || sourceId === null || sourceId === '') return;
      if (!map.has(sourceId)) {
        map.set(sourceId, new Set());
      }
      map.get(sourceId).add(dependentId);
    };

    for (const node of nodes) {
      // Wire-based dependents (graph connections).
      for (const input of node.inputs || []) {
        if (!input) continue;
        addEdge(input, node.id);
      }

      // Expression-based dependents. A node whose parameter references another node via
      // `node_<id>` (e.g. a Vec2 with `=node_28` or `=node_27 > 1 ? 10 : 20`, or a Switch
      // whose `select` is driven by `=node_X`) depends on that node even though there is no
      // wire between them. Without this edge the referencing node is never marked dirty when
      // its source changes, so its cached value — and the thumbnail regenerated from it —
      // freezes while the floating preview (which re-evaluates expressions on demand) stays
      // correct. Node ids are strings (see makeNode in NodeDefs.js) and _extractNodeReferences
      // returns string ids, so the keys line up with the wire-based edges above.
      if (node.params && typeof node.params === 'object') {
        for (const paramValue of Object.values(node.params)) {
          for (const refId of this._extractNodeReferences(paramValue)) {
            if (refId === node.id) continue; // ignore self-references
            addEdge(refId, node.id);
          }
        }
      }
    }
    return map;
  }

  _markNodeAndDependentsDirty(nodeId, dependentsMap, dirtySet) {
    const stack = [nodeId];
    while (stack.length) {
      const current = stack.pop();
      if (!current || dirtySet.has(current)) {
        continue;
      }
      dirtySet.add(current);
      const dependents = dependentsMap.get(current);
      if (dependents) {
        dependents.forEach((depId) => {
          if (!dirtySet.has(depId)) {
            stack.push(depId);
          }
        });
      }
    }
  }

  /**
   * Filter nodes to only include dirty nodes and their dependencies
   * This ensures we only process nodes that need recomputation
   * @param {Array} allNodes - All nodes in the graph
   * @param {Set} dirtyNodes - Set of dirty node IDs
   * @param {Map} byId - Map of node ID to node object
   * @returns {Array} Filtered array of nodes to compute
   */
  _filterNodesToCompute(allNodes, dirtyNodes, byId) {
    if (dirtyNodes.size === 0) {
      return [];
    }

    // Start with dirty nodes
    const nodesToCompute = new Set(dirtyNodes);
    
    // For each dirty node, add all its dependencies (nodes it depends on)
    // This ensures dependencies are computed before dependents
    for (const nodeId of dirtyNodes) {
      const node = byId.get(nodeId);
      if (!node) continue;

      // Add edge-based dependencies (from inputs)
      if (node.inputs && Array.isArray(node.inputs)) {
        for (const inputId of node.inputs) {
          if (inputId && byId.has(inputId)) {
            nodesToCompute.add(inputId);
            // Recursively add dependencies of dependencies
            this._collectDependencies(inputId, byId, nodesToCompute);
          }
        }
      }

      // Add expression-based dependencies (from parameter references)
      if (node.params && typeof node.params === 'object') {
        for (const paramValue of Object.values(node.params)) {
          const referencedIds = this._extractNodeReferences(paramValue);
          for (const refId of referencedIds) {
            if (byId.has(refId)) {
              nodesToCompute.add(refId);
              // Recursively add dependencies of dependencies
              this._collectDependencies(refId, byId, nodesToCompute);
            }
          }
        }
      }
    }

    // Convert Set to Array, filtering to only nodes that exist in byId
    return Array.from(nodesToCompute)
      .map(id => byId.get(id))
      .filter(node => node !== undefined);
  }

  /**
   * Recursively collect all dependencies of a node
   * @param {string} nodeId - Node ID to collect dependencies for
   * @param {Map} byId - Map of node ID to node object
   * @param {Set} collected - Set to add dependencies to
   */
  _collectDependencies(nodeId, byId, collected) {
    const node = byId.get(nodeId);
    if (!node || collected.has(nodeId)) {
      return;
    }

    // Add edge-based dependencies
    if (node.inputs && Array.isArray(node.inputs)) {
      for (const inputId of node.inputs) {
        if (inputId && byId.has(inputId) && !collected.has(inputId)) {
          collected.add(inputId);
          this._collectDependencies(inputId, byId, collected);
        }
      }
    }

    // Add expression-based dependencies
    if (node.params && typeof node.params === 'object') {
      for (const paramValue of Object.values(node.params)) {
        const referencedIds = this._extractNodeReferences(paramValue);
        for (const refId of referencedIds) {
          if (byId.has(refId) && !collected.has(refId)) {
            collected.add(refId);
            this._collectDependencies(refId, byId, collected);
          }
        }
      }
    }
  }

  // Helper functions
  _topologicalSort(nodes, byId, options = {}) {
    const { dirtyNodes = null, structureChanged = false, allNodes = null } = options;
    
    // Check if we can use cached sort for incremental updates
    const canUseCache = !structureChanged && 
                        this._cachedTopologicalSort !== null && 
                        this._cachedSortStructureHash === this.graphStructureHash &&
                        dirtyNodes !== null &&
                        allNodes !== null &&
                        dirtyNodes.size > 0;

    if (canUseCache) {
      // Incremental update: only sort dirty nodes and their dependencies
      return this._incrementalTopologicalSort(nodes, byId, dirtyNodes, allNodes);
    }

    // Full sort: compute complete topological sort
    const visited = new Set();
    const result = [];

    const visit = (nodeId) => {
      if (!nodeId || visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = byId.get(nodeId);
      if (!node) return;

      // Visit edge-based dependencies (inputs)
      for (const input of node.inputs || []) {
        if (input) visit(input);
      }

      // Visit expression-based dependencies (parameter references)
      if (node.params && typeof node.params === 'object') {
        for (const paramValue of Object.values(node.params)) {
          const referencedIds = this._extractNodeReferences(paramValue);
          for (const refId of referencedIds) {
            if (byId.has(refId)) {
              visit(refId);
            }
          }
        }
      }

      result.push(node);
    };

    for (const node of nodes) {
      visit(node.id);
    }

    // Cache the result if we have all nodes and structure hash
    if (allNodes && this.graphStructureHash !== null) {
      this._cachedTopologicalSort = result;
      this._cachedSortStructureHash = this.graphStructureHash;
      // Build index map for faster lookups
      this._cachedSortById = new Map();
      result.forEach((node, index) => {
        this._cachedSortById.set(node.id, index);
      });
    }

    return result;
  }

  /**
   * Incremental topological sort: only sort dirty nodes and merge with cached sort
   * @param {Array} nodesToSort - Nodes to sort (dirty nodes and their dependencies)
   * @param {Map} byId - Map of node ID to node object
   * @param {Set} dirtyNodes - Set of dirty node IDs
   * @param {Array} allNodes - All nodes in the graph
   * @returns {Array} Merged sorted array maintaining dependency order
   */
  _incrementalTopologicalSort(nodesToSort, byId, dirtyNodes, allNodes) {
    // Get set of nodes that need to be resorted (dirty + their dependencies)
    const nodesToResort = new Set();
    for (const node of nodesToSort) {
      nodesToResort.add(node.id);
    }

    // Extract non-dirty nodes from cache (maintain their cached order)
    const cachedNonDirty = [];
    const cachedNodeSet = new Set();
    
    if (this._cachedTopologicalSort) {
      for (const node of this._cachedTopologicalSort) {
        if (!nodesToResort.has(node.id) && byId.has(node.id)) {
          cachedNonDirty.push(node);
          cachedNodeSet.add(node.id);
        }
      }
    }

    // Sort only the dirty nodes and their dependencies
    // Note: We visit ALL dependencies (even non-dirty ones) to ensure correct ordering,
    // but only add nodes in nodesToResort to dirtySorted
    const visited = new Set();
    const dirtySorted = [];
    const allNodesById = new Map(allNodes.map(n => [n.id, n]));

    const visit = (nodeId) => {
      if (!nodeId || visited.has(nodeId)) return;
      visited.add(nodeId);

      // Use allNodesById to get node (includes all nodes, not just those in byId)
      const node = allNodesById.get(nodeId);
      if (!node) return;

      // Visit edge-based dependencies (inputs) - visit ALL dependencies for correct ordering
      for (const input of node.inputs || []) {
        if (input && allNodesById.has(input)) {
          visit(input);
        }
      }

      // Visit expression-based dependencies (parameter references) - visit ALL dependencies
      if (node.params && typeof node.params === 'object') {
        for (const paramValue of Object.values(node.params)) {
          const referencedIds = this._extractNodeReferences(paramValue);
          for (const refId of referencedIds) {
            if (allNodesById.has(refId)) {
              visit(refId);
            }
          }
        }
      }

      // Only add nodes that need to be resorted to dirtySorted (must be in byId)
      if (nodesToResort.has(nodeId) && byId.has(nodeId)) {
        dirtySorted.push(byId.get(nodeId));
      }
    };

    // Sort dirty nodes (this will visit all dependencies, but only add nodesToResort to result)
    for (const node of nodesToSort) {
      visit(node.id);
    }

    // Merge: combine cached non-dirty nodes with newly sorted dirty nodes
    // Strategy: maintain dependency order by ensuring dependencies come before dependents
    const merged = [];
    const added = new Set();

    // Helper to check if a node's dependencies are satisfied
    const dependenciesSatisfied = (node) => {
      // Check edge-based dependencies
      for (const input of node.inputs || []) {
        if (input && !added.has(input)) {
          return false;
        }
      }
      // Check expression-based dependencies
      if (node.params && typeof node.params === 'object') {
        for (const paramValue of Object.values(node.params)) {
          const referencedIds = this._extractNodeReferences(paramValue);
          for (const refId of referencedIds) {
            if (allNodesById.has(refId) && !added.has(refId)) {
              return false;
            }
          }
        }
      }
      return true;
    };

    // Merge algorithm: process nodes maintaining dependency order
    let cachedIndex = 0;
    let dirtyIndex = 0;

    while (cachedIndex < cachedNonDirty.length || dirtyIndex < dirtySorted.length) {
      // Try to add from cached non-dirty nodes first (if dependencies satisfied)
      if (cachedIndex < cachedNonDirty.length) {
        const cachedNode = cachedNonDirty[cachedIndex];
        if (dependenciesSatisfied(cachedNode)) {
          merged.push(cachedNode);
          added.add(cachedNode.id);
          cachedIndex++;
          continue;
        }
      }

      // Try to add from dirty sorted nodes (if dependencies satisfied)
      if (dirtyIndex < dirtySorted.length) {
        const dirtyNode = dirtySorted[dirtyIndex];
        if (dependenciesSatisfied(dirtyNode)) {
          merged.push(dirtyNode);
          added.add(dirtyNode.id);
          dirtyIndex++;
          continue;
        }
      }

      // If we can't add from either, we have a dependency issue
      // Fall back to adding from dirty sorted (they should be properly ordered)
      if (dirtyIndex < dirtySorted.length) {
        const dirtyNode = dirtySorted[dirtyIndex];
        merged.push(dirtyNode);
        added.add(dirtyNode.id);
        dirtyIndex++;
      } else if (cachedIndex < cachedNonDirty.length) {
        // If no more dirty nodes, add remaining cached nodes
        const cachedNode = cachedNonDirty[cachedIndex];
        merged.push(cachedNode);
        added.add(cachedNode.id);
        cachedIndex++;
      } else {
        // Should not happen, but break to avoid infinite loop
        break;
      }
    }

    // Update cache with merged result
    this._cachedTopologicalSort = merged;
    this._cachedSortStructureHash = this.graphStructureHash;
    this._cachedSortById = new Map();
    merged.forEach((node, index) => {
      this._cachedSortById.set(node.id, index);
    });

    return merged;
  }

  /**
   * Extract node IDs referenced in a parameter expression
   * Examples: "=node_5" -> ["5"], "=sin(node_3)*2" -> ["3"], "=node_10_x+node_20_y" -> ["10", "20"]
   * @param {*} paramValue - Parameter value
   * @returns {Array<string>} Array of referenced node IDs
   */
  _extractNodeReferences(paramValue) {
    if (!paramValue || typeof paramValue !== 'string') {
      return [];
    }

    // Check if it's an expression (starts with =) or contains node references
    const trimmed = paramValue.trim();
    if (!trimmed.startsWith('=') && !trimmed.includes('node_')) {
      return [];
    }

    // Extract all node references in the format: node_<id> or node_<id>_rgba, etc.
    // This regex captures node_123, node_5, node_27_rgba, etc.
    // It extracts only the numeric ID part, stopping at suffixes like _rgba, _xyz, etc.
    const nodeRefPattern = /node_(\d+)(?:_\w+)?/g;
    const matches = trimmed.matchAll(nodeRefPattern);

    const nodeIds = [];
    for (const match of matches) {
      nodeIds.push(match[1]); // Extract the ID
    }

    return nodeIds;
  }

  _toVec2(v) {
    if (Array.isArray(v) && v.length >= 2) return [v[0], v[1]];
    if (typeof v === "number") return [v, v];
    return [0, 0];
  }

  _toVec3(v) {
    if (Array.isArray(v) && v.length >= 3) return [v[0], v[1], v[2]];
    if (Array.isArray(v) && v.length === 2) return [v[0], v[1], 0];
    if (typeof v === "number") return [v, v, v];
    return [0, 0, 0];
  }

  _toVec4(v) {
    if (Array.isArray(v) && v.length >= 4) return [v[0], v[1], v[2], v[3]];
    if (Array.isArray(v) && v.length === 3) return [v[0], v[1], v[2], 1];
    if (Array.isArray(v) && v.length === 2) return [v[0], v[1], 0, 1];
    if (typeof v === "number") return [v, v, v, 1];
    return [0, 0, 0, 1];
  }

  // Resolve the value flowing into input pin `inputIndex` of `node`, honoring the
  // source's output pin. Identical to values.get(node.inputs[i]) for normal
  // single-output sources; for a multi-output Split source it returns the specific
  // channel (the wired from.pin) instead of the whole { type:'split', values } object,
  // which _toF32/_toVec* would otherwise collapse to 0.
  _resolveInputValue(node, inputIndex, values) {
    const sourceId = node?.inputs?.[inputIndex];
    if (sourceId === undefined || sourceId === null) return undefined;
    const raw = values.get(sourceId);
    if (raw && typeof raw === "object" && raw.type === "split" && Array.isArray(raw.values)) {
      const pin = this._inputSourcePins?.get(`${node.id}|${inputIndex}`) ?? 0;
      return raw.values[pin] ?? raw.values[0];
    }
    return raw;
  }

  _toF32(v) {
    if (typeof v === "number") return isNaN(v) ? 0 : v;
    if (Array.isArray(v) && v.length > 0) {
      const sum = v.reduce((a, b) => (typeof b === "number" ? a + b : a), 0);
      return sum / v.length;
    }
    return 0;
  }

  _smoothstep(edge0, edge1, x) {
    const denominator = Math.max(1e-4, edge1 - edge0);
    const t = Math.min(1, Math.max(0, (x - edge0) / denominator));
    return t * t * (3 - 2 * t);
  }

  /**
   * Invalidate NodeValueComputer cache for a specific node and its dependents
   */
  _invalidateNodeValueComputerCacheForNode(nodeId) {
    try {
      const editor = this.editor || window.editor;
      if (editor?.previewSystem?.nodeValueComputer) {
        editor.previewSystem.nodeValueComputer.invalidateNodeAndDependents(nodeId);
      }
    } catch {
      // Silently fail if NodeValueComputer is not available
    }
  }

  /**
   * Invalidate all NodeValueComputer cache
   */
  _invalidateNodeValueComputerCache() {
    try {
      const editor = this.editor || window.editor;
      if (editor?.previewSystem?.nodeValueComputer) {
        editor.previewSystem.nodeValueComputer.invalidateCache(null);
      }
    } catch {
      // Silently fail if NodeValueComputer is not available
    }
  }
}