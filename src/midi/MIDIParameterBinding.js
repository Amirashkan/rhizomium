// src/midi/MIDIParameterBinding.js

/**
 * MIDIParameterBinding - Maps MIDI CC messages to node parameters
 * Allows real-time parameter control via MIDI controllers
 */
export class MIDIParameterBinding {
  constructor(graph, eventSystem, midiManager) {
    this.graph = graph;
    this.eventSystem = eventSystem;
    this.midiManager = midiManager;

    // Map of MIDI bindings: "deviceId:channel:cc" -> binding config
    this.bindings = new Map();

    // Reverse map: "nodeId.paramName" -> MIDI source
    this.parameterToMIDI = new Map();

    // Learning mode state
    this.learningMode = false;
    this.learningTarget = null; // { nodeId, paramName, callback }

    // Track which parameters are MIDI-controlled (should use uniforms)
    this.midiParameters = new Set(); // Set of "nodeId.paramName"

    this.setupEventListeners();
  }

  setupEventListeners() {
    if (!this.eventSystem) {
      console.error('[MIDIParameterBinding] Event system not available');
      return;
    }

    // Listen for MIDI CC messages
    this.eventSystem.on('MIDI_CC', (data) => {
      this.handleCCMessage(data);
    });

    console.log('[MIDIParameterBinding] Event listener registered for MIDI_CC');
  }

  /**
   * Create a binding between a MIDI CC and a node parameter
   */
  createBinding(deviceId, channel, cc, nodeId, paramName, options = {}) {
    const midiKey = `${deviceId}:${channel}:${cc}`;
    const paramKey = `${nodeId}.${paramName}`;

    const node = this.graph.nodes.find(n => n.id === nodeId);
    if (!node) {
      console.error('Node not found:', nodeId);
      return false;
    }

    // Get parameter definition to determine range
    const paramDef = this.getParameterDefinition(node, paramName);

    // Remove existing binding for this parameter
    this.removeBindingForParameter(nodeId, paramName);

    // Create binding config
    const binding = {
      deviceId,
      channel,
      cc,
      nodeId,
      paramName,
      min: options.min !== undefined ? options.min : (paramDef?.min || 0),
      max: options.max !== undefined ? options.max : (paramDef?.max || 1),
      curve: options.curve || 'linear', // linear, exponential, logarithmic
      inverted: options.inverted || false,
      enabled: true
    };

    this.bindings.set(midiKey, binding);
    this.parameterToMIDI.set(paramKey, {
      deviceId,
      channel,
      cc
    });

    // Mark this parameter to use a GPU uniform instead of being baked
    this.midiParameters.add(paramKey);
    console.log(`[MIDI] Marked ${paramKey} for uniform usage`);
    console.log(`[MIDI] Current MIDI parameters:`, Array.from(this.midiParameters));

    console.log(`Created MIDI binding: CC${cc} (Ch${channel}) → ${node.kind}.${paramName}`);

    // Trigger ONE shader recompilation to generate the uniform
    if (window.editor?.onChange) {
      console.log('[MIDI] Triggering shader recompile to generate uniform');
      console.log('[MIDI] Node:', node.id, 'Param:', paramName, 'Current value:', node.params[paramName]);
      window.editor.onChange();
    }

    this.eventSystem.emit('MIDI_BINDING_CREATED', binding);

    return true;
  }

  /**
   * Remove a specific MIDI binding
   */
  removeBinding(deviceId, channel, cc) {
    const midiKey = `${deviceId}:${channel}:${cc}`;
    const binding = this.bindings.get(midiKey);

    if (binding) {
      const paramKey = `${binding.nodeId}.${binding.paramName}`;
      this.parameterToMIDI.delete(paramKey);
      this.bindings.delete(midiKey);

      console.log(`Removed MIDI binding: CC${cc} (Ch${channel})`);

      this.eventSystem.emit('MIDI_BINDING_REMOVED', binding);
      return true;
    }

    return false;
  }

  /**
   * Remove binding for a specific parameter
   */
  removeBindingForParameter(nodeId, paramName) {
    const paramKey = `${nodeId}.${paramName}`;
    const midiSource = this.parameterToMIDI.get(paramKey);

    if (midiSource) {
      const midiKey = `${midiSource.deviceId}:${midiSource.channel}:${midiSource.cc}`;
      this.bindings.delete(midiKey);
      this.parameterToMIDI.delete(paramKey);

      console.log(`Removed MIDI binding for parameter: ${nodeId}.${paramName}`);
      return true;
    }

    return false;
  }

  /**
   * Handle incoming MIDI CC message
   */
  handleCCMessage(data) {
    const { deviceId, channel, cc, value, normalizedValue } = data;
    const midiKey = `${deviceId}:${channel}:${cc}`;

    // Check if we're in learning mode
    if (this.learningMode && this.learningTarget) {
      console.log(`[MIDIParameterBinding] Learning mode active, assigning CC${cc} to parameter`);
      this.completeLearning(deviceId, channel, cc);
      return;
    }

    // Check if this CC is bound to a parameter
    const binding = this.bindings.get(midiKey);

    console.log(`[MIDI CC${cc}] Key: ${midiKey}, Binding found:`, binding ? `${binding.nodeId}.${binding.paramName}` : 'NONE');
    console.log(`[MIDI] Total bindings:`, this.bindings.size, 'Keys:', Array.from(this.bindings.keys()));

    if (binding && binding.enabled) {
      console.log(`[MIDI] Updating parameter: ${binding.nodeId}.${binding.paramName} = ${normalizedValue}`);
      this.updateParameter(binding, normalizedValue);
    } else if (binding && !binding.enabled) {
      console.log(`[MIDI] Binding exists but is DISABLED`);
    }

    // Emit generic MIDI CC update event
    this.eventSystem.emit('MIDI_CC_UPDATE', {
      deviceId,
      channel,
      cc,
      value,
      normalizedValue,
      hasBing: !!binding
    });
  }

  /**
   * Update a parameter based on MIDI CC value
   */
  updateParameter(binding, normalizedValue) {
    const { nodeId, paramName, min, max, curve, inverted } = binding;

    const node = this.graph.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Apply curve transformation
    let transformedValue = normalizedValue;

    if (inverted) {
      transformedValue = 1 - transformedValue;
    }

    switch (curve) {
      case 'exponential':
        transformedValue = Math.pow(transformedValue, 2);
        break;
      case 'logarithmic':
        transformedValue = Math.sqrt(transformedValue);
        break;
      case 'linear':
      default:
        // No transformation
        break;
    }

    // Map to parameter range
    const paramValue = min + transformedValue * (max - min);

    // For real-time MIDI, directly update the parameter value (bypass undo tracking)
    this.setParameterValueDirect(node, paramName, paramValue);

    // Update GPU uniform buffer (fast! no recompilation!)
    this.triggerImmediateUpdate(node, paramName, paramValue);

    // Emit parameter update event
    this.eventSystem.emit('PARAMETER_CHANGED', {
      node,
      parameterName: paramName,
      newValue: paramValue,
      source: 'midi'
    });
  }

  /**
   * Start MIDI learn mode for a parameter
   */
  startLearning(nodeId, paramName, callback) {
    this.learningMode = true;
    this.learningTarget = { nodeId, paramName, callback };

    console.log(`[MIDIParameterBinding] MIDI Learn mode started for ${nodeId}.${paramName}`);
    console.log('Move any MIDI controller to assign it to this parameter');

    if (this.eventSystem) {
      this.eventSystem.emit('MIDI_LEARN_STARTED', {
        nodeId,
        paramName
      });
    }
  }

  /**
   * Complete MIDI learning with detected CC
   */
  completeLearning(deviceId, channel, cc) {
    if (!this.learningTarget) return;

    const { nodeId, paramName, callback } = this.learningTarget;

    // Create the binding
    const success = this.createBinding(deviceId, channel, cc, nodeId, paramName);

    if (success) {
      console.log(`MIDI Learn complete: CC${cc} → ${nodeId}.${paramName}`);

      if (callback) {
        callback({ deviceId, channel, cc, nodeId, paramName });
      }

      this.eventSystem.emit('MIDI_LEARN_COMPLETED', {
        deviceId,
        channel,
        cc,
        nodeId,
        paramName
      });
    }

    this.cancelLearning();
  }

  /**
   * Cancel MIDI learn mode
   */
  cancelLearning() {
    this.learningMode = false;
    this.learningTarget = null;

    this.eventSystem.emit('MIDI_LEARN_CANCELLED', {});
  }

  /**
   * Get binding for a specific MIDI CC
   */
  getBinding(deviceId, channel, cc) {
    const midiKey = `${deviceId}:${channel}:${cc}`;
    return this.bindings.get(midiKey);
  }

  /**
   * Get binding for a specific parameter
   */
  getBindingForParameter(nodeId, paramName) {
    const paramKey = `${nodeId}.${paramName}`;
    const midiSource = this.parameterToMIDI.get(paramKey);

    if (midiSource) {
      const midiKey = `${midiSource.deviceId}:${midiSource.channel}:${midiSource.cc}`;
      return this.bindings.get(midiKey);
    }

    return null;
  }

  /**
   * Get all bindings
   */
  getAllBindings() {
    return Array.from(this.bindings.values());
  }

  /**
   * Update binding options
   */
  updateBinding(deviceId, channel, cc, options) {
    const midiKey = `${deviceId}:${channel}:${cc}`;
    const binding = this.bindings.get(midiKey);

    if (binding) {
      if (options.min !== undefined) binding.min = options.min;
      if (options.max !== undefined) binding.max = options.max;
      if (options.curve !== undefined) binding.curve = options.curve;
      if (options.inverted !== undefined) binding.inverted = options.inverted;
      if (options.enabled !== undefined) binding.enabled = options.enabled;

      this.eventSystem.emit('MIDI_BINDING_UPDATED', binding);
      return true;
    }

    return false;
  }

  /**
   * Enable/disable a binding
   */
  setBindingEnabled(deviceId, channel, cc, enabled) {
    return this.updateBinding(deviceId, channel, cc, { enabled });
  }

  /**
   * Cleanup bindings when a node is deleted
   */
  cleanupNodeBindings(nodeId) {
    const toRemove = [];

    this.bindings.forEach((binding, midiKey) => {
      if (binding.nodeId === nodeId) {
        toRemove.push(midiKey);
      }
    });

    toRemove.forEach(midiKey => {
      const binding = this.bindings.get(midiKey);
      this.removeBinding(binding.deviceId, binding.channel, binding.cc);
    });
  }

  /**
   * Serialize bindings for save/load
   */
  serialize() {
    return {
      bindings: Array.from(this.bindings.values())
    };
  }

  /**
   * Load bindings from serialized data
   */
  deserialize(data) {
    this.bindings.clear();
    this.parameterToMIDI.clear();

    if (data.bindings) {
      data.bindings.forEach(binding => {
        const midiKey = `${binding.deviceId}:${binding.channel}:${binding.cc}`;
        const paramKey = `${binding.nodeId}.${binding.paramName}`;

        this.bindings.set(midiKey, binding);
        this.parameterToMIDI.set(paramKey, {
          deviceId: binding.deviceId,
          channel: binding.channel,
          cc: binding.cc
        });
      });
    }
  }

  /**
   * Helper methods
   */

  getParameterDefinition(node, paramName) {
    if (window.editor?.paramPanel) {
      const definitions = window.editor.paramPanel.getParameterDefinitions(node);
      if (definitions && definitions.length > 0) {
        const def = definitions.find(p => p.name === paramName);
        return def || null;
      }
    }
    return null;
  }

  /**
   * Set parameter value directly without undo tracking (for real-time MIDI)
   */
  setParameterValueDirect(node, paramName, value) {
    // Directly set the value on the node in all possible locations
    if (paramName === 'value') {
      node.value = value;
    } else if (paramName === 'x') {
      node.x = value;
    } else if (paramName === 'y') {
      node.y = value;
    } else if (paramName === 'z') {
      node.z = value;
    } else {
      // Store in both params and props for compatibility
      if (!node.params) node.params = {};
      node.params[paramName] = value;
      if (!node.props) node.props = {};
      node.props[paramName] = value;
    }
  }

  /**
   * Fast GPU uniform update - NO shader recompilation!
   * This is the key to smooth 60fps MIDI control
   */
  triggerImmediateUpdate(node, paramName, value) {
    // Update the GPU uniform buffer directly (super fast!)
    this.updateUniformValue(node.id, paramName, value);
  }

  /**
   * Check if a parameter should use a uniform (called during shader compilation)
   */
  shouldUseUniform(nodeId, paramName) {
    const paramKey = `${nodeId}.${paramName}`;
    return this.midiParameters.has(paramKey);
  }

  /**
   * Update a uniform value in the GPU buffer (NO recompilation!)
   */
  updateUniformValue(nodeId, paramName, value) {
    const uniformManager = window.nodeCompiler?.uniformManager;
    if (!uniformManager) {
      console.warn('[MIDI] Uniform manager not available');
      return;
    }

    const paramKey = `${nodeId}.${paramName}`;

    // Update the uniform value in the map
    uniformManager.uniformValues.set(paramKey, value);

    // Write to GPU buffer immediately
    if (window.gpuRenderer) {
      window.gpuRenderer._updateParameterUniforms();
      // Trigger render to show the visual change
      if (window.gpuRenderer.render) {
        window.gpuRenderer.render();
      }
    }
  }

  /**
   * Set parameter value with undo tracking (for manual bindings)
   */
  setParameterValue(node, paramName, value) {
    if (window.editor?.paramPanel?.valueManager) {
      window.editor.paramPanel.valueManager.setValue(node, paramName, value);
    } else {
      this.setParameterValueDirect(node, paramName, value);
    }
  }

  updateNodePreview(node) {
    if (window.editor?.paramPanel?.updateNodePreview) {
      window.editor.paramPanel.updateNodePreview(node);
    }
  }

  /**
   * Debug
   */
  debugPrintBindings() {
    console.log('=== MIDI Parameter Bindings ===');
    this.bindings.forEach((binding, midiKey) => {
      console.log(`${midiKey} → ${binding.nodeId}.${binding.paramName} [${binding.min}-${binding.max}]`);
    });
  }

  /**
   * Cleanup
   */
  destroy() {
    this.bindings.clear();
    this.parameterToMIDI.clear();
    this.learningMode = false;
    this.learningTarget = null;
  }
}
