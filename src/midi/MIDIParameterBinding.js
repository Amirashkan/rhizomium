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

    this.setupEventListeners();
  }

  setupEventListeners() {
    if (!this.eventSystem) {
      console.error('[MIDIParameterBinding] Event system not available');
      return;
    }

    // Debug: Check event system structure
    console.log('[MIDIParameterBinding] Event system:', this.eventSystem);
    console.log('[MIDIParameterBinding] Event system listeners before registration:',
      this.eventSystem.listeners ? this.eventSystem.listeners.size : 'N/A');

    // Listen for MIDI CC messages
    this.eventSystem.on('MIDI_CC', (data) => {
      console.log('[MIDIParameterBinding] ===== RECEIVED MIDI_CC EVENT =====');
      console.log('[MIDIParameterBinding] Data:', data);
      console.log('[MIDIParameterBinding] Learning mode:', this.learningMode);
      console.log('[MIDIParameterBinding] Learning target:', this.learningTarget);
      this.handleCCMessage(data);
    });

    // Debug: Verify listener was added
    console.log('[MIDIParameterBinding] Event listener registered for MIDI_CC');
    console.log('[MIDIParameterBinding] MIDI_CC listeners after registration:',
      this.eventSystem.listeners ? this.eventSystem.listeners.get('MIDI_CC')?.size : 'N/A');
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

    console.log(`Created MIDI binding: CC${cc} (Ch${channel}) → ${node.kind}.${paramName}`);

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
    console.log('[MIDIParameterBinding] handleCCMessage called', {
      learningMode: this.learningMode,
      learningTarget: this.learningTarget,
      data
    });

    const { deviceId, channel, cc, value, normalizedValue } = data;
    const midiKey = `${deviceId}:${channel}:${cc}`;

    // Check if we're in learning mode
    if (this.learningMode && this.learningTarget) {
      console.log('[MIDIParameterBinding] Learning mode active, completing learning');
      this.completeLearning(deviceId, channel, cc);
      return;
    }

    // Check if this CC is bound to a parameter
    const binding = this.bindings.get(midiKey);

    if (binding && binding.enabled) {
      this.updateParameter(binding, normalizedValue);
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

    // Update parameter value
    this.setParameterValue(node, paramName, paramValue);

    // Update node preview
    this.updateNodePreview(node);

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
    console.log('[MIDIParameterBinding] Learning state:', {
      learningMode: this.learningMode,
      learningTarget: this.learningTarget,
      hasEventSystem: !!this.eventSystem
    });
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
    if (window.editor?.paramPanel?.valueManager) {
      const def = window.editor.paramPanel.valueManager.getParameterDef(node, paramName);
      return def;
    }
    return null;
  }

  setParameterValue(node, paramName, value) {
    if (window.editor?.paramPanel?.valueManager) {
      window.editor.paramPanel.valueManager.setValue(node, paramName, value);
    } else {
      if (!node.params) node.params = {};
      node.params[paramName] = value;
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
