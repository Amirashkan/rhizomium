// src/osc/OSCParameterBinding.js

import { oscArgToNumber } from './OSCDecoder.js';
import {
  applyControlValue,
  mapNormalizedValue,
  refreshEditorForControlChange,
  writeParameterUniform,
} from '../parameters/ExternalParameterControl.js';

/**
 * OSCParameterBinding - maps OSC messages to node parameters.
 *
 * The MIDI equivalent can assume its input range: CC is always 0-127. OSC has
 * no such convention — a fader might send 0-1, a rotary 0-360, a sequencer step
 * 0-16 — so each binding carries the input range it expects and normalises
 * against that before the shared curve/range mapping runs.
 *
 * A binding is keyed by address *and* argument index, because one address
 * commonly carries several values (`/xy 0.3 0.7`), and each should be free to
 * drive a different parameter.
 */
export class OSCParameterBinding {
  constructor(graph, eventSystem, oscManager) {
    this.graph = graph;
    this.eventSystem = eventSystem;
    this.oscManager = oscManager;

    // "address:argIndex" -> binding config
    this.bindings = new Map();

    // "nodeId.paramName" -> { address, argIndex }
    this.parameterToOSC = new Map();

    // Parameters driven by OSC, which therefore need a GPU uniform.
    this.oscParameters = new Set();

    this.learningMode = false;
    this.learningTarget = null;

    this.setupEventListeners();
  }

  setupEventListeners() {
    if (!this.eventSystem) return;

    this.eventSystem.on('OSC_MESSAGE', (data) => {
      this.handleMessage(data);
    });
  }

  static makeKey(address, argIndex) {
    return `${address}:${argIndex}`;
  }

  /**
   * Bind an OSC address (and argument slot) to a node parameter.
   *
   * @param {string} address OSC address pattern, e.g. '/1/fader1'
   * @param {number} argIndex which argument of the message to read
   * @param {string} nodeId
   * @param {string} paramName
   * @param {object} options min/max/inputMin/inputMax/curve/inverted
   */
  createBinding(address, argIndex, nodeId, paramName, options = {}) {
    const node = this.graph?.nodes?.find((n) => n.id === nodeId);
    if (!node) return false;

    const paramDef = this.getParameterDefinition(node, paramName);

    // One parameter follows one source; rebinding replaces the old one.
    this.removeBindingForParameter(nodeId, paramName);

    const binding = {
      address,
      argIndex,
      nodeId,
      paramName,
      min: options.min !== undefined ? options.min : (paramDef?.min ?? 0),
      max: options.max !== undefined ? options.max : (paramDef?.max ?? 1),
      // Most OSC controllers send 0-1; anything else is declared per binding.
      inputMin: options.inputMin !== undefined ? options.inputMin : 0,
      inputMax: options.inputMax !== undefined ? options.inputMax : 1,
      curve: options.curve || 'linear',
      inverted: options.inverted || false,
      enabled: options.enabled !== undefined ? options.enabled : true,
    };

    this.bindings.set(OSCParameterBinding.makeKey(address, argIndex), binding);
    this.parameterToOSC.set(`${nodeId}.${paramName}`, { address, argIndex });
    this.oscParameters.add(`${nodeId}.${paramName}`);

    // One recompile so the parameter gets a uniform; after this, updates are
    // buffer writes.
    window.editor?.onChange?.();

    this.eventSystem?.emit('OSC_BINDING_CREATED', binding);
    return true;
  }

  removeBinding(address, argIndex) {
    const key = OSCParameterBinding.makeKey(address, argIndex);
    const binding = this.bindings.get(key);
    if (!binding) return false;

    const paramKey = `${binding.nodeId}.${binding.paramName}`;
    this.bindings.delete(key);
    this.parameterToOSC.delete(paramKey);
    this.oscParameters.delete(paramKey);

    this.eventSystem?.emit('OSC_BINDING_REMOVED', binding);
    return true;
  }

  removeBindingForParameter(nodeId, paramName) {
    const paramKey = `${nodeId}.${paramName}`;
    const source = this.parameterToOSC.get(paramKey);
    if (!source) return false;

    this.bindings.delete(OSCParameterBinding.makeKey(source.address, source.argIndex));
    this.parameterToOSC.delete(paramKey);
    this.oscParameters.delete(paramKey);
    return true;
  }

  /**
   * Handle an incoming OSC message.
   *
   * A message can feed several bindings at once — `/xy 0.3 0.7` driving two
   * parameters is the normal case, not an edge case — so every argument slot is
   * checked rather than just the first match.
   */
  handleMessage(data) {
    const { address, args = [] } = data || {};
    if (!address) return;

    if (this.learningMode && this.learningTarget) {
      // Learn from the first argument that actually carries a number, so a
      // leading label string in the message does not become the source.
      const argIndex = args.findIndex((arg) => typeof arg === 'number' || typeof arg === 'boolean');
      this.completeLearning(address, argIndex >= 0 ? argIndex : 0, args);
      return;
    }

    for (let argIndex = 0; argIndex < Math.max(args.length, 1); argIndex++) {
      const binding = this.bindings.get(OSCParameterBinding.makeKey(address, argIndex));
      if (binding?.enabled) {
        this.updateParameter(binding, oscArgToNumber(args[argIndex]));
      }
    }
  }

  /** Normalise a raw OSC reading against the binding's declared input range. */
  normalize(binding, rawValue) {
    const span = binding.inputMax - binding.inputMin;
    if (span === 0) return 0;
    return (rawValue - binding.inputMin) / span;
  }

  updateParameter(binding, rawValue) {
    const node = this.graph?.nodes?.find((n) => n.id === binding.nodeId);
    if (!node) return;

    const paramValue = mapNormalizedValue(this.normalize(binding, rawValue), binding);

    applyControlValue(node, binding.paramName, paramValue);
    writeParameterUniform(binding.nodeId, binding.paramName, paramValue);
    refreshEditorForControlChange('osc-parameter-update');

    this.eventSystem?.emit('PARAMETER_CHANGED', {
      node,
      parameterName: binding.paramName,
      newValue: paramValue,
      source: 'osc',
    });
  }

  /**
   * Wait for the next OSC message and bind it to this parameter.
   */
  startLearning(nodeId, paramName, callback) {
    this.learningMode = true;
    this.learningTarget = { nodeId, paramName, callback };

    this.eventSystem?.emit('OSC_LEARN_STARTED', { nodeId, paramName });
  }

  completeLearning(address, argIndex, args = []) {
    if (!this.learningTarget) return;

    const { nodeId, paramName, callback } = this.learningTarget;

    // Guess the input range from what arrived: a value outside 0-1 means the
    // sender is not using the usual normalised convention, so widen to 0-max
    // rather than clamping everything the artist sends to 1.
    const observed = oscArgToNumber(args[argIndex]);
    const options = {};
    if (observed > 1) options.inputMax = observed;
    else if (observed < 0) options.inputMin = observed;

    const success = this.createBinding(address, argIndex, nodeId, paramName, options);

    if (success) {
      callback?.({ address, argIndex, nodeId, paramName });
      this.eventSystem?.emit('OSC_LEARN_COMPLETED', { address, argIndex, nodeId, paramName });
    }

    this.cancelLearning();
  }

  cancelLearning() {
    this.learningMode = false;
    this.learningTarget = null;
    this.eventSystem?.emit('OSC_LEARN_CANCELLED', {});
  }

  getBinding(address, argIndex) {
    return this.bindings.get(OSCParameterBinding.makeKey(address, argIndex));
  }

  getBindingForParameter(nodeId, paramName) {
    const source = this.parameterToOSC.get(`${nodeId}.${paramName}`);
    if (!source) return null;
    return this.bindings.get(OSCParameterBinding.makeKey(source.address, source.argIndex)) ?? null;
  }

  getAllBindings() {
    return Array.from(this.bindings.values());
  }

  updateBinding(address, argIndex, options) {
    const binding = this.bindings.get(OSCParameterBinding.makeKey(address, argIndex));
    if (!binding) return false;

    for (const key of ['min', 'max', 'inputMin', 'inputMax', 'curve', 'inverted', 'enabled']) {
      if (options[key] !== undefined) binding[key] = options[key];
    }

    this.eventSystem?.emit('OSC_BINDING_UPDATED', binding);
    return true;
  }

  setBindingEnabled(address, argIndex, enabled) {
    return this.updateBinding(address, argIndex, { enabled });
  }

  /** Drop bindings for a deleted node so they cannot resurrect a stale id. */
  cleanupNodeBindings(nodeId) {
    for (const binding of this.getAllBindings()) {
      if (binding.nodeId === nodeId) {
        this.removeBinding(binding.address, binding.argIndex);
      }
    }
  }

  /** Does this parameter need a GPU uniform? (read during shader compilation) */
  shouldUseUniform(nodeId, paramName) {
    return this.oscParameters.has(`${nodeId}.${paramName}`);
  }

  serialize() {
    return { bindings: this.getAllBindings() };
  }

  deserialize(data) {
    this.bindings.clear();
    this.parameterToOSC.clear();
    this.oscParameters.clear();

    for (const binding of data?.bindings ?? []) {
      if (!binding?.address) continue;

      // Saves predating per-argument bindings carry no argIndex.
      const argIndex = binding.argIndex ?? 0;
      const restored = { ...binding, argIndex };

      this.bindings.set(OSCParameterBinding.makeKey(binding.address, argIndex), restored);
      this.parameterToOSC.set(`${binding.nodeId}.${binding.paramName}`, {
        address: binding.address,
        argIndex,
      });
      this.oscParameters.add(`${binding.nodeId}.${binding.paramName}`);
    }
  }

  getParameterDefinition(node, paramName) {
    const definitions = window.editor?.paramPanel?.getParameterDefinitions?.(node);
    return definitions?.find((p) => p.name === paramName) ?? null;
  }

  destroy() {
    this.bindings.clear();
    this.parameterToOSC.clear();
    this.oscParameters.clear();
    this.learningMode = false;
    this.learningTarget = null;
  }
}

export default OSCParameterBinding;
